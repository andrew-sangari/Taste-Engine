import { classifyEventType } from '../eventEnhancement.js';
import {
  buildEventEvidence,
  serializeEventEvidenceForModel
} from '../eventEvidence.js';

export const SEMANTIC_INPUT_SCHEMA_VERSION = 2;

// Providers whose normalized fields may be named in model input. SeatGeek is
// deliberately absent: a SeatGeek-only occurrence contributes coarse derived
// timing and nothing else. EDMTrain is enrichment-only and never appears here.
// Insomniac remains excluded until its live extractor passes the independent
// verification gate; parser-shaped fixture data is not production evidence.
export const PERMITTED_EVIDENCE_PROVIDERS = ['ticketmaster', 'framework'];

// Field-level provenance. Every field the serializer can emit declares where its
// value came from, so a leak is a test failure rather than a code review guess.
export const FIELD_PROVENANCE = {
  ref: 'derived',
  eventType: 'derived',
  daysUntil: 'derived',
  dayOfWeek: 'derived',
  startPeriod: 'derived',
  startClock: 'permitted-provider',
  providerContext: 'permitted-provider',
  eventTitle: 'permitted-provider',
  venueName: 'permitted-provider',
  neighborhood: 'permitted-provider',
  city: 'permitted-provider',
  namedPerformerCount: 'permitted-provider',
  advertisedPriceUsd: 'permitted-provider',
  publishedFacts: 'permitted-provider',
  travelMinutesEstimate: 'derived',
  adjacentEvidence: 'derived',
  knownUnknowns: 'derived'
};

// Anything matching these keys or values must never reach a provider. The guard
// below runs on the serialized payload as defence in depth behind the allowlist.
const RESTRICTED_KEY = /(?:seatgeek|spotify|edmtrain|playlist|affinity|seed.?strength|top.?artists|personal.?context|feedback|lastfm.?similar|api.?key|token|secret)/i;
const RESTRICTED_VALUE = /(?:seatgeek\.com|open\.spotify\.com|edmtrain\.com|api\.seatgeek|spotify:artist)/i;

export class SourcePolicyError extends Error {}

/**
 * Build the source-safe input for one canonical candidate.
 *
 * Disallowed evidence is omitted and named in `knownUnknowns`; it is never
 * replaced by a negative value, because "we may not show you this" and "this is
 * bad" are different facts.
 */
/**
 * Decide, once, what a candidate is allowed to contribute.
 *
 * This runs where the real source occurrences exist — in the pipeline, at
 * export time — because the published projection collapses a merged occurrence
 * to one canonical row and loses which provider supplied which field. Deciding
 * provenance downstream of that would mean guessing, and guessing wrong here
 * means sending a restricted payload to a model.
 */
export function nightlifeEvidenceFor(candidate) {
  const occurrences = candidate.sourceOccurrences ?? [];
  // A projection row published before this field existed has no occurrences to
  // read. Derive what can be proven from the canonical row instead, erring
  // toward restricted whenever provenance cannot be established.
  if (!occurrences.length && Array.isArray(candidate.sources)) return evidenceFromPublishedRow(candidate);
  const sources = new Set(occurrences.map((occurrence) => occurrence.source));
  const evidence = buildEventEvidence(candidate);
  const facts = evidence.permittedFacts ?? {};
  const permittedProviders = [...new Set(Object.values(facts)
    .map((fact) => fact?.provider)
    .filter((provider) => PERMITTED_EVIDENCE_PROVIDERS.includes(provider)))];
  for (const occurrence of occurrences) {
    if (PERMITTED_EVIDENCE_PROVIDERS.includes(occurrence.source)) permittedProviders.push(occurrence.source);
  }
  const uniquePermittedProviders = [...new Set(permittedProviders)];
  const permitted = occurrences.find((occurrence) => uniquePermittedProviders.includes(occurrence.source)) ?? null;
  const venueFact = facts.venueInfo?.value;
  const venue = permitted?.venue ?? (venueFact && typeof venueFact === 'object' ? venueFact : null);
  const title = facts.title?.value ?? permitted?.title ?? null;
  const namedLineup = Array.isArray(facts.namedLineup?.value)
    ? facts.namedLineup.value
    : (permitted?.performerNames ?? []);
  const price = candidate.ticketObservation?.lowestPriceUsd;
  return {
    restricted: !uniquePermittedProviders.length,
    provider: uniquePermittedProviders[0] ?? permitted?.source ?? null,
    title,
    venueName: venue?.name ?? null,
    city: venue?.city ?? null,
    venuePoint: Number.isFinite(venue?.lat) && Number.isFinite(venue?.lon) ? { lat: venue.lat, lon: venue.lon } : null,
    namedPerformerCount: namedLineup.filter(Boolean).length,
    // Quoted only when no restricted provider contributed to the merged
    // ticket observation at all.
    advertisedPriceUsd: !sources.has('seatgeek') && Number.isFinite(price) ? Math.round(price) : null,
    adjacentEvidence: [...new Set((candidate.matchedArtists ?? [])
      .map((artist) => artist.origin)
      .filter((origin) => ['similar', 'tag', 'promoter'].includes(origin)))]
  };
}

