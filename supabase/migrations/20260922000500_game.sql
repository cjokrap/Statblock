-- Statblock: the game layer
--
-- Rules live in rules_config as versioned data. The rules engine reads the
-- event log plus the active rules version and writes xp_ledger rows and daily
-- stat_snapshots. Rebalancing = publish a new rules version and replay.
-- Clients can read game output but never write it; only the server
-- (service role) does.

-- Classes (workouts) and jobs (food and habits).
create table public.tracks (
  code        text primary key,
  kind        public.track_kind not null,
  name        text not null,
  description text not null,
  sort        smallint not null default 0
);

create table public.rules_versions (
  version      integer primary key,
  notes        text not null,
  published_at timestamptz not null default now(),
  is_active    boolean not null default false
);

-- Exactly one active rules version.
create unique index rules_versions_one_active on public.rules_versions (is_active) where is_active;

create table public.rules_config (
  version integer not null references public.rules_versions (version),
  key     text not null,       -- e.g. 'xp.stack_taken', 'stats.window_days'
  value   jsonb not null,
  notes   text,
  primary key (version, key)
);

create or replace function public.active_rules_version()
returns integer
language sql
stable
as $$ select version from public.rules_versions where is_active $$;

-- One row per XP award. Rebuildable from events.
create table public.xp_ledger (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  local_date      date not null,
  track_code      text not null references public.tracks (code),
  xp              integer not null,
  rule_key        text not null,
  rules_version   integer not null references public.rules_versions (version),
  source_event_id bigint references public.events (id) on delete cascade,
  created_at      timestamptz not null default now(),
  -- One award per rule, per track, per source event (or per day when the
  -- award isn't tied to a single event, like "fully logged day").
  unique nulls not distinct (user_id, local_date, track_code, rule_key, source_event_id)
);

create index xp_ledger_user_track on public.xp_ledger (user_id, track_code);

-- Daily ability scores (3-20, baseline 10), computed over the rolling window.
create table public.stat_snapshots (
  user_id       uuid not null references auth.users (id) on delete cascade,
  local_date    date not null,
  str           smallint not null check (str between 3 and 20),
  dex           smallint not null check (dex between 3 and 20),
  con           smallint not null check (con between 3 and 20),
  int           smallint not null check (int between 3 and 20),
  wis           smallint not null check (wis between 3 and 20),
  cha           smallint not null check (cha between 3 and 20),
  str_frozen    boolean not null default false,   -- recovery period in force
  rules_version integer not null references public.rules_versions (version),
  computed_at   timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- Level from XP using the thresholds in the active rules version.
create or replace function public.level_for_xp(p_xp integer)
returns integer
language sql
stable
as $$
  select coalesce(max(t.ordinality)::integer, 1)
  from public.rules_config rc,
       jsonb_array_elements_text(rc.value) with ordinality as t(threshold, ordinality)
  where rc.version = public.active_rules_version()
    and rc.key = 'levels.thresholds'
    and t.threshold::integer <= p_xp
$$;

-- Totals per track and overall, for the character sheet.
create view public.track_progress
with (security_invoker = true) as
select l.user_id,
       t.code as track_code,
       t.kind,
       t.name,
       sum(l.xp)::integer as xp,
       public.level_for_xp(sum(l.xp)::integer) as level
from public.xp_ledger l
join public.tracks t on t.code = l.track_code
group by l.user_id, t.code, t.kind, t.name;

create view public.character_level
with (security_invoker = true) as
select l.user_id,
       sum(l.xp)::integer as total_xp,
       public.level_for_xp(sum(l.xp)::integer) as level
from public.xp_ledger l
group by l.user_id;

-- ---------------------------------------------------------------------------
-- Quests
-- ---------------------------------------------------------------------------
create table public.quest_definitions (
  code        text primary key,
  name        text not null,
  description text not null,
  cadence     text not null check (cadence in ('daily', 'weekly')),
  track_code  text references public.tracks (code),
  xp          integer not null default 0,
  -- Optional conditions, e.g. {"eating_style": ["keto"]} or {"training_day": true}.
  applies_when jsonb not null default '{}',
  active      boolean not null default true,
  sort        smallint not null default 0
);

-- Progress is computed by the server; quests complete only when the goal is met.
create table public.quest_progress (
  user_id      uuid not null references auth.users (id) on delete cascade,
  quest_code   text not null references public.quest_definitions (code),
  period_start date not null,                -- the day, or Monday for weekly quests
  progress     numeric(10,2) not null default 0,
  target       numeric(10,2) not null,
  completed_at timestamptz,
  primary key (user_id, quest_code, period_start)
);

-- ---------------------------------------------------------------------------
-- Loot and achievements (cosmetic only; they never change stats)
-- ---------------------------------------------------------------------------
create table public.loot_definitions (
  code        text primary key,
  kind        text not null check (kind in ('title', 'badge', 'gear')),
  name        text not null,
  rarity      text not null check (rarity in ('common', 'uncommon', 'rare', 'legendary')),
  description text
);

create table public.loot_drops (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  loot_code   text not null references public.loot_definitions (code),
  dropped_on  date not null,
  reason      text not null,                 -- e.g. 'weekly_boss', 'random_logging_drop'
  equipped    boolean not null default false
);

create table public.achievement_definitions (
  code        text primary key,
  name        text not null,
  description text not null,
  criteria    jsonb not null                 -- e.g. {"weight_lost_lb": 5}
);

create table public.achievements_earned (
  user_id          uuid not null references auth.users (id) on delete cascade,
  achievement_code text not null references public.achievement_definitions (code),
  earned_on        date not null,
  primary key (user_id, achievement_code)
);
