-- Statblock: let the app rescore the signed-in user after a log.
--
-- game.recompute is server-only. This wrapper runs it for auth.uid() over
-- yesterday and today (so a late-night log or an edit to yesterday counts at
-- once). recompute widens that to the start of the week for the weekly
-- bosses. The scheduled job still rescores the last 21 days every 2 hours.

create or replace function public.rescore_me()
returns void
language plpgsql
security definer
set search_path = public, game
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;
  perform game.recompute(v_user, game.today(v_user) - 1, game.today(v_user));
end;
$$;

revoke all on function public.rescore_me() from public;
revoke all on function public.rescore_me() from anon;
grant execute on function public.rescore_me() to authenticated;
