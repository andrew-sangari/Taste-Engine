import {
  hasRefreshAuthorization,
  PersistenceInputError,
  publishProjection,
  readActiveProjection,
} from "../../../../server/persistence";
import { readProfile } from "../../../../server/profiles";
import { releasePublicationReady } from "../../../../server/release";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasRefreshAuthorization(request)) return unauthorized();
  const profileId = new URL(request.url).searchParams.get("profileId") ?? "";
  const profile = await readProfile(profileId).catch(() => null);
  if (!profile) return Response.json({ error: "A valid profileId is required." }, { status: 400 });
  const projection = await readActiveProjection(profile.id);
  return Response.json({ configured: projection != null, projection }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!hasRefreshAuthorization(request)) return unauthorized();
  if (!releasePublicationReady()) {
    return Response.json({ error: "This source artifact is not eligible to publish." }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  try {
    const body = await request.json() as { profileId?: unknown; projection?: unknown };
    const profile = await readProfile(String(body.profileId ?? "")).catch(() => null);
    if (!profile) return Response.json({ error: "A valid profileId is required." }, { status: 400 });
    const result = await publishProjection(profile.id, body.projection);
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof PersistenceInputError || error instanceof SyntaxError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

function unauthorized() {
  return Response.json({ error: "Unauthorized." }, {
    status: 401,
    headers: { "www-authenticate": "Bearer", "cache-control": "no-store" },
  });
}
