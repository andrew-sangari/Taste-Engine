import { completeSpotifyConnection, SpotifyHttpError, SpotifyInputError } from "../../../../server/spotify";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await completeSpotifyConnection(new URL(request.url));
    return Response.redirect(new URL("/?spotify=connected#taste", request.url));
  } catch (error) {
    if (error instanceof SpotifyInputError || error instanceof SpotifyHttpError) {
      return Response.json({ error: error.message }, { status: error instanceof SpotifyHttpError ? error.status : 400 });
    }
    throw error;
  }
}
