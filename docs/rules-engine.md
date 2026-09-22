# Rules engine

The engine turns the event log into game output:

- `xp_ledger`: every XP award, by track (class or job)
- `quest_progress`: daily quests and weekly bosses
- `stat_snapshots`: the six ability scores for each day

It's a set of SQL functions in the server-only `game` schema, added in
migration `20260924000100_rules_engine.sql`. Every number comes from
`rules_config` for the active rules version.

## Running it

| When | What runs |
| --- | --- |
| Every 2 hours | The **Liftosaur sync** workflow runs `game.recompute_recent(21)` right after syncing, rescoring the last 21 days for every user. That covers workouts synced or edited in that window, and it scores each day within 2 hours of its end. |
| After a rules change | **Actions → Replay game** runs `game.replay_all()`, which rebuilds everyone's full history under the active version. |
| Later, from the app | Call `game.recompute(user, today, today)` after the user logs something, so the dashboard updates at once. |

`game.recompute(user, from, to)` deletes the user's output for the range
and rebuilds it from live events. Voided events are ignored. The range
snaps back to the Monday of `from`, because weekly bosses need whole
weeks. Running it twice gives the same result.

## Rebalancing

1. Insert a `rules_versions` row with the next version number.
2. Copy the old `rules_config` rows to the new version and change the
   values you're rebalancing.
3. Flip `is_active` to the new version.
4. Run **Replay game**.

Every ledger row and snapshot records the version it was computed under.
The test suite does exactly this with a v2 that makes T1 sets worth 10.

## XP

| Rule | Award |
| --- | --- |
| `xp.meal_slot_logged` | Quartermaster 5 XP for the first entry in each meal slot per day |
| `xp.weigh_in` | Quartermaster 5 XP, once a day |
| `xp.workout_set` | Working sets only. T1 goes to Barbarian (8 XP); T2 to Fighter (3); T3 to Fighter (2); untiered to Fighter (3) |
| `xp.personal_record` | Barbarian 20 XP per exercise per session with a new best estimated 1RM (`workout_prs`) |
| `xp.activity` | 5 XP per full 10 minutes. Running, cycling and swimming go to Ranger; walking, hiking and yard work to Druid; mobility to Monk |
| Quests | Each quest's `xp` to its track, on the quest's day (bosses on the day they fall) |

## Quests

Quests complete only when the goal is met. `completed_at` is the moment
it happened.

| Quest | Applies | Done when |
| --- | --- | --- |
| Log every meal | Every day | Breakfast, lunch and dinner each have an entry (at the third one) |
| Take the stack | The user has active stack items | The stack is logged |
| Train | Days not in `rest_days` | A session is logged. No XP, since the sets earn it |
| Hit protein | Every day | Running protein total reaches the target |
| Drink your water | Water goal > 0 | Running water total reaches the goal |
| Carb ceiling | Eating style low carb or keto | At the end of a fully logged day, carbs (net if set) are at or under the ceiling |
| Calorie window | Every day | At the end of a fully logged day, kcal is within ±`calorie_window_pct` of the target |
| Draugr of Drift (weekly) | Weeks with settings | The 6th fully logged day of the Mon–Sun week, at the moment its 3rd meal slot was logged |
| Iron Warden (weekly) | Weeks with settings | Sessions reach `training_days_per_week` minus injury and sick skips that week |

## Ability scores

Each score is baseline 10 + good points − bad points, rounded and clamped
to 3–20. The window is the 14 days ending on the snapshot day.

- **Judged days** are finished days on or after judging starts. Today is
  never judged, because the calorie window is judged at end of day.
- **The n denominator** is the number of judged days in the window. A
  "points at 100%" rule pays points × (qualifying days / n). Unlogged
  days count in n, so skipping a log never scores better than logging a
  bad day.

| Stat | Good | Bad |
| --- | --- | --- |
| STR | 4 × min(1, sessions ÷ planned), where planned = judged days × `training_days_per_week`/7 − injury/sick skips; plus 1 per PR (exercise per session) in the window, max 3 | 1 per planned session missed in each finished Mon–Sun week that ends in the window |
| DEX | 6 × days in the calorie window ÷ n | 1 per fully logged day over the window |
| CON | 6 × days in the calorie window ÷ n | 1 per fully logged day under the window |
| INT | 8 × days whose micronutrients averaged ≥ 80% of target ÷ n | 0.5 per day averaging < 50% |
| WIS | 8 × fully logged days (3+ meal slots) ÷ n | 2 per unlogged day |
| CHA | 0.5 × self-care weight (date night 3, friends/D&D 2, hobby 1), max 6; plus 0.5 per weigh-in day, max 2 | 0.5 per day beyond 7 since the last self-care log or weigh-in |

**STR freezes** during an injury or sick `recovery_periods` entry. It keeps
the value from the day before the period began, and `str_frozen` is set.

**INT** uses only nutrients the day's food has data for. Each nutrient
counts up to 100% of its target, then the day's score is the average
across those nutrients. Targets come from `user_nutrient_targets`, falling
back to the DRI for the profile's sex and age. Supplements never count.

## Interpretations

These are the places where the design doc and `rules_config` leave a
choice. Change them in code (and here) if they don't match intent.

1. **Judging starts with the first `user_settings` row** (first-run setup).
   Before that, nothing is day-judged: no unlogged-day penalties and no
   daily quests. Liftosaur history from before then still earns workout XP
   and PR points, and CHA's positive points count from the first event.
2. **Calories, carbs and micronutrients are judged only on fully logged
   days.** A day with just breakfast isn't "under the window". It already
   pays in WIS for not being fully logged.
3. **Only finished days are judged.** Today earns XP and quest progress
   right away, but can't be penalized until it's over.
4. **PRs count per exercise per session.** A top set and a bigger AMRAP
   set on the same day are one PR.
5. **"Take the stack" applies if the user has active stack items now.**
   The stack's history isn't used to decide past days.
6. **STR is judged by the week for penalties** (a missed session costs a
   point only once the week is over), and by the window for the completion
   rate.

## Not in the engine yet

These are in the schema but not yet written by the engine:
- Loot drops
- Achievements
- Streaks, including rest and injury days protecting them
- Freeze tokens

## Tests

`supabase/tests/50_rules_engine.sql` scores three made-up weeks for one user.
Every expected number is worked out by hand in the comments. It covers:

- XP by track
- Quest completion times and bosses
- All six scores
- An injury freezing STR
- A voided meal
- A deterministic replay
- Publishing rules v2 and replaying
- Clients reading only their own output and never running the engine
