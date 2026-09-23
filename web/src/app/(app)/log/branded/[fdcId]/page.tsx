import Link from "next/link";
import { notFound } from "next/navigation";
import { logBrandedFood } from "@/app/actions/food";
import { todaysLog, userTimezone } from "@/lib/food";
import { getBranded } from "@/lib/fdc";
import { isMeal, localNow, mealForHour } from "@/lib/meals";
import { AmountForm } from "../../food/[id]/AmountForm";
import styles from "../../food/[id]/food.module.css";

type Props = {
  params: Promise<{ fdcId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// A USDA packaged food straight from FoodData Central. It's saved to the
// foods table only when it's logged.
export default async function BrandedFoodPage({ params, searchParams }: Props) {
  const [{ fdcId }, sp, tz] = await Promise.all([params, searchParams, userTimezone()]);
  const q = typeof sp.q === "string" ? sp.q : "";
  const bp = typeof sp.bp === "string" ? Number.parseInt(sp.bp, 10) || 1 : 1;
  const food = await getBranded(Number(fdcId), { query: q, page: bp });
  if (!food) notFound();
  const meal = isMeal(sp.meal) ? sp.meal : mealForHour(localNow(tz).hour);
  const today = await todaysLog(tz);
  const back = q ? `/log?meal=${meal}&q=${encodeURIComponent(q)}${bp > 1 ? `&bp=${bp}` : ""}` : `/log?meal=${meal}`;

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <Link href={back} aria-label="Back to search" className={styles.back}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <span className={styles.crumb}>Add food</span>
      </header>
      <div className={styles.card}>
        <div className={styles.foodHead}>
          <h1 className={styles.name}>{food.name}</h1>
          <p className={styles.source}>
            {food.brand ? `${food.brand} · ` : ""}Packaged food · USDA Branded (label data)
          </p>
        </div>
        <AmountForm
          action={logBrandedFood}
          ids={{ fdc_id: food.fdcId, q, bp }}
          per100={{
            kcal_100g: food.kcal,
            protein_100g: food.protein,
            carbs_100g: food.carbs,
            fat_100g: food.fat,
          }}
          portions={food.serving ? [food.serving] : []}
          meal={meal}
          firstInSlot={!today.some((i) => i.meal === meal)}
        />
      </div>
    </main>
  );
}
