import { getSignedInUser } from "../app/auth.ts";
import { ProfileAccessError, resolveProfile, type ProfileScope } from "./profiles";

export { crossSiteRejection } from "./cross-site.ts";
import { crossSiteRejection } from "./cross-site.ts";

// Resolve the signed-in profile, or the response that should be returned
// instead: 401 when signed out, 403 when the account is not allowed (rather
// than an unhandled 500), and 403 for a cross-site write.
export async function signedInProfile(request: Request, { write = false } = {}): Promise<{ profile: ProfileScope } | { response: Response }> {
  if (write) {
    const rejection = crossSiteRejection(request);
    if (rejection) return { response: rejection };
  }
  const user = await getSignedInUser();
  if (!user) return { response: Response.json({ error: "Sign in to Taste Engine." }, { status: 401 }) };
  try {
    return { profile: await resolveProfile(user) };
  } catch (error) {
    if (error instanceof ProfileAccessError) return { response: Response.json({ error: "This account does not have access." }, { status: 403 }) };
    throw error;
  }
}
