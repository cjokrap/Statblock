"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { loadSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVITIES,
  ageOn,
  CM_PER_IN,
  EATING_STYLES,
  isOneOf,
  KG_PER_LB,
  ML_PER_OZ,
  parseNumber,
  round1,
  SEXES,
  suggestTargets,
} from "@/lib/targets";

export type FormState = { error: string | null };

type Supabase = Awaited<ReturnType<typeof createClient>>;

function restDays(formData: FormData): number[] {
  const days = formData.getAll("rest_day").map(Number);
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
}

function trainingDays(formData: FormData): number | null {
  const n = parseNumber(formData.get("training_days"));
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 7 ? n : null;
}

// Targets are effective-dated: saving writes the row that starts today (in
// the user's time zone), replacing today's row if there is one. Past days
// keep the targets they were scored against.
async function saveTargets(supabase: Supabase, row: Record<string, unknown>): Promise<string | null> {
  const [{ data: auth }, today] = await Promise.all([supabase.auth.getClaims(), supabase.rpc("my_today")]);
  if (!auth?.claims?.sub || today.error) return "You're signed out. Sign in and try again.";
  const { error } = await supabase
    .from("user_settings")
    .upsert({ ...row, user_id: auth.claims.sub, effective_from: today.data }, { onConflict: "user_id,effective_from" });
  if (error) return `Couldn't save your targets: ${error.message}`;
  // Today's quests and scores use the new targets at once.
  await supabase.rpc("rescore_me");
  return null;
}

