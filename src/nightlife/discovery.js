import { classifyEventType } from '../eventEnhancement.js';
import { candidateRevision } from './assessmentCache.js';
import { buildSemanticRequest } from './semanticInput.js';
import { buildEveningPlan, milesFromStart, withinWindow } from './itinerary.js';
import { windowBounds } from './context.js';

// Weights for combining atomic assessments into one nightlife score. They live
// here, in code, precisely so that changing a priority is a coefficient change
// rather than a prompt rewrite. The canonical utility score is the base and is
// never modified by any of this.
export const SEMANTIC_WEIGHTS = {
  contextFit: { strong: 18, possible: 8, exploratory: 2, poor: -25, unknown: 0 },
  musicAtmosphereFit: { strong: 10, possible: 3, weak: -8, unknown: 0 },
  lateNightWanted: { confirmed: 10, possible: 3, unlikely: -12, unknown: 0 },
  lateNightEarly: { confirmed: -4, possible: 0, unlikely: 3, unknown: 0 },
  noveltyExploratory: { exploratory: 8, adjacent: 4, familiar: -2, unknown: 0 },
  noveltyFamiliar: { exploratory: -6, adjacent: 0, familiar: 5, unknown: 0 },
  noveltyBalanced: { exploratory: 1, adjacent: 3, familiar: 1, unknown: 0 },
  friction: {
    'long-travel': -8,
    'late-start': -6,
    'group-coordination': -4,
    'schedule-unconfirmed': -3,
    'ticket-unknown': 0,
    'cost-unknown': 0
  }
};

// Below this, the honest answer is that nothing is worth the hassle. This is a
// starting value, not a tuned one: raise or lower it from what the shadow
// evaluation actually shows, via NIGHTLIFE_STAY_HOME_THRESHOLD.
export const STAY_HOME_THRESHOLD = 38;
// A dimension the model was not reasonably sure of contributes at half weight
// rather than at full strength or not at all.
const LOW_CERTAINTY_DAMPING = 0.5;

/**
 * Run one contextual nightlife query.
 *
 * Inference enriches and orders this surface only. Schedule, travel, budget and
 * window feasibility are recomputed deterministically afterwards regardless of
 * what any assessment said, and a candidate with no assessment still appears
 * with its deterministic reasoning.
 */
