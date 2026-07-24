import {
  hasRefreshAuthorization,
  PersistenceInputError,
  publishProjection,
  readActiveProjection,
} from "../../../../server/persistence";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasRefreshAuthorization(request)) return unauthorized();
  const projection = await readActiveProjection();
  return Response.json({ configured: projection != null, projection }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!hasRefreshAuthorization(request)) return unauthorized();
  try {
    const result = await publishProjection(await request.json());
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
