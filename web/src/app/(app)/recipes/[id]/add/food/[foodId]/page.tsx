import { notFound } from "next/navigation";
import { addIngredient } from "@/app/actions/recipes";
import { getFood } from "@/lib/food";
import { getRecipe } from "@/lib/recipes";
import { AmountForm } from "../../../../../log/food/[id]/AmountForm";
import styles from "../../../../../log/food/[id]/food.module.css";
import { BackLink } from "../../../../BackLink";

type Props = {
  params: Promise<{ id: string; foodId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// How much of a saved food goes into the recipe.
export default async function IngredientAmountPage({ params, searchParams }: Props) {
  const [{ id, foodId }, sp] = await Promise.all([params, searchParams]);
  const [recipe, found] = await Promise.all([getRecipe(Number(id)), getFood(Number(foodId))]);
  if (!recipe || !found || found.food.recipe_id !== null) notFound();
  const q = typeof sp.q === "string" ? sp.q : "";
  const { food, portions } = found;

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <BackLink href={`/recipes/${recipe.id}/add${q ? `?q=${encodeURIComponent(q)}` : ""}`} label="Back to search" />
        <span className={styles.crumb}>Add to {recipe.name}</span>
      </header>
      <div className={styles.card}>
        <div className={styles.foodHead}>
          <h1 className={styles.name}>{food.name}</h1>
          {food.brand && <p className={styles.source}>{food.brand}</p>}
        </div>
        <AmountForm
          action={addIngredient}
          ids={{ recipe_id: recipe.id, food_id: food.id }}
          per100={food}
          portions={portions}
          meal="snack"
          firstInSlot={false}
          submitLabel="Add to recipe"
        />
      </div>
    </main>
  );
}
