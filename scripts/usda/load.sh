#!/usr/bin/env bash
# Load a USDA FoodData Central CSV release into foods, food_nutrients and
# food_portions (upsert keyed on source + fdc_id). See docs/usda-loader.md.
#
# Usage: scripts/usda/load.sh [--partial] [--force] [--release NAME] SOURCE
#   SOURCE     a release .zip, its URL, or an unzipped release directory
#   --partial  the data is not a whole release: don't retire missing foods
#   --force    reload even if this release was loaded before, rewrite every
#              food, and skip the guard against retiring over half a source
#   --release  name recorded in usda.load_runs (default: the zip/dir name)
#
# Connects with DATABASE_URL if set, otherwise the usual PG* variables.
# Needs psql, python3, and curl/unzip for zips and URLs.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
full=true force=false release="" src=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --partial) full=false ;;
    --force) force=true ;;
    --release) release=$2; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) src=$1 ;;
  esac
  shift
done
[[ -n $src ]] || { sed -n '2,15p' "$0" >&2; exit 2; }

work=${USDA_WORK_DIR:-data/raw/usda}
mkdir -p "$work"

if [[ $src =~ ^https?:// ]]; then
  zip="$work/$(basename "$src")"
  if [[ ! -s $zip ]]; then
    echo "downloading $src" >&2
    curl -fL --retry 3 -o "$zip.part" "$src" && mv "$zip.part" "$zip"
  fi
  src=$zip
fi

name=$(basename "$src" .zip)
release=${release:-$name}

if [[ -f $src ]]; then
  dir="$work/$name"
  if [[ ! -d $dir ]]; then
    echo "unzipping $src" >&2
    unzip -q -o "$src" -d "$dir.part" && mv "$dir.part" "$dir"
  fi
else
  dir=$src
fi
food_csv=$(find "$dir" -name food.csv -print -quit)
[[ -n $food_csv ]] || { echo "no food.csv under $dir" >&2; exit 1; }
csv_dir=$(dirname "$food_csv")

psql=(psql -X -q -v ON_ERROR_STOP=1)
[[ -n ${DATABASE_URL:-} ]] && psql+=("$DATABASE_URL")

if [[ $force == false ]] &&
   [[ $("${psql[@]}" -At -v r="$release" <<< "select exists (select 1 from usda.load_runs where release = :'r')") == t ]]; then
  echo "$release already loaded; nothing to do (use --force to reload)" >&2
  exit 0
fi

nutrients=$("${psql[@]}" -At -c "select string_agg(usda_nutrient_id::text, ',') from usda.nutrient_sources")

echo "preparing $csv_dir" >&2
staged="$work/$name.staged"
manifest=$(python3 "$here/prepare.py" "$csv_dir" "$staged" --nutrients "$nutrients")

sql="$staged/load.sql"
{
  echo "truncate usda.stage_food, usda.stage_food_nutrient, usda.stage_food_portion, usda.stage_measure_unit, usda.stage_branded_food;"
  while IFS=$'\t' read -r table cols path; do
    echo "\\copy $table ($cols) from '${path//\'/\'\'}' with (format csv, header true)"
  done <<< "$manifest"
  echo "\\pset footer off"
  echo "select * from usda.merge_staged(:'release', :full, :force);"
} > "$sql"

echo "merging $release (full release: $full)" >&2
"${psql[@]}" -1 -v release="$release" -v full="$full" -v force="$force" -f "$sql"
rm -rf "$staged"
