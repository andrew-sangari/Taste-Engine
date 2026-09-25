/**
 * Field-level provenance for one event occurrence.
 *
 * The normalized candidate is intentionally not the evidence boundary. A
 * merged row can have a title from one provider, an end time from another,
 * and no model rights for either description. Keeping facts at the occurrence
 * boundary lets the projection and the model serializer make that decision
 * without guessing after deduplication.
 */

export const EVENT_EVIDENCE_SCHEMA_VERSION = 1;

export const EVIDENCE_FIELDS = [
  'title',
  'description',
  'classification',
  'namedLineup',
  'format',
  'doorTime',
  'startTime',
  'endTime',
  'venueInfo',
  'agePolicy'
];

export const EVIDENCE_ASSERTION_KINDS = ['published-fact', 'descriptive-copy', 'derived-estimate'];
export const EVIDENCE_CONFIDENCE = ['verified', 'partial', 'unknown'];
// Insomniac remains deliberately absent until its parser is repaired and
// validated against a maintained fixture/live-response corpus.
export const PERMITTED_EVIDENCE_PROVIDERS = ['ticketmaster', 'framework'];

const DEFAULT_PERMISSION = Object.freeze({
  internalUse: true,
  display: false,
  modelInput: false,
  persist: true
});

const STRUCTURED_MODEL_FIELDS = new Set([
  'title',
  'classification',
  'namedLineup',
  'format',
  'doorTime',
  'startTime',
  'endTime',
  'venueInfo',
  'agePolicy'
]);

/**
 * Make a safe, bounded fact. Free text is sanitized and capped here so an
 * adapter cannot accidentally persist a full page or HTML fragment.
 */
export function createEvidenceFact({
  value,
  field,
  provider,
  sourceEventId = null,
  sourceUrl = null,
  retrievedAt = null,
  assertionKind = 'published-fact',
  permission = {},
  confidence = 'verified'
} = {}) {
  if (!EVIDENCE_FIELDS.includes(field)) throw new Error(`Unknown evidence field: ${field}`);
  if (!PERMITTED_EVIDENCE_PROVIDERS.includes(provider)) return null;
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  if (!EVIDENCE_ASSERTION_KINDS.includes(assertionKind)) throw new Error(`Unknown evidence assertion kind: ${assertionKind}`);
  if (!EVIDENCE_CONFIDENCE.includes(confidence)) throw new Error(`Unknown evidence confidence: ${confidence}`);

  const normalized = normalizeFactValue(value, field);
  if (normalized == null || normalized === ''
    || (Array.isArray(normalized) && normalized.length === 0)
    || (typeof normalized === 'object' && !Array.isArray(normalized) && Object.keys(normalized).length === 0)) return null;
  const rights = {
    ...DEFAULT_PERMISSION,
    ...permission
  };
  return {
    value: normalized,
    field,
    provider,
    ...(sourceEventId ? { sourceEventId: String(sourceEventId) } : {}),
    ...(sourceUrl ? { sourceUrl: String(sourceUrl) } : {}),
    ...(retrievedAt ? { retrievedAt: new Date(retrievedAt).toISOString() } : {}),
    assertionKind,
    permission: {
      internalUse: Boolean(rights.internalUse),
      display: Boolean(rights.display),
      modelInput: Boolean(rights.modelInput),
      persist: Boolean(rights.persist)
    },
    confidence
  };
}

/**
 * Build occurrence evidence and explicitly name fields that were not found.
 * `permittedFacts` contains facts that may be used internally; serializers
 * apply the display/model rights again at the final boundary.
 */
export function createEventEvidence({
  eventRef,
  provider,
  sourceEventId = null,
  sourceUrl = null,
  retrievedAt = null,
  facts = {},
  withheldOrMissing = []
} = {}) {
  const permittedFacts = {};
  for (const field of EVIDENCE_FIELDS) {
    const fact = facts[field];
    if (!fact) continue;
    const normalized = fact.field
      ? fact
      : createEvidenceFact({
        value: fact,
        field,
        provider,
        sourceEventId,
        sourceUrl,
        retrievedAt,
        permission: defaultPermissionFor(provider, field)
      });
    if (normalized) permittedFacts[field] = normalized;
  }
  const missing = new Set(withheldOrMissing.filter(Boolean));
  for (const field of EVIDENCE_FIELDS) {
    if (!permittedFacts[field]) missing.add(field);
  }
  return {
    schemaVersion: EVENT_EVIDENCE_SCHEMA_VERSION,
    ...(eventRef ? { eventRef: String(eventRef) } : {}),
    ...(provider ? { provider } : {}),
    ...(sourceEventId ? { sourceEventId: String(sourceEventId) } : {}),
    ...(sourceUrl ? { sourceUrl: String(sourceUrl) } : {}),
    ...(retrievedAt ? { retrievedAt: new Date(retrievedAt).toISOString() } : {}),
    permittedFacts,
    withheldOrMissing: [...missing]
  };
}

/**
 * Recover occurrence-level evidence from either the new `evidence` property
 * or the transitional `eventEvidence` property used by adapters.
 */
