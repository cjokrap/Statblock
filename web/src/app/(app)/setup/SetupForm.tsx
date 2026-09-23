"use client";

import { useActionState, useState } from "react";
import { saveSetup, type FormState } from "@/app/actions/settings";
import { Disclaimer, Toggles, Training } from "@/app/(app)/settings/parts";
import styles from "@/app/(app)/settings/settings.module.css";
import {
  ACTIVITIES,
  ageOn,
  CM_PER_IN,
  EATING_STYLES,
  KG_PER_LB,
  ML_PER_OZ,
  parseNumber,
  STYLE_LABEL,
  suggestTargets,
  type Activity,
  type EatingStyle,
  type Sex,
  type TargetRules,
} from "@/lib/targets";

export type SetupInitial = {
  sex: Sex | null;
  birth_date: string;
  height_cm: number | null;
  weight_kg: number | null;
  goal_weight_kg: number | null;
  eating_style: EatingStyle;
  training_days_per_week: number;
  rest_days: number[];
};

const ACTIVITY_TEXT: Record<Activity, [string, string]> = {
  sedentary: ["Mostly sitting", "Desk job, little exercise"],
  light: ["Lightly active", "Desk job, exercise 1–3 days a week"],
  moderate: ["Moderately active", "Desk job, train 3–5 days a week"],
  very: ["Very active", "On your feet all day, or train 6–7 days"],
};

const PACES = [
  { value: "0.5", label: "0.5" },
  { value: "1", label: "1" },
  { value: "1.5", label: "1.5" },
  { value: "0", label: "Maintain" },
] as const;

