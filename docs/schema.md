# Statblock schema: review notes

Twelve migrations in `supabase/migrations`, applied in filename order. All of
them run clean on Postgres 16, and `supabase/tests/run_local.sh` runs 50
behavior checks (RLS isolation, effective-dated settings, append-only events,
voids, dedupe, levels, DRIs), then the USDA loader, migration runner,
Liftosaur sync and rules engine tests.

## Design rules

- **Canonical units in storage:** grams, mL, kg, kcal. lb and oz are display
  settings converted in the app (`oz_to_ml`, `lb_to_kg` helpers exist in SQL).
- **Everything the user does is an event.** `events` is append-only (no update
  policy, plus a trigger that blocks updates even for the server). Corrections
  are `void` events. Views read `live_events`, which excludes voided rows.
- **Header + typed detail tables.** `events` holds who/when/type; `food_log`,
  `water_log`, `stack_log`, `weigh_ins`, `workout_sessions`, `workout_sets`,
  `activities`, `skips` and `self_care_log` hold the data, keyed by event id.
- **Game output is derived and rebuildable.** `xp_ledger`, `stat_snapshots`,
  `quest_progress` are written by the server only and can be replayed from
  events under any rules version.
- **Targets are effective-dated.** A settings change inserts a new
  `user_settings` row; `settings_for(user, day)` returns the row in force.
  Users can't edit rows that started before today.
- **RLS on every table.** Users see their own rows; reference data is
  read-only; clients can't write game output or synced (Liftosaur) events.

## Tables by area

| Area | Tables | Notes |
| --- | --- | --- |
| User | `profiles`, `user_settings`, `user_nutrient_targets` | Profile created by a signup trigger. Targets come from first-run setup. |
| Nutrition reference | `nutrients`, `dri_targets` | 29 nutrients with USDA ids; 20 count toward INT. DRIs for adults 19+ by sex and age band. |
| Foods | `foods`, `food_nutrients`, `food_portions`, `off_products` | USDA and custom foods share `foods`; `source_rank` puts whole foods first. USDA foods dropped from a release get `retired_at` and leave search. Open Food Facts products are saved only when logged: raw JSON in `off_products`, plus a `foods` row with source `off` (ODbL; see CLAUDE.md). FatSecret results are not stored. |
| USDA loader | `usda.stage_*`, `usda.nutrient_aliases`, `usda.load_runs` | Server-only schema. See `docs/usda-loader.md`. |
| Liftosaur sync | `liftosaur.stage_records`, `liftosaur.apply_records()`, `workout_prs` view | Server-only schema, plus a client-readable PR view. See `docs/liftosaur-sync.md`. |
| Rules engine | `game.recompute()`, `game.replay()`, `game.day_facts()`, `game.scores()` | Server-only functions that write `xp_ledger`, `quest_progress` and `stat_snapshots`. See `docs/rules-engine.md`. |
| Supplements | `supplements`, `supplement_nutrients`, `daily_stack_items` | DSLD (CC0) plus custom. |
| Events | `events` + 9 detail tables, `recovery_periods`, `self_care_categories` | Logging goes through `log_food`, `log_water`, `log_stack`, `log_weigh_in`, `log_self_care`, `log_activity`, `log_skip`, `end_recovery`, `void_event`. |
| Game | `tracks`, `rules_versions`, `rules_config`, `xp_ledger`, `stat_snapshots`, `quest_definitions`, `quest_progress`, loot and achievement tables | Rules v1 seeded from the design doc. Levels use D&D 5e thresholds divided by 10. |
| Integrations | `integrations` | Liftosaur key stored in Supabase Vault via `set_liftosaur_key` (server only); the table holds only the Vault id and sync state. |
| Storage | `portraits` bucket | Private; each user can only read and write `<their user id>/...`. |

## Decisions worth a second look

1. **Detail tables vs. one JSONB payload.** Typed tables cost more DDL but make
   nutrition and training queries plain SQL and let Postgres enforce ranges.
2. **Void events instead of deletes.** Keeps an honest ledger and makes XP
   replay deterministic. Trade-off: every read goes through `live_events`.
   If that gets slow, add a `voided_event_ids` materialized set.
3. **Settings rows can be added or edited for today and later only.** "Today"
   is `my_today()`, the caller's date in `profiles.timezone` (migration
   `20260926000100_settings_local_date.sql`; it used to be the UTC
   `current_date`, which refused evening edits in Chicago).
4. **No XP for self-care.** CHA only, per the design. Easy to add in rules.
5. **Rules as JSON in `rules_config`.** Flexible, but the rules engine has to
   validate shapes. A JSON Schema check per key could come later.
6. **FatSecret not persisted.** Its free tier doesn't include caching. The
   food library is USDA + custom until that changes.
7. **DRI values** were entered from the National Academies tables and should
   be spot-checked before a public launch.

## Not yet in the schema

Recipes and shopping lists (Cook/Provisioner, later) and the homegrown workout
tracker (later).
