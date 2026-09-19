import {
  createAssessmentCache,
  createDecisionInferenceProvider,
  describeNightlifeConfig,
  discoverNightlife,
  normalizeNightlifeContext,
  readNightlifeConfig,
  refsToReassess,
  reviseCriteria,
} from "./deterministic-engine.js";

export type NightlifeRequest = {
  goal?: string;
  date?: string;
  earliestStart?: string;
  latestReturn?: string;
  startArea?: string;
  transport?: string;
  budgetUsd?: number;
  party?: string;
  preferredMusic?: string[];
  energy?: string;
  lateNightIntent?: string;
  noveltyAppetite?: string;
  shortlistSize?: number;
  // A revision carries the previous context and its ref index so only the
  // candidates a change actually touches are re-evaluated.
  previous?: { context: Record<string, unknown>; refIndex: Record<string, string> } | null;
};

export class NightlifeInputError extends Error {}

// The engine bundle is plain JavaScript, so TypeScript infers its parameter
// types from default values (`events = []` becomes `never[]`). This states the
// contract the module actually has; it is asserted in one place rather than
// cast at every call.
type DiscoverNightlife = (options: {
  events: unknown[];
  context: unknown;
  provider: unknown;
  now?: Date;
  refreshCache?: boolean;
  onlyRefs?: Set<string> | null;
  stayHomeThreshold?: number;
}) => Promise<Record<string, unknown>>;

const discover = discoverNightlife as unknown as DiscoverNightlife;

// Assessments are cached across requests in one isolate so a criteria revision
// re-sends only what changed. The cache key already binds the candidate
// revision, the policy-safe input, the question set version and the route, so a
// stale entry cannot outlive the facts it was made from.
const assessmentCache = createAssessmentCache({ maxEntries: 400 });

export function nightlifeStatus() {
  return describeNightlifeConfig(readNightlifeConfig(process.env));
}

/**
 * Run one nightlife query against the active projection.
 *
 * Inference enriches this surface only: it never touches the canonical
 * projection, the utility score, publication eligibility, or the taste profile.
 * When inference is unavailable the deterministic shortlist still renders.
 */
export async function runNightlifeQuery(
  events: unknown[],
  request: NightlifeRequest,
  { now = new Date() }: { now?: Date } = {},
) {
  const config = readNightlifeConfig(process.env);
  const provider = createDecisionInferenceProvider(config, { cache: assessmentCache });

  let context;
  let revision: { changed: string[]; reassessAll: boolean; deterministicOnly: boolean } | null = null;
  try {
    if (request.previous?.context) {
      const outcome = reviseCriteria(request.previous.context, request, { now });
      context = outcome.context;
      revision = { changed: outcome.changed, reassessAll: outcome.reassessAll, deterministicOnly: outcome.deterministicOnly };
    } else {
      context = normalizeNightlifeContext(request, { now });
    }
  } catch (error) {
    throw new NightlifeInputError((error as Error).message);
  }

  const onlyRefs = revision && request.previous?.refIndex
    ? refsToReassess({ refIndex: request.previous.refIndex, shortlist: [], alternatives: [] }, revision)
    : null;

  const result = await discover({
    events,
    context,
    provider,
    now,
    onlyRefs,
    ...(config.stayHomeThreshold != null ? { stayHomeThreshold: config.stayHomeThreshold } : {}),
  });

  return {
    ...publicResult(result),
    revision,
    // Returned so the client can send it back with the next revision.
    context,
  };
}

/**
 * Strip the surface down to what the page may render.
 *
 * Raw probabilities and per-call errors stay server-side: they are
 * provider-scoped diagnostics, not calibrated numbers to show a reader.
 */
function publicResult(result: Record<string, unknown>) {
  const inference = result.inference as Record<string, unknown>;
  return {
    generatedAt: result.generatedAt,
    window: result.window,
    considered: result.considered,
    stayHome: result.stayHome,
    stayHomeReason: result.stayHomeReason,
    shortlist: result.shortlist,
    alternatives: result.alternatives,
    excluded: result.excluded,
    plan: result.plan,
    refIndex: result.refIndex,
    inference: {
      status: inference.status,
      provider: inference.provider,
      model: inference.model,
      coverage: inference.coverage,
      questionSetVersion: inference.questionSetVersion,
      schemaVersion: inference.schemaVersion,
    },
  };
}
