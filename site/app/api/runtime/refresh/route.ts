import { crossSiteRejection } from "../../../../server/request-guard";
import { getSignedInUser } from "../../../auth.ts";
import { HostedRefreshConflictError, runHostedRefresh } from "../../../../server/hosted-refresh";
import { resolveProfile } from "../../../../server/profiles";
import { releasePublicationReady } from "../../../../server/release";

export const dynamic = "force-dynamic";
// A refresh retrieves every source and runs the optional advisory passes in
// one invocation; 300 seconds is the ceiling on Vercel's Hobby plan.
export const maxDuration = 300;

export async function POST(request: Request) {
  const crossSite = crossSiteRejection(request);
  if (crossSite) return crossSite;
  if (!releasePublicationReady()) {
    return Response.json({ error: "This source artifact is not eligible to publish." }, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to Taste Engine." }, { status: 401 });
  try {
    const summary = await runHostedRefresh(await resolveProfile(user));
    return Response.json(summary, {
      status: summary.status === "blocked" ? 409 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HostedRefreshConflictError) {
      return Response.json({ error: error.message }, {
        status: 409,
        headers: { "cache-control": "no-store", "retry-after": "60" },
      });
    }
    throw error;
  }
}
