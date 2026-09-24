-- Statblock: slow, earned ability scores, and a fresh start at level 1
--
-- Rules v2 (Charles, Sep 24, 2026). Two changes:
--
-- 1. Ability scores are earned over weeks instead of read off a 14-day
--    window. Each stat keeps a running progress total, in "good days": a
--    perfect week is 7. Going from a score to the next costs more each
--    time: 10 -> 11 takes 2 perfect weeks, 11 -> 12 takes 3, 12 -> 13 takes
--    4, and so on (65 perfect weeks from 10 to 20). Bad days still cost
--    progress (an unlogged day costs 2 good days of WIS), so consistency is
--    what moves a score, and a dent heals with a good week. Below 10 the
--    ladder mirrors: 10 -> 9 costs 2 weeks of bad days, 9 -> 8 costs 3.
--    Progress is clamped to the 3-20 range, so nothing banks past 20 and a
--    long break never digs a hole deeper than 3.
--
-- 2. The game starts when the user starts playing: the first day they log
--    something in the app or save targets. Workouts imported from before
--    then (Liftosaur history) earn no XP and no STR; they still set the PR
--    baselines, so the first PR has to beat real history.
--
-- Publishing v2 replays everyone, so this migration resets XP, levels,
-- quests and scores from the new rules.

-- ---------------------------------------------------------------------------
-- Snapshots carry each stat's progress (good days) for the progress bars.
-- ---------------------------------------------------------------------------
alter table public.stat_snapshots add column progress jsonb;

-- ---------------------------------------------------------------------------
-- Rules v2: v1 plus the progression settings.
-- ---------------------------------------------------------------------------
insert into public.rules_versions (version, notes)
values (2, 'Scores earned over weeks (10->11 in 2 perfect weeks, each step a week longer); game starts at first app use');

insert into public.rules_config (version, key, value, notes)
select 2, key, value, notes from public.rules_config where version = 1;

insert into public.rules_config (version, key, value, notes) values
  (2, 'stats.progression',
      '{"baseline": 10, "min": 3, "max": 20, "days_per_week": 7, "first_step_weeks": 2, "step_increase_weeks": 1}',
      'Cost of 10->11 is first_step_weeks perfect weeks; each further step costs step_increase_weeks more. Mirrors below 10.');

-- Per-day progress, in good days (7 = a perfect week).
update public.rules_config set value = value
  || '{"progress": {"fully_logged_day": 1, "unlogged_day": -2}}'
where version = 2 and key = 'stats.wis';
update public.rules_config set value = value
  || '{"progress": {"day_in_window": 1, "day_over_window": -1}}'
where version = 2 and key = 'stats.dex';
update public.rules_config set value = value
  || '{"progress": {"day_in_window": 1, "day_under_window": -1}}'
where version = 2 and key = 'stats.con';
update public.rules_config set value = value
  || '{"progress": {"day_micros_met": 1, "day_micros_low": -0.5}}'
where version = 2 and key = 'stats.int';
-- STR: all planned sessions in a week = 7; each PR (exercise per session) +1,
-- up to 3 a week; each missed planned session costs half what it would earn.
update public.rules_config set value = value
  || '{"progress": {"week_of_sessions": 7, "pr": 1, "pr_cap_per_week": 3, "missed_session_share": -0.5}}'
where version = 2 and key = 'stats.str';
-- CHA: self-care weight 6 in a week (date night + D&D + a hobby) = 5.25,
-- two weigh-ins = 1.75; a perfect week is 7. Each day past 7 without either
-- costs 0.5.
update public.rules_config set value = value
  || '{"progress": {"self_care_per_weight": 0.875, "self_care_cap_per_week": 5.25, "weigh_in": 0.875, "weigh_in_cap_per_week": 1.75, "gap_after_days": 7, "gap_per_day": -0.5}}'
where version = 2 and key = 'stats.cha';

update public.rules_versions set is_active = (version = 2);

-- ---------------------------------------------------------------------------
-- When the game starts for a user: the first day they logged something in
-- the app, or saved targets, whichever came first. Imported history before
-- that doesn't score.
-- ---------------------------------------------------------------------------
create or replace function game.game_starts(p_user uuid)
returns date
language sql
stable
as $$
  select nullif(least(
    coalesce((select min(e.local_date) from public.live_events e
              where e.user_id = p_user and e.source = 'app'), 'infinity'::date),
    coalesce(game.judging_starts(p_user), 'infinity'::date)), 'infinity'::date)
