# CLAUDE.md: Statblock

Context for Claude Code sessions in this repo. Read this first.

## What this is

Statblock (formerly "Viking Health") is a food and workout tracker that plays
like a D&D character sheet. Charles built it to make tracking food rewarding
for an ADHD brain, because plain tracking wasn't sticking and the core goal is
weight loss. v1 is for Charles only; the schema is multi-user ready so it can
open to others later.

- Design doc (source of truth for game rules and decisions):
  https://claude.ai/code/artifact/d1bb41db-fd6e-49c8-91be-2416ea546730
- Clickable mockup (dashboard, add food, settings, first-run setup):
  https://claude.ai/artifact/VZE587BTFyndYuQtbLeSQf
- Schema review notes: `docs/schema.md`

Both links are Charles's private artifacts; read them with the Artifact tool.

## Stack

Next.js on Vercel. Supabase for Postgres, Auth, Storage and scheduled jobs.
Migrations live in `supabase/migrations` and run in filename order. They reach
Supabase through the manual **Migrate database** GitHub workflow
(`scripts/db/migrate.sh`). A new migration needs a timestamp newer than every
existing one. After merging one, remind Charles to run the workflow. Setup
steps are in `docs/database.md`.

## Principles (don't break these)

- **Reward logging, not low numbers.** A fully logged 3,000 kcal day earns full
  logging XP. Skipping a log must always cost more than logging a bad day.
- **Mostly carrot, a little stick.** Stats dent on bad days and heal over a
  good week. Nothing is lost permanently.
- **A calorie window, not "lower is better."** Too far under hurts CON the
  same way too far over hurts DEX.
- **Quests are never checked off by hand.** They complete only when the goal
  is actually met. The calorie window is judged at end of day.
- **Never track twice.** Workouts come from Liftosaur automatically.
- **Suggested targets are not medical advice.** Every screen that shows them
  carries: "These are suggestions only and are not medical advice. Talk to
  your doctor before starting any diet or fitness program."

## Game rules in brief (full detail in the design doc and rules_config)

- **Classes (workouts):** Barbarian (GZCL T1), Fighter (T2/T3), Ranger
  (running, cycling, swimming), Druid (walking, hiking, yard work), Monk
  (mobility, rehab).
- **Jobs (food and habits):** Quartermaster (logging), Alchemist (protein,
  water, the daily supplement stack, carb ceilings), Cook and Provisioner
  (recipes and meal prep, later).
- **Ability scores:** 3 to 20, baseline 10, rolling 14-day window.
  - STR: PRs and completed sessions, judged per week. Injury and sick skips
    freeze it.
  - DEX: penalized for going over the calorie window.
  - CON: penalized for going under it.
  - INT: food micronutrients against DRIs. Supplements never count toward INT.
  - WIS: logging consistency. An unlogged day is the heaviest penalty in the
    game.
  - CHA: self-care logs (date night 3x, friends/D&D 2x, hobby 1x) plus
    weigh-ins.
- **Small XP awards:** the daily stack and hitting the water goal are worth
  1 Alchemist XP each. Neither affects stats.
- **Levels:** D&D 5e XP thresholds divided by 10, stored in
  `rules_config.levels.thresholds`.
- **Rules are data.** Rebalancing means publishing a new `rules_versions` row
  and replaying the XP ledger from events.

## Schema conventions

- Storage units are canonical: g, mL, kg, kcal. lb and oz are display
  settings. Use `oz_to_ml`, `lb_to_kg` and the reverse helpers.
- `events` is append-only. Corrections are `void` events, read via
  `live_events`. A trigger blocks updates even for the service role.
- Every event has a header row in `events` plus a typed detail table keyed
  by event id. Write through the `log_*` functions (`log_food`, `log_water`,
  `log_stack`, `log_skip`, `void_event`, ...), which insert both in one
  transaction.
- `local_date` is the user's calendar day, set from `profiles.timezone`.
- Targets are effective-dated. A settings change inserts a new
  `user_settings` row, and `settings_for(user, day)` returns the row in force.
  Past days keep the targets they were scored against.
- Game output (`xp_ledger`, `stat_snapshots`, `quest_progress`) is written by
  the server (service role) only. Clients read it.
