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

export const QUESTION_SET_VERSION = 1;

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
    instructions: `${SHARED_PREFACE} How novel is this candidate relative to the person's established taste? candidate.adjacentEvidence lists how it reached the shortlist: "similar" and "tag" mean it came from a neighbouring-taste expansion rather than a direct match, and "promoter" means it came from a followed promoter.`,
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

/**
 * The full question map for one candidate, in the neutral primitive shape that
 * every adapter accepts. The set is static and versioned so cached decisions
 * stay comparable and a wording change invalidates them.
 */
export function buildQuestionSet() {
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
