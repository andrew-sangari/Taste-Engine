import { getChatGPTUser } from "../../../chatgpt-auth";
import { getSpotifyPlaylistArtists, SpotifyHttpError } from "../../../../server/spotify";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  const url = new URL(request.url);
  const playlistId = url.searchParams.get("playlistId");
  if (!playlistId) return Response.json({ error: "playlistId is required." }, { status: 400 });
  try {
    const artists = await getSpotifyPlaylistArtists(user.email, playlistId, Number(url.searchParams.get("limit") ?? 250));
    return Response.json({ artists, warnings: [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof SpotifyHttpError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
