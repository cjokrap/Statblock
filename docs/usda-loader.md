# USDA loader

Loads USDA FoodData Central (public domain) CSV releases into `foods`,
`food_nutrients` and `food_portions`. The database must be migrated first
(see `docs/database.md`).

```
DATABASE_URL=postgres://... scripts/usda/load.sh <release.zip | URL | unzipped dir>
```

Load each dataset once to start:

| Dataset | Source in `foods` | Ranks | Updates |
| --- | --- | --- | --- |
| `foundation_food` | `usda_foundation` | 1 (whole food) | About twice a year |
| `sr_legacy_food` | `usda_sr_legacy` | 1 (whole food) | Final (2018). Load once. |
| `survey_food` (FNDDS) | `usda_survey` | 2 (generic dish) | About every two years |
| `branded_food` | `usda_branded` | 3 | Several times a year |

`scripts/usda/latest_url.sh <dataset>` prints the newest release's URL.

## How it works

1. **Prepare** (`scripts/usda/prepare.py`, stdlib only): reads the release's
   CSVs by header name and keeps only what's used. That means the four data
   types above (Foundation zips also hold sub-sample rows), nutrients that
   map to `public.nutrients`, and a few branded columns. It also cleans
   numbers and dates. This shrinks the Branded upload a lot, because its
   ingredients text and unmapped nutrients never leave the machine.
2. **Stage and merge** (one transaction): psql `\copy`s the trimmed files into
   `usda.stage_*` and calls `usda.merge_staged(release, full_release, force)`.

The merge:

- **Upserts on `(source, source_id = fdc_id)`.** A food whose publication
  date hasn't changed is left alone. Inserted and changed foods get their
  `food_nutrients` and `food_portions` replaced.
- **Picks one value per nutrient.** Each app nutrient's own USDA id wins.
  When a food lacks it, `usda.nutrient_aliases` fills in:
  - Energy: 2048 (Atwater specific), then 2047 (Atwater general), when 1008
    is missing.
  - Carbs: 1050 (by summation) when 1005 is missing.
  - Fat: 1085 (NLEA) when 1004 is missing.
  - Sugars: 1063 (NLEA) when 2000 is missing.
- **Drops implausible values:** negative amounts, more than 100 g of a gram
  nutrient per 100 g, or more than 1,000 kcal per 100 g. These are Branded
  label typos.
- **Skips foods with no energy value.** They can't be scored against the
  calorie window.
- **Builds portions:**
  - Survey foods use `portion_description` and skip "Quantity not
    specified".
  - Foundation and SR Legacy build the label from amount, unit and modifier
    ("1 cup chopped", "1 large").
  - Branded foods get their label serving ("1 bar (60 g)") when it's in
    grams. A mL serving has no density, so it gets no portion.
  - Brand is `brand_name`, else `brand_owner`. Barcode is `gtin_upc` digits.
- **Retires missing foods (full releases).** FDC gives a food a new `fdc_id`
  when it revises it. After a full release, foods of that source that aren't
  in it get `foods.retired_at`. They stay in the table because old `food_log`
  rows point at them, but `search_foods` hides them. A food that reappears is
  un-retired. The merge refuses to retire more than half of a source's
  active foods, because that usually means a truncated download.
- **Records the run** in `usda.load_runs` and empties staging.

Options:

- `--partial`: the data isn't a whole release (for example, a hand-built
  subset). No retiring.
- `--force`: reload a release already in `usda.load_runs`, rewrite every
  food even if unchanged (use this after changing the mapping), and skip the
  retire guard.

Branded amounts are per 100 g, or per 100 mL for liquids. The schema stores
per 100 g, so a liquid's values are treated as per 100 g.

## Scheduled upserts

`.github/workflows/usda-sync.yml` runs on the 5th of each month and can also
be started by hand, optionally with a specific release URL. It loads the
newest Foundation, Survey and Branded releases. Releases already in
`usda.load_runs` are skipped, so most months nothing happens. It needs the
repo secret `SUPABASE_DB_URL`, set to the **session pooler** connection
string (IPv4, port 5432). The transaction pooler can't run `\copy`.

Release discovery scrapes the FDC download page for
`FoodData_Central_<dataset>_csv_<date>.zip` links. If FDC changes that page,
`latest_url.sh` fails loudly. Until it's fixed, run the workflow with an
explicit URL.

## Size

Branded is by far the largest dataset, with well over a million products.
Foundation, SR Legacy and Survey together are small (around 15,000 foods).
Before loading Branded into a hosted database, check the plan's disk limit.
The Supabase free tier is unlikely to hold it along with its search indexes.

## Tests

`supabase/tests/run_local.sh` also runs `supabase/tests/20_usda_loader.sh`
against a fresh database. That script loads the fixture releases in
`supabase/tests/fixtures/usda`, which are small hand-written files in FDC's
CSV layout. The tests cover:

- Energy and macro fallbacks, and the plausibility filter
- Portion labels
- Upsert skipping unchanged foods
- Retiring revised and dropped Branded foods, with an existing `food_log`
  row still pointing at them
- Search hiding retired foods
- Skipping a release that's already loaded
- The truncated-release guard and `--partial`
- Rejecting a Branded release that has no `branded_food.csv`
- The `usda` schema being closed to clients
