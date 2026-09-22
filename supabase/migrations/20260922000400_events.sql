-- Statblock: the event log
--
-- Everything the user does (or that syncs in from Liftosaur) is an append-only
-- event. Events are never updated or deleted by the app; a correction is a
-- 'void' event pointing at the original, and views exclude voided events.
-- XP, stats and quests are derived from events and can be rebuilt at any time.
--
-- Shape: one header row in events, plus a typed detail row for event types
-- that carry data (food_log, water_log, ...). Detail tables share the event's
-- primary key.

create table public.events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  type         public.event_type not null,
  occurred_at  timestamptz not null default now(),
  local_date   date not null,               -- user's calendar day (set by trigger)
  source       public.event_source not null default 'app',
  source_ref   text,                        -- e.g. Liftosaur workout id + set index
  payload      jsonb not null default '{}', -- small extras; void target lives here
  created_at   timestamptz not null default now()
);

create index events_user_day on public.events (user_id, local_date);
create index events_user_type_day on public.events (user_id, type, local_date);
create unique index events_source_dedupe on public.events (user_id, source, source_ref)
  where source_ref is not null;

-- Fill local_date from the user's time zone when the caller doesn't supply it.
create or replace function public.events_set_local_date()
returns trigger
language plpgsql
as $$
declare
  tz text;
begin
  if new.local_date is null then
    select p.timezone into tz from public.profiles p where p.user_id = new.user_id;
    new.local_date := (new.occurred_at at time zone coalesce(tz, 'UTC'))::date;
  end if;
  return new;
end;
$$;

create trigger events_local_date before insert on public.events
  for each row execute function public.events_set_local_date();

-- A void must point at an earlier event of the same user.
create or replace function public.events_check_void()
returns trigger
language plpgsql
as $$
declare
  target_id bigint;
begin
  if new.type = 'void' then
    target_id := (new.payload ->> 'target_event_id')::bigint;
    if target_id is null or not exists (
      select 1 from public.events e
      where e.id = target_id and e.user_id = new.user_id and e.type <> 'void'
    ) then
      raise exception 'void event must reference an existing event of the same user';
    end if;
  end if;
  return new;
end;
$$;

create trigger events_void_check before insert on public.events
  for each row execute function public.events_check_void();

-- Append-only, even for the service role.
create or replace function public.events_block_changes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'events are append-only; insert a void event instead';
end;
$$;

create trigger events_no_update before update on public.events
  for each row execute function public.events_block_changes();

-- ---------------------------------------------------------------------------
-- Detail tables
-- ---------------------------------------------------------------------------
create table public.food_log (
  event_id  bigint primary key references public.events (id) on delete cascade,
  food_id   bigint not null references public.foods (id),
  grams     numeric(8,2) not null check (grams > 0),
  meal      public.meal not null,
  portion_label text                        -- what the user picked, e.g. '3 large'
);

create index food_log_food on public.food_log (food_id);

create table public.water_log (
  event_id bigint primary key references public.events (id) on delete cascade,
  ml       integer not null check (ml > 0 and ml <= 5000)
);

-- Snapshot of what was in the stack when it was taken, so history stays
-- correct after the stack changes.
create table public.stack_log (
  event_id      bigint not null references public.events (id) on delete cascade,
  supplement_id bigint not null references public.supplements (id),
  servings      numeric(4,2) not null check (servings > 0),
  primary key (event_id, supplement_id)
);

create table public.weigh_ins (
  event_id  bigint primary key references public.events (id) on delete cascade,
  weight_kg numeric(5,2) not null check (weight_kg between 25 and 350)
);

create table public.workout_sessions (
  event_id     bigint primary key references public.events (id) on delete cascade,
  external_id  text,                        -- Liftosaur history record id
  program      text,
  day_name     text,
  week         smallint,
  day_in_week  smallint,
  duration_s   integer check (duration_s >= 0)
);

create table public.workout_sets (
  event_id          bigint primary key references public.events (id) on delete cascade,
  session_event_id  bigint references public.events (id) on delete cascade,
  exercise          text not null,          -- e.g. 'Squat, Barbell'
  tier              text check (tier in ('T1', 'T2', 'T3')),  -- GZCL tier when known
  set_index         smallint not null,
  reps              smallint not null check (reps >= 0),
  weight_kg         numeric(6,2) not null default 0 check (weight_kg >= 0),
  is_warmup         boolean not null default false,
  target_reps       smallint,
  target_weight_kg  numeric(6,2),
  -- Epley estimate, used for PR detection.
  est_1rm_kg        numeric(6,2) generated always as (
                      case when reps between 1 and 12 and weight_kg > 0
                           then round(weight_kg * (1 + reps / 30.0), 2) end) stored
);

create index workout_sets_session on public.workout_sets (session_event_id);
create index workout_sets_exercise on public.workout_sets (exercise);

create table public.activities (
  event_id      bigint primary key references public.events (id) on delete cascade,
  activity_type text not null check (activity_type in
                  ('walking', 'hiking', 'running', 'cycling', 'swimming', 'yard_work', 'mobility')),
  minutes       integer not null check (minutes > 0 and minutes <= 1440),
  distance_m    integer check (distance_m >= 0)
);

create table public.skips (
  event_id bigint primary key references public.events (id) on delete cascade,
  reason   public.skip_reason not null
);

-- Injury or sickness freezes STR until the user ends it.
create table public.recovery_periods (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  reason     public.skip_reason not null check (reason in ('injury', 'sick')),
  starts_on  date not null,
  ends_on    date,
  note       text,
  check (ends_on is null or ends_on >= starts_on)
);

-- CHA quick-log categories are per user so people can add, rename and reweight.
create table public.self_care_categories (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  weight     numeric(3,1) not null default 1 check (weight between 0 and 10),
  sort       smallint not null default 0,
  active     boolean not null default true,
  unique (user_id, name)
);

create table public.self_care_log (
  event_id    bigint primary key references public.events (id) on delete cascade,
  category_id bigint not null references public.self_care_categories (id),
  weight      numeric(3,1) not null        -- weight at the time, for stable history
);

-- ---------------------------------------------------------------------------
-- Views: live (non-voided) events
-- ---------------------------------------------------------------------------
create view public.live_events
with (security_invoker = true) as
select e.*
from public.events e
where e.type <> 'void'
  and not exists (
    select 1 from public.events v
    where v.type = 'void'
      and v.user_id = e.user_id
      and (v.payload ->> 'target_event_id')::bigint = e.id
  );

-- Daily nutrition totals from food (supplements excluded; they are added
-- separately for display and never count toward INT).
create view public.daily_food_totals
with (security_invoker = true) as
select e.user_id,
       e.local_date,
       round(sum(fl.grams * f.kcal_100g    / 100), 1) as kcal,
       round(sum(fl.grams * f.protein_100g / 100), 1) as protein_g,
       round(sum(fl.grams * f.carbs_100g   / 100), 1) as carbs_g,
       round(sum(fl.grams * f.fat_100g     / 100), 1) as fat_g,
       round(sum(fl.grams * f.fiber_100g   / 100), 1) as fiber_g,
       count(distinct fl.meal)                        as meals_logged
from public.live_events e
join public.food_log fl on fl.event_id = e.id
join public.foods f on f.id = fl.food_id
group by e.user_id, e.local_date;

create view public.daily_water_totals
with (security_invoker = true) as
select e.user_id, e.local_date, sum(w.ml) as ml
from public.live_events e
join public.water_log w on w.event_id = e.id
group by e.user_id, e.local_date;
