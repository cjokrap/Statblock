#!/usr/bin/env bash
# Apply pending migrations in supabase/migrations, oldest first.
#
# Usage: scripts/db/migrate.sh [--dry-run]
#   --dry-run  list pending migrations without applying them
#
# Each migration runs in its own transaction together with its history row,
# so a failure leaves the database as it was before that file. History lives
# in supabase_migrations.schema_migrations, the table the Supabase CLI uses,
# so `supabase db push` and `supabase migration list` agree with this script.
#
# Connects with DATABASE_URL if set, otherwise the usual PG* variables.
set -euo pipefail
cd "$(dirname "$0")/../.."

dry_run=false
case ${1:-} in
  --dry-run) dry_run=true ;;
  "") ;;
  *) sed -n '2,12p' "$0" >&2; exit 2 ;;
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
