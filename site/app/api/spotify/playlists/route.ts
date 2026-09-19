import { getChatGPTUser } from "../../../chatgpt-auth";
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
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
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
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
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
