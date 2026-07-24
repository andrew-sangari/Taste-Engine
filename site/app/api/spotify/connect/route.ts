import { getChatGPTUser } from "../../../chatgpt-auth";
import { createSpotifyConnectUrl, SpotifyInputError } from "../../../../server/spotify";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.redirect(new URL("/signin-with-chatgpt?return_to=%2F%23taste", request.url));
  try {
    return Response.redirect(await createSpotifyConnectUrl(user.email, new URL(request.url).origin));
  } catch (error) {
    if (error instanceof SpotifyInputError) return Response.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