export function evidenceForOccurrence(occurrence) {
  return occurrence?.evidence ?? occurrence?.eventEvidence ?? null;
}

/**
 * Merge facts field by field. We never concatenate values from two providers
 * into one claim. The selected fact is the best permitted fact, while all
 * alternatives remain in `conflicts` for auditability.
 */
export function buildEventEvidence(candidate) {
  const evidenceItems = [];
  if (candidate?.eventEvidence) evidenceItems.push(candidate.eventEvidence);
  for (const occurrence of candidate?.sourceOccurrences ?? []) {
    const evidence = evidenceForOccurrence(occurrence);
    if (evidence) evidenceItems.push(evidence);
  }
  const facts = {};
  const conflicts = {};
  for (const evidence of evidenceItems) {
    for (const [field, fact] of Object.entries(evidence.permittedFacts ?? {})) {
      if (!fact || !fact.permission?.internalUse) continue;
      const current = facts[field];
      if (!current || factPreference(fact) > factPreference(current)) {
        if (current && !sameFactValue(current, fact)) conflicts[field] = [...(conflicts[field] ?? []), current];
        facts[field] = fact;
      } else if (!sameFactValue(current, fact)) {
        conflicts[field] = [...(conflicts[field] ?? []), fact];
      }
    }
  }
  reconcileTitleAgePolicy(facts, conflicts);
  const missing = new Set();
  for (const evidence of evidenceItems) {
    for (const field of evidence.withheldOrMissing ?? []) missing.add(field);
  }
  for (const field of EVIDENCE_FIELDS) {
    if (!facts[field]) missing.add(field);
    else missing.delete(field);
  }
  return {
    schemaVersion: EVENT_EVIDENCE_SCHEMA_VERSION,
    eventRef: candidate?.id ?? null,
    permittedFacts: facts,
    conflicts,
    withheldOrMissing: [...missing]
  };
}

/**
 * The explicit age restriction a piece of event text states, or null.
 *
 * Deliberately narrow: only an unambiguous marker such as "21+", "18 and over"
 * or "All Ages" counts. It says nothing about any other admission rule, and the
 * absence of a marker is not evidence that an event is unrestricted.
 */
export function ageRestrictionFromText(text) {
  const value = String(text ?? '');
  const plus = value.match(/(?:^|[^\d])(21|18)\s*\+/);
  if (plus) return `${plus[1]}+`;
  const over = value.match(/\b(21|18)\s*(?:and|&)\s*(?:over|up|older)\b/i);
  if (over) return `${over[1]}+`;
  if (/\ball[\s-]+ages\b/i.test(value)) return 'All ages';
  return null;
}

/**
 * A permitted title that states an age restriction is age-policy evidence, even
 * though no structured policy field was published. Without this, the absence of
 * the structured field reads as "nothing restricts entry" while the listing
 * itself says 21+.
 *
 * The derived fact keeps the title's provider, link and rights, and records
 * `derivedFrom: 'title'` so a claim built on it can say where it came from.
 * When a structured policy also exists and disagrees, both are kept and the
 * disagreement is recorded as a conflict rather than silently resolved.
 */
function reconcileTitleAgePolicy(facts, conflicts) {
  // Every permitted title counts, not only the one selected for display: two
  // providers can title the same night differently, and only one may say 21+.
  const titles = [facts.title, ...(conflicts.title ?? [])].filter(Boolean);
  const title = titles.find((fact) => ageRestrictionFromText(fact.value));
  const stated = title ? ageRestrictionFromText(title.value) : null;
  if (!stated) return;
  const derived = {
    ...title,
    field: 'agePolicy',
    value: stated,
    derivedFrom: 'title'
  };
  const policy = facts.agePolicy;
  if (!policy) {
    facts.agePolicy = derived;
    return;
  }
  const published = ageRestrictionFromText(policy.value);
  if (published && published !== stated) {
    conflicts.agePolicy = [...(conflicts.agePolicy ?? []), derived];
  }
}

/**
 * Model serializer. Source URLs and source IDs are intentionally excluded;
 * `evidenceRefs` are opaque local references suitable for diagnostics only.
 */
export function serializeEventEvidenceForModel(evidence) {
  const publishedFacts = {};
  const evidenceRefs = {};
  const knownUnknowns = new Set(evidence?.withheldOrMissing ?? []);
  for (const [field, fact] of Object.entries(evidence?.permittedFacts ?? {})) {
    if (!fact.permission?.modelInput) {
      knownUnknowns.add(field);
      continue;
    }
    publishedFacts[field] = fact.value;
    evidenceRefs[field] = opaqueEvidenceRef(evidence, field);
  }
  return {
    publishedFacts,
    evidenceRefs,
    knownUnknowns: [...knownUnknowns]
  };
}

/** Display serializer with provider links and retrieval metadata, but no
 * internal rights or restricted occurrence payloads. */
