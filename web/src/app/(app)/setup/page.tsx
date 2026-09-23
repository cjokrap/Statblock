import { BackLink } from "@/app/(app)/settings/parts";
import styles from "@/app/(app)/settings/settings.module.css";
import { loadSettings } from "@/lib/settings";
import { SetupForm } from "./SetupForm";

export const metadata = { title: "Your starting targets · Statblock" };

// First-run setup, and "Recalculate from body stats" from Settings.
export default async function SetupPage() {
  const { today, profile, settings, latestWeightKg, rules } = await loadSettings();
  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <BackLink href={settings ? "/settings" : "/"} label={settings ? "Back to settings" : "Back to today"} />
      </header>
      <div className={styles.intro}>
        <h1 className={styles.setupTitle}>{settings ? "Recalculate your targets" : "Your starting targets"}</h1>
        <p className={styles.lead}>
          Tell us a little about you and we&apos;ll suggest targets. You can change any of them later in Settings.
        </p>
      </div>
      <SetupForm
        today={today}
        rules={rules}
        weightUnit={profile.weight_unit}
        initial={{
          sex: profile.sex,
          birth_date: profile.birth_date ?? "",
          height_cm: profile.height_cm,
          weight_kg: latestWeightKg,
          goal_weight_kg: profile.goal_weight_kg,
          eating_style: settings?.eating_style ?? "balanced",
          training_days_per_week: settings?.training_days_per_week ?? 4,
          rest_days: settings?.rest_days ?? [],
        }}
      />
    </main>
  );
}
