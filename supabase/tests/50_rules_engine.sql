-- Rules engine tests: three made-up weeks for one user, scored against the
-- v1 rules by hand. Runs on a freshly migrated database (run_local.sh).
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

-- ---- Ability scores on Sep 21 ---------------------------------------------
-- Window Sep 8-21; judged days Sep 8-20 (13). Fully logged: 8-12, 14, 15 (7).
-- Unlogged: 13, 17-20 (5). In window: 8-12 (5). Over: 14. Under: 15.
-- WIS 10 + 8x7/13 - 2x5 = 4.3 -> 4
-- DEX 10 + 6x5/13 - 1   = 11.3 -> 11;  CON the same with the under day -> 11
-- INT: rice's calcium is the only measured INT nutrient, far below 50% of
--      1,000 mg on all 7 fully logged days: 10 - 0.5 x 7 = 6.5 -> 7
-- STR: sessions on judged days 5 (8, 10, 12, 14, 15); planned 13 x 4/7 - 1
--      excused = 6.43; 4 x 5/6.43 = 3.11; PR +1; week of Sep 14 missed 4-2-1 = 1
--      -> 10 + 3.11 + 1 - 1 = 13.1 -> 13
-- CHA: date night 3 x 0.5 + weigh-in 0.5 = 2; last log Sep 15 (6 days) -> 12
do $$
declare A uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; s record;
begin
  select * into s from public.stat_snapshots where user_id = A and local_date = '2026-09-21';
  assert s.wis = 4, 'WIS ' || s.wis;
  assert s.dex = 11, 'DEX ' || s.dex;
  assert s.con = 11, 'CON ' || s.con;
  assert s."int" = 7, 'INT ' || s."int";
  assert s.str = 13, 'STR ' || s.str;
  assert s.cha = 12, 'CHA ' || s.cha;
  assert not s.str_frozen, 'not frozen';
  -- Before settings, day-judged stats sit at baseline.
  select * into s from public.stat_snapshots where user_id = A and local_date = '2026-08-25';
  assert (s.wis, s.dex, s.con, s."int", s.cha) = (10, 10, 10, 10, 10), 'baseline before settings';
  assert (select min(local_date) from public.stat_snapshots where user_id = A) = '2026-08-20', 'snapshots start at first event';
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
-- Injury from Sep 17: STR keeps Sep 16's value. On Sep 16 the window is
-- Sep 3-16 with judged days 7-16 (10): 6 sessions / 5.71 planned -> 4
-- (capped), PR +1, no shortfall -> 15.
insert into public.recovery_periods (user_id, reason, starts_on) values (:A, 'injury', '2026-09-17');
select game.recompute(:A, '2026-09-14', '2026-09-21');
do $$ begin
  assert (select str from public.stat_snapshots
          where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and local_date = '2026-09-21') = 15, 'frozen STR';
  assert (select str_frozen from public.stat_snapshots
          where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and local_date = '2026-09-21'), 'marked frozen';
  assert not (select str_frozen from public.stat_snapshots
              where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and local_date = '2026-09-16'), 'day before not frozen';
end $$;
delete from public.recovery_periods;

-- ---- Voids ---------------------------------------------------------------
-- Voiding Sep 16's breakfast makes it unlogged: WIS 10 + 4.31 - 12 -> 2.3,
-- clamped to 3. Its meal-slot XP disappears.
insert into public.events (user_id, type, payload)
select :A, 'void', jsonb_build_object('target_event_id', e.id)
from public.events e where e.user_id = :A and e.type = 'food' and e.local_date = '2026-09-16';
select game.recompute(:A, '2026-09-14', '2026-09-21');
do $$ begin
  assert (select wis from public.stat_snapshots
          where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and local_date = '2026-09-21') = 3, 'WIS clamped at 3';
  assert (select sum(xp) from public.xp_ledger where track_code = 'quartermaster') = 400, 'voided meal loses its 5 XP';
end $$;

-- ---- Rebalancing: publish v2, replay ---------------------------------------
-- T1 sets worth 10 instead of 8: barbarian +2 x 3 sets x 7 sessions = +42.
insert into public.rules_versions (version, notes) values (2, 'test: heavier T1');
insert into public.rules_config (version, key, value, notes)
select 2, key, value, notes from public.rules_config where version = 1;
update public.rules_config set value = jsonb_set(value, '{by_tier,T1,xp}', '10')
where version = 2 and key = 'xp.workout_set';
update public.rules_versions set is_active = false where version = 1;
update public.rules_versions set is_active = true where version = 2;
select game.replay_all();
do $$ begin
  assert (select sum(xp) from public.xp_ledger where track_code = 'barbarian') = 280, 'v2 barbarian 238 + 42';
  assert (select bool_and(rules_version = 2) from public.xp_ledger), 'ledger rebuilt under v2';
  assert (select bool_and(rules_version = 2) from public.stat_snapshots), 'snapshots rebuilt under v2';
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

select 'all rules engine tests passed' as result;
