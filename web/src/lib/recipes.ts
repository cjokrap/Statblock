import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FoodRow } from "@/lib/food";
import { forGrams } from "@/lib/meals";

const FOOD_COLUMNS = "id, source, source_id, name, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, recipe_id";

export type RecipeSummary = { id: number; name: string; foodId: number | null; ingredients: number; kcal100: number | null };

export type Ingredient = { id: number; grams: number; portionLabel: string | null; food: FoodRow };

export type Recipe = {
  id: number;
  name: string;
  cookedGrams: number | null;
  servings: number | null;
  food: FoodRow | null; // the current version, logged like any food
  ingredients: Ingredient[];
  rawGrams: number; // the ingredients' weight
  totalGrams: number; // cooked weight, or the ingredients' weight
  totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
};

export async function listRecipes(): Promise<RecipeSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipes")
    .select("id, name, food_id, recipe_ingredients (count), foods!recipes_food_fk (kcal_100g)")
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as number,
    name: r.name as string,
    foodId: r.food_id as number | null,
    ingredients: (r.recipe_ingredients as unknown as { count: number }[])[0]?.count ?? 0,
    kcal100: (r.foods as unknown as { kcal_100g: number | null } | null)?.kcal_100g ?? null,
  }));
}

export async function getRecipe(id: number): Promise<Recipe | null> {
  const supabase = await createClient();
  const [recipe, ingredients] = await Promise.all([
    supabase
      .from("recipes")
      .select(`id, name, cooked_grams, servings, foods!recipes_food_fk (${FOOD_COLUMNS})`)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("recipe_ingredients")
      .select(`id, grams, portion_label, foods (${FOOD_COLUMNS})`)
      .eq("recipe_id", id)
      .order("id"),
  ]);
  if (recipe.error) throw new Error(recipe.error.message);
  if (ingredients.error) throw new Error(ingredients.error.message);
  if (!recipe.data) return null;
  const items: Ingredient[] = (ingredients.data ?? []).map((i) => ({
    id: i.id as number,
    grams: Number(i.grams),
    portionLabel: i.portion_label as string | null,
    food: i.foods as unknown as FoodRow,
  }));
  const rawGrams = items.reduce((s, i) => s + i.grams, 0);
  const cooked = recipe.data.cooked_grams === null ? null : Number(recipe.data.cooked_grams);
  const totals = items.reduce(
    (t, i) => {
      const n = forGrams(i.food, i.grams);
      return { kcal: t.kcal + n.kcal, protein: t.protein + n.protein, carbs: t.carbs + n.carbs, fat: t.fat + n.fat, fiber: t.fiber + n.fiber };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );
  return {
    id: recipe.data.id as number,
    name: recipe.data.name as string,
    cookedGrams: cooked,
    servings: recipe.data.servings === null ? null : Number(recipe.data.servings),
    food: recipe.data.foods as unknown as FoodRow | null,
    ingredients: items,
    rawGrams,
    totalGrams: cooked ?? rawGrams,
    totals,
  };
}
