#!/usr/bin/env bash
# Tests for scripts/db/migrate.sh. Runs against an empty database (PGDATABASE)
# that has only the Supabase stubs. Called by run_local.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
unset DATABASE_URL
fail() { echo "FAIL: $1" >&2; exit 1; }
count() { psql -X -At -c "select count(*) from supabase_migrations.schema_migrations"; }
total=$(ls supabase/migrations/*.sql | wc -l)

# Dry run lists every migration and applies none.
out=$(scripts/db/migrate.sh --dry-run)
[[ $(grep -c '^  supabase/migrations/' <<< "$out") -eq $total ]] || fail "dry run should list all $total migrations"
[[ $(count) -eq 0 ]] || fail "dry run applied something"
[[ $(psql -X -At -c "select to_regclass('public.foods') is null") == t ]] || fail "dry run created tables"

# First run applies everything and records it.
scripts/db/migrate.sh > /dev/null
[[ $(count) -eq $total ]] || fail "expected $total history rows"
[[ $(psql -X -At -c "select name from supabase_migrations.schema_migrations where version = '20260922000100'") == foundation ]] ||
  fail "history row should hold the migration name"
[[ $(psql -X -At -c "select count(*) from public.nutrients") -eq 29 ]] || fail "reference data not loaded"

# Second run is a no-op.
[[ $(scripts/db/migrate.sh) == "Database is up to date"* ]] || fail "second run should do nothing"

# A failing migration rolls back entirely and isn't recorded.
bad=supabase/migrations/99990101000000_test_bad.sql
trap 'rm -f "$bad" supabase/migrations/00000101000000_test_old.sql' EXIT
printf 'create table public.test_half_done (id int);\nselect 1/0;\n' > "$bad"
scripts/db/migrate.sh > /dev/null 2>&1 && fail "a failing migration should fail the run"
[[ $(psql -X -At -c "select to_regclass('public.test_half_done') is null") == t ]] || fail "failed migration left changes"
[[ $(count) -eq $total ]] || fail "failed migration was recorded"
rm -f "$bad"

# A new migration older than the latest applied one is refused.
echo 'select 1;' > supabase/migrations/00000101000000_test_old.sql
scripts/db/migrate.sh > /dev/null 2>&1 && fail "an out-of-order migration should be refused"
rm -f supabase/migrations/00000101000000_test_old.sql

# A database built by hand (tables, no history) is refused until baselined.
psql -X -q -c "truncate supabase_migrations.schema_migrations"
out=$(scripts/db/migrate.sh 2>&1) && fail "tables without history should be refused"
[[ $out == *"--baseline"* ]] || fail "refusal should point to --baseline"
scripts/db/migrate.sh --baseline > /dev/null
[[ $(count) -eq $total ]] || fail "baseline should record every migration"
[[ $(scripts/db/migrate.sh) == "Database is up to date"* ]] || fail "baselined database should be up to date"
scripts/db/migrate.sh --baseline > /dev/null 2>&1 && fail "baseline should refuse when history exists"

# Baseline refuses an empty database.
psql -X -q -c "truncate supabase_migrations.schema_migrations" -c "drop schema public cascade" -c "create schema public"
scripts/db/migrate.sh --baseline > /dev/null 2>&1 && fail "baseline should refuse an empty database"

echo "all migrate tests passed"
