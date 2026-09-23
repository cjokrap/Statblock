import Link from "next/link";
import { userTimezone } from "@/lib/food";
import { isMeal, localNow, MEAL_LABEL, mealForHour } from "@/lib/meals";
import styles from "../log.module.css";
import { Scanner } from "./Scanner";

export const metadata = { title: "Scan a barcode · Statblock" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ScanPage({ searchParams }: Props) {
  const sp = await searchParams;
  const meal = isMeal(sp.meal) ? sp.meal : mealForHour(localNow(await userTimezone()).hour);
  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <Link href={`/log?meal=${meal}`} aria-label="Back to search" className={styles.back}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1 className={styles.title}>Scan for {MEAL_LABEL[meal]}</h1>
      </header>
      <Scanner meal={meal} />
      <p className={styles.hint}>
        Product data from{" "}
        <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">
          Open Food Facts
        </a>{" "}
        (ODbL), unless the product is already in your foods.
      </p>
    </main>
  );
}
