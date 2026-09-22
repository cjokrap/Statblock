-- Statblock: nutrients, foods and supplements
--
-- Food data sources and their licensing (see design doc):
--   usda_*  USDA FoodData Central, public domain. Bulk-loaded, then upserted.
--   custom  a user's own food.
--   Open Food Facts rows live in their own table (off_products) because the
--   ODbL share-alike terms apply to databases built from them.
--   FatSecret results are NOT stored: caching is not part of the free Basic
--   tier. Revisit if the app moves to a plan that permits it.

-- ---------------------------------------------------------------------------
-- Nutrients and recommended intakes
-- ---------------------------------------------------------------------------
create table public.nutrients (
  id               smallint primary key,
  usda_nutrient_id integer unique,          -- FoodData Central nutrient.id
  code             text not null unique,    -- stable app code, e.g. 'protein'
  name             text not null,
  unit             text not null,           -- 'kcal', 'g', 'mg', 'mcg'
  category         text not null check (category in ('energy', 'macro', 'vitamin', 'mineral', 'other')),
  counts_for_int   boolean not null default false,  -- scored for the INT stat
  display_order    smallint not null default 0
);

alter table public.user_nutrient_targets
  add constraint user_nutrient_targets_nutrient_fk
  foreign key (nutrient_id) references public.nutrients (id);

-- National Academies Dietary Reference Intakes (RDA or AI) by sex and age band.
create table public.dri_targets (
  nutrient_id smallint not null references public.nutrients (id),
  sex         public.sex not null,
  age_min     smallint not null,
  age_max     smallint not null,   -- inclusive; 200 = no upper bound
  amount      numeric(10,3) not null,
  kind        text not null check (kind in ('RDA', 'AI')),
  primary key (nutrient_id, sex, age_min)
);

-- ---------------------------------------------------------------------------
-- Foods
-- ---------------------------------------------------------------------------
create table public.foods (
  id              bigint generated always as identity primary key,
  source          text not null check (source in
                    ('usda_foundation', 'usda_sr_legacy', 'usda_survey', 'usda_branded', 'custom')),
  source_id       text,                       -- fdc_id for USDA rows
  owner_user_id   uuid references auth.users (id) on delete cascade,  -- custom foods only
  name            text not null,
  brand           text,
  barcode         text,                       -- GTIN/UPC for branded foods
  -- Denormalized per-100 g macros for fast search results and logging.
  kcal_100g       numeric(7,2),
  protein_100g    numeric(6,2),
  carbs_100g      numeric(6,2),
  fat_100g        numeric(6,2),
  fiber_100g      numeric(6,2),
  -- 1 = whole food (Foundation, SR Legacy), 2 = generic dish (Survey),
  -- 3 = branded. Custom foods rank above all of them for their owner.
  source_rank     smallint generated always as (
                    case source
                      when 'custom' then 0
                      when 'usda_foundation' then 1
                      when 'usda_sr_legacy' then 1
                      when 'usda_survey' then 2
                      else 3
                    end) stored,
  search_tsv      tsvector generated always as (
                    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(brand, ''))) stored,
  source_updated_at timestamptz,             -- publication date from the source, for upserts
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, source_id),
  check ((source = 'custom') = (owner_user_id is not null)),
  check (source = 'custom' or source_id is not null)
);

create trigger foods_touch before update on public.foods
  for each row execute function public.touch_updated_at();

create index foods_search_tsv on public.foods using gin (search_tsv);
create index foods_name_trgm on public.foods using gin (name gin_trgm_ops);
create index foods_barcode on public.foods (barcode) where barcode is not null;
create index foods_owner on public.foods (owner_user_id) where owner_user_id is not null;

-- Full nutrient profile per 100 g (USDA's own shape).
create table public.food_nutrients (
  food_id     bigint not null references public.foods (id) on delete cascade,
  nutrient_id smallint not null references public.nutrients (id),
  amount_100g numeric(12,4) not null,
  primary key (food_id, nutrient_id)
);

-- Household portions ("1 large egg" = 50 g).
create table public.food_portions (
  id        bigint generated always as identity primary key,
  food_id   bigint not null references public.foods (id) on delete cascade,
  label     text not null,
  grams     numeric(8,2) not null check (grams > 0),
  sort      smallint not null default 0
);

create index food_portions_food on public.food_portions (food_id);

-- Open Food Facts products, kept apart from foods for ODbL reasons.
create table public.off_products (
  barcode        text primary key,
  name           text,
  brand          text,
  kcal_100g      numeric(7,2),
  protein_100g   numeric(6,2),
  carbs_100g     numeric(6,2),
  fat_100g       numeric(6,2),
  fiber_100g     numeric(6,2),
  raw            jsonb,                     -- original product JSON
  fetched_at     timestamptz not null default now()
);

-- Food search, whole foods first. Runs as the caller, so RLS hides other
-- users' custom foods.
create or replace function public.search_foods(p_query text, p_limit integer default 25)
returns setof public.foods
language sql
stable
as $$
  select f.*
  from public.foods f
  where f.search_tsv @@ websearch_to_tsquery('english', p_query)
     or f.name % p_query
  order by f.source_rank,
           ts_rank(f.search_tsv, websearch_to_tsquery('english', p_query)) desc,
           similarity(f.name, p_query) desc,
           f.name
  limit greatest(1, least(p_limit, 100))
$$;

-- ---------------------------------------------------------------------------
-- Supplements (NIH Dietary Supplement Label Database, CC0) and the daily stack
-- ---------------------------------------------------------------------------
create table public.supplements (
  id            bigint generated always as identity primary key,
  source        text not null check (source in ('dsld', 'custom')),
  source_id     text,                        -- DSLD label id
  owner_user_id uuid references auth.users (id) on delete cascade,
  name          text not null,
  brand         text,
  serving_label text not null default '1 serving',
  created_at    timestamptz not null default now(),
  unique (source, source_id),
  check ((source = 'custom') = (owner_user_id is not null))
);

create table public.supplement_nutrients (
  supplement_id bigint not null references public.supplements (id) on delete cascade,
  nutrient_id   smallint not null references public.nutrients (id),
  amount_per_serving numeric(12,4) not null,
  primary key (supplement_id, nutrient_id)
);

create table public.daily_stack_items (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  supplement_id bigint not null references public.supplements (id),
  servings      numeric(4,2) not null default 1 check (servings > 0),
  sort          smallint not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (user_id, supplement_id)
);
