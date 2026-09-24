-- Rules engine tests: three made-up weeks for one user, scored against the
-- active rules by hand (v2: scores earned over weeks). Runs on a freshly migrated database (run_local.sh).
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''

-- "Today" is Monday 2026-09-21 in Chicago. Settings start Monday Sep 7, so
-- judging covers Sep 7-20 (today isn't judged until it's over).
set statblock.today = '2026-09-21';

insert into auth.users (id, email) values (:A, 'a@example.com'), (:B, 'b@example.com');
update public.profiles set sex = 'male', birth_date = '1985-06-01' where user_id = :A;

insert into public.user_settings (user_id, effective_from, calorie_target, calorie_window_pct, protein_g,
                                  carbs_g, fat_g, water_goal_ml, training_days_per_week, rest_days)
values (:A, '2026-09-07', 2000, 10, 180, 170, 67, 2957, 4, '{3,7}');

insert into public.supplements (source, source_id, name) values ('dsld', 'multi', 'Multivitamin');
insert into public.daily_stack_items (user_id, supplement_id)
select :A, id from public.supplements where source_id = 'multi';

-- Foods (per 100 g). Rice carries the only INT nutrient: 10 mg calcium.
insert into public.foods (source, source_id, name, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g) values
  ('usda_sr_legacy', 't-chicken', 'Test chicken', 200, 30, 0, 8, 0),
  ('usda_sr_legacy', 't-rice', 'Test rice', 130, 2.5, 28, 0.3, 0.4);
insert into public.food_nutrients (food_id, nutrient_id, amount_100g)
select id, (select id from public.nutrients where code = 'calcium'), 10 from public.foods where source_id = 't-rice';

-- Helpers (session-local).
create function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as
  $$ select (p_day + p_time) at time zone 'America/Chicago' $$;

create function pg_temp.eat(p_day date, p_time time, p_meal public.meal, p_food text, p_grams numeric)
returns bigint language plpgsql as $$
declare ev bigint;
begin
  insert into public.events (user_id, type, occurred_at)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'food', pg_temp.at(p_day, p_time)) returning id into ev;
  insert into public.food_log (event_id, food_id, grams, meal)
  values (ev, (select id from public.foods where source_id = p_food), p_grams, p_meal);
  return ev;
end $$;

-- A normal day: 1,980 kcal (in the 1,800-2,200 window), 195 g protein.
-- Protein reaches 180 g at lunch.
create function pg_temp.good_day(p_day date) returns void language plpgsql as $$
begin
  perform pg_temp.eat(p_day, '08:00', 'breakfast', 't-chicken', 300);
  perform pg_temp.eat(p_day, '12:30', 'lunch', 't-chicken', 300);
  perform pg_temp.eat(p_day, '19:00', 'dinner', 't-rice', 600);
end $$;

create function pg_temp.simple(p_day date, p_time time, p_type public.event_type) returns bigint
language sql as $$
  insert into public.events (user_id, type, occurred_at)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p_type, pg_temp.at(p_day, p_time)) returning id
$$;

-- A GZCL session: squat T1 (1 warmup + 3 working sets), bench T2 x3,
-- lat pulldown T3 x2, curl untiered x1.
-- XP per session: barbarian 3 x 8 = 24; fighter 3 x 3 + 2 x 2 + 1 x 3 = 16.
create function pg_temp.session(p_day date, p_squat_kg numeric) returns void language plpgsql as $$
declare s bigint; ev bigint; i int := 0; r record;
begin
  s := pg_temp.simple(p_day, '17:00', 'workout_session');
  insert into public.workout_sessions (event_id, external_id) values (s, s::text);
  for r in select * from (values
      ('Squat', 'T1', 5, 60::numeric, true), ('Squat', 'T1', 3, p_squat_kg, false),
      ('Squat', 'T1', 3, p_squat_kg, false), ('Squat', 'T1', 3, p_squat_kg, false),
      ('Bench Press', 'T2', 8, 60, false), ('Bench Press', 'T2', 8, 60, false), ('Bench Press', 'T2', 8, 60, false),
      ('Lat Pulldown', 'T3', 15, 50, false), ('Lat Pulldown', 'T3', 15, 50, false),
      ('Bicep Curl', null, 12, 15, false)) v(ex, tier, reps, kg, warm)
  loop
    ev := pg_temp.simple(p_day, '17:00', 'workout_set');
    insert into public.workout_sets (event_id, session_event_id, exercise, tier, set_index, reps, weight_kg, is_warmup)
    values (ev, s, r.ex, r.tier, i, r.reps, r.kg, r.warm);
    i := i + 1;
  end loop;
