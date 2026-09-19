import { getChatGPTUser } from "../../chatgpt-auth";
import { loadProjection } from "../../data/projection";
import { ProfileAccessError, profileScopeForUser, resolveProfile } from "../../../server/profiles";
import { NightlifeInputError, nightlifeStatus, runNightlifeQuery } from "../../../server/nightlife";
import { deploymentEnvironment } from "../../../server/release";

// The page already renders the bundled projection unauthenticated when
// TASTE_ENGINE_ENV is local or test, so this tab is inspectable in local dev.
// This keeps the route consistent with it rather than 401ing the one request
// the page needs. Production never sets that variable to local or test, so the
// branch cannot be reached there.
export function localInspectionAllowed() {
  return ["local", "test"].includes(deploymentEnvironment());
}

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user && !localInspectionAllowed()) {
    return Response.json({ error: "Sign in with ChatGPT." }, { status: 401 });
  }
  return Response.json({ nightlife: nightlifeStatus() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user && !localInspectionAllowed()) {
    return Response.json({ error: "Sign in with ChatGPT to plan a night out." }, { status: 401 });
  }

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
