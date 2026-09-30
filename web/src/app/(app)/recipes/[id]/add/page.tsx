import Link from "next/link";
import { notFound } from "next/navigation";
import { fdcConfigured, searchBranded } from "@/lib/fdc";
import { recentWeek, searchFoods, userTimezone, type FoodRow } from "@/lib/food";
import { getRecipe } from "@/lib/recipes";
import { BackLink } from "../../BackLink";
import styles from "../../../log/log.module.css";

export const metadata = { title: "Add ingredient · Statblock" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Find an ingredient: your recent foods, then search (saved foods first,
// then USDA packaged foods). Recipes can't go inside recipes.
export default async function AddIngredientPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId)) notFound();
  const recipe = await getRecipe(recipeId);
  if (!recipe) notFound();
  const q = typeof sp.q === "string" ? sp.q : "";
  const bp = Math.max(1, Math.min(50, Number.parseInt(typeof sp.bp === "string" ? sp.bp : "1", 10) || 1));

  const [results, packagedPage, recent] = await Promise.all([
    q && bp === 1 ? searchFoods(q) : [],
    q ? searchBranded(q, bp).catch(() => null) : null,
    q ? [] : recentWeek(await userTimezone()),
  ]);
  const foods = (results as FoodRow[]).filter((f) => f.recipe_id === null);
  const saved = new Set(foods.filter((f) => f.source === "usda_branded").map((f) => f.source_id));
  const packaged = packagedPage?.foods.filter((f) => !saved.has(String(f.fdcId))) ?? null;
  const recentFoods = [...new Map(recent.filter((r) => r.food.recipe_id === null).map((r) => [r.food.id, r.food])).values()];
  const base = `/recipes/${recipe.id}/add`;
  const pageHref = (n: number) => `${base}?q=${encodeURIComponent(q)}${n > 1 ? `&bp=${n}` : ""}#packaged-heading`;
  const foodHref = (foodId: number) => `${base}/food/${foodId}${q ? `?q=${encodeURIComponent(q)}` : ""}`;

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <BackLink href={`/recipes/${recipe.id}`} label="Back to the recipe" />
        <h1 className={styles.title}>Add to {recipe.name}</h1>
      </header>

      <form action={base} method="get" role="search" className={styles.search}>
        <label htmlFor="ingredient-search" className="visually-hidden">
          Search ingredients
        </label>
        <input id="ingredient-search" name="q" type="search" defaultValue={q} placeholder="Search ingredients"
          autoComplete="off" className={styles.input} />
        <button type="submit" className={styles.go}>
          Search
        </button>
      </form>

      {!q && (
        <section aria-labelledby="recent-heading" className={styles.section}>
          <h2 id="recent-heading" className={styles.hint}>
            Recent · last 7 days
          </h2>
          {recentFoods.length === 0 ? (
            <p className={styles.empty}>Search for each ingredient by name.</p>
          ) : (
            <FoodList foods={recentFoods} href={foodHref} />
          )}
        </section>
      )}

      {q && foods.length === 0 && packaged?.length === 0 && (
        <p className={styles.empty}>No foods match &ldquo;{q}&rdquo;. Try fewer words.</p>
      )}
      {foods.length > 0 && <FoodList foods={foods} href={foodHref} />}
      {q && q.trim().length >= 3 && fdcConfigured() && (
        <section aria-labelledby="packaged-heading" className={styles.packaged}>
          <h2 id="packaged-heading" className={styles.hint}>
            Packaged foods · USDA{bp > 1 ? ` · page ${bp}` : ""}
          </h2>
          {packaged === null ? (
            <p className={styles.empty}>USDA&apos;s food database didn&apos;t answer. Try again in a moment.</p>
          ) : packaged.length === 0 ? (
            <p className={styles.empty}>No packaged foods match.</p>
          ) : (
            <ul className={styles.results}>
              {packaged.map((f) => (
                <li key={f.fdcId}>
                  <Link href={`${base}/branded/${f.fdcId}?q=${encodeURIComponent(q)}${bp > 1 ? `&bp=${bp}` : ""}`}
                    className={styles.result}>
                    <span className={styles.resultText}>
                      <span className={styles.resultName}>{f.name}</span>
                      <span className={styles.resultMeta}>
                        {f.brand ? `${f.brand} · ` : ""}
                        {Math.round(f.kcal ?? 0)} kcal · {Math.round(f.protein ?? 0)} g protein per 100 g
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

function FoodList({ foods, href }: { foods: FoodRow[]; href: (id: number) => string }) {
  return (
    <ul className={styles.results}>
      {foods.map((f) => (
        <li key={f.id}>
          <Link href={href(f.id)} className={styles.result}>
            <span className={styles.resultText}>
              <span className={styles.resultName}>{f.name}</span>
              <span className={styles.resultMeta}>
                {f.brand ? `${f.brand} · ` : ""}
                {Math.round(f.kcal_100g ?? 0)} kcal · {Math.round(f.protein_100g ?? 0)} g protein per 100 g
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
