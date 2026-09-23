# USDA loader

Loads USDA FoodData Central (public domain) CSV releases into `foods`,
`food_nutrients` and `food_portions`. The database must be migrated first
(see `docs/database.md`).

```
DATABASE_URL=postgres://... scripts/usda/load.sh <release.zip | URL | unzipped dir>
```

| Dataset | Source in `foods` | Ranks | Updates | Loaded? |
| --- | --- | --- | --- | --- |
| `foundation_food` | `usda_foundation` | 1 (whole food) | About twice a year | Yes |
| `sr_legacy_food` | `usda_sr_legacy` | 1 (whole food) | Final (2018) | Yes |
| `survey_food` (FNDDS) | `usda_survey` | 2 (generic dish) | About every two years | Yes |
| `branded_food` | `usda_branded` | 3 | Several times a year | **No** (see Size) |

`scripts/usda/latest_url.sh <dataset>` prints the newest release's URL.

## How it works

1. **Prepare** (`scripts/usda/prepare.py`, stdlib only): reads the release's
   CSVs by header name and keeps only what's used. That means the four data
   types above (Foundation zips also hold sub-sample rows), nutrients that
   map to `public.nutrients`, and a few branded columns. It also cleans
   numbers and dates:
   - Ids written as decimals (`1008.0`) are accepted.
   - A file that uses legacy nutrient numbers (`208`) in place of nutrient
     ids is translated through the release's `nutrient.csv`.
   - The log shows how many rows each file dropped and why.
   - If `food_nutrient.csv` yields no usable rows for a release that has
     foods, it stops and prints the file's header and first rows. That
     usually means FDC changed the layout. Without this stop, every food
     would be skipped for having no energy value.
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
- **Records the run** in `usda.load_runs` and empties staging. If the load
  fails, `load.sh` empties staging anyway. A rollback undoes the rows but
  doesn't give their disk space back; truncating does.

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
newest Foundation, SR Legacy and Survey releases. Releases already in
`usda.load_runs` are skipped, so most months nothing happens. To reload a
release (for example, after a loader fix), run it by hand with **force**
ticked. It needs the
repo secret `SUPABASE_DB_URL`, set to the **session pooler** connection
string (IPv4, port 5432). The transaction pooler can't run `\copy`.

Release discovery scrapes the FDC download page for
`FoodData_Central_<dataset>_csv_<date>.zip` links. If FDC changes that page,
`latest_url.sh` fails loudly. Until it's fixed, run the workflow with an
explicit URL.

## Size

Foundation, SR Legacy and Survey together are small (around 14,000 foods).

Branded is not loaded. The April 2026 release has about 2 million products
and 21.7 million nutrient rows. Staging it alone filled the Supabase free
plan's disk, before the merge or search indexes. Packaged foods are covered
two other ways instead:
- **Barcodes:** Open Food Facts (`off_products`), which stores only the
  products actually scanned.
- **Search:** the app looks packaged foods up live in the FDC API
  (`web/src/lib/fdc.ts`). It saves a product into `foods` (as
  `usda_branded`, keyed on its fdc_id, the same as the bulk loader) only
  when it's logged. One user is far below the API's limit of 1,000
  requests an hour.
  FDC matches any word of a query, so the app asks for products with
  every word first (falling back to any word), then ranks each page by how
  many words appear in the name, brand or sub-brand (a "!" standing in for
  an i, as in "FA!RLIFE", counts as one). It fetches 100 at a time, so a
  good match from lower in FDC's order still ranks near the top, and shows
  25 to a page with a "More packaged foods" link.
- **Broken detail records:** some FDC detail records (`/food/{fdcId}`) are
  missing, or list amounts without saying which nutrient each one is (seen
  on fdcId 2278100). When the details give no calories, the app uses the
  product's search-result entry instead, found through the search the user
  came from, then its barcode, then its name.

`load.sh` can still load a Branded release by hand into a database with
several GB free.

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
