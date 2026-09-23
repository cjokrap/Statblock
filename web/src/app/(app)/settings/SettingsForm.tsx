"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveSettings, type FormState } from "@/app/actions/settings";
import {
  EATING_STYLES,
  fiberSuggestion,
  macroKcal,
  macrosFor,
  ML_PER_OZ,
  parseNumber,
  STYLE_LABEL,
  type EatingStyle,
  type TargetRules,
} from "@/lib/targets";
import { Disclaimer, Toggles, Training } from "./parts";
import styles from "./settings.module.css";

export type SettingsInitial = {
  calorie_target: number;
  calorie_window_pct: number;
  eating_style: EatingStyle;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  carbs_are_ceiling: boolean;
  count_net_carbs: boolean;
  fiber_g: number | null;
  water_goal_ml: number;
  training_days_per_week: number;
  rest_days: number[];
  weight_unit: "lb" | "kg";
  water_unit: "oz" | "ml";
  timezone: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function SettingsForm({
  initial,
  rules,
  goalWeightKg,
  timezones,
  saved,
}: {
  initial: SettingsInitial;
  rules: TargetRules;
  goalWeightKg: number | null;
  timezones: string[];
  saved: boolean; // a settings row exists
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, { error: null });
  const [kcal, setKcal] = useState(String(initial.calorie_target));
  const [windowPct, setWindowPct] = useState(String(initial.calorie_window_pct));
  const [style, setStyle] = useState<EatingStyle>(initial.eating_style);
  const [macros, setMacros] = useState({
    protein_g: String(initial.protein_g),
    carbs_g: String(initial.carbs_g),
    fat_g: String(initial.fat_g),
  });
  const [ceiling, setCeiling] = useState(initial.carbs_are_ceiling);
  const [netCarbs, setNetCarbs] = useState(initial.count_net_carbs);
  const [fiber, setFiber] = useState(initial.fiber_g === null ? "" : String(initial.fiber_g));
  const [waterUnit, setWaterUnit] = useState(initial.water_unit);
  const [water, setWater] = useState(
    String(initial.water_unit === "oz" ? Math.round(initial.water_goal_ml / ML_PER_OZ) : initial.water_goal_ml),
  );
  const [weightUnit, setWeightUnit] = useState(initial.weight_unit);
  const [days, setDays] = useState(initial.training_days_per_week);
  const [rest, setRest] = useState(initial.rest_days);
  const [timezone, setTimezone] = useState(initial.timezone);

  const kcalN = parseNumber(kcal);
  const winN = parseNumber(windowPct);
  const m = {
    protein_g: parseNumber(macros.protein_g) ?? 0,
    carbs_g: parseNumber(macros.carbs_g) ?? 0,
    fat_g: parseNumber(macros.fat_g) ?? 0,
  };
  const sum = macroKcal(m);

  function pickStyle(next: EatingStyle) {
    setStyle(next);
    if (next === "custom" || kcalN === null) return;
    const x = macrosFor(rules, next, kcalN, goalWeightKg, m.protein_g);
    setMacros({ protein_g: String(x.protein_g), carbs_g: String(x.carbs_g), fat_g: String(x.fat_g) });
    setCeiling(x.carbs_are_ceiling);
    setNetCarbs(x.count_net_carbs);
  }

  function editMacro(key: keyof typeof macros, v: string) {
    setMacros({ ...macros, [key]: v });
    setStyle("custom");
  }

  function switchWater(next: "oz" | "ml") {
    const n = parseNumber(water);
    if (n !== null && next !== waterUnit) {
      setWater(String(next === "oz" ? Math.round(n / ML_PER_OZ) : Math.round(n * ML_PER_OZ)));
    }
    setWaterUnit(next);
  }

  const share = (k: number) => (sum > 0 ? `${Math.round((k / sum) * 100)}%` : "");
  const low = kcalN !== null && winN !== null ? kcalN * (1 - winN / 100) : null;
  const high = kcalN !== null && winN !== null ? kcalN * (1 + winN / 100) : null;
  const off = kcalN === null ? 0 : sum - kcalN;

  return (
    <form action={action} className={styles.form}>
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}

      <section className={styles.section} aria-labelledby="nutrition-heading">
        <div className={styles.sectionHead}>
          <h2 id="nutrition-heading" className={styles.sectionTitle}>
            Nutrition targets
          </h2>
          <Link href="/setup" className={styles.sectionLink}>
            Recalculate from body stats
          </Link>
        </div>
        <div className={styles.card}>
          <div className={styles.row}>
            <label htmlFor="calorie_target" className={styles.label}>
              Daily calories
            </label>
            <span className={styles.inputWithUnit}>
              <input id="calorie_target" name="calorie_target" inputMode="numeric" value={kcal}
                onChange={(e) => setKcal(e.target.value)} className={styles.number} required />
              <span className={styles.unit}>kcal</span>
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowText}>
              <label htmlFor="calorie_window_pct" className={styles.label}>
                Calorie window
              </label>
              <span className={styles.hint}>
                {low !== null && high !== null ? `${fmt(low)}–${fmt(high)} counts as on target` : " "}
              </span>
            </span>
            <span className={styles.inputWithUnit}>
              <input id="calorie_window_pct" name="calorie_window_pct" inputMode="decimal" value={windowPct}
                onChange={(e) => setWindowPct(e.target.value)} className={styles.number} required />
              <span className={styles.unit}>± %</span>
            </span>
          </div>
          <div className={styles.stack}>
            <span className={styles.label}>Eating style</span>
            <Toggles
              name="eating_style"
              label="Eating style"
              options={EATING_STYLES.map((s) => ({ value: s, label: STYLE_LABEL[s] }))}
              value={style}
              onChange={pickStyle}
              className={styles.pills}
              buttonClass={styles.pill}
            />
            <span className={styles.hint}>
              A style fills in the macros below. Edit any number and it becomes Custom. Keto and Low carb treat
              carbs as a ceiling and count net carbs (total minus fiber).
            </span>
          </div>
          <div className={styles.stack}>
            <span className={styles.label}>Macros</span>
            {(
              [
                ["protein_g", "Protein"],
                ["carbs_g", ceiling ? "Carbs (ceiling)" : "Carbs"],
                ["fat_g", "Fat"],
              ] as const
            ).map(([key, name]) => (
              <div key={key} className={styles.macroRow}>
                <label htmlFor={key}>{name}</label>
                <span className={styles.inputWithUnit}>
                  <span className={styles.macroShare}>{share(key === "fat_g" ? m[key] * 9 : m[key] * 4)}</span>
                  <input id={key} name={key} inputMode="numeric" value={macros[key]}
                    onChange={(e) => editMacro(key, e.target.value)} className={styles.number} required />
                  <span className={styles.unit}>g</span>
                </span>
              </div>
            ))}
            {kcalN !== null &&
              (Math.abs(off) <= Math.max(25, kcalN * 0.02) ? (
                <span className={styles.good}>Macros add up to {fmt(sum)} kcal · matches your target</span>
              ) : (
                <span className={styles.warn}>
                  Macros add up to {fmt(sum)} kcal · {fmt(Math.abs(off))} {off > 0 ? "over" : "under"} your target
                </span>
              ))}
            <label className={styles.check}>
              <input type="checkbox" name="carbs_are_ceiling" checked={ceiling}
                onChange={(e) => { setCeiling(e.target.checked); setStyle("custom"); }} />
              Treat carbs as a ceiling (judged at end of day)
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="count_net_carbs" checked={netCarbs}
                onChange={(e) => { setNetCarbs(e.target.checked); setStyle("custom"); }} />
              Count net carbs (total minus fiber)
            </label>
            <span className={styles.hint}>Suggested protein range: 0.7–1.0 g per lb of goal weight</span>
            <div className={styles.macroRow}>
              <label htmlFor="fiber_g">Fiber goal</label>
              <span className={styles.inputWithUnit}>
                <input id="fiber_g" name="fiber_g" inputMode="numeric" value={fiber}
                  placeholder={kcalN !== null ? String(fiberSuggestion(kcalN)) : ""}
                  onChange={(e) => setFiber(e.target.value)} className={styles.number} />
                <span className={styles.unit}>g</span>
              </span>
            </div>
            <span className={styles.hint}>
              Leave blank for the suggestion: 14 g per 1,000 kcal (Dietary Guidelines for Americans). Counts food
              and your daily stack.
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowText}>
              <label htmlFor="water" className={styles.label}>
                Water goal
              </label>
              <span className={styles.hint}>National Academies: ~100 oz men, ~72 oz women</span>
            </span>
            <span className={styles.inputWithUnit}>
              <input id="water" name="water" inputMode="numeric" value={water}
                onChange={(e) => setWater(e.target.value)} className={styles.number} required />
              <span className={styles.unit}>{waterUnit === "oz" ? "oz" : "mL"}</span>
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="training-heading">
        <h2 id="training-heading" className={styles.sectionTitle}>
          Training
        </h2>
        <div className={styles.card}>
          <Training days={days} setDays={setDays} rest={rest} setRest={setRest} />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="units-heading">
        <h2 id="units-heading" className={styles.sectionTitle}>
          Units and time zone
        </h2>
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.label}>Body weight</span>
            <Toggles name="weight_unit" label="Weight unit" value={weightUnit} onChange={setWeightUnit}
              options={[{ value: "lb", label: "lb" }, { value: "kg", label: "kg" }] as const} />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Water</span>
            <Toggles name="water_unit" label="Water unit" value={waterUnit} onChange={switchWater}
              options={[{ value: "oz", label: "oz" }, { value: "ml", label: "mL" }] as const} />
          </div>
          <div className={styles.row}>
            <span className={styles.rowText}>
              <label htmlFor="timezone" className={styles.label}>
                Time zone
              </label>
              <span className={styles.hint}>Decides when your day ends</span>
            </span>
            <select id="timezone" name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className={styles.select}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <p className={styles.hint}>
        Changing a target applies from today forward. Past days keep the targets they were scored against.
        {!saved &&
          " Saving for the first time starts the game judging your days, beginning with today: once a day ends, it costs WIS if it wasn't fully logged."}
      </p>
      <Disclaimer />
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Saving…" : saved ? "Save changes" : "Save and start"}
      </button>
    </form>
  );
}
