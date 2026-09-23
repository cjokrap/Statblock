import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EatingStyle, Sex, TargetRules } from "@/lib/targets";

export type Profile = {
  sex: Sex | null;
  birth_date: string | null;
  height_cm: number | null;
  goal_weight_kg: number | null;
  timezone: string;
  weight_unit: "lb" | "kg";
  water_unit: "oz" | "ml";
  onboarded_at: string | null;
};

export type SettingsRow = {
  effective_from: string;
  calorie_target: number;
  calorie_window_pct: number;
  eating_style: EatingStyle;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  carbs_are_ceiling: boolean;
  count_net_carbs: boolean;
  water_goal_ml: number;
  training_days_per_week: number;
  rest_days: number[];
};

export type SettingsData = {
  today: string; // the user's calendar day
  profile: Profile;
  settings: SettingsRow | null; // the row in force today
  latestWeightKg: number | null;
  rules: TargetRules;
};

// Everything the setup and settings screens need, read with the user's own
// session (RLS limits every query to their rows).
export async function loadSettings(): Promise<SettingsData> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) throw new Error("not signed in");

  const today = await supabase.rpc("my_today");
  if (today.error) throw new Error(today.error.message);
  const [profile, settings, weighIn, version] = await Promise.all([
    supabase
      .from("profiles")
      .select("sex, birth_date, height_cm, goal_weight_kg, timezone, weight_unit, water_unit, onboarded_at")
      .eq("user_id", userId)
      .single(),
    supabase
      .from("user_settings")
      .select(
        "effective_from, calorie_target, calorie_window_pct, eating_style, protein_g, carbs_g, fat_g, " +
          "carbs_are_ceiling, count_net_carbs, water_goal_ml, training_days_per_week, rest_days",
      )
      .lte("effective_from", today.data)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("live_events")
      .select("id")
      .eq("type", "weigh_in")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("rules_versions").select("version").eq("is_active", true).single(),
  ]);
  for (const r of [profile, settings, weighIn, version]) if (r.error) throw new Error(r.error.message);
  if (!profile.data || !version.data) throw new Error("profile or active rules version missing");

  const [weight, config] = await Promise.all([
    weighIn.data
      ? supabase.from("weigh_ins").select("weight_kg").eq("event_id", weighIn.data.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("rules_config")
      .select("key, value")
      .eq("version", version.data.version)
      .in("key", ["targets.eating_styles", "targets.suggestions"]),
  ]);
  for (const r of [weight, config]) if (r.error) throw new Error(r.error.message);

  const value = (key: string) => (config.data ?? []).find((r) => r.key === key)?.value;
  const p = profile.data;
  const s = settings.data as unknown as Record<string, unknown> | null;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    today: today.data as string,
    profile: {
      sex: p.sex,
      birth_date: p.birth_date,
      height_cm: num(p.height_cm),
      goal_weight_kg: num(p.goal_weight_kg),
      timezone: p.timezone,
      weight_unit: p.weight_unit,
      water_unit: p.water_unit,
      onboarded_at: p.onboarded_at,
    },
    settings: s
      ? ({ ...s, calorie_window_pct: Number(s.calorie_window_pct) } as SettingsRow)
      : null,
    latestWeightKg: num(weight.data?.weight_kg),
    rules: { styles: value("targets.eating_styles") ?? {}, suggestions: value("targets.suggestions") },
  };
}

// The active daily stack, for Settings.
export async function loadStack(): Promise<{ id: number; name: string; serving: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_stack_items")
    .select("id, servings, sort, supplements (name, serving_label)")
    .eq("active", true)
    .order("sort");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as {
    id: number;
    servings: number;
    supplements: { name: string; serving_label: string } | null;
  }[]).map((i) => ({
    id: i.id,
    name: i.supplements?.name ?? "Supplement",
    serving: i.supplements?.serving_label ?? "1 serving",
  }));
}
