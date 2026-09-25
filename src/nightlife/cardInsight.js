import {
  ageRestrictionFromText,
  buildEventEvidence,
  serializeEventEvidenceForDisplay,
  serializeEventEvidenceForModel
} from '../eventEvidence.js';
import { assessPersonalRelevance, eventExperienceFor } from './personalRelevance.js';

export const INSIGHT_COMPOSER_VERSION = 2;

// Terms that carry no information on a music card: the segment name itself and
// provider taxonomy labels that name the taxonomy rather than the event.
const UNINFORMATIVE_CLASSIFICATIONS = new Set([
  'music',
  'event style',
  'concert',
  'live',
  'undefined',
  // Ticketmaster attraction types: they describe the act's shape, not its sound.
  'individual',
  'group',
  'musician',
  'other'
]);

// How consequential each kind of supported claim is for deciding whether an
// event deserves attention. The compact card shows the single strongest claim;
// the disclosure shows up to three, one per kind.
const WEIGHT = {
  personalMatch: 100,
  conflict: 90,
  modelExperience: 70,
  documentedFormat: 65,
  // Whether you can get in at all outranks how late it runs.
  agePolicy: 62,
  lateStartNoEnd: 60,
  lateWindow: 55,
  classification: 40,
  eventWindow: 35,
  doorsAndStart: 30
};

const MAX_CLAIMS = 3;
const CLAIM_KINDS = ['whatToExpect', 'whyItMayFit', 'worthPlanning', 'worthChecking'];

/**
 * Every supported claim for one candidate, strongest first, with its full
 * internal provenance: which evidence it rests on, whether the event half is a
 * documented attribute or a Jev characterization, and — for a personal claim —
 * which preference signal it matched.
 *
 * Four kinds of statement are kept apart throughout:
 * - `documented-attribute`: a source published it.
 * - `model-characterization`: Jev characterized it from facts it was sent.
 * - `calculated-match`: our code matched an event attribute to an established
 *   preference signal.
 * - `uncertainty` / `conflict`: something consequential is not known, or the
 *   sources disagree.
 * An unsupported assumption has no category because it is never emitted.
 */
