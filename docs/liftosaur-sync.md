# Liftosaur sync

Workouts come from Liftosaur automatically ("never track twice"). The
**Liftosaur sync** GitHub workflow runs every 2 hours and turns each
Liftosaur workout into a `workout_session` event plus one `workout_set` event
per set.

## Connecting an account (one time)

Liftosaur's API needs a Premium subscription.

1. **Apply the migration.** After merging, run **Actions → Migrate
   database** with mode **apply**.
2. **Create your Statblock user.** Until the app has a sign-up screen, add
   yourself in Supabase under **Authentication → Users → Add user → Create
   new user**, with **Auto Confirm User** ticked. A trigger creates your
   profile. Its time zone defaults to America/Chicago, which decides which
   day a workout counts for.
3. **Create a Liftosaur API key.** In Liftosaur, go to **Settings → API Keys
   → Create API Key**. It starts with `lftsk_`.
4. **Connect it in the app.** Go to **Settings → Liftosaur → Connect**,
   paste the key and tap **Check and connect**. The app checks the key with
   Liftosaur (one `/history` request), then stores it with
   `set_liftosaur_key` through a server action that uses the secret key.
   The key is encrypted in Supabase Vault, and the `integrations` table
   only holds its id. The screen shows the connection, the last sync, any
   sync error and how many workouts were imported.

   Without the app, the same thing works from the Supabase **SQL Editor**
   (delete the query tab afterwards, since it saves the key in its text):
   ```sql
   select public.set_liftosaur_key(
     (select id from auth.users where email = 'you@example.com'),
     'lftsk_your_key_here');
   ```
5. **Run the first sync.** Go to **Actions → Liftosaur sync → Run
   workflow**. It loads your whole history. The log ends with a line like
   `N workouts in Liftosaur (full history); N new, ...`.

To replace a key, paste the new one on the same screen. That also clears an
error status. **Disconnect Liftosaur** deletes the key from Vault
(`disconnect_liftosaur`, migration `20260927000100`); workouts already
imported stay.

## How it works

`scripts/liftosaur/sync.py` (Python standard library plus psql), for each
integration with status `connected`:

1. **Reads the key** from `vault.decrypted_secrets`. It's masked in the
   GitHub log.
2. **Fetches history** from `GET /api/v1/history`:
   - **First sync:** the whole history, using cursor paging.
   - **After that:** the last 21 days (the 14-day stat window plus a week
     for late edits). With `startDate`, the API ignores `cursor`, so one
     page of up to 200 must hold the whole window. More than 200 workouts
     in three weeks fails loudly.
3. **Parses each record.** The format is Liftoscript Workouts, parsed by
   `scripts/liftosaur/liftohistory.py` against Liftosaur's own grammar.
   Weights are converted to kg. Warmups are flagged. Bodyweight sets
   store 0 kg. Assisted or weighted sets store the absolute load.
4. **Tags GZCL tiers.** History records don't carry tiers, so the sync
   reads the program the workout came from (`GET /api/v1/programs/:id`)
   and matches the day and exercise. The day comes from `week` +
   `dayName`/`dayInWeek`, or `day` for single-week programs like GZCLP.
   Liftosaur's GZCL programs mark tiers three ways, and all three work:

   | Style | Example | Used by |
   | --- | --- | --- |
   | Tier label | `t1: Squat / ...t1` | GZCLP, VDIP |
   | Label + `[order,weeks]` | `t1: Bench Press[1-12] / ...t1` | The Rippler, General Gainz |
   | Template name only | `Squat[1,1-12] / ...t1` | Jacked & Tan |

   - **Week ranges:** the `[...]` part is ignored when matching names.
   - **Programs written once in Week 1** (like The Rippler, whose Weeks 2–12
     are empty days): a lift the workout's own week doesn't list is looked
     up on the same day in the other weeks.
   - **Per-day tiers:** tiers follow the day, so Incline Bench Press is T2 on
     Rippler Day 1 and T3 on Day 3.
   - **Ignored lines:** template definitions (`t1 / used: none / ...`) and
     `{~ ~}` script blocks.
   - **Unlabelled lifts:** they get no tier and score under `untiered` in
     the rules.

   The parser was checked against every built-in GZCL program in
   Liftosaur's source.
5. **Applies the batch.** `liftosaur.apply_records()` runs in one
   transaction per user:
   - **New record:** events are inserted. `source_ref` is
     `lft:<record id>@<fingerprint>`, plus `:<set index>` for sets. The
     fingerprint hashes the record text together with the parsed sets and
     tiers.
   - **Unchanged record:** skipped (same id and fingerprint).
   - **Edited record:** the old session and sets are voided and the new
     version is inserted.
   - **Deleted record:** a synced workout inside the fetched window that
     Liftosaur no longer has is voided. Older ones are left alone.
6. **Updates `integrations`:**
   - `last_synced_at` is set.
   - `sync_cursor` becomes `backfilled` after the first full sync.
   - A 401 or 403 sets `status = 'error'` and `last_error`, and the account
     is skipped until the key is replaced.
   - Other failures set `last_error` and are retried on the next run.

The run fails (red in Actions) if any account failed.

## Full resync

Run **Actions → Liftosaur sync → Run workflow** with **full resync**
ticked (or `sync.py --full`) to re-check the whole history instead of the
last 21 days:
- **Changed workouts are rewritten.** That covers anything whose parsed sets
  or tiers differ, from a parser fix or a restructured program. The old
  version is voided.
- **Unchanged workouts are skipped.**
- **Deleted workouts are voided,** even ones older than 21 days.

**Known limit:** tiers come from the program as it is now. If you
restructure a program, a full resync re-tags older workouts by the new
layout.

## PRs

The `public.workout_prs` view lists every working set that has an estimated
1RM (Epley, 1–12 reps) with the best earlier estimate for the same exercise.
`is_pr` marks sets that beat it. Your first set of an exercise is the
baseline. The rules engine should count PRs per exercise per session.

## GitHub Actions minutes

The sync takes well under a minute, and GitHub bills each run as at least
one minute. At 12 runs a day that's about 360 minutes a month. That's free
for public repos, and within the 2,000 free minutes for private ones. Change
the `cron` line to run less often.

## Tests

- **`scripts/liftosaur/test_liftohistory.py`:** parser unit tests.
- **`supabase/tests/40_liftosaur_sync.sh`:** runs the real sync against
  `fixtures/liftosaur/fake_api.py`. The fake copies the real API's paging
  quirks. It covers:
  - Backfill
  - Tiers
  - Units and time zones
  - A rejected key
  - An unchanged re-sync
  - Edits, deletions and an undone edit
  - The PR view
  - Client access
