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

// ---- Ability score ladder (rules v2, stats.progression) --------------------
// Progress is in good days; a perfect week is days_per_week. The first step
// from baseline costs first_step_weeks, each further step step_increase_weeks
// more; it mirrors below baseline. Same formula as game.progress_for_score.
export type Ladder = {
  baseline: number;
  min: number;
  max: number;
  days_per_week: number;
  first_step_weeks: number;
  step_increase_weeks: number;
};

export function progressForScore(score: number, l: Ladder): number {
  const n = Math.abs(score - l.baseline);
  return Math.sign(score - l.baseline) * l.days_per_week * (n * l.first_step_weeks + (l.step_increase_weeks * n * (n - 1)) / 2);
}

export type ScoreProgress = {
  score: number;
  pct: number; // 0-100 of the way to the next score
  next: number | null; // null at max
  daysToNext: number | null; // good days still needed
};

export function scoreProgress(progress: number, l: Ladder): ScoreProgress {
  let score = l.baseline;
  if (progress >= 0) {
    while (score < l.max && progressForScore(score + 1, l) <= progress) score++;
  } else {
    while (score > l.min && progressForScore(score - 1, l) >= progress) score--;
  }
  if (score >= l.max) return { score, pct: 100, next: null, daysToNext: null };
  // The span this score covers, from where it starts to where the next begins.
  let base: number;
  let target: number;
  if (progress >= 0) {
    base = progressForScore(score, l);
    target = progressForScore(score + 1, l);
  } else if (score === l.baseline) {
    base = progressForScore(score - 1, l);
    target = progressForScore(score + 1, l);
  } else {
    base = score > l.min ? progressForScore(score - 1, l) : progressForScore(l.min, l) - l.days_per_week;
    target = progressForScore(score, l);
  }
  const pct = Math.max(0, Math.min(100, ((progress - base) / (target - base)) * 100));
  return { score, pct, next: score + 1, daysToNext: Math.max(0, target - progress) };
}

// Up or down by progress over the last week, not the whole-number score,
// which moves slowly on purpose.
export function progressTrend(now: number, weekAgo: number | undefined): Trend {
  if (weekAgo === undefined || Math.abs(now - weekAgo) < 0.01) return "Steady";
  return now > weekAgo ? "Up" : "Down";
}
