import { buildEventEvidence, serializeEventEvidenceForDisplay } from '../eventEvidence.js';

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
  'other'
]);

/** Compose the display-safe advisory object shared by Music and Overview. */
export function buildSemanticEventInsight(candidate, assessment = null) {
  const display = serializeEventEvidenceForDisplay(candidate?.eventEvidence ?? buildEventEvidence(candidate));
  const facts = display.facts ?? {};
  const claims = {};
  const format = factText(facts.format);
  const classifications = factList(facts.classification);

  // A classification that only restates the vertical the card already sits in,
  // or a taxonomy placeholder, is filler. Rendering nothing is better than
  // telling someone a music event is music.
  const informative = classifications.filter((value) => !UNINFORMATIVE_CLASSIFICATIONS.has(value.toLowerCase()));

  if (format) {
    claims.whatToExpect = claim(`Published format: ${format}.`, 'verified', facts.format);
  } else if (informative.length) {
    claims.whatToExpect = claim(`Published classification: ${informative.slice(0, 2).join(' · ')}.`, 'verified', facts.classification);
  } else {
    const inferred = experienceText(assessment?.experienceCharacter);
    const support = facts.description ?? facts.venueInfo;
    if (inferred && support) claims.whatToExpect = claim(inferred, 'inferred', support);
  }

  if (!claims.whatToExpect && assessment?.musicCharacter && facts.description) {
    const music = musicText(assessment.musicCharacter);
    if (music) claims.whatToExpect = claim(music, 'inferred', facts.description);
  }

  const endTime = factText(facts.endTime);
  const doorTime = factText(facts.doorTime);
  const startTime = factText(facts.startTime);
  if (endTime) {
    claims.worthPlanning = claim(`A published end time (${friendlyTime(endTime)}) makes the event window concrete.`, 'verified', facts.endTime);
  } else if (doorTime && startTime) {
    claims.worthPlanning = claim(`Published doors (${friendlyTime(doorTime)}) and start (${friendlyTime(startTime)}) make arrival planning concrete.`, 'verified', facts.doorTime, facts.startTime);
  }

  const agePolicy = factText(facts.agePolicy);
  if (agePolicy) {
    claims.worthChecking = claim(`Entry policy: ${agePolicy}.`, 'verified', facts.agePolicy);
  } else if (claims.whatToExpect || claims.worthPlanning) {
    claims.worthChecking = {
      text: endTime
        ? 'No additional entry restriction is verified in the available event evidence.'
        : 'No verified event end time is published; confirm the schedule before planning around a late finish.',
      status: 'not known',
      evidence: evidenceFor(...Object.values(facts).slice(0, 1))
    };
  }

  const useful = [claims.whatToExpect, claims.worthPlanning].find((entry) => entry && entry.status !== 'not known');
  if (!useful) return null;
  return { summary: useful.text, ...claims };
}

function claim(text, status, ...facts) {
  return { text, status, evidence: evidenceFor(...facts) };
}

function evidenceFor(...facts) {
  return facts.filter(Boolean).map((fact) => ({
    source: providerLabel(fact.provider),
    url: safeHttpUrl(fact.sourceUrl),
    retrievedAt: fact.retrievedAt ?? null,
    status: fact.confidence === 'verified' ? 'verified' : 'inferred'
  }));
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

function experienceText(value) {
  return ({
    dance_floor: 'Source details point to a dance-floor-oriented program.',
    live_performance: 'Source details point to a live-performance program.',
    seated_listening: 'Source details point to a seated listening program.',
    festival_multi_stage: 'Source details point to a festival or multi-stage program.',
    mixed_or_other: 'Source details point to a mixed event format.'
  })[value] ?? null;
}

function musicText(value) {
  return ({
    electronic_dance: 'Source details point to an electronic or dance-music program.',
    band_or_live: 'Source details point to a band or live-music program.',
    mixed_lineup: 'Source details point to a mixed musical lineup.',
    named_style: 'Source details identify a specific musical style.'
  })[value] ?? null;
}

function friendlyTime(value) {
  const match = String(value).match(/(?:T|\s)(\d{2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function providerLabel(value) {
  return ({ ticketmaster: 'Ticketmaster', framework: 'Framework', insomniac: 'Insomniac' })[value] ?? String(value ?? 'Source');
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
