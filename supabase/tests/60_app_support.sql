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

select 'all app support tests passed' as result;
