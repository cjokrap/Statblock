export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function isMeal(v: unknown): v is Meal {
  return typeof v === "string" && (MEALS as readonly string[]).includes(v);
}

// The meal a log most likely belongs to, from the user's local hour.
export function mealForHour(hour: number): Meal {
  if (hour < 10.5) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

// Local date (YYYY-MM-DD) and fractional hour in a time zone.
export function localNow(timeZone: string, now = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) + Number(get("minute")) / 60,
  };
}

// Nutrition for an amount of a food, from its per-100 g values.
export type Per100 = {
  kcal_100g: number | null;
  protein_100g: number | null;
  carbs_100g: number | null;
  fat_100g: number | null;
  fiber_100g?: number | null;
};

export function forGrams(food: Per100, grams: number) {
  const f = grams / 100;
  return {
    kcal: (food.kcal_100g ?? 0) * f,
    protein: (food.protein_100g ?? 0) * f,
    carbs: (food.carbs_100g ?? 0) * f,
    fat: (food.fat_100g ?? 0) * f,
    fiber: (food.fiber_100g ?? 0) * f,
  };
}

// The amount picker's starting state for an entry already logged: its
// portion label reads back as "1 container" or "3 × 1 large"; anything else
// (or no label) is shown in grams.
export function amountFromLabel(
  label: string | null,
  grams: number,
  portions: { label: string; grams: number }[],
): { unit: string; qty: string } {
  if (label) {
    const i = portions.findIndex((p) => p.label === label);
    if (i >= 0) return { unit: String(i), qty: "1" };
    const m = label.match(/^([\d.]+) × (.+)$/);
    if (m) {
      const j = portions.findIndex((p) => p.label === m[2]);
      if (j >= 0) return { unit: String(j), qty: m[1] };
    }
  }
  return { unit: "g", qty: String(Math.round(grams * 10) / 10) };
}
