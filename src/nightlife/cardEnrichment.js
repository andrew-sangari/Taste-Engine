import { candidateRevision } from './assessmentCache.js';
import { buildSemanticEventInsight } from './cardInsight.js';
import { buildSemanticRequest } from './semanticInput.js';
import { buildQuestionSet } from './questions.js';
import { sanitizeErrorMessage } from '../diagnostics.js';

/**
 * Assess a bounded refresh-time shortlist and compose display-safe card data.
 * This never changes candidate ordering, scores, eligibility, or source facts.
 *
 * It also never throws. Enrichment is advisory, so any failure — including a
 * source-policy guard refusing to serialize a candidate — degrades to "no
 * enrichment this run" and is reported through source health. It must never
 * abort a refresh and block publication of otherwise valid deterministic cards.
 */
export async function enrichSemanticEventCards(events = [], options = {}) {
  try {
    return await enrichOrThrow(events, options);
  } catch (error) {
    return {
      byId: new Map(),
      assessmentById: new Map(),
      assessedCandidateCount: 0,
      enrichedCandidateCount: 0,
      modelEligibleCandidateCount: 0,
      selectedCandidateCount: 0,
      contributions: emptyContributions(),
      failed: true,
      telemetry: {
        status: 'enrichment failed',
        errors: [sanitizeErrorMessage(error)],
        coverage: { requested: 0, covered: 0, uncovered: [] }
      }
    };
  }
}

async function enrichOrThrow(events = [], {
  provider,
  now = new Date(),
  requiredIds = [],
  maxCandidates = 24,
  // Profile-scoped preference signals (the public taste-profile block). They
  // are compared locally after inference and never enter a model request or
  // the event-level assessment cache.
  preferences = null
} = {}) {
  const required = new Set(requiredIds.map(String));
  const ordered = [...events].sort((left, right) => {
    const requiredDelta = Number(required.has(String(right.id))) - Number(required.has(String(left.id)));
    return requiredDelta || Number(right.ranking?.utility ?? 0) - Number(left.ranking?.utility ?? 0);
  });
  // The call budget is spent only on candidates that have something to ask
  // about. A candidate with no model-eligible evidence composes no questions
  // and would never be called, so letting it hold a slot only starves an
  // eligible candidate further down. The cap itself is unchanged.
  const { inputs: allInputs } = buildSemanticRequest(ordered, {}, { now });
  const eligible = ordered
    .map((candidate, index) => ({ candidate, input: allInputs[index] }))
    .filter(({ input }) => Object.keys(buildQuestionSet({ input })).length > 0);
  const budget = Math.max(required.size, maxCandidates);
  const chosen = eligible.slice(0, budget);
  const selected = chosen.map(({ candidate }) => candidate);
  const inputs = chosen.map(({ input }) => input);
  inputs.forEach((input, index) => { input.revision = candidateRevision(selected[index]); });
  const modelEligibleCandidateCount = inputs.length;
  const eligibleBeyondBudget = eligible.length - chosen.length;

  const result = provider
    ? await provider.assessCandidates(inputs, {})
    : { assessments: new Map(), telemetry: { status: 'not configured', coverage: { requested: inputs.length, covered: 0, uncovered: inputs.map((input) => input.ref) } } };
  const assessmentById = new Map();
  inputs.forEach((input, index) => {
    const assessment = result.assessments.get(input.ref) ?? null;
    if (assessment) assessmentById.set(String(selected[index].id), assessment);
  });

  const byId = new Map();
  const contributions = emptyContributions();
  for (const event of events) {
    const assessment = assessmentById.get(String(event.id)) ?? null;
    const insight = buildSemanticEventInsight(event, assessment, { preferences });
    if (!insight) continue;
    byId.set(String(event.id), insight);
    countContributions(contributions, insight);
  }
  return {
    byId,
    assessmentById,
    assessedCandidateCount: assessmentById.size,
    enrichedCandidateCount: byId.size,
    modelEligibleCandidateCount,
    eligibleBeyondBudget,
    selectedCandidateCount: selected.length,
    contributions,
    telemetry: result.telemetry
  };
}

/**
 * What actually reached the cards, by where it came from. Deterministic source
 * extraction and model-derived characterization are counted separately so a
 * card enriched only by a published end time is never credited to Jev.
 */
function emptyContributions() {
  return { documentedClaims: 0, modelDerivedClaims: 0, personalClaims: 0, uncertaintyClaims: 0, cardsWithModelDerivedClaim: 0, cardsWithPersonalClaim: 0 };
}

function countContributions(totals, insight) {
  let model = false;
  let personal = false;
  for (const kind of insight.claimOrder ?? []) {
    const claim = insight[kind];
    if (!claim) continue;
    if (claim.basis === 'calculated-match') {
      totals.personalClaims += 1;
      personal = true;
      if (claim.eventBasis === 'model-characterization') model = true;
    } else if (claim.basis === 'model-characterization') {
      totals.modelDerivedClaims += 1;
      model = true;
    } else if (claim.basis === 'documented-attribute') {
      totals.documentedClaims += 1;
    } else {
      totals.uncertaintyClaims += 1;
    }
  }
  if (model) totals.cardsWithModelDerivedClaim += 1;
  if (personal) totals.cardsWithPersonalClaim += 1;
}

/**
 * The `jev-events` source-health row, shared by the local export and the hosted
 * refresh so the two cannot drift.
 *
 * Status follows the same contract as every other source: a missing credential
 * is `not configured`, not a failure. A candidate with no model-eligible
 * evidence has nothing to ask, so it does not count against coverage; only a
 * candidate that was eligible and still went unassessed is a real gap.
 */
export function semanticSourceHealth(enrichment) {
  const eligible = enrichment.modelEligibleCandidateCount ?? 0;
  const assessed = enrichment.assessedCandidateCount ?? 0;
  const inferenceStatus = enrichment.telemetry?.status;
  let status;
  if (enrichment.failed) status = 'unavailable';
  else if (inferenceStatus === 'not configured') status = 'not configured';
  else if (eligible === 0 || assessed >= eligible) status = 'active';
  else if (assessed > 0) status = 'partial';
  else status = 'unavailable';
  return {
    source: 'jev-events',
    status,
    itemCount: enrichment.enrichedCandidateCount ?? 0,
    warningCount: Math.max(0, eligible - assessed),
    details: {
      evidenceCount: enrichment.enrichedCandidateCount ?? 0,
      modelEligibleCount: eligible,
      assessedCount: assessed,
      modelDerivedCardCount: enrichment.contributions?.cardsWithModelDerivedClaim ?? 0,
      personalMatchCardCount: enrichment.contributions?.cardsWithPersonalClaim ?? 0,
      eligibleBeyondBudget: enrichment.eligibleBeyondBudget ?? 0,
      // Source health is published, so a failure message carries no URL at all:
      // a provider error can echo an endpoint, and host and path are enough to leak.
      ...(enrichment.failed ? { failure: redactUrls(enrichment.telemetry?.errors?.[0] ?? 'enrichment failed') } : {})
    }
  };
}

function redactUrls(message) {
  return String(message).replace(/https?:\/\/\S+/g, '[URL REDACTED]');
}
