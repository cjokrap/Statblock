-- Statblock: integrations, portrait storage and new-user defaults

-- ---------------------------------------------------------------------------
-- Integrations (Liftosaur first)
-- ---------------------------------------------------------------------------
-- The API key itself lives in Supabase Vault (encrypted at rest). This table
-- only stores the Vault secret id plus sync state. Clients can read their own
-- row (status, last sync) but never the key; only the server writes here.
create table public.integrations (
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider        text not null check (provider in ('liftosaur')),
  vault_secret_id uuid not null,
  status          text not null default 'connected'
                    check (status in ('connected', 'error', 'disconnected')),
  connected_at    timestamptz not null default now(),
  last_synced_at  timestamptz,
  sync_cursor     text,          -- Liftosaur pagination cursor / last record date
  last_error      text,
  primary key (user_id, provider)
);

-- Store or replace a user's Liftosaur key. Called by the server after it has
-- validated the key with a test request to Liftosaur. Service role only.
create or replace function public.set_liftosaur_key(p_user_id uuid, p_api_key text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing uuid;
  secret_id uuid;
begin
  if p_api_key !~ '^lftsk_[A-Za-z0-9_-]+$' then
    raise exception 'not a Liftosaur API key';
  end if;

  select vault_secret_id into existing
  from public.integrations
  where user_id = p_user_id and provider = 'liftosaur';

  if existing is not null then
    perform vault.update_secret(existing, p_api_key);
    update public.integrations
       set status = 'connected', last_error = null, connected_at = now()
     where user_id = p_user_id and provider = 'liftosaur';
  else
    secret_id := vault.create_secret(p_api_key, 'liftosaur:' || p_user_id::text,
                                     'Liftosaur API key');
    insert into public.integrations (user_id, provider, vault_secret_id)
    values (p_user_id, 'liftosaur', secret_id);
  end if;
end;
$$;

revoke all on function public.set_liftosaur_key(uuid, text) from public;
revoke all on function public.set_liftosaur_key(uuid, text) from anon, authenticated;
grant execute on function public.set_liftosaur_key(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Character portraits: private bucket, one folder per user (<user_id>/...)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portraits', 'portraits', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "portraits: read own"
  on storage.objects for select to authenticated
  using (bucket_id = 'portraits' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "portraits: upload own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'portraits' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "portraits: replace own"
  on storage.objects for update to authenticated
  using (bucket_id = 'portraits' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "portraits: delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'portraits' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- New-user defaults: a profile and the default CHA quick-log categories.
-- Targets are created during first-run setup, not here.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));

  insert into public.self_care_categories (user_id, name, weight, sort)
  values (new.id, 'Date night', 3, 1),
         (new.id, 'Friends / D&D', 2, 2),
         (new.id, 'Hobby / self-care', 1, 3);
  -- Weigh-ins feed CHA through their own event type, not a category.

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
