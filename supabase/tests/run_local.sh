#!/usr/bin/env bash
# Apply all migrations to scratch Postgres databases and run the tests.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-statblock_test}

# Create database $1 with the Supabase stubs and every migration applied.
fresh_db() {
  psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $1" -c "create database $1"
  psql -v ON_ERROR_STOP=1 -q -d "$1" -f supabase/tests/00_local_supabase_stubs.sql
  PGDATABASE="$1" scripts/db/migrate.sh > /dev/null
}

fresh_db "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/10_schema_behavior.sql

fresh_db "${DB}_usda"
PGDATABASE="${DB}_usda" supabase/tests/20_usda_loader.sh

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB}_migrate" -c "create database ${DB}_migrate"
psql -v ON_ERROR_STOP=1 -q -d "${DB}_migrate" -f supabase/tests/00_local_supabase_stubs.sql
PGDATABASE="${DB}_migrate" supabase/tests/30_migrate.sh
