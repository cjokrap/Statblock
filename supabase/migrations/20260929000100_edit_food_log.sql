-- Statblock: edit a logged food
--
-- events is append-only, so an edit is a correction: one transaction voids
-- the old food entry and logs the new amount or meal with the same food and
-- the same occurred_at. The day, the quest completion times and the
-- meal-slot XP timing stay honest: moving lunch to dinner doesn't make it
-- later, and changing an amount doesn't make it newer.
--
-- Runs as the caller (security invoker), so RLS decides; it also checks the
-- entry is the caller's own live food entry. Returns the new event id.
create or replace function public.edit_food_log(
  p_event_id bigint, p_grams numeric, p_meal public.meal, p_portion_label text default null)
returns bigint
language plpgsql
as $$
declare
  v_food bigint;
  v_at timestamptz;
  v_new bigint;
begin
  select fl.food_id, e.occurred_at into v_food, v_at
  from public.live_events e
  join public.food_log fl on fl.event_id = e.id
  where e.id = p_event_id and e.user_id = auth.uid() and e.type = 'food';
  if v_food is null then
    raise exception 'no such food entry';
  end if;
  if p_grams is null or p_grams <= 0 then
    raise exception 'grams must be positive';
  end if;

  perform public.void_event(p_event_id);
  insert into public.events (user_id, type, occurred_at)
  values (auth.uid(), 'food', v_at) returning id into v_new;
  insert into public.food_log (event_id, food_id, grams, meal, portion_label)
  values (v_new, v_food, p_grams, p_meal, p_portion_label);
  return v_new;
end;
$$;

revoke all on function public.edit_food_log(bigint, numeric, public.meal, text) from public, anon;
grant execute on function public.edit_food_log(bigint, numeric, public.meal, text) to authenticated;
