import "server-only";
import { createClient } from "@/lib/supabase/server";
import { levelProgress, progressTrend, scoreProgress, type Ladder, type LevelProgress, type ScoreProgress, type Trend } from "@/lib/game";

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

export type TrackRow = {
  code: string;
  kind: "class" | "job";
  name: string;
  description: string;
  progress: LevelProgress;
};

export type Character = {
  name: string;
  title: string | null;
  timezone: string;
  overall: LevelProgress;
  headline: string; // e.g. "Barbarian / Quartermaster"
  scores: Record<Ability, number> | null;
  scoresWeekAgo: Partial<Record<Ability, number>>;
  // Rules v2: where each score is on its ladder, and which way it moved this
  // week. Null before any snapshot.
  ladder: Record<Ability, ScoreProgress & { trend: Trend }> | null;
  scoresDate: string | null;
  strFrozen: boolean;
  classes: TrackRow[];
  jobs: TrackRow[];
};

type Snapshot = Record<Ability, number> & {
  local_date: string;
  str_frozen: boolean;
  progress: Record<Ability, number> | null;
};

// Everything the character sheet shows, read with the user's own session
// (RLS limits every query to their rows).
export async function loadCharacter(): Promise<Character> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = (auth?.claims?.email as string | undefined) ?? "";
  if (!userId) throw new Error("not signed in");

  const [profile, tracks, progress, snapshots, activeVersion, thresholdRows] = await Promise.all([
    supabase.from("profiles").select("display_name, character_name, title, timezone").eq("user_id", userId).maybeSingle(),
    supabase.from("tracks").select("code, kind, name, description, sort").order("sort"),
    supabase.from("track_progress").select("track_code, xp"),
    supabase
      .from("stat_snapshots")
      .select("local_date, str, dex, con, int, wis, cha, str_frozen, progress")
      .order("local_date", { ascending: false })
      .limit(8),
    supabase.from("rules_versions").select("version").eq("is_active", true).maybeSingle(),
    supabase.from("rules_config").select("version, key, value").in("key", ["levels.thresholds", "stats.progression"]),
  ]);

  for (const r of [profile, tracks, progress, snapshots, activeVersion, thresholdRows]) {
    if (r.error) throw new Error(r.error.message);
  }

  const rule = (key: string) =>
    (thresholdRows.data ?? []).find((r) => r.version === activeVersion.data?.version && r.key === key)?.value;
  const thresholds: number[] = rule("levels.thresholds") ?? [0];
  const ladderRule = rule("stats.progression") as Ladder | undefined;
  const xpByTrack = new Map((progress.data ?? []).map((p) => [p.track_code as string, p.xp as number]));
  const rows: TrackRow[] = (tracks.data ?? []).map((t) => ({
    code: t.code,
    kind: t.kind,
    name: t.name,
    description: t.description,
    progress: levelProgress(xpByTrack.get(t.code) ?? 0, thresholds),
  }));
  const classes = rows.filter((r) => r.kind === "class");
  const jobs = rows.filter((r) => r.kind === "job");
  const totalXp = [...xpByTrack.values()].reduce((a, b) => a + b, 0);

  // Headline: the leading class and job, if they have any XP.
  const top = (list: TrackRow[]) =>
    [...list].sort((a, b) => b.progress.xp - a.progress.xp).find((r) => r.progress.xp > 0)?.name;
  const headline = [top(classes), top(jobs)].filter(Boolean).join(" / ");

  const snaps = (snapshots.data ?? []) as Snapshot[];
  const latest = snaps[0];
  const weekAgo = snaps.find((s) => latest && daysBetween(s.local_date, latest.local_date) >= 7);

  const p = profile.data;
  return {
    name: p?.character_name || p?.display_name || email.split("@")[0] || "Adventurer",
    title: p?.title ?? null,
    timezone: p?.timezone ?? "America/Chicago",
    overall: levelProgress(totalXp, thresholds),
    headline,
    scores: latest ? pick(latest) : null,
    scoresWeekAgo: weekAgo ? pick(weekAgo) : {},
    ladder:
      latest?.progress && ladderRule
        ? (Object.fromEntries(
            ABILITIES.map((a) => [
              a,
              {
                ...scoreProgress(Number(latest.progress![a]), ladderRule),
                trend: progressTrend(
                  Number(latest.progress![a]),
                  weekAgo?.progress ? Number(weekAgo.progress[a]) : 0,
                ),
              },
            ]),
          ) as Record<Ability, ScoreProgress & { trend: Trend }>)
        : null,
    scoresDate: latest?.local_date ?? null,
    strFrozen: latest?.str_frozen ?? false,
    classes,
    jobs,
  };
}

function pick(s: Snapshot): Record<Ability, number> {
  return { str: s.str, dex: s.dex, con: s.con, int: s.int, wis: s.wis, cha: s.cha };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
