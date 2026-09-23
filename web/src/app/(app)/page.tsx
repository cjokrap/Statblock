import { AbilityScores } from "@/components/AbilityScores";
import { CharacterSheet } from "@/components/CharacterSheet";
import { HitPoints, QuickLog, Quests, Stack, Training, Water } from "@/components/Dashboard";
import { FoodLog } from "@/components/FoodLog";
import { TrackList } from "@/components/TrackList";
import { loadCharacter } from "@/lib/character";
import Link from "next/link";
import { recentFoods, todaysLog } from "@/lib/food";
import { loadToday } from "@/lib/today";
import { forGrams, localNow, mealForHour } from "@/lib/meals";
import { signOut } from "../login/actions";
import styles from "./shell.module.css";

export default async function TodayPage() {
  const c = await loadCharacter();
  const [items, recents, t] = await Promise.all([todaysLog(c.timezone), recentFoods(), loadToday()]);
  const totals = items.reduce(
    (sum, it) => {
      const n = forGrams(it.food, it.grams);
      return {
        kcal: sum.kcal + n.kcal,
        protein: sum.protein + n.protein,
        carbs: sum.carbs + n.carbs,
        fat: sum.fat + n.fat,
        fiber: sum.fiber + n.fiber,
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );
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
      {!t.targets && (
        <Link href="/setup" className={styles.setupBanner}>
          <span className={styles.setupTitle}>Set your targets</span>
          <span>Calories, macros, water and training days. Saving them starts the game judging your days.</span>
        </Link>
      )}
      <CharacterSheet c={c} />
      <AbilityScores c={c} />
      {t.targets && <HitPoints totals={totals} targets={t.targets} stackFiber={t.stack.fiberG} />}
      {t.targets && <Quests today={t} />}
      <FoodLog items={items} recents={recents} suggestedMeal={mealForHour(localNow(c.timezone).hour)} />
      <Stack today={t} />
      <Water today={t} />
      <Training today={t} />
      <QuickLog today={t} />
      <div className={styles.tracks}>
        <TrackList title="Classes" rows={c.classes} />
        <TrackList title="Jobs" rows={c.jobs} />
      </div>
    </main>
  );
}