$$;

-- ---------------------------------------------------------------------------
-- The score ladder
-- ---------------------------------------------------------------------------
-- Good days needed to go from baseline to a score (negative below baseline).
create or replace function game.progress_for_score(p_score integer, p_cfg jsonb)
returns numeric
language sql
immutable
as $$
  select sign(p_score - b) * dpw * (
           abs(p_score - b) * first + inc * abs(p_score - b) * (abs(p_score - b) - 1) / 2.0)
  from (select (p_cfg ->> 'baseline')::integer as b,
               (p_cfg ->> 'days_per_week')::numeric as dpw,
               (p_cfg ->> 'first_step_weeks')::numeric as first,
               (p_cfg ->> 'step_increase_weeks')::numeric as inc) c
$$;

-- The score a progress total reaches.
create or replace function game.score_for_progress(p_progress numeric, p_cfg jsonb)
returns integer
language sql
immutable
as $$
  select case when p_progress >= 0
    then (select max(s) from generate_series((p_cfg ->> 'baseline')::integer, (p_cfg ->> 'max')::integer) s
          where game.progress_for_score(s, p_cfg) <= p_progress)
    else (select min(s) from generate_series((p_cfg ->> 'min')::integer, (p_cfg ->> 'baseline')::integer) s
          where game.progress_for_score(s, p_cfg) >= p_progress)
  end
$$;

-- ---------------------------------------------------------------------------
-- Daily progress for each stat, from the game's start through p_to.
-- ---------------------------------------------------------------------------
create or replace function game.stat_deltas(p_user uuid, p_from date, p_to date)
returns table (day date, str numeric, dex numeric, con numeric, "int" numeric, wis numeric, cha numeric,
               str_frozen boolean)
