import { crossSiteRejection } from "../../../../server/request-guard";
import { getSignedInUser } from "../../../auth.ts";
import {
  listSpotifyPlaylists,
  readPlaylistSelections,
  SpotifyHttpError,
  SpotifyInputError,
  writePlaylistSelections,
} from "../../../../server/spotify";
import { resolveProfile } from "../../../../server/profiles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to Taste Engine." }, { status: 401 });
  try {
    const profile = await resolveProfile(user);
    const available = new URL(request.url).searchParams.get("available") === "1"
      ? await listSpotifyPlaylists(profile)
      : null;
    return Response.json({ selected: await readPlaylistSelections(profile), available }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return spotifyError(error);
  }
}

export async function PUT(request: Request) {
  const crossSite = crossSiteRejection(request);
  if (crossSite) return crossSite;
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to Taste Engine." }, { status: 401 });
  try {
    const body = await request.json() as { playlists?: unknown };
    return Response.json({ selected: await writePlaylistSelections(await resolveProfile(user), body.playlists) });
  } catch (error) {
    return spotifyError(error);
  }
}

function spotifyError(error: unknown) {
  if (error instanceof SpotifyHttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SpotifyInputError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 });
  throw error;
}
