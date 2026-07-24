import { getChatGPTUser } from "../../../chatgpt-auth";
import { ollamaCloudStatus } from "../../../../server/ollama-cloud";
import { spotifyStatus } from "../../../../server/spotify";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  return Response.json({
    spotify: await spotifyStatus(user.email),
    ollama: ollamaCloudStatus(),
  }, { headers: { "cache-control": "no-store" } });
}
