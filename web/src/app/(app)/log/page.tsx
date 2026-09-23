import Link from "next/link";
import { searchFoods, userTimezone } from "@/lib/food";
import { isMeal, localNow, MEAL_LABEL, MEALS, mealForHour } from "@/lib/meals";
import styles from "./log.module.css";

export const metadata = { title: "Add food · Statblock" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SOURCE_BADGE: Record<string, string> = {
  custom: "Mine",
  usda_foundation: "USDA",
  usda_sr_legacy: "USDA",
  usda_survey: "Dish",
  usda_branded: "Brand",
};

export default async function LogPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const meal = isMeal(sp.meal) ? sp.meal : mealForHour(localNow(await userTimezone()).hour);
  const results = q ? await searchFoods(q) : [];

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
          autoFocus={!q}
          autoComplete="off"
          className={styles.input}
        />
        <button type="submit" className={styles.go}>
          Search
        </button>
      </form>

      {q && results.length === 0 && (
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
    </main>
  );
}