export async function discoverNightlife({
  events = [],
  context,
  provider,
  now = new Date(),
  refreshCache = false,
  onlyRefs = null,
  stayHomeThreshold = STAY_HOME_THRESHOLD
} = {}) {
  const inWindow = events.filter((event) => event?.startLocal && withinWindow(event, context, { now }).inWindow);
  const eligible = selectEligibleCandidates(events, context, { now });
  const { inputs } = buildSemanticRequest(eligible, context, { now });
  for (const [index, input] of inputs.entries()) {
    input.revision = candidateRevision(eligible[index]);
  }
  const candidateByRef = new Map(inputs.map((input, index) => [input.ref, eligible[index]]));

  // A criteria revision re-evaluates only the impacted candidates; the rest are
  // served from cache or from their existing assessment.
  const toAssess = onlyRefs ? inputs.filter((input) => onlyRefs.has(input.ref)) : inputs;
  const { assessments, telemetry } = await provider.assessCandidates(toAssess, context, { refreshCache });

  const scored = inputs.map((input) => {
    const candidate = candidateByRef.get(input.ref);
    const assessment = assessments.get(input.ref) ?? null;
    const gate = deterministicGate(candidate, input, context, { now });
    return {
      ref: input.ref,
      candidate,
      input,
      assessment,
      excluded: gate.excluded ? gate : null,
      score: gate.excluded ? 0 : nightlifeScore(candidate, assessment, context),
      milesFromStart: milesFromStart(candidate, context.startArea),
      travelMinutesEstimate: input.fields.travelMinutesEstimate ?? null
    };
  });

  const viable = scored
    .filter((entry) => !entry.excluded)
    .sort((left, right) => right.score - left.score || String(left.candidate.startLocal).localeCompare(String(right.candidate.startLocal)));

  const shortlistSize = context.shortlistSize ?? 4;
  const shortlist = viable.filter((entry) => entry.score >= stayHomeThreshold).slice(0, shortlistSize);
  const alternatives = viable.filter((entry) => !shortlist.includes(entry)).slice(0, shortlistSize);

  const plan = shortlist.length
    ? buildEveningPlan(shortlist.map((entry) => entry.candidate), context, {
      now,
      eventTypeFor: (candidate) => classifyEventType(candidate)
    })
    : null;

  return {
    generatedAt: new Date(now).toISOString(),
    window: windowSummary(context, { now }),
    // How the candidate set narrowed, so an empty shortlist can say whether the
    // night was thin, the window was tight, or nothing simply cleared the bar.
    considered: {
      projectionCount: events.length,
      inWindowCount: inWindow.length,
      assessedCount: eligible.length,
      // How many candidates carry independently permitted evidence. A low
      // number here is a source-policy fact, not a model failure, and it caps
      // how much any assessment can say.
      permittedEvidenceCount: inputs.filter((input) => !input.restricted).length,
      stayHomeThreshold
    },
    stayHome: shortlist.length === 0,
    stayHomeReason: shortlist.length ? null : stayHomeReason(scored, eligible),
    shortlist: shortlist.map(toResult),
    alternatives: alternatives.map(toResult),
    excluded: scored.filter((entry) => entry.excluded).map((entry) => ({
      ref: entry.ref,
      id: entry.candidate.id,
      reason: entry.excluded.reason
    })),
    plan: plan ? summarizePlan(plan, candidateByRef, scored) : null,
    inference: {
      status: telemetry.status,
      provider: telemetry.provider,
      model: telemetry.model,
      resolvedModels: telemetry.resolvedModels,
      coverage: telemetry.coverage,
      cacheHits: telemetry.cacheHits,
      validationFailures: telemetry.validationFailures,
      errorCount: telemetry.errors.length,
      latencyMsMedian: telemetry.latencyMsMedian,
      totalMs: telemetry.totalMs,
      costUsd: telemetry.costUsd,
      costPerAssessedCandidateUsd: telemetry.costPerAssessedCandidateUsd,
      schemaVersion: telemetry.schemaVersion,
      questionSetVersion: telemetry.questionSetVersion
    },
    telemetry,
    // Refs are stable within one result, so a criteria revision can name the
    // candidates it needs re-evaluated rather than regenerating the whole set.
    refIndex: Object.fromEntries(inputs.map((input) => [input.ref, candidateByRef.get(input.ref).id]))
  };
}

/** Hard filters, applied before anything is serialized or sent anywhere. */
export function selectEligibleCandidates(events, context, { now = new Date() } = {}) {
  const maxCandidates = context.maxCandidates ?? 24;
  return events
    .filter((event) => event?.startLocal)
    .filter((event) => withinWindow(event, context, { now }).inWindow)
    .sort((left, right) => (right.ranking?.utility ?? 0) - (left.ranking?.utility ?? 0))
    .slice(0, maxCandidates);
}

/**
 * Deterministic exclusions. These are facts, so they are decided here and the
 * model is never asked and never consulted about them.
 */
export function deterministicGate(candidate, input, context, { now = new Date() } = {}) {
  const window = withinWindow(candidate, context, { now });
  if (!window.inWindow) return { excluded: true, reason: window.reason ?? 'outside the requested window' };

  const price = input.fields.advertisedPriceUsd;
  if (context.budgetUsd != null && Number.isFinite(price) && price > context.budgetUsd) {
    return { excluded: true, reason: `listed entry is over the $${context.budgetUsd} budget` };
  }
  return { excluded: false, reason: null };
}

/**
 * Composite score: deterministic utility, adjusted by the atomic assessments.
 * With no assessment the deterministic score stands on its own, which is what
 * makes per-candidate inference failure survivable.
 */
export function nightlifeScore(candidate, assessment, context) {
  const base = Number(candidate.ranking?.utility ?? 0);
  if (!assessment) return round(base);

  let adjustment = 0;
  adjustment += weighted(SEMANTIC_WEIGHTS.contextFit, assessment.contextFit, assessment.certainty?.contextFit);
  adjustment += weighted(SEMANTIC_WEIGHTS.musicAtmosphereFit, assessment.musicAtmosphereFit, assessment.certainty?.musicAtmosphereFit);

  const wantsLate = ['out late', 'out very late'].includes(context.lateNightIntent);
  const wantsEarly = context.lateNightIntent === 'home early';
  if (wantsLate || wantsEarly) {
    const table = wantsLate ? SEMANTIC_WEIGHTS.lateNightWanted : SEMANTIC_WEIGHTS.lateNightEarly;
    adjustment += weighted(table, assessment.lateNightFit, assessment.certainty?.lateNightFit);
  }

  const noveltyTable = context.noveltyAppetite === 'exploratory'
    ? SEMANTIC_WEIGHTS.noveltyExploratory
    : context.noveltyAppetite === 'familiar'
      ? SEMANTIC_WEIGHTS.noveltyFamiliar
      : SEMANTIC_WEIGHTS.noveltyBalanced;
  adjustment += weighted(noveltyTable, assessment.novelty, assessment.certainty?.novelty);

  for (const flag of assessment.frictionFlags ?? []) {
    adjustment += SEMANTIC_WEIGHTS.friction[flag] ?? 0;
  }

  return round(Math.max(0, Math.min(100, base + adjustment)));
}

