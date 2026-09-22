// Display helpers for game numbers. The rules engine (SQL) computes XP and
// scores; these only format them for the character sheet.

export type LevelProgress = {
  level: number;
  xp: number;
  levelFloor: number; // XP where this level started
  nextAt: number | null; // XP for the next level; null at max level
  toNext: number | null;
  pct: number; // 0-100 through the current level
};

// thresholds: rules_config levels.thresholds, where index + 1 = level.
export function levelProgress(xp: number, thresholds: number[]): LevelProgress {
  let level = 1;
  thresholds.forEach((t, i) => {
    if (xp >= t) level = i + 1;
  });
  const levelFloor = thresholds[level - 1] ?? 0;
  const nextAt = level < thresholds.length ? thresholds[level] : null;
  const pct =
    nextAt === null ? 100 : Math.max(0, Math.min(100, ((xp - levelFloor) / (nextAt - levelFloor)) * 100));
  return { level, xp, levelFloor, nextAt, toNext: nextAt === null ? null : nextAt - xp, pct };
}

// D&D ability modifier: floor((score - 10) / 2), shown with a sign.
export function modifier(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return m > 0 ? `+${m}` : m < 0 ? `−${-m}` : "+0";
}

export type Trend = "Up" | "Down" | "Steady";

export function trend(now: number, before: number | undefined): Trend {
  if (before === undefined || now === before) return "Steady";
  return now > before ? "Up" : "Down";
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
