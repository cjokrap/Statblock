"use client";

import { useState } from "react";
import type { Portion } from "@/lib/food";
import { forGrams, MEAL_LABEL, MEALS, type Meal, type Per100 } from "@/lib/meals";
import styles from "./food.module.css";

type Props = {
  // The server action to post to, and the hidden fields that name the food
  // for it (food_id for stored foods, fdc_id for USDA packaged foods).
  action: (formData: FormData) => Promise<void>;
  ids: Record<string, string | number>;
  per100: Per100;
  portions: Portion[];
  meal: Meal;
  firstInSlot: boolean;
  // Editing a logged entry: start from its amount, let the meal change, and
  // label the button "Save changes".
  edit?: { unit: string; qty: string };
};

export function AmountForm({ action, ids, per100, portions, meal, firstInSlot, edit }: Props) {
  // unit: "g" or the index of a household portion
  const [unit, setUnit] = useState<string>(edit?.unit ?? (portions.length ? "0" : "g"));
  const [qty, setQty] = useState<string>(edit?.qty ?? (portions.length ? "1" : "100"));
  const [mealNow, setMealNow] = useState<Meal>(meal);
  const [pending, setPending] = useState(false);

  const n = Number(qty.replace(",", "."));
  const valid = Number.isFinite(n) && n > 0;
  const portion = unit === "g" ? null : portions[Number(unit)];
  const grams = !valid ? 0 : portion ? n * portion.grams : n;
  const label = portion && valid ? (n === 1 ? portion.label : `${n} × ${portion.label}`) : "";
  const totals = forGrams(per100, grams);

  return (
    <form action={action} onSubmit={() => setPending(true)} className={styles.form}>
      {Object.entries(ids).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="meal" value={mealNow} />
      <input type="hidden" name="grams" value={grams} />
      <input type="hidden" name="portion_label" value={label} />

      <div className={styles.amountRow}>
        <label htmlFor="qty" className={styles.amountLabel}>
          Amount
        </label>
        <input
          id="qty"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className={styles.qty}
          aria-invalid={!valid}
        />
        <label htmlFor="unit" className="visually-hidden">
          Unit
        </label>
        <select
          id="unit"
          value={unit}
          onChange={(e) => {
            const next = e.target.value;
            // Switching between grams and portions resets to a sensible amount.
            if ((next === "g") !== (unit === "g")) setQty(next === "g" ? String(Math.round(grams) || 100) : "1");
            setUnit(next);
          }}
          className={styles.unit}
        >
          {portions.map((p, i) => (
            <option key={i} value={String(i)}>
              {p.label} ({Math.round(p.grams)} g)
            </option>
          ))}
          <option value="g">grams</option>
        </select>
      </div>

      <dl className={styles.macros}>
        <div>
          <dt>kcal</dt>
          <dd>{Math.round(totals.kcal)}</dd>
        </div>
        <div>
          <dt>protein</dt>
          <dd>{Math.round(totals.protein)} g</dd>
        </div>
        <div>
          <dt>carbs</dt>
          <dd>{Math.round(totals.carbs)} g</dd>
        </div>
        <div>
          <dt>fat</dt>
          <dd>{Math.round(totals.fat)} g</dd>
        </div>
      </dl>
      {portion && valid && <p className={styles.grams}>{Math.round(grams)} g total</p>}

      {edit && (
        <div className={styles.amountRow}>
          <label htmlFor="meal" className={styles.amountLabel}>
            Meal
          </label>
          <select id="meal" value={mealNow} onChange={(e) => setMealNow(e.target.value as Meal)} className={styles.unit}>
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {MEAL_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      )}

      <button type="submit" className={styles.submit} disabled={!valid || pending}>
        {edit
          ? pending
            ? "Saving…"
            : "Save changes"
          : pending
            ? "Adding…"
            : `Add to ${MEAL_LABEL[meal]}${firstInSlot ? " · +5 Quartermaster XP" : ""}`}
      </button>
    </form>
  );
}