/**
 * Evidence recovered from an already-published projection row.
 *
 * The published row collapses a merged occurrence to one set of canonical
 * fields chosen by source priority, which puts SeatGeek first. So a row that
 * lists SeatGeek at all is treated as restricted: its title and venue may be
 * SeatGeek's, and there is no way to tell from here. That is stricter than the
 * occurrence-level rule and intentionally so — re-export the projection to get
 * the precise decision back.
 */
function evidenceFromPublishedRow(candidate) {
  const sources = new Set(candidate.sources ?? []);
  const permitted = PERMITTED_EVIDENCE_PROVIDERS.find((source) => sources.has(source));
  const restricted = sources.has('seatgeek') || !permitted;
  const price = candidate.ticketObservation?.lowestPriceUsd;
  return {
    restricted,
    provider: restricted ? null : permitted,
    title: restricted ? null : candidate.title ?? null,
    venueName: restricted ? null : candidate.venue?.name ?? null,
    city: restricted ? null : candidate.venue?.city ?? null,
    venuePoint: !restricted && Number.isFinite(candidate.venue?.lat) && Number.isFinite(candidate.venue?.lon)
      ? { lat: candidate.venue.lat, lon: candidate.venue.lon }
      : null,
    namedPerformerCount: restricted ? 0 : (candidate.performers ?? []).filter((performer) => performer?.name).length,
    advertisedPriceUsd: !restricted && Number.isFinite(price) ? Math.round(price) : null,
    adjacentEvidence: [...new Set((candidate.matchedArtists ?? [])
      .map((artist) => artist.origin)
      .filter((origin) => ['similar', 'tag', 'promoter'].includes(origin)))]
  };
}

/** The permitted venue point, or null. The only geometry the pipeline may use. */
export function permittedVenuePoint(candidate) {
  const evidence = candidate?.nightlifeEvidence ?? (candidate ? nightlifeEvidenceFor(candidate) : null);
  return evidence?.venuePoint ?? null;
}

/**
 * Build the source-safe input for one canonical candidate.
 *
 * Disallowed evidence is omitted and named in `knownUnknowns`; it is never
 * replaced by a negative value, because "we may not show you this" and "this is
 * bad" are different facts.
 */
