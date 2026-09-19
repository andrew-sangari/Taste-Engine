import { getChatGPTUser } from "../../../chatgpt-auth";
import { PersistenceInputError, readFeedbackState, writeFeedbackState } from "../../../../server/persistence";
import { resolveProfile } from "../../../../server/profiles";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to load durable feedback." }, { status: 401 });
  return Response.json({ store: await readFeedbackState(await resolveProfile(user)) }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to save durable feedback." }, { status: 401 });
  try {
    const state = await request.json();
    const updatedAt = await writeFeedbackState(await resolveProfile(user), state);
    return Response.json({ ok: true, updatedAt }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PersistenceInputError || error instanceof SyntaxError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
