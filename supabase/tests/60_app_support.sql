-- App support: rescore_me() scores the caller's own day, and only theirs.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.com');
insert into public.foods (source, source_id, name, kcal_100g, protein_100g, carbs_100g, fat_100g)
values ('usda_sr_legacy', 't-egg', 'Test egg', 143, 12.6, 0.7, 9.5);

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
\o /dev/null
select public.log_food((select id from public.foods where source_id = 't-egg'), 150, 'breakfast');
select public.rescore_me();
\o
do $$ begin
  assert (select sum(xp) from public.xp_ledger where rule_key = 'xp.meal_slot_logged') = 5,
         'logging breakfast earns 5 Quartermaster XP right away';
  begin
    perform game.recompute('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, current_date);
    assert false, 'clients still can''t run the engine directly';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
\o /dev/null
select public.rescore_me();
\o
do $$ begin
  assert not exists (select 1 from public.xp_ledger), 'B sees no XP and gained none';
end $$;

reset role;
do $$ begin
  assert (select count(*) from public.xp_ledger) = 1, 'B''s rescore left A''s XP alone';
  assert (select user_id from public.xp_ledger) = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'XP is A''s';
end $$;

set role anon;
do $$ begin
  begin
    perform public.rescore_me();
    assert false, 'anon can''t rescore';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Settings follow the user's own calendar day (profiles.timezone), not UTC.
-- Kiritimati (UTC+14) is always 1-2 days ahead of Etc/GMT+12 (UTC-12).
update public.profiles set timezone = 'Pacific/Kiritimati' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
do $$
declare
  today date := (now() at time zone 'Pacific/Kiritimati')::date;
  behind date := (now() at time zone 'Etc/GMT+12')::date;
begin
  assert public.my_today() = today, 'my_today() is the date in the profile time zone';
  insert into public.user_settings (user_id, effective_from, calorie_target, protein_g, carbs_g, fat_g, water_goal_ml)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', today, 2000, 180, 170, 67, 2957);
  update public.user_settings set calorie_target = 2100 where effective_from = today;
  assert (select calorie_target from public.user_settings where effective_from = today) = 2100,
         'today''s row (in the user''s time zone) can be edited';
  begin
    insert into public.user_settings (user_id, effective_from, calorie_target, protein_g, carbs_g, fat_g, water_goal_ml)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', behind, 1500, 180, 170, 67, 2957);
    assert false, 'a row starting in the past can''t be added';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
do $$ begin
  assert public.my_today() = (now() at time zone 'America/Chicago')::date, 'B''s day is in B''s time zone';
  assert not exists (select 1 from public.user_settings), 'B can''t see A''s settings';
  begin
    insert into public.user_settings (user_id, effective_from, calorie_target, protein_g, carbs_g, fat_g, water_goal_ml)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', public.my_today() + 1, 1500, 180, 170, 67, 2957);
    assert false, 'B can''t add settings for A';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Liftosaur connect and disconnect: service role only; disconnecting
-- deletes the Vault secret and the integrations row.
select public.set_liftosaur_key('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lftsk_first');
select public.set_liftosaur_key('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lftsk_second');
do $$ begin
  assert (select count(*) from vault.secrets) = 1, 'replacing a key updates the one secret';
  assert (select decrypted_secret from vault.decrypted_secrets) = 'lftsk_second', 'the new key is stored';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
do $$ begin
  assert (select status from public.integrations) = 'connected', 'the user sees their connection';
  begin
    perform public.disconnect_liftosaur('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    assert false, 'clients can''t call disconnect_liftosaur directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_liftosaur_key('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lftsk_x');
    assert false, 'clients can''t call set_liftosaur_key directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select public.disconnect_liftosaur('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.disconnect_liftosaur('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); -- twice is fine
do $$ begin
  assert not exists (select 1 from public.integrations), 'disconnect removes the integration';
  assert not exists (select 1 from vault.secrets), 'disconnect deletes the key from Vault';
end $$;

-- Open Food Facts foods: allowed as a source, ranked with packaged foods,
-- and written by the server only.
insert into public.foods (source, source_id, name, barcode, kcal_100g)
values ('off', '0811620022002', 'Core Power Chocolate', '0811620022002', 41);
do $$ begin
  assert (select source_rank from public.foods where source = 'off') = 3, 'OFF foods rank as packaged';
end $$;
set role authenticated;
do $$ begin
  assert (select count(*) from public.search_foods('core power')) = 1, 'OFF foods show in search';
  begin
    insert into public.foods (source, source_id, name) values ('off', '1', 'Mine');
    assert false, 'clients can''t add OFF foods';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Editing a logged food: a void plus a new entry at the same time, only
-- for the caller's own live entries.
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
do $$
declare old_id bigint; new_id bigint; old_at timestamptz;
begin
  old_id := public.log_food((select id from public.foods where source_id = 't-egg'), 100, 'lunch',
                            now() - interval '1 hour', '2 × 1 large');
  select occurred_at into old_at from public.events where id = old_id;
  new_id := public.edit_food_log(old_id, 150, 'dinner', '3 × 1 large');
  assert not exists (select 1 from public.live_events where id = old_id), 'the old entry is voided';
  assert (select (fl.grams, fl.meal::text, fl.portion_label, e.occurred_at) = (150::numeric, 'dinner', '3 × 1 large', old_at)
          from public.food_log fl join public.events e on e.id = fl.event_id where fl.event_id = new_id),
         'the new entry has the new amount and meal, at the original time';
  begin
    perform public.edit_food_log(old_id, 50, 'lunch');
    assert false, 'a voided entry can''t be edited again';
  exception when raise_exception then null;
  end;
  begin
    perform public.edit_food_log(new_id, 0, 'lunch');
    assert false, 'zero grams is refused';
  exception when raise_exception then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
do $$ begin
  begin
    perform public.edit_food_log((select max(id) from public.events where type = 'food'), 10, 'snack');
    assert false, 'B can''t edit A''s entry';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- Fiber goal: optional, 0-150 g, and settings_for returns it.
update public.user_settings set fiber_g = 35 where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
do $$ begin
  assert (public.settings_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (now() at time zone 'Pacific/Kiritimati')::date)).fiber_g = 35,
         'settings_for carries the fiber goal';
  begin
    update public.user_settings set fiber_g = 500;
    assert false, 'a 500 g fiber goal is refused';
  exception when check_violation then null;
  end;
end $$;

-- Favorites: own rows only, one per food.
insert into public.foods (source, source_id, name, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g)
values ('usda_sr_legacy', 't-pasta', 'Test pasta, dry', 371, 13, 75, 1.5, 3.2);
insert into public.food_nutrients (food_id, nutrient_id, amount_100g)
select f.id, n.id, 10 from public.foods f, (select min(id) as id from public.nutrients where counts_for_int) n
where f.source_id in ('t-egg', 't-pasta');
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
insert into public.food_favorites (food_id, grams, portion_label)
values ((select id from public.foods where source_id = 't-egg'), 100, '2 large');
do $$ begin
  begin
    insert into public.food_favorites (food_id, grams) values ((select id from public.foods where source_id = 't-egg'), 50);
    assert false, 'one favorite per food';
  exception when unique_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
do $$ begin
  assert not exists (select 1 from public.food_favorites), 'B doesn''t see A''s favorites';
end $$;

-- Recipes: totals from ingredients, by cooked weight, exact match first.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
do $$
declare
  rid bigint;
  f1 bigint;
  f2 bigint;
  egg bigint := (select id from public.foods where source_id = 't-egg');
  pasta bigint := (select id from public.foods where source_id = 't-pasta');
  ing bigint;
begin
  rid := public.create_recipe('  Parko High Protein Pasta ');
  f1 := (select food_id from public.recipes where id = rid);
  assert (select name from public.foods where id = f1) = 'Parko High Protein Pasta', 'the recipe has a food, trimmed';
  assert (select retired_at is not null from public.foods where id = f1), 'an empty recipe is hidden from search';

  perform public.add_recipe_ingredient(rid, pasta, 200, '2 cups');
  perform public.add_recipe_ingredient(rid, egg, 100);
  assert (select food_id from public.recipes where id = rid) = f1, 'an unlogged recipe keeps its food';
  assert (select kcal_100g from public.foods where id = f1) = 295, 'kcal per 100 g over the ingredients'' 300 g';
  assert (select protein_100g from public.foods where id = f1) = 12.87, 'protein per 100 g';
  assert (select fiber_100g from public.foods where id = f1) = 2.13, 'fiber per 100 g';
  assert (select amount_100g from public.food_nutrients where food_id = f1) = 10, 'micronutrients are summed too';
  assert (select retired_at from public.foods where id = f1) is null, 'with ingredients it shows in search';
  assert (select id from public.search_foods('parko high protein pasta') limit 1) = f1, 'an exact name match comes first';
  assert (select id from public.search_foods('pasta') limit 1) = f1, 'your own recipes come before USDA';
  assert (select id from public.search_foods('Test pasta, dry') limit 1) = pasta, 'an exact USDA match beats a recipe';

  perform public.update_recipe(rid, 'Parko High Protein Pasta', 600, 4);
  assert (select kcal_100g from public.foods where id = f1) = 147.5, 'the cooked weight sets the density';
  assert (select grams from public.food_portions where food_id = f1 and label = '1 serving') = 150, 'a serving is a quarter';
  assert (select grams from public.food_portions where food_id = f1 and label = 'whole recipe') = 600, 'and the whole pot';

  insert into public.food_favorites (food_id, grams, portion_label) values (f1, 150, '1 serving');
  perform public.log_food(f1, 150, 'lunch');
  select id into ing from public.recipe_ingredients where recipe_id = rid and food_id = egg;
  perform public.update_recipe_ingredient(ing, 200);
  f2 := (select food_id from public.recipes where id = rid);
  assert f2 <> f1, 'editing a logged recipe moves it to a new food';
  assert (select kcal_100g from public.foods where id = f1) = 147.5, 'the logged version keeps its values';
  assert (select retired_at is not null from public.foods where id = f1), 'and leaves search';
  assert (select kcal_100g from public.foods where id = f2) = 171.33, 'the new version has the new egg amount';
  assert (select count(*) from public.foods where recipe_id = rid) = 2, 'both versions point at the recipe';
  assert (select food_id from public.food_favorites where portion_label = '1 serving') = f2, 'the favorite follows the recipe';

  begin
    perform public.add_recipe_ingredient(rid, f2, 50);
    assert false, 'a recipe can''t be its own ingredient';
  exception when raise_exception then null;
  end;

  perform public.remove_recipe_ingredient(ing);
  assert (select count(*) from public.recipe_ingredients where recipe_id = rid) = 1, 'removed';

  perform public.delete_recipe(rid);
  assert (select retired_at is not null from public.foods where id = f2), 'a deleted recipe leaves search';
  assert not exists (select 1 from public.food_favorites where food_id = f2), 'and favorites';
  assert (select count(*) from public.food_log where food_id = f1) = 1, 'logged entries keep it';
end $$;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
do $$ begin
  assert not exists (select 1 from public.recipes), 'B can''t see A''s recipes';
  begin
    perform public.add_recipe_ingredient(1, (select id from public.foods where source_id = 't-egg'), 10);
    assert false, 'B can''t add to A''s recipe';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_recipe(1, 'Stolen', null, null);
    assert false, 'B can''t rename A''s recipe';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- Fiber quest: food plus the stack's fiber, done when the running total
-- reaches the goal (A's fiber_g is 35).
insert into public.supplements (source, owner_user_id, name, serving_label)
values ('custom', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test fiber caps', '6 capsules');
insert into public.supplement_nutrients (supplement_id, nutrient_id, amount_per_serving)
select s.id, n.id, 3 from public.supplements s, public.nutrients n
where s.name = 'Test fiber caps' and n.code = 'fiber';
insert into public.daily_stack_items (user_id, supplement_id, servings)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', id, 2 from public.supplements where name = 'Test fiber caps';
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
\o /dev/null
select public.log_food((select id from public.foods where source_id = 't-pasta'), 1000, 'dinner');
select public.rescore_me();
\o
do $$
declare
  today date := public.my_today();
  before numeric := (select progress from public.quest_progress where quest_code = 'hit_fiber' and period_start = today);
  stack_ev bigint;
begin
  assert (select target from public.quest_progress where quest_code = 'hit_fiber' and period_start = today) = 35,
         'the fiber goal is the setting';
  assert before >= 32 and before < 35, 'food alone falls short: ' || before;
  assert (select completed_at from public.quest_progress where quest_code = 'hit_fiber' and period_start = today) is null,
         'not done yet';
  stack_ev := public.log_stack();
  perform public.rescore_me();
  assert (select progress from public.quest_progress where quest_code = 'hit_fiber' and period_start = today) = before + 6,
         'two servings of 3 g add 6 g';
  assert (select completed_at from public.quest_progress where quest_code = 'hit_fiber' and period_start = today)
         = (select occurred_at from public.events where id = stack_ev), 'the stack finishes the quest';
  assert (select sum(xp) from public.xp_ledger where rule_key = 'quest.hit_fiber' and local_date = today) = 10,
         '10 Alchemist XP';
end $$;
reset role;

select 'all app support tests passed' as result;