export function buildSemanticCandidateInput(candidate, { ref, now = new Date(), startArea = null, transport = 'drive' } = {}) {
  if (!ref) throw new SourcePolicyError('A candidate input requires an opaque ref.');
  // Prefer evidence decided at export time; fall back to deriving it when the
  // full candidate with its source occurrences is in hand.
  const evidence = candidate.nightlifeEvidence ?? nightlifeEvidenceFor(candidate);
  const fullEvidence = evidence.eventEvidence ?? buildEventEvidence(candidate);
  const serializedModelEvidence = serializeEventEvidenceForModel(fullEvidence);
  const modelPublishedFacts = evidence.publishedFacts ?? serializedModelEvidence.publishedFacts;
  const restricted = evidence.restricted;
  const start = candidate.startLocal ? new Date(candidate.startLocal) : null;
  const hasTime = Boolean(start && !Number.isNaN(start.getTime()) && !candidate.timeTbd);

  const fields = {
    ref,
    eventType: classifyEventType(candidate),
    daysUntil: daysUntil(candidate.startLocal, now),
    dayOfWeek: start ? weekday(start) : 'unknown',
    startPeriod: startPeriodFor(start, candidate.timeTbd)
  };

  // Rich evidence is carried only after field-level rights filtering. The
  // model receives values, not source URLs or provider payloads; opaque refs
  // remain available for deterministic diagnostics and cache invalidation.
  if (!restricted && Object.keys(modelPublishedFacts).length) {
    fields.publishedFacts = modelPublishedFacts;
  }

  if (!restricted) {
    // Exact clock time, venue identity, and title are only quoted when an
    // independently permitted provider supplied that occurrence.
    if (hasTime) fields.startClock = clock(start);
    fields.providerContext = evidence.provider;
    if (evidence.title) fields.eventTitle = evidence.title;
    if (evidence.venueName) fields.venueName = evidence.venueName;
    if (evidence.city) fields.city = evidence.city;
    const area = coarseArea({ city: evidence.city, ...(evidence.venuePoint ?? {}) });
    if (area) fields.neighborhood = area;
    fields.namedPerformerCount = evidence.namedPerformerCount;
    if (evidence.advertisedPriceUsd != null) fields.advertisedPriceUsd = evidence.advertisedPriceUsd;
    const travel = travelMinutes(evidence.venuePoint, startArea, transport);
    if (travel != null) fields.travelMinutesEstimate = travel;
  }

  // Discovery-tier origins are derived labels, not Spotify content: they say
  // "this reached the shortlist through a similarity or promoter path" without
  // naming any playlist, artist, rank, or affinity.
  fields.adjacentEvidence = evidence.adjacentEvidence ?? [];
  fields.knownUnknowns = [...new Set([
    ...knownUnknownsFor({ restricted, hasTime, evidence, fields }),
    ...serializedModelEvidence.knownUnknowns
  ])];

  const input = {
    ref,
    restricted,
    fields,
    evidenceRefs: [
      ...Object.keys(fields)
      .filter((key) => key !== 'ref' && key !== 'knownUnknowns')
      .filter((key) => key !== 'publishedFacts')
      .map((key) => `${ref}/${key}`),
      ...Object.keys(fields.publishedFacts ?? {}).map((field) => `${ref}/publishedFacts/${field}`)
    ]
  };
  assertFieldProvenance(fields);
  return input;
}

/**
 * Serialize a whole request. The returned object is exactly what an adapter may
 * transmit; nothing else about a candidate crosses the boundary.
 */
export function buildSemanticRequest(candidates, context, { now = new Date() } = {}) {
  const inputs = candidates.map((candidate, index) => buildSemanticCandidateInput(candidate, {
    ref: `cand-${index + 1}`,
    now,
    startArea: context?.startArea ?? null,
    transport: context?.transport ?? 'drive'
  }));
  const evidenceOnly = inputs.length > 0 && inputs.every((input) => Object.keys(input.fields?.publishedFacts ?? {}).length > 0);
  const payload = {
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    ...(evidenceOnly ? {} : { context: serializeContext(context) }),
    candidates: inputs.map((input) => {
      const { ref, restricted, fields } = input;
      if (Object.keys(fields?.publishedFacts ?? {}).length) {
        return {
          event: {
            ref,
            published: fields.publishedFacts,
            missing: fields.knownUnknowns ?? []
          }
        };
      }
      return { ref, restricted, ...omitRef(fields) };
    })
  };
  assertNoRestrictedEvidence(payload);
  return { payload, inputs };
}

/**
 * The user's stated context, reduced to the declared decision dimensions. Free
 * text is capped and carried verbatim only in `goal`; stored personal-context
 * notes and feedback history are not part of this surface at all.
 */
export function serializeContext(context = {}) {
  const output = {
    goal: cappedText(context.goal, 400),
    date: context.window?.date ?? null,
    earliestStart: context.window?.earliestStart ?? null,
    latestReturn: context.window?.latestReturn ?? null,
    startArea: context.startArea?.label ?? null,
    transport: context.transport ?? null,
    budgetUsd: Number.isFinite(context.budgetUsd) ? context.budgetUsd : null,
    party: context.party ?? null,
    preferredMusic: (context.preferredMusic ?? []).slice(0, 8).map((value) => cappedText(value, 40)),
    energy: context.energy ?? null,
    lateNightIntent: context.lateNightIntent ?? null,
    noveltyAppetite: context.noveltyAppetite ?? null
  };
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value != null && value !== ''));
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

