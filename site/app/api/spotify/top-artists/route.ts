import { getChatGPTUser } from "../../../chatgpt-auth";
import { refreshSpotifyTopArtists, SpotifyHttpError } from "../../../../server/spotify";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { limit?: number };
    return Response.json(await refreshSpotifyTopArtists(user.email, body.limit ?? 50), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SpotifyHttpError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
