import { addStackItem, removeStackItem } from "@/app/actions/settings";
import { SubmitButton } from "@/components/SubmitButton";
import styles from "./settings.module.css";

// The daily supplement stack. Taking it is one tap on Today (+1 Alchemist
// XP); its nutrients count in totals but never toward INT.
export function StackEditor({ items }: { items: { id: number; name: string; serving: string }[] }) {
  return (
    <section className={styles.section} aria-labelledby="stack-heading">
      <h2 id="stack-heading" className={styles.sectionTitle}>
        Daily stack
      </h2>
      <div className={styles.card}>
        {items.map((i) => (
          <div key={i.id} className={styles.row}>
            <span className={styles.rowText}>
              <span style={{ fontSize: 15 }}>{i.name}</span>
              <span className={styles.hint}>{i.serving}</span>
            </span>
            <form action={removeStackItem}>
              <input type="hidden" name="item_id" value={i.id} />
              <SubmitButton className={styles.secondary} aria-label={`Remove ${i.name}`}>
                Remove
              </SubmitButton>
            </form>
          </div>
        ))}
        <form action={addStackItem} className={styles.stack}>
          <span className={styles.label}>Add a supplement</span>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label htmlFor="stack-name" className={styles.smallLabel}>
                Name
              </label>
              <input id="stack-name" name="name" required maxLength={120} placeholder="One A Day Men's"
                className={styles.input} />
            </div>
            <div className={styles.field}>
              <label htmlFor="stack-serving" className={styles.smallLabel}>
                Serving
              </label>
              <input id="stack-serving" name="serving" maxLength={60} placeholder="1 tablet"
                className={styles.input} />
            </div>
          </div>
          <SubmitButton className={styles.secondary} pendingText="Adding…">
            + Add to stack
          </SubmitButton>
        </form>
      </div>
      <p className={styles.hint}>Counts in nutrient totals, never in INT.</p>
    </section>
  );
}