function weighted(table, value, certainty) {
  const weight = table[value] ?? 0;
  return certainty === 'moderate' ? weight * LOW_CERTAINTY_DAMPING : weight;
}

function toResult(entry) {
  const { candidate, assessment, input } = entry;
  const permitted = (candidate.sourceOccurrences ?? []).filter((occurrence) => occurrence.sourceUrl);
  return {
    ref: entry.ref,
    id: candidate.id,
    title: input.restricted ? null : candidate.title,
    restrictedSource: input.restricted,
    startLocal: candidate.startLocal,
    timeTbd: Boolean(candidate.timeTbd),
    venue: input.restricted ? null : { name: candidate.venue?.name ?? null, city: candidate.venue?.city ?? null },
    neighborhood: input.fields.neighborhood ?? null,
    eventType: input.fields.eventType,
    score: entry.score,
    deterministicUtility: Number(candidate.ranking?.utility ?? 0),
    milesFromStart: entry.milesFromStart,
    travelMinutesEstimate: entry.travelMinutesEstimate,
    advertisedPriceUsd: input.fields.advertisedPriceUsd ?? null,
    // Verified facts, inferred fit, and unknowns are kept in separate fields so
    // the surface can render them as different kinds of claim.
    assessment: assessment
      ? {
        contextFit: assessment.contextFit,
        musicAtmosphereFit: assessment.musicAtmosphereFit,
        lateNightFit: assessment.lateNightFit,
        novelty: assessment.novelty,
        frictionFlags: assessment.frictionFlags,
        certainty: assessment.certainty,
        reason: assessment.reason,
        evidenceRefs: assessment.evidenceRefs,
        cached: Boolean(assessment.cached)
      }
      : null,
    inferenceCovered: Boolean(assessment),
    unknowns: input.fields.knownUnknowns ?? [],
    sourceLinks: [...new Map(permitted.map((occurrence) => [
      `${occurrence.source}|${occurrence.sourceUrl}`,
      { source: occurrence.source, url: occurrence.sourceUrl }
    ])).values()]
  };
}

function summarizePlan(plan, candidateByRef, scored) {
  const byId = new Map(scored.map((entry) => [entry.candidate.id, entry]));
  return {
    // A plan is an option. Nothing here books, holds, or guarantees admission.
    confirmed: Boolean(plan.confirmed),
    feasible: Boolean(plan.feasible),
    travelMinutesTotal: plan.travelMinutesTotal,
    issues: plan.issues,
    stops: plan.stops.map((stop) => {
      const entry = byId.get(stop.candidateId);
      return {
        id: stop.candidateId,
        ref: entry?.ref ?? null,
        title: entry?.input?.restricted ? null : entry?.candidate?.title ?? null,
        // Wall-clock, matching every other timestamp in the projection. An
        // ISO/UTC string here would render as the wrong hour in the browser,
        // which reads these as Los Angeles local times.
        startLocal: wallClock(stop.timing.start),
        timeKnown: stop.timing.timeKnown,
        assumedEndLocal: wallClock(stop.timing.end),
        endIsAssumed: true,
        transferMinutes: stop.transferMinutes
      };
    })
  };
}

function stayHomeReason(scored, eligible) {
  if (!eligible.length) return 'Nothing in the permitted sources falls inside that window.';
  if (scored.every((entry) => entry.excluded)) return 'Everything in that window was ruled out by your own constraints.';
  return 'Nothing cleared the bar for the night you described. Staying in is the honest call.';
}

function windowSummary(context, { now }) {
  const { start, end } = windowBounds(context, { now });
  return { date: context.window?.date ?? null, start: start.toISOString(), end: end.toISOString() };
}

function round(value) {
  return Number(value.toFixed(1));
}

function wallClock(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
