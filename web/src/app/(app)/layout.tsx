import styles from "./shell.module.css";

// Signed-in screens. The proxy sends signed-out visitors to /login.
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={styles.shell}>{children}</div>;
}