export function serializeEventEvidenceForDisplay(evidence) {
  const facts = {};
  for (const [field, fact] of Object.entries(evidence?.permittedFacts ?? {})) {
    if (!fact.permission?.display) continue;
    facts[field] = displayFact(fact);
  }
  // Disagreements between providers are display evidence too: a card must be
  // able to say "these sources disagree" instead of silently picking one.
  const conflicts = {};
  for (const [field, alternatives] of Object.entries(evidence?.conflicts ?? {})) {
    if (!facts[field]) continue;
    const visible = alternatives.filter((fact) => fact?.permission?.display).map(displayFact);
    if (visible.length) conflicts[field] = visible;
  }
  return {
    schemaVersion: EVENT_EVIDENCE_SCHEMA_VERSION,
    facts,
    ...(Object.keys(conflicts).length ? { conflicts } : {}),
    withheldOrMissing: [...new Set(evidence?.withheldOrMissing ?? [])]
  };
}

function displayFact(fact) {
  return {
    value: fact.value,
    provider: fact.provider,
    ...(fact.sourceUrl ? { sourceUrl: fact.sourceUrl } : {}),
    ...(fact.retrievedAt ? { retrievedAt: fact.retrievedAt } : {}),
    assertionKind: fact.assertionKind,
    ...(fact.derivedFrom ? { derivedFrom: fact.derivedFrom } : {}),
    confidence: fact.confidence
  };
}

// Providers emit placeholder classification values that carry no information
// about the event: Ticketmaster writes "Undefined" for an unset subgenre, and a
// promoter's own calendar tags every event with the promoter's name. Surfacing
// either as "published classification" would state a fact the source never
// made, so they are dropped at the adapter boundary.
const PLACEHOLDER_CLASSIFICATIONS = new Set([
  'undefined',
  'unknown',
  'uncategorized',
  'uncategorised',
  'other',
  'general',
  'miscellaneous',
  'misc',
  'events',
  'event',
  'n/a',
  'none'
]);

export function meaningfulClassifications(values = [], { provider = null } = {}) {
  const promoter = String(provider ?? '').trim().toLowerCase();
  const output = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const normalized = text.toLowerCase();
    if (PLACEHOLDER_CLASSIFICATIONS.has(normalized)) continue;
    // A promoter tagging its own calendar with its own name describes who
    // published the event, not what the event is.
    if (promoter && normalized === promoter) continue;
    if (!output.some((existing) => existing.toLowerCase() === normalized)) output.push(text);
  }
  return output;
}

export function defaultPermissionFor(provider, field) {
  // Public structured metadata is useful to the advisory layer. Descriptive
  // copy remains display/internal-only until a provider-specific rights review
  // explicitly opts it into model input.
  return {
    internalUse: true,
    display: true,
    modelInput: provider !== 'insomniac' && (STRUCTURED_MODEL_FIELDS.has(field) && field !== 'title' ? true : field === 'title'),
    persist: true
  };
}

export function summarizeEvidenceCoverage(items = []) {
  const counts = Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, 0]));
  let modelEligibleCount = 0;
  let evidenceCount = 0;
  for (const item of items) {
    const evidence = item?.eventEvidence ?? buildEventEvidence(item);
    const facts = evidence?.permittedFacts ?? {};
    if (Object.keys(facts).length) evidenceCount += 1;
    if (Object.values(facts).some((fact) => fact?.permission?.modelInput)) modelEligibleCount += 1;
    for (const field of EVIDENCE_FIELDS) {
      if (facts[field]) counts[field] += 1;
    }
  }
  const fieldCoverage = Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, {
    count: counts[field],
    rate: items.length ? Number((counts[field] / items.length).toFixed(3)) : 0
  }]));
  // Keep source-health terminology readable to operators while retaining the
  // normalized field names used by the serializers.
  for (const [alias, field] of Object.entries({ genre: 'classification', blurb: 'description', doors: 'doorTime', end: 'endTime', venuePolicy: 'agePolicy' })) {
    fieldCoverage[alias] = fieldCoverage[field];
  }
  return {
    evidenceCount,
    modelEligibleCount,
    fieldCoverage
  };
}

function normalizeFactValue(value, field) {
  if (Array.isArray(value)) {
    const values = value.flatMap((item) => Array.isArray(item) ? item : [item])
      .map((item) => normalizeFactValue(item, 'text'))
      .filter(Boolean);
    return [...new Set(values)];
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item != null && item !== '')
      .map(([key, item]) => [key, typeof item === 'string' ? cleanText(item, 500) : item]));
  }
  if (typeof value === 'string') return cleanText(value, field === 'description' ? 280 : 300);
  return value;
}

function cleanText(value, maxLength) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function factPreference(fact) {
  return (fact.confidence === 'verified' ? 3 : fact.confidence === 'partial' ? 2 : 1)
    + (fact.permission?.modelInput ? 1 : 0)
    + (fact.permission?.display ? 0.25 : 0);
}

function sameFactValue(left, right) {
  return JSON.stringify(left?.value) === JSON.stringify(right?.value);
}

function opaqueEvidenceRef(evidence, field) {
  // Do not reuse a provider-derived canonical id (for example
  // `seatgeek:123`) as an allegedly opaque reference.
  return `event/${field}`;
}
