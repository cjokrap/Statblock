import { AbilityScores } from "@/components/AbilityScores";
import { CharacterSheet } from "@/components/CharacterSheet";
import { FoodLog } from "@/components/FoodLog";
import { TrackList } from "@/components/TrackList";
import { loadCharacter } from "@/lib/character";
import Link from "next/link";
import { recentFoods, todaysLog } from "@/lib/food";
import { hasTargets } from "@/lib/settings";
import { localNow, mealForHour } from "@/lib/meals";
import { signOut } from "../login/actions";
import styles from "./shell.module.css";

export default async function TodayPage() {
  const c = await loadCharacter();
  const [items, recents, targets] = await Promise.all([todaysLog(c.timezone), recentFoods(), hasTargets()]);
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: c.timezone,
  }).format(new Date());

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <p className={styles.date}>{today}</p>
        <div className={styles.topActions}>
          <Link href="/settings" className={styles.linkButton}>
            Settings
          </Link>
          <form action={signOut}>
            <button type="submit" className={styles.linkButton}>
              Sign out
            </button>
          </form>
        </div>
      </header>
      {!targets && (
        <Link href="/setup" className={styles.setupBanner}>
          <span className={styles.setupTitle}>Set your targets</span>
          <span>Calories, macros, water and training days. Saving them starts the game judging your days.</span>
        </Link>
      )}
      <CharacterSheet c={c} />
      <FoodLog items={items} recents={recents} suggestedMeal={mealForHour(localNow(c.timezone).hour)} />
      <AbilityScores c={c} />
      <div className={styles.tracks}>
        <TrackList title="Classes" rows={c.classes} />
        <TrackList title="Jobs" rows={c.jobs} />
      </div>
    </main>
  );
}
