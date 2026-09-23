import Link from "next/link";
import { notFound } from "next/navigation";
import { logFood } from "@/app/actions/food";
import { getFood, todaysLog, userTimezone } from "@/lib/food";
import { isMeal, localNow, mealForHour } from "@/lib/meals";
import { AmountForm } from "./AmountForm";
import styles from "./food.module.css";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SOURCE_NOTE: Record<string, string> = {
  custom: "Your food",
  usda_foundation: "USDA Foundation Foods · full micronutrient profile",
  usda_sr_legacy: "USDA SR Legacy · full micronutrient profile",
  usda_survey: "USDA survey dish (FNDDS)",
  usda_branded: "Packaged food · USDA Branded",
};

export default async function FoodPage({ params, searchParams }: Props) {
  const [{ id }, sp, tz] = await Promise.all([params, searchParams, userTimezone()]);
  const foodId = Number(id);
  if (!Number.isInteger(foodId)) notFound();
  const found = await getFood(foodId);
  if (!found) notFound();
  const { food, portions } = found;
  const meal = isMeal(sp.meal) ? sp.meal : mealForHour(localNow(tz).hour);
  const today = await todaysLog(tz);
  const firstInSlot = !today.some((i) => i.meal === meal);

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <Link href={`/log?meal=${meal}`} aria-label="Back to search" className={styles.back}>
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
            {food.brand ? `${food.brand} · ` : ""}
            {SOURCE_NOTE[food.source] ?? ""}
          </p>
        </div>
        <AmountForm
          action={logFood}
          ids={{ food_id: food.id }}
          per100={food}
          portions={portions}
          meal={meal}
          firstInSlot={firstInSlot}
        />
      </div>
    </main>
  );
}
