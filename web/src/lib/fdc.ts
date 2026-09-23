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

type SearchResponse = { foods?: FdcFoodRaw[]; totalHits?: number } | null;

// Results show 25 to a page, but FDC is asked for 100 at a time so the
// ranking can lift a good match from further down FDC's order.
const PAGE = 25;
const BATCH = 100;

// FDC page `batch` of products for a query. Asks for products matching
// every word, falling back to any word when none do, then ranks them by
// how many words each one matches. Cached a day, like all FDC calls.
async function searchBatch(q: string, batch: number): Promise<{ foods: FdcFoodRaw[]; totalHits: number }> {
  const params = { query: q, dataType: "Branded", pageSize: String(BATCH), pageNumber: String(batch) };
  let data = (await fdcGet("/foods/search", { ...params, requireAllWords: "true" })) as SearchResponse;
  if (!data?.totalHits) data = (await fdcGet("/foods/search", params)) as SearchResponse;
  const foods = rankBranded(q, (data?.foods ?? []).filter((f) => Number.isInteger(f.fdcId)));
  return { foods, totalHits: data?.totalHits ?? 0 };
}

function batchFor(page: number) {
  const first = (page - 1) * PAGE;
  return { batch: Math.floor(first / BATCH) + 1, offset: first % BATCH };
}

// One page of packaged foods, best matches first.
export async function searchBranded(query: string, page = 1): Promise<BrandedPage> {
  const q = query.trim();
  if (q.length < 3 || !fdcConfigured()) return { foods: [], page, totalPages: 0 };
  const { batch, offset } = batchFor(page);
  const { foods, totalHits } = await searchBatch(q, batch);
  return {
    foods: foods
      .slice(offset, offset + PAGE)
      .map(parseBranded)
      .filter((f) => f.kcal !== null), // no energy, no scoring
    page,
    totalPages: Math.ceil(totalHits / PAGE),
  };
}

// Where a product was found, so it can be found again if its details
// record is unusable.
export type SearchHint = { query?: string; page?: number };

// A product by FDC id. Some detail records are missing (a product still in
// the search index) or list amounts without saying which nutrient they are
// (seen on fdcId 2278100), so when the details give no calories, the
// product's search-result entry is used instead: first from the search the
// user came from, then by its barcode or name.
export async function getBranded(fdcId: number, hint: SearchHint = {}): Promise<BrandedFood | null> {
  if (!Number.isInteger(fdcId) || fdcId <= 0 || !fdcConfigured()) return null;
  const raw = (await fdcGet(`/food/${fdcId}`, {})) as FdcFoodRaw | null;
  if (raw?.dataType && raw.dataType !== "Branded") return null;
  if (raw) {
    const food = parseBranded({ ...raw, fdcId });
    if (food.kcal !== null) return food;
  }

  const lookups: [string, number][] = [];
  const q = hint.query?.trim();
  if (q && q.length >= 3) lookups.push([q, batchFor(hint.page ?? 1).batch]);
  if (raw?.gtinUpc) lookups.push([raw.gtinUpc, 1]);
  if (raw?.description) lookups.push([raw.description, 1]);
  for (const [query, batch] of lookups) {
    const hit = (await searchBatch(query, batch)).foods.find((f) => f.fdcId === fdcId);
    if (!hit) continue;
    // The details record's fields, the search entry's nutrients.
    const food = parseBranded({ ...raw, ...hit, fdcId });
    if (food.kcal !== null) return food;
  }
  return null;
}
