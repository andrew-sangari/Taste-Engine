import { getChatGPTUser } from "../../../chatgpt-auth";
import { ollamaCloudStatus } from "../../../../server/ollama-cloud";
import { spotifyStatus } from "../../../../server/spotify";
import { resolveProfile } from "../../../../server/profiles";
import { releaseMetadata } from "../../../../server/release";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  const profile = await resolveProfile(user);
  return Response.json({
    profile: { id: profile.id, displayName: profile.displayName },
    release: releaseMetadata(),
    spotify: await spotifyStatus(profile),
    ollama: ollamaCloudStatus(),
  }, { headers: { "cache-control": "no-store" } });
}
