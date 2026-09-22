#!/usr/bin/env bash
# Apply pending migrations in supabase/migrations, oldest first.
#
# Usage: scripts/db/migrate.sh [--dry-run | --baseline]
#   --dry-run   list pending migrations without applying them
#   --baseline  record every migration as applied without running it, for a
#               database that was built by hand (SQL Editor) before this
#               script kept history. Only allowed while history is empty.
#
# Each migration runs in its own transaction together with its history row,
# so a failure leaves the database as it was before that file. History lives
# in supabase_migrations.schema_migrations, the table the Supabase CLI uses,
# so `supabase db push` and `supabase migration list` agree with this script.
#
# Connects with DATABASE_URL if set, otherwise the usual PG* variables.
set -euo pipefail
cd "$(dirname "$0")/../.."

dry_run=false baseline=false
case ${1:-} in
  --dry-run) dry_run=true ;;
  --baseline) baseline=true ;;
  "") ;;
  *) sed -n '2,15p' "$0" >&2; exit 2 ;;
esac

psql=(psql -X -q -v ON_ERROR_STOP=1)
[[ -n ${DATABASE_URL:-} ]] && psql+=("$DATABASE_URL")

"${psql[@]}" <<'SQL'
set client_min_messages = warning;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[],
  name       text
);
SQL

applied=$("${psql[@]}" -At -c "select version from supabase_migrations.schema_migrations order by version")
public_tables=$("${psql[@]}" -At -c "select count(*) from pg_tables where schemaname = 'public'")

if $baseline; then
  if [[ -n $applied ]]; then
    echo "error: migration history already has entries; --baseline is only for a database with none." >&2
    exit 1
  fi
  if [[ $public_tables -eq 0 ]]; then
    echo "error: the database has no tables, so there is nothing to baseline. Run without --baseline." >&2
    exit 1
  fi
  echo "Recording as applied (not running them):"
  for f in supabase/migrations/*.sql; do
    file=$(basename "$f" .sql)
    echo "  $file"
    "${psql[@]}" -v version="${file%%_*}" -v name="${file#*_}" \
      <<< "insert into supabase_migrations.schema_migrations (version, name) values (:'version', :'name');"
  done
  exit 0
fi

# Tables but no history means the schema was built some other way. Running
# every migration again would fail, so stop and explain.
if [[ -z $applied && $public_tables -gt 0 ]]; then
  echo "error: the database already has tables but no migration history." >&2
  echo "If it was built by running these migrations by hand, record them once with --baseline" >&2
  echo "(the workflow's \"baseline\" option). See docs/database.md." >&2
  exit 1
fi
latest=$(tail -n1 <<< "$applied")

pending=()
for f in supabase/migrations/*.sql; do
  version=$(basename "$f" | cut -d_ -f1)
  grep -qx "$version" <<< "$applied" && continue
  if [[ -n $latest && $version < $latest ]]; then
    echo "error: $f is older than the latest applied migration ($latest)." >&2
    echo "Rename it with a newer timestamp so it runs after what's already applied." >&2
    exit 1
  fi
  pending+=("$f")
done

if [[ ${#pending[@]} -eq 0 ]]; then
  echo "Database is up to date ($(grep -c . <<< "$applied") migrations applied)."
  exit 0
fi

echo "Pending migrations:"
printf '  %s\n' "${pending[@]}"
$dry_run && { echo "Dry run: nothing applied."; exit 0; }

for f in "${pending[@]}"; do
  file=$(basename "$f" .sql)
  echo "applying $file"
  "${psql[@]}" -v version="${file%%_*}" -v name="${file#*_}" -v file="$f" -f - <<'SQL'
begin;
\i :file
insert into supabase_migrations.schema_migrations (version, name) values (:'version', :'name');
commit;
SQL
done
echo "Applied ${#pending[@]} migration(s)."
