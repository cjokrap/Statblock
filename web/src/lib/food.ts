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
  fiber_100g: number | null;
  recipe_id: number | null; // set on foods made from one of the user's recipes
};

export type Portion = { label: string; grams: number };

export type LoggedItem = {
  eventId: number;
  localDate?: string; // the day it was logged for
  meal: Meal;
  grams: number;
  portionLabel: string | null;
  food: FoodRow;
};

const FOOD_COLUMNS = "id, source, source_id, name, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, recipe_id";

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
async function loggedItems(filter: { date?: string; since?: string; limit?: number }): Promise<LoggedItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("live_events")
    .select("id, occurred_at, local_date")
    .eq("type", "food")
    .order("occurred_at", { ascending: false });
  if (filter.date) q = q.eq("local_date", filter.date);
  if (filter.since) q = q.gte("local_date", filter.since);
  if (filter.limit) q = q.limit(filter.limit);
  const { data: events, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (events ?? []).map((e) => e.id as number);
  const dates = new Map((events ?? []).map((e) => [e.id as number, e.local_date as string]));
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
      localDate: dates.get(l.event_id as number),
      meal: l.meal as Meal,
      grams: Number(l.grams),
      portionLabel: l.portion_label as string | null,
      food: l.foods as unknown as FoodRow,
    }));
}

export async function todaysLog(timezone: string): Promise<LoggedItem[]> {
  return loggedItems({ date: localNow(timezone).date });
}

// One live food entry of the user's, with its food's portions, for editing.
export async function getEntry(
  eventId: number,
): Promise<{ item: LoggedItem; portions: Portion[]; localDate: string } | null> {
  const supabase = await createClient();
  const { data: ev, error } = await supabase
    .from("live_events")
    .select("id, local_date")
    .eq("id", eventId)
    .eq("type", "food")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ev) return null;
  const { data: log, error: logError } = await supabase
    .from("food_log")
    .select(`event_id, grams, meal, portion_label, foods (${FOOD_COLUMNS})`)
    .eq("event_id", eventId)
    .single();
  if (logError) throw new Error(logError.message);
  const food = log.foods as unknown as FoodRow;
  const found = await getFood(food.id);
  return {
    item: {
      eventId,
      meal: log.meal as Meal,
      grams: Number(log.grams),
      portionLabel: log.portion_label as string | null,
      food,
    },
    portions: found?.portions ?? [],
    localDate: ev.local_date as string,
  };
}

// A recipe edited after it was logged moves to a new food (the old one keeps
// its values for the days it was logged). Favorites and recents follow the
// recipe to its current food; deleted recipes drop out.
async function currentFoods<T extends { food: FoodRow }>(items: T[]): Promise<T[]> {
  const recipeIds = [...new Set(items.map((i) => i.food.recipe_id).filter((r): r is number => r !== null))];
  if (recipeIds.length === 0) return items;
  const supabase = await createClient();
  const { data: recipes, error } = await supabase
    .from("recipes")
    .select(`id, deleted_at, foods!recipes_food_fk (${FOOD_COLUMNS})`)
    .in("id", recipeIds);
  if (error) throw new Error(error.message);
  const current = new Map(
    (recipes ?? [])
      .filter((r) => !r.deleted_at && r.foods)
      .map((r) => [r.id as number, r.foods as unknown as FoodRow]),
  );
  return items.flatMap((it) => {
    if (it.food.recipe_id === null) return [it];
    const food = current.get(it.food.recipe_id);
    return food ? [{ ...it, food }] : [];
  });
}

// Everything logged in the last 7 days (today included), newest first, once
// per food and amount: meal prep repeats, so these are one tap to log again.
export async function recentWeek(timezone: string): Promise<(LoggedItem & { times: number })[]> {
  const today = localNow(timezone).date;
  const since = new Date(Date.parse(today + "T00:00:00Z") - 6 * 86_400_000).toISOString().slice(0, 10);
  const items = await currentFoods(await loggedItems({ since }));
  const byKey = new Map<string, LoggedItem & { times: number }>();
  for (const it of items) {
    const key = `${it.food.id}:${it.grams}:${it.portionLabel ?? ""}`;
    const seen = byKey.get(key);
    if (seen) seen.times++;
    else byKey.set(key, { ...it, times: 1 });
  }
  return [...byKey.values()];
}

export type Favorite = { food: FoodRow; grams: number; portionLabel: string | null };

// The user's favorite foods with the amount each is logged at, A to Z.
export async function favorites(): Promise<Favorite[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("food_favorites")
    .select(`grams, portion_label, foods (${FOOD_COLUMNS})`);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => ({
    food: r.foods as unknown as FoodRow,
    grams: Number(r.grams),
    portionLabel: r.portion_label as string | null,
  }));
  return (await currentFoods(rows)).sort((a, b) => a.food.name.localeCompare(b.food.name));
}

// Which of these foods (or their recipes) are favorites.
export async function favoriteFoodIds(): Promise<Set<number>> {
  const favs = await favorites();
  return new Set(favs.map((f) => f.food.id));
}
