import {
  buildEventEvidence,
  serializeEventEvidenceForModel
} from '../eventEvidence.js';

// v3: event evidence only. The goal-driven request context, coarse areas,
// travel estimates, prices and the discovery tier are gone with the retired
// harness; nothing about the user or the request can be serialized.
export const SEMANTIC_INPUT_SCHEMA_VERSION = 3;

// Providers whose facts may be model input. SeatGeek is deliberately absent:
// a SeatGeek-only candidate contributes nothing. EDMTrain is enrichment-only and
// never appears here. Insomniac remains excluded until its live extractor passes
// the independent verification gate; parser-shaped fixture data is not
// production evidence.
export const PERMITTED_EVIDENCE_PROVIDERS = ['ticketmaster', 'framework'];

// Field-level provenance. Every field the serializer can emit declares where its
// value came from, so a leak is a test failure rather than a code review guess.
export const FIELD_PROVENANCE = {
  ref: 'derived',
  publishedFacts: 'permitted-provider',
  knownUnknowns: 'derived'
};

// Anything matching these keys or values must never reach a provider. The guard
// below runs on the serialized payload as defence in depth behind the allowlist.
const RESTRICTED_KEY = /(?:seatgeek|spotify|edmtrain|playlist|affinity|seed.?strength|top.?artists|matched.?artists|top.?tags|personal.?context|feedback|lastfm.?similar|api.?key|token|secret)/i;
const RESTRICTED_VALUE = /(?:seatgeek\.com|open\.spotify\.com|edmtrain\.com|api\.seatgeek|spotify:artist)/i;

export class SourcePolicyError extends Error {}

/**
 * Build the model input for one canonical candidate: the permitted,
 * model-transmittable event facts and the fields known to be missing.
 *
 * It reads the candidate's merged field-level evidence and nothing else — not
 * its canonical title or venue (which may be SeatGeek's), not its artist
 * matches, not its ranking. A candidate with no permitted facts produces an
 * input with no `publishedFacts`; it composes no questions and is never sent.
 *
 * Withheld evidence is named in `knownUnknowns`; it is never replaced by a
 * negative value, because "we may not tell you this" and "this is bad" are
 * different facts.
 */
export function buildSemanticCandidateInput(candidate, { ref } = {}) {
  if (!ref) throw new SourcePolicyError('A candidate input requires an opaque ref.');
  const evidence = permittedOnly(buildEventEvidence(candidate));
  const serialized = serializeEventEvidenceForModel(evidence);
  const publishedFacts = serialized.publishedFacts ?? {};
  const restricted = Object.keys(publishedFacts).length === 0;

  const fields = { ref };
  if (!restricted) fields.publishedFacts = publishedFacts;
  fields.knownUnknowns = [...new Set([...eventUnknowns(publishedFacts), ...serialized.knownUnknowns])];

  const input = {
    ref,
    restricted,
    fields,
    evidenceRefs: Object.keys(publishedFacts).map((field) => `${ref}/publishedFacts/${field}`)
  };
  assertFieldProvenance(fields);
  return input;
}

/**
 * Serialize a whole request. `inputs` stays index-aligned with `candidates`;
 * `payload` is exactly what an adapter may transmit, and it holds only the
 * candidates that have permitted facts to ask about.
 */
export function buildSemanticRequest(candidates) {
  const inputs = candidates.map((candidate, index) => buildSemanticCandidateInput(candidate, { ref: `cand-${index + 1}` }));
  const payload = {
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    candidates: inputs.filter((input) => !input.restricted).map(eventState)
  };
  assertNoRestrictedEvidence(payload);
  return { payload, inputs };
}

/** The System One `state` for one candidate. */
export function eventState(input) {
  return {
    event: {
      ref: input.ref,
      published: input.fields.publishedFacts ?? {},
      missing: input.fields.knownUnknowns ?? []
    }
  };
}

/**
 * Defence in depth. Called immediately before transmission by every adapter.
 */
export function assertNoRestrictedEvidence(payload) {
  walk(payload, []);
  return payload;

  function walk(value, path) {
    if (typeof value === 'string') {
      if (RESTRICTED_VALUE.test(value)) {
        throw new SourcePolicyError(`Restricted source evidence reached the model payload at ${path.join('.') || 'root'}.`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, [...path, String(index)]));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (RESTRICTED_KEY.test(key)) {
        throw new SourcePolicyError(`Restricted field "${key}" reached the model payload at ${[...path, key].join('.')}.`);
      }
      walk(entry, [...path, key]);
    }
  }
}

export function assertFieldProvenance(fields) {
  for (const key of Object.keys(fields)) {
    if (!FIELD_PROVENANCE[key]) {
      throw new SourcePolicyError(`Field "${key}" has no declared provenance and may not be serialized.`);
    }
  }
}

// A second, independent provider check behind the evidence layer's own gate.
function permittedOnly(evidence) {
  const permittedFacts = Object.fromEntries(Object.entries(evidence?.permittedFacts ?? {})
    .filter(([, fact]) => PERMITTED_EVIDENCE_PROVIDERS.includes(fact?.provider)));
  return { ...evidence, permittedFacts };
}

function eventUnknowns(publishedFacts) {
  const unknowns = [];
  // A venue's real closing hour remains unknown even when an event publishes
  // an end time. An event end is evidence about that event only.
  if (!publishedFacts.endTime) unknowns.push('end-time');
  unknowns.push('closing-hours', 'after-hours');
  if (!publishedFacts.namedLineup) unknowns.push('lineup');
  if (!publishedFacts.classification) unknowns.push('genre');
  if (!publishedFacts.agePolicy) unknowns.push('age-policy');
  unknowns.push('ticket-availability');
  return unknowns;
}
