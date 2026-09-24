import Link from "next/link";
import { fdcConfigured, searchBranded } from "@/lib/fdc";
import { logFood } from "@/app/actions/food";
import { SubmitButton } from "@/components/SubmitButton";
import { recentWeek, searchFoods, userTimezone } from "@/lib/food";
import { forGrams, isMeal, localNow, MEAL_LABEL, MEALS, mealForHour } from "@/lib/meals";
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
  const tab = sp.tab === "recent" ? "recent" : "search";
  const added = typeof sp.added === "string" ? sp.added : null;
  if (tab === "recent") return <Recent meal={meal} tz={tz} added={added} />;
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

      <Tabs meal={meal} tab="search" />

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
          autoFocus={!q}
          autoComplete="off"
          className={styles.input}
        />
        <button type="submit" className={styles.go}>
          Search
        </button>
      </form>

      <Link href={`/log/scan?meal=${meal}`} className={styles.scanLink}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" aria-hidden="true">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          <line x1="7" y1="8" x2="7" y2="16" /><line x1="10" y1="8" x2="10" y2="16" />
          <line x1="13" y1="8" x2="13" y2="16" /><line x1="17" y1="8" x2="17" y2="16" />
        </svg>
        Scan a barcode
      </Link>

      {q && results.length === 0 && packaged?.length === 0 && (
        <p className={styles.empty}>
          No foods match &ldquo;{q}&rdquo;. Try fewer words, or a plainer name (&ldquo;beef&rdquo; rather than
          a brand).
        </p>
      )}
      {results.length > 0 && (
        <>
          <p className={styles.hint}>Whole foods first</p>
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
                  <span className={styles.badge}>{SOURCE_BADGE[f.source] ?? "Food"}</span>
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

function Tabs({ meal, tab }: { meal: string; tab: "search" | "recent" }) {
  return (
    <nav aria-label="Find food" className={styles.tabs}>
      <Link href={`/log?meal=${meal}`} aria-current={tab === "search" ? "page" : undefined}
        className={tab === "search" ? styles.tabOn : styles.tab}>
        Search
      </Link>
      <Link href={`/log?meal=${meal}&tab=recent`} aria-current={tab === "recent" ? "page" : undefined}
        className={tab === "recent" ? styles.tabOn : styles.tab}>
        Recent · 7 days
      </Link>
    </nav>
  );
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

// Everything logged in the last 7 days, one tap to add to the chosen meal.
async function Recent({ meal, tz, added }: { meal: (typeof MEALS)[number]; tz: string; added: string | null }) {
  const items = await recentWeek(tz);
  const today = localNow(tz).date;
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
          <Link key={m} href={`/log?meal=${m}&tab=recent`} aria-current={m === meal ? "true" : undefined}
            className={m === meal ? styles.mealOn : styles.meal}>
            {MEAL_LABEL[m]}
          </Link>
        ))}
      </nav>
      <Tabs meal={meal} tab="recent" />
      {added && (
        <p role="status" className={styles.added}>
          Added {added} to {MEAL_LABEL[meal].toLowerCase()}.{" "}
          <Link href="/">Done</Link>
        </p>
      )}
      {items.length === 0 ? (
        <p className={styles.empty}>Nothing logged in the last 7 days yet. Search or scan to log something.</p>
      ) : (
        <ul className={styles.results}>
          {items.map((it) => {
            const amount = it.portionLabel ?? `${Math.round(it.grams)} g`;
            const kcal = Math.round(forGrams(it.food, it.grams).kcal);
            const when = it.localDate === today ? "Today" : it.localDate ? DAY.format(new Date(it.localDate + "T12:00:00Z")) : "";
            const short = it.food.name.split(",")[0];
            return (
              <li key={`${it.food.id}:${it.grams}:${it.portionLabel ?? ""}`} className={styles.recentRow}>
                <Link href={`/log/food/${it.food.id}?meal=${meal}`} className={styles.recentText}
                  aria-label={`${it.food.name}, ${amount}: choose a different amount`}>
                  <span className={styles.resultName}>{it.food.name}</span>
                  <span className={styles.resultMeta}>
                    {amount} · {kcal} kcal · last {when}
                    {it.times > 1 ? ` · ${it.times}× this week` : ""}
                  </span>
                </Link>
                <form action={logFood}>
                  <input type="hidden" name="food_id" value={it.food.id} />
                  <input type="hidden" name="grams" value={it.grams} />
                  <input type="hidden" name="meal" value={meal} />
                  <input type="hidden" name="portion_label" value={it.portionLabel ?? ""} />
                  <input type="hidden" name="back"
                    value={`/log?meal=${meal}&tab=recent&added=${encodeURIComponent(`${short}, ${amount}`)}`} />
                  <SubmitButton className={styles.addButton} aria-label={`Add ${it.food.name}, ${amount}`} pendingText="…">
                    + Add
                  </SubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
