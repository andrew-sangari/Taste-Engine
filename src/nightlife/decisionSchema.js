import { containsUnsupportedModelClaim } from '../diagnostics.js';
import {
  CHOICE_QUESTIONS,
  DEFAULT_CERTAINTY_THRESHOLDS,
  DEFAULT_NOUL_THRESHOLDS,
  NOUL_QUESTIONS,
  QUESTION_SET_VERSION,
  buildQuestionSet,
  certaintyBand,
  nulBand
} from './questions.js';

// The internal decision contract. Every provider adapter maps its own answers
// into exactly this shape; nothing downstream of `assessCandidates` sees a
// provider-specific field, probability, or confidence number.
export const DECISION_SCHEMA_VERSION = 2;

export const CONTEXT_FIT = ['strong', 'possible', 'exploratory', 'poor', 'unknown'];
export const MUSIC_ATMOSPHERE_FIT = ['strong', 'possible', 'weak', 'unknown'];
export const LATE_NIGHT_FIT = ['confirmed', 'possible', 'unlikely', 'unknown'];
export const NOVELTY = ['familiar', 'adjacent', 'exploratory', 'unknown'];
export const CERTAINTY_BANDS = ['high', 'moderate', 'low'];

export const FRICTION_FLAGS = [
  'long-travel',
  'late-start',
  'group-coordination',
  'schedule-unconfirmed',
  'ticket-unknown',
  'cost-unknown'
];

export class DecisionSchemaError extends Error {}

const DIMENSIONS = {
  contextFit: { allowed: CONTEXT_FIT, questionId: 'context_fit' },
  musicAtmosphereFit: { allowed: MUSIC_ATMOSPHERE_FIT, questionId: 'music_fit' },
  lateNightFit: { allowed: LATE_NIGHT_FIT, questionId: 'late_night_fit' },
  novelty: { allowed: NOVELTY, questionId: 'novelty' }
};

const EVENT_DIMENSIONS = {
  experienceCharacter: { allowed: ['dance_floor', 'live_performance', 'seated_listening', 'festival_multi_stage', 'mixed_or_other', 'unknown'], questionId: 'event_experience' },
  musicCharacter: { allowed: ['electronic_dance', 'band_or_live', 'mixed_lineup', 'named_style', 'unknown'], questionId: 'music_character' },
  participationFormat: { allowed: ['standing_or_floor', 'seated', 'mixed', 'not_published', 'unknown'], questionId: 'participation_format' },
  scheduleCharacter: { allowed: ['published_late_window', 'published_early_window', 'published_event_window', 'unknown'], questionId: 'schedule_character' },
  entryPolicy: { allowed: ['age_restricted', 'all_ages', 'policy_other', 'unknown'], questionId: 'entry_policy' },
  venueCharacter: { allowed: ['club_or_dance_room', 'concert_hall', 'outdoor_or_festival', 'other_published', 'unknown'], questionId: 'venue_character' }
};

/**
 * Map one candidate's raw typed answers into a `SemanticAssessment`.
 *
 * Three things are deliberately *not* taken from the model:
 *
 * - `unknown` is produced here, from low confidence, rather than offered to the
 *   model as an option it could pick for the wrong reason.
 * - `evidenceRefs` and `unknowns` are deterministic: they are what the
 *   serializer actually supplied and actually withheld.
 * - `reason` is composed by `composeReason` from the typed answers. The model
 *   generates no text at all, so it cannot assert a fact about an event.
 *
 * Raw probabilities and confidence stay in `signals`, which is provider-scoped
 * diagnostic data for the shadow evaluation. They are never presented as
 * calibrated cross-provider probabilities and never reach the site surface.
 */
