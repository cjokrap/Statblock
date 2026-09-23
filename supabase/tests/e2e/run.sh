#!/usr/bin/env bash
# End-to-end check of the web app against a local stand-in for Supabase:
# Postgres with every migration and the USDA fixture foods, PostgREST for
# /rest/v1, and gateway.py for /auth/v1 (password sign-in with HS256 JWTs).
# Drives the real app in headless Chromium (flow.mjs) and saves screenshots.
#
# Usage: PGHOST=... PGUSER=postgres supabase/tests/e2e/run.sh [screenshot dir]
# Needs: psql, python3, node, a Chromium (CHROMIUM_PATH, default
# /opt/pw-browsers/chromium) and network access to download PostgREST once.
# Sign in as charles@example.com / test-password.
set -euo pipefail
cd "$(dirname "$0")/../../.."
root=$PWD
work=${E2E_WORK_DIR:-/tmp/statblock-e2e}
shots=${1:-$work/shots}
export E2E_DB=${E2E_DB:-statblock_e2e}
mkdir -p "$work" "$shots"
# Each server runs in its own process group (setsid), so stopping the group
# also stops children such as the Next.js server under npx.
pids=()
stop_all() { for p in "${pids[@]}"; do kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done; }
trap stop_all EXIT
start() { setsid "$@" & pids+=($!); }

# Free the ports in case an earlier run was interrupted.
for port in 3001 3002 3457 54321; do
  fuser -k -n tcp "$port" > /dev/null 2>&1 && sleep 0.5 || true
done

# PostgREST binary
if [[ ! -x $work/postgrest ]]; then
  curl -fsSL -o "$work/pgrst.tar.xz" \
    https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xJf "$work/pgrst.tar.xz" -C "$work"
fi

# Database: stubs, migrations, fixture foods, one user with some workouts.
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $E2E_DB" -c "create database $E2E_DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$E2E_DB" -f supabase/tests/00_local_supabase_stubs.sql
PGDATABASE=$E2E_DB scripts/db/migrate.sh > /dev/null
for d in FoodData_Central_foundation_food_csv_2026-04-30 FoodData_Central_sr_legacy_food_csv_2018-04 \
         FoodData_Central_survey_food_csv_2026-10-31; do
  PGDATABASE=$E2E_DB USDA_WORK_DIR=$work/usda scripts/usda/load.sh "supabase/tests/fixtures/usda/$d" > /dev/null
done
psql -X -q -v ON_ERROR_STOP=1 -d "$E2E_DB" -f supabase/tests/e2e/seed.sql

# PostgREST, the auth gateway and a fake USDA FoodData Central
cat > "$work/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:auth@${PGHOST:-localhost}:${PGPORT:-5432}/$E2E_DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "e2e-secret-e2e-secret-e2e-secret-0123"
server-host = "127.0.0.1"
server-port = 3001
CONF
start "$work/postgrest" "$work/postgrest.conf" > "$work/postgrest.log" 2>&1
start python3 supabase/tests/e2e/gateway.py > "$work/gateway.log" 2>&1
start python3 supabase/tests/e2e/fake_fdc.py > "$work/fdc.log" 2>&1
for _ in $(seq 50); do grep -q "service key" "$work/gateway.log" 2>/dev/null && break; sleep 0.2; done
anon=$(grep "^anon key" "$work/gateway.log" | cut -d' ' -f3)
service=$(grep "^service key" "$work/gateway.log" | cut -d' ' -f3)

# The app, built against the stand-in (NEXT_PUBLIC_* are inlined at build).
cd web
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon
export SUPABASE_SECRET_KEY=$service FDC_API_KEY=e2e-fdc-key FDC_API_BASE=http://127.0.0.1:3002/fdc/v1
export LIFTOSAUR_API_BASE=http://127.0.0.1:3002/liftosaur/api/v1 OFF_API_BASE=http://127.0.0.1:3002/off/api/v2
npx next build > "$work/build.log" 2>&1
start npx next start -p 3457 > "$work/next.log" 2>&1
for _ in $(seq 50); do curl -fs -o /dev/null http://localhost:3457/login && break; sleep 0.2; done

# Browser flow
cd "$work"
[[ -d node_modules/playwright-core ]] || npm i --no-save --no-audit --no-fund playwright-core > /dev/null 2>&1
cp "$root/supabase/tests/e2e/flow.mjs" .
node flow.mjs "$shots"

# What the flow saved, checked in the database.
psql -X -q -v ON_ERROR_STOP=1 -d "$E2E_DB" <<'SQL'
do $$ declare s public.user_settings; begin
  select * into s from public.user_settings;
  assert (select count(*) from public.user_settings) = 1, 'setup and settings on the same day make one row';
  assert s.effective_from = (now() at time zone 'America/Chicago')::date, 'targets start today, Chicago time';
  assert (s.calorie_target, s.protein_g, s.carbs_g, s.fat_g, s.eating_style::text, s.water_goal_ml, s.rest_days)
       = (2000, 180, 170, 67, 'custom', 2957, '{3,7}'::smallint[]), 'saved settings: ' || s::text;
  assert (select count(*) from public.weigh_ins) = 2, 'setup''s 220 lb and the dashboard''s 219 lb';
  assert (select weight_kg from public.weigh_ins order by event_id limit 1) = 99.79, '220 lb logged as a weigh-in';
  assert (select sum(w.ml) from public.live_events e join public.water_log w on w.event_id = e.id) = 473,
         'water: 16 oz live after undoing 32 oz';
  assert (select count(*) from public.live_events where type in ('stack_taken', 'self_care')) = 2, 'stack and date night';
  assert (select completed_at is not null from public.quest_progress where quest_code = 'take_stack'),
         'the stack quest completed';
  assert not exists (select 1 from public.integrations), 'Liftosaur connected, then disconnected';
  assert not exists (select 1 from vault.secrets), 'disconnecting deleted the key';
  assert (select count(*) from public.foods where source = 'off') = 1, 'the scanned bar was saved once';
  assert (select count(*) from public.off_products) = 1, 'with its OFF record';
  assert (select count(*) from public.food_nutrients n join public.foods f on f.id = n.food_id
          where f.source = 'off') = 7, 'energy, macros, fiber, sodium and calcium';
  assert (select grams from public.food_log l join public.foods f on f.id = l.food_id where f.source = 'off') = 55,
         'one bar logged';
  assert (select (sex, birth_date, height_cm, goal_weight_kg) = ('male', date '1981-01-15', 177.8, 83.9)
          from public.profiles), 'profile saved';
end $$;
SQL
echo "database checks passed"
