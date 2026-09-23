import "server-only";
import type { BrandedFood } from "@/lib/fdcParse";
import { createAdminClient } from "@/lib/supabase/admin";

// Save (or refresh) one USDA packaged food in the shared foods table, with
// its nutrients and label serving, and return its id. Keyed on
// (source, source_id), like the bulk loader, so a product is stored once.
export async function importBrandedFood(food: BrandedFood): Promise<number> {
  const admin = createAdminClient();
  const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

  const { data: row, error } = await admin
    .from("foods")
    .upsert(
      {
        source: "usda_branded",
        source_id: String(food.fdcId),
        name: food.name,
        brand: food.brand,
        barcode: food.barcode,
        kcal_100g: round(food.kcal),
        protein_100g: round(food.protein),
        carbs_100g: round(food.carbs),
        fat_100g: round(food.fat),
        fiber_100g: round(food.fiber),
        source_updated_at: food.publishedAt,
        retired_at: null,
      },
      { onConflict: "source,source_id" },
    )
    .select("id")
    .single();
  if (error || !row) throw new Error(`Saving the food failed: ${error?.message}`);
  const foodId = row.id as number;

  // Nutrients the app tracks, by their FDC ids.
  const { data: nutrients, error: nError } = await admin
    .from("nutrients")
    .select("id, usda_nutrient_id")
    .not("usda_nutrient_id", "is", null);
  if (nError) throw new Error(nError.message);
  const rows = (nutrients ?? [])
    .filter((n) => food.nutrients.has(n.usda_nutrient_id as number))
    .map((n) => ({
      food_id: foodId,
      nutrient_id: n.id,
      amount_100g: Math.round(food.nutrients.get(n.usda_nutrient_id as number)! * 10000) / 10000,
    }));
  // Energy from Atwater factors when 1008 is missing, as the loader does.
  const energy = (nutrients ?? []).find((n) => n.usda_nutrient_id === 1008);
  if (energy && !food.nutrients.has(1008) && food.kcal !== null) {
    rows.push({ food_id: foodId, nutrient_id: energy.id, amount_100g: food.kcal });
  }

  await admin.from("food_nutrients").delete().eq("food_id", foodId);
  if (rows.length) {
    const { error: insError } = await admin.from("food_nutrients").insert(rows);
    if (insError) throw new Error(insError.message);
  }
  await admin.from("food_portions").delete().eq("food_id", foodId);
  if (food.serving) {
    const { error: pError } = await admin
      .from("food_portions")
      .insert({ food_id: foodId, label: food.serving.label, grams: Math.round(food.serving.grams * 100) / 100, sort: 0 });
    if (pError) throw new Error(pError.message);
  }
  return foodId;
}