export function composeInsightClaims(candidate, assessment = null, { preferences = null } = {}) {
  // Always merge field by field across every occurrence. A candidate's own
  // `eventEvidence` is one provider's view; reading it alone would drop what a
  // merged provider contributed.
  const evidence = buildEventEvidence(candidate);
  const display = serializeEventEvidenceForDisplay(evidence);
  const facts = display.facts ?? {};
  const conflicts = display.conflicts ?? {};
  const modelFacts = serializeEventEvidenceForModel(evidence).publishedFacts ?? {};
  const claims = [];

  // Why it may fit: only a calculated match with both halves evidenced.
  const personal = assessPersonalRelevance({ candidate, facts, modelFacts, assessment, preferences: preferences ?? {} });
  for (const match of personal) {
    claims.push({
      kind: 'whyItMayFit',
      weight: WEIGHT.personalMatch,
      text: match.text,
      status: match.status,
      basis: 'calculated-match',
      eventBasis: match.eventBasis,
      ...(match.characterization ? { characterization: match.characterization } : {}),
      comparison: match.comparison,
      preference: match.preference,
      facts: match.facts
    });
  }
  const personalExperience = personal.some((match) => match.comparison === 'familiar-artist-in-format');

  // What to expect. A Jev characterization is used only when it is a real
  // experiential distinction grounded in descriptive facts it was sent, and only
  // when the personal claim has not already carried it.
  const experience = eventExperienceFor({ facts, modelFacts, assessment });
  const modelExperience = !personalExperience && experience?.basis === 'model-characterization';
  if (modelExperience) {
    claims.push({
      kind: 'whatToExpect',
      weight: WEIGHT.modelExperience,
      text: experienceText(experience.experience),
      status: 'inferred',
      basis: 'model-characterization',
      eventBasis: 'model-characterization',
      characterization: experience.characterization,
      facts: experience.facts
    });
  }
  if (facts.format && !personalExperience) {
    claims.push({
      kind: 'whatToExpect',
      weight: WEIGHT.documentedFormat,
      text: `${providerLabel(facts.format.provider)} lists the format as ${factText(facts.format)}.`,
      status: 'verified',
      basis: 'documented-attribute',
      facts: [facts.format]
    });
  }

  // A classification that only restates the vertical the card already sits in,
  // or a taxonomy placeholder, is filler. So is one a stronger claim already
  // said: a festival bill does not need "classified as Festival" beneath it.
  const saidFestival = (personalExperience || modelExperience) && experience?.experience === 'festival_multi_stage';
  const informative = factList(facts.classification)
    .filter((value) => !UNINFORMATIVE_CLASSIFICATIONS.has(value.toLowerCase()))
    .filter((value) => !(saidFestival && /festival/i.test(value)));
  if (informative.length) {
    claims.push({
      kind: 'whatToExpect',
      weight: WEIGHT.classification,
      text: `${providerLabel(facts.classification.provider)} classifies it as ${informative.slice(0, 2).join(' · ')}.`,
      status: 'verified',
      basis: 'documented-attribute',
      facts: [facts.classification]
    });
  }

  // Worth planning around: the event window, when a source actually publishes it.
  const start = localTime(facts.startTime);
  const end = localTime(facts.endTime);
  const doors = localTime(facts.doorTime);
  if (end) {
    // A window is quoted only from one provider's own start and end. Pairing one
    // source's start with another's finish would attribute a schedule to a
    // source that never published it.
    const startFact = [facts.startTime, ...(conflicts.startTime ?? [])]
      .find((fact) => fact && fact.provider === facts.endTime.provider);
    const windowStart = localTime(startFact);
    // A finish between 1 and 7 AM on the day after the start is a late night.
    const nextDay = windowStart ? end.date > windowStart.date : true;
    const lateFinish = nextDay && end.hour >= 1 && end.hour < 7;
    const provider = providerLabel(facts.endTime.provider);
    const window = windowStart
      ? `${article(windowStart.label)} ${windowStart.label} – ${end.label} window`
      : `an end time of ${end.label}`;
    claims.push({
      kind: 'worthPlanning',
      weight: lateFinish ? WEIGHT.lateWindow : WEIGHT.eventWindow,
      text: lateFinish ? `${provider} lists ${window}, so plan for a late way home.` : `${provider} lists ${window}.`,
      status: 'verified',
      basis: 'documented-attribute',
      facts: [startFact, facts.endTime].filter(Boolean)
    });
  } else if (doors && start) {
    claims.push({
      kind: 'worthPlanning',
      weight: WEIGHT.doorsAndStart,
      text: `Doors at ${doors.label}, start at ${start.label}, per ${providerLabel(facts.doorTime.provider)}.`,
      status: 'verified',
      basis: 'documented-attribute',
      facts: [facts.doorTime, facts.startTime]
    });
  }

  // Worth checking: disagreement first, then a consequential gap, then a
  // published restriction the card does not already show.
  for (const field of ['startTime', 'endTime']) {
    const disagreement = timeConflict(facts[field], conflicts[field]);
    if (disagreement) {
      claims.push({
        kind: 'worthChecking',
        weight: WEIGHT.conflict,
        text: `${disagreement.summary}; confirm the ${field === 'startTime' ? 'start' : 'finish'} before planning.`,
        status: 'not known',
        basis: 'conflict',
        facts: [facts[field], ...conflicts[field]]
      });
    }
  }

  const age = ageClaim(candidate, facts, conflicts);
  if (age) claims.push(age);

  if (!end && start && start.late && !candidate?.timeTbd) {
    claims.push({
      kind: 'worthChecking',
      weight: WEIGHT.lateStartNoEnd,
      text: `Starts at ${start.label} and no end time is published, so how late it runs is not known.`,
      status: 'not known',
      basis: 'uncertainty',
      facts: [facts.startTime]
    });
  }

  return claims.sort((left, right) => right.weight - left.weight);
}

/**
 * Compose the display-safe advisory object shared by Music and Overview.
 * Returns null when nothing specific and supported can be said; the card then
 * renders exactly as it would without enrichment.
 */
export function buildSemanticEventInsight(candidate, assessment = null, options = {}) {
  const claims = composeInsightClaims(candidate, assessment, options);
  const byKind = new Map();
  for (const claim of claims) {
    if (!byKind.has(claim.kind)) byKind.set(claim.kind, claim);
  }
  const selected = [...byKind.values()].sort((left, right) => right.weight - left.weight).slice(0, MAX_CLAIMS);
  // A gap or disagreement on its own is not enrichment. It may accompany a
  // useful claim, never replace one.
  const lead = selected.find((claim) => claim.status !== 'not known');
  if (!lead) return null;
  const insight = { summary: lead.text, claimOrder: selected.map((claim) => claim.kind) };
  for (const claim of selected) insight[claim.kind] = publishClaim(claim);
  return insight;
}

/** The published shape of one claim: text, status, basis, and its evidence. */
function publishClaim(claim) {
  return {
    text: claim.text,
    status: claim.status,
    basis: claim.basis,
    // For a personal match, whether its event half was documented by a source
    // or characterized by Jev. Diagnostics read this; the card does not.
    ...(claim.basis === 'calculated-match' ? { eventBasis: claim.eventBasis } : {}),
    evidence: [
      ...evidenceFor(...(claim.facts ?? [])),
      ...(claim.preference ? [{ source: `Your taste profile: ${claim.preference.label}`, url: null, retrievedAt: null, status: 'verified' }] : [])
    ]
  };
}

