"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { KG_PER_LB, ML_PER_OZ, parseNumber } from "@/lib/targets";

// Dashboard buttons. Each writes one event through its log_* function (RLS
// applies), rescores today so XP and quests update at once, and refreshes
// Today. Errors throw to the error page; these only fail if signed out.

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function done(supabase: Supabase) {
  await supabase.rpc("rescore_me");
  revalidatePath("/");
}

function check(r: { error: { message: string } | null }) {
  if (r.error) throw new Error(r.error.message);
}

export async function addWater(formData: FormData) {
  const amount = parseNumber(formData.get("amount"));
  const unit = formData.get("unit");
  if (amount === null || amount <= 0 || (unit !== "oz" && unit !== "ml")) throw new Error("Invalid water amount");
  const ml = Math.round(unit === "oz" ? amount * ML_PER_OZ : amount);
  if (ml < 1 || ml > 5000) throw new Error("Invalid water amount");
  const supabase = await createClient();
  check(await supabase.rpc("log_water", { p_ml: ml }));
  await done(supabase);
}

export async function takeStack() {
  const supabase = await createClient();
  check(await supabase.rpc("log_stack"));
  await done(supabase);
}

export async function logSelfCare(formData: FormData) {
  const id = Number(formData.get("category_id"));
  if (!Number.isInteger(id)) throw new Error("Invalid category");
  const supabase = await createClient();
  check(await supabase.rpc("log_self_care", { p_category_id: id }));
  await done(supabase);
}

export async function logWeighIn(formData: FormData) {
  const w = parseNumber(formData.get("weight"));
  const unit = formData.get("unit");
  if (w === null || (unit !== "lb" && unit !== "kg")) throw new Error("Invalid weight");
  // Two decimals (the column's precision), so 219 lb reads back as 219.
  const kg = Math.round((unit === "lb" ? w * KG_PER_LB : w) * 100) / 100;
  if (kg < 25 || kg > 350) throw new Error("Invalid weight");
  const supabase = await createClient();
  check(await supabase.rpc("log_weigh_in", { p_weight_kg: kg }));
  await done(supabase);
}

// Can't train on a planned day. Injury and sick also freeze STR until
// "I'm recovered" (log_skip opens the recovery period).
export async function logSkip(formData: FormData) {
  const reason = formData.get("reason");
  if (reason !== "injury" && reason !== "sick" && reason !== "skipped") throw new Error("Invalid reason");
  const supabase = await createClient();
  check(await supabase.rpc("log_skip", { p_reason: reason }));
  await done(supabase);
}

export async function endRecovery(formData: FormData) {
  const id = Number(formData.get("recovery_id"));
  if (!Number.isInteger(id)) throw new Error("Invalid recovery period");
  const supabase = await createClient();
  const [today, period] = await Promise.all([
    supabase.rpc("my_today"),
    supabase.from("recovery_periods").select("starts_on").eq("id", id).single(),
  ]);
  check(today);
  check(period);
  // Recovered today: the freeze covers up to yesterday (or its first day).
  const yesterday = new Date(Date.parse(today.data + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  const endsOn = yesterday < period.data!.starts_on ? period.data!.starts_on : yesterday;
  check(await supabase.from("recovery_periods").update({ ends_on: endsOn }).eq("id", id));
  await done(supabase);
}

// Undo one of today's taps (water, stack, self-care, weigh-in, skip). Events
// are append-only, so this adds a void event. Undoing an injury or sick
// skip also removes the recovery period it opened that day.
export async function undoEvent(formData: FormData) {
  const id = Number(formData.get("event_id"));
  if (!Number.isInteger(id)) throw new Error("Invalid event");
  const supabase = await createClient();
  const ev = await supabase.from("live_events").select("id, type, local_date").eq("id", id).maybeSingle();
  check(ev);
  if (!ev.data) return revalidatePath("/"); // already undone
  if (!["water", "stack_taken", "self_care", "weigh_in", "skip"].includes(ev.data.type)) {
    throw new Error("That can't be undone here");
  }
  check(await supabase.rpc("void_event", { p_event_id: id }));
  if (ev.data.type === "skip") {
    const others = await supabase
      .from("live_events")
      .select("id")
      .eq("type", "skip")
      .eq("local_date", ev.data.local_date);
    check(others);
    if ((others.data ?? []).length === 0) {
      check(
        await supabase
          .from("recovery_periods")
          .delete()
          .eq("starts_on", ev.data.local_date)
          .is("ends_on", null),
      );
    }
  }
  await done(supabase);
}
