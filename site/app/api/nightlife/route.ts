import { getChatGPTUser } from "../../chatgpt-auth";
import { loadProjection } from "../../data/projection";
import { ProfileAccessError, profileScopeForUser, resolveProfile } from "../../../server/profiles";
import { NightlifeInputError, nightlifeStatus, runNightlifeQuery } from "../../../server/nightlife";
import { deploymentEnvironment } from "../../../server/release";

/**
 * Development-only inference harness.
 *
 * The product surfaces semantic enrichment inside the existing Music and
 * Overview cards; no shipped page calls this endpoint. It stays available
 * locally because exercising the decision contract by hand is useful while
 * tuning questions and thresholds, but it must not answer in a deployed
 * environment, so it 404s exactly as an unrouted path would.
 */
export function harnessEnabled() {
  return ["local", "test"].includes(deploymentEnvironment());
}

function notFound() {
  return Response.json({ error: "Not found." }, { status: 404 });
}

export const dynamic = "force-dynamic";

export async function GET() {
  if (!harnessEnabled()) return notFound();
  return Response.json({ nightlife: nightlifeStatus() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!harnessEnabled()) return notFound();

  const user = await getChatGPTUser();
  let profile = null;
  if (user) {
    try {
      profile = await resolveProfile(user);
    } catch (error) {
      if (error instanceof ProfileAccessError) throw error;
      profile = await profileScopeForUser(user);
    }
  }

  const projection = await loadProjection(profile ? { id: profile.id, allowBundledFallback: profile.legacyDefault } : null);
  if (!projection) {
    return Response.json({ error: "This profile has no active projection yet." }, { status: 409 });
  }

  try {
    const body = await request.json();
    const result = await runNightlifeQuery((projection as { events: unknown[] }).events ?? [], body);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof NightlifeInputError || error instanceof SyntaxError) {
      return Response.json({ error: (error as Error).message }, { status: 400 });
    }
    throw error;
  }
}
