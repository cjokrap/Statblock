-- Behavior tests for the schema. Run after the migrations on a scratch
-- database (see supabase/tests/run_local.sh). Any failed assert aborts.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''

-- ---------------------------------------------------------------------------
-- Setup as the database owner (like the Supabase service role)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values (:A, 'a@example.com'), (:B, 'b@example.com');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'signup trigger creates profiles';
  assert (select count(*) from public.self_care_categories) = 6, 'signup trigger creates 3 CHA categories each';
  assert (select weight from public.self_care_categories
          where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Date night') = 3,
         'date night weighs 3x';
end $$;

insert into public.foods (source, source_id, name, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g) values
  ('usda_sr_legacy', '174036', 'Beef, ground, 93% lean meat / 7% fat, raw', 152, 21, 0, 7, 0),
  ('usda_branded',   '999001', 'Ground beef 93/7', 150, 21, 0, 7, 0),
  ('usda_foundation','748967', 'Eggs, Grade A, Large, egg whole', 143, 12.4, 1, 9.5, 0);

insert into public.supplements (source, source_id, name, brand) values
  ('dsld', 'test-1', 'Multivitamin for men', 'Example Brand'),
  ('dsld', 'test-2', 'Fiber supplement', 'Example Brand');

-- ---------------------------------------------------------------------------
-- As user A
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

-- Effective-dated settings. Users can only add rows from today on, so the
-- dated rows go in as the owner (60_app_support.sql tests the policies).
reset role;
insert into public.user_settings (user_id, effective_from, calorie_target, protein_g, carbs_g, fat_g, water_goal_ml, rest_days)
values (:A, date '2026-09-01', 2000, 180, 170, 67, round(public.oz_to_ml(100)), '{3,7}'),
       (:A, date '2026-10-01', 1900, 180, 150, 64, round(public.oz_to_ml(100)), '{3,7}');
set role authenticated;

do $$ begin
  assert (public.settings_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', date '2026-09-22')).calorie_target = 2000,
         'settings_for picks the row in force';
  assert (public.settings_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', date '2026-10-05')).calorie_target = 1900,
         'settings_for picks the later row after it starts';
  assert (public.settings_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', date '2026-08-01')) is null,
         'no settings before the first row';
  assert (public.settings_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', date '2026-09-22')).water_goal_ml = 2957,
         '100 oz stored as 2957 mL';
end $$;

-- Past settings rows cannot be edited (policy filters them out).
update public.user_settings set calorie_target = 2500 where effective_from = '2026-09-01';
do $$ begin
  assert (select calorie_target from public.user_settings where effective_from = '2026-09-01') = 2000,
         'past settings are immutable';
end $$;

-- Custom food, visible only to A
insert into public.foods (source, owner_user_id, name, kcal_100g, protein_100g, carbs_100g, fat_100g)
values ('custom', :A, 'Charles protein oats', 380, 30, 45, 8);

-- Search ranks whole foods above branded
do $$ declare first_source text; begin
  select source into first_source from public.search_foods('ground beef') limit 1;
  assert first_source = 'usda_sr_legacy', 'whole food ranks first, got ' || coalesce(first_source, 'none');
end $$;

-- Log lunch: 200 g ground beef, then 64 oz of water
select public.log_food((select id from public.foods where source_id = '174036'), 200, 'lunch',
                       timestamptz '2026-09-22 12:30:00-05');
select public.log_water(round(public.oz_to_ml(64))::integer, timestamptz '2026-09-22 15:00:00-05');

do $$ begin
  assert (select local_date from public.events where type = 'food') = date '2026-09-22',
         'local_date derived from the user time zone';
  assert (select kcal from public.daily_food_totals where local_date = '2026-09-22') = 304,
         '200 g of 93% lean beef = 304 kcal';
  assert (select protein_g from public.daily_food_totals where local_date = '2026-09-22') = 42, 'protein 42 g';
  assert (select round(public.ml_to_oz(ml)) from public.daily_water_totals where local_date = '2026-09-22') = 64,
         'water totals in oz';
end $$;

-- A late-night entry lands on the right local day (11:30 PM Central = next day UTC)
insert into public.daily_stack_items (user_id, supplement_id)
select :A, id from public.supplements;
select public.log_stack(timestamptz '2026-09-22 23:30:00-05');
do $$ begin
  assert (select local_date from public.events where type = 'stack_taken') = date '2026-09-22',
         'late-night event stays on the local day';
  assert (select count(*) from public.stack_log) = 2, 'stack snapshot has both supplements';
end $$;

-- CHA quick log uses the category weight at the time
select public.log_self_care((select id from public.self_care_categories where name = 'Date night'));
do $$ begin
  assert (select weight from public.self_care_log) = 3, 'date night logged at 3x';
end $$;

-- Injury skip opens a recovery period; ending it closes it
select public.log_skip('injury');
do $$ begin
  assert (select count(*) from public.recovery_periods where ends_on is null) = 1, 'recovery period open';
end $$;
select public.end_recovery();
do $$ begin
  assert (select count(*) from public.recovery_periods where ends_on is null) = 0, 'recovery period closed';
end $$;

-- Events are append-only: clients have no update policy, so updates touch nothing
update public.events set occurred_at = now() where type = 'food';
do $$ begin
  assert (select occurred_at from public.events where type = 'food') = timestamptz '2026-09-22 12:30:00-05',
         'client update changes nothing';
end $$;
delete from public.events where type = 'water';
do $$ begin
  assert (select count(*) from public.events where type = 'water') = 1, 'delete is not allowed (no policy)';
end $$;

-- Clients cannot forge synced events
do $$ begin
  begin
    insert into public.events (user_id, type, source, source_ref)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'workout_set', 'liftosaur', 'x');
    assert false, 'client insert with source=liftosaur should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Clients cannot write game output
do $$ begin
  begin
    insert into public.xp_ledger (user_id, local_date, track_code, xp, rule_key, rules_version)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'barbarian', 9999, 'cheat', 1);
    assert false, 'client insert into xp_ledger should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Clients cannot call the key-storing function
do $$ begin
  begin
    perform public.set_liftosaur_key('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lftsk_test');
    assert false, 'authenticated must not store keys directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Void corrects the log without deleting anything
select public.void_event((select id from public.events where type = 'food'));
do $$ begin
  assert (select count(*) from public.events where type = 'food') = 1, 'original event still stored';
  assert not exists (select 1 from public.daily_food_totals where local_date = '2026-09-22'),
         'voided food drops out of totals';
end $$;

-- Portrait uploads only into your own folder
insert into storage.objects (bucket_id, name) values ('portraits', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/portrait.jpg');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('portraits', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/portrait.jpg');
    assert false, 'upload into another user folder should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- As user B: sees none of A's data
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

do $$ begin
  assert (select count(*) from public.events) = 0, 'B sees no events of A';
  assert (select count(*) from public.user_settings) = 0, 'B sees no settings of A';
  assert (select count(*) from public.profiles) = 1, 'B sees only own profile';
  assert (select count(*) from public.foods where source = 'custom') = 0, 'B cannot see A custom food';
  assert (select count(*) from public.foods) = 3, 'B sees shared USDA foods';
  assert (select count(*) from public.food_log) = 0, 'B sees no food_log rows of A';
  assert (select count(*) from storage.objects) = 0, 'B cannot see A portrait';
  assert (select count(*) from public.nutrients) > 20, 'reference data readable';
end $$;

-- B cannot attach detail rows to A's event
do $$ begin
  begin
    insert into public.water_log (event_id, ml) values (2, 500);  -- event 2 is A's water event
    assert false, 'detail row on another user event should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B cannot void A's event
do $$ begin
  begin
    insert into public.events (user_id, type, payload)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'void', '{"target_event_id": 2}');
    assert false, 'voiding another user event should fail';
  exception when raise_exception then null;
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Server-side (service role) behavior
-- ---------------------------------------------------------------------------
set role service_role;

select public.set_liftosaur_key('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lftsk_first_key');
select public.set_liftosaur_key('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lftsk_rotated_key');
reset role;

-- Even the server cannot rewrite events (trigger), only void them
do $$ begin
  begin
    update public.events set occurred_at = now() where type = 'food';
    assert false, 'server update on events should fail';
  exception when raise_exception then null;
  end;
end $$;

do $$ begin
  assert (select count(*) from public.integrations) = 1, 'one integration row per provider';
  assert (select count(*) from vault.secrets) = 1, 'rotating a key updates the same secret';
  assert (select secret from vault.secrets) = 'lftsk_rotated_key', 'secret was rotated';
  begin
    perform public.set_liftosaur_key('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'not-a-key');
    assert false, 'bad key format should fail';
  exception when raise_exception then null;
  end;
end $$;

-- Synced workout sets dedupe on source_ref, and 1RM is estimated
insert into public.events (user_id, type, source, source_ref, occurred_at)
values (:A, 'workout_set', 'liftosaur', 'hist_123:0', timestamptz '2026-09-22 09:00:00-05');
insert into public.workout_sets (event_id, exercise, tier, set_index, reps, weight_kg)
select id, 'Squat, Barbell', 'T1', 0, 3, round(public.lb_to_kg(275), 2) from public.events where source_ref = 'hist_123:0';

do $$ begin
  begin
    insert into public.events (user_id, type, source, source_ref)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'workout_set', 'liftosaur', 'hist_123:0');
    assert false, 'duplicate synced event should fail';
  exception when unique_violation then null;
  end;
  assert (select round(public.kg_to_lb(est_1rm_kg)) from public.workout_sets) between 302 and 303,
         'Epley 1RM for 275 x 3 is about 302.5 lb';
end $$;

-- Levels follow the rules-config thresholds
do $$ begin
  assert public.level_for_xp(0) = 1, 'level 1 at 0 XP';
  assert public.level_for_xp(29) = 1, 'still level 1 at 29 XP';
  assert public.level_for_xp(30) = 2, 'level 2 at 30 XP';
  assert public.level_for_xp(300) = 4, 'level 4 at 300 XP';
  assert public.level_for_xp(35500) = 20, 'level 20 cap';
end $$;

-- DRI lookup sanity
do $$ begin
  assert (select amount from public.dri_targets d join public.nutrients n on n.id = d.nutrient_id
          where n.code = 'magnesium' and d.sex = 'male' and 40 between d.age_min and d.age_max) = 420,
         'magnesium RDA, men 31-50';
  assert (select count(*) from public.nutrients where counts_for_int) = 20, '20 INT nutrients';
end $$;

select 'all schema tests passed' as result;
