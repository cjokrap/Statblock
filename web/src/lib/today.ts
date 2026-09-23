import "server-only";
import type { QuestRow, SetRow } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";
import { fiberSuggestion } from "@/lib/targets";

export type Today = {
  date: string; // the user's calendar day
  monday: string;
  timezone: string;
  weightUnit: "lb" | "kg";
  waterUnit: "oz" | "ml";
  targets: {
    calorie_target: number;
    calorie_window_pct: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    carbs_are_ceiling: boolean;
    fiber_g: number; // the goal, or the suggestion when none is set
    water_goal_ml: number;
  } | null;
  quests: QuestRow[]; // today's daily quests
  bosses: QuestRow[]; // this week's
  water: { totalMl: number; lastEventId: number | null };
  stack: {
    items: { name: string; serving: string }[];
    taken: { eventId: number; at: string } | null;
    fiberG: number; // fiber from stacks taken today
  };
  selfCare: { id: number; name: string; weight: number }[];
  selfCareToday: { eventId: number; categoryId: number; at: string }[];
  weighIn: { eventId: number; kg: number } | null; // today's
  training: {
    sessions: { eventId: number; at: string; program: string | null; label: string | null; sets: SetRow[] }[];
    skip: { eventId: number; reason: "injury" | "sick" | "skipped" } | null; // today's
    recovery: { id: number; reason: "injury" | "sick"; startsOn: string } | null; // open
    isRestDay: boolean;
  };
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// Everything the Today dashboard shows besides the food log and character
// sheet, read with the user's own session (RLS limits it to their rows).
export async function loadToday(): Promise<Today> {
  const supabase: Supabase = await createClient();
  const date = must(await supabase.rpc("my_today")) as string;
  const d = new Date(date + "T00:00:00Z");
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);

  const [profile, settings, quests, defs, events, stackItems, categories, recovery] = await Promise.all([
    supabase.from("profiles").select("timezone, weight_unit, water_unit").single(),
    supabase
      .from("user_settings")
      .select("calorie_target, calorie_window_pct, protein_g, carbs_g, fat_g, carbs_are_ceiling, fiber_g, water_goal_ml, rest_days")
      .lte("effective_from", date)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("quest_progress")
      .select("quest_code, period_start, progress, target, completed_at")
      .in("period_start", [date, monday]),
    supabase.from("quest_definitions").select("code, name, cadence, xp, track_code, sort").order("sort"),
    supabase
      .from("live_events")
      .select("id, type, occurred_at")
      .eq("local_date", date)
      .in("type", ["water", "stack_taken", "self_care", "weigh_in", "workout_session", "skip"])
      .order("occurred_at"),
    supabase
      .from("daily_stack_items")
      .select("servings, sort, supplements (name, serving_label)")
      .eq("active", true)
      .order("sort"),
    supabase.from("self_care_categories").select("id, name, weight, sort").eq("active", true).order("sort"),
    supabase
      .from("recovery_periods")
      .select("id, reason, starts_on")
      .is("ends_on", null)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const p = must(profile);
  if (!p) throw new Error("profile missing");
  const s = must(settings);
  const evs = must(events) ?? [];
  const ids = (type: string) => evs.filter((e) => e.type === type).map((e) => e.id as number);

  // Detail rows for today's events.
  const [water, selfCare, weighIns, sessions, sets, prs, skips, stackLog] = await Promise.all([
    ids("water").length ? supabase.from("water_log").select("event_id, ml").in("event_id", ids("water")) : null,
    ids("self_care").length
      ? supabase.from("self_care_log").select("event_id, category_id").in("event_id", ids("self_care"))
      : null,
    ids("weigh_in").length ? supabase.from("weigh_ins").select("event_id, weight_kg").in("event_id", ids("weigh_in")) : null,
    ids("workout_session").length
      ? supabase
          .from("workout_sessions")
          .select("event_id, program, day_name, week, day_in_week")
          .in("event_id", ids("workout_session"))
      : null,
    ids("workout_session").length
      ? supabase
          .from("workout_sets")
          .select("event_id, session_event_id, exercise, tier, set_index, reps, weight_kg, is_warmup, est_1rm_kg")
          .in("session_event_id", ids("workout_session"))
      : null,
    ids("workout_session").length
      ? supabase.from("workout_prs").select("event_id, is_pr").eq("local_date", date).eq("is_pr", true)
      : null,
    ids("skip").length ? supabase.from("skips").select("event_id, reason").in("event_id", ids("skip")) : null,
    // What was in each stack taken today, with its fiber per serving.
    ids("stack_taken").length
      ? supabase
          .from("stack_log")
          .select("servings, supplements (supplement_nutrients (amount_per_serving, nutrients (code)))")
          .in("event_id", ids("stack_taken"))
      : null,
  ]);
  const rows = <T,>(r: { data: T[] | null; error: { message: string } | null } | null): T[] =>
    r ? (must(r) ?? []) : [];

  // Voided sets don't show: only sets whose own event is live today.
  const liveSetIds = new Set<number>();
  const setRows = rows(sets) as {
    event_id: number;
    session_event_id: number;
    exercise: string;
    tier: string | null;
    set_index: number;
    reps: number;
    weight_kg: number;
    is_warmup: boolean;
    est_1rm_kg: number | null;
  }[];
  if (setRows.length) {
    const live = rows(
      await supabase.from("live_events").select("id").in("id", setRows.map((r) => r.event_id)),
    ) as { id: number }[];
    for (const l of live) liveSetIds.add(l.id);
  }
  const prIds = new Set((rows(prs) as { event_id: number }[]).map((r) => r.event_id));

  const defList = (must(defs) ?? []) as { code: string; name: string; cadence: "daily" | "weekly"; xp: number; track_code: string | null }[];
  const progress = (must(quests) ?? []) as { quest_code: string; period_start: string; progress: number; target: number; completed_at: string | null }[];
  const questRows = (cadence: "daily" | "weekly", start: string): QuestRow[] =>
    defList
      .filter((q) => q.cadence === cadence)
      .flatMap((q) => {
        const r = progress.find((x) => x.quest_code === q.code && x.period_start === start);
        return r
          ? [{
              code: q.code,
              name: q.name,
              cadence,
              xp: q.xp,
              track: q.track_code,
              progress: Number(r.progress),
              target: Number(r.target),
              completedAt: r.completed_at,
            }]
          : [];
      });

  const at = (id: number) => evs.find((e) => e.id === id)?.occurred_at as string;
  const waterRows = rows(water) as { event_id: number; ml: number }[];
  const stackTaken = ids("stack_taken").at(-1);
  const weigh = (rows(weighIns) as { event_id: number; weight_kg: number }[]).sort((a, b) => b.event_id - a.event_id)[0];
  const skip = (rows(skips) as { event_id: number; reason: "injury" | "sick" | "skipped" }[]).sort((a, b) => b.event_id - a.event_id)[0];
  const rec = must(recovery);
  const stackFiber = (rows(stackLog) as unknown as {
    servings: number;
    supplements: { supplement_nutrients: { amount_per_serving: number; nutrients: { code: string } | null }[] } | null;
  }[]).reduce((sum, l) => {
    const f = l.supplements?.supplement_nutrients.find((n) => n.nutrients?.code === "fiber");
    return sum + (f ? Number(f.amount_per_serving) * Number(l.servings) : 0);
  }, 0);
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1;

  return {
    date,
    monday,
    timezone: p.timezone,
    weightUnit: p.weight_unit,
    waterUnit: p.water_unit,
    targets: s
      ? {
          calorie_target: s.calorie_target,
          calorie_window_pct: Number(s.calorie_window_pct),
          protein_g: s.protein_g,
          carbs_g: s.carbs_g,
          fat_g: s.fat_g,
          carbs_are_ceiling: s.carbs_are_ceiling,
          fiber_g: s.fiber_g ?? fiberSuggestion(s.calorie_target),
          water_goal_ml: s.water_goal_ml,
        }
      : null,
    quests: questRows("daily", date),
    bosses: questRows("weekly", monday),
    water: {
      totalMl: waterRows.reduce((t, w) => t + w.ml, 0),
      lastEventId: waterRows.length ? Math.max(...waterRows.map((w) => w.event_id)) : null,
    },
    stack: {
      items: ((must(stackItems) ?? []) as unknown as {
        servings: number;
        supplements: { name: string; serving_label: string } | null;
      }[]).map((i) => ({
        name: i.supplements?.name ?? "Supplement",
        serving: Number(i.servings) === 1 ? (i.supplements?.serving_label ?? "1 serving") : `${Number(i.servings)} × ${i.supplements?.serving_label ?? "serving"}`,
      })),
      taken: stackTaken ? { eventId: stackTaken, at: at(stackTaken) } : null,
      fiberG: stackFiber,
    },
    selfCare: ((must(categories) ?? []) as { id: number; name: string; weight: number }[]).map((c) => ({
      id: c.id,
      name: c.name,
      weight: Number(c.weight),
    })),
    selfCareToday: (rows(selfCare) as { event_id: number; category_id: number }[]).map((r) => ({
      eventId: r.event_id,
      categoryId: r.category_id,
      at: at(r.event_id),
    })),
    weighIn: weigh ? { eventId: weigh.event_id, kg: Number(weigh.weight_kg) } : null,
    training: {
      sessions: (rows(sessions) as {
        event_id: number;
        program: string | null;
        day_name: string | null;
        week: number | null;
        day_in_week: number | null;
      }[])
        .sort((a, b) => a.event_id - b.event_id)
        .map((w) => ({
          eventId: w.event_id,
          at: at(w.event_id),
          program: w.program,
          label:
            w.week && w.day_in_week
              ? `Week ${w.week}, Day ${w.day_in_week}`
              : w.day_name,
          sets: setRows
            .filter((x) => x.session_event_id === w.event_id && liveSetIds.has(x.event_id))
            .map((x) => ({
              exercise: x.exercise,
              tier: x.tier,
              setIndex: x.set_index,
              reps: x.reps,
              weightKg: Number(x.weight_kg),
              isWarmup: x.is_warmup,
              isPr: prIds.has(x.event_id),
              est1rmKg: x.est_1rm_kg === null ? null : Number(x.est_1rm_kg),
            })),
        })),
      skip: skip ? { eventId: skip.event_id, reason: skip.reason } : null,
      recovery: rec ? { id: rec.id, reason: rec.reason, startsOn: rec.starts_on } : null,
      isRestDay: Boolean(s?.rest_days?.includes(isoDow)),
    },
  };
}
