import { addStackItem, removeStackItem, setStackFiber } from "@/app/actions/settings";
import { SubmitButton } from "@/components/SubmitButton";
import styles from "./settings.module.css";

// The daily supplement stack. Taking it is one tap on Today (+1 Alchemist
// XP); its nutrients count in totals but never toward INT.
export function StackEditor({
  items,
}: {
  items: { id: number; supplementId: number; name: string; serving: string; fiberG: number | null }[];
}) {
  return (
    <section className={styles.section} aria-labelledby="stack-heading">
      <h2 id="stack-heading" className={styles.sectionTitle}>
        Daily stack
      </h2>
      <div className={styles.card}>
        {items.map((i) => (
          <div key={i.id} className={styles.stack}>
            <div className={styles.macroRow}>
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
            <form action={setStackFiber} className={styles.macroRow}>
              <input type="hidden" name="supplement_id" value={i.supplementId} />
              <label htmlFor={`fiber-${i.id}`} className={styles.hint}>
                Fiber per serving
              </label>
              <span className={styles.inputWithUnit}>
                <input id={`fiber-${i.id}`} name="fiber" inputMode="decimal" defaultValue={i.fiberG ?? ""}
                  placeholder="0" className={styles.number} />
                <span className={styles.unit}>g</span>
                <SubmitButton className={styles.secondary} aria-label={`Save fiber for ${i.name}`} pendingText="…">
                  Save
                </SubmitButton>
              </span>
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
            <div className={styles.field}>
              <label htmlFor="stack-fiber" className={styles.smallLabel}>
                Fiber per serving (g)
              </label>
              <input id="stack-fiber" name="fiber" inputMode="decimal" placeholder="0" className={styles.input} />
            </div>
          </div>
          <SubmitButton className={styles.secondary} pendingText="Adding…">
            + Add to stack
          </SubmitButton>
        </form>
      </div>
      <p className={styles.hint}>
        Fiber from the stack counts toward your fiber goal once you take it. Supplements never count toward INT.
      </p>
    </section>
  );
}