end $$;

\o /dev/null
-- ---- The weeks ----------------------------------------------------------
-- Aug 20 (before settings): a session sets the squat baseline, 100 kg x 3.
select pg_temp.session('2026-08-20', 100);

-- Week of Sep 7: six good days, Sunday unlogged. Stack daily Mon-Sat, water
-- goal hit Mon and Tue, four sessions (Sep 10 squat 105 kg x 3 is a PR).
select pg_temp.good_day(d::date) from generate_series(date '2026-09-07', '2026-09-12', '1 day') d;
select pg_temp.simple(d::date, '07:00', 'stack_taken') from generate_series(date '2026-09-07', '2026-09-12', '1 day') d;
do $$ declare ev bigint; d date; begin
  foreach d in array array['2026-09-07', '2026-09-08']::date[] loop
    ev := pg_temp.simple(d, '09:00', 'water'); insert into public.water_log values (ev, 3000);
  end loop;
end $$;
select pg_temp.session('2026-09-07', 100);
select pg_temp.session('2026-09-08', 100);
select pg_temp.session('2026-09-10', 105);
select pg_temp.session('2026-09-12', 100);
-- Sep 13: a 35-minute walk (druid 15 XP) and 20 minutes of mobility (monk 10 XP).
do $$ declare ev bigint; begin
  ev := pg_temp.simple('2026-09-13', '10:00', 'activity'); insert into public.activities values (ev, 'walking', 35, null);
  ev := pg_temp.simple('2026-09-13', '11:00', 'activity'); insert into public.activities values (ev, 'mobility', 20, null);
end $$;

-- Week of Sep 14: Mon over the window (3,020 kcal), Tue under (1,190 kcal),
-- Wed partly logged (breakfast only), Thu-Sun unlogged. Two sessions, an
-- injury skip Thu, a weigh-in Mon, a date night Tue.
select pg_temp.good_day('2026-09-14');
select pg_temp.eat('2026-09-14', '20:00', 'dinner', 't-rice', 800);
select pg_temp.eat('2026-09-15', '08:00', 'breakfast', 't-chicken', 200);
select pg_temp.eat('2026-09-15', '12:30', 'lunch', 't-chicken', 200);
select pg_temp.eat('2026-09-15', '19:00', 'dinner', 't-rice', 300);
select pg_temp.eat('2026-09-16', '08:00', 'breakfast', 't-chicken', 300);
select pg_temp.session('2026-09-14', 100);
select pg_temp.session('2026-09-15', 100);
do $$ declare ev bigint; begin
  ev := pg_temp.simple('2026-09-17', '17:00', 'skip'); insert into public.skips values (ev, 'injury');
  ev := pg_temp.simple('2026-09-14', '07:00', 'weigh_in'); insert into public.weigh_ins values (ev, 100);
  ev := pg_temp.simple('2026-09-15', '20:00', 'self_care');
  insert into public.self_care_log select ev, id, 3 from public.self_care_categories
    where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Date night';
end $$;

-- Today, Sep 21: breakfast only. Not judged yet.
select pg_temp.eat('2026-09-21', '08:00', 'breakfast', 't-chicken', 300);

select game.replay(:A);
\o

