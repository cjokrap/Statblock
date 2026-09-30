import { notFound } from "next/navigation";
import { addBrandedIngredient } from "@/app/actions/recipes";
import { getBranded } from "@/lib/fdc";
import { getRecipe } from "@/lib/recipes";
import { AmountForm } from "../../../../../log/food/[id]/AmountForm";
import styles from "../../../../../log/food/[id]/food.module.css";
import { BackLink } from "../../../../BackLink";

type Props = {
  params: Promise<{ id: string; fdcId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// A USDA packaged food as an ingredient; saved to foods when it's added.
export default async function BrandedIngredientPage({ params, searchParams }: Props) {
  const [{ id, fdcId }, sp] = await Promise.all([params, searchParams]);
  const q = typeof sp.q === "string" ? sp.q : "";
  const bp = typeof sp.bp === "string" ? Number.parseInt(sp.bp, 10) || 1 : 1;
  const [recipe, food] = await Promise.all([getRecipe(Number(id)), getBranded(Number(fdcId), { query: q, page: bp })]);
  if (!recipe || !food) notFound();

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <BackLink
          href={`/recipes/${recipe.id}/add?q=${encodeURIComponent(q)}${bp > 1 ? `&bp=${bp}` : ""}`}
          label="Back to search"
        />
        <span className={styles.crumb}>Add to {recipe.name}</span>
      </header>
      <div className={styles.card}>
        <div className={styles.foodHead}>
          <h1 className={styles.name}>{food.name}</h1>
          <p className={styles.source}>
            {food.brand ? `${food.brand} · ` : ""}Packaged food · USDA Branded (label data)
          </p>
        </div>
        <AmountForm
          action={addBrandedIngredient}
          ids={{ recipe_id: recipe.id, fdc_id: food.fdcId, q, bp }}
          per100={{ kcal_100g: food.kcal, protein_100g: food.protein, carbs_100g: food.carbs, fat_100g: food.fat }}
          portions={food.serving ? [food.serving] : []}
          meal="snack"
          firstInSlot={false}
          submitLabel="Add to recipe"
        />
      </div>
    </main>
  );
}
