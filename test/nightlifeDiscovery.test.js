import test from 'node:test';
import assert from 'node:assert/strict';
import { STAY_HOME_THRESHOLD, discoverNightlife, nightlifeScore } from '../src/nightlife/discovery.js';
import { createDecisionInferenceProvider } from '../src/nightlife/inference.js';
import { normalizeNightlifeContext } from '../src/nightlife/context.js';
import { refsToReassess, reviseCriteria } from '../src/nightlife/criteria.js';
import { buildEveningPlan, candidateTiming, evaluateSequence, withinWindow } from '../src/nightlife/itinerary.js';

const NOW = new Date('2026-09-26T12:00:00');

function baseContext(overrides = {}) {
  return normalizeNightlifeContext({
    goal: 'Loud, late, and not a cross-town slog',
    date: '2026-09-26',
    earliestStart: '20:00',
    latestReturn: '03:00',
    startArea: 'Downtown / Arts District',
    transport: 'drive',
    lateNightIntent: 'out late',
    ...overrides
  }, { now: NOW });
}

function candidate(id, { hour = 22, lat = 34.043, lon = -118.24, utility = 60, price = 30, source = 'ticketmaster' } = {}) {
  const startLocal = `2026-09-26T${String(hour).padStart(2, '0')}:00:00`;
  return {
    id,
    title: `Show ${id}`,
    startLocal,
    timeTbd: false,
    venue: { name: `Venue ${id}`, city: 'Los Angeles', lat, lon },
    performers: [],
    matchedArtists: [{ origin: 'similar' }],
    ticketObservation: { lowestPriceUsd: price },
    sourceOccurrences: [{
      source,
      sourceEventId: id,
      sourceUrl: `https://${source}.com/e/${id}`,
      title: `Show ${id}`,
      startLocal,
      venue: { name: `Venue ${id}`, city: 'Los Angeles', lat, lon },
      performerNames: ['Artist']
    }],
    ranking: { utility }
  };
}

function answers({ contextFit = 'strong', confidence = 0.9 } = {}) {
  return {
    model: 'jev-1.13.0',
    answers: {
      context_fit: { type: 'choice', choice: contextFit, probabilities: { strong: 0.9, possible: 0.1 }, confidence },
      music_fit: { type: 'choice', choice: 'strong', probabilities: { strong: 0.9, possible: 0.1 }, confidence: 0.9 },
      late_night_fit: { type: 'choice', choice: 'confirmed', probabilities: { confirmed: 0.9, possible: 0.1 }, confidence: 0.9 },
      novelty: { type: 'choice', choice: 'adjacent', probabilities: { adjacent: 0.9, familiar: 0.1 }, confidence: 0.9 },
      friction_travel: { type: 'noul', noul: 0.1 },
      friction_timing: { type: 'noul', noul: 0.1 },
      friction_coordination: { type: 'noul', noul: 0.1 }
    },
    usage: { input_tokens: 300, output_tokens: 10 }
  };
}

function providerReturning(body, options = {}) {
  return createDecisionInferenceProvider({
    provider: 'direct',
    direct: { apiKey: 'k' },
    ...options
  }, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }) });
}

const disabledProvider = createDecisionInferenceProvider({ provider: 'disabled' }, {
  fetchImpl: async () => {
    throw new Error('must not be called');
  }
});

test('produces a shortlist with evidence, unknowns and source links', async () => {
  const result = await discoverNightlife({
    events: [candidate('a'), candidate('b', { utility: 40 })],
    context: baseContext(),
    provider: providerReturning(answers()),
    now: NOW
  });
  assert.equal(result.stayHome, false);
  assert.ok(result.shortlist.length >= 1);
  const top = result.shortlist[0];
  assert.equal(top.inferenceCovered, true);
  assert.ok(top.assessment.reason.length > 0);
  assert.ok(top.unknowns.includes('end-time'), 'no source publishes an end time');
  assert.deepEqual(top.sourceLinks, [{ source: 'ticketmaster', url: 'https://ticketmaster.com/e/a' }]);
  assert.equal(result.inference.status, 'assessed');
});