-- ---- XP -----------------------------------------------------------------
do $$
declare A uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
begin
  -- quartermaster: meal slots 130 (Sep 7-12, 14, 15: 3 each; 16 and 21: 1 each; x5)
  --   + weigh-in 5 + log_every_meal 8 x 20 + calorie_window 6 x 10 + Draugr boss 50
  assert (select sum(xp) from public.xp_ledger where user_id = A and track_code = 'quartermaster') = 405,
         'quartermaster 405';
  -- alchemist: protein 7 days x 10 (Sep 7-12, 14) + stack 6 x 1 + water 2 x 1
  assert (select sum(xp) from public.xp_ledger where user_id = A and track_code = 'alchemist') = 78, 'alchemist 78';
  -- barbarian: 7 sessions x 24 + one PR 20 + Iron Warden (week of Sep 7) 50
  assert (select sum(xp) from public.xp_ledger where user_id = A and track_code = 'barbarian') = 238, 'barbarian 238';
  -- fighter: 7 sessions x 16
  assert (select sum(xp) from public.xp_ledger where user_id = A and track_code = 'fighter') = 112, 'fighter 112';
  assert (select sum(xp) from public.xp_ledger where user_id = A and track_code = 'druid') = 15, 'walk 15';
  assert (select sum(xp) from public.xp_ledger where user_id = A and track_code = 'monk') = 10, 'mobility 10';
  assert (select count(*) from public.xp_ledger where user_id = A and rule_key = 'xp.personal_record') = 1,
         'one PR (per exercise per session)';
  assert (select local_date from public.xp_ledger where user_id = A and rule_key = 'xp.personal_record') = '2026-09-10',
         'PR on Sep 10';
  assert not exists (select 1 from public.xp_ledger x join public.events e on e.id = x.source_event_id
                     join public.workout_sets ws on ws.event_id = e.id where ws.is_warmup), 'no XP for warmups';
  assert (select total_xp from public.character_level where user_id = A) = 858, 'character XP 858';
  assert (select level from public.character_level where user_id = A) = 5, '858 XP is level 5 (650-1399)';
end $$;

-- ---- Quests -------------------------------------------------------------
do $$
declare A uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
begin
  assert (select completed_at from public.quest_progress
          where user_id = A and quest_code = 'hit_protein' and period_start = '2026-09-08')
         = timestamptz '2026-09-08 12:30 America/Chicago', 'protein goal met at lunch';
  assert (select completed_at is null and progress = 127.5 from public.quest_progress
          where user_id = A and quest_code = 'hit_protein' and period_start = '2026-09-15'), 'under day misses protein';
  assert (select completed_at from public.quest_progress
          where user_id = A and quest_code = 'calorie_window' and period_start = '2026-09-08')
         = timestamptz '2026-09-09 00:00 America/Chicago', 'calorie window judged at end of day';
  assert (select completed_at is null from public.quest_progress
          where user_id = A and quest_code = 'calorie_window' and period_start = '2026-09-14'), 'over day fails window';
  assert (select completed_at is null from public.quest_progress
          where user_id = A and quest_code = 'calorie_window' and period_start = '2026-09-21'), 'today not judged yet';
  assert (select progress from public.quest_progress
          where user_id = A and quest_code = 'log_every_meal' and period_start = '2026-09-16') = 1, 'partial day';
  assert not exists (select 1 from public.quest_progress
                     where user_id = A and quest_code = 'train' and period_start = '2026-09-09'), 'no train quest on a rest day';
  assert (select completed_at is not null from public.quest_progress
          where user_id = A and quest_code = 'train' and period_start = '2026-09-10'), 'trained Thursday';
  assert not exists (select 1 from public.quest_progress where user_id = A and period_start < '2026-09-07'),
         'no quests before settings';
  assert not exists (select 1 from public.quest_progress where user_id = A and quest_code = 'carb_ceiling'),
         'carb ceiling only for low carb and keto';
  -- Bosses
  assert (select completed_at from public.quest_progress
          where user_id = A and quest_code = 'boss_fully_logged' and period_start = '2026-09-07')
         = timestamptz '2026-09-12 19:00 America/Chicago', 'Draugr falls at Saturday dinner';
  assert (select progress::int || '/' || target::int from public.quest_progress
          where user_id = A and quest_code = 'boss_fully_logged' and period_start = '2026-09-14') = '2/6', 'week 2 Draugr 2/6';
  assert (select completed_at from public.quest_progress
          where user_id = A and quest_code = 'boss_all_sessions' and period_start = '2026-09-07')
         = timestamptz '2026-09-12 17:00 America/Chicago', 'Iron Warden falls at the 4th session';
  assert (select progress::int || '/' || target::int from public.quest_progress
          where user_id = A and quest_code = 'boss_all_sessions' and period_start = '2026-09-14') = '2/3',
         'injury skip lowers the week''s target';
