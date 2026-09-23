// Normalizes Open Food Facts (OFF) products from its API v2
// (/api/v2/product/{barcode}.json). Pure, so it's unit-tested; src/lib/off.ts
// does the fetching. OFF data is ODbL: only products the user logs are saved,
// and the app credits Open Food Facts wherever it shows them.
//
// OFF normalizes every nutriments.*_100g value to grams (vitamins too), per
// 100 g, or per 100 mL for drinks. Energy is energy-kcal_100g, or
// energy_100g in kJ.

export type OffProductRaw = {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  nutriments?: Record<string, number | string | undefined>;
};

export type OffFood = {
  barcode: string;
  name: string;
  brand: string | null;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  // app nutrient code -> amount per 100 g, in the nutrient's own unit
  nutrients: Map<string, number>;
  serving: { label: string; grams: number } | null;
};

// OFF nutriment key -> [app nutrient code, factor from grams to its unit].
const MICROS: [string, string, number][] = [
  ["sugars", "sugars", 1],
  ["saturated-fat", "sat_fat", 1],
  ["cholesterol", "cholesterol", 1000],
  ["sodium", "sodium", 1000],
  ["vitamin-a", "vitamin_a", 1e6],
  ["vitamin-c", "vitamin_c", 1000],
  ["vitamin-d", "vitamin_d", 1e6],
  ["vitamin-e", "vitamin_e", 1000],
  ["vitamin-k", "vitamin_k", 1e6],
  ["vitamin-b1", "thiamin", 1000],
  ["vitamin-b2", "riboflavin", 1000],
  ["vitamin-pp", "niacin", 1000],
  ["vitamin-b6", "vitamin_b6", 1000],
  ["vitamin-b9", "folate", 1e6],
  ["vitamin-b12", "vitamin_b12", 1e6],
  ["choline", "choline", 1000],
  ["calcium", "calcium", 1000],
  ["iron", "iron", 1000],
  ["magnesium", "magnesium", 1000],
  ["phosphorus", "phosphorus", 1000],
  ["potassium", "potassium", 1000],
  ["zinc", "zinc", 1000],
  ["selenium", "selenium", 1e6],
  ["copper", "copper", 1000],
];

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

// Barcodes as scanned (UPC-A, 12 digits) and as stored (EAN-13, 13 with a
// leading 0) are the same product. Returns every form to look up.
export function barcodeVariants(raw: string): string[] {
  const d = raw.replace(/\D/g, "");
  if (d.length < 8 || d.length > 14) return [];
  const bare = d.replace(/^0+/, "");
  return [...new Set([d, bare, bare.padStart(12, "0"), bare.padStart(13, "0"), bare.padStart(14, "0")])];
}

const tidy = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, p, c) => p + c.toUpperCase()) : t;
};

export function parseOff(raw: OffProductRaw, barcode: string): OffFood | null {
  const n = raw.nutriments ?? {};
  const per100 = (k: string) => num(n[`${k}_100g`]);
  const kj = per100("energy");
  const kcalRaw = per100("energy-kcal") ?? (kj === null ? null : kj / 4.184);
  // A label typo (over 1,000 kcal per 100 g) can't be scored.
  const kcal = kcalRaw !== null && kcalRaw <= 1000 ? kcalRaw : null;
  const gram = (k: string) => {
    const v = per100(k);
    return v !== null && v <= 100 ? v : null;
  };

  const name = (raw.product_name || raw.product_name_en || raw.generic_name || "").trim();
  if (!name) return null;

  const nutrients = new Map<string, number>();
  for (const [key, code, factor] of MICROS) {
    const v = per100(key);
    if (v !== null && v <= 100) nutrients.set(code, v * factor);
  }

  // Serving: grams, or mL for drinks (treated as grams, as the per-100 values are).
  const qty = num(raw.serving_quantity);
  const unit = (raw.serving_quantity_unit ?? "g").toLowerCase();
  const label = raw.serving_size?.trim();
  const serving =
    qty && qty > 0 && qty < 5000 && ["g", "ml"].includes(unit)
      ? { label: label ? label.replace(/\s*\(.*\)\s*$/, "") || label : "1 serving", grams: qty }
      : null;

  const brand = raw.brands?.split(",")[0]?.trim();
  return {
    barcode,
    name: tidy(name),
    brand: brand ? tidy(brand) : null,
    kcal,
    protein: gram("proteins"),
    carbs: gram("carbohydrates"),
    fat: gram("fat"),
    fiber: gram("fiber"),
    nutrients,
    serving,
  };
}
