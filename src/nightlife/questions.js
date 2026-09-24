/**
 * The decision questions, in the provider-neutral primitive vocabulary.
 *
 * Jev is a System One evaluation model: it answers typed questions about a
 * state and returns choices, scores and yes/no probabilities. It does not
 * generate text. That is a better fit for this project than a chat model,
 * because the model cannot write prose about an event and therefore cannot
 * invent a fact about one — every sentence the user reads is composed by our
 * own code from typed answers and supplied evidence.
 *
 * Following the model's own guidance, each question asks one narrow thing and
 * the results are combined by deterministic code rather than by the model.
 */

// v4 deletes the retired goal-driven questions (context fit, music fit, late
// night fit, novelty, and the friction yes/no set) and words the shared preface
// about the event alone: no question refers to a person, a request, or a taste.
export const QUESTION_SET_VERSION = 4;

// Confidence is reported per Choice answer and is derived from the probability
// distribution. Below the floor we record `unknown` rather than a guess: an
// honest "not sure" is the whole reason for using a calibrated model.
export const DEFAULT_CERTAINTY_THRESHOLDS = { high: 0.75, moderate: 0.5 };

const SHARED_PREFACE = 'You are characterizing one Los Angeles event from its published facts. Some facts are intentionally withheld by source policy; absent detail is uncertainty, not a negative. Judge only from the supplied state.';

const EVENT_CHARACTERIZATION_QUESTIONS = {
  event_experience: {
    field: 'experienceCharacter',
    requires: ['format', 'description', 'classification'],
    type: 'choice',
    instructions: `${SHARED_PREFACE} Characterize the documented event experience using only the published event facts. Do not infer an experience from the start time alone and do not fill gaps with common knowledge about the venue or promoter.`,
    criteria: {
      dance_floor: 'The supplied facts describe a dance-floor or club-oriented experience.',
      live_performance: 'The supplied facts describe a live performance or concert experience.',
      seated_listening: 'The supplied facts explicitly describe seated, reserved, or listening-room participation.',
      festival_multi_stage: 'The supplied facts describe a festival or multi-stage program.',
      mixed_or_other: 'The supplied facts describe an experience that does not fit the other categories.',
      unknown: 'The supplied facts are insufficient or inconclusive.'
    }
  },
  music_character: {
    field: 'musicCharacter',
    requires: ['classification', 'description', 'namedLineup'],
    type: 'choice',
    instructions: `${SHARED_PREFACE} Characterize the music evidence that is explicitly published for this event. A missing genre or lineup is uncertainty, not evidence against a style.`,
    criteria: {
      electronic_dance: 'The supplied classification or description explicitly points to electronic or dance music.',
      band_or_live: 'The supplied classification, description, or named lineup points to a band or live music program.',
      mixed_lineup: 'The supplied facts explicitly describe multiple contrasting music formats or a mixed lineup.',
      named_style: 'The supplied facts publish a specific music style that is not covered by the other options.',
      unknown: 'The supplied facts are insufficient or inconclusive.'
    }
  },
  participation_format: {
    field: 'participationFormat',
    requires: ['format', 'description'],
    type: 'choice',
    instructions: `${SHARED_PREFACE} Characterize how a person participates in the event only when the supplied event or venue facts state it. Do not infer standing, seating, or access from a venue name alone.`,
    criteria: {
      standing_or_floor: 'The supplied facts explicitly describe standing, floor, or dance-floor participation.',
      seated: 'The supplied facts explicitly describe reserved or seated participation.',
      mixed: 'The supplied facts explicitly describe both seated and standing/floor participation.',
      not_published: 'The supplied facts do not establish a participation format.',
      unknown: 'The supplied facts are insufficient or inconclusive.'
    }
  },
  schedule_character: {
    field: 'scheduleCharacter',
    requires: ['endTime'],
    type: 'choice',
    instructions: `${SHARED_PREFACE} Characterize the published event schedule from its door, start, and end facts. Do not infer a late-running event from a late start, event type, or venue reputation.`,
    criteria: {
      published_late_window: 'The published event times establish a late-running window.',
      published_early_window: 'The published event times establish an early-evening window.',
      published_event_window: 'The event publishes a bounded window without establishing an especially early or late character.',
      unknown: 'The published times are insufficient or inconclusive.'
    }
  },
  entry_policy: {
    field: 'entryPolicy',
    requires: ['agePolicy'],
    type: 'choice',
    instructions: `${SHARED_PREFACE} Characterize the published age or entry policy. Do not infer age access from the event type, venue, or title.`,
    criteria: {
      age_restricted: 'The supplied policy explicitly restricts entry by age.',
      all_ages: 'The supplied policy explicitly says the event is all ages or otherwise open by age.',
      policy_other: 'The supplied policy is published but does not fit the other options.',
      unknown: 'The supplied policy is insufficient or inconclusive.'
    }
  },
  venue_character: {
    field: 'venueCharacter',
    requires: ['venueInfo', 'format'],
    type: 'choice',
    instructions: `${SHARED_PREFACE} Characterize the venue or room only from explicit venue metadata and event-format facts. A venue name alone is not enough to assert a room type.`,
    criteria: {
      club_or_dance_room: 'The supplied metadata explicitly describes a club or dance-room setting.',
      concert_hall: 'The supplied metadata explicitly describes a concert hall or live-room setting.',
      outdoor_or_festival: 'The supplied metadata explicitly describes an outdoor or festival setting.',
      other_published: 'The supplied metadata establishes a venue character not covered above.',
      unknown: 'The supplied metadata is insufficient or inconclusive.'
    }
  }
};

/**
 * The question map for one candidate, in the neutral primitive shape that every
 * adapter accepts: only the characterization questions its model-transmittable
 * facts can support. No eligible evidence means an empty map and no call.
 */
export function buildQuestionSet({ input = null } = {}) {
  if (input && Object.keys(input?.fields?.publishedFacts ?? {}).length) {
    return buildEvidenceQuestionSet(input);
  }
  return {};
}

/** Build only the evidence-dependent questions that have supporting facts. */
export function buildEvidenceQuestionSet(input) {
  const available = new Set(Object.keys(input?.fields?.publishedFacts ?? {}));
  const questions = {};
  for (const [id, definition] of Object.entries(EVENT_CHARACTERIZATION_QUESTIONS)) {
    if (!definition.requires.some((field) => available.has(field))) continue;
    // A schedule judgment needs an end/door fact. A start time alone is not
    // enough to establish late-night character.
    if (id === 'schedule_character' && !available.has('endTime')) continue;
    if (id === 'venue_character' && !hasExplicitVenueCharacterEvidence(input.fields.publishedFacts?.venueInfo)) continue;
    questions[id] = {
      type: definition.type,
      field: definition.field,
      instructions: definition.instructions,
      criteria: definition.criteria
    };
  }
  return questions;
}

function hasExplicitVenueCharacterEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['type', 'venueType', 'setting', 'roomType', 'generalInfo', 'rules', 'accessibility'].some((key) => {
    const item = value[key];
    return (typeof item === 'string' && item.trim()) || (Array.isArray(item) && item.length);
  });
}

/** Band a raw confidence value. Raw values never enter the domain contract. */
export function certaintyBand(confidence, thresholds = DEFAULT_CERTAINTY_THRESHOLDS) {
  if (!Number.isFinite(confidence)) return 'low';
  if (confidence >= thresholds.high) return 'high';
  if (confidence >= thresholds.moderate) return 'moderate';
  return 'low';
}
