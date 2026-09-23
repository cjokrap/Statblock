import Link from "next/link";
import { logFood, removeFood } from "@/app/actions/food";
import type { LoggedItem } from "@/lib/food";
import { forGrams, MEAL_LABEL, MEALS, type Meal } from "@/lib/meals";
import styles from "./FoodLog.module.css";

function amount(it: LoggedItem) {
  return it.portionLabel ?? `${Math.round(it.grams)} g`;
}

export function FoodLog({ items, recents, suggestedMeal }: {
  items: LoggedItem[];
  recents: LoggedItem[];
  suggestedMeal: Meal;
}) {
  const totals = items.reduce(
    (t, it) => {
      const n = forGrams(it.food, it.grams);
      return { kcal: t.kcal + n.kcal, protein: t.protein + n.protein };
    },
    { kcal: 0, protein: 0 },
  );

  return (
    <section className={styles.section} aria-labelledby="food-log-heading">
      <div className={styles.header}>
        <h2 id="food-log-heading" className={styles.heading}>
          Food log
        </h2>
        <Link href={`/log?meal=${suggestedMeal}`} className={styles.addButton}>
          + Add food
        </Link>
      </div>
      <p className={styles.totals}>
        {Math.round(totals.kcal).toLocaleString("en-US")} kcal · {Math.round(totals.protein)} g protein today
      </p>

      {recents.length > 0 && (
        <div className={styles.recents}>
          <span className={styles.recentsLabel}>Recent, add to {MEAL_LABEL[suggestedMeal].toLowerCase()}:</span>
          <div className={styles.chips}>
            {recents.map((r) => (
              <form key={`${r.food.id}:${r.grams}`} action={logFood}>
                <input type="hidden" name="food_id" value={r.food.id} />
                <input type="hidden" name="grams" value={r.grams} />
                <input type="hidden" name="meal" value={suggestedMeal} />
                <input type="hidden" name="portion_label" value={r.portionLabel ?? ""} />
                <input type="hidden" name="stay" value="1" />
                <button type="submit" className={styles.chip}>
                  {shortName(r.food.name)}, {amount(r)}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      <div className={styles.meals}>
        {MEALS.map((meal) => {
          const mealItems = items.filter((i) => i.meal === meal);
          const kcal = mealItems.reduce((s, i) => s + forGrams(i.food, i.grams).kcal, 0);
          return (
            <div key={meal} className={styles.meal}>
              <div className={styles.mealHeader}>
                <h3 className={styles.mealName}>{MEAL_LABEL[meal]}</h3>
                <span className={styles.mealKcal}>{mealItems.length ? `${Math.round(kcal)} kcal` : ""}</span>
              </div>
              {mealItems.map((it) => (
                <div key={it.eventId} className={styles.item}>
                  <Link href={`/log/entry/${it.eventId}`} className={styles.itemName}
                    aria-label={`Edit ${it.food.name}, ${amount(it)}`}>
                    {it.food.name} · {amount(it)}
                  </Link>
                  <span className={styles.itemKcal}>{Math.round(forGrams(it.food, it.grams).kcal)}</span>
                  <form action={removeFood}>
                    <input type="hidden" name="event_id" value={it.eventId} />
                    <button type="submit" className={styles.remove} aria-label={`Remove ${it.food.name}`}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                      </svg>
                    </button>
                  </form>
                </div>
              ))}
              <Link href={`/log?meal=${meal}`} className={styles.addMeal}>
                + Add {MEAL_LABEL[meal].toLowerCase()}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function shortName(name: string) {
  const first = name.split(",")[0];
  return first.length > 28 ? `${first.slice(0, 27)}…` : first;
}
