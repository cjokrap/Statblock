"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { importBrandedFood } from "@/lib/brandedImport";
import { getBranded } from "@/lib/fdc";
import { createClient } from "@/lib/supabase/server";

function id(formData: FormData, name: string): number {
  const n = Number(formData.get(name));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name}`);
  return n;
}

function grams(formData: FormData): number {
  const g = Number(String(formData.get("grams") ?? "").replace(",", "."));
  if (!(g > 0 && g < 100000)) throw new Error("Invalid amount");
  return Math.round(g * 100) / 100;
}

// An optional positive number from a form field; empty means none.
function optional(formData: FormData, name: string, max: number): number | null {
  const raw = String(formData.get(name) ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  if (!(n > 0 && n < max)) throw new Error(`Invalid ${name}`);
  return Math.round(n * 100) / 100;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

function done(recipeId: number, query = "") {
  revalidatePath("/recipes");
  redirect(`/recipes/${recipeId}${query}`);
}

export async function createRecipe(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) throw new Error("A recipe needs a name");
  const recipeId = (await rpc("create_recipe", { p_name: name })) as number;
  done(recipeId);
}

export async function updateRecipe(formData: FormData) {
  const recipeId = id(formData, "recipe_id");
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) throw new Error("A recipe needs a name");
  await rpc("update_recipe", {
    p_recipe_id: recipeId,
    p_name: name,
    p_cooked_grams: optional(formData, "cooked_grams", 1_000_000),
    p_servings: optional(formData, "servings", 10_000),
  });
  done(recipeId, "?saved=1");
}

export async function addIngredient(formData: FormData) {
  const recipeId = id(formData, "recipe_id");
  await rpc("add_recipe_ingredient", {
    p_recipe_id: recipeId,
    p_food_id: id(formData, "food_id"),
    p_grams: grams(formData),
    p_portion_label: String(formData.get("portion_label") ?? "").trim() || null,
  });
  done(recipeId);
}

// A USDA packaged food as an ingredient: fetched here on the server and
// saved to foods first, the same way logging one does.
export async function addBrandedIngredient(formData: FormData) {
  const recipeId = id(formData, "recipe_id");
  const food = await getBranded(id(formData, "fdc_id"), {
    query: String(formData.get("q") ?? ""),
    page: Number.parseInt(String(formData.get("bp") ?? "1"), 10) || 1,
  });
  if (!food) throw new Error("USDA doesn't have that product any more");
  const foodId = await importBrandedFood(food);
  await rpc("add_recipe_ingredient", {
    p_recipe_id: recipeId,
    p_food_id: foodId,
    p_grams: grams(formData),
    p_portion_label: String(formData.get("portion_label") ?? "").trim() || null,
  });
  done(recipeId);
}

export async function updateIngredient(formData: FormData) {
  const recipeId = id(formData, "recipe_id");
  await rpc("update_recipe_ingredient", { p_ingredient_id: id(formData, "ingredient_id"), p_grams: grams(formData) });
  done(recipeId);
}

export async function removeIngredient(formData: FormData) {
  const recipeId = id(formData, "recipe_id");
  await rpc("remove_recipe_ingredient", { p_ingredient_id: id(formData, "ingredient_id") });
  done(recipeId);
}

export async function deleteRecipe(formData: FormData) {
  await rpc("delete_recipe", { p_recipe_id: id(formData, "recipe_id") });
  revalidatePath("/recipes");
  redirect("/recipes");
}
