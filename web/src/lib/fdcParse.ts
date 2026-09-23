// Normalizes USDA FoodData Central (FDC) API responses for Branded foods.
// Pure, so it's unit-tested; src/lib/fdc.ts does the fetching.
//
// Search results (/foods/search) list nutrients as
//   { nutrientId, nutrientNumber, unitName, value }
// and food details (/food/{fdcId}) as
//   { nutrient: { id, number, unitName }, amount }.
// Branded amounts are per 100 g (or 100 mL for drinks), like the bulk data.

export type FdcNutrientRaw = {
  nutrientId?: number;
  value?: number;
  unitName?: string;
  nutrient?: { id?: number; unitName?: string };
  amount?: number;
};

export type FdcFoodRaw = {
  fdcId: number;
  description?: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  publishedDate?: string;
  publicationDate?: string;
  foodNutrients?: FdcNutrientRaw[];
};

export type BrandedFood = {
  fdcId: number;
  name: string;
  brand: string | null;
  barcode: string | null;
  publishedAt: string | null; // ISO date
  // FDC nutrient id -> amount per 100 g
  nutrients: Map<number, number>;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  serving: { label: string; grams: number } | null;
};

// App nutrient codes for the macros, with fallbacks in priority order
// (the same ones the bulk loader uses; see usda.nutrient_aliases).
const MACRO_IDS = {
  kcal: [1008, 2048, 2047],
  protein: [1003],
  carbs: [1005, 1050],
  fat: [1004, 1085],
  fiber: [1079],
} as const;

function plausible(id: number, unit: string | undefined, amount: number): boolean {
  if (!Number.isFinite(amount) || amount < 0) return false;
  const u = (unit ?? "").toLowerCase();
  if (u === "g" && amount > 100) return false;
  if ((u === "kcal" || [1008, 2047, 2048].includes(id)) && amount > 1000) return false;
  return true;
}

// Branded descriptions are usually ALL CAPS; make them readable.
export function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
}

export function parseBranded(raw: FdcFoodRaw): BrandedFood {
  const nutrients = new Map<number, number>();
  for (const n of raw.foodNutrients ?? []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const amount = n.value ?? n.amount;
    const unit = n.unitName ?? n.nutrient?.unitName;
    if (id === undefined || amount === undefined) continue;
    if (plausible(id, unit, amount)) nutrients.set(id, amount);
  }
  const pick = (ids: readonly number[]) => {
    for (const id of ids) if (nutrients.has(id)) return nutrients.get(id)!;
    return null;
  };

  const unit = (raw.servingSizeUnit ?? "").toLowerCase();
  // Grams, or mL for drinks (treated as grams, as the per-100 values are).
  const servingGrams =
    raw.servingSize && raw.servingSize > 0 && ["g", "grm", "ml", "mlt"].includes(unit) ? raw.servingSize : null;
  // The label is what gets logged ("1 container"); the amount picker shows
  // the grams beside it.
  const household = raw.householdServingFullText?.trim();
  const serving = servingGrams
    ? {
        label: household || (unit.startsWith("m") ? `${round(servingGrams)} mL` : "1 serving"),
        grams: servingGrams,
      }
    : null;

  const date = raw.publishedDate ?? raw.publicationDate ?? null;
  return {
    fdcId: raw.fdcId,
    name: tidyName(raw.description ?? `Food ${raw.fdcId}`),
    brand: raw.brandName?.trim() ? tidyName(raw.brandName) : raw.brandOwner?.trim() ? tidyName(raw.brandOwner) : null,
    barcode: raw.gtinUpc?.replace(/\D/g, "") || null,
    publishedAt: date ? isoDate(date) : null,
    nutrients,
    kcal: pick(MACRO_IDS.kcal),
    protein: pick(MACRO_IDS.protein),
    carbs: pick(MACRO_IDS.carbs),
    fat: pick(MACRO_IDS.fat),
    fiber: pick(MACRO_IDS.fiber),
    serving,
  };
}

function round(n: number): string {
  return String(Math.round(n * 10) / 10);
}

// "2021-10-28" or "10/28/2021" -> "2021-10-28"
function isoDate(s: string): string | null {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}