test('works with inference disabled and keeps the deterministic score', async () => {
  const result = await discoverNightlife({
    events: [candidate('a', { utility: 70 })],
    context: baseContext(),
    provider: disabledProvider,
    now: NOW
  });
  assert.equal(result.shortlist.length, 1);
  assert.equal(result.shortlist[0].inferenceCovered, false);
  assert.equal(result.shortlist[0].assessment, null);
  assert.equal(result.shortlist[0].score, 70);
  assert.equal(result.inference.status, 'not configured');
});

test('an over-budget candidate is excluded deterministically, not by the model', async () => {
  const result = await discoverNightlife({
    events: [candidate('pricey', { price: 200 })],
    context: baseContext({ budgetUsd: 50 }),
    provider: disabledProvider,
    now: NOW
  });
  assert.equal(result.shortlist.length, 0);
  assert.match(result.excluded[0].reason, /over the \$50 budget/);
});

test('returns a stay-home verdict when nothing clears the bar', async () => {
  const result = await discoverNightlife({
    events: [candidate('weak', { utility: 10 })],
    context: baseContext(),
    provider: disabledProvider,
    now: NOW
  });
  assert.equal(result.stayHome, true);
  assert.match(result.stayHomeReason, /honest call/);
  assert.equal(result.shortlist.length, 0);
});

test('nothing in the window is reported as a source gap, not a bad night', async () => {
  const result = await discoverNightlife({
    events: [candidate('tomorrow', { hour: 22 })].map((event) => ({ ...event, startLocal: '2026-10-05T22:00:00' })),
    context: baseContext(),
    provider: disabledProvider,
    now: NOW
  });
  assert.equal(result.stayHome, true);
  assert.match(result.stayHomeReason, /permitted sources/);
});

test('a SeatGeek-only candidate still ranks but is never named', async () => {
  const result = await discoverNightlife({
    events: [candidate('sg', { source: 'seatgeek', utility: 80 })],
    context: baseContext(),
    provider: disabledProvider,
    now: NOW
  });
  const entry = result.shortlist[0];
  assert.equal(entry.restrictedSource, true);
  assert.equal(entry.title, null);
  assert.equal(entry.venue, null);
  assert.equal(entry.advertisedPriceUsd, null);
});

test('scoring combines the deterministic base with weighted assessments', () => {
  const context = baseContext({ noveltyAppetite: 'exploratory' });
  const base = candidate('a', { utility: 50 });
  const strong = {
    contextFit: 'strong',
    musicAtmosphereFit: 'strong',
    lateNightFit: 'confirmed',
    novelty: 'exploratory',
    frictionFlags: [],
    certainty: { contextFit: 'high', musicAtmosphereFit: 'high', lateNightFit: 'high', novelty: 'high' }
  };
  assert.equal(nightlifeScore(base, strong, context), 96);
  // Moderate certainty contributes at half weight.
  assert.equal(nightlifeScore(base, { ...strong, certainty: { ...strong.certainty, contextFit: 'moderate' } }, context), 87);
  // An unknown dimension contributes nothing rather than penalising.
  assert.equal(nightlifeScore(base, { ...strong, musicAtmosphereFit: 'unknown' }, context), 86);
  // No assessment at all leaves the deterministic score untouched.
  assert.equal(nightlifeScore(base, null, context), 50);
});

test('a poor fit is penalised below the stay-home threshold', () => {
  const context = baseContext();
  const scored = nightlifeScore(candidate('a', { utility: 55 }), {
    contextFit: 'poor',
    musicAtmosphereFit: 'weak',
    lateNightFit: 'unlikely',
    novelty: 'familiar',
    frictionFlags: ['long-travel'],
    certainty: { contextFit: 'high', musicAtmosphereFit: 'high', lateNightFit: 'high', novelty: 'high' }
  }, context);
  assert.ok(scored < STAY_HOME_THRESHOLD);
});

