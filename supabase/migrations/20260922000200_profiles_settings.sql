-- Statblock: profiles and per-user settings
--
-- Targets are effective-dated: a change inserts a new user_settings row with
-- effective_from = the day it starts. Past days are always scored against the
-- row that was in force on that day (see settings_for()).

create table public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  display_name   text,
  character_name text,
  title          text,                       -- earned title shown under the name
  portrait_path  text,                       -- object path in the 'portraits' bucket
  sex            public.sex,                 -- for calorie and DRI estimates only
  birth_date     date,
  height_cm      numeric(5,1) check (height_cm between 50 and 275),
  goal_weight_kg numeric(5,1) check (goal_weight_kg between 25 and 350),
  timezone       text not null default 'America/Chicago',
  weight_unit    public.weight_unit not null default 'lb',
  water_unit     public.volume_unit not null default 'oz',
  onboarded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create table public.user_settings (
  id                      bigint generated always as identity primary key,
  user_id                 uuid not null references auth.users (id) on delete cascade,
  effective_from          date not null,
  calorie_target          integer not null check (calorie_target between 800 and 8000),
  calorie_window_pct      numeric(4,1) not null default 10 check (calorie_window_pct between 1 and 50),
  eating_style            public.eating_style not null default 'balanced',
  protein_g               integer not null check (protein_g between 0 and 600),
  carbs_g                 integer not null check (carbs_g between 0 and 1000),
  fat_g                   integer not null check (fat_g between 0 and 400),
  carbs_are_ceiling       boolean not null default false,  -- low carb / keto
  count_net_carbs         boolean not null default false,  -- total minus fiber
  water_goal_ml           integer not null check (water_goal_ml between 0 and 10000),
  training_days_per_week  smallint not null default 4 check (training_days_per_week between 0 and 7),
  rest_days               smallint[] not null default '{}',  -- ISO weekday 1=Mon..7=Sun
  created_at              timestamptz not null default now(),
  unique (user_id, effective_from),
  check (rest_days <@ array[1,2,3,4,5,6,7]::smallint[])
);

create index user_settings_lookup on public.user_settings (user_id, effective_from desc);

-- The settings row in force for a user on a given day.
create or replace function public.settings_for(p_user_id uuid, p_day date)
returns public.user_settings
language sql
stable
as $$
  select s.*
  from public.user_settings s
  where s.user_id = p_user_id
    and s.effective_from <= p_day
  order by s.effective_from desc
  limit 1
$$;

-- Micronutrient target overrides. Defaults come from dri_targets (by age and
-- sex); a row here replaces the default for that nutrient from effective_from on.
-- (nutrients table is created in the foods migration; FK added there.)
create table public.user_nutrient_targets (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  nutrient_id    smallint not null,
  effective_from date not null,
  amount         numeric(10,3) not null check (amount >= 0),
  unique (user_id, nutrient_id, effective_from)
);
