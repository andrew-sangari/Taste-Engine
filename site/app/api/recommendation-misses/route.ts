import { crossSiteRejection } from "../../../server/request-guard";
import { getSignedInUser } from "../../auth.ts";
import { classifyRecommendationMiss, createRecommendationMiss, RecommendationMissInputError, sourceReviewCandidates } from "../../../server/recommendation-misses";
import { resolveProfile } from "../../../server/profiles";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossSite = crossSiteRejection(request);
  if (crossSite) return crossSite;
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to submit a missed recommendation." }, { status: 401 });
  try {
    const miss = await createRecommendationMiss(await resolveProfile(user), await request.json());
    return Response.json({ ok: true, miss }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RecommendationMissInputError || error instanceof SyntaxError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function GET() {
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to inspect missed recommendations." }, { status: 401 });
  return Response.json({ sourceReviewCandidates: await sourceReviewCandidates(await resolveProfile(user)) }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const crossSite = crossSiteRejection(request);
  if (crossSite) return crossSite;
  const user = await getSignedInUser();
  if (!user) return Response.json({ error: "Sign in to classify missed recommendations." }, { status: 401 });
  try {
    return Response.json({ ok: true, miss: await classifyRecommendationMiss(await resolveProfile(user), await request.json()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RecommendationMissInputError || error instanceof SyntaxError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
