set client_min_messages = warning;
-- e2e seed: the PostgREST login role, one user, and ten Rippler-style
-- sessions over the last three weeks so the character sheet has XP.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'auth' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'charles@example.com');
update public.profiles set display_name = 'Charles' where user_id = '11111111-1111-1111-1111-111111111111';

do $$
declare u uuid := '11111111-1111-1111-1111-111111111111'; s bigint; ev bigint; d date; i int;
begin
  for d in select generate_series(current_date - 20, current_date - 1, interval '2 day')::date loop
    insert into public.events (user_id, type, occurred_at, source, source_ref)
      values (u, 'workout_session', d + time '17:00', 'liftosaur', 'e2e:' || d) returning id into s;
    insert into public.workout_sessions (event_id, external_id, program) values (s, d::text, 'GZCL: The Rippler');
    for i in 0..8 loop
      insert into public.events (user_id, type, occurred_at, source, source_ref)
        values (u, 'workout_set', d + time '17:00', 'liftosaur', 'e2e:' || d || ':' || i) returning id into ev;
      insert into public.workout_sets (event_id, session_event_id, exercise, tier, set_index, reps, weight_kg)
        values (ev, s, case when i < 4 then 'Squat' when i < 7 then 'Leg Press' else 'Leg Curl' end,
                case when i < 4 then 'T1' when i < 7 then 'T2' else 'T3' end, i,
                case when i < 4 then 3 else 10 end, 100 + (d - current_date + 20));
    end loop;
  end loop;
  -- Today's session (the dashboard's Training card): a heavier squat is a PR.
  insert into public.events (user_id, type, occurred_at, source, source_ref)
    values (u, 'workout_session', now() - interval '1 minute', 'liftosaur', 'e2e:today') returning id into s;
  insert into public.workout_sessions (event_id, external_id, program, week, day_in_week)
    values (s, 'today', 'GZCL: The Rippler', 3, 2);
  for i in 0..6 loop
    insert into public.events (user_id, type, occurred_at, source, source_ref)
      values (u, 'workout_set', now() - interval '1 minute', 'liftosaur', 'e2e:today:' || i) returning id into ev;
    insert into public.workout_sets (event_id, session_event_id, exercise, tier, set_index, reps, weight_kg, is_warmup)
      values (ev, s, case when i < 5 then 'Squat' else 'Leg Press' end,
              case when i < 5 then 'T1' else 'T2' end, i, case when i < 5 then 3 else 10 end,
              case when i = 0 then 60 when i < 5 then 124.74 else 99.79 end, i = 0);
  end loop;
  perform game.replay(u);
end $$;