- RLS is on for every table. New tables need policies in the same migration.
- USDA foods are never deleted. A food missing from a new release gets
  `retired_at`, which hides it from search while old logs still point at it.

## Data sources and licensing

| Source | Use | Rule |
| --- | --- | --- |
| USDA FoodData Central | Primary food data | Public domain. Bulk-load Foundation, SR Legacy and Survey. Branded (about 2M products) is too big for Supabase free, so it's not bulk-loaded; look packaged foods up on demand through the FDC API (1,000 requests/hour) and keep only the ones logged. Whole foods (Foundation, SR Legacy) rank first in search. |
| NIH DSLD | Supplement labels | CC0 |
| Open Food Facts | Barcodes | ODbL share-alike. Keep in `off_products`, separate from `foods`. |
| FatSecret | Gap filler | Do not store results. Caching isn't part of the free Basic tier. |
| Liftosaur API | Workout history | User's own Premium key, stored in Supabase Vault via `set_liftosaur_key` (service role only). Sent as `Authorization: Bearer lftsk_...`. Endpoints: `GET /api/v1/history` and `GET /api/v1/programs/:id` (for tiers). With `startDate`, the API ignores `cursor`. Liftosaur is open source (github.com/astashov/liftosaur); its grammar and serializer are the format reference. |

MyFitnessPal and Cronometer have no public API. Don't plan around them.

## Charles's settings (v1 seed)

- Calories: 2,000 kcal/day, window ±10%.
- Macros: protein 180 g, carbs 170 g, fat 67 g. Eating style: Custom.
- Water: 100 oz/day.
- Training: GZCL 4 days a week in Liftosaur (Premium). Rest days Wed and Sun.
- Daily stack: One A Day Men's and a fiber supplement.
- Time zone: America/Chicago. Display units: lb and oz.

## Testing

```
PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run_local.sh
```

The script applies `00_local_supabase_stubs.sql` (stand-ins for Supabase's
auth, storage and vault), then every migration, then
`10_schema_behavior.sql`, then the USDA loader tests (`20_usda_loader.sh`, on a
second fresh database), then the migration runner tests (`30_migrate.sh`), then the Liftosaur parser unit
tests and sync tests (`40_liftosaur_sync.sh`, against a fake Liftosaur API). All
asserts must pass. Add tests there for new
behavior.

## Next steps

1. **USDA loader:** built (`scripts/usda/load.sh`, `docs/usda-loader.md`,
   monthly `.github/workflows/usda-sync.yml` for Foundation, SR Legacy and
   Survey). Branded is not bulk-loaded (see Data sources). To do: baseline
   the hand-built database with the Migrate database workflow, then re-run
   USDA sync with force (the first Survey load staged no nutrients because
   of a since-fixed parsing bug).
2. **Liftosaur sync:** built (`scripts/liftosaur/sync.py`,
   `docs/liftosaur-sync.md`, `.github/workflows/liftosaur-sync.yml`, every 2
   hours). Charles runs **The Rippler** (12 weeks, lifts written once in
   Week 1 as `t1: Squat[1-12]`). GZCL tiers come from the program's labels
   or `...tN` templates, because history records don't carry them. PRs are
   in the `workout_prs` view. The first sync imported 74 workouts. After
   changing tier parsing, run the workflow with **full resync** so older
   workouts are re-tagged.
3. **Rules engine:** events plus the active rules version produce
   `xp_ledger`, `stat_snapshots` and `quest_progress`. Must be replayable.
   Test it against made-up weeks of data.
4. **Next.js app:** dashboard, food logging, settings, first-run setup, then
   the Liftosaur connect screen. Follow the mockup. Food search should fall
   back to a live FDC API lookup for packaged foods, saving only what gets
   logged.

## Later (not v1)

- Recipes and shopping list (Cook and Provisioner jobs).
- A homegrown workout tracker with progressive overload, replacing
  Liftosaur. The game layer only reads sets from events, so the swap won't
  touch XP or stats.
- Paleo-style food rules, which need food categories.
- Better restaurant data.
- A legal pass (terms, privacy policy, data licensing) before opening to
  other users.

## Open review items (docs/schema.md)

- Settings edits are gated on `current_date` in UTC. Consider using the
  profile time zone instead.
- DRI values need a spot-check before a public launch.
