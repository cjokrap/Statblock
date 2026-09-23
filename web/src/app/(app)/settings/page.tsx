import Link from "next/link";
import { loadLiftosaur, loadSettings, loadStack } from "@/lib/settings";
import { EATING_STYLES, isOneOf, macrosFor, parseNumber } from "@/lib/targets";
import { BackLink } from "./parts";
import { SettingsForm, type SettingsInitial } from "./SettingsForm";
import { StackEditor } from "./StackEditor";
import styles from "./settings.module.css";

export const metadata = { title: "Settings · Statblock" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SettingsPage({ searchParams }: Props) {
  const [sp, data, stack, lift] = await Promise.all([searchParams, loadSettings(), loadStack(), loadLiftosaur()]);
  const q = (k: string) => (typeof sp[k] === "string" ? parseNumber(sp[k]) : null);
  const { profile, settings, rules } = data;

  // The targets in force, else numbers carried over from setup's "I'll set
  // my own numbers", else a starting point to edit.
  let initial: Omit<SettingsInitial, "weight_unit" | "water_unit" | "timezone">;
  if (settings) {
    initial = settings;
  } else {
    const kcal = q("kcal") ?? 2000;
    const style = isOneOf(EATING_STYLES, sp.style) ? sp.style : "balanced";
    const m = macrosFor(rules, style, kcal, profile.goal_weight_kg);
    initial = {
      calorie_target: kcal,
      calorie_window_pct: 10,
      eating_style: style,
      protein_g: q("protein") ?? m.protein_g,
      carbs_g: q("carbs") ?? m.carbs_g,
      fat_g: q("fat") ?? m.fat_g,
      carbs_are_ceiling: m.carbs_are_ceiling,
      count_net_carbs: m.count_net_carbs,
      water_goal_ml: q("water_ml") ?? rules.suggestions?.water_ml?.[profile.sex ?? "male"] ?? 2957,
      training_days_per_week: q("training") ?? 4,
      rest_days:
        typeof sp.rest === "string"
          ? sp.rest.split(",").map(Number).filter((d) => d >= 1 && d <= 7)
          : [],
    };
  }

  const timezones = Intl.supportedValuesOf("timeZone");
  if (!timezones.includes(profile.timezone)) timezones.unshift(profile.timezone);

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <BackLink href="/" label="Back to today" />
        <h1 className={styles.title}>Settings</h1>
      </header>
      {sp.saved === "1" && (
        <p role="status" className={styles.saved}>
          Saved. Your targets apply from today.
        </p>
      )}
      {!settings && (
        <p className={styles.notice}>
          Your targets aren&apos;t saved yet. Check the numbers below, then save to start the game judging your days.
        </p>
      )}
      <SettingsForm
        initial={{
          ...initial,
          weight_unit: profile.weight_unit,
          water_unit: profile.water_unit,
          timezone: profile.timezone,
        }}
        rules={rules}
        goalWeightKg={profile.goal_weight_kg}
        timezones={timezones}
        saved={settings !== null}
      />
      <StackEditor items={stack} />
      <section className={styles.section} aria-labelledby="liftosaur-heading">
        <h2 id="liftosaur-heading" className={styles.sectionTitle}>
          Liftosaur
        </h2>
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.label}>Workout sync</span>
              <span className={lift.status === "connected" ? styles.good : lift.status === "error" ? styles.warn : styles.hint}>
                {lift.status === "connected"
                  ? `Connected · ${lift.workouts.toLocaleString("en-US")} workouts`
                  : lift.status === "error"
                    ? "Needs a new key"
                    : "Not connected"}
              </span>
            </span>
            <Link href="/settings/liftosaur" className={styles.sectionLink}>
              {lift.status ? "Manage" : "Connect"}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
