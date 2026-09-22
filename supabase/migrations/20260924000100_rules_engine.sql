-- Statblock: rules engine
--
-- game.recompute(user, from, to) rebuilds xp_ledger, quest_progress and
-- stat_snapshots for a date range from live events, the user's settings and
-- the active rules version. It deletes what's there for the range first, so
-- running it again gives the same result: that's the replay. After
-- publishing a new rules version, game.replay(user) rebuilds everything.
--
-- Interpretations of the design doc, documented in docs/rules-engine.md:
-- * Day-judged scoring (WIS, DEX, CON, INT, CHA's gaps, STR's schedule,
--   daily and weekly quests) starts on the user's first user_settings row.
--   Workout XP, PRs and CHA's positive points count from the first event.
-- * Only finished days are judged. The user's current local day earns XP
--   and quest progress but isn't penalized until it's over.
-- * Calories, carbs and micronutrients are judged only on fully logged days
--   (3+ meal slots), so a partly logged day never looks "under".
--
-- The game schema is server-only (no grants to clients).

create schema game;

-- A rule from the active version.
create or replace function game.rule(p_key text)
returns jsonb
language sql
stable
as $$
  select value from public.rules_config
  where version = public.active_rules_version() and key = p_key
$$;

-- The user's calendar day right now. Tests pin it with
-- set statblock.today = 'YYYY-MM-DD'.
create or replace function game.today(p_user uuid)
returns date
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('statblock.today', true), '')::date,
    (now() at time zone coalesce(
      (select timezone from public.profiles where user_id = p_user), 'UTC'))::date)
$$;

-- First day of day-judged scoring: the user's first settings row.
create or replace function game.judging_starts(p_user uuid)
returns date
language sql
stable
as $$ select min(effective_from) from public.user_settings where user_id = p_user $$;

