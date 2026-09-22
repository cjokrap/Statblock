#!/usr/bin/env bash
# Liftosaur sync tests: runs scripts/liftosaur/sync.py against a fake
# Liftosaur API (fixtures/liftosaur) and a freshly migrated database
# (PGDATABASE). Called by run_local.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
fx=supabase/tests/fixtures/liftosaur
unset DATABASE_URL
work=$(mktemp -d)
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
cp $fx/state_v1.json "$work/state.json"
python3 $fx/fake_api.py "$work/state.json" "$port" &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$work"' EXIT
export LIFTOSAUR_API_BASE="http://127.0.0.1:$port/api/v1" LIFTOSAUR_SYNC_NOW="2026-09-20T12:00:00+00:00"
for _ in $(seq 50); do python3 -c "import socket; socket.create_connection(('127.0.0.1', $port), 1)" 2>/dev/null && break; sleep 0.1; done

A=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
B=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
check() { psql -X -q -v ON_ERROR_STOP=1 -c "do \$\$ begin $1 end \$\$"; }
live_sessions() { psql -X -At -c "select count(*) from live_events where user_id = '$A' and type = 'workout_session'"; }

psql -X -q -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email) values ('$A', 'a@example.com'), ('$B', 'b@example.com');
select public.set_liftosaur_key('$A', 'lftsk_test_charles');
select public.set_liftosaur_key('$B', 'lftsk_revoked');
SQL

# First sync: full history for A. B's key is rejected, so the run exits 1.
out=$(scripts/liftosaur/sync.py 2>&1) && { echo "FAIL: a rejected key should fail the run" >&2; exit 1; }
[[ $out == *"4 workouts in Liftosaur (full history); 4 new"* ]] || { echo "FAIL: first sync output: $out" >&2; exit 1; }
[[ $out != *lftsk_* ]] || { echo "FAIL: the sync printed an API key" >&2; exit 1; }

check "
  assert (select count(*) from live_events where user_id = '$A' and type = 'workout_session') = 4, 'four sessions';
  assert (select count(*) from workout_sets s join events e on e.id = s.event_id
          where e.user_id = '$A' and s.exercise = 'Squat' and s.is_warmup) = 2, 'two squat warmups';
  assert (select string_agg(distinct s.tier, ',') from workout_sets s join workout_sessions ws on ws.event_id = s.session_event_id
          where ws.external_id = '1757870000000' and s.exercise = 'Squat') = 'T1', 'day 1 squat is T1';
  assert (select string_agg(distinct s.tier, ',') from workout_sets s join workout_sessions ws on ws.event_id = s.session_event_id
          where ws.external_id = '1758080000000' and s.exercise = 'Squat') = 'T2', 'day 3 squat is T2';
  assert (select string_agg(distinct s.tier, ',') from workout_sets s join workout_sessions ws on ws.event_id = s.session_event_id
          where ws.external_id = '1757870000000' and s.exercise = 'Lat Pulldown') = 'T3', 'lat pulldown is T3';
  assert (select bool_and(s.tier is null) from workout_sets s where s.exercise = 'Bicep Curl, Dumbbell'), 'unlabeled lift has no tier';
  assert (select max(weight_kg) from workout_sets where exercise = 'Bicep Curl, Dumbbell') = 12.5, 'kg kept as kg';
  assert (select max(weight_kg) from workout_sets s join workout_sessions ws on ws.event_id = s.session_event_id
          where ws.external_id = '1757870000000' and s.exercise = 'Squat' and not s.is_warmup) = 102.06, '225 lb = 102.06 kg';
  assert (select count(*) from workout_sets where exercise = 'Pull Up' and weight_kg = 0) = 4, 'bodyweight sets';
  assert (select e.local_date from events e join workout_sessions ws on ws.event_id = e.id
          where ws.external_id = '1758080000000') = '2026-09-16', '03:30 UTC is the evening before in Chicago';
  assert (select program || '/' || day_in_week || '/' || duration_s from workout_sessions
          where external_id = '1757960000000') = 'GZCLP/2/3900', 'session header';
  assert (select sync_cursor from integrations where user_id = '$A') = 'backfilled', 'A backfilled';
  assert (select status from integrations where user_id = '$B') = 'error', 'B marked errored';
  assert (select last_error from integrations where user_id = '$B') like '%401%', 'B error says 401';
  assert not exists (select 1 from liftosaur.stage_records), 'staging emptied';
