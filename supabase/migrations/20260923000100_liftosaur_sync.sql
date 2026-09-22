-- Statblock: Liftosaur sync (staging, apply, PR view)
--
-- scripts/liftosaur/sync.py fetches a user's Liftosaur history, parses each
-- record into a session plus sets (with GZCL tiers from the program), stages
-- them in liftosaur.stage_records and calls liftosaur.apply_records() in the
-- same transaction.
--
-- Each Liftosaur record becomes one workout_session event and one
-- workout_set event per set, all with source 'liftosaur'. source_ref is
-- 'lft:<record id>@<text hash>' for the session and '...:<set index>' for
-- sets, so re-syncing an unchanged record is a no-op. A record whose text
-- changed (edited in Liftosaur) has its old events voided and new ones
-- written; a record missing from the synced window (deleted in Liftosaur)
-- is voided. events stays append-only throughout.
--
-- The liftosaur schema is server-only: no grants to clients, RLS on with no
-- policies.

create schema liftosaur;

create unlogged table liftosaur.stage_records (
  user_id     uuid not null,
  record_id   bigint not null,
  text_hash   text not null,
  occurred_at timestamptz not null,
  program     text,
  day_name    text,
  week        smallint,
  day_in_week smallint,
  duration_s  integer,
  sets        jsonb not null,   -- [{exercise, tier, set_index, reps, weight_kg, is_warmup, target_reps, target_weight_kg}]
  primary key (user_id, record_id)
);

alter table liftosaur.stage_records enable row level security;

-- Apply the staged records of one user.
-- p_since: the start of the window that was fetched. Live synced sessions
-- from then on that aren't staged were deleted in Liftosaur and get voided.
-- Null means the whole history was fetched.
create or replace function liftosaur.apply_records(p_user uuid, p_since timestamptz)
returns table (inserted integer, replaced integer, removed integer, unchanged integer)
language plpgsql
set client_min_messages = warning
as $$
#variable_conflict use_column
declare
  r record;
  s jsonb;
  session_id bigint;
  set_id bigint;
  ref text;
  n_revisions integer;
  n_inserted integer := 0;
  n_replaced integer := 0;
  n_removed integer := 0;
  n_unchanged integer := 0;
begin
  drop table if exists _live;
  create temp table _live as
  select e.id, ws.external_id::bigint as record_id,
         split_part(split_part(e.source_ref, '@', 2), '~', 1) as text_hash,
         e.occurred_at
  from public.live_events e
  join public.workout_sessions ws on ws.event_id = e.id
  where e.user_id = p_user and e.source = 'liftosaur' and e.type = 'workout_session';

  -- Void edited records' old revisions and records deleted in Liftosaur.
  for r in
    select l.id, (st.record_id is not null) as edited
    from _live l
    left join liftosaur.stage_records st
      on st.user_id = p_user and st.record_id = l.record_id
    where (st.record_id is not null and st.text_hash <> l.text_hash)
       or (st.record_id is null and (p_since is null or l.occurred_at >= p_since))
  loop
    insert into public.events (user_id, type, source, payload)
    select p_user, 'void', 'liftosaur', jsonb_build_object('target_event_id', x.id)
    from (select r.id
          union all
          select ws.event_id from public.workout_sets ws
          join public.live_events e on e.id = ws.event_id
          where ws.session_event_id = r.id) x;
    if r.edited then n_replaced := n_replaced + 1; else n_removed := n_removed + 1; end if;
  end loop;

  -- Insert new records and new revisions of edited ones.
  for r in
    select st.*
    from liftosaur.stage_records st
    where st.user_id = p_user
    order by st.occurred_at
  loop
    if exists (select 1 from _live l where l.record_id = r.record_id and l.text_hash = r.text_hash) then
      n_unchanged := n_unchanged + 1;
      continue;
    end if;
    if not exists (select 1 from _live l where l.record_id = r.record_id) then
      n_inserted := n_inserted + 1;
    end if;

    -- A revision voided earlier can come back (an edit undone), and
    -- source_ref must stay unique, so later copies get a ~n suffix.
    ref := 'lft:' || r.record_id || '@' || r.text_hash;
    select count(*) into n_revisions from public.events
    where user_id = p_user and source = 'liftosaur' and type = 'workout_session'
      and (source_ref = ref or source_ref like ref || '~%');
    if n_revisions > 0 then
      ref := ref || '~' || n_revisions;
    end if;

    insert into public.events (user_id, type, occurred_at, source, source_ref)
    values (p_user, 'workout_session', r.occurred_at, 'liftosaur', ref)
    returning id into session_id;
    insert into public.workout_sessions (event_id, external_id, program, day_name, week, day_in_week, duration_s)
    values (session_id, r.record_id::text, nullif(r.program, ''), nullif(r.day_name, ''),
            r.week, r.day_in_week, r.duration_s);

    for s in select * from jsonb_array_elements(r.sets) loop
      insert into public.events (user_id, type, occurred_at, source, source_ref)
      values (p_user, 'workout_set', r.occurred_at, 'liftosaur', ref || ':' || (s ->> 'set_index'))
      returning id into set_id;
      insert into public.workout_sets
        (event_id, session_event_id, exercise, tier, set_index, reps, weight_kg,
         is_warmup, target_reps, target_weight_kg)
      values (set_id, session_id, s ->> 'exercise', s ->> 'tier', (s ->> 'set_index')::smallint,
              (s ->> 'reps')::smallint, (s ->> 'weight_kg')::numeric, (s ->> 'is_warmup')::boolean,
              (s ->> 'target_reps')::smallint, (s ->> 'target_weight_kg')::numeric);
    end loop;
  end loop;

  delete from liftosaur.stage_records where user_id = p_user;
  drop table _live;
  return query select n_inserted, n_replaced, n_removed, n_unchanged;
end;
$$;

revoke all on function liftosaur.apply_records(uuid, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- Personal records
-- ---------------------------------------------------------------------------
-- Every live working set with an estimated 1RM, next to the best estimate
-- for that exercise before it. is_pr is true when it beats every earlier
-- set; a user's first set of an exercise sets the baseline and isn't a PR.
-- One session can hold several PR sets (a top set, then a bigger AMRAP), so
-- the rules engine should count PRs per exercise per session, not per set.
create view public.workout_prs
with (security_invoker = true) as
select *, (previous_best_kg is not null and est_1rm_kg > previous_best_kg) as is_pr
from (
  select ws.event_id, e.user_id, e.occurred_at, e.local_date, ws.session_event_id,
         ws.exercise, ws.tier, ws.reps, ws.weight_kg, ws.est_1rm_kg,
         max(ws.est_1rm_kg) over (
           partition by e.user_id, ws.exercise
           order by e.occurred_at, ws.set_index
           rows between unbounded preceding and 1 preceding) as previous_best_kg
  from public.live_events e
  join public.workout_sets ws on ws.event_id = e.id
  where not ws.is_warmup and ws.est_1rm_kg is not null
) x;
