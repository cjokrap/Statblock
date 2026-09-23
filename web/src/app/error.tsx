"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>Something went wrong</h1>
      <p style={{ color: "var(--muted)" }}>That didn&apos;t work. Try again in a moment.</p>
      <button
        type="button"
        onClick={reset}
        style={{
          minHeight: 44,
          padding: "0 18px",
          border: "none",
          borderRadius: 22,
          background: "var(--red)",
          color: "var(--card)",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </main>
  );
}
