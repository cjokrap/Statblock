-- Statblock: row-level security
--
-- Every table has RLS on. Policies grant the signed-in user their own rows.
-- Reference data is read-only for signed-in users. Game output (XP, stats,
-- quests, loot, achievements) is read-only for users and written by the
-- server with the service role, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.user_settings          enable row level security;
alter table public.user_nutrient_targets  enable row level security;
alter table public.nutrients              enable row level security;
alter table public.dri_targets            enable row level security;
alter table public.foods                  enable row level security;
alter table public.food_nutrients         enable row level security;
alter table public.food_portions          enable row level security;
alter table public.off_products           enable row level security;
alter table public.supplements            enable row level security;
alter table public.supplement_nutrients   enable row level security;
alter table public.daily_stack_items      enable row level security;
alter table public.events                 enable row level security;
alter table public.food_log               enable row level security;
alter table public.water_log              enable row level security;
alter table public.stack_log              enable row level security;
alter table public.weigh_ins              enable row level security;
alter table public.workout_sessions       enable row level security;
alter table public.workout_sets           enable row level security;
alter table public.activities             enable row level security;
alter table public.skips                  enable row level security;
alter table public.recovery_periods       enable row level security;
alter table public.self_care_categories   enable row level security;
alter table public.self_care_log          enable row level security;
alter table public.tracks                 enable row level security;
alter table public.rules_versions         enable row level security;
alter table public.rules_config           enable row level security;
alter table public.xp_ledger              enable row level security;
alter table public.stat_snapshots         enable row level security;
alter table public.quest_definitions      enable row level security;
alter table public.quest_progress         enable row level security;
alter table public.loot_definitions       enable row level security;
alter table public.loot_drops             enable row level security;
alter table public.achievement_definitions enable row level security;
alter table public.achievements_earned    enable row level security;
alter table public.integrations           enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data: read-only for signed-in users
-- ---------------------------------------------------------------------------
create policy "read" on public.nutrients               for select to authenticated using (true);
create policy "read" on public.dri_targets             for select to authenticated using (true);
create policy "read" on public.off_products            for select to authenticated using (true);
create policy "read" on public.tracks                  for select to authenticated using (true);
create policy "read" on public.rules_versions          for select to authenticated using (true);
create policy "read" on public.rules_config            for select to authenticated using (true);
create policy "read" on public.quest_definitions       for select to authenticated using (true);
create policy "read" on public.loot_definitions        for select to authenticated using (true);
create policy "read" on public.achievement_definitions for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Profile and settings
-- ---------------------------------------------------------------------------
create policy "own: read"   on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "own: update" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Settings are effective-dated: users add rows, and may only edit rows that
-- start today or later (past days keep the targets they were scored against).
create policy "own: read" on public.user_settings for select to authenticated
  using (user_id = auth.uid());
create policy "own: add" on public.user_settings for insert to authenticated
  with check (user_id = auth.uid());
create policy "own: edit current or future" on public.user_settings for update to authenticated
  using (user_id = auth.uid() and effective_from >= current_date)
  with check (user_id = auth.uid() and effective_from >= current_date);

create policy "own: read" on public.user_nutrient_targets for select to authenticated
  using (user_id = auth.uid());
create policy "own: add" on public.user_nutrient_targets for insert to authenticated
  with check (user_id = auth.uid());
create policy "own: edit current or future" on public.user_nutrient_targets for update to authenticated
  using (user_id = auth.uid() and effective_from >= current_date)
  with check (user_id = auth.uid() and effective_from >= current_date);

-- ---------------------------------------------------------------------------
-- Foods and supplements: shared rows readable by all; custom rows by owner
-- ---------------------------------------------------------------------------
create policy "shared or own: read" on public.foods for select to authenticated
  using (owner_user_id is null or owner_user_id = auth.uid());
create policy "own custom: add" on public.foods for insert to authenticated
  with check (source = 'custom' and owner_user_id = auth.uid());
create policy "own custom: edit" on public.foods for update to authenticated
  using (owner_user_id = auth.uid()) with check (source = 'custom' and owner_user_id = auth.uid());
create policy "own custom: delete" on public.foods for delete to authenticated
  using (owner_user_id = auth.uid());

create policy "visible food: read" on public.food_nutrients for select to authenticated
  using (exists (select 1 from public.foods f where f.id = food_id));
create policy "own custom: write" on public.food_nutrients for all to authenticated
  using (exists (select 1 from public.foods f where f.id = food_id and f.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.foods f where f.id = food_id and f.owner_user_id = auth.uid()));

create policy "visible food: read" on public.food_portions for select to authenticated
  using (exists (select 1 from public.foods f where f.id = food_id));
