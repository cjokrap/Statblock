"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { importBrandedFood } from "@/lib/brandedImport";
import { getBranded } from "@/lib/fdc";
import { fetchOff, importOffFood } from "@/lib/off";
import { createClient } from "@/lib/supabase/server";
import { isMeal } from "@/lib/meals";

async function rescore(supabase: Awaited<ReturnType<typeof createClient>>) {
  // XP and quests update at once; a failure here only delays them until
  // the scheduled rescore, so it never blocks the log itself.
  await supabase.rpc("rescore_me");
}

export async function logFood(formData: FormData) {
  const foodId = Number(formData.get("food_id"));
  const grams = Number(formData.get("grams"));
  const meal = formData.get("meal");
  const portion = String(formData.get("portion_label") ?? "").trim() || null;
  if (!Number.isInteger(foodId) || !(grams > 0 && grams < 100000) || !isMeal(meal)) {
    throw new Error("Invalid food log");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_food", {
    p_food_id: foodId,
    p_grams: Math.round(grams * 100) / 100,
    p_meal: meal,
    p_portion_label: portion,
  });
  if (error) throw new Error(error.message);
  await rescore(supabase);
  revalidatePath("/");
  if (formData.get("stay") !== "1") redirect("/");
}

export async function removeFood(formData: FormData) {
  const eventId = Number(formData.get("event_id"));
  if (!Number.isInteger(eventId)) throw new Error("Invalid event");
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_event", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  await rescore(supabase);
  revalidatePath("/");
}

// Log a USDA packaged food by its FDC id. The product is fetched from USDA
// here on the server (never taken from the browser), saved to the shared
// foods table the first time, then logged like any other food.
export async function logBrandedFood(formData: FormData) {
  const fdcId = Number(formData.get("fdc_id"));
  const grams = Number(formData.get("grams"));
  const meal = formData.get("meal");
  const portion = String(formData.get("portion_label") ?? "").trim() || null;
  if (!Number.isInteger(fdcId) || !(grams > 0 && grams < 100000) || !isMeal(meal)) {
    throw new Error("Invalid food log");
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) throw new Error("Not signed in");

  const food = await getBranded(fdcId, {
    query: String(formData.get("q") ?? ""),
    page: Number.parseInt(String(formData.get("bp") ?? "1"), 10) || 1,
  });
  if (!food) throw new Error("USDA doesn't have that product any more");
  const foodId = await importBrandedFood(food);

  const { error } = await supabase.rpc("log_food", {
    p_food_id: foodId,
    p_grams: Math.round(grams * 100) / 100,
    p_meal: meal,
    p_portion_label: portion,
  });
  if (error) throw new Error(error.message);
  await rescore(supabase);
  revalidatePath("/");
  redirect("/");
}

// Log a product found by barcode in Open Food Facts. It's fetched again
// here (never trusted from the form) and saved into foods on first log.
export async function logOffFood(formData: FormData) {
  const barcode = String(formData.get("barcode") ?? "").replace(/\D/g, "");
  const grams = Number(formData.get("grams"));
  const meal = formData.get("meal");
  const portion = String(formData.get("portion_label") ?? "").trim() || null;
  if (!barcode || !(grams > 0 && grams < 100000) || !isMeal(meal)) throw new Error("Invalid food log");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) throw new Error("Not signed in");

  const found = await fetchOff(barcode);
  if (typeof found === "string") throw new Error("Open Food Facts doesn't have that product any more");
  const foodId = await importOffFood(found.food, found.raw);

  const { error } = await supabase.rpc("log_food", {
    p_food_id: foodId,
    p_grams: Math.round(grams * 100) / 100,
    p_meal: meal,
    p_portion_label: portion,
  });
  if (error) throw new Error(error.message);
  await rescore(supabase);
  revalidatePath("/");
  redirect("/");
}