export function assessmentFromAnswers(answers, {
  candidateRef,
  input,
  certaintyThresholds = DEFAULT_CERTAINTY_THRESHOLDS,
  noulThresholds = DEFAULT_NOUL_THRESHOLDS
} = {}) {
  if (!candidateRef) throw new DecisionSchemaError('An assessment requires a candidate ref.');
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new DecisionSchemaError('Provider answers must be an object keyed by question id.');
  }

  const evidenceMode = Object.keys(input?.fields?.publishedFacts ?? {}).length > 0;
  const questionSet = buildQuestionSet({ input });
  const dimensions = evidenceMode ? EVENT_DIMENSIONS : DIMENSIONS;
  const assessment = {
    candidateRef,
    schemaVersion: DECISION_SCHEMA_VERSION,
    questionSetVersion: QUESTION_SET_VERSION
  };
  const certainty = {};
  const signals = {};
  let answeredCount = 0;

  for (const [field, { allowed, questionId }] of Object.entries(dimensions)) {
    if (evidenceMode && !questionSet[questionId]) {
      assessment[field] = 'unknown';
      certainty[field] = 'low';
      continue;
    }
    const answer = answers[questionId];
    if (answer == null) {
      assessment[field] = 'unknown';
      certainty[field] = 'low';
      continue;
    }
    const choice = validateChoiceAnswer(answer, questionId, questionSet);
    const band = certaintyBand(choice.confidence, certaintyThresholds);
    // A value the model is not reasonably sure of is recorded as unknown, not
    // as a weak rating. "We could not tell" and "this is a poor fit" are
    // different answers and the surface shows them differently.
    const value = band === 'low' ? 'unknown' : choice.choice;
    if (!allowed.includes(value)) {
      throw new DecisionSchemaError(`Provider returned an unsupported ${field} value.`);
    }
    assessment[field] = value;
    certainty[field] = band;
    signals[questionId] = { choice: choice.choice, confidence: round(choice.confidence), probabilities: roundAll(choice.probabilities) };
    answeredCount += 1;
  }

  const frictionFlags = [];
  for (const [questionId, definition] of Object.entries(evidenceMode ? {} : NOUL_QUESTIONS)) {
    const answer = answers[questionId];
    if (answer == null) continue;
    const noul = validateNoulAnswer(answer, questionId);
    const band = nulBand(noul, noulThresholds);
    signals[questionId] = { noul: round(noul), band };
    if (band === 'yes') frictionFlags.push(definition.flag);
    answeredCount += 1;
  }

  // Deterministic friction that the model is never asked about, because these
  // are facts about our own evidence rather than judgments.
  if (input?.fields) {
    if (input.fields.startPeriod === 'unknown') frictionFlags.push('schedule-unconfirmed');
    if (input.fields.advertisedPriceUsd == null) frictionFlags.push('cost-unknown');
    if (evidenceMode && !input.fields.publishedFacts?.endTime) frictionFlags.push('schedule-unconfirmed');
    frictionFlags.push('ticket-unknown');
  }

  assessment.frictionFlags = [...new Set(frictionFlags)].filter((flag) => FRICTION_FLAGS.includes(flag));
  assessment.evidenceRefs = [...(input?.evidenceRefs ?? [])];
  assessment.unknowns = [...(input?.fields?.knownUnknowns ?? [])];
  assessment.certainty = certainty;
  assessment.signals = signals;
  assessment.answeredQuestionCount = answeredCount;
  assessment.reason = composeReason(assessment, input);

  if (containsUnsupportedModelClaim(assessment.reason)) {
    throw new DecisionSchemaError('Composed reason made an unsupported availability claim.');
  }
  return assessment;
}

/**
 * Build the explanation from typed answers and supplied evidence only.
 *
 * Every clause here is traceable to a field the serializer actually sent, which
 * is what makes the shortlist auditable: there is no sentence in the product
 * that some model wrote about an event it cannot see.
 */
export function composeReason(assessment, input) {
  const fields = input?.fields ?? {};
  const parts = [];

  if (fields.publishedFacts) return composeEvidenceReason(assessment, fields);

  const fitClause = {
    strong: 'Matches the night you described',
    possible: 'Plausibly matches the night you described',
    exploratory: 'A stretch from what you asked for, kept as a wildcard',
    poor: 'Works against something you asked for',
    unknown: 'Not enough evidence to judge the overall fit'
  }[assessment.contextFit];
  parts.push(fitClause);

  if (assessment.musicAtmosphereFit === 'strong') parts.push('the room and sound look right');
  else if (assessment.musicAtmosphereFit === 'weak') parts.push('the likely sound points elsewhere');
  else if (assessment.musicAtmosphereFit === 'unknown') parts.push('the lineup was not available to judge the sound');

  if (assessment.lateNightFit === 'confirmed') parts.push('the published schedule runs late');
  else if (assessment.lateNightFit === 'possible') parts.push('it could run late, though no source publishes an end time');
  else if (assessment.lateNightFit === 'unlikely') parts.push('it looks like an early finish');

  if (assessment.novelty === 'exploratory') parts.push('it is outside your usual pattern');
  else if (assessment.novelty === 'adjacent') parts.push('it sits one step off your usual pattern');

  if (assessment.frictionFlags.includes('long-travel')) {
    parts.push(fields.travelMinutesEstimate
      ? `the trip is roughly ${fields.travelMinutesEstimate} minutes each way`
      : 'the trip is a real part of the evening');
  }
  if (assessment.frictionFlags.includes('late-start')) parts.push('the start time sits awkwardly in your window');
  if (assessment.frictionFlags.includes('group-coordination')) parts.push('it takes some coordination for your party');

  return `${sentence(parts)}.`;
}