language sql
stable
as $$
  with rules as (
    select game.rule('stats.str') -> 'progress' as str, game.rule('stats.dex') -> 'progress' as dex,
           game.rule('stats.con') -> 'progress' as con, game.rule('stats.int') as int_,
           game.rule('stats.wis') -> 'progress' as wis, game.rule('stats.cha') -> 'progress' as cha,
           game.rule('stats.str') -> 'frozen_during' as frozen_during,
           game.judging_starts(p_user) as judging, game.game_starts(p_user) as start,
           game.today(p_user) as today
  ),
  -- Facts from the Monday of p_from, so weekly caps see the whole week.
  f as (
    select df.* from game.day_facts(p_user, date_trunc('week', p_from)::date, p_to) df
  ),
  prs as (
    select p.local_date as day, count(distinct (p.session_event_id, p.exercise)) as n
    from public.workout_prs p
    where p.user_id = p_user and p.is_pr and p.local_date between date_trunc('week', p_from)::date and p_to
    group by 1
  ),
  raw as (
    select f.day, date_trunc('week', f.day)::date as monday, f.judged, r.*,
           -- day-judged
           case when f.judged and f.fully_logged then (r.wis ->> 'fully_logged_day')::numeric
                when f.judged and f.unlogged then (r.wis ->> 'unlogged_day')::numeric else 0 end as wis_d,
           case when f.judged and f.fully_logged
                     and abs(f.kcal - f.calorie_target) <= f.calorie_target * f.window_pct / 100
                  then (r.dex ->> 'day_in_window')::numeric
                when f.judged and f.fully_logged and f.kcal > f.calorie_target * (1 + f.window_pct / 100)
                  then (r.dex ->> 'day_over_window')::numeric else 0 end as dex_d,
           case when f.judged and f.fully_logged
                     and abs(f.kcal - f.calorie_target) <= f.calorie_target * f.window_pct / 100
                  then (r.con ->> 'day_in_window')::numeric
                when f.judged and f.fully_logged and f.kcal < f.calorie_target * (1 - f.window_pct / 100)
                  then (r.con ->> 'day_under_window')::numeric else 0 end as con_d,
           case when f.judged and f.fully_logged and f.micro_avg_pct
                     >= (r.int_ #>> '{good,days_micros_met,threshold_pct_of_targets}')::numeric
                  then (r.int_ #>> '{progress,day_micros_met}')::numeric
                when f.judged and f.fully_logged and f.micro_avg_pct
                     < (r.int_ #>> '{bad,days_micros_low,below_pct_of_targets}')::numeric
                  then (r.int_ #>> '{progress,day_micros_low}')::numeric else 0 end as int_d,
           -- event-based gains count the day they happen, today included
           case when f.day >= r.start and f.sessions_per_week > 0
                then f.sessions * (r.str ->> 'week_of_sessions')::numeric / f.sessions_per_week else 0 end as str_sessions,
           case when f.day >= r.start then coalesce(pr.n, 0) * (r.str ->> 'pr')::numeric else 0 end as str_prs,
           case when f.day >= r.start then f.self_care_weight * (r.cha ->> 'self_care_per_weight')::numeric
                else 0 end as cha_care,
           case when f.day >= r.start then f.weigh_ins * (r.cha ->> 'weigh_in')::numeric else 0 end as cha_weigh,
           -- CHA gap: days since the last self-care or weigh-in, counted
           -- from when judging began at the earliest
           case when f.judged then f.day - greatest(r.judging,
                  coalesce((select max(e.local_date) from public.live_events e
                            where e.user_id = p_user and e.type in ('self_care', 'weigh_in')
                              and e.local_date <= f.day), r.judging)) else 0 end as cha_gap,
           f.sessions, f.sessions_per_week, f.excused_sessions
    from f
    cross join rules r
    left join prs pr on pr.day = f.day
  ),
  weekly as (
    select raw.*,
           -- weekly caps: the capped running total minus yesterday's
           least((str ->> 'week_of_sessions')::numeric,
                 sum(str_sessions) over w) - least((str ->> 'week_of_sessions')::numeric,
                 coalesce(sum(str_sessions) over w_prev, 0)) as str_sessions_d,
           least((str ->> 'pr_cap_per_week')::numeric, sum(str_prs) over w)
             - least((str ->> 'pr_cap_per_week')::numeric, coalesce(sum(str_prs) over w_prev, 0)) as str_prs_d,
           least((cha ->> 'self_care_cap_per_week')::numeric, sum(cha_care) over w)
             - least((cha ->> 'self_care_cap_per_week')::numeric, coalesce(sum(cha_care) over w_prev, 0)) as cha_care_d,
           least((cha ->> 'weigh_in_cap_per_week')::numeric, sum(cha_weigh) over w)
             - least((cha ->> 'weigh_in_cap_per_week')::numeric, coalesce(sum(cha_weigh) over w_prev, 0)) as cha_weigh_d,
           -- STR: a finished week that began on or after judging costs a
           -- share for each planned session missed, on its Sunday
           case when extract(isodow from day) = 7 and day < today and judging is not null and monday >= judging
                     and max(sessions_per_week) over wk > 0
                then greatest(0, max(sessions_per_week) over wk - sum(sessions) over wk - sum(excused_sessions) over wk)
                     * (str ->> 'week_of_sessions')::numeric / max(sessions_per_week) over wk
                     * (str ->> 'missed_session_share')::numeric
                else 0 end as str_missed_d
    from raw
    window w as (partition by monday order by day rows between unbounded preceding and current row),
           w_prev as (partition by monday order by day rows between unbounded preceding and 1 preceding),
           wk as (partition by monday)
  )
  select day,
         str_sessions_d + str_prs_d + str_missed_d,
         dex_d, con_d, int_d, wis_d,
         cha_care_d + cha_weigh_d
           + case when cha_gap > (cha ->> 'gap_after_days')::integer then (cha ->> 'gap_per_day')::numeric else 0 end,
         exists (select 1 from public.recovery_periods rp
                 where rp.user_id = p_user and rp.starts_on <= weekly.day
                   and (rp.ends_on is null or rp.ends_on >= weekly.day)
                   and rp.reason::text in (select jsonb_array_elements_text(frozen_during)))
  from weekly
  where day between p_from and p_to
$$;

-- ---------------------------------------------------------------------------
-- Write snapshots for p_from..p_to, carrying progress from the day before.
-- If the day before has no v2 snapshot, rebuild from the game's start.
-- ---------------------------------------------------------------------------
create or replace function game.write_stats(p_user uuid, p_from date, p_to date)
returns void
language plpgsql
as $$
declare
  v_version integer := public.active_rules_version();
  v_cfg jsonb := game.rule('stats.progression');
  v_start date := game.game_starts(p_user);
  v_from date;
  v_lo numeric;
  v_hi numeric;
  p jsonb;
  cur numeric[];
  d record;
  k text;
  i integer;
  keys text[] := array['str', 'dex', 'con', 'int', 'wis', 'cha'];
begin
  if v_start is null or p_to < v_start then
    delete from public.stat_snapshots where user_id = p_user and local_date between p_from and p_to;
    return;
  end if;
  v_lo := game.progress_for_score((v_cfg ->> 'min')::integer, v_cfg);
  v_hi := game.progress_for_score((v_cfg ->> 'max')::integer, v_cfg);
  v_from := greatest(p_from, v_start);

  select s.progress into p from public.stat_snapshots s
  where s.user_id = p_user and s.local_date = v_from - 1 and s.rules_version = v_version and s.progress is not null;
  if p is null then
    v_from := v_start;
    cur := array[0, 0, 0, 0, 0, 0];
  else
    cur := array[(p ->> 'str')::numeric, (p ->> 'dex')::numeric, (p ->> 'con')::numeric,
                 (p ->> 'int')::numeric, (p ->> 'wis')::numeric, (p ->> 'cha')::numeric];
  end if;

  -- Nothing before the game starts; everything from v_from is rebuilt.
  delete from public.stat_snapshots
  where user_id = p_user and (local_date < v_start or local_date between v_from and p_to);

  for d in select * from game.stat_deltas(p_user, v_from, p_to) order by day loop
    if not d.str_frozen then
      cur[1] := greatest(v_lo, least(v_hi, cur[1] + d.str));
    end if;
    cur[2] := greatest(v_lo, least(v_hi, cur[2] + d.dex));
    cur[3] := greatest(v_lo, least(v_hi, cur[3] + d.con));
    cur[4] := greatest(v_lo, least(v_hi, cur[4] + d."int"));
    cur[5] := greatest(v_lo, least(v_hi, cur[5] + d.wis));
    cur[6] := greatest(v_lo, least(v_hi, cur[6] + d.cha));
    p := '{}'::jsonb;
    for i in 1..6 loop
      p := p || jsonb_build_object(keys[i], round(cur[i], 3));
    end loop;
    insert into public.stat_snapshots
      (user_id, local_date, str, dex, con, "int", wis, cha, str_frozen, rules_version, progress)
    values (p_user, d.day,
            game.score_for_progress(cur[1], v_cfg), game.score_for_progress(cur[2], v_cfg),
            game.score_for_progress(cur[3], v_cfg), game.score_for_progress(cur[4], v_cfg),
            game.score_for_progress(cur[5], v_cfg), game.score_for_progress(cur[6], v_cfg),
            d.str_frozen, v_version, p);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- recompute: XP only from the game's start; scores from write_stats.
-- (Same as 20260924000100 otherwise.)
-- ---------------------------------------------------------------------------
do $body$
declare
  src text := pg_get_functiondef('game.recompute(uuid, date, date)'::regprocedure);
begin
  -- Every XP source is dated by the event's local_date; start the range at
  -- the game's start.
  src := replace(src,
    'v_from date := date_trunc(''week'', p_from)::date;  -- weekly quests need whole weeks',
    'v_from date := date_trunc(''week'', p_from)::date;  -- weekly quests need whole weeks
  v_start date := coalesce(game.game_starts(p_user), ''infinity''::date);');
  src := replace(src, 'e.local_date between v_from and v_to', 'e.local_date between greatest(v_from, v_start) and v_to');
  src := replace(src, 'p.local_date between v_from and v_to', 'p.local_date between greatest(v_from, v_start) and v_to');
  -- Scores: the progression replaces the rolling window.
  src := replace(src,
    'insert into public.stat_snapshots (user_id, local_date, str, dex, con, "int", wis, cha, str_frozen, rules_version)
  select p_user, s.day, s.str, s.dex, s.con, s."int", s.wis, s.cha, s.str_frozen, v_version
  from game.scores(p_user, v_from, v_to) s
  where s.day >= (select min(local_date) from public.live_events where user_id = p_user);',
    'perform game.write_stats(p_user, v_from, v_to);');
  if src not like '%game.write_stats%' or src not like '%v_start date%' then
    raise exception 'rules engine patch did not apply';
  end if;
  execute src;
end
$body$;

-- XP from quests and bosses is dated by the quest's day; quests already
-- start at judging (on or after the game's start), so they need no change.

select game.replay_all();
