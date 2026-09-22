import { SignInForm } from "./SignInForm";
import styles from "./login.module.css";

export const metadata = { title: "Sign in · Statblock" };

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <div className={styles.crest} aria-hidden="true">
        S
      </div>
      <h1 className={styles.title}>Statblock</h1>
      <p className={styles.tagline}>Your character sheet awaits.</p>
      <SignInForm />
    </main>
  );
}
