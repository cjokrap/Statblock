import type { Character } from "@/lib/character";
import { formatNumber } from "@/lib/game";
import styles from "./CharacterSheet.module.css";

export function CharacterSheet({ c }: { c: Character }) {
  const { overall } = c;
  return (
    <section className={styles.sheet} aria-label="Character">
      <div className={styles.identity}>
        <div className={styles.crest} aria-hidden="true">
          {c.name.charAt(0).toUpperCase()}
        </div>
        <div className={styles.who}>
          <h1 className={styles.name}>{c.name}</h1>
          <p className={styles.line}>
            Level {overall.level}
            {c.headline && ` · ${c.headline}`}
          </p>
          {c.title && <p className={styles.title}>Title: {c.title}</p>}
        </div>
      </div>
      <div className={styles.xp}>
        <div className={styles.xpText}>
          <span>
            {formatNumber(overall.xp)}
            {overall.nextAt !== null && ` / ${formatNumber(overall.nextAt)}`} XP
          </span>
          <span>
            {overall.toNext === null
              ? "Max level"
              : `${formatNumber(overall.toNext)} to level ${overall.level + 1}`}
          </span>
        </div>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label="Progress to next level"
          aria-valuenow={Math.round(overall.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={styles.fill} style={{ width: `${overall.pct}%` }} />
        </div>
      </div>
    </section>
  );
}
