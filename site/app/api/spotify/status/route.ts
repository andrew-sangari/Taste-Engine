import { crossSiteRejection } from "../../../../server/request-guard";
import { getSignedInUser } from "../../../auth.ts";
import { disconnectSpotify, spotifyStatus } from "../../../../server/spotify";
import { resolveProfile } from "../../../../server/profiles";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to Taste Engine." }, { status: 401 });
  return Response.json(await spotifyStatus(await resolveProfile(user)), { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const crossSite = crossSiteRejection(request);
  if (crossSite) return crossSite;
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to Taste Engine." }, { status: 401 });
  await disconnectSpotify(await resolveProfile(user));
  return Response.json({ ok: true });
}
