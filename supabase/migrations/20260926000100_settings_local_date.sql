-- Statblock: settings edits follow the user's own calendar day
--
-- The user_settings and user_nutrient_targets policies compared
-- effective_from with current_date, which is the UTC date. In Chicago that
-- rolls over at 7 pm (6 pm in winter), so an evening edit of today's targets
-- was refused. They now use my_today(), the caller's date in
-- profiles.timezone.
--
-- Inserts get the same rule: a new row can start today or later, never in
-- the past, so past days always keep the targets they were scored against.

create or replace function public.my_today()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (now() at time zone p.timezone)::date from public.profiles p where p.user_id = auth.uid()),
    current_date)
$$;

revoke all on function public.my_today() from public;
grant execute on function public.my_today() to authenticated;

drop policy "own: add" on public.user_settings;
drop policy "own: edit current or future" on public.user_settings;
create policy "own: add from today" on public.user_settings for insert to authenticated
  with check (user_id = auth.uid() and effective_from >= public.my_today());
create policy "own: edit current or future" on public.user_settings for update to authenticated
  using (user_id = auth.uid() and effective_from >= public.my_today())
  with check (user_id = auth.uid() and effective_from >= public.my_today());

drop policy "own: add" on public.user_nutrient_targets;
drop policy "own: edit current or future" on public.user_nutrient_targets;
create policy "own: add from today" on public.user_nutrient_targets for insert to authenticated
  with check (user_id = auth.uid() and effective_from >= public.my_today());
create policy "own: edit current or future" on public.user_nutrient_targets for update to authenticated
  using (user_id = auth.uid() and effective_from >= public.my_today())
  with check (user_id = auth.uid() and effective_from >= public.my_today());
