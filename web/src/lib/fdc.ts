import "server-only";
import { parseBranded, rankBranded, type BrandedFood, type FdcFoodRaw } from "@/lib/fdcParse";

// USDA FoodData Central API, for packaged (Branded) foods, which aren't
// bulk-loaded. FDC_API_BASE overrides the address in tests.
const BASE = process.env.FDC_API_BASE ?? "https://api.nal.usda.gov/fdc/v1";

export function fdcConfigured(): boolean {
  return Boolean(process.env.FDC_API_KEY && process.env.SUPABASE_SECRET_KEY);
}

async function fdcGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", process.env.FDC_API_KEY ?? "");
  // Product data changes rarely; cache a day on the server.
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`USDA FoodData Central returned ${res.status}`);
  return res.json();
}

export type BrandedPage = { foods: BrandedFood[]; page: number; totalPages: number };

type SearchResponse = { foods?: FdcFoodRaw[]; totalHits?: number; totalPages?: number } | null;

// One page of packaged foods, best matches first. Asks FDC for products
// matching every word, falling back to any word when none do; then
// rankBranded orders the page by how many words each one matches.
export async function searchBranded(query: string, page = 1, pageSize = 25): Promise<BrandedPage> {
  const q = query.trim();
  const empty = { foods: [], page, totalPages: 0 };
  if (q.length < 3 || !fdcConfigured()) return empty;
  const params = { query: q, dataType: "Branded", pageSize: String(pageSize), pageNumber: String(page) };
  let data = (await fdcGet("/foods/search", { ...params, requireAllWords: "true" })) as SearchResponse;
  if (!data?.totalHits) data = (await fdcGet("/foods/search", params)) as SearchResponse;
  const foods = rankBranded(q, (data?.foods ?? []).filter((f) => Number.isInteger(f.fdcId)))
    .map(parseBranded)
    .filter((f) => f.kcal !== null); // no energy, no scoring
  return { foods, page, totalPages: data?.totalPages ?? 1 };
}

export async function getBranded(fdcId: number): Promise<BrandedFood | null> {
  if (!Number.isInteger(fdcId) || fdcId <= 0 || !fdcConfigured()) return null;
  const raw = (await fdcGet(`/food/${fdcId}`, {})) as FdcFoodRaw | null;
  if (!raw || (raw.dataType && raw.dataType !== "Branded")) return null;
  const food = parseBranded({ ...raw, fdcId });
  return food.kcal === null ? null : food;
}