export { CLAIM_KINDS };

function ageClaim(candidate, facts, conflicts) {
  const policy = facts.agePolicy;
  const displayedTitleAge = ageRestrictionFromText(candidate?.title);
  const policyAge = policy ? ageRestrictionFromText(policy.value) ?? factText(policy) : null;

  const alternative = (conflicts.agePolicy ?? [])[0];
  if (policy && alternative) {
    return {
      kind: 'worthChecking',
      weight: WEIGHT.conflict,
      text: `${sourcePhrase(alternative)} says ${alternative.value}, but ${sourcePhrase(policy)} says ${policyAge}; confirm entry before you go.`,
      status: 'not known',
      basis: 'conflict',
      facts: [policy, alternative]
    };
  }
  // The card's own title can come from a provider whose facts are not event
  // evidence here. It is already on screen, so it is used only to avoid
  // repeating it and to catch a disagreement — never as a new claim.
  if (policy && displayedTitleAge && policyAge && ageRestrictionFromText(policyAge) && ageRestrictionFromText(policyAge) !== displayedTitleAge) {
    return {
      kind: 'worthChecking',
      weight: WEIGHT.conflict,
      text: `The listing title says ${displayedTitleAge}, but ${sourcePhrase(policy)} says ${policyAge}; confirm entry before you go.`,
      status: 'not known',
      basis: 'conflict',
      facts: [policy]
    };
  }
  if (!policy || !policyAge) return null;
  // Already visible in the title: repeating it is filler.
  if (displayedTitleAge && displayedTitleAge === ageRestrictionFromText(policyAge)) return null;
  return {
    kind: 'worthChecking',
    weight: WEIGHT.agePolicy,
    text: policy.derivedFrom === 'title'
      ? `${providerLabel(policy.provider)}'s listing marks this ${policyAge}.`
      : `${providerLabel(policy.provider)} lists entry as ${policyAge}.`,
    status: 'verified',
    basis: 'documented-attribute',
    facts: [policy]
  };
}

function sourcePhrase(fact) {
  const provider = providerLabel(fact.provider);
  return fact.derivedFrom === 'title' ? `${provider}'s listing title` : `${provider}'s published policy`;
}

function timeConflict(fact, alternatives = []) {
  const primary = localTime(fact);
  if (!primary) return null;
  const other = alternatives.map((item) => ({ item, time: localTime(item) }))
    .find(({ time }) => time && time.minutes !== primary.minutes);
  if (!other) return null;
  return {
    summary: `${providerLabel(fact.provider)} lists ${primary.label} and ${providerLabel(other.item.provider)} lists ${other.time.label}`
  };
}

function experienceText(value) {
  return ({
    dance_floor: 'The listing points to a dance-floor night.',
    seated_listening: 'The listing points to a seated show.',
    festival_multi_stage: 'The listing points to a festival-style, multi-act program.'
  })[value] ?? null;
}

function evidenceFor(...facts) {
  const seen = new Set();
  return facts.filter(Boolean).flatMap((fact) => {
    const entry = {
      source: providerLabel(fact.provider),
      url: safeHttpUrl(fact.sourceUrl),
      retrievedAt: fact.retrievedAt ?? null,
      status: fact.confidence === 'verified' ? 'verified' : 'inferred'
    };
    const key = `${entry.source}|${entry.url}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [entry];
  });
}

function factText(fact) {
  if (!fact || fact.value == null) return null;
  if (typeof fact.value === 'string' || typeof fact.value === 'number') return String(fact.value).trim() || null;
  if (Array.isArray(fact.value)) return fact.value.map(String).map((value) => value.trim()).filter(Boolean).join(' · ') || null;
  const local = fact.value.local ?? fact.value.value ?? null;
  return local == null ? null : String(local).trim() || null;
}

function factList(fact) {
  if (!fact) return [];
  const values = Array.isArray(fact.value) ? fact.value : [fact.value];
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
}

/** A published local time, read from the wall-clock string the source gave. */
function localTime(fact) {
  const text = factText(fact);
  const match = text?.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  return {
    date: match[1],
    hour,
    minutes: hour * 60 + minute,
    // A start at 9 PM or later, or in the small hours, is a late start.
    late: hour >= 21 || hour < 4,
    label: clockLabel(hour, minute)
  };
}

function article(label) {
  return /^(?:8|11|18)\b/.test(label) ? 'an' : 'a';
}

function clockLabel(hour, minute) {
  if (hour === 0 && minute === 0) return 'midnight';
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return minute ? `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}` : `${hour % 12 || 12} ${suffix}`;
}

function providerLabel(value) {
  return ({ ticketmaster: 'Ticketmaster', framework: 'Framework', insomniac: 'Insomniac' })[value] ?? String(value ?? 'The source');
}

function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
