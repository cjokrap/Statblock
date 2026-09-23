"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
