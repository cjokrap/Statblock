import Link from "next/link";
import styles from "./recipes.module.css";

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
