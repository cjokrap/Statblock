import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteRecipe, removeIngredient, updateIngredient, updateRecipe } from "@/app/actions/recipes";
import { SubmitButton } from "@/components/SubmitButton";
import { forGrams } from "@/lib/meals";
import { getRecipe } from "@/lib/recipes";
import { BackLink } from "../BackLink";
import styles from "../recipes.module.css";

export const metadata = { title: "Recipe · Statblock" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const r0 = (n: number) => Math.round(n).toLocaleString("en-US");

export default async function RecipePage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId)) notFound();
  const recipe = await getRecipe(recipeId);
  if (!recipe) notFound();
  const { totals, totalGrams, ingredients } = recipe;
  const per = (grams: number) => {
    const f = totalGrams > 0 ? grams / totalGrams : 0;
    return { kcal: totals.kcal * f, protein: totals.protein * f, carbs: totals.carbs * f, fat: totals.fat * f, fiber: totals.fiber * f };
  };
  const rows: [string, ReturnType<typeof per>][] = [
    [`Whole · ${r0(totalGrams)} g`, totals],
    ["Per 100 g", per(100)],
  ];
  if (recipe.servings) rows.push([`Serving · ${r0(totalGrams / recipe.servings)} g`, per(totalGrams / recipe.servings)]);

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <BackLink href="/recipes" label="Back to recipes" />
        <h1 className={styles.title}>{recipe.name}</h1>
      </header>
      {sp.saved === "1" && (
        <p role="status" className={styles.saved}>
          Saved.
        </p>
      )}

      <section aria-labelledby="totals-heading" className={styles.card}>
        <h2 id="totals-heading" className={styles.cardTitle}>
          Totals
        </h2>
        {ingredients.length === 0 ? (
          <p className={styles.empty}>Add ingredients to see the totals.</p>
        ) : (
          <>
            <div className={styles.totals} role="table" aria-label="Recipe totals">
              <div role="row" style={{ display: "contents" }}>
                <span role="columnheader" className={`${styles.label} ${styles.head}`}>Amount</span>
                <span role="columnheader" className={styles.head}>kcal</span>
                <span role="columnheader" className={styles.head}>Protein</span>
                <span role="columnheader" className={styles.head}>Carbs</span>
                <span role="columnheader" className={styles.head}>Fat</span>
                <span role="columnheader" className={styles.head}>Fiber</span>
              </div>
              {rows.map(([label, n]) => (
                <div role="row" key={label} style={{ display: "contents" }}>
                  <span role="rowheader" className={styles.label}>{label}</span>
                  <span role="cell">{r0(n.kcal)}</span>
                  <span role="cell">{r0(n.protein)} g</span>
                  <span role="cell">{r0(n.carbs)} g</span>
                  <span role="cell">{r0(n.fat)} g</span>
                  <span role="cell">{r0(n.fiber)} g</span>
                </div>
              ))}
            </div>
            {recipe.food && (
              <Link href={`/log/food/${recipe.food.id}`} className={styles.primary}>
                Log a serving
              </Link>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="ingredients-heading" className={styles.card}>
        <h2 id="ingredients-heading" className={styles.cardTitle}>
          Ingredients · {r0(recipe.rawGrams)} g
        </h2>
        {ingredients.length > 0 && (
          <ul className={styles.list}>
            {ingredients.map((i) => (
              <li key={i.id} className={styles.ingredient}>
                <span className={styles.ingredientName}>{i.food.name}</span>
                <span className={styles.ingredientMeta}>
                  {i.portionLabel ? `${i.portionLabel} · ` : ""}
                  {r0(forGrams(i.food, i.grams).kcal)} kcal · {r0(forGrams(i.food, i.grams).protein)} g protein
                </span>
                <div className={styles.ingredientEdit}>
                  <form action={updateIngredient} className={styles.ingredientEdit}>
                    <input type="hidden" name="recipe_id" value={recipe.id} />
                    <input type="hidden" name="ingredient_id" value={i.id} />
                    <label className="visually-hidden" htmlFor={`g-${i.id}`}>
                      Grams of {i.food.name}
                    </label>
                    <input id={`g-${i.id}`} name="grams" inputMode="decimal" defaultValue={i.grams} required
                      className={styles.grams} />
                    <span className={styles.ingredientMeta}>g</span>
                    <SubmitButton className={styles.small} pendingText="…">
                      Update
                    </SubmitButton>
                  </form>
                  <form action={removeIngredient} style={{ marginLeft: "auto" }}>
                    <input type="hidden" name="recipe_id" value={recipe.id} />
                    <input type="hidden" name="ingredient_id" value={i.id} />
                    <SubmitButton className={styles.removeSmall} aria-label={`Remove ${i.food.name}`} pendingText="…">
                      Remove
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/recipes/${recipe.id}/add`} className={styles.secondary}>
          + Add ingredient
        </Link>
      </section>

      <form action={updateRecipe} className={styles.card} aria-labelledby="details-heading">
        <h2 id="details-heading" className={styles.cardTitle}>
          Details
        </h2>
        <input type="hidden" name="recipe_id" value={recipe.id} />
        <label className={styles.field}>
          Name
          <input name="name" required maxLength={120} defaultValue={recipe.name} className={styles.input} />
        </label>
        <div className={styles.row}>
          <label className={styles.field}>
            Cooked weight (g)
            <input name="cooked_grams" inputMode="decimal" defaultValue={recipe.cookedGrams ?? ""}
              placeholder={r0(recipe.rawGrams)} className={styles.input} />
          </label>
          <label className={styles.field}>
            Servings
            <input name="servings" inputMode="decimal" defaultValue={recipe.servings ?? ""} placeholder="optional"
              className={styles.input} />
          </label>
        </div>
        <p className={styles.help}>
          Weigh the finished dish, without the pot, for the most accurate servings: cooking adds or loses water.
          Leave it empty to use the ingredients&apos; weight. Changes don&apos;t alter servings you&apos;ve already
          logged.
        </p>
        <SubmitButton className={styles.secondary} pendingText="Saving…">
          Save details
        </SubmitButton>
      </form>

      {sp.confirm === "delete" ? (
        <form action={deleteRecipe} className={styles.card}>
          <p className={styles.empty}>
            Delete {recipe.name}? It leaves search and favorites. Servings you&apos;ve already logged stay.
          </p>
          <input type="hidden" name="recipe_id" value={recipe.id} />
          <div className={styles.row}>
            <Link href={`/recipes/${recipe.id}`} className={styles.secondary} style={{ flex: 1 }}>
              Keep it
            </Link>
            <SubmitButton className={styles.danger} style={{ flex: 1 }} pendingText="Deleting…">
              Delete
            </SubmitButton>
          </div>
        </form>
      ) : (
        <Link href={`/recipes/${recipe.id}?confirm=delete`} className={styles.danger}>
          Delete recipe
        </Link>
      )}
    </main>
  );
}
