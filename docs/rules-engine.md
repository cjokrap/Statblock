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

Since rules v2 (migration `20261001000100_stat_progression.sql`), scores are
earned over weeks. Each stat keeps a running **progress** total in good days
(a perfect week is 7), stored in `stat_snapshots.progress`, and the score is
where that total sits on a ladder (`stats.progression`):

| Score | Progress needed | Perfect weeks from 10 |
| --- | --- | --- |
| 11 | 14 | 2 |
| 12 | 35 | 5 |
| 13 | 63 | 9 |
| 20 | 455 | 65 |

Each step costs one week more than the last (10 -> 11 is 2 weeks, 11 -> 12
is 3, ... 19 -> 20 is 11). Below 10 the ladder mirrors: 9 at -14, 8 at -35,
down to 3 at -245. Progress is clamped to 3-20, so nothing banks past 20 and
a long break never digs deeper than 3. Every day adds or removes progress
(`progress` in each `stats.*` rule):

| Stat | Good day | Bad day |
| --- | --- | --- |
| WIS | fully logged (3+ meal slots): +1 | unlogged: -2 |
| DEX | fully logged and in the calorie window: +1 | fully logged and over it: -1 |
| CON | fully logged and in the window: +1 | fully logged and under it: -1 |
| INT | micros averaged 80%+ of target: +1 | under 50%: -0.5 |
| STR | each session: +7 / planned sessions per week (a full week is 7); each PR +1, up to 3 a week | on Sunday, each planned session missed (minus injury/sick skips): -half a session |
| CHA | self-care weight x 0.875 (up to 5.25 a week); weigh-in days x 0.875 (up to 1.75) | each day past 7 without either: -0.5 |

Day-judged changes (WIS, DEX, CON, INT, the CHA gap, the STR shortfall) land
when the day is over, from judging start. Event-based gains (sessions, PRs,
self-care, weigh-ins) count the day they happen. A logged bad day nets 0
(WIS +1, DEX or CON -1); an unlogged day costs 2, so skipping a log is always
worse than logging a bad day.

**STR freezes** during an injury or sick `recovery_periods` entry: its
progress doesn't move, up or down.

`game.write_stats` carries progress forward from the day before the
recomputed range, or rebuilds from the game's start when there's no v2
snapshot to start from.

**INT** uses only nutrients the day's food has data for. Each nutrient
counts up to 100% of its target, then the day's score is the average
across those nutrients. Targets come from `user_nutrient_targets`, falling
back to the DRI for the profile's sex and age. Supplements never count.

## Interpretations

These are the places where the design doc and `rules_config` leave a
choice. Change them in code (and here) if they don't match intent.

1. **The game starts when the user starts playing** (`game.game_starts`):
   the first day they log something in the app (`source = 'app'`) or save
   targets. XP and scores count from then; imported history from before
   (Liftosaur) earns nothing, but still sets the PR baselines. **Judging**
   (unlogged-day penalties, daily quests) starts with the first
   `user_settings` row.
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
