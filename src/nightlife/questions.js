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

// v2 removes broad request-fit/friction judgments from the model boundary.
// They are either deterministic (clock, travel, budget, overlap) or too
// underspecified to ask without source-backed event facts.
// v3 removes the last reference to the user's discovery tier from question
// wording; no question may depend on who the event is for.
export const QUESTION_SET_VERSION = 3;

// Confidence is reported per Choice/Score answer and is derived from the
// probability distribution. Below the floor we record `unknown` rather than a
// guess: an honest "not sure" is the whole reason for using a calibrated model.
export const DEFAULT_CERTAINTY_THRESHOLDS = { high: 0.75, moderate: 0.5 };

// A Noul returns the probability that a statement is true. The middle band is
// deliberately wide: a friction flag is only raised when the model leans
// clearly toward yes, and the band between is treated as "not established".
export const DEFAULT_NOUL_THRESHOLDS = { flag: 0.65, clear: 0.35 };

const SHARED_PREFACE = 'You are judging one Los Angeles nightlife candidate for one private person. Some evidence is intentionally withheld by source policy; absent detail is uncertainty, not a negative. Judge only from the supplied state.';

export const CHOICE_QUESTIONS = {
  context_fit: {
    field: 'contextFit',
    type: 'choice',
    instructions: `${SHARED_PREFACE} How well does this candidate match the kind of night the person described in request.goal and the rest of the request?`,
    criteria: {
      strong: 'Clearly the kind of night described, on the supplied evidence.',
      possible: 'Plausibly matches, with some part of the described night unaddressed.',
      exploratory: 'A stretch from what was described, but a reasonable risk worth surfacing.',
      poor: 'Contradicts something the person explicitly asked for, such as the wrong night, the wrong energy, or the wrong part of town.'
    }
  },
  music_fit: {
    field: 'musicAtmosphereFit',
    type: 'choice',
    instructions: `${SHARED_PREFACE} How well does the likely music and room atmosphere match request.preferredMusic and request.energy? Judge from the event title, venue, event type and lineup size only. If the lineup or genre was withheld, that is uncertainty.`,
    criteria: {
      strong: 'The supplied title, venue or event type points clearly at the music and energy asked for.',
      possible: 'Consistent with what was asked for, without direct evidence of the specific sound.',
      weak: 'The supplied evidence points at a different sound or a different kind of room.'
    }
  },
  late_night_fit: {
    field: 'lateNightFit',
    type: 'choice',
    instructions: `${SHARED_PREFACE} Does this candidate support staying out as late as request.lateNightIntent describes? No source here publishes an end time or a venue's closing hour, so "confirmed" requires the supplied evidence itself to establish a late schedule.`,
    criteria: {
      confirmed: 'The supplied schedule evidence itself establishes a late-running event.',
      possible: 'The start time and event type are consistent with a late night, without confirming it.',
      unlikely: 'The supplied start time or event type points at an early finish.'
    }
  },
  novelty: {
    field: 'novelty',
    type: 'choice',
    instructions: `${SHARED_PREFACE} How novel is this candidate relative to the person's established taste?`,
    criteria: {
      familiar: 'Squarely inside the established taste, on the supplied discovery evidence.',
      adjacent: 'One step out: a neighbouring sound, scene or promoter.',
      exploratory: 'Genuinely outside the established pattern.'
    }
  }
};

export const NOUL_QUESTIONS = {
  friction_travel: {
    flag: 'long-travel',
    type: 'noul',
    instructions: `${SHARED_PREFACE} Getting to this candidate from request.startArea and home again inside the stated window is a real logistical burden, given candidate.travelMinutesEstimate and request.transport.`,
    criteria: {
      true: 'The journey is a meaningful cost of the evening.',
      false: 'The journey is unremarkable for a night out in Los Angeles.'
    }
  },
  friction_timing: {
    flag: 'late-start',
    type: 'noul',
    instructions: `${SHARED_PREFACE} The start time sits awkwardly against the window the person described, for example starting so late that the earlier part of the evening is wasted, or so early that it conflicts with the stated earliest start.`,
    criteria: {
      true: 'The timing works against the described night.',
      false: 'The timing fits the described night.'
    }
  },
  friction_coordination: {
    flag: 'group-coordination',
    type: 'noul',
    instructions: `${SHARED_PREFACE} This candidate takes meaningful coordination for the party described in request.party, for example a group needing tickets together or a plan that is awkward to do solo.`,
    criteria: {
      true: 'It needs real coordination for the stated party.',
      false: 'It is straightforward for the stated party.'
    }
  }
};

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
 * The full question map for one candidate, in the neutral primitive shape that
 * every adapter accepts. The set is static and versioned so cached decisions
 * stay comparable and a wording change invalidates them.
 */
export function buildQuestionSet({ input = null, legacy = false } = {}) {
  if (legacy) return buildLegacyQuestionSet();
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

export function buildLegacyQuestionSet() {
  const questions = {};
  for (const [id, definition] of Object.entries(CHOICE_QUESTIONS)) {
    questions[id] = { type: 'choice', instructions: definition.instructions, criteria: definition.criteria };
  }
  for (const [id, definition] of Object.entries(NOUL_QUESTIONS)) {
    questions[id] = { type: 'noul', instructions: definition.instructions, criteria: definition.criteria };
  }
  return questions;
}

/** Band a raw confidence value. Raw values never enter the domain contract. */
export function certaintyBand(confidence, thresholds = DEFAULT_CERTAINTY_THRESHOLDS) {
  if (!Number.isFinite(confidence)) return 'low';
  if (confidence >= thresholds.high) return 'high';
  if (confidence >= thresholds.moderate) return 'moderate';
  return 'low';
}

export function nulBand(noul, thresholds = DEFAULT_NOUL_THRESHOLDS) {
  if (!Number.isFinite(noul)) return 'unknown';
  if (noul >= thresholds.flag) return 'yes';
  if (noul <= thresholds.clear) return 'no';
  return 'unknown';
}
