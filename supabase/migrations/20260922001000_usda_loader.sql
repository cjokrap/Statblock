-- Statblock: USDA FoodData Central loader (staging + merge)
--
-- scripts/usda/load.sh projects a FoodData Central CSV release down to the
-- columns below, \copies it into the usda.stage_* tables and calls
-- usda.merge_staged(), all in one transaction. The merge upserts foods keyed
-- on (source, source_id = fdc_id) and replaces the nutrients and portions of
-- every food it inserts or changes.
--
-- FDC gives a food a new fdc_id when it revises it, so a full release also
-- retires foods of the same source that are missing from it. Retired foods
-- stay in the table (old food_log rows point at them) but drop out of search.
--
-- The usda schema is server-only: no grants to anon or authenticated, RLS on
-- with no policies.

create schema usda;

-- ---------------------------------------------------------------------------
-- Retired foods
-- ---------------------------------------------------------------------------
alter table public.foods add column retired_at timestamptz;

create or replace function public.search_foods(p_query text, p_limit integer default 25)
returns setof public.foods
language sql
stable
as $$
  select f.*
  from public.foods f
  where (f.search_tsv @@ websearch_to_tsquery('english', p_query)
         or f.name % p_query)
    and f.retired_at is null
  order by f.source_rank,
           ts_rank(f.search_tsv, websearch_to_tsquery('english', p_query)) desc,
           similarity(f.name, p_query) desc,
           f.name
  limit greatest(1, least(p_limit, 100))
$$;

-- ---------------------------------------------------------------------------
-- Nutrient mapping
-- ---------------------------------------------------------------------------
-- public.nutrients.usda_nutrient_id is the preferred FDC nutrient for each
-- app nutrient. Aliases fill in when a food lacks it; the lowest priority
-- present wins. Foundation Foods often report Atwater energy instead of 1008.
create table usda.nutrient_aliases (
  usda_nutrient_id integer primary key,
  nutrient_id      smallint not null references public.nutrients (id),
  priority         smallint not null check (priority > 1),
  note             text not null
);

insert into usda.nutrient_aliases (usda_nutrient_id, nutrient_id, priority, note)
select a.usda_id, n.id, a.priority, a.note
from (values
  (2048, 'energy', 2, 'Energy (Atwater Specific Factors)'),
  (2047, 'energy', 3, 'Energy (Atwater General Factors)'),
  (1050, 'carbs',  2, 'Carbohydrate, by summation'),
  (1085, 'fat',    2, 'Total fat (NLEA)'),
  (1063, 'sugars', 2, 'Sugars, Total NLEA')
) a (usda_id, code, priority, note)
join public.nutrients n on n.code = a.code;

create view usda.nutrient_sources as
  select usda_nutrient_id, id as nutrient_id, 1::smallint as priority
  from public.nutrients
  where usda_nutrient_id is not null
  union all
  select usda_nutrient_id, nutrient_id, priority
  from usda.nutrient_aliases;

-- ---------------------------------------------------------------------------
-- Staging (emptied at the end of every merge)
-- ---------------------------------------------------------------------------
create unlogged table usda.stage_food (
  fdc_id           integer primary key,
  data_type        text not null,
  description      text not null,
  publication_date date
);

create unlogged table usda.stage_food_nutrient (
  fdc_id           integer not null,
  usda_nutrient_id integer not null,
  amount           numeric not null
);
create index stage_food_nutrient_fdc on usda.stage_food_nutrient (fdc_id);

create unlogged table usda.stage_food_portion (
  fdc_id              integer not null,
  seq_num             integer,
  amount              numeric,
  measure_unit_id     integer,
  portion_description text,
  modifier            text,
  gram_weight         numeric not null
);
create index stage_food_portion_fdc on usda.stage_food_portion (fdc_id);

create unlogged table usda.stage_measure_unit (
  id   integer primary key,
  name text not null
);

create unlogged table usda.stage_branded_food (
  fdc_id                     integer primary key,
  brand_owner                text,
  brand_name                 text,
  gtin_upc                   text,
  serving_size               numeric,
  serving_size_unit          text,
  household_serving_fulltext text
);

-- One row per successful merge. The loader skips releases already listed.
create table usda.load_runs (
  id           bigint generated always as identity primary key,
  release      text not null,
  full_release boolean not null,
  forced       boolean not null,
  counts       jsonb not null,
  loaded_at    timestamptz not null default now()
);
create index load_runs_release on usda.load_runs (release);

