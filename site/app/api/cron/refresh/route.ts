import { cronAuthorized } from "../../../../server/cron-auth.ts";
import { POST as refreshConnectedProfiles } from "../../admin/refresh/route";

export const dynamic = "force-dynamic";
// The whole refresh runs inside this one invocation. 300 seconds is the
// ceiling on Vercel's Hobby plan; if a refresh ever needs longer, the
// Cloudflare scheduler in `scheduler/` can drive `/api/admin/refresh` instead.
export const maxDuration = 300;

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET` on the
// schedule in `vercel.json`. It is one more authorized caller of the same
// protected refresh the admin route runs; it holds no logic of its own.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "www-authenticate": "Bearer", "cache-control": "no-store" } });
  }
  const refreshSecret = process.env.TASTE_REFRESH_SECRET ?? "";
  return refreshConnectedProfiles(new Request(new URL("/api/admin/refresh", request.url), {
    method: "POST",
    headers: { authorization: `Bearer ${refreshSecret}`, "content-type": "application/json" },
    body: "{}",
  }));
}