create policy "own custom: write" on public.food_portions for all to authenticated
  using (exists (select 1 from public.foods f where f.id = food_id and f.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.foods f where f.id = food_id and f.owner_user_id = auth.uid()));

create policy "shared or own: read" on public.supplements for select to authenticated
  using (owner_user_id is null or owner_user_id = auth.uid());
create policy "own custom: add" on public.supplements for insert to authenticated
  with check (source = 'custom' and owner_user_id = auth.uid());
create policy "own custom: edit" on public.supplements for update to authenticated
  using (owner_user_id = auth.uid()) with check (source = 'custom' and owner_user_id = auth.uid());

create policy "visible supplement: read" on public.supplement_nutrients for select to authenticated
  using (exists (select 1 from public.supplements s where s.id = supplement_id));
create policy "own custom: write" on public.supplement_nutrients for all to authenticated
  using (exists (select 1 from public.supplements s where s.id = supplement_id and s.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.supplements s where s.id = supplement_id and s.owner_user_id = auth.uid()));

create policy "own" on public.daily_stack_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Events: users read and append their own; nothing is updated or deleted.
-- Clients may only write source = 'app'; synced events come from the server.
-- ---------------------------------------------------------------------------
create policy "own: read" on public.events for select to authenticated
  using (user_id = auth.uid());
create policy "own: append" on public.events for insert to authenticated
  with check (user_id = auth.uid() and source = 'app');

-- Detail rows: readable and insertable only for the user's own event of the
-- matching type.
create or replace function public.owns_event(p_event_id bigint, p_type public.event_type)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.user_id = auth.uid() and e.type = p_type
  )
$$;

create policy "own: read"   on public.food_log for select to authenticated using (public.owns_event(event_id, 'food'));
create policy "own: append" on public.food_log for insert to authenticated with check (public.owns_event(event_id, 'food'));

create policy "own: read"   on public.water_log for select to authenticated using (public.owns_event(event_id, 'water'));
create policy "own: append" on public.water_log for insert to authenticated with check (public.owns_event(event_id, 'water'));

create policy "own: read"   on public.stack_log for select to authenticated using (public.owns_event(event_id, 'stack_taken'));
create policy "own: append" on public.stack_log for insert to authenticated with check (public.owns_event(event_id, 'stack_taken'));

create policy "own: read"   on public.weigh_ins for select to authenticated using (public.owns_event(event_id, 'weigh_in'));
create policy "own: append" on public.weigh_ins for insert to authenticated with check (public.owns_event(event_id, 'weigh_in'));

create policy "own: read"   on public.activities for select to authenticated using (public.owns_event(event_id, 'activity'));
create policy "own: append" on public.activities for insert to authenticated with check (public.owns_event(event_id, 'activity'));

create policy "own: read"   on public.skips for select to authenticated using (public.owns_event(event_id, 'skip'));
create policy "own: append" on public.skips for insert to authenticated with check (public.owns_event(event_id, 'skip'));

create policy "own: read"   on public.self_care_log for select to authenticated using (public.owns_event(event_id, 'self_care'));
create policy "own: append" on public.self_care_log for insert to authenticated
  with check (public.owns_event(event_id, 'self_care')
              and exists (select 1 from public.self_care_categories c
                          where c.id = category_id and c.user_id = auth.uid()));

-- Workouts arrive from the Liftosaur sync (server), so users can only read them.
create policy "own: read" on public.workout_sessions for select to authenticated
  using (public.owns_event(event_id, 'workout_session'));
create policy "own: read" on public.workout_sets for select to authenticated
  using (public.owns_event(event_id, 'workout_set'));

create policy "own" on public.recovery_periods for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own" on public.self_care_categories for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Game output: read-only for users
-- ---------------------------------------------------------------------------
create policy "own: read" on public.xp_ledger           for select to authenticated using (user_id = auth.uid());
create policy "own: read" on public.stat_snapshots      for select to authenticated using (user_id = auth.uid());
create policy "own: read" on public.quest_progress      for select to authenticated using (user_id = auth.uid());
create policy "own: read" on public.achievements_earned for select to authenticated using (user_id = auth.uid());
create policy "own: read" on public.loot_drops          for select to authenticated using (user_id = auth.uid());

-- Users may equip or unequip loot, and change nothing else about it.
create policy "own: equip" on public.loot_drops for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.loot_drops from authenticated;
grant update (equipped) on public.loot_drops to authenticated;

-- Integration status is visible; the key never is (it lives in Vault).
create policy "own: read" on public.integrations for select to authenticated
  using (user_id = auth.uid());
