import { disconnectLiftosaur } from "@/app/actions/liftosaur";
import { SubmitButton } from "@/components/SubmitButton";
import { loadLiftosaur } from "@/lib/settings";
import { BackLink } from "../parts";
import styles from "../settings.module.css";
import { ConnectForm } from "./ConnectForm";

export const metadata = { title: "Liftosaur · Statblock" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Connect Liftosaur: the key is checked with Liftosaur, then stored in
// Supabase Vault. Workouts sync every 2 hours (the Liftosaur sync workflow).
export default async function LiftosaurPage({ searchParams }: Props) {
  const [sp, l] = await Promise.all([searchParams, loadLiftosaur()]);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: l.timezone,
    }).format(new Date(iso));

  return (
    <main className={styles.main}>
      <header className={styles.topbar}>
        <BackLink href="/settings" label="Back to settings" />
        <h1 className={styles.title}>Liftosaur</h1>
      </header>
      {sp.saved === "1" && (
        <p role="status" className={styles.saved}>
          Connected. Your workouts sync every 2 hours, so new ones show up within 2 hours.
        </p>
      )}
      {sp.disconnected === "1" && (
        <p role="status" className={styles.notice}>
          Disconnected. The key is deleted; workouts already imported stay.
        </p>
      )}

      <section className={styles.section} aria-labelledby="status-heading">
        <h2 id="status-heading" className={styles.sectionTitle}>
          Status
        </h2>
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.label}>Connection</span>
            <span className={l.status === "connected" ? styles.good : l.status === "error" ? styles.warn : styles.hint}>
              {l.status === "connected" ? "Connected" : l.status === "error" ? "Needs a new key" : "Not connected"}
            </span>
          </div>
          {l.status && (
            <div className={styles.row}>
              <span className={styles.label}>Last sync</span>
              <span className={styles.hint}>{l.lastSyncedAt ? when(l.lastSyncedAt) : "Not yet"}</span>
            </div>
          )}
          <div className={styles.row}>
            <span className={styles.label}>Workouts imported</span>
            <span className={styles.hint}>{l.workouts.toLocaleString("en-US")}</span>
          </div>
          {l.lastError && (
            <div className={styles.stack}>
              <span className={styles.warn}>Last error</span>
              <span className={styles.hint}>{l.lastError}</span>
            </div>
          )}
        </div>
      </section>

      <ConnectForm connected={l.status !== null} />
      <p className={styles.hint}>
        The key is stored encrypted in Supabase Vault. The app never shows it again, and only the sync reads it.
        Workouts come from Liftosaur automatically, so you never track twice.
      </p>

      {l.status && (
        <form action={disconnectLiftosaur}>
          <SubmitButton className={styles.secondary} pendingText="Disconnecting…">
            Disconnect Liftosaur
          </SubmitButton>
        </form>
      )}
    </main>
  );
}