"

# PRs: the September squat beats the August one; the August set is the baseline.
check "
  assert (select bool_or(is_pr) from workout_prs where exercise = 'Squat' and local_date = '2026-09-14'), 'squat PR';
  assert not (select bool_or(is_pr) from workout_prs where exercise = 'Squat' and local_date = '2026-08-01'), 'first squat is the baseline';
  assert not exists (select 1 from workout_prs where exercise = 'Bench Press' and local_date = '2026-09-14' and is_pr), 'first bench is not a PR';
"

# Second sync, nothing changed: recent window only, nothing written. B is skipped now.
before=$(psql -X -At -c "select count(*) from events")
out=$(scripts/liftosaur/sync.py 2>&1) || { echo "FAIL: second sync: $out" >&2; exit 1; }
[[ $out == *"(last 21 days); 0 new, 0 edited, 0 removed, 3 unchanged"* ]] || { echo "FAIL: second sync output: $out" >&2; exit 1; }
[[ $(psql -X -At -c "select count(*) from events") -eq $before ]] || { echo "FAIL: unchanged sync wrote events" >&2; exit 1; }

# v2: day 2 edited, day 3 deleted, a new day 1, and the August record deleted
# (outside the window, so it stays).
cp $fx/state_v2.json "$work/state.json"
out=$(scripts/liftosaur/sync.py 2>&1) || { echo "FAIL: v2 sync: $out" >&2; exit 1; }
[[ $out == *"1 new, 1 edited, 1 removed, 1 unchanged"* ]] || { echo "FAIL: v2 sync output: $out" >&2; exit 1; }
check "
  assert (select count(*) from live_events where user_id = '$A' and type = 'workout_session') = 4, 'old + day1 + edited day2 + new day1';
  assert (select max(s.weight_kg) from workout_sets s join live_events e on e.id = s.event_id
          where s.exercise = 'Deadlift') = 88.45, 'edited deadlift weight (195 lb)';
  assert (select count(*) from workout_sets s join live_events e on e.id = s.event_id
          where s.exercise = 'Deadlift') = 3, 'old deadlift sets voided';
  assert not exists (select 1 from live_events e join workout_sessions ws on ws.event_id = e.id
                     where ws.external_id = '1758080000000'), 'deleted record voided';
  assert not exists (select 1 from live_events e join workout_sets s on s.event_id = e.id
                     join workout_sessions ws on ws.event_id = s.session_event_id
                     where ws.external_id = '1758080000000'), 'deleted record sets voided';
  assert exists (select 1 from live_events e join workout_sessions ws on ws.event_id = e.id
                 where ws.external_id = '1754000000000'), 'record outside the window kept';
  assert (select count(*) from events where type = 'void' and source = 'liftosaur') > 0, 'voids are liftosaur-sourced';
"

# v3: the day 2 edit is undone. Its original revision was voided, so the
# re-insert needs a fresh source_ref.
cp $fx/state_v3.json "$work/state.json"
out=$(scripts/liftosaur/sync.py 2>&1) || { echo "FAIL: v3 sync: $out" >&2; exit 1; }
[[ $out == *"0 new, 1 edited, 0 removed, 2 unchanged"* ]] || { echo "FAIL: v3 sync output: $out" >&2; exit 1; }
check "
  assert (select max(s.weight_kg) from workout_sets s join live_events e on e.id = s.event_id
          where s.exercise = 'Deadlift') = 83.91, 'deadlift back to 185 lb';
  assert exists (select 1 from live_events where source_ref like 'lft:1757960000000@%~1'), 'revision suffix';
"

# Clients can read their own workouts and PRs but not the staging schema or others' data.
psql -X -q -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$B', false);
do \$\$ begin
  assert not exists (select 1 from public.workout_prs), 'B sees none of A''s PRs';
  assert not exists (select 1 from public.workout_sessions), 'B sees none of A''s sessions';
  begin
    perform 1 from liftosaur.stage_records;
    assert false, 'liftosaur schema should be private';
  exception when insufficient_privilege then null;
  end;
end \$\$;
select set_config('request.jwt.claim.sub', '$A', false);
do \$\$ begin
  assert (select count(*) from public.workout_sessions) > 0, 'A sees own sessions';
  assert exists (select 1 from public.workout_prs where is_pr), 'A sees own PRs';
end \$\$;
SQL

echo "all Liftosaur sync tests passed"
