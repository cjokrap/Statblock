-- Statblock: logging functions
--
-- One call per user action, writing the event header and its detail row in a
-- single transaction. They run as the caller (security invoker), so RLS still
-- decides what's allowed.

create or replace function public.log_food(
  p_food_id bigint, p_grams numeric, p_meal public.meal,
  p_occurred_at timestamptz default now(), p_portion_label text default null)
returns bigint
language plpgsql
as $$
declare ev bigint;
begin
  insert into public.events (user_id, type, occurred_at)
  values (auth.uid(), 'food', p_occurred_at) returning id into ev;
  insert into public.food_log (event_id, food_id, grams, meal, portion_label)
  values (ev, p_food_id, p_grams, p_meal, p_portion_label);
  return ev;
end;
$$;

create or replace function public.log_water(p_ml integer, p_occurred_at timestamptz default now())
returns bigint
language plpgsql
as $$
declare ev bigint;
begin
  insert into public.events (user_id, type, occurred_at)
  values (auth.uid(), 'water', p_occurred_at) returning id into ev;
  insert into public.water_log (event_id, ml) values (ev, p_ml);
  return ev;
end;
$$;

-- Logs the user's current active stack, snapshotting what was in it.
create or replace function public.log_stack(p_occurred_at timestamptz default now())
returns bigint
language plpgsql
as $$
declare ev bigint;
begin
  if not exists (select 1 from public.daily_stack_items where user_id = auth.uid() and active) then
    raise exception 'no active supplements in the daily stack';
  end if;
  insert into public.events (user_id, type, occurred_at)
  values (auth.uid(), 'stack_taken', p_occurred_at) returning id into ev;
  insert into public.stack_log (event_id, supplement_id, servings)
  select ev, supplement_id, servings
  from public.daily_stack_items
  where user_id = auth.uid() and active;
  return ev;
end;
$$;

create or replace function public.log_weigh_in(p_weight_kg numeric, p_occurred_at timestamptz default now())
returns bigint
language plpgsql
as $$
declare ev bigint;
begin
  insert into public.events (user_id, type, occurred_at)
  values (auth.uid(), 'weigh_in', p_occurred_at) returning id into ev;
  insert into public.weigh_ins (event_id, weight_kg) values (ev, p_weight_kg);
  return ev;
end;
$$;

create or replace function public.log_self_care(p_category_id bigint, p_occurred_at timestamptz default now())
returns bigint
language plpgsql
as $$
declare ev bigint; w numeric;
begin
  select weight into w from public.self_care_categories
  where id = p_category_id and user_id = auth.uid() and active;
  if w is null then
    raise exception 'unknown self-care category';
  end if;
  insert into public.events (user_id, type, occurred_at)
  values (auth.uid(), 'self_care', p_occurred_at) returning id into ev;
  insert into public.self_care_log (event_id, category_id, weight) values (ev, p_category_id, w);
  return ev;
end;
$$;

create or replace function public.log_activity(
  p_activity_type text, p_minutes integer, p_distance_m integer default null,
  p_occurred_at timestamptz default now())
returns bigint
language plpgsql
as $$
declare ev bigint;
begin
  insert into public.events (user_id, type, occurred_at)
  values (auth.uid(), 'activity', p_occurred_at) returning id into ev;
  insert into public.activities (event_id, activity_type, minutes, distance_m)
  values (ev, p_activity_type, p_minutes, p_distance_m);
  return ev;
end;
$$;

-- Skip a planned training day. Injury or sickness also opens a recovery
-- period (STR frozen) unless one is already open.
create or replace function public.log_skip(p_reason public.skip_reason, p_occurred_at timestamptz default now())
returns bigint
language plpgsql
as $$
declare ev bigint; day date;
begin
  insert into public.events (user_id, type, occurred_at)
  values (auth.uid(), 'skip', p_occurred_at) returning id, local_date into ev, day;
  insert into public.skips (event_id, reason) values (ev, p_reason);
  if p_reason in ('injury', 'sick') and not exists (
    select 1 from public.recovery_periods
    where user_id = auth.uid() and ends_on is null
  ) then
    insert into public.recovery_periods (user_id, reason, starts_on)
    values (auth.uid(), p_reason, day);
  end if;
  return ev;
end;
$$;

create or replace function public.end_recovery(p_ends_on date default current_date)
returns void
language sql
as $$
  update public.recovery_periods
     set ends_on = p_ends_on
   where user_id = auth.uid() and ends_on is null
$$;

-- Undo: append a void event for one of the caller's events.
create or replace function public.void_event(p_event_id bigint)
returns bigint
language plpgsql
as $$
declare ev bigint;
begin
  insert into public.events (user_id, type, payload)
  values (auth.uid(), 'void', jsonb_build_object('target_event_id', p_event_id))
  returning id into ev;
  return ev;
end;
$$;
