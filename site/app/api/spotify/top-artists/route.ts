import { crossSiteRejection } from "../../../../server/request-guard";
import { getSignedInUser } from "../../../auth.ts";
import { refreshSpotifyTopArtists, SpotifyHttpError } from "../../../../server/spotify";
import { resolveProfile } from "../../../../server/profiles";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossSite = crossSiteRejection(request);
  if (crossSite) return crossSite;
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to Taste Engine." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { limit?: number };
    return Response.json(await refreshSpotifyTopArtists(await resolveProfile(user), body.limit ?? 50), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SpotifyHttpError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
