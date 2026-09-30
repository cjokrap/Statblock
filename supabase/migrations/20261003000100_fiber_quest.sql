-- Statblock: "Hit fiber", a daily Alchemist quest like "Hit protein"
--
-- Fiber from food and from the daily stack both count (the stack's fiber
-- comes from supplement_nutrients), the same total as the Fiber bar on
-- Today. The goal is user_settings.fiber_g, or 14 g per 1,000 kcal of the
-- calorie target when it isn't set (the app's suggestion). Like protein, it
-- completes the moment the running total reaches the goal.

insert into public.quest_definitions (code, name, description, cadence, track_code, xp, applies_when, sort) values
  ('hit_fiber', 'Hit fiber', 'Reach your fiber goal (food plus the daily stack)', 'daily', 'alchemist', 10, '{}', 4);

-- Fiber eaten and taken on a day, in grams.
create or replace function game.fiber_on(p_user uuid, p_day date)
returns numeric
language sql
stable
as $$
  select coalesce((
    select sum(fl.grams / 100 * coalesce(f.fiber_100g, 0))
    from public.live_events e
    join public.food_log fl on fl.event_id = e.id
    join public.foods f on f.id = fl.food_id
    where e.user_id = p_user and e.local_date = p_day), 0)
  + coalesce((
    select sum(sl.servings * sn.amount_per_serving)
    from public.live_events e
    join public.stack_log sl on sl.event_id = e.id
    join public.supplement_nutrients sn on sn.supplement_id = sl.supplement_id
    join public.nutrients n on n.id = sn.nutrient_id and n.code = 'fiber'
    where e.user_id = p_user and e.local_date = p_day), 0)
$$;

-- The fiber goal in force on a day: the setting, or the suggestion.
create or replace function game.fiber_target(p_user uuid, p_day date)
returns numeric
language sql
stable
as $$
  select coalesce(s.fiber_g, round(s.calorie_target * 14 / 1000.0))
  from public.settings_for(p_user, p_day) s
$$;

revoke all on function game.fiber_on(uuid, date) from public;
revoke all on function game.fiber_target(uuid, date) from public;

do $body$
declare
  src text := pg_get_functiondef('game.recompute(uuid, date, date)'::regprocedure);
begin
  src := replace(src,
    'when ''hit_protein'' then round(d.protein_g, 2)',
    'when ''hit_protein'' then round(d.protein_g, 2)
           when ''hit_fiber'' then round(game.fiber_on(p_user, d.day), 2)');
  src := replace(src,
    'when ''hit_protein'' then d.protein_target',
    'when ''hit_protein'' then d.protein_target
           when ''hit_fiber'' then game.fiber_target(p_user, d.day)');
  -- Completion: the food entry or stack that brought the day's running
  -- total to the goal.
  src := replace(src,
    '      union all
      select ''drink_water'', e.local_date, e.occurred_at,',
    '      union all
      select ''hit_fiber'', x.local_date, x.occurred_at,
             sum(x.fiber) over (partition by x.local_date order by x.occurred_at, x.id)
      from (
        select e.local_date, e.occurred_at, e.id, fl.grams / 100 * coalesce(f.fiber_100g, 0) as fiber
        from public.live_events e
        join public.food_log fl on fl.event_id = e.id join public.foods f on f.id = fl.food_id
        where e.user_id = p_user and e.local_date between greatest(v_from, v_start) and v_to
        union all
        select e.local_date, e.occurred_at, e.id, sl.servings * sn.amount_per_serving
        from public.live_events e
        join public.stack_log sl on sl.event_id = e.id
        join public.supplement_nutrients sn on sn.supplement_id = sl.supplement_id
        join public.nutrients n on n.id = sn.nutrient_id and n.code = ''fiber''
        where e.user_id = p_user and e.local_date between greatest(v_from, v_start) and v_to
      ) x
      union all
      select ''drink_water'', e.local_date, e.occurred_at,');
  if (length(src) - length(replace(src, 'hit_fiber', ''))) / length('hit_fiber') <> 3 then
    raise exception 'fiber quest patch did not apply';
  end if;
  execute src;
end
$body$;

-- Score the days since the game started with the new quest.
select game.replay_all();
