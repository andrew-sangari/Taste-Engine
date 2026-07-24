import { runHostedRefresh, HostedRefreshConflictError } from "../../../../server/hosted-refresh";
import { hasRefreshAuthorization } from "../../../../server/persistence";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasRefreshAuthorization(request)) {
    return Response.json({ error: "Unauthorized." }, {
      status: 401,
      headers: { "www-authenticate": "Bearer", "cache-control": "no-store" },
    });
  }
  try {
    const summary = await runHostedRefresh();
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
