import Link from "next/link";
import { createRecipe } from "@/app/actions/recipes";
import { SubmitButton } from "@/components/SubmitButton";
import { listRecipes } from "@/lib/recipes";
import { BackLink } from "./BackLink";
import styles from "./recipes.module.css";

export const metadata = { title: "Recipes · Statblock" };

export default async function RecipesPage() {
  const recipes = await listRecipes();
  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <BackLink href="/log" label="Back to add food" />
        <h1 className={styles.title}>Recipes</h1>
      </header>

      <form action={createRecipe} className={styles.card}>
        <label className={styles.field}>
          New recipe
          <input name="name" required maxLength={120} placeholder="e.g. High protein pasta" className={styles.input}
            autoComplete="off" />
        </label>
        <SubmitButton className={styles.primary} pendingText="Creating…">
          Create and add ingredients
        </SubmitButton>
      </form>

      {recipes.length === 0 ? (
        <p className={styles.empty}>
          No recipes yet. Add the ingredients, weigh the finished dish, then log servings by weight. Recipes show up
          first when you search for them.
        </p>
      ) : (
        <ul className={`${styles.list} ${styles.card}`} style={{ padding: 0, gap: 0 }}>
          {recipes.map((r) => (
            <li key={r.id}>
              <Link href={`/recipes/${r.id}`} className={styles.recipeLink}>
                <span className={styles.ingredientName}>{r.name}</span>
                <span className={styles.ingredientMeta}>
                  {r.ingredients} ingredient{r.ingredients === 1 ? "" : "s"}
                  {r.kcal100 !== null && r.ingredients > 0 ? ` · ${Math.round(r.kcal100)} kcal per 100 g` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
