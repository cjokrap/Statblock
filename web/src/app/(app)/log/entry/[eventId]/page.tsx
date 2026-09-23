import Link from "next/link";
import { notFound } from "next/navigation";
import { editFood, removeFood } from "@/app/actions/food";
import { SubmitButton } from "@/components/SubmitButton";
import { getEntry } from "@/lib/food";
import { amountFromLabel } from "@/lib/meals";
import { AmountForm } from "../../food/[id]/AmountForm";
import styles from "../../food/[id]/food.module.css";

export const metadata = { title: "Edit entry · Statblock" };

type Props = { params: Promise<{ eventId: string }> };

// Edit a logged food: its amount, portion or meal. Saving replaces the entry
// (edit_food_log) at its original time; Remove deletes it.
export default async function EditEntryPage({ params }: Props) {
  const { eventId } = await params;
  const id = Number(eventId);
  if (!Number.isInteger(id)) notFound();
  const entry = await getEntry(id);
  if (!entry) notFound();
  const { item, portions } = entry;

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <Link href="/" aria-label="Back to today" className={styles.back}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <span className={styles.crumb}>Edit entry</span>
      </header>
      <div className={styles.card}>
        <div className={styles.foodHead}>
          <h1 className={styles.name}>{item.food.name}</h1>
          <p className={styles.source}>
            {item.food.brand ? `${item.food.brand} · ` : ""}Logged as{" "}
            {item.portionLabel ?? `${Math.round(item.grams)} g`}
          </p>
        </div>
        <AmountForm
          action={editFood}
          ids={{ event_id: item.eventId }}
          per100={item.food}
          portions={portions}
          meal={item.meal}
          firstInSlot={false}
          edit={amountFromLabel(item.portionLabel, item.grams, portions)}
        />
      </div>
      <form action={removeFood}>
        <input type="hidden" name="event_id" value={item.eventId} />
        <input type="hidden" name="then" value="home" />
        <SubmitButton className={styles.removeEntry} pendingText="Removing…">
          Remove this entry
        </SubmitButton>
      </form>
      <p className={styles.source}>Edits keep the entry&apos;s original time, so quests and XP stay as they were earned.</p>
    </main>
  );
}
