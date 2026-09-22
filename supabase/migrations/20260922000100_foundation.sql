-- Statblock: foundation
-- Extensions, shared enums and helper functions used by later migrations.
-- Conventions:
--   * Canonical units in storage: grams, milliliters, kilograms, kcal.
--     Display units (lb, oz) are a per-user setting and converted in the app.
--   * Every user-owned row carries user_id and is protected by RLS.
--   * "local_date" is the user's calendar day (their time zone), which is what
--     quests, streaks and stats are scored on.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.sex as enum ('male', 'female');

create type public.eating_style as enum
  ('balanced', 'high_protein', 'low_carb', 'keto', 'low_fat', 'custom');

create type public.weight_unit as enum ('lb', 'kg');
create type public.volume_unit as enum ('oz', 'ml');

create type public.meal as enum ('breakfast', 'lunch', 'dinner', 'snack');

create type public.event_type as enum (
  'food',            -- a food entry (detail: food_log)
  'water',           -- water intake (detail: water_log)
  'stack_taken',     -- daily supplement stack logged (no detail row)
  'weigh_in',        -- body weight (detail: weigh_ins)
  'workout_session', -- a lifting session header (detail: workout_sessions)
  'workout_set',     -- one set (detail: workout_sets)
  'activity',        -- non-lifting activity (detail: activities)
  'skip',            -- scheduled training day skipped (detail: skips)
  'self_care',       -- CHA quick log (detail: self_care_log)
  'void'             -- cancels an earlier event (payload.target_event_id)
);

create type public.event_source as enum ('app', 'liftosaur', 'import');

create type public.skip_reason as enum ('injury', 'sick', 'skipped');

create type public.track_kind as enum ('class', 'job');

create type public.ability as enum ('str', 'dex', 'con', 'int', 'wis', 'cha');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Unit conversions kept in the database so SQL reports and the app agree.
create or replace function public.oz_to_ml(oz numeric)
returns numeric language sql immutable as $$ select oz * 29.5735295625 $$;

create or replace function public.ml_to_oz(ml numeric)
returns numeric language sql immutable as $$ select ml / 29.5735295625 $$;

create or replace function public.lb_to_kg(lb numeric)
returns numeric language sql immutable as $$ select lb * 0.45359237 $$;

create or replace function public.kg_to_lb(kg numeric)
returns numeric language sql immutable as $$ select kg / 0.45359237 $$;
