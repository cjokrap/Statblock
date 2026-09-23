import "server-only";
import { createClient } from "@supabase/supabase-js";

// Supabase with the secret (service role) key. Bypasses RLS, so use it only
// for writes a user may not make themselves, with data the server fetched
// itself: saving USDA packaged foods into the shared foods table.
// SUPABASE_SECRET_KEY has no NEXT_PUBLIC_ prefix, so it never reaches the
// browser.
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY isn't set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
