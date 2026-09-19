import { getChatGPTUser } from "../../../chatgpt-auth";
import { HostedRefreshConflictError, runHostedRefresh } from "../../../../server/hosted-refresh";
import { resolveProfile } from "../../../../server/profiles";
import { releasePublicationReady } from "../../../../server/release";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!releasePublicationReady()) {
    return Response.json({ error: "This source artifact is not eligible to publish." }, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  try {
    const summary = await runHostedRefresh(await resolveProfile(user));
    return Response.json(summary, {
      status: summary.status === "blocked" ? 409 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HostedRefreshConflictError) {
      return Response.json({ error: error.message }, {
        status: 409,
        headers: { "cache-control": "no-store", "retry-after": "60" },
      });
    }
    throw error;
  }
}
