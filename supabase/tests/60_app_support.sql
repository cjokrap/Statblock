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

select 'all app support tests passed' as result;
