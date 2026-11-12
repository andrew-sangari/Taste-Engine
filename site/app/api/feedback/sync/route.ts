import { applyFeedbackOps, FeedbackSyncInputError, readFeedbackSync } from "../../../../server/feedback-sync";
import { signedInProfile } from "../../../../server/request-guard";

export const dynamic = "force-dynamic";
const NO_STORE = { headers: { "cache-control": "no-store" } };

// Pull: the merged feedback state for the signed-in profile.
export async function GET(request: Request) {
  const session = await signedInProfile(request);
  if ("response" in session) return session.response;
  return Response.json(await readFeedbackSync(session.profile), NO_STORE);
}

// Push: apply this device's operations, then return the merged state so the
// device converges in one round trip.
export async function POST(request: Request) {
  const session = await signedInProfile(request, { write: true });
  if ("response" in session) return session.response;
  try {
    const body = await request.json() as { ops?: unknown };
    const result = await applyFeedbackOps(session.profile, body.ops);
    return Response.json({ ...result, state: await readFeedbackSync(session.profile) }, NO_STORE);
  } catch (error) {
    if (error instanceof FeedbackSyncInputError || error instanceof SyntaxError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
