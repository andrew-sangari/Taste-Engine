import { candidateRevision } from './assessmentCache.js';
import { buildSemanticEventInsight } from './cardInsight.js';
import { buildSemanticRequest } from './semanticInput.js';
import { buildQuestionSet } from './questions.js';

/**
 * Assess a bounded refresh-time shortlist and compose display-safe card data.
 * This never changes candidate ordering, scores, eligibility, or source facts.
 */
export async function enrichSemanticEventCards(events = [], {
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
