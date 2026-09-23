-- Statblock: disconnect Liftosaur from the app
--
-- The Settings → Liftosaur screen saves a key with set_liftosaur_key() and
-- removes it with this. Both are service role only; the app calls them from
-- a server action after checking who's signed in. Disconnecting deletes the
-- Vault secret and the integrations row, so the sync skips the user.
-- Workouts already imported stay.
create or replace function public.disconnect_liftosaur(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_secret uuid;
begin
  delete from public.integrations
  where user_id = p_user_id and provider = 'liftosaur'
  returning vault_secret_id into v_secret;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

revoke all on function public.disconnect_liftosaur(uuid) from public;
revoke all on function public.disconnect_liftosaur(uuid) from anon, authenticated;
grant execute on function public.disconnect_liftosaur(uuid) to service_role;
