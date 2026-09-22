import type { TrackRow } from "@/lib/character";
import { formatNumber } from "@/lib/game";
import styles from "./TrackList.module.css";

export function TrackList({ title, rows }: { title: string; rows: TrackRow[] }) {
  const id = `${title.toLowerCase()}-heading`;
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.code} className={styles.row}>
            <div className={styles.top}>
              <span className={styles.name} title={r.description}>
                {r.name}
              </span>
              <span className={styles.level}>Lv {r.progress.level}</span>
            </div>
            <div
              className={styles.bar}
              role="progressbar"
              aria-label={`${r.name}: ${formatNumber(r.progress.xp)} XP`}
              aria-valuenow={Math.round(r.progress.pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={styles.fill} style={{ width: `${r.progress.pct}%` }} />
            </div>
            <span className={styles.xp}>{formatNumber(r.progress.xp)} XP</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
