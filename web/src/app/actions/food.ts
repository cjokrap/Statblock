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
  // Add food logs several in a row from favorites and recents, so it comes back.
  const back = String(formData.get("back") ?? "");
  if (back.startsWith("/log?")) redirect(back);
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
  if (formData.get("then") === "home") redirect("/"); // from the edit page
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

// Change a logged entry's amount or meal. edit_food_log voids the old entry
// and logs the new one at the same time, in one transaction.
export async function editFood(formData: FormData) {
  const eventId = Number(formData.get("event_id"));
  const grams = Number(formData.get("grams"));
  const meal = formData.get("meal");
  const portion = String(formData.get("portion_label") ?? "").trim() || null;
  if (!Number.isInteger(eventId) || !(grams > 0 && grams < 100000) || !isMeal(meal)) {
    throw new Error("Invalid edit");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_food_log", {
    p_event_id: eventId,
    p_grams: Math.round(grams * 100) / 100,
    p_meal: meal,
    p_portion_label: portion,
  });
  if (error) throw new Error(error.message);
  await rescore(supabase);
  revalidatePath("/");
  redirect("/");
}

// Where to go after a favorite or recipe change: only app pages, never an
// outside URL.
function backTo(formData: FormData, fallback: string) {
  const back = String(formData.get("back") ?? "");
  return back.startsWith("/") && !back.startsWith("//") ? back : fallback;
}

// Star a food with the amount chosen, or update that amount. One favorite
// per food.
export async function saveFavorite(formData: FormData) {
  const foodId = Number(formData.get("food_id"));
  const grams = Number(formData.get("grams"));
  const portion = String(formData.get("portion_label") ?? "").trim() || null;
  if (!Number.isInteger(foodId) || !(grams > 0 && grams < 100000)) throw new Error("Invalid favorite");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) throw new Error("Not signed in");
  const { error } = await supabase
    .from("food_favorites")
    .upsert(
      { user_id: userId, food_id: foodId, grams: Math.round(grams * 100) / 100, portion_label: portion },
      { onConflict: "user_id,food_id" },
    );
  if (error) throw new Error(error.message);
  redirect(backTo(formData, `/log/food/${foodId}`));
}

export async function removeFavorite(formData: FormData) {
  const foodId = Number(formData.get("food_id"));
  if (!Number.isInteger(foodId)) throw new Error("Invalid favorite");
  const supabase = await createClient();
  const { error } = await supabase.from("food_favorites").delete().eq("food_id", foodId);
  if (error) throw new Error(error.message);
  redirect(backTo(formData, `/log/food/${foodId}`));
}
