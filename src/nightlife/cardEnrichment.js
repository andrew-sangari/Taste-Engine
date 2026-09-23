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
  maxCandidates = 24
} = {}) {
  const required = new Set(requiredIds.map(String));
  const ordered = [...events].sort((left, right) => {
    const requiredDelta = Number(required.has(String(right.id))) - Number(required.has(String(left.id)));
    return requiredDelta || Number(right.ranking?.utility ?? 0) - Number(left.ranking?.utility ?? 0);
  });
  const selected = ordered.slice(0, Math.max(required.size, maxCandidates));
  const { inputs } = buildSemanticRequest(selected, {}, { now });
  inputs.forEach((input, index) => { input.revision = candidateRevision(selected[index]); });
  const modelEligibleCandidateCount = inputs.filter((input) => Object.keys(buildQuestionSet({ input })).length > 0).length;

  const result = provider
    ? await provider.assessCandidates(inputs, {})
    : { assessments: new Map(), telemetry: { status: 'not configured', coverage: { requested: inputs.length, covered: 0, uncovered: inputs.map((input) => input.ref) } } };
  const assessmentById = new Map();
  inputs.forEach((input, index) => {
    const assessment = result.assessments.get(input.ref) ?? null;
    if (assessment) assessmentById.set(String(selected[index].id), assessment);
  });

  const byId = new Map();
  for (const event of events) {
    const insight = buildSemanticEventInsight(event, assessmentById.get(String(event.id)) ?? null);
    if (insight) byId.set(String(event.id), insight);
  }
  return {
    byId,
    assessmentById,
    assessedCandidateCount: assessmentById.size,
    enrichedCandidateCount: byId.size,
    modelEligibleCandidateCount,
    selectedCandidateCount: selected.length,
    telemetry: result.telemetry
  };
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
      // Source health is published, so a failure message carries no URL at all:
      // a provider error can echo an endpoint, and host and path are enough to leak.
      ...(enrichment.failed ? { failure: redactUrls(enrichment.telemetry?.errors?.[0] ?? 'enrichment failed') } : {})
    }
  };
}

function redactUrls(message) {
  return String(message).replace(/https?:\/\/\S+/g, '[URL REDACTED]');
}
