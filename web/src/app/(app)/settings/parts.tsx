"use client";

import Link from "next/link";
import styles from "./settings.module.css";

export const DISCLAIMER =
  "These are suggestions only and are not medical advice. Talk to your doctor before starting any diet or fitness program.";

function InfoIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// Required on every screen that shows suggested targets (see CLAUDE.md).
export function Disclaimer({ dark = false }: { dark?: boolean }) {
  return (
    <div role="note" className={dark ? styles.disclaimerDark : styles.disclaimer}>
      <InfoIcon color={dark ? "#D9A441" : "#7A5410"} />
      <span>{DISCLAIMER}</span>
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className={styles.back}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </Link>
  );
}

// Buttons that toggle, grouped; the value goes to the form in a hidden input.
export function Toggles<T extends string | number>({
  name,
  label,
  options,
  value,
  onChange,
  className = styles.segmented,
  buttonClass = styles.segment,
}: {
  name: string;
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  buttonClass?: string;
}) {
  return (
    <div role="group" aria-label={label} className={className}>
      <input type="hidden" name={name} value={String(value)} />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={buttonClass}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function Training({
  days,
  setDays,
  rest,
  setRest,
}: {
  days: number;
  setDays: (n: number) => void;
  rest: number[];
  setRest: (d: number[]) => void;
}) {
  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.label} id="training-days-label">
            Training days per week
          </span>
          <span className={styles.hint}>Sets the weekly STR check</span>
        </div>
        <div className={styles.stepper} role="group" aria-labelledby="training-days-label">
          <input type="hidden" name="training_days" value={days} />
          <button type="button" aria-label="Fewer days" className={styles.stepButton}
            onClick={() => setDays(Math.max(0, days - 1))} disabled={days <= 0}>
            −
          </button>
          <span className={styles.stepValue} aria-live="polite">
            {days}
          </span>
          <button type="button" aria-label="More days" className={styles.stepButton}
            onClick={() => setDays(Math.min(7, days + 1))} disabled={days >= 7}>
            +
          </button>
        </div>
      </div>
      <div className={styles.stack}>
        <span className={styles.label}>Planned rest days</span>
        <div role="group" aria-label="Planned rest days" className={styles.days}>
          {DAY_LABELS.map((l, i) => {
            const d = i + 1; // ISO weekday
            const on = rest.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={DAY_NAMES[i]}
                className={styles.day}
                onClick={() => setRest(on ? rest.filter((x) => x !== d) : [...rest, d].sort())}
              >
                {l}
              </button>
            );
          })}
        </div>
        {rest.map((d) => (
          <input key={d} type="hidden" name="rest_day" value={d} />
        ))}
        <span className={styles.hint}>No &ldquo;Train&rdquo; quest on rest days.</span>
      </div>
    </>
  );
}