-- ---------------------------------------------------------------------------
-- Daily facts
-- ---------------------------------------------------------------------------
-- One row per day with everything the rules judge. `judged` is true for
-- finished days on or after judging_starts.
create or replace function game.day_facts(p_user uuid, p_from date, p_to date)
returns table (
  day date, judged boolean, finished boolean,
  calorie_target integer, window_pct numeric, eating_style public.eating_style,
  protein_target integer, carbs_target integer, carbs_are_ceiling boolean, count_net_carbs boolean,
  water_goal_ml integer, sessions_per_week smallint, is_training_day boolean,
  meal_slots integer, has_breakfast boolean, has_lunch boolean, has_dinner boolean,
  fully_logged boolean, unlogged boolean,
  kcal numeric, protein_g numeric, carbs_g numeric, net_carbs_g numeric,
  water_ml integer, stack_taken boolean, sessions integer, excused_sessions integer,
  weigh_ins integer, self_care_weight numeric, micro_avg_pct numeric
)
language sql
stable
as $$
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  ev as (
    select e.* from public.live_events e
    where e.user_id = p_user and e.local_date between p_from and p_to
  ),
  food as (
    select e.local_date as day, fl.meal, fl.grams, f.id as food_id,
           fl.grams / 100 * coalesce(f.kcal_100g, 0) as kcal,
           fl.grams / 100 * coalesce(f.protein_100g, 0) as protein,
           fl.grams / 100 * coalesce(f.carbs_100g, 0) as carbs,
           fl.grams / 100 * coalesce(f.fiber_100g, 0) as fiber
    from ev e
    join public.food_log fl on fl.event_id = e.id
    join public.foods f on f.id = fl.food_id
    where e.type = 'food'
  ),
  food_day as (
    select day,
           count(distinct meal)::integer as meal_slots,
           bool_or(meal = 'breakfast') as has_breakfast,
           bool_or(meal = 'lunch') as has_lunch,
           bool_or(meal = 'dinner') as has_dinner,
           sum(kcal) as kcal, sum(protein) as protein, sum(carbs) as carbs,
           sum(greatest(carbs - fiber, 0)) as net_carbs
    from food group by day
  ),
  -- INT: mean share of target (capped at 100%) over the INT nutrients the
  -- day's food actually has data for. Supplements never count.
  micro_intake as (
    select fo.day, fn.nutrient_id, sum(fo.grams / 100 * fn.amount_100g) as intake
    from food fo
    join public.food_nutrients fn on fn.food_id = fo.food_id
    join public.nutrients n on n.id = fn.nutrient_id and n.counts_for_int
    group by fo.day, fn.nutrient_id
  ),
  micro_day as (
    select mi.day,
           avg(least(1, mi.intake / t.amount)) * 100 as avg_pct
    from micro_intake mi
    cross join lateral (
      select coalesce(
        (select u.amount from public.user_nutrient_targets u
         where u.user_id = p_user and u.nutrient_id = mi.nutrient_id and u.effective_from <= mi.day
         order by u.effective_from desc limit 1),
        (select d.amount from public.profiles p
         join public.dri_targets d on d.sex = p.sex
           and extract(year from age(mi.day, p.birth_date)) between d.age_min and d.age_max
         where p.user_id = p_user and d.nutrient_id = mi.nutrient_id)) as amount
    ) t
    where t.amount > 0
    group by mi.day
  ),
  other_day as (
    select e.local_date as day,
           coalesce(sum(w.ml), 0)::integer as water_ml,
           bool_or(e.type = 'stack_taken') as stack_taken,
           count(*) filter (where e.type = 'workout_session')::integer as sessions,
           count(*) filter (where e.type = 'skip' and s.reason in ('injury', 'sick'))::integer as excused,
           count(distinct e.local_date) filter (where e.type = 'weigh_in')::integer as weigh_ins,
           coalesce(sum(sc.weight), 0) as self_care_weight
    from ev e
    left join public.water_log w on w.event_id = e.id
    left join public.skips s on s.event_id = e.id
    left join public.self_care_log sc on sc.event_id = e.id
    group by e.local_date
  )
  select d.day,
         (st.id is not null and d.day >= game.judging_starts(p_user) and d.day < game.today(p_user)),
         d.day < game.today(p_user),
         st.calorie_target, st.calorie_window_pct, st.eating_style,
         st.protein_g, st.carbs_g, st.carbs_are_ceiling, st.count_net_carbs,
         st.water_goal_ml, st.training_days_per_week,
         st.id is not null and not (extract(isodow from d.day)::smallint = any (st.rest_days)),
         coalesce(fd.meal_slots, 0), coalesce(fd.has_breakfast, false),
         coalesce(fd.has_lunch, false), coalesce(fd.has_dinner, false),
         coalesce(fd.meal_slots, 0) >= (game.rule('stats.wis') #>> '{good,fully_logged_days,min_meal_slots}')::integer,
         fd.day is null,
         coalesce(fd.kcal, 0), coalesce(fd.protein, 0), coalesce(fd.carbs, 0), coalesce(fd.net_carbs, 0),
         coalesce(od.water_ml, 0), coalesce(od.stack_taken, false),
         coalesce(od.sessions, 0), coalesce(od.excused, 0),
         coalesce(od.weigh_ins, 0), coalesce(od.self_care_weight, 0),
         md.avg_pct
  from days d
  left join lateral public.settings_for(p_user, d.day) st on true
  left join food_day fd on fd.day = d.day
  left join other_day od on od.day = d.day
  left join micro_day md on md.day = d.day
$$;

-- ---------------------------------------------------------------------------
-- Recompute
-- ---------------------------------------------------------------------------
create or replace function game.recompute(p_user uuid, p_from date, p_to date)
returns void
language plpgsql
set client_min_messages = warning
as $$
declare
  v_version integer := public.active_rules_version();
  v_from date := date_trunc('week', p_from)::date;  -- weekly quests need whole weeks
  v_to date := p_to;
  v_window integer := (game.rule('stats.window_days'))::integer;
  r jsonb;
begin
  delete from public.xp_ledger where user_id = p_user and local_date between v_from and v_to;
  delete from public.quest_progress where user_id = p_user and period_start between v_from and v_to;
  delete from public.stat_snapshots where user_id = p_user and local_date between v_from and v_to;

  -- ---- XP straight from events -------------------------------------------
  -- First entry in each meal slot per day.
  r := game.rule('xp.meal_slot_logged');
  insert into public.xp_ledger (user_id, local_date, track_code, xp, rule_key, rules_version, source_event_id)
  select p_user, local_date, r ->> 'track', (r ->> 'xp')::integer, 'xp.meal_slot_logged', v_version, event_id
  from (
    select distinct on (e.local_date, fl.meal) e.local_date, e.id as event_id
    from public.live_events e join public.food_log fl on fl.event_id = e.id
    where e.user_id = p_user and e.type = 'food' and e.local_date between v_from and v_to
    order by e.local_date, fl.meal, e.occurred_at, e.id
  ) x;

  r := game.rule('xp.weigh_in');
  insert into public.xp_ledger (user_id, local_date, track_code, xp, rule_key, rules_version, source_event_id)
  select p_user, local_date, r ->> 'track', (r ->> 'xp')::integer, 'xp.weigh_in', v_version, id
  from (
    select e.local_date, e.id,
           row_number() over (partition by e.local_date order by e.occurred_at, e.id) as n
    from public.live_events e
    where e.user_id = p_user and e.type = 'weigh_in' and e.local_date between v_from and v_to
  ) x
  where n <= coalesce((r ->> 'max_per_day')::integer, 1);

  -- Working sets: the GZCL tier picks the class.
  r := game.rule('xp.workout_set');
  insert into public.xp_ledger (user_id, local_date, track_code, xp, rule_key, rules_version, source_event_id)
  select p_user, e.local_date,
         coalesce(r #>> array['by_tier', ws.tier, 'track'], r #>> '{untiered,track}'),
         coalesce(r #>> array['by_tier', ws.tier, 'xp'], r #>> '{untiered,xp}')::integer,
         'xp.workout_set', v_version, e.id
  from public.live_events e
  join public.workout_sets ws on ws.event_id = e.id
  where e.user_id = p_user and e.type = 'workout_set' and e.local_date between v_from and v_to
    and not (ws.is_warmup and coalesce((r ->> 'working_sets_only')::boolean, true));

  -- PRs: one award per exercise per session.
  r := game.rule('xp.personal_record');
  insert into public.xp_ledger (user_id, local_date, track_code, xp, rule_key, rules_version, source_event_id)
  select p_user, local_date, r ->> 'track', (r ->> 'xp')::integer, 'xp.personal_record', v_version, event_id
  from (
    select distinct on (p.session_event_id, p.exercise) p.local_date, p.event_id
    from public.workout_prs p
    where p.user_id = p_user and p.is_pr and p.local_date between v_from and v_to
    order by p.session_event_id, p.exercise, p.occurred_at, p.event_id
  ) x;

  r := game.rule('xp.activity');
  insert into public.xp_ledger (user_id, local_date, track_code, xp, rule_key, rules_version, source_event_id)
  select p_user, e.local_date, r #>> array['tracks', a.activity_type],
         (a.minutes / 10) * (r ->> 'xp_per_10_min')::integer, 'xp.activity', v_version, e.id
  from public.live_events e
  join public.activities a on a.event_id = e.id
  where e.user_id = p_user and e.type = 'activity' and e.local_date between v_from and v_to
    and a.minutes >= 10 and r #>> array['tracks', a.activity_type] is not null;

  -- ---- Day facts (with the stat window's lookback) -------------------------
  drop table if exists _days;
  create temp table _days as
  select * from game.day_facts(p_user, v_from - (v_window - 1), v_to);
  create index on _days (day);

  -- ---- Daily quests --------------------------------------------------------
  drop table if exists _quests;
  create temp table _quests (
    quest_code text, period_start date, progress numeric, target numeric,
    completed_at timestamptz
  );

  insert into _quests
  select q.code, d.day,
         case q.code
           when 'log_every_meal' then (d.has_breakfast::int + d.has_lunch::int + d.has_dinner::int)
           when 'take_stack' then d.stack_taken::int
           when 'train' then least(d.sessions, 1)
           when 'hit_protein' then round(d.protein_g, 2)
           when 'drink_water' then d.water_ml
           when 'carb_ceiling' then round(case when d.count_net_carbs then d.net_carbs_g else d.carbs_g end, 2)
           when 'calorie_window' then round(d.kcal, 2)
         end,
         case q.code
           when 'log_every_meal' then 3
           when 'take_stack' then 1
           when 'train' then 1
           when 'hit_protein' then d.protein_target
           when 'drink_water' then d.water_goal_ml
           when 'carb_ceiling' then d.carbs_target
           when 'calorie_window' then d.calorie_target
         end,
         null
  from _days d
  cross join public.quest_definitions q
  where q.cadence = 'daily' and q.active
    and d.day between v_from and v_to
    and d.calorie_target is not null                       -- settings in force
    and d.day >= game.judging_starts(p_user)
    and (q.applies_when ->> 'training_day' is null or d.is_training_day)
    and (q.applies_when -> 'eating_style' is null
         or q.applies_when -> 'eating_style' ? d.eating_style::text)
    and (q.applies_when ->> 'has_stack' is null
         or exists (select 1 from public.daily_stack_items s where s.user_id = p_user and s.active))
    and not (q.code = 'drink_water' and d.water_goal_ml = 0);

  -- When each goal was met. Running totals find the moment a threshold was
  -- crossed; end-of-day goals complete at local midnight once the day is over.
  update _quests q set completed_at = x.at
  from (
    select c.quest_code, c.day, min(c.occurred_at) as at
    from (
      select 'hit_protein' as quest_code, e.local_date as day, e.occurred_at,
             sum(fl.grams / 100 * coalesce(f.protein_100g, 0))
               over (partition by e.local_date order by e.occurred_at, e.id) as running
      from public.live_events e
      join public.food_log fl on fl.event_id = e.id join public.foods f on f.id = fl.food_id
      where e.user_id = p_user and e.local_date between v_from and v_to
      union all
      select 'drink_water', e.local_date, e.occurred_at,
             sum(w.ml) over (partition by e.local_date order by e.occurred_at, e.id)
      from public.live_events e join public.water_log w on w.event_id = e.id
      where e.user_id = p_user and e.local_date between v_from and v_to
      union all
      select 'take_stack', e.local_date, e.occurred_at, 1
      from public.live_events e
      where e.user_id = p_user and e.type = 'stack_taken' and e.local_date between v_from and v_to
      union all
      select 'train', e.local_date, e.occurred_at, 1
      from public.live_events e
      where e.user_id = p_user and e.type = 'workout_session' and e.local_date between v_from and v_to
      union all
      -- Meals: the time the third of breakfast/lunch/dinner was first logged.
      select 'log_every_meal', day, max(first_at), count(*)
      from (select e.local_date as day, fl.meal, min(e.occurred_at) as first_at
            from public.live_events e join public.food_log fl on fl.event_id = e.id
            where e.user_id = p_user and fl.meal in ('breakfast', 'lunch', 'dinner')
              and e.local_date between v_from and v_to
            group by e.local_date, fl.meal) m
      group by day
    ) c
    join _quests q2 on q2.quest_code = c.quest_code and q2.period_start = c.day
    where c.running >= q2.target and q2.target > 0
    group by c.quest_code, c.day
  ) x
  where q.quest_code = x.quest_code and q.period_start = x.day;

  update _quests q
  set completed_at = ((d.day + 1)::timestamp at time zone coalesce(
                        (select timezone from public.profiles where user_id = p_user), 'UTC'))
  from _days d
  where q.period_start = d.day and d.finished and d.fully_logged
    and ((q.quest_code = 'calorie_window'
          and abs(q.progress - q.target) <= q.target * d.window_pct / 100)
      or (q.quest_code = 'carb_ceiling' and q.progress <= q.target));

  -- ---- Weekly bosses -------------------------------------------------------
  -- The moment each day became fully logged: when its Nth meal slot
  -- (N = the WIS min_meal_slots rule) got its first entry.
  drop table if exists _full_at;
  create temp table _full_at as
  select day, at from (
    select day, first_at as at,
           row_number() over (partition by day order by first_at) as n
    from (select e.local_date as day, fl.meal, min(e.occurred_at) as first_at
          from public.live_events e join public.food_log fl on fl.event_id = e.id
          where e.user_id = p_user and e.local_date between v_from and v_to
          group by e.local_date, fl.meal) s
  ) x
  where n = (game.rule('stats.wis') #>> '{good,fully_logged_days,min_meal_slots}')::integer;

  -- Weeks with settings in force on their Monday (or later, for the week
  -- judging starts in).
  drop table if exists _weeks;
  create temp table _weeks as
  select monday, (select max(d.sessions_per_week) from _days d
                  where d.day between monday and monday + 6 and d.calorie_target is not null) as planned
  from (select distinct date_trunc('week', day)::date as monday from _days
        where day between v_from and v_to) w
  where exists (select 1 from _days s where s.day between w.monday and w.monday + 6
                  and s.calorie_target is not null and s.day >= game.judging_starts(p_user));

  -- Draugr of Drift: fully log 6 of 7 days. Done the moment the 6th day is.
  insert into _quests
  select 'boss_fully_logged', w.monday,
         (select count(*) from _full_at f
          where f.day between w.monday and w.monday + 6 and f.day >= game.judging_starts(p_user)),
         6,
         (select (array_agg(f.at order by f.at))[6] from _full_at f
          where f.day between w.monday and w.monday + 6 and f.day >= game.judging_starts(p_user))
  from _weeks w;

  -- Iron Warden: every planned session this week. Injury and sick skips
  -- lower the target. Done at the session that reaches it.
  insert into _quests
  select 'boss_all_sessions', w.monday, least(x.sessions, x.target), x.target,
         case when x.target > 0 and x.sessions >= x.target then
           (select e.occurred_at from public.live_events e
            where e.user_id = p_user and e.type = 'workout_session'
              and e.local_date between w.monday and w.monday + 6
            order by e.occurred_at, e.id offset x.target - 1 limit 1)
         end
  from _weeks w
  cross join lateral (
    select coalesce(sum(d.sessions), 0) as sessions,
           greatest(0, coalesce(w.planned, 0) - coalesce(sum(d.excused_sessions), 0)) as target
    from _days d where d.day between w.monday and w.monday + 6
  ) x;

  insert into public.quest_progress (user_id, quest_code, period_start, progress, target, completed_at)
  select p_user, quest_code, period_start, coalesce(progress, 0), coalesce(target, 0), completed_at
  from _quests;

  -- Quest XP: daily quests on their day, bosses on the day they fell.
  insert into public.xp_ledger (user_id, local_date, track_code, xp, rule_key, rules_version)
  select p_user,
         case when qd.cadence = 'daily' then q.period_start
              else (q.completed_at at time zone coalesce(
                     (select timezone from public.profiles where user_id = p_user), 'UTC'))::date end,
         qd.track_code, qd.xp, 'quest.' || qd.code, v_version
  from _quests q
  join public.quest_definitions qd on qd.code = q.quest_code
  where q.completed_at is not null and qd.xp > 0 and qd.track_code is not null;

  -- ---- Ability scores ------------------------------------------------------
  insert into public.stat_snapshots (user_id, local_date, str, dex, con, "int", wis, cha, str_frozen, rules_version)
  select p_user, s.day, s.str, s.dex, s.con, s."int", s.wis, s.cha, s.str_frozen, v_version
  from game.scores(p_user, v_from, v_to) s
  where s.day >= (select min(local_date) from public.live_events where user_id = p_user);

  drop table _days;
  drop table _quests;
  drop table _full_at;
  drop table _weeks;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ability scores
-- ---------------------------------------------------------------------------
-- score = baseline + good - bad, rounded and clamped to the range. Each
-- stat looks at the rolling window of stats.window_days ending on the day.
-- "points_at_100pct" rules scale with the share of judged days in the
-- window that qualified; unlogged days count against that share too, so
-- skipping a log never looks better than logging a bad day.
create or replace function game.clamp_score(p_points numeric, p_range jsonb)
returns integer
language sql
immutable
as $$
  select greatest((p_range ->> 'min')::integer,
                  least((p_range ->> 'max')::integer,
                        round((p_range ->> 'baseline')::numeric + p_points)::integer))
$$;

create or replace function game.raw_scores(p_user uuid, p_from date, p_to date)
returns table (day date, str integer, dex integer, con integer, "int" integer, wis integer, cha integer)
language sql
stable
as $$
  with rules as (
    select (game.rule('stats.window_days'))::integer as w,
           game.rule('stats.range') as range,
           game.rule('stats.str') as str, game.rule('stats.dex') as dex,
           game.rule('stats.con') as con, game.rule('stats.int') as int_,
           game.rule('stats.wis') as wis, game.rule('stats.cha') as cha,
           game.judging_starts(p_user) as judging,
           game.today(p_user) as today
  ),
  -- Facts reach back one window, plus a week so every week ending in the
  -- window is whole.
  f as (
    select df.* from rules, game.day_facts(p_user, p_from - (rules.w - 1) - 6, p_to) df
  ),
  days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  per_day as (
    select d.day,
      -- judged days in the window
      count(*) filter (where f.judged) as n,
      count(*) filter (where f.judged and f.fully_logged) as fully,
      count(*) filter (where f.judged and f.unlogged) as unlogged,
      count(*) filter (where f.judged and f.fully_logged
                         and abs(f.kcal - f.calorie_target) <= f.calorie_target * f.window_pct / 100) as in_window,
      count(*) filter (where f.judged and f.fully_logged
                         and f.kcal > f.calorie_target * (1 + f.window_pct / 100)) as over,
      count(*) filter (where f.judged and f.fully_logged
                         and f.kcal < f.calorie_target * (1 - f.window_pct / 100)) as under,
      count(*) filter (where f.judged and f.fully_logged and f.micro_avg_pct
                         >= (r.int_ #>> '{good,days_micros_met,threshold_pct_of_targets}')::numeric) as micros_met,
      count(*) filter (where f.judged and f.fully_logged and f.micro_avg_pct
                         < (r.int_ #>> '{bad,days_micros_low,below_pct_of_targets}')::numeric) as micros_low,
      coalesce(sum(f.sessions) filter (where f.judged), 0) as sessions,
      coalesce(sum(f.sessions_per_week / 7.0) filter (where f.judged), 0)
        - coalesce(sum(f.excused_sessions) filter (where f.judged), 0) as planned,
      -- CHA counts every day in the window, today and pre-settings included.
      coalesce(sum(f.self_care_weight), 0) as self_care_weight,
      coalesce(sum(f.weigh_ins), 0) as weigh_ins
    from days d
    cross join rules r
    join f on f.day between d.day - (r.w - 1) and d.day
    group by d.day
  ),
  -- STR: each finished Mon-Sun week that ends inside the window and started
  -- on or after judging began costs a point per planned session missed.
  shortfall as (
    select d.day, coalesce(sum(greatest(0, wk.planned - wk.sessions - wk.excused)), 0) as missed
    from days d
    cross join rules r
    left join lateral (
      select date_trunc('week', f.day)::date as monday,
             max(f.sessions_per_week) as planned,
             sum(f.sessions) as sessions, sum(f.excused_sessions) as excused
      from f
      where f.day between d.day - (r.w - 1) - 6 and d.day
      group by 1
    ) wk on wk.monday + 6 between d.day - (r.w - 1) and d.day
        and wk.monday + 6 < r.today
        and r.judging is not null and wk.monday >= r.judging
    group by d.day
  ),
  prs as (
    select d.day, count(distinct (p.session_event_id, p.exercise)) as n
    from days d
    cross join rules r
    left join public.workout_prs p
      on p.user_id = p_user and p.is_pr and p.local_date between d.day - (r.w - 1) and d.day
    group by d.day
  ),
  -- CHA: days since the last self-care log or weigh-in, counted from when
  -- judging began at the earliest.
  cha_gap as (
    select d.day,
           case when r.judging is null or d.day < r.judging then 0
                else d.day - greatest(r.judging,
                       coalesce((select max(e.local_date) from public.live_events e
                                 where e.user_id = p_user and e.type in ('self_care', 'weigh_in')
                                   and e.local_date <= d.day), r.judging))
           end as gap
    from days d cross join rules r
  ),
  points as (
    select p.day, r.range,
      -- STR
      case when p.planned > 0
           then (r.str #>> '{good,session_completion_rate,points_at_100pct}')::numeric
                * least(1, p.sessions / p.planned) else 0 end
      + least(pr.n * (r.str #>> '{good,prs_in_window,points_each}')::numeric,
              (r.str #>> '{good,prs_in_window,cap}')::numeric)
      - sf.missed * (r.str #>> '{bad,weekly_session_shortfall,points_each}')::numeric as str,
      -- DEX / CON
      case when p.n > 0 then (r.dex #>> '{good,days_in_window,points_at_100pct}')::numeric * p.in_window / p.n else 0 end
      - p.over * (r.dex #>> '{bad,days_over_window,points_each}')::numeric as dex,
      case when p.n > 0 then (r.con #>> '{good,days_in_window,points_at_100pct}')::numeric * p.in_window / p.n else 0 end
      - p.under * (r.con #>> '{bad,days_under_window,points_each}')::numeric as con,
      -- INT
      case when p.n > 0 then (r.int_ #>> '{good,days_micros_met,points_at_100pct}')::numeric * p.micros_met / p.n else 0 end
      - p.micros_low * (r.int_ #>> '{bad,days_micros_low,points_each}')::numeric as int_,
      -- WIS
      case when p.n > 0 then (r.wis #>> '{good,fully_logged_days,points_at_100pct}')::numeric * p.fully / p.n else 0 end
      - p.unlogged * (r.wis #>> '{bad,unlogged_days,points_each}')::numeric as wis,
      -- CHA
      least(p.self_care_weight * (r.cha #>> '{good,self_care_weighted,points_per_weight}')::numeric,
            (r.cha #>> '{good,self_care_weighted,cap}')::numeric)
      + least(p.weigh_ins * (r.cha #>> '{good,weigh_ins,points_each}')::numeric,
              (r.cha #>> '{good,weigh_ins,cap}')::numeric)
      - greatest(0, g.gap - (r.cha #>> '{bad,days_since_last,after_days}')::integer)
        * (r.cha #>> '{bad,days_since_last,points_per_day}')::numeric as cha
    from per_day p
    cross join rules r
    join shortfall sf on sf.day = p.day
    join prs pr on pr.day = p.day
    join cha_gap g on g.day = p.day
  )
  select day,
         game.clamp_score(str, range), game.clamp_score(dex, range), game.clamp_score(con, range),
         game.clamp_score(int_, range), game.clamp_score(wis, range), game.clamp_score(cha, range)
  from points
$$;


-- Scores with STR frozen during injury or sickness: a frozen day keeps the
-- STR from the day before the recovery period began.
create or replace function game.scores(p_user uuid, p_from date, p_to date)
returns table (day date, str integer, dex integer, con integer, "int" integer, wis integer, cha integer,
               str_frozen boolean)
language sql
stable
as $$
  select s.day,
         case when rp.starts_on is null then s.str
              else (select b.str from game.raw_scores(p_user, rp.starts_on - 1, rp.starts_on - 1) b) end,
         s.dex, s.con, s."int", s.wis, s.cha,
         rp.starts_on is not null
  from game.raw_scores(p_user, p_from, p_to) s
  left join lateral (
    select min(r.starts_on) as starts_on
    from public.recovery_periods r
    where r.user_id = p_user and r.starts_on <= s.day and (r.ends_on is null or r.ends_on >= s.day)
      and r.reason::text in (select jsonb_array_elements_text(game.rule('stats.str') -> 'frozen_during'))
  ) rp on true
$$;

-- ---------------------------------------------------------------------------
-- Entry points
-- ---------------------------------------------------------------------------
-- Rebuild a user's whole history, e.g. after publishing a new rules version.
create or replace function game.replay(p_user uuid)
returns void
language plpgsql
as $$
declare
  v_first date := (select least(min(local_date), game.judging_starts(p_user))
                   from public.live_events where user_id = p_user);
begin
  delete from public.xp_ledger where user_id = p_user;
  delete from public.quest_progress where user_id = p_user;
  delete from public.stat_snapshots where user_id = p_user;
  if v_first is not null then
    perform game.recompute(p_user, v_first, game.today(p_user));
  end if;
end;
$$;

-- Recompute the last p_days days for everyone with events or settings.
-- The scheduled job calls this; it matches the Liftosaur sync's 21-day
-- window, so edits synced from Liftosaur are always rescored.
create or replace function game.recompute_recent(p_days integer default 21)
returns integer
language plpgsql
as $$
declare
  u uuid;
  n integer := 0;
begin
  for u in
    select user_id from public.profiles p
    where exists (select 1 from public.events e where e.user_id = p.user_id)
       or exists (select 1 from public.user_settings s where s.user_id = p.user_id)
  loop
    perform game.recompute(u, game.today(u) - (p_days - 1), game.today(u));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Rebuild everyone, e.g. after publishing a new rules version.
create or replace function game.replay_all()
returns integer
language plpgsql
as $$
declare
  u uuid;
  n integer := 0;
begin
  for u in select user_id from public.profiles loop
    perform game.replay(u);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on all functions in schema game from public;
