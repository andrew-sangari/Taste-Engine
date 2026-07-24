import { getChatGPTUser } from "../../chatgpt-auth";
import { classifyRecommendationMiss, createRecommendationMiss, RecommendationMissInputError, sourceReviewCandidates } from "../../../server/recommendation-misses";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to submit a missed recommendation." }, { status: 401 });
  try {
    const miss = await createRecommendationMiss(user.email, await request.json());
    return Response.json({ ok: true, miss }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RecommendationMissInputError || error instanceof SyntaxError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to inspect missed recommendations." }, { status: 401 });
  return Response.json({ sourceReviewCandidates: await sourceReviewCandidates(user.email) }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to classify missed recommendations." }, { status: 401 });
  try {
    return Response.json({ ok: true, miss: await classifyRecommendationMiss(user.email, await request.json()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RecommendationMissInputError || error instanceof SyntaxError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
