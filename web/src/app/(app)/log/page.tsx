import Link from "next/link";
import { fdcConfigured, searchBranded } from "@/lib/fdc";
import { logFood, removeFavorite, saveFavorite } from "@/app/actions/food";
import { SubmitButton } from "@/components/SubmitButton";
import { favorites, recentWeek, searchFoods, userTimezone, type FoodRow } from "@/lib/food";
import { forGrams, isMeal, localNow, MEAL_LABEL, MEALS, mealForHour, type Meal } from "@/lib/meals";
import styles from "./log.module.css";

export const metadata = { title: "Add food · Statblock" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SOURCE_BADGE: Record<string, string> = {
  custom: "Mine",
  usda_foundation: "USDA",
  usda_sr_legacy: "USDA",
  usda_survey: "Dish",
  usda_branded: "Brand",
  off: "Brand",
};

export default async function LogPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const bp = Math.max(1, Math.min(50, Number.parseInt(typeof sp.bp === "string" ? sp.bp : "1", 10) || 1));
  const tz = await userTimezone();
  const meal = isMeal(sp.meal) ? sp.meal : mealForHour(localNow(tz).hour);
  const added = typeof sp.added === "string" ? sp.added : null;
  const [results, packagedPage] = await Promise.all([
    // Later pages of packaged foods skip the local results above them.
    q && bp === 1 ? searchFoods(q) : [],
    // A USDA outage shouldn't break the rest of search.
    q ? searchBranded(q, bp).catch(() => null) : null,
  ]);
  const packagedAll = packagedPage?.foods ?? null;
  const pageHref = (n: number) => `/log?meal=${meal}&q=${encodeURIComponent(q)}${n > 1 ? `&bp=${n}` : ""}#packaged-heading`;
  // Packaged foods already saved show up in the main results.
  const saved = new Set(results.filter((f) => f.source === "usda_branded").map((f) => f.source_id));
  const packaged = packagedAll?.filter((f) => !saved.has(String(f.fdcId))) ?? null;

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <Link href="/" aria-label="Back to today" className={styles.back}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1 className={styles.title}>Add to {MEAL_LABEL[meal]}</h1>
      </header>

      <nav aria-label="Meal" className={styles.meals}>
        {MEALS.map((m) => (
          <Link
            key={m}
            href={`/log?meal=${m}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-current={m === meal ? "true" : undefined}
            className={m === meal ? styles.mealOn : styles.meal}
          >
            {MEAL_LABEL[m]}
          </Link>
        ))}
      </nav>

      <form action="/log" method="get" role="search" className={styles.search}>
        <input type="hidden" name="meal" value={meal} />
        <label htmlFor="food-search" className="visually-hidden">
          Search foods
        </label>
        <input
          id="food-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search foods, e.g. ground beef"
          autoComplete="off"
          className={styles.input}
        />
        <button type="submit" className={styles.go}>
          Search
        </button>
      </form>

      <div className={styles.tools}>
        <Link href={`/log/scan?meal=${meal}`} className={styles.scanLink}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" aria-hidden="true">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="7" y1="8" x2="7" y2="16" /><line x1="10" y1="8" x2="10" y2="16" />
            <line x1="13" y1="8" x2="13" y2="16" /><line x1="17" y1="8" x2="17" y2="16" />
          </svg>
          Scan a barcode
        </Link>
        <Link href="/recipes" className={styles.scanLink}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
            <path d="M4 19.5V21h16" />
          </svg>
          Recipes
        </Link>
      </div>

      {!q && <MyFoods meal={meal} tz={tz} added={added} />}
      {q && (
        <Link href={`/log?meal=${meal}`} className={styles.clear}>
          ← Favorites and recent foods
        </Link>
      )}

      {q && results.length === 0 && packaged?.length === 0 && (
        <p className={styles.empty}>
          No foods match &ldquo;{q}&rdquo;. Try fewer words, or a plainer name (&ldquo;beef&rdquo; rather than
          a brand).
        </p>
      )}
      {results.length > 0 && (
        <>
          <p className={styles.hint}>Your foods and whole foods first</p>
          <ul className={styles.results}>
            {results.map((f) => (
              <li key={f.id}>
                <Link href={`/log/food/${f.id}?meal=${meal}`} className={styles.result}>
                  <span className={styles.resultText}>
                    <span className={styles.resultName}>{f.name}</span>
                    <span className={styles.resultMeta}>
                      {f.brand ? `${f.brand} · ` : ""}
                      {Math.round(f.kcal_100g ?? 0)} kcal · {Math.round(f.protein_100g ?? 0)} g protein per 100 g
                    </span>
                  </span>
                  <span className={styles.badge}>{f.recipe_id ? "Recipe" : (SOURCE_BADGE[f.source] ?? "Food")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {q && q.trim().length >= 3 && (
        <section aria-labelledby="packaged-heading" className={styles.packaged}>
          <h2 id="packaged-heading" className={styles.hint}>
            Packaged foods · USDA{bp > 1 ? ` · page ${bp}` : ""}
          </h2>
          {!fdcConfigured() ? (
            <p className={styles.empty}>
              Packaged food search isn&apos;t set up yet. It needs FDC_API_KEY and SUPABASE_SECRET_KEY in the
              Vercel settings.
            </p>
          ) : packaged === null ? (
            <p className={styles.empty}>USDA&apos;s food database didn&apos;t answer. Try again in a moment.</p>
          ) : packaged.length === 0 ? (
            <p className={styles.empty}>No packaged foods match.</p>
          ) : (
            <ul className={styles.results}>
              {packaged.map((f) => (
                <li key={f.fdcId}>
                  <Link
                    href={`/log/branded/${f.fdcId}?meal=${meal}&q=${encodeURIComponent(q)}${bp > 1 ? `&bp=${bp}` : ""}`}
                    className={styles.result}
                  >
                    <span className={styles.resultText}>
                      <span className={styles.resultName}>{f.name}</span>
                      <span className={styles.resultMeta}>
                        {f.brand ? `${f.brand} · ` : ""}
                        {Math.round(f.kcal ?? 0)} kcal · {Math.round(f.protein ?? 0)} g protein per 100 g
                        {f.serving ? ` · ${f.serving.label}` : ""}
                      </span>
                    </span>
                    <span className={styles.badge}>Brand</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {packagedPage && (bp > 1 || packagedPage.totalPages > bp) && (
            <nav aria-label="Packaged food pages" className={styles.pager}>
              {bp > 1 ? <Link href={pageHref(bp - 1)}>Previous</Link> : <span />}
              {packagedPage.totalPages > bp && <Link href={pageHref(bp + 1)}>More packaged foods</Link>}
            </nav>
          )}
        </section>
      )}
    </main>
  );
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

type Row = { food: FoodRow; grams: number; portionLabel: string | null };

// Favorites, then everything logged in the last 7 days: one tap to add to
// the chosen meal, and the page comes back here to add more.
async function MyFoods({ meal, tz, added }: { meal: Meal; tz: string; added: string | null }) {
  const [favs, recent] = await Promise.all([favorites(), recentWeek(tz)]);
  const favIds = new Set(favs.map((f) => f.food.id));
  const today = localNow(tz).date;
  return (
    <>
      {added && (
        <p role="status" className={styles.added}>
          Added {added} to {MEAL_LABEL[meal].toLowerCase()}. <Link href="/">Done</Link>
        </p>
      )}
      <section aria-labelledby="favorites-heading" className={styles.section}>
        <h2 id="favorites-heading" className={styles.hint}>
          Favorites
        </h2>
        {favs.length === 0 ? (
          <p className={styles.empty}>
            Tap ☆ on a recent food, or &ldquo;Save as a favorite&rdquo; on any food, to keep it here with its
            amount.
          </p>
        ) : (
          <ul className={styles.results}>
            {favs.map((f) => (
              <FoodRowItem key={f.food.id} row={f} meal={meal} favorite detail={null} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="recent-heading" className={styles.section}>
        <h2 id="recent-heading" className={styles.hint}>
          Recent · last 7 days
        </h2>
        {recent.length === 0 ? (
          <p className={styles.empty}>Nothing logged in the last 7 days yet. Search or scan to log something.</p>
        ) : (
          <ul className={styles.results}>
            {recent.map((it) => {
              const when =
                it.localDate === today ? "today" : it.localDate ? DAY.format(new Date(it.localDate + "T12:00:00Z")) : "";
              return (
                <FoodRowItem
                  key={`${it.food.id}:${it.grams}:${it.portionLabel ?? ""}`}
                  row={it}
                  meal={meal}
                  favorite={favIds.has(it.food.id)}
                  detail={`last ${when}${it.times > 1 ? ` · ${it.times}× this week` : ""}`}
                />
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function FoodRowItem({ row, meal, favorite, detail }: { row: Row; meal: Meal; favorite: boolean; detail: string | null }) {
  const amount = row.portionLabel ?? `${Math.round(row.grams)} g`;
  const kcal = Math.round(forGrams(row.food, row.grams).kcal);
  const short = row.food.name.split(",")[0];
  const here = `/log?meal=${meal}`;
  return (
    <li className={styles.recentRow}>
      <Link href={`/log/food/${row.food.id}?meal=${meal}`} className={styles.recentText}
        aria-label={`${row.food.name}, ${amount}: choose a different amount`}>
        <span className={styles.resultName}>{row.food.name}</span>
        <span className={styles.resultMeta}>
          {amount} · {kcal} kcal{detail ? ` · ${detail}` : ""}
        </span>
      </Link>
      <form action={favorite ? removeFavorite : saveFavorite}>
        <input type="hidden" name="food_id" value={row.food.id} />
        <input type="hidden" name="grams" value={row.grams} />
        <input type="hidden" name="portion_label" value={row.portionLabel ?? ""} />
        <input type="hidden" name="back" value={here} />
        <button type="submit" className={styles.star} aria-pressed={favorite}
          aria-label={favorite ? `Remove ${row.food.name} from favorites` : `Save ${row.food.name}, ${amount}, as a favorite`}>
          {favorite ? "★" : "☆"}
        </button>
      </form>
      <form action={logFood}>
        <input type="hidden" name="food_id" value={row.food.id} />
        <input type="hidden" name="grams" value={row.grams} />
        <input type="hidden" name="meal" value={meal} />
        <input type="hidden" name="portion_label" value={row.portionLabel ?? ""} />
        <input type="hidden" name="back" value={`${here}&added=${encodeURIComponent(`${short}, ${amount}`)}`} />
        <SubmitButton className={styles.addButton} aria-label={`Add ${row.food.name}, ${amount}`} pendingText="…">
          + Add
        </SubmitButton>
      </form>
    </li>
  );
}