export function evidenceRefIndex(inputs) {
  return new Map(inputs.map((input) => [input.ref, new Set(input.evidenceRefs)]));
}

export function assertFieldProvenance(fields) {
  for (const key of Object.keys(fields)) {
    if (!FIELD_PROVENANCE[key]) {
      throw new SourcePolicyError(`Field "${key}" has no declared provenance and may not be serialized.`);
    }
  }
}

function knownUnknownsFor({ restricted, hasTime, evidence, fields }) {
  const unknowns = [];
  // A venue's real closing hour remains unknown even when an event publishes
  // an end time. An event end is evidence about that event only.
  if (!fields.publishedFacts?.endTime) unknowns.push('end-time');
  unknowns.push('closing-hours', 'after-hours');
  if (!hasTime) unknowns.push('capacity');
  if (restricted || !fields.namedPerformerCount) unknowns.push('lineup');
  if (restricted) unknowns.push('genre', 'neighborhood');
  else if (!fields.publishedFacts?.classification && !fields.publishedFacts?.description) unknowns.push('genre');
  else if (!evidence?.city) unknowns.push('neighborhood');
  if (!fields.publishedFacts?.agePolicy) unknowns.push('age-policy');
  unknowns.push('ticket-availability');
  if (fields.advertisedPriceUsd == null) unknowns.push('cover-price');
  return [...new Set(unknowns)];
}

function omitRef(fields) {
  const { ref: _ref, ...rest } = fields;
  return rest;
}

function daysUntil(startLocal, now) {
  const start = new Date(startLocal);
  return Number.isNaN(start.getTime()) ? null : Math.max(0, Math.ceil((start.getTime() - new Date(now).getTime()) / 86_400_000));
}

function weekday(start) {
  return start && !Number.isNaN(start.getTime())
    ? start.toLocaleDateString('en-US', { weekday: 'long' })
    : 'unknown';
}

function clock(start) {
  return `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
}

export function startPeriodFor(start, timeTbd) {
  if (timeTbd || !start || Number.isNaN(start.getTime())) return 'unknown';
  const hour = start.getHours();
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'late';
}

// A coarse label, never a coordinate pair. The model gets "roughly the
// Westside"; the deterministic layer keeps the real geometry.
export function coarseArea(venue) {
  if (!venue) return null;
  const city = String(venue.city ?? '').trim();
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return city || null;
  const area = LA_AREAS.find((candidate) => distanceMiles(venue.lat, venue.lon, candidate.lat, candidate.lon) <= candidate.radiusMiles);
  return area?.label ?? (city || null);
}

export const LA_AREAS = [
  { label: 'Downtown / Arts District', lat: 34.0430, lon: -118.2400, radiusMiles: 3 },
  { label: 'Hollywood', lat: 34.0983, lon: -118.3267, radiusMiles: 3 },
  { label: 'Silver Lake / Echo Park', lat: 34.0870, lon: -118.2600, radiusMiles: 2.5 },
  { label: 'Westside', lat: 34.0195, lon: -118.4912, radiusMiles: 6 },
  { label: 'South Bay', lat: 33.8847, lon: -118.4109, radiusMiles: 8 },
  { label: 'San Fernando Valley', lat: 34.1870, lon: -118.4480, radiusMiles: 10 },
  { label: 'Long Beach', lat: 33.7701, lon: -118.1937, radiusMiles: 6 },
  { label: 'Pasadena / San Gabriel Valley', lat: 34.1478, lon: -118.1445, radiusMiles: 8 }
];

// Deliberately crude and explicitly an estimate: LA travel time is not a fact
// this project has a source for, so it is never presented as one.
const TRANSPORT_MPH = { walk: 3, transit: 12, rideshare: 20, drive: 22, bike: 9 };

export function travelMinutes(venue, startArea, transport = 'drive') {
  if (!venue || !startArea || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return null;
  if (!Number.isFinite(startArea.lat) || !Number.isFinite(startArea.lon)) return null;
  const miles = distanceMiles(venue.lat, venue.lon, startArea.lat, startArea.lon);
  const mph = TRANSPORT_MPH[transport] ?? TRANSPORT_MPH.drive;
  return Math.round((miles / mph) * 60);
}

export function distanceMiles(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cappedText(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, max) : null;
}
