import "server-only";
import { createClient } from "@/lib/supabase/server";
import { localNow, type Meal } from "@/lib/meals";

export type FoodRow = {
  id: number;
  source: string;
  source_id: string | null;
  name: string;
  brand: string | null;
  kcal_100g: number | null;
  protein_100g: number | null;
  carbs_100g: number | null;
  fat_100g: number | null;
};

export type Portion = { label: string; grams: number };

export type LoggedItem = {
  eventId: number;
  meal: Meal;
  grams: number;
  portionLabel: string | null;
  food: FoodRow;
};

const FOOD_COLUMNS = "id, source, source_id, name, brand, kcal_100g, protein_100g, carbs_100g, fat_100g";

export async function userTimezone(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("timezone").maybeSingle();
  return data?.timezone ?? "America/Chicago";
}

// Whole foods first (search_foods orders by source_rank), retired foods hidden.
export async function searchFoods(query: string): Promise<FoodRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_foods", { p_query: q, p_limit: 30 });
  if (error) throw new Error(error.message);
  return (data ?? []) as FoodRow[];
}

export async function getFood(id: number): Promise<{ food: FoodRow; portions: Portion[] } | null> {
  const supabase = await createClient();
  const [food, portions] = await Promise.all([
    supabase.from("foods").select(FOOD_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("food_portions").select("label, grams").eq("food_id", id).order("sort"),
  ]);
  if (food.error) throw new Error(food.error.message);
  if (!food.data) return null;
  return {
    food: food.data as FoodRow,
    portions: (portions.data ?? []).map((p) => ({ label: p.label, grams: Number(p.grams) })),
  };
}

// Live (not voided) food logs, newest first, joined to their foods.
async function loggedItems(filter: { date?: string; limit?: number }): Promise<LoggedItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("live_events")
    .select("id, occurred_at")
    .eq("type", "food")
    .order("occurred_at", { ascending: false });
  if (filter.date) q = q.eq("local_date", filter.date);
  if (filter.limit) q = q.limit(filter.limit);
  const { data: events, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (events ?? []).map((e) => e.id as number);
  if (ids.length === 0) return [];

  const { data: logs, error: logError } = await supabase
    .from("food_log")
    .select(`event_id, grams, meal, portion_label, foods (${FOOD_COLUMNS})`)
    .in("event_id", ids);
  if (logError) throw new Error(logError.message);
  const byId = new Map((logs ?? []).map((l) => [l.event_id as number, l]));
  return ids
    .map((id) => byId.get(id))
    .filter((l) => l !== undefined)
    .map((l) => ({
      eventId: l.event_id as number,
      meal: l.meal as Meal,
      grams: Number(l.grams),
      portionLabel: l.portion_label as string | null,
      food: l.foods as unknown as FoodRow,
    }));
}

export async function todaysLog(timezone: string): Promise<LoggedItem[]> {
  return loggedItems({ date: localNow(timezone).date });
}

// Recently logged foods and amounts, for one-tap re-logging.
export async function recentFoods(max = 6): Promise<LoggedItem[]> {
  const items = await loggedItems({ limit: 60 });
  const seen = new Set<string>();
  const out: LoggedItem[] = [];
  for (const it of items) {
    const key = `${it.food.id}:${it.grams}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length === max) break;
  }
  return out;
}