test('an evening plan is feasible only when travel and timing allow it', () => {
  const context = baseContext();
  const first = candidate('first', { hour: 20 });
  const second = candidate('second', { hour: 23, lat: 34.0983, lon: -118.3267 });
  const plan = buildEveningPlan([first, second], context, { now: NOW });
  assert.ok(plan.feasible);
  assert.equal(plan.candidateIds.length, 2);

  // Two shows starting at the same minute across town cannot both happen.
  const clash = evaluateSequence([first, candidate('clash', { hour: 20, lat: 33.77, lon: -118.19 })], context, { now: NOW });
  assert.equal(clash.feasible, false);
  assert.equal(clash.issues[0].code, 'overlap');
});

test('an end time is always marked as assumed, never as scheduled', () => {
  const timing = candidateTiming(candidate('a'), { eventType: 'dj set' });
  assert.equal(timing.endAssumed, true);
  assert.equal(timing.timeKnown, true);
  assert.equal(timing.assumedStopMinutes, 210);
});

test('a date-only candidate stays in the window with its time unconfirmed', () => {
  const tbd = { ...candidate('tbd'), timeTbd: true, startLocal: '2026-09-26T00:00:00' };
  const result = withinWindow(tbd, baseContext(), { now: NOW });
  assert.equal(result.inWindow, true);
  assert.equal(result.reason, 'time unconfirmed');
});

test('a budget-only revision needs no re-assessment at all', () => {
  const previous = baseContext();
  const outcome = reviseCriteria(previous, { budgetUsd: 60 }, { now: NOW });
  assert.deepEqual(outcome.changed, ['budgetUsd']);
  assert.equal(outcome.deterministicOnly, true);
  assert.equal(refsToReassess({ refIndex: { 'cand-1': 'a' } }, outcome).size, 0);
});

test('a goal change re-assesses everything, a narrower change does not', () => {
  const previous = baseContext();
  const rewritten = reviseCriteria(previous, { goal: 'Actually I want something quiet' }, { now: NOW });
  assert.equal(rewritten.reassessAll, true);

  const narrowed = reviseCriteria(previous, { transport: 'transit' }, { now: NOW });
  assert.deepEqual(narrowed.changed, ['transport']);
  assert.equal(narrowed.reassessAll, false);
});

test('a revision retries candidates the previous run could not assess', () => {
  const previousResult = {
    refIndex: { 'cand-1': 'a', 'cand-2': 'b' },
    shortlist: [{ ref: 'cand-1', inferenceCovered: true }],
    alternatives: [{ ref: 'cand-2', inferenceCovered: false }]
  };
  const outcome = reviseCriteria(baseContext(), { shortlistSize: 3 }, { now: NOW });
  outcome.changed = [];
  const refs = refsToReassess(previousResult, { ...outcome, deterministicOnly: false, reassessAll: false });
  assert.ok(refs.has('cand-2'), 'an uncovered candidate is retried');
  assert.ok(!refs.has('cand-1'));
});

test('only the impacted candidates are re-sent on a criteria revision', async () => {
  let calls = 0;
  const provider = createDecisionInferenceProvider({ provider: 'direct', direct: { apiKey: 'k' } }, {
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => answers() };
    }
  });
  const events = [candidate('a'), candidate('b')];
  await discoverNightlife({ events, context: baseContext(), provider, now: NOW });
  assert.equal(calls, 2);
  await discoverNightlife({
    events,
    context: baseContext(),
    provider,
    now: NOW,
    onlyRefs: new Set(['cand-1'])
  });
  // The second candidate came from cache; only the impacted one was re-sent.
  assert.equal(calls, 2);
});

test('plan timestamps stay Los Angeles wall clock, not UTC', async () => {
  const result = await discoverNightlife({
    events: [candidate('first', { hour: 20 }), candidate('second', { hour: 23, lat: 34.0983, lon: -118.3267 })],
    context: baseContext(),
    provider: disabledProvider,
    now: NOW
  });
  const [first] = result.plan.stops;
  // The browser reads these with the same wall-clock helpers as startLocal, so
  // an ISO/UTC string would render the wrong hour.
  assert.equal(first.startLocal, '2026-09-26T20:00:00');
  assert.ok(!first.startLocal.endsWith('Z'));
  assert.equal(first.endIsAssumed, true);
});