end $$;

-- ---- Ability scores (rules v2: earned over weeks) --------------------------
-- The ladder: progress is in good days (a perfect week is 7). 10 -> 11 costs
-- 2 weeks (14), 11 -> 12 three more (35 total), ... 19 -> 20 eleven more
-- (455 = 65 weeks). Below 10 it mirrors down to 3.
do $$
declare c jsonb := game.rule('stats.progression');
begin
  assert game.progress_for_score(11, c) = 14, '10->11 is 2 weeks';
  assert game.progress_for_score(12, c) = 35, '11->12 adds 3 weeks';
  assert game.progress_for_score(20, c) = 455, '10->20 is 65 weeks';
  assert game.progress_for_score(9, c) = -14, 'mirrors below 10';
  assert game.progress_for_score(3, c) = -245, 'down to 3';
  assert game.score_for_progress(0, c) = 10 and game.score_for_progress(13.9, c) = 10
     and game.score_for_progress(14, c) = 11 and game.score_for_progress(34.9, c) = 11
     and game.score_for_progress(455, c) = 20, 'scores up the ladder';
  assert game.score_for_progress(-13.9, c) = 10 and game.score_for_progress(-14, c) = 9
     and game.score_for_progress(-245, c) = 3, 'scores down the ladder';
end $$;

-- Sep 21. The game started Aug 20 (the first event logged in the app);
-- judging started Sep 7, so judged days are Sep 7-20.
-- WIS: fully logged 7-12, 14, 15 (+8); unlogged 13, 17-20 (-2 x 5) -> -2
-- DEX: in window 7-12 (+6), over on 14 (-1) -> 5;  CON: under on 15 -> 5
-- INT: 8 fully logged days with micros under 50% (-0.5 x 8) -> -4
-- STR: week of Sep 7, 4 of 4 sessions (+7) and a PR (+1); week of Sep 14,
--      2 sessions (+1.75 x 2) and 1 missed after the injury skip
--      (4 - 2 - 1 = 1, -0.875 on Sunday) -> 10.625. Aug 20 had no settings,
--      so no planned sessions to earn against.
-- CHA: date night 3 x 0.875 + a weigh-in 0.875 -> 3.5; no gap over 7 days.
-- Every score is still 10: two weeks of mixed days is far from 2 perfect weeks.
do $$
declare A uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; s record;
begin
  select * into s from public.stat_snapshots where user_id = A and local_date = '2026-09-21';
  assert (s.progress ->> 'wis')::numeric = -2, 'WIS progress ' || (s.progress ->> 'wis');
  assert (s.progress ->> 'dex')::numeric = 5, 'DEX progress ' || (s.progress ->> 'dex');
  assert (s.progress ->> 'con')::numeric = 5, 'CON progress ' || (s.progress ->> 'con');
  assert (s.progress ->> 'int')::numeric = -4, 'INT progress ' || (s.progress ->> 'int');
  assert (s.progress ->> 'str')::numeric = 10.625, 'STR progress ' || (s.progress ->> 'str');
  assert (s.progress ->> 'cha')::numeric = 3.5, 'CHA progress ' || (s.progress ->> 'cha');
  assert (s.str, s.dex, s.con, s."int", s.wis, s.cha) = (10, 10, 10, 10, 10, 10), 'all still 10';
  assert not s.str_frozen, 'not frozen';
  -- After the first week: STR had 7 + 1 = 8 by Sep 13.
  assert (select (progress ->> 'str')::numeric from public.stat_snapshots
          where user_id = A and local_date = '2026-09-13') = 8, 'STR after week 1';
  assert (select min(local_date) from public.stat_snapshots where user_id = A) = '2026-08-20', 'snapshots start at the game''s start';
  assert (select max(local_date) from public.stat_snapshots where user_id = A) = '2026-09-21', 'through today';