const STYLE_NOTE: Record<EatingStyle, string> = {
  balanced: "Balanced: protein from your goal weight, fat at 30% of calories, carbs fill the rest.",
  high_protein: "High protein: 1 g protein per lb of goal weight, fat at 25%, carbs fill the rest.",
  low_carb: "Low carb: a 100 g net-carb ceiling, fat fills the rest.",
  keto: "Keto: a 25 g net-carb ceiling, fat fills the rest.",
  low_fat: "Low fat: fat at 20% of calories, carbs fill the rest.",
  custom: "Custom: starts from Balanced; set your own numbers in Settings.",
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function SetupForm({
  initial,
  rules,
  weightUnit,
  today,
}: {
  initial: SetupInitial;
  rules: TargetRules;
  weightUnit: "lb" | "kg";
  today: string;
}) {
  const lb = weightUnit === "lb";
  const [state, action, pending] = useActionState<FormState, FormData>(saveSetup, { error: null });
  const totalIn = initial.height_cm ? Math.round(initial.height_cm / CM_PER_IN) : null;
  const [ft, setFt] = useState(totalIn ? String(Math.floor(totalIn / 12)) : "");
  const [inch, setInch] = useState(totalIn ? String(totalIn % 12) : "");
  const [cm, setCm] = useState(initial.height_cm ? String(Math.round(initial.height_cm)) : "");
  const toUnit = (kg: number | null) => (kg === null ? "" : String(Math.round(lb ? kg / KG_PER_LB : kg)));
  const [weight, setWeight] = useState(toUnit(initial.weight_kg));
  const [goal, setGoal] = useState(toUnit(initial.goal_weight_kg));
  const [birth, setBirth] = useState(initial.birth_date);
  const [sex, setSex] = useState<Sex | "">(initial.sex ?? "");
  const [activity, setActivity] = useState<Activity>("moderate");
  const [pace, setPace] = useState<string>("1");
  const [style, setStyle] = useState<EatingStyle>(initial.eating_style);
  const [days, setDays] = useState(initial.training_days_per_week);
  const [rest, setRest] = useState(initial.rest_days);

  // The live suggestion, once the body stats are filled in.
  const toKg = (s: string) => {
    const n = parseNumber(s);
    return n === null ? null : lb ? n * KG_PER_LB : n;
  };
  const heightCm = lb
    ? parseNumber(ft) === null
      ? null
      : ((parseNumber(ft) ?? 0) * 12 + (parseNumber(inch) ?? 0)) * CM_PER_IN
    : parseNumber(cm);
  const weightKg = toKg(weight);
  const goalKg = toKg(goal);
  const age = /^\d{4}-\d{2}-\d{2}$/.test(birth) ? ageOn(birth, today) : null;
  const ready = sex !== "" && heightCm && weightKg && goalKg && age !== null && age >= 13;
  const s = ready
    ? suggestTargets(rules, {
        body: { sex, weightKg, heightCm, age },
        goalWeightKg: goalKg,
        activity,
        paceLbPerWeek: Number(pace),
        style,
      })
    : null;

  const input = (id: string, label: string, value: string, set: (v: string) => void, extra = {}) => (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.smallLabel}>
        {label}
      </label>
      <input id={id} name={id} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)}
        className={styles.input} required {...extra} />
    </div>
  );

  return (
    <form action={action} className={styles.form}>
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}

      <div className={styles.padCard}>
        <div className={styles.grid2}>
          {lb ? (
            <>
              {input("height_ft", "Height (ft)", ft, setFt)}
              {input("height_in", "Height (in)", inch, setInch, { required: false })}
            </>
          ) : (
            <div className={styles.span2}>{input("height_cm", "Height (cm)", cm, setCm)}</div>
          )}
          {input("weight", `Current weight (${weightUnit})`, weight, setWeight)}
          {input("goal_weight", `Goal weight (${weightUnit})`, goal, setGoal)}
          <div className={`${styles.field} ${styles.span2}`}>
            <label htmlFor="birth_date" className={styles.smallLabel}>
              Birthday
            </label>
            <input id="birth_date" name="birth_date" type="date" value={birth} max={today}
              onChange={(e) => setBirth(e.target.value)} className={styles.input} required />
          </div>
          <div className={`${styles.field} ${styles.span2}`}>
            <span className={styles.smallLabel}>Sex</span>
            <Toggles name="sex" label="Sex" value={sex} onChange={setSex}
              options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }] as const} />
          </div>
        </div>
        <span className={styles.hint}>Used only to estimate calories and recommended micronutrients.</span>
      </div>

      <section className={styles.section} aria-labelledby="activity-heading">
        <h2 id="activity-heading" className={styles.plainTitle}>
          How active are you?
        </h2>
        <input type="hidden" name="activity" value={activity} />
        <div role="group" aria-labelledby="activity-heading" className={styles.section}>
          {ACTIVITIES.map((a) => (
            <button key={a} type="button" aria-pressed={a === activity} onClick={() => setActivity(a)}
              className={styles.choice}>
              <span className={styles.choiceName}>{ACTIVITY_TEXT[a][0]}</span>
              <span className={styles.hint}>{ACTIVITY_TEXT[a][1]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="pace-heading">
        <h2 id="pace-heading" className={styles.plainTitle}>
          Goal
        </h2>
        <Toggles name="pace" label="Weight loss pace" options={PACES} value={pace} onChange={setPace}
          className={styles.pills4} buttonClass={styles.pill} />
        <span className={styles.hint}>Pounds per week. Slower is easier to sustain.</span>
      </section>

      <section className={styles.section} aria-labelledby="style-heading">
        <h2 id="style-heading" className={styles.plainTitle}>
          Eating style
        </h2>
        <Toggles name="style" label="Eating style" value={style} onChange={setStyle}
          options={EATING_STYLES.map((x) => ({ value: x, label: STYLE_LABEL[x] }))}
          className={styles.pills} buttonClass={styles.pill} />
        <span className={styles.hint}>{STYLE_NOTE[style]} Every style can be fine-tuned in Settings.</span>
      </section>

      <section className={styles.section} aria-labelledby="training-heading">
        <h2 id="training-heading" className={styles.plainTitle}>
          Training
        </h2>
        <div className={styles.card}>
          <Training days={days} setDays={setDays} rest={rest} setRest={setRest} />
        </div>
      </section>

      <section className={styles.suggest} aria-labelledby="suggest-heading" aria-live="polite">
        <h2 id="suggest-heading" className={styles.suggestLabel}>
          Suggested targets
        </h2>
        {s ? (
          <>
            <div className={styles.kcal}>
              <span className={styles.kcalValue}>{fmt(s.calorie_target)}</span>
              <span className={styles.kcalUnit}>kcal per day</span>
            </div>
            <dl className={styles.suggestGrid}>
              <div><dt>protein</dt><dd>{s.protein_g} g</dd></div>
              <div><dt>{s.carbs_are_ceiling ? "carb ceiling" : "carbs"}</dt><dd>{s.carbs_g} g</dd></div>
              <div><dt>fat</dt><dd>{s.fat_g} g</dd></div>
              <div><dt>water</dt><dd>{Math.round(s.water_goal_ml / ML_PER_OZ)} oz</dd></div>
            </dl>
            {s.floored && (
              <span className={styles.sheetNote}>
                Raised to the {sex === "male" ? "1,500" : "1,200"} kcal minimum.
              </span>
            )}
          </>
        ) : (
          <span className={styles.sheetNote}>Fill in your height, weights, birthday and sex to see them.</span>
        )}
        <div className={styles.sources}>
          <span><strong>Where these come from</strong></span>
          <span>
            <strong>Calories:</strong> Mifflin–St Jeor equation (the most accurate common estimate, per a Journal
            of the American Dietetic Association review) times your activity level, minus about 500 kcal a day
            for each lb a week.
          </span>
          <span>
            <strong>Protein:</strong> 0.8 g per lb of goal weight (1 g for High protein), inside the range the
            International Society of Sports Nutrition recommends for people lifting while losing fat.
          </span>
          <span>
            <strong>Fat and carbs:</strong> set by your eating style; Balanced keeps fat within the 20–35% range
            in the Dietary Guidelines for Americans.
          </span>
          <span>
            <strong>Water:</strong> about 100 oz a day from drinks for men, 72 oz for women, based on National
            Academies intake levels.
          </span>
        </div>
        <span className={styles.sheetNote}>
          Suggestions never go below 1,500 kcal (men) or 1,200 kcal (women). Going lower is a conversation for
          your doctor.
        </span>
        <Disclaimer dark />
      </section>

      <div className={styles.actions}>
        <button type="submit" name="mode" value="use" className={styles.primary} disabled={!s || pending}>
          {pending ? "Saving…" : "Use these targets"}
        </button>
        <button type="submit" name="mode" value="own" className={styles.secondary} disabled={!s || pending}>
          I&apos;ll set my own numbers
        </button>
        <span className={styles.hint}>
          Saving targets starts the game judging your days, beginning with today. You can change them any time in
          Settings.
        </span>
      </div>
    </form>
  );
}
