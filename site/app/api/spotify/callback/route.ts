import { completeSpotifyConnection, SpotifyHttpError, SpotifyInputError } from "../../../../server/spotify";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { resolveProfile } from "../../../../server/profiles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to complete Spotify authorization." }, { status: 401 });
  try {
    const profile = await resolveProfile(user);
    await completeSpotifyConnection(new URL(request.url), profile.id);
    return Response.redirect(new URL("/?spotify=connected#taste", request.url));
  } catch (error) {
    if (error instanceof SpotifyInputError || error instanceof SpotifyHttpError) {
      return Response.json({ error: error.message }, { status: error instanceof SpotifyHttpError ? error.status : 400 });
    }
    throw error;
  }
}
