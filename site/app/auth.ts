import { deploymentEnvironment } from "../server/release.ts";
import { serverSupabase } from "../server/supabase.ts";

export type SignedInUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

export const SIGN_IN_PATH = "/";

/**
 * The person this request belongs to, or null.
 *
 * Identity comes only from a Supabase session that Supabase itself has just
 * verified (`getUser` asks the auth server; it does not trust the cookie's
 * contents). No request header can name a user. Whether that user may use
 * Taste Engine is decided separately by the email allowlist in
 * `server/profiles.ts`.
 */
export async function getSignedInUser(): Promise<SignedInUser | null> {
  const supabase = await serverSupabase();
  if (!supabase) return developmentUser();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user?.email || !user.email_confirmed_at) return null;
  const email = user.email.trim().toLowerCase();
  const metadataName = user.user_metadata?.full_name;
  const fullName = typeof metadataName === "string" && metadataName.trim() ? metadataName.trim().slice(0, 120) : null;
  return { displayName: fullName ?? email, email, fullName };
}

// Local development and tests have no Supabase project. They may name one
// identity through TASTE_DEV_USER_EMAIL; a hosted environment never reads it.
function developmentUser(): SignedInUser | null {
  if (!["local", "test"].includes(deploymentEnvironment())) return null;
  const email = String(process.env.TASTE_DEV_USER_EMAIL ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  return { displayName: email, email, fullName: null };
}

export { safeReturnPath } from "./return-path.ts";
