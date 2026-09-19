import { distanceMiles, permittedVenuePoint, travelMinutes } from './semanticInput.js';
import { windowBounds } from './context.js';

// No permitted source publishes an end time, so a stop's length is an openly
// declared assumption used only for feasibility arithmetic. It is never
// presented as a scheduled end.
export const ASSUMED_STOP_MINUTES = { concert: 150, 'dj set': 210, festival: 300, unknown: 150 };
export const MINIMUM_TRANSFER_MINUTES = 20;

/**
 * Deterministic timing for one candidate. `endAssumed` is always flagged so the
 * surface can say "assumed", and `timeKnown` false means the schedule itself is
 * unconfirmed.
 */
export function candidateTiming(candidate, { eventType = 'unknown' } = {}) {
  const start = candidate.startLocal ? new Date(candidate.startLocal) : null;
  const timeKnown = Boolean(start && !Number.isNaN(start.getTime()) && !candidate.timeTbd);
  if (!start || Number.isNaN(start.getTime())) return { start: null, end: null, timeKnown: false, endAssumed: true };
  const minutes = ASSUMED_STOP_MINUTES[eventType] ?? ASSUMED_STOP_MINUTES.unknown;
  return {
    start,
    end: new Date(start.getTime() + minutes * 60_000),
    timeKnown,
    endAssumed: true,
    assumedStopMinutes: minutes
  };
}

/** Whether a candidate's start falls inside the requested window. */
export function withinWindow(candidate, context, { now = new Date() } = {}) {
  const { start, end } = windowBounds(context, { now });
  const timing = candidateTiming(candidate);
  if (!timing.start) return { inWindow: false, reason: 'no scheduled date' };
  // A date-only candidate is kept: the day is a fact even when the clock is not.
  if (!timing.timeKnown) {
    const day = timing.start.toDateString();
    return { inWindow: day === start.toDateString() || day === end.toDateString(), reason: 'time unconfirmed' };
  }
  if (timing.start < start) return { inWindow: false, reason: 'starts before the window' };
  if (timing.start > end) return { inWindow: false, reason: 'starts after the window' };
  return { inWindow: true, reason: null };
}

/** Coarse minutes between two candidates' venues, or null when unknown. */
export function transferMinutes(fromCandidate, toCandidate, transport = 'drive') {
  const from = permittedVenue(fromCandidate);
  const to = permittedVenue(toCandidate);
  if (!from || !to) return null;
  const minutes = travelMinutes(to, { lat: from.lat, lon: from.lon }, transport);
  return minutes == null ? null : Math.max(MINIMUM_TRANSFER_MINUTES, minutes);
}

/**
 * Check one ordered sequence against the window, travel budget and overlap.
 * Unknown travel time is reported as unknown and blocks a *confirmed* plan
 * rather than being assumed feasible.
 */
export function evaluateSequence(candidates, context, { now = new Date(), eventTypeFor = () => 'unknown' } = {}) {
  const { start: windowStart, end: windowEnd } = windowBounds(context, { now });
  const transport = context.transport ?? 'drive';
  const stops = [];
  const issues = [];
  let previous = null;
  let previousTiming = null;

  for (const candidate of candidates) {
    const timing = candidateTiming(candidate, { eventType: eventTypeFor(candidate) });
    if (!timing.start) {
      issues.push({ code: 'no-schedule', candidateId: candidate.id });
      return { feasible: false, stops, issues, travelMinutesTotal: null };
    }
    if (timing.timeKnown && timing.start < windowStart) {
      issues.push({ code: 'before-window', candidateId: candidate.id });
      return { feasible: false, stops, issues, travelMinutesTotal: null };
    }
    let transfer = null;
    if (previous) {
      transfer = transferMinutes(previous, candidate, transport);
      if (transfer == null) {
        issues.push({ code: 'travel-unknown', candidateId: candidate.id });
      } else if (previousTiming?.start && timing.timeKnown) {
        // Leaving the first stop early is allowed; arriving after the second
        // has started is not.
        const earliestArrival = new Date(previousTiming.start.getTime() + (MINIMUM_TRANSFER_MINUTES + transfer) * 60_000);
        if (earliestArrival > timing.start) {
          issues.push({ code: 'overlap', candidateId: candidate.id });
          return { feasible: false, stops, issues, travelMinutesTotal: null };
        }
      }
    }
    stops.push({ candidateId: candidate.id, timing, transferMinutes: transfer });
    previous = candidate;
    previousTiming = timing;
  }

  const last = stops.at(-1);
  if (last?.timing?.end && last.timing.end > windowEnd) {
    issues.push({ code: 'past-latest-return', candidateId: last.candidateId });
  }
  const travelMinutesTotal = stops.every((stop) => stop.transferMinutes != null || stop === stops[0])
    ? stops.reduce((total, stop) => total + (stop.transferMinutes ?? 0), 0)
    : null;
  const blocking = issues.filter((issue) => ['no-schedule', 'before-window', 'overlap'].includes(issue.code));
  return {
    feasible: blocking.length === 0,
    // A plan with an unknown transfer or an assumed end past the window is
    // offered as an option, never as a confirmed evening.
    confirmed: issues.length === 0 && stops.every((stop) => stop.timing.timeKnown),
    stops,
    issues,
    travelMinutesTotal
  };
}

/**
 * Build the best feasible ordered plan from the shortlist. Returns a single
 * stop when no second stop is viable; a plan is always an option, not a booking.
 */
export function buildEveningPlan(candidates, context, { now = new Date(), maxStops = 2, eventTypeFor = () => 'unknown' } = {}) {
  const dated = candidates.filter((candidate) => candidateTiming(candidate).start);
  if (!dated.length) return null;
  const ordered = [...dated].sort((left, right) => new Date(left.startLocal) - new Date(right.startLocal));
  const anchor = candidates[0];
  const rest = ordered.filter((candidate) => candidate.id !== anchor.id);

  for (const follow of rest) {
    if (maxStops < 2) break;
    const sequence = new Date(anchor.startLocal) <= new Date(follow.startLocal) ? [anchor, follow] : [follow, anchor];
    const evaluation = evaluateSequence(sequence, context, { now, eventTypeFor });
    if (evaluation.feasible) {
      return { ...evaluation, candidateIds: sequence.map((candidate) => candidate.id) };
    }
  }
  const solo = evaluateSequence([anchor], context, { now, eventTypeFor });
  return solo.feasible ? { ...solo, candidateIds: [anchor.id] } : null;
}

/** Straight-line miles from the stated starting area, or null when unknown. */
export function milesFromStart(candidate, startArea) {
  const venue = permittedVenue(candidate);
  if (!venue || !startArea || !Number.isFinite(startArea.lat) || !Number.isFinite(startArea.lon)) return null;
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return null;
  return Number(distanceMiles(venue.lat, venue.lon, startArea.lat, startArea.lon).toFixed(1));
}

// Travel arithmetic uses only the permitted venue point, so a restricted
// candidate contributes no geometry and simply reports unknown travel.
function permittedVenue(candidate) {
  return permittedVenuePoint(candidate);
}
