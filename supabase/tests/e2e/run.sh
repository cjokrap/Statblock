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
pids=()
trap 'for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done' EXIT

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

# PostgREST + gateway
cat > "$work/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:auth@${PGHOST:-localhost}:${PGPORT:-5432}/$E2E_DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "e2e-secret-e2e-secret-e2e-secret-0123"
server-host = "127.0.0.1"
server-port = 3001
CONF
"$work/postgrest" "$work/postgrest.conf" > "$work/postgrest.log" 2>&1 & pids+=($!)
python3 supabase/tests/e2e/gateway.py > "$work/gateway.log" 2>&1 & pids+=($!)
for _ in $(seq 50); do grep -q "anon key" "$work/gateway.log" 2>/dev/null && break; sleep 0.2; done
anon=$(head -1 "$work/gateway.log" | cut -d' ' -f3)

# The app, built against the stand-in (NEXT_PUBLIC_* are inlined at build).
cd web
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon
npx next build > "$work/build.log" 2>&1
npx next start -p 3457 > "$work/next.log" 2>&1 & pids+=($!)
for _ in $(seq 50); do curl -fs -o /dev/null http://localhost:3457/login && break; sleep 0.2; done

# Browser flow
cd "$work"
[[ -d node_modules/playwright-core ]] || npm i --no-save --no-audit --no-fund playwright-core > /dev/null 2>&1
cp "$root/supabase/tests/e2e/flow.mjs" .
node flow.mjs "$shots"
