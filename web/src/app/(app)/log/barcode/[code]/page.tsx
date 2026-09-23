import Link from "next/link";
import { redirect } from "next/navigation";
import { logOffFood } from "@/app/actions/food";
import { todaysLog, userTimezone } from "@/lib/food";
import { isMeal, localNow, mealForHour } from "@/lib/meals";
import { fetchOff, savedFoodByBarcode } from "@/lib/off";
import { barcodeVariants } from "@/lib/offParse";
import { AmountForm } from "../../food/[id]/AmountForm";
import styles from "../../food/[id]/food.module.css";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = { title: "Scanned product · Statblock" };

// A scanned (or typed) barcode. A food already saved with that barcode opens
// its own page; otherwise the product comes from Open Food Facts and is
// saved into foods when it's logged.
export default async function BarcodePage({ params, searchParams }: Props) {
  const [{ code }, sp, tz] = await Promise.all([params, searchParams, userTimezone()]);
  const meal = isMeal(sp.meal) ? sp.meal : mealForHour(localNow(tz).hour);
  const valid = barcodeVariants(code).length > 0;

  const saved = valid ? await savedFoodByBarcode(code) : null;
  if (saved) redirect(`/log/food/${saved}?meal=${meal}`);

  const found = valid ? await fetchOff(code) : "not_found";
  const today = typeof found === "string" ? [] : await todaysLog(tz);

  const back = (
    <header className={styles.topbar}>
      <Link href={`/log/scan?meal=${meal}`} aria-label="Scan again" className={styles.back}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </Link>
      <span className={styles.crumb}>Barcode {code}</span>
    </header>
  );

  if (typeof found === "string") {
    const message = {
      not_found: "Open Food Facts doesn't have this barcode yet.",
      no_nutrition: "Open Food Facts has this product, but not its calories, so it can't be scored.",
      unreachable: "Open Food Facts didn't answer. Try again in a moment.",
    }[found];
    return (
      <main className={styles.main}>
        {back}
        <div className={styles.card}>
          <p role="alert" style={{ margin: 0, fontWeight: 600 }}>
            {message}
          </p>
          <p className={styles.source}>
            Try searching by name instead. USDA&apos;s packaged foods cover most US products.
          </p>
          <Link href={`/log?meal=${meal}`}>Search by name</Link>
          <Link href={`/log/scan?meal=${meal}`}>Scan again</Link>
        </div>
      </main>
    );
  }

  const { food } = found;
  return (
    <main className={styles.main}>
      {back}
      <div className={styles.card}>
        <div className={styles.foodHead}>
          <h1 className={styles.name}>{food.name}</h1>
          <p className={styles.source}>
            {food.brand ? `${food.brand} · ` : ""}Packaged food · from{" "}
            <a href={`https://world.openfoodfacts.org/product/${food.barcode}`} target="_blank" rel="noreferrer">
              Open Food Facts
            </a>{" "}
            (ODbL)
          </p>
        </div>
        <AmountForm
          action={logOffFood}
          ids={{ barcode: food.barcode }}
          per100={{ kcal_100g: food.kcal, protein_100g: food.protein, carbs_100g: food.carbs, fat_100g: food.fat }}
          portions={food.serving ? [food.serving] : []}
          meal={meal}
          firstInSlot={!today.some((i) => i.meal === meal)}
        />
      </div>
    </main>
  );
}