function composeEvidenceReason(assessment, fields) {
  const published = fields.publishedFacts ?? {};
  const parts = [];
  const experience = {
    dance_floor: 'Published details describe a dance-floor experience',
    live_performance: 'Published details describe a live-performance experience',
    seated_listening: 'Published details describe a seated listening experience',
    festival_multi_stage: 'Published details describe a festival or multi-stage program',
    mixed_or_other: 'Published details describe a mixed or other event format'
  }[assessment.experienceCharacter];
  if (experience && (published.format || published.description || published.classification || published.venueInfo)) parts.push(experience);

  const music = {
    electronic_dance: 'published music details point to electronic dance music',
    band_or_live: 'published music details point to a band or live program',
    mixed_lineup: 'published music details describe a mixed lineup',
    named_style: 'published music details name a specific style'
  }[assessment.musicCharacter];
  if (music && (published.classification || published.description || published.namedLineup)) parts.push(music);

  const participation = {
    standing_or_floor: 'the published format is standing or floor-oriented',
    seated: 'the published format is seated',
    mixed: 'the published format includes seated and floor participation',
    not_published: 'the event does not publish a participation format'
  }[assessment.participationFormat];
  if (participation && (published.format || published.venueInfo || published.description)) parts.push(participation);

  const schedule = {
    published_late_window: 'published event times establish a late-running window',
    published_early_window: 'published event times establish an early-evening window',
    published_event_window: 'published event times establish a bounded event window'
  }[assessment.scheduleCharacter];
  if (schedule && published.endTime) parts.push(schedule);

  const entry = {
    age_restricted: 'the published entry policy is age-restricted',
    all_ages: 'the published entry policy is all-ages',
    policy_other: 'the event publishes an entry policy'
  }[assessment.entryPolicy];
  if (entry && published.agePolicy) parts.push(entry);

  const venue = {
    club_or_dance_room: 'published venue metadata describes a club or dance room',
    concert_hall: 'published venue metadata describes a concert hall',
    outdoor_or_festival: 'published venue metadata describes an outdoor or festival setting',
    other_published: 'published venue metadata establishes another room character'
  }[assessment.venueCharacter];
  if (venue && published.venueInfo) parts.push(venue);

  if (!parts.length) return 'Published event details were insufficient for a typed characterization.';
  return `${parts[0]}${parts.length > 1 ? `; ${parts.slice(1).join(', ')}` : ''}.`;
}

/**
 * Validate a full provider response for one candidate before it is mapped.
 * Extra question ids are rejected: an adapter may not smuggle its own
 * dimensions into the contract.
 */
export function validateAnswerEnvelope(answers, { expectedQuestionIds } = {}) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new DecisionSchemaError('Provider response did not contain an answers map.');
  }
  const expected = new Set(expectedQuestionIds ?? [...Object.keys(CHOICE_QUESTIONS), ...Object.keys(NOUL_QUESTIONS)]);
  for (const id of Object.keys(answers)) {
    if (!expected.has(id)) throw new DecisionSchemaError(`Provider answered an unrequested question (${id}).`);
  }
  return answers;
}

function validateChoiceAnswer(answer, questionId, questionSet = null) {
  if (answer.type && answer.type !== 'choice') {
    throw new DecisionSchemaError(`Question ${questionId} expected a choice answer.`);
  }
  const definition = questionSet?.[questionId] ?? CHOICE_QUESTIONS[questionId];
  if (!definition) throw new DecisionSchemaError(`Unknown choice question ${questionId}.`);
  const allowed = Object.keys(definition.criteria);
  if (typeof answer.choice !== 'string' || !allowed.includes(answer.choice)) {
    throw new DecisionSchemaError(`Question ${questionId} returned an option outside its criteria.`);
  }
  const confidence = Number(answer.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new DecisionSchemaError(`Question ${questionId} returned an out-of-range confidence.`);
  }
  const probabilities = answer.probabilities ?? {};
  if (probabilities && typeof probabilities === 'object') {
    for (const key of Object.keys(probabilities)) {
      if (!allowed.includes(key)) {
        throw new DecisionSchemaError(`Question ${questionId} returned a probability for an unknown option.`);
      }
    }
  }
  return { choice: answer.choice, confidence, probabilities };
}

function validateNoulAnswer(answer, questionId) {
  if (answer.type && answer.type !== 'noul') {
    throw new DecisionSchemaError(`Question ${questionId} expected a noul answer.`);
  }
  const noul = Number(answer.noul);
  if (!Number.isFinite(noul) || noul < 0 || noul > 1) {
    throw new DecisionSchemaError(`Question ${questionId} returned an out-of-range noul value.`);
  }
  return noul;
}

function sentence(parts) {
  const cleaned = parts.filter(Boolean);
  if (cleaned.length <= 1) return cleaned[0] ?? 'No assessment was available';
  return `${cleaned[0]}; ${cleaned.slice(1).join(', ')}`;
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function roundAll(probabilities) {
  if (!probabilities || typeof probabilities !== 'object') return {};
  return Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, round(Number(value))]));
}
