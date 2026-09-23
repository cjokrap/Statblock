// Pure helpers for the Today dashboard, so they're unit-tested.
import { KG_PER_LB, ML_PER_OZ } from "./targets.ts";

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// ---- Hit points: today's calories against the window ----------------------
export type HitPoints = {
  fillPct: number; // bar fill, as % of the bar (the bar runs to the window's top + 10%)
  windowFromPct: number;
  windowWidthPct: number;
  low: number;
  high: number;
  message: string;
  state: "under" | "in" | "over";
};

export function hitPoints(kcal: number, target: number, windowPct: number): HitPoints {
  const low = target * (1 - windowPct / 100);
  const high = target * (1 + windowPct / 100);
  const scale = high * 1.1;
  const pct = (n: number) => Math.min(100, Math.max(0, (n / scale) * 100));
  const state = kcal < low ? "under" : kcal > high ? "over" : "in";
  const message =
    state === "under"
      ? `${fmt(low - kcal)} kcal to reach your window`
      : state === "in"
        ? `In your window · ${fmt(high - kcal)} kcal of room`
        : `${fmt(kcal - high)} kcal over your window`;
  return {
    fillPct: pct(kcal),
    windowFromPct: pct(low),
    windowWidthPct: pct(high) - pct(low),
    low,
    high,
    message,
    state,
  };
}

// ---- Quests -----------------------------------------------------------------
export type QuestRow = {
  code: string;
  name: string;
  cadence: "daily" | "weekly";
  xp: number;
  track: string | null;
  progress: number;
  target: number;
  completedAt: string | null;
};

export type QuestView = {
  done: boolean;
  badge: string; // shown in the circle while open: "2/3", "64%", "—"
  detail: string;
  xp: string;
};

const TRACK_SHORT: Record<string, string> = {
  quartermaster: "QM",
  alchemist: "ALC",
  barbarian: "BAR",
  fighter: "FTR",
};

export function questView(
  q: QuestRow,
  opts: { waterUnit: "oz" | "ml"; timeZone: string; windowPct: number; dayOver?: boolean },
): QuestView {
  const done = q.completedAt !== null;
  const at = done
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: opts.timeZone }).format(
        new Date(q.completedAt as string),
      )
    : "";
  const pct = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
  const water = (ml: number) =>
    opts.waterUnit === "oz" ? `${fmt(ml / ML_PER_OZ)} oz` : `${fmt(ml)} mL`;
  const xp = q.xp > 0 ? `+${q.xp}${q.track && TRACK_SHORT[q.track] ? ` ${TRACK_SHORT[q.track]}` : ""}` : "";

  let detail: string;
  let badge = `${pct}%`;
  switch (q.code) {
    case "log_every_meal":
      badge = `${fmt(q.progress)}/3`;
      detail = done ? `Done at ${at}` : `${fmt(q.progress)} of 3 meals logged (breakfast, lunch, dinner)`;
      break;
    case "take_stack":
      badge = "—";
      detail = done ? `Taken at ${at}` : "Tap Take stack below";
      break;
    case "train":
      badge = "—";
      detail = done ? `Session synced from Liftosaur at ${at}` : "Synced from Liftosaur when you finish";
      break;
    case "hit_protein":
      detail = done ? `Hit at ${at}` : `${fmt(q.target - q.progress)} g to go`;
      break;
    case "drink_water":
      detail = done ? `Hit at ${at}` : `${water(q.target - q.progress)} to go`;
      break;
    case "carb_ceiling":
      badge = "—";
      detail = done
        ? "Stayed under"
        : `Checked at end of day · ${fmt(q.progress)} of ${fmt(q.target)} g so far`;
      break;
    case "calorie_window": {
      badge = "—";
      const low = q.target * (1 - opts.windowPct / 100);
      const high = q.target * (1 + opts.windowPct / 100);
      detail = done
        ? "Landed in the window"
        : opts.dayOver
          ? "Missed"
          : `Checked at end of day · ${fmt(low)}–${fmt(high)} kcal`;
      break;
    }
    default:
      detail = done ? `Done at ${at}` : `${fmt(q.progress)} of ${fmt(q.target)}`;
  }
  return { done, badge, detail, xp };
}

// ---- Training -----------------------------------------------------------------
export type SetRow = {
  exercise: string;
  tier: string | null;
  setIndex: number;
  reps: number;
  weightKg: number;
  isWarmup: boolean;
  isPr: boolean;
  est1rmKg: number | null;
};

export type ExerciseSummary = { exercise: string; tier: string | null; text: string; pr: boolean; best1rm: number | null };

// "5×3 @ 275 lb", or "3, 3, 5 @ 275 lb" when reps differ, or "3×5 @ 135–155 lb".
// Warm-up sets are left out.
export function summarizeSets(sets: SetRow[], unit: "lb" | "kg"): ExerciseSummary[] {
  const byExercise = new Map<string, SetRow[]>();
  for (const s of [...sets].sort((a, b) => a.setIndex - b.setIndex)) {
    if (s.isWarmup) continue;
    byExercise.set(s.exercise, [...(byExercise.get(s.exercise) ?? []), s]);
  }
  const w = (kg: number) => Math.round(unit === "lb" ? kg / KG_PER_LB : kg);
  return [...byExercise.entries()].map(([exercise, list]) => {
    const reps = list.map((s) => s.reps);
    const weights = list.map((s) => w(s.weightKg));
    const sameReps = reps.every((r) => r === reps[0]);
    const lo = Math.min(...weights);
    const hi = Math.max(...weights);
    const load = hi === 0 ? "" : ` @ ${lo === hi ? lo : `${lo}–${hi}`} ${unit}`;
    const text = (sameReps ? `${list.length}×${reps[0]}` : reps.join(", ")) + load;
    const best = Math.max(...list.map((s) => s.est1rmKg ?? 0));
    return {
      exercise,
      tier: list.find((s) => s.tier)?.tier ?? null,
      text,
      pr: list.some((s) => s.isPr),
      best1rm: best > 0 ? w(best) : null,
    };
  });
}

// Liftosaur names carry equipment after a comma ("Squat, Barbell").
export function shortExercise(name: string): string {
  return name.split(",")[0].trim();
}