export async function saveSetup(_prev: FormState, formData: FormData): Promise<FormState> {
  const data = await loadSettings();
  const lb = data.profile.weight_unit === "lb";
  const toKg = (v: number | null) => (v === null ? null : lb ? v * KG_PER_LB : v);

  const sex = formData.get("sex");
  const activity = formData.get("activity");
  const style = formData.get("style");
  const pace = parseNumber(formData.get("pace"));
  const birthDate = String(formData.get("birth_date") ?? "");
  const heightCm = lb
    ? (() => {
        const ft = parseNumber(formData.get("height_ft"));
        const inches = parseNumber(formData.get("height_in")) ?? 0;
        return ft === null ? null : (ft * 12 + inches) * CM_PER_IN;
      })()
    : parseNumber(formData.get("height_cm"));
  const weightKg = toKg(parseNumber(formData.get("weight")));
  const goalKg = toKg(parseNumber(formData.get("goal_weight")));
  const training = trainingDays(formData);

  if (!isOneOf(SEXES, sex)) return { error: "Pick male or female (used only for the calorie estimate)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return { error: "Enter your birthday." };
  const age = ageOn(birthDate, data.today);
  if (age < 13 || age > 110) return { error: "Check your birthday." };
  if (heightCm === null || heightCm < 90 || heightCm > 250) return { error: "Check your height." };
  if (weightKg === null || weightKg < 30 || weightKg > 350) return { error: "Check your current weight." };
  if (goalKg === null || goalKg < 30 || goalKg > 350) return { error: "Check your goal weight." };
  if (!isOneOf(ACTIVITIES, activity)) return { error: "Pick how active you are." };
  if (pace === null || ![0, 0.5, 1, 1.5].includes(pace)) return { error: "Pick a pace." };
  if (!isOneOf(EATING_STYLES, style)) return { error: "Pick an eating style." };
  if (training === null) return { error: "Training days must be 0 to 7." };

  const supabase = await createClient();
  const profile = await supabase
    .from("profiles")
    .update({
      sex,
      birth_date: birthDate,
      height_cm: round1(heightCm),
      goal_weight_kg: round1(goalKg),
      ...(data.profile.onboarded_at ? {} : { onboarded_at: new Date().toISOString() }),
    })
    .eq("user_id", (await supabase.auth.getClaims()).data?.claims?.sub ?? "");
  if (profile.error) return { error: `Couldn't save your profile: ${profile.error.message}` };

  // The current weight is a weigh-in (it counts for CHA), unless it's
  // the same as the last one.
  if (data.latestWeightKg === null || Math.abs(data.latestWeightKg - weightKg) >= 0.05) {
    const w = await supabase.rpc("log_weigh_in", { p_weight_kg: Math.round(weightKg * 100) / 100 });
    if (w.error) return { error: `Couldn't save your weight: ${w.error.message}` };
  }

  const s = suggestTargets(data.rules, {
    body: { sex, weightKg, heightCm, age },
    goalWeightKg: goalKg,
    activity,
    paceLbPerWeek: pace,
    style,
  });
  const training_ = { training_days_per_week: training, rest_days: restDays(formData) };

  if (formData.get("mode") === "own") {
    // Settings starts from the suggestion; nothing is judged until it's saved.
    const q = new URLSearchParams({
      kcal: String(s.calorie_target),
      style,
      protein: String(s.protein_g),
      carbs: String(s.carbs_g),
      fat: String(s.fat_g),
      water_ml: String(s.water_goal_ml),
      training: String(training),
      rest: training_.rest_days.join(","),
    });
    revalidatePath("/", "layout");
    redirect(`/settings?${q}`);
  }

  const error = await saveTargets(supabase, {
    calorie_target: s.calorie_target,
    calorie_window_pct: data.settings?.calorie_window_pct ?? 10,
    eating_style: style,
    protein_g: s.protein_g,
    carbs_g: s.carbs_g,
    fat_g: s.fat_g,
    carbs_are_ceiling: s.carbs_are_ceiling,
    count_net_carbs: s.count_net_carbs,
    water_goal_ml: s.water_goal_ml,
    ...training_,
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  redirect("/");
}

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const int = (name: string) => {
    const n = parseNumber(formData.get(name));
    return n === null ? null : Math.round(n);
  };
  const kcal = int("calorie_target");
  const windowPct = parseNumber(formData.get("calorie_window_pct"));
  const style = formData.get("eating_style");
  const protein = int("protein_g");
  const carbs = int("carbs_g");
  const fat = int("fat_g");
  const fiberRaw = String(formData.get("fiber_g") ?? "").trim();
  const fiber = fiberRaw === "" ? null : int("fiber_g");
  const water = parseNumber(formData.get("water"));
  const training = trainingDays(formData);
  const weightUnit = formData.get("weight_unit");
  const waterUnit = formData.get("water_unit");
  const timezone = String(formData.get("timezone") ?? "");

  if (kcal === null || kcal < 800 || kcal > 8000) return { error: "Daily calories must be between 800 and 8,000." };
  if (windowPct === null || windowPct < 1 || windowPct > 50) return { error: "The calorie window must be 1 to 50%." };
  if (!isOneOf(EATING_STYLES, style)) return { error: "Pick an eating style." };
  if (protein === null || protein < 0 || protein > 600) return { error: "Protein must be 0 to 600 g." };
  if (carbs === null || carbs < 0 || carbs > 1000) return { error: "Carbs must be 0 to 1,000 g." };
  if (fat === null || fat < 0 || fat > 400) return { error: "Fat must be 0 to 400 g." };
  if (fiberRaw !== "" && (fiber === null || fiber < 0 || fiber > 150)) return { error: "Fiber must be 0 to 150 g." };
  if (weightUnit !== "lb" && weightUnit !== "kg") return { error: "Pick a weight unit." };
  if (waterUnit !== "oz" && waterUnit !== "ml") return { error: "Pick a water unit." };
  const waterMl = water === null ? null : Math.round(waterUnit === "oz" ? water * ML_PER_OZ : water);
  if (waterMl === null || waterMl < 0 || waterMl > 10000) return { error: "Check your water goal." };
  if (training === null) return { error: "Training days must be 0 to 7." };
  if (!Intl.supportedValuesOf("timeZone").includes(timezone) && timezone !== "UTC") {
    return { error: "Pick a time zone." };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const profile = await supabase
    .from("profiles")
    .update({ weight_unit: weightUnit, water_unit: waterUnit, timezone })
    .eq("user_id", auth?.claims?.sub ?? "");
  if (profile.error) return { error: `Couldn't save your units: ${profile.error.message}` };

  const error = await saveTargets(supabase, {
    calorie_target: kcal,
    calorie_window_pct: windowPct,
    eating_style: style,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    carbs_are_ceiling: formData.get("carbs_are_ceiling") === "on",
    count_net_carbs: formData.get("count_net_carbs") === "on",
    fiber_g: fiber,
    water_goal_ml: waterMl,
    training_days_per_week: training,
    rest_days: restDays(formData),
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

// ---- Daily stack ----------------------------------------------------------
// Supplements are the user's own (custom) rows; DSLD label data isn't
// loaded yet. Removing one deactivates it, so past stack logs keep pointing
// at it.
export async function addStackItem(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const serving = String(formData.get("serving") ?? "").trim().slice(0, 60) || "1 serving";
  const fiber = parseNumber(formData.get("fiber"));
  if (!name) return;
  if (fiber !== null && (fiber < 0 || fiber > 100)) throw new Error("Fiber must be 0 to 100 g per serving");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) throw new Error("Not signed in");
  const sup = await supabase
    .from("supplements")
    .insert({ source: "custom", owner_user_id: uid, name, serving_label: serving })
    .select("id")
    .single();
  if (sup.error) throw new Error(sup.error.message);
  const count = await supabase.from("daily_stack_items").select("id", { count: "exact" }).limit(1);
  const item = await supabase
    .from("daily_stack_items")
    .insert({ user_id: uid, supplement_id: sup.data.id, sort: count.count ?? 0 });
  if (item.error) throw new Error(item.error.message);
  if (fiber) await writeFiber(supabase, sup.data.id, fiber);
  await supabase.rpc("rescore_me"); // the "Take the stack" quest now applies
  revalidatePath("/", "layout");
}

export async function removeStackItem(formData: FormData) {
  const id = Number(formData.get("item_id"));
  if (!Number.isInteger(id)) throw new Error("Invalid item");
  const supabase = await createClient();
  const { error } = await supabase.from("daily_stack_items").update({ active: false }).eq("id", id);
  if (error) throw new Error(error.message);
  await supabase.rpc("rescore_me");
  revalidatePath("/", "layout");
}

// A supplement's fiber per serving, in supplement_nutrients (RLS: the
// user's own custom supplements only). 0 or blank removes it.
async function writeFiber(supabase: Supabase, supplementId: number, grams: number | null) {
  const nutrient = await supabase.from("nutrients").select("id").eq("code", "fiber").single();
  if (nutrient.error) throw new Error(nutrient.error.message);
  const del = await supabase
    .from("supplement_nutrients")
    .delete()
    .eq("supplement_id", supplementId)
    .eq("nutrient_id", nutrient.data.id);
  if (del.error) throw new Error(del.error.message);
  if (grams && grams > 0) {
    const ins = await supabase
      .from("supplement_nutrients")
      .insert({ supplement_id: supplementId, nutrient_id: nutrient.data.id, amount_per_serving: grams });
    if (ins.error) throw new Error(ins.error.message);
  }
}

export async function setStackFiber(formData: FormData) {
  const supplementId = Number(formData.get("supplement_id"));
  const fiber = parseNumber(formData.get("fiber"));
  if (!Number.isInteger(supplementId)) throw new Error("Invalid supplement");
  if (fiber !== null && (fiber < 0 || fiber > 100)) throw new Error("Fiber must be 0 to 100 g per serving");
  const supabase = await createClient();
  await writeFiber(supabase, supplementId, fiber);
  revalidatePath("/", "layout");
}
