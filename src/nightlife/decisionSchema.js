import { containsUnsupportedModelClaim } from '../diagnostics.js';
import {
  CHOICE_QUESTIONS,
  DEFAULT_CERTAINTY_THRESHOLDS,
  DEFAULT_NOUL_THRESHOLDS,
  NOUL_QUESTIONS,
  QUESTION_SET_VERSION,
  certaintyBand,
  nulBand
} from './questions.js';

// The internal decision contract. Every provider adapter maps its own answers
// into exactly this shape; nothing downstream of `assessCandidates` sees a
// provider-specific field, probability, or confidence number.
export const DECISION_SCHEMA_VERSION = 1;

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

  const assessment = {
    candidateRef,
    schemaVersion: DECISION_SCHEMA_VERSION,
    questionSetVersion: QUESTION_SET_VERSION
  };
  const certainty = {};
  const signals = {};
  let answeredCount = 0;

  for (const [field, { allowed, questionId }] of Object.entries(DIMENSIONS)) {
    const answer = answers[questionId];
    if (answer == null) {
      assessment[field] = 'unknown';
      certainty[field] = 'low';
      continue;
    }
    const choice = validateChoiceAnswer(answer, questionId);
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
  for (const [questionId, definition] of Object.entries(NOUL_QUESTIONS)) {
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

function validateChoiceAnswer(answer, questionId) {
  if (answer.type && answer.type !== 'choice') {
    throw new DecisionSchemaError(`Question ${questionId} expected a choice answer.`);
  }
  const allowed = Object.keys(CHOICE_QUESTIONS[questionId].criteria);
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
