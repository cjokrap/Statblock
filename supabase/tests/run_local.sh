#!/usr/bin/env bash
# Apply all migrations to a scratch Postgres database and run the tests.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-statblock_test}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f supabase/tests/00_local_supabase_stubs.sql
for f in supabase/migrations/*.sql; do $P -f "$f"; done
$P -f supabase/tests/10_schema_behavior.sql
