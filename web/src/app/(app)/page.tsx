import { AbilityScores } from "@/components/AbilityScores";
import { CharacterSheet } from "@/components/CharacterSheet";
import { TrackList } from "@/components/TrackList";
import { loadCharacter } from "@/lib/character";
import { signOut } from "../login/actions";
import styles from "./shell.module.css";

export default async function TodayPage() {
  const c = await loadCharacter();
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
        <form action={signOut}>
          <button type="submit" className={styles.linkButton}>
            Sign out
          </button>
        </form>
      </header>
      <CharacterSheet c={c} />
      <AbilityScores c={c} />
      <div className={styles.tracks}>
        <TrackList title="Classes" rows={c.classes} />
        <TrackList title="Jobs" rows={c.jobs} />
      </div>
    </main>
  );
}
