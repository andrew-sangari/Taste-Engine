import { getChatGPTUser } from "../../../chatgpt-auth";
import { disconnectSpotify, spotifyStatus } from "../../../../server/spotify";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  return Response.json(await spotifyStatus(user.email), { headers: { "cache-control": "no-store" } });
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  await disconnectSpotify(user.email);
  return Response.json({ ok: true });
}