end $$;

-- ---- Replay is deterministic ----------------------------------------------
\o /dev/null
create temp table before as
  select track_code, sum(xp) as xp from public.xp_ledger group by 1;
create temp table before_stats as select * from public.stat_snapshots;
select game.replay(:A);
select game.recompute(:A, '2026-09-10', '2026-09-21');
\o
do $$ begin
  assert not exists ((select track_code, sum(xp) from public.xp_ledger group by 1) except (select * from before)),
         'replay gives the same XP';
  assert not exists ((select user_id, local_date, str, dex, con, "int", wis, cha
                      from public.stat_snapshots)
                     except (select user_id, local_date, str, dex, con, "int", wis, cha from before_stats)),
         'replay gives the same stats';
end $$;

-- ---- STR freezes during injury -------------------------------------------
-- Injury from Sep 17: STR progress stops moving, so the missed-session
-- penalty on Sunday Sep 20 doesn't land: 10.625 + 0.875 = 11.5.
insert into public.recovery_periods (user_id, reason, starts_on) values (:A, 'injury', '2026-09-17');
select game.recompute(:A, '2026-09-14', '2026-09-21');
do $$ begin
  assert (select (progress ->> 'str')::numeric from public.stat_snapshots
          where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and local_date = '2026-09-21') = 11.5, 'frozen STR';
  assert (select str_frozen from public.stat_snapshots
          where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and local_date = '2026-09-21'), 'marked frozen';
  assert not (select str_frozen from public.stat_snapshots
              where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and local_date = '2026-09-16'), 'day before not frozen';
end $$;
delete from public.recovery_periods;

-- ---- Voids ---------------------------------------------------------------
-- Voiding Sep 16's breakfast makes it unlogged: WIS -2 - 2 = -4 (still 10).
-- Its meal-slot XP disappears.
insert into public.events (user_id, type, payload)
select :A, 'void', jsonb_build_object('target_event_id', e.id)
from public.events e where e.user_id = :A and e.type = 'food' and e.local_date = '2026-09-16';
select game.recompute(:A, '2026-09-14', '2026-09-21');
do $$ begin
  assert (select (progress ->> 'wis')::numeric from public.stat_snapshots
          where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and local_date = '2026-09-21') = -4, 'WIS -4';
  assert (select sum(xp) from public.xp_ledger where track_code = 'quartermaster') = 400, 'voided meal loses its 5 XP';
end $$;

-- ---- Rebalancing: publish v3, replay ---------------------------------------
-- T1 sets worth 10 instead of 8: barbarian +2 x 3 sets x 7 sessions = +42.
insert into public.rules_versions (version, notes) values (3, 'test: heavier T1');
insert into public.rules_config (version, key, value, notes)
select 3, key, value, notes from public.rules_config where version = 2;
update public.rules_config set value = jsonb_set(value, '{by_tier,T1,xp}', '10')
where version = 3 and key = 'xp.workout_set';
update public.rules_versions set is_active = (version = 3);
select game.replay_all();
do $$ begin
  assert (select sum(xp) from public.xp_ledger where track_code = 'barbarian') = 280, 'v3 barbarian 238 + 42';
  assert (select bool_and(rules_version = 3) from public.xp_ledger), 'ledger rebuilt under v3';
  assert (select bool_and(rules_version = 3) from public.stat_snapshots), 'snapshots rebuilt under v3';
