"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkLiftosaurKey } from "@/lib/liftosaur";
import { liftosaurKeyProblem } from "@/lib/liftosaurKey";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ConnectState = { error: string | null };

// The key goes to Supabase Vault through set_liftosaur_key, which only the
// service role can call. The user id comes from the signed-in session, never
// from the form, so no one can set a key for someone else.
async function signedInUser(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) throw new Error("Not signed in");
  return uid;
}

export async function connectLiftosaur(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const key = String(formData.get("api_key") ?? "").trim();
  const problem = liftosaurKeyProblem(key);
  if (problem) return { error: problem };
  if (!process.env.SUPABASE_SECRET_KEY) {
    return { error: "Saving keys needs SUPABASE_SECRET_KEY in the Vercel settings." };
  }
  const uid = await signedInUser();

  const check = await checkLiftosaurKey(key);
  if (check === "rejected") {
    return { error: "Liftosaur didn't accept that key. Check it's copied in full, and that your Premium is active." };
  }
  if (check === "unreachable") return { error: "Liftosaur didn't answer. Try again in a minute." };

  const { error } = await createAdminClient().rpc("set_liftosaur_key", { p_user_id: uid, p_api_key: key });
  if (error) return { error: `Couldn't save the key: ${error.message}` };
  revalidatePath("/", "layout");
  redirect("/settings/liftosaur?saved=1");
}

export async function disconnectLiftosaur() {
  const uid = await signedInUser();
  const { error } = await createAdminClient().rpc("disconnect_liftosaur", { p_user_id: uid });
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
  redirect("/settings/liftosaur?disconnected=1");
}
