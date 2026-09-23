// Suggested targets and unit conversions. Pure, so it's unit-tested; the
// numbers come from rules_config (targets.eating_styles, targets.suggestions).
//
// Calories: Mifflin-St Jeor resting energy times an activity multiplier,
// minus kcal_per_lb_per_week for each lb a week of loss, never under the
// floor for the user's sex. Protein comes from goal weight. Fat is a share
// of calories and carbs fill the rest, except for carb-ceiling styles (low
// carb, keto), where carbs are fixed and fat fills the rest.

export const KG_PER_LB = 0.45359237;
export const ML_PER_OZ = 29.5735295625;
export const CM_PER_IN = 2.54;

export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

export const ACTIVITIES = ["sedentary", "light", "moderate", "very"] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const EATING_STYLES = ["balanced", "high_protein", "low_carb", "keto", "low_fat", "custom"] as const;
export type EatingStyle = (typeof EATING_STYLES)[number];

export const STYLE_LABEL: Record<EatingStyle, string> = {
  balanced: "Balanced",
  high_protein: "High protein",
  low_carb: "Low carb",
  keto: "Keto",
  low_fat: "Low fat",
  custom: "Custom",
};

export type StylePreset = {
  protein_g_per_lb_goal: number;
  fat_pct?: number;
  carbs_g?: number;
  carbs_are_ceiling?: boolean;
  count_net_carbs?: boolean;
};

export type TargetRules = {
  styles: Partial<Record<EatingStyle, StylePreset>>;
  suggestions: {
    activity_multipliers: Record<Activity, number>;
    kcal_per_lb_per_week: number;
    kcal_floor: Record<Sex, number>;
    water_ml: Record<Sex, number>;
  };
};

export type Body = { sex: Sex; weightKg: number; heightCm: number; age: number };

export type Macros = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  carbs_are_ceiling: boolean;
  count_net_carbs: boolean;
};

export type Suggestion = Macros & { calorie_target: number; floored: boolean; water_goal_ml: number };

export function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

// Resting energy, kcal a day (Mifflin-St Jeor, 1990).
export function mifflinStJeor(b: Body): number {
  return 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age + (b.sex === "male" ? 5 : -161);
}

// Daily calories for a pace of lb lost a week (0 = maintain), to the nearest 10.
export function suggestCalories(
  rules: TargetRules,
  body: Body,
  activity: Activity,
  paceLbPerWeek: number,
): { kcal: number; floored: boolean } {
  const s = rules.suggestions;
  const raw = mifflinStJeor(body) * s.activity_multipliers[activity] - paceLbPerWeek * s.kcal_per_lb_per_week;
  const floor = s.kcal_floor[body.sex];
  const kcal = Math.round(Math.max(raw, floor) / 10) * 10;
  return { kcal, floored: raw < floor };
}

// Macros for an eating style at a calorie target. Custom uses Balanced's
// split as its starting point. Without a goal weight, protein is kept.
export function macrosFor(
  rules: TargetRules,
  style: EatingStyle,
  kcal: number,
  goalWeightKg: number | null,
  currentProteinG = 0,
): Macros {
  const p = rules.styles[style === "custom" ? "balanced" : style] ?? { protein_g_per_lb_goal: 0.8, fat_pct: 30 };
  const protein = goalWeightKg ? Math.round((goalWeightKg / KG_PER_LB) * p.protein_g_per_lb_goal) : currentProteinG;
  let carbs: number;
  let fat: number;
  if (p.carbs_g !== undefined) {
    carbs = p.carbs_g;
    fat = Math.max(0, Math.round((kcal - protein * 4 - carbs * 4) / 9));
  } else {
    fat = Math.round((kcal * (p.fat_pct ?? 30)) / 100 / 9);
    carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  }
  return {
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    carbs_are_ceiling: Boolean(p.carbs_are_ceiling),
    count_net_carbs: Boolean(p.count_net_carbs),
  };
}

export function suggestTargets(
  rules: TargetRules,
  input: { body: Body; goalWeightKg: number; activity: Activity; paceLbPerWeek: number; style: EatingStyle },
): Suggestion {
  const { kcal, floored } = suggestCalories(rules, input.body, input.activity, input.paceLbPerWeek);
  return {
    calorie_target: kcal,
    floored,
    ...macrosFor(rules, input.style, kcal, input.goalWeightKg),
    water_goal_ml: rules.suggestions.water_ml[input.body.sex],
  };
}

export function macroKcal(m: { protein_g: number; carbs_g: number; fat_g: number }): number {
  return m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9;
}

// Whole years between two ISO dates (YYYY-MM-DD).
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// Parses a number typed by a person ("2,000", "5.5"); null if it isn't one.
export function parseNumber(s: unknown): number | null {
  if (typeof s !== "string" || s.trim() === "") return null;
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
