#!/usr/bin/env bash
# USDA loader tests: loads the fixture releases in supabase/tests/fixtures/usda
# into a freshly migrated database (PGDATABASE) and checks the results.
# Called by run_local.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
fx=supabase/tests/fixtures/usda
export USDA_WORK_DIR=$(mktemp -d)
trap 'rm -rf "$USDA_WORK_DIR"' EXIT
unset DATABASE_URL
load() { scripts/usda/load.sh "$@" > /dev/null 2>&1 || { scripts/usda/load.sh "$@"; return 1; }; }
check() { psql -X -q -v ON_ERROR_STOP=1 -c "do \$\$ begin $1 end \$\$"; }

load $fx/FoodData_Central_foundation_food_csv_2026-04-30
load $fx/FoodData_Central_sr_legacy_food_csv_2018-04
load $fx/FoodData_Central_survey_food_csv_2026-10-31
load $fx/FoodData_Central_branded_food_csv_2026-08-29

check "
  assert (select count(*) from public.foods) = 9, 'nine foods loaded (sub sample and no-energy food skipped)';
  assert not exists (select 1 from public.foods where source_id in ('2512381', '321358')), 'skipped foods absent';
  assert (select kcal_100g from public.foods where source_id = '748967') = 143, '1008 energy preferred over Atwater';
  assert (select kcal_100g from public.foods where source_id = '2346393') = 34, 'Atwater specific energy when 1008 missing';
  assert (select fat_100g from public.foods where source_id = '748967') = 9.96, 'NLEA fat fills in for 1004';
  assert (select carbs_100g from public.foods where source_id = '748967') = 0.96, 'carbs by summation fill in for 1005';
  assert (select fiber_100g from public.foods where source_id = '748967') is null, 'blank amount dropped';
  assert (select source from public.foods where source_id = '2705385') = 'usda_survey', 'survey source';
  assert (select source_updated_at::date from public.foods where source_id = '748967') = '2019-12-16', 'publication date kept';
  assert (select count(*) from public.food_nutrients fn join public.foods f on f.id = fn.food_id
          where f.source_id = '748967') = 6, 'egg: energy, protein, fat, carbs, calcium, iron';
  assert (select amount_100g from public.food_nutrients fn join public.foods f on f.id = fn.food_id
          join public.nutrients n on n.id = fn.nutrient_id
          where f.source_id = '2346393' and n.code = 'vitamin_c') = 91.3, 'broccoli vitamin C';
"
check "
  assert (select string_agg(label || '=' || grams, '; ' order by sort) from public.food_portions p
          join public.foods f on f.id = p.food_id where f.source_id = '748967') = '1 large=50.30; 1 cup=243.00',
         'foundation portions built from amount, unit and modifier';
  assert (select string_agg(label, '; ' order by sort) from public.food_portions p
          join public.foods f on f.id = p.food_id where f.source_id = '2346393') = '1 cup chopped',
         'zero-gram portion dropped';
  assert (select string_agg(label, '; ' order by sort) from public.food_portions p
          join public.foods f on f.id = p.food_id where f.source_id = '171287') = '1 large; 1 cup (4.86 large eggs)',
         'SR Legacy portions';
  assert (select string_agg(label, '; ' order by sort) from public.food_portions p
          join public.foods f on f.id = p.food_id where f.source_id = '2705385') = '1 cup',
         'survey portion description used, quantity-not-specified dropped';
"
check "
  assert (select brand from public.foods where source_id = '2000001') = 'Example Dairy Co.', 'brand owner when no brand name';
  assert (select brand from public.foods where source_id = '2000002') = 'BarCo', 'brand name preferred';
  assert (select barcode from public.foods where source_id = '2000002') = '00987654321098', 'barcode kept';
  assert (select fat_100g from public.foods where source_id = '2000002') is null, 'implausible label fat dropped';
  assert (select label || '=' || grams from public.food_portions p join public.foods f on f.id = p.food_id
          where f.source_id = '2000002') = '1 bar (60 g)=60.00', 'branded serving in GRM';
  assert (select label from public.food_portions p join public.foods f on f.id = p.food_id
          where f.source_id = '2000004') = '28 g', 'branded serving without household text';
  assert not exists (select 1 from public.food_portions p join public.foods f on f.id = p.food_id
                     where f.source_id = '2000003'), 'no portion for a mL serving';
  assert (select count(*) from usda.load_runs) = 4, 'four runs recorded';
  assert not exists (select 1 from usda.stage_food_nutrient), 'staging emptied';
"

# A user logs the chips before the next release drops them.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, email) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
select public.log_food((select id from public.foods where source_id = '2000004'), 28, 'snack', '2026-09-20 20:00-05');
SQL
before=$(psql -X -At -c "select updated_at from public.foods where source_id = '2000001'")

load $fx/FoodData_Central_branded_food_csv_2026-09-26

