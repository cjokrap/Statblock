#!/usr/bin/env bash
# Print the download URL of the newest FoodData Central CSV release of a
# dataset, found by scanning the FDC download page.
# Usage: scripts/usda/latest_url.sh foundation_food|sr_legacy_food|survey_food|branded_food
set -euo pipefail
dataset=${1:?dataset: foundation_food, sr_legacy_food, survey_food or branded_food}
[[ $dataset =~ ^(foundation_food|sr_legacy_food|survey_food|branded_food)$ ]] ||
  { echo "unknown dataset: $dataset" >&2; exit 2; }

base=https://fdc.nal.usda.gov
file=$(for page in download-datasets download-datasets.html; do
         curl -fsSL --retry 3 "$base/$page" || true
       done | grep -oE "FoodData_Central_${dataset}_csv_[0-9]{4}-[0-9]{2}(-[0-9]{2})?\.zip" | sort -uV | tail -n1)
[[ -n $file ]] || { echo "no $dataset CSV release found on the FDC download page" >&2; exit 1; }
echo "$base/fdc-datasets/$file"
