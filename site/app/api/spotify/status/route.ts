import { getChatGPTUser } from "../../../chatgpt-auth";
import { disconnectSpotify, spotifyStatus } from "../../../../server/spotify";
import { resolveProfile } from "../../../../server/profiles";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  return Response.json(await spotifyStatus(await resolveProfile(user)), { headers: { "cache-control": "no-store" } });
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  await disconnectSpotify(await resolveProfile(user));
  return Response.json({ ok: true });
}