check "
  assert (select updated_at::text from public.foods where source_id = '2000001') = '$before', 'unchanged food not rewritten';
  assert (select retired_at from public.foods where source_id = '2000002') is not null, 'revised bar: old fdc_id retired';
  assert (select retired_at from public.foods where source_id = '2000004') is not null, 'dropped chips retired';
  assert (select protein_100g from public.foods where source_id = '2000102' and retired_at is null) = 35, 'revised bar loaded';
  assert (select name from public.foods where source_id = '2000003') = 'COLD BREW COFFEE, BLACK', 'coffee updated in place';
  assert (select kcal_100g from public.foods where source_id = '2000003') = 3, 'coffee energy updated';
  assert (select count(*) from public.food_nutrients fn join public.foods f on f.id = fn.food_id
          where f.source_id = '2000003') = 1, 'old nutrient rows replaced';
  assert (select count(*) from public.food_log l join public.foods f on f.id = l.food_id
          where f.source_id = '2000004') = 1, 'food log still points at the retired food';
  assert (select count(*) from public.foods where source <> 'usda_branded' and retired_at is not null) = 0,
         'other sources untouched';
  assert (select counts from usda.load_runs order by id desc limit 1)
         = '[{\"source\": \"usda_branded\", \"staged\": 4, \"skipped_no_energy\": 0, \"inserted\": 2, \"updated\": 1, \"unchanged\": 1, \"retired\": 2}]',
         'run counts recorded';
"

# Search: whole foods first, retired foods hidden.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
do $$ begin
  assert (select source from public.search_foods('egg') limit 1) in ('usda_foundation', 'usda_sr_legacy'),
         'whole foods rank first';
  assert not exists (select 1 from public.search_foods('kettle chips')), 'retired food hidden from search';
  assert (select count(*) from public.search_foods('protein bar')) = 1, 'only the current bar is found';
end $$;
SQL

# Re-running a loaded release is a no-op.
[[ $(scripts/usda/load.sh $fx/FoodData_Central_branded_food_csv_2026-09-26 2>&1) == *"already loaded"* ]] ||
  { echo "FAIL: reloading a release should be skipped" >&2; exit 1; }

# A truncated release refuses to retire most of a source...
if scripts/usda/load.sh $fx/FoodData_Central_branded_food_csv_2026-10-01_truncated > /dev/null 2>&1; then
  echo "FAIL: truncated release should be refused" >&2; exit 1
fi
check "
  assert (select count(*) from public.foods where source = 'usda_branded' and retired_at is null) = 4,
         'refused load changed nothing';
  assert (select count(*) from usda.load_runs) = 5, 'refused load not recorded';
"
# ...but loads as a partial update.
load --partial $fx/FoodData_Central_branded_food_csv_2026-10-01_truncated
check "
  assert (select kcal_100g from public.foods where source_id = '2000001') = 60, 'partial update applied';
  assert (select brand from public.foods where source_id = '2000001') = 'Example Dairy Co.', 'brand kept';
  assert (select count(*) from public.foods where source = 'usda_branded' and retired_at is null) = 4,
         'partial update retires nothing';
"

# A branded release without branded_food.csv is rejected.
mkdir -p "$USDA_WORK_DIR/no_branded"
cp $fx/FoodData_Central_branded_food_csv_2026-09-26/food*.csv "$USDA_WORK_DIR/no_branded/"
if scripts/usda/load.sh --partial "$USDA_WORK_DIR/no_branded" > /dev/null 2>&1; then
  echo "FAIL: branded release without branded_food.csv should be rejected" >&2; exit 1
fi

# Survey files that use legacy nutrient numbers and decimal ids still load.
load $fx/FoodData_Central_survey_food_csv_2026-11-30_nutrient_numbers
check "
  assert (select kcal_100g from public.foods where source_id = '2705385') = 71, 'nutrient numbers mapped to ids';
  assert (select protein_100g from public.foods where source_id = '2705385') = 2.5, 'protein from nutrient number';
"

# A nutrient file with no usable rows stops the load instead of skipping every food.
out=$(scripts/usda/load.sh $fx/FoodData_Central_survey_food_csv_2026-12-31_unreadable 2>&1) &&
  { echo "FAIL: unreadable nutrient file should stop the load" >&2; exit 1; }
[[ $out == *"no usable nutrient rows"* && $out == *"header:"* ]] ||
  { echo "FAIL: unreadable nutrient file should explain itself; got: $out" >&2; exit 1; }
check "
  assert (select kcal_100g from public.foods where source_id = '2705385') = 71, 'stopped load changed nothing';
  assert not exists (select 1 from usda.load_runs where release like '%unreadable'), 'stopped load not recorded';
"

# Clients can't reach the staging schema or the merge.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
set role authenticated;
do $$ begin
  begin
    perform 1 from usda.load_runs;
    assert false, 'usda schema should be private';
  exception when insufficient_privilege then null;
  end;
end $$;
SQL

echo "all USDA loader tests passed"
