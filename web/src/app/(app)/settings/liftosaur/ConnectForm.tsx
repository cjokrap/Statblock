"use client";

import { useActionState } from "react";
import { connectLiftosaur, type ConnectState } from "@/app/actions/liftosaur";
import styles from "../settings.module.css";

export function ConnectForm({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectLiftosaur, { error: null });
  return (
    <form action={action} className={styles.form}>
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <div className={styles.field}>
        <label htmlFor="api_key" className={styles.label}>
          {connected ? "Replace your API key" : "Liftosaur API key"}
        </label>
        <input id="api_key" name="api_key" type="password" autoComplete="off" spellCheck={false}
          placeholder="lftsk_…" required className={styles.input} />
        <span className={styles.hint}>
          In Liftosaur, go to Settings → API Keys → Create API Key (needs Premium). It starts with lftsk_.
        </span>
      </div>
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Checking with Liftosaur…" : connected ? "Check and replace" : "Check and connect"}
      </button>
    </form>
  );
}
