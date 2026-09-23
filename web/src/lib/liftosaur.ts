import "server-only";

// Checks a key with Liftosaur before it's saved: one history record, the
// same endpoint and header the sync uses (scripts/liftosaur/sync.py).
// LIFTOSAUR_API_BASE overrides the address in tests.
const BASE = process.env.LIFTOSAUR_API_BASE ?? "https://www.liftosaur.com/api/v1";

export async function checkLiftosaurKey(key: string): Promise<"ok" | "rejected" | "unreachable"> {
  try {
    const res = await fetch(`${BASE}/history?limit=1`, {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "statblock-app" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return "ok";
    if (res.status === 401 || res.status === 403) return "rejected";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}