end $$;

-- ---- recompute_recent and client access -----------------------------------
do $$ begin
  assert game.recompute_recent(21) = 1, 'only users with events or settings';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
do $$ begin
  assert not exists (select 1 from public.xp_ledger), 'B sees none of A''s XP';
  assert not exists (select 1 from public.stat_snapshots), 'B sees none of A''s stats';
  begin
    perform game.recompute('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_date, current_date);
    assert false, 'clients must not run the engine';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
do $$ begin
  assert (select count(*) from public.stat_snapshots) > 0, 'A reads own stats';
  assert (select level from public.character_level) >= 5, 'A reads own level';
end $$;
reset role;

-- ---- Climbing and falling: a second player -----------------------------------
-- C starts Aug 1 and fully logs Aug 1-14: 14 good days of WIS, a score of
-- 11 on Aug 14. Then nothing: Aug 15 - Sep 20 is 37 unlogged days,
-- -74 -> -60, which is 8 on the ladder (9 at -14, 8 at -35, 7 at -63).
insert into auth.users (id, email) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@example.com');
insert into public.user_settings (user_id, effective_from, calorie_target, protein_g, carbs_g, fat_g, water_goal_ml)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-08-01', 2000, 150, 200, 70, 2500);
\o /dev/null
do $$
declare d date; m public.meal; ev bigint;
begin
  for d in select generate_series(date '2026-08-01', date '2026-08-14', interval '1 day')::date loop
    foreach m in array array['breakfast', 'lunch', 'dinner']::public.meal[] loop
      insert into public.events (user_id, type, occurred_at)
      values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'food', (d + time '12:00') at time zone 'America/Chicago')
      returning id into ev;
      insert into public.food_log (event_id, food_id, grams, meal)
      values (ev, (select id from public.foods where source_id = 't-chicken'), 100, m);
    end loop;
  end loop;
end $$;
-- A workout imported from Liftosaur, from before C started playing.
do $$ declare s bigint; ev bigint; begin
  insert into public.events (user_id, type, occurred_at, source, source_ref)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'workout_session', '2026-07-20 17:00-05', 'liftosaur', 'c:1') returning id into s;
  insert into public.workout_sessions (event_id, external_id) values (s, '1');
  insert into public.events (user_id, type, occurred_at, source, source_ref)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'workout_set', '2026-07-20 17:00-05', 'liftosaur', 'c:1:0') returning id into ev;
  insert into public.workout_sets (event_id, session_event_id, exercise, tier, set_index, reps, weight_kg)
  values (ev, s, 'Squat', 'T1', 0, 5, 100);
end $$;
select game.replay('cccccccc-cccc-cccc-cccc-cccccccccccc');
\o
do $$
declare C uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
begin
  assert game.game_starts(C) = '2026-08-01', 'imported history doesn''t start the game';
  assert not exists (select 1 from public.xp_ledger where user_id = C and track_code in ('barbarian', 'fighter')),
         'imported workouts from before the start earn no XP';
  assert (select wis from public.stat_snapshots where user_id = C and local_date = '2026-08-13') = 10,
         '13 good days is still 10';
  assert (select (wis, (progress ->> 'wis')::numeric) = (11, 14::numeric) from public.stat_snapshots
          where user_id = C and local_date = '2026-08-14'), 'two perfect weeks: WIS 11';
  assert (select (wis, (progress ->> 'wis')::numeric) = (8, -60::numeric) from public.stat_snapshots
          where user_id = C and local_date = '2026-09-21'), 'five weeks unlogged: WIS 8';
end $$;

select 'all rules engine tests passed' as result;