alter table usda.nutrient_aliases    enable row level security;
alter table usda.stage_food          enable row level security;
alter table usda.stage_food_nutrient enable row level security;
alter table usda.stage_food_portion  enable row level security;
alter table usda.stage_measure_unit  enable row level security;
alter table usda.stage_branded_food  enable row level security;
alter table usda.load_runs           enable row level security;

-- ---------------------------------------------------------------------------
-- Merge
-- ---------------------------------------------------------------------------
-- p_full_release: the staged data is a whole release of each source it
--   contains, so foods of those sources missing from it are retired.
-- p_force: rewrite every staged food even if its publication date is
--   unchanged (use after changing the mapping), and skip the guard that
--   refuses to retire more than half of a source's active foods.
create or replace function usda.merge_staged(
  p_release text, p_full_release boolean default true, p_force boolean default false)
returns table (source text, staged integer, skipped_no_energy integer,
               inserted integer, updated integer, unchanged integer, retired integer)
language plpgsql
set client_min_messages = warning
as $$
#variable_conflict use_column
declare
  r record;
begin
  drop table if exists _src, _nut, _food, _changed, _retired, _result;

  -- Foods of the four datasets the app uses, with branded details.
  create temp table _src as
  select f.fdc_id,
         m.source,
         f.description,
         f.publication_date,
         coalesce(nullif(btrim(b.brand_name), ''), nullif(btrim(b.brand_owner), '')) as brand,
         nullif(regexp_replace(coalesce(b.gtin_upc, ''), '\D', '', 'g'), '') as barcode,
         b.serving_size, lower(b.serving_size_unit) as serving_size_unit,
         nullif(btrim(b.household_serving_fulltext), '') as household
  from usda.stage_food f
  join (values ('foundation_food', 'usda_foundation'),
               ('sr_legacy_food', 'usda_sr_legacy'),
               ('survey_fndds_food', 'usda_survey'),
               ('branded_food', 'usda_branded')) m (data_type, source)
    on m.data_type = f.data_type
  left join usda.stage_branded_food b on b.fdc_id = f.fdc_id;

  -- One amount per food and app nutrient: the best-priority FDC nutrient
  -- with a plausible per-100 g value. Branded label data has typos.
  create temp table _nut as
  select distinct on (s.fdc_id, ns.nutrient_id)
         s.fdc_id, ns.nutrient_id, round(s.amount, 4) as amount
  from usda.stage_food_nutrient s
  join usda.nutrient_sources ns on ns.usda_nutrient_id = s.usda_nutrient_id
  join public.nutrients n on n.id = ns.nutrient_id
  where s.amount >= 0 and s.amount < 1e8
    and (n.unit <> 'g' or s.amount <= 100)
    and (n.unit <> 'kcal' or s.amount <= 1000)
    and s.fdc_id in (select fdc_id from _src)
  order by s.fdc_id, ns.nutrient_id, ns.priority;
  create index on _nut (fdc_id);

  create temp table _food as
  select s.*,
         max(u.amount) filter (where n.code = 'energy')  as kcal,
         max(u.amount) filter (where n.code = 'protein') as protein,
         max(u.amount) filter (where n.code = 'carbs')   as carbs,
         max(u.amount) filter (where n.code = 'fat')     as fat,
         max(u.amount) filter (where n.code = 'fiber')   as fiber
  from _src s
  left join _nut u on u.fdc_id = s.fdc_id
  left join public.nutrients n on n.id = u.nutrient_id
  group by s.fdc_id, s.source, s.description, s.publication_date, s.brand, s.barcode,
           s.serving_size, s.serving_size_unit, s.household;

  -- A food with no energy value can't be scored against the calorie window.
  delete from _food where kcal is null;

  -- Guard against a truncated download retiring most of a source.
  if p_full_release and not p_force then
    for r in
      select s.source, count(*) filter (where f.kcal is not null) as n_staged,
             (select count(*) from public.foods x
              where x.source = s.source and x.retired_at is null) as n_active
      from (select distinct _src.source from _src) s
      left join _food f on f.source = s.source
      group by s.source
    loop
      if r.n_staged < r.n_active * 0.5 then
        raise exception 'usda.merge_staged: % has % loadable foods but % active; refusing to retire more than half (use --partial or --force)',
          r.source, r.n_staged, r.n_active;
      end if;
    end loop;
  end if;

  create temp table _changed (id bigint primary key, source text, fdc_id integer, inserted boolean);

  with up as (
    insert into public.foods as f
      (source, source_id, name, brand, barcode,
       kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, source_updated_at)
    select source, fdc_id::text, description, brand, barcode,
           round(kcal, 2), round(protein, 2), round(carbs, 2), round(fat, 2), round(fiber, 2),
           publication_date::timestamptz
    from _food
    on conflict on constraint foods_source_source_id_key do update set
      name = excluded.name,
      brand = excluded.brand,
      barcode = excluded.barcode,
      kcal_100g = excluded.kcal_100g,
      protein_100g = excluded.protein_100g,
      carbs_100g = excluded.carbs_100g,
      fat_100g = excluded.fat_100g,
      fiber_100g = excluded.fiber_100g,
      source_updated_at = excluded.source_updated_at,
      retired_at = null
    where p_force
       or f.retired_at is not null
       or f.source_updated_at is distinct from excluded.source_updated_at
    returning f.id, f.source, f.source_id::integer, (f.xmax = 0)
  )
  insert into _changed select * from up;

  delete from public.food_nutrients where food_id in (select id from _changed);
  delete from public.food_portions  where food_id in (select id from _changed);

  insert into public.food_nutrients (food_id, nutrient_id, amount_100g)
  select c.id, u.nutrient_id, u.amount
  from _changed c
  join _nut u on u.fdc_id = c.fdc_id;

  -- Portions. Survey foods describe the portion in portion_description;
  -- Foundation and SR Legacy build it from amount, unit and modifier
  -- ("1 cup chopped", "1 large"). Branded foods get their label serving
  -- when it's in grams (a volume serving has no density to convert).
  insert into public.food_portions (food_id, label, grams, sort)
  select id, label, grams, (row_number() over (partition by id order by sort, label))::smallint - 1
  from (
    select distinct on (c.id, p.label) c.id, p.label, p.grams, p.sort
    from _changed c
    join (
      select sp.fdc_id,
             left(case
               when nullif(btrim(sp.portion_description), '') is not null
                    and sp.portion_description <> 'Quantity not specified'
                 then btrim(sp.portion_description)
               when sp.portion_description = 'Quantity not specified'
                 then null
               else nullif(btrim(concat_ws(' ',
                      trim_scale(sp.amount)::text,
                      nullif(mu.name, 'undetermined'),
                      nullif(btrim(sp.modifier), ''))), '')
             end, 200) as label,
             round(sp.gram_weight, 2) as grams,
             coalesce(sp.seq_num, 0) as sort
      from usda.stage_food_portion sp
      left join usda.stage_measure_unit mu on mu.id = sp.measure_unit_id
      union all
      select fdc_id,
             left(coalesce(household || ' (' || trim_scale(serving_size) || ' g)',
                           trim_scale(serving_size) || ' g'), 200),
             round(serving_size, 2),
             0
      from _food
      where source = 'usda_branded' and serving_size_unit in ('g', 'grm')
    ) p on p.fdc_id = c.fdc_id
    where p.label is not null
      and p.label !~ '^[0-9.]+$'   -- a bare number with no unit isn't a portion
      and p.grams > 0 and p.grams < 1e6
    order by c.id, p.label, p.sort
  ) x;

  -- Retire foods missing from a full release of their source.
  create temp table _retired (source text, n integer);
  if p_full_release then
    with gone as (
      update public.foods x set retired_at = now()
      where x.source in (select distinct _src.source from _src)
        and x.retired_at is null
        and not exists (select 1 from _food f
                        where f.source = x.source and f.fdc_id::text = x.source_id)
      returning x.source
    )
    insert into _retired select g.source, count(*) from gone g group by g.source;
  end if;

  create temp table _result as
  select s.source,
         count(*)::integer as staged,
         (count(*) - count(f.fdc_id))::integer as skipped_no_energy,
         (select count(*) from _changed c where c.source = s.source and c.inserted)::integer as inserted,
         (select count(*) from _changed c where c.source = s.source and not c.inserted)::integer as updated,
         (count(f.fdc_id) - (select count(*) from _changed c where c.source = s.source))::integer as unchanged,
         coalesce((select t.n from _retired t where t.source = s.source), 0) as retired
  from _src s
  left join _food f on f.fdc_id = s.fdc_id
  group by s.source;

  insert into usda.load_runs (release, full_release, forced, counts)
  select p_release, p_full_release, p_force, coalesce(jsonb_agg(to_jsonb(x) order by x.source), '[]')
  from _result x;

  return query select * from _result x order by x.source;

  truncate usda.stage_food, usda.stage_food_nutrient, usda.stage_food_portion,
           usda.stage_measure_unit, usda.stage_branded_food;
  drop table _src, _nut, _food, _changed, _retired, _result;
end;
$$;

revoke all on function usda.merge_staged(text, boolean, boolean) from public;
