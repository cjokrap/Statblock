// Checks the Supabase settings the app is built with, so a setup mistake
// shows a plain explanation instead of a bare "Internal Server Error".
// Messages never include the values themselves.

export function supabaseConfigProblem(url: string | undefined, key: string | undefined): string | null {
  if (!url || !url.trim()) return "NEXT_PUBLIC_SUPABASE_URL isn't set.";
  if (url !== url.trim()) return "NEXT_PUBLIC_SUPABASE_URL has spaces or a line break around it.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL isn't a valid URL. It should look like https://abcdefghijkl.supabase.co";
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return "NEXT_PUBLIC_SUPABASE_URL should start with https://";
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return `NEXT_PUBLIC_SUPABASE_URL should be just the project address, with nothing after .supabase.co (remove "${parsed.pathname}").`;
  }

  if (!key || !key.trim()) return "NEXT_PUBLIC_SUPABASE_ANON_KEY isn't set.";
  if (key !== key.trim()) return "NEXT_PUBLIC_SUPABASE_ANON_KEY has spaces or a line break around it.";
  if (/^["']|["']$/.test(key)) return "NEXT_PUBLIC_SUPABASE_ANON_KEY has quote marks around it. Remove them.";
  if (key.startsWith("sb_secret_")) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY holds the Secret key. Use the Publishable key (sb_publishable_…) instead, and rotate the secret key in Supabase since it was exposed to the browser.";
  }
  if (key.startsWith("eyJ") && jwtRole(key) === "service_role") {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY holds the service_role key. Use the Publishable key (sb_publishable_…) or the legacy anon key instead, and rotate the service_role key in Supabase since it was exposed to the browser.";
  }
  if (!key.startsWith("sb_publishable_") && !key.startsWith("eyJ")) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY doesn't look like a Supabase key. It should start with sb_publishable_ (or eyJ for the legacy anon key).";
  }
  return null;
}

function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}
