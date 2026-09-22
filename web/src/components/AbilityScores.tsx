import { ABILITIES, type Character } from "@/lib/character";
import { modifier, trend } from "@/lib/game";
import styles from "./AbilityScores.module.css";

const NOTES: Record<string, string> = {
  str: "PRs and sessions",
  dex: "Not over the calorie window",
  con: "Not under the calorie window",
  int: "Micronutrients from food",
  wis: "Days fully logged",
  cha: "Self-care and weigh-ins",
};

export function AbilityScores({ c }: { c: Character }) {
  return (
    <section className={styles.section} aria-labelledby="scores-heading">
      <h2 id="scores-heading" className={styles.heading}>
        Ability scores
      </h2>
      <div className={styles.grid}>
        {ABILITIES.map((a) => {
          const score = c.scores?.[a] ?? 10;
          const t = c.scores ? trend(score, c.scoresWeekAgo[a]) : "Steady";
          const frozen = a === "str" && c.strFrozen;
          return (
            <div key={a} className={styles.card}>
              <span className={styles.abbr}>{a.toUpperCase()}</span>
              <span className={styles.score}>{score}</span>
              <span className={styles.mod}>{modifier(score)}</span>
              <span className={`${styles.trend} ${t === "Up" ? styles.up : t === "Down" ? styles.down : ""}`}>
                {frozen ? "Frozen" : t}
              </span>
              <span className={styles.note}>{NOTES[a]}</span>
            </div>
          );
        })}
      </div>
      {!c.scores && <p className={styles.empty}>Scores appear after your first logged day.</p>}
    </section>
  );
}
