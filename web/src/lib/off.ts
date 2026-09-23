import "server-only";
import { barcodeVariants, parseOff, type OffFood, type OffProductRaw } from "@/lib/offParse";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Open Food Facts API v2. No key needed; OFF asks apps to identify
// themselves in the User-Agent. OFF_API_BASE overrides the address in tests.
const BASE = process.env.OFF_API_BASE ?? "https://world.openfoodfacts.org/api/v2";
const FIELDS = [
  "code", "product_name", "product_name_en", "generic_name", "brands",
  "serving_size", "serving_quantity", "serving_quantity_unit", "nutriments",
].join(",");

export type OffLookup = { food: OffFood; raw: OffProductRaw } | "not_found" | "no_nutrition" | "unreachable";

export async function fetchOff(barcode: string): Promise<OffLookup> {
  for (const code of barcodeVariants(barcode).slice(0, 2)) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/product/${code}.json?fields=${FIELDS}`, {
        headers: { "User-Agent": "Statblock/0.1 (personal food tracker)" },
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return "unreachable";
    }
    if (res.status === 404) continue;
    if (!res.ok) return "unreachable";
    const body = (await res.json()) as { status?: number; product?: OffProductRaw };
    if (body.status !== 1 || !body.product) continue;
    const food = parseOff(body.product, body.product.code || code);
    if (!food || food.kcal === null) return "no_nutrition";
    return { food, raw: body.product };
  }
  return "not_found";
}

// A saved food with this barcode (USDA packaged or OFF), if any. USDA wins:
// it's public domain.
export async function savedFoodByBarcode(barcode: string): Promise<number | null> {
  const variants = barcodeVariants(barcode);
  if (!variants.length) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("foods")
    .select("id, source")
    .in("barcode", variants)
    .in("source", ["usda_branded", "off"])
    .is("retired_at", null)
    .order("source", { ascending: false }) // usda_branded before off
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.id as number | undefined) ?? null;
}

// Save one logged OFF product: its original JSON in off_products, and a
// foods row with nutrients and the label serving. Returns the food id.
export async function importOffFood(food: OffFood, raw: OffProductRaw): Promise<number> {
  const admin = createAdminClient();
  const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  const macros = {
    kcal_100g: round(food.kcal),
    protein_100g: round(food.protein),
    carbs_100g: round(food.carbs),
    fat_100g: round(food.fat),
    fiber_100g: round(food.fiber),
  };
  const off = await admin
    .from("off_products")
    .upsert({ barcode: food.barcode, name: food.name, brand: food.brand, ...macros, raw, fetched_at: new Date().toISOString() });
  if (off.error) throw new Error(`Saving the product failed: ${off.error.message}`);

  const { data: row, error } = await admin
    .from("foods")
    .upsert(
      { source: "off", source_id: food.barcode, name: food.name, brand: food.brand, barcode: food.barcode, ...macros, retired_at: null },
      { onConflict: "source,source_id" },
    )
    .select("id")
    .single();
  if (error || !row) throw new Error(`Saving the food failed: ${error?.message}`);
  const foodId = row.id as number;

  const { data: nutrients, error: nError } = await admin.from("nutrients").select("id, code");
  if (nError) throw new Error(nError.message);
  const byCode = new Map((nutrients ?? []).map((n) => [n.code as string, n.id as number]));
  const all = new Map(food.nutrients);
  for (const [code, v] of [["energy", food.kcal], ["protein", food.protein], ["carbs", food.carbs], ["fat", food.fat], ["fiber", food.fiber]] as const) {
    if (v !== null) all.set(code, v);
  }
  const rows = [...all.entries()]
    .filter(([code]) => byCode.has(code))
    .map(([code, v]) => ({ food_id: foodId, nutrient_id: byCode.get(code)!, amount_100g: Math.round(v * 10000) / 10000 }));

  await admin.from("food_nutrients").delete().eq("food_id", foodId);
  if (rows.length) {
    const ins = await admin.from("food_nutrients").insert(rows);
    if (ins.error) throw new Error(ins.error.message);
  }
  await admin.from("food_portions").delete().eq("food_id", foodId);
  if (food.serving) {
    const p = await admin
      .from("food_portions")
      .insert({ food_id: foodId, label: food.serving.label, grams: Math.round(food.serving.grams * 100) / 100, sort: 0 });
    if (p.error) throw new Error(p.error.message);
  }
  return foodId;
}
