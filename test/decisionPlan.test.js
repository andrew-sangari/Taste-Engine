import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_POLICY,
  DEFAULT_PLAN_CONSTRAINTS,
  normalizePlanConstraints,
  planCandidates,
  buildDecisionPlans
} from '../src/decisionPlan.js';

// 2026-11-11 is a Wednesday. The week used by most fixtures runs
// Monday 2026-11-16 to Sunday 2026-11-22.
const NOW = '2026-11-11';

function night(id, date, score, extra = {}) {
  return {
    id,
    vertical: 'music',
    title: `Show ${id}`,
    startLocal: `${date}T20:00:00`,
    days: [date],
    score,
    hassle: 0,
    priceUsd: null,
    venue: `Venue ${id}`,
    tier: 'direct',
    isTrip: false,
    isNew: false,
    ...extra
  };
}

function game(id, date, score, extra = {}) {
  return night(id, date, score, { vertical: 'sports', league: 'nfl', title: `Rams vs. ${id}`, venue: 'SoFi Stadium', tier: null, ...extra });
}

function trip(id, days, score, extra = {}) {
  return night(id, days[0], score, { days, isTrip: true, tier: 'destination', isNew: true, title: `Festival ${id}`, ...extra });
}

function solve(candidates, constraints = {}, rest = {}) {
  return buildDecisionPlans({ candidates, constraints, now: NOW, ...rest });
}

function planFor(result, lens) {
  return result.plans.find((plan) => plan.lens === lens || plan.alsoLenses.includes(lens));
}

const ids = (plan) => plan.picks.map((pick) => pick.id);

// ---------------------------------------------------------------------------
// An independent statement of the rules, used to check the solver.

const dayOf = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
// Monday-to-Sunday week, derived from the weekday rather than the solver's arithmetic.
const mondayOf = (date) => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dayOf(date) - ((weekday + 6) % 7);
};

function objective(lens, picks) {
  const { bar, easy, mix } = PLAN_POLICY;
  let total = 0;
  for (const pick of picks) {
    total += pick.score - bar;
    if (lens === 'easy') total -= easy.hassleWeight * pick.hassle + easy.nightCost * pick.days.length + (pick.isTrip ? easy.tripPenalty : 0);
  }
  if (lens === 'mix') {
    const kinds = new Set(picks.map((pick) => (pick.vertical === 'sports' ? pick.league : 'music')));
    const venues = new Set(picks.map((pick) => pick.venue.toLowerCase()).filter(Boolean));
    const discoveries = Math.min(mix.discoveryLimit, picks.filter((pick) => pick.isNew).length);
    total += kinds.size * mix.kindBonus + venues.size * mix.venueBonus + discoveries * mix.discoveryBonus;
  }
  return total;
}

// Whether `added` may join `pinned` under the hard constraints. Pinned nights
// are never judged; everything added must be legal next to all other picks.
function feasible(added, pinned, rules) {
  const all = [...pinned, ...added];
  const occupied = new Set(all.flatMap((pick) => pick.days));
  for (const pick of added) {
    if (pick.isTrip && !rules.includeTrips) return false;
    for (const other of all) {
      if (other === pick) continue;
      for (const a of pick.days) {
        for (const b of other.days) {
          const gap = Math.abs(dayOf(a) - dayOf(b));
          if (gap === 0 || (rules.avoidBackToBack && gap === 1)) return false;
        }
      }
    }
    for (const date of pick.days) {
      const monday = mondayOf(date);
      const load = [...occupied].filter((other) => mondayOf(other) === monday).length;
      if (load > rules.nightsPerWeek) return false;
    }
  }
  if (rules.budgetUsd != null) {
    const pinnedCost = pinned.reduce((sum, pick) => sum + (pick.priceUsd ?? 0), 0);
    const addedCost = added.reduce((sum, pick) => sum + (pick.priceUsd ?? 0), 0);
    if (addedCost > Math.max(0, rules.budgetUsd - pinnedCost)) return false;
  }
  return true;
}

function bruteForce(lens, candidates, rules, pinnedIds, excludedIds) {
  const pinned = candidates.filter((candidate) => pinnedIds.includes(candidate.id));
  const free = candidates.filter((candidate) => !pinnedIds.includes(candidate.id)
    && !excludedIds.includes(candidate.id)
    && candidate.score > PLAN_POLICY.bar);
  let best = -Infinity;
  for (let mask = 0; mask < 2 ** free.length; mask += 1) {
    const added = free.filter((_, index) => mask & (1 << index));
    if (!feasible(added, pinned, rules)) continue;
    best = Math.max(best, objective(lens, [...pinned, ...added]));
  }
  return best;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dateAt = (offset) => new Date(Date.UTC(2026, 10, 11) + offset * 86_400_000).toISOString().slice(0, 10);

function randomCandidates(random, count, span, { venues = 4, tripRate = 0.2 } = {}) {
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(random() * span);
    const sports = random() < 0.35;
    const isTrip = !sports && random() < tripRate;
    const tier = ['direct', 'similar', 'roster', 'promoter-night'][Math.floor(random() * 4)];
    // Trips are two or three days, sometimes with a gap between them.
    const shape = [[0, 1], [0, 2], [0, 1, 2], [0, 1, 3]][Math.floor(random() * 4)];
    candidates.push({
      id: `c${String(index).padStart(3, '0')}`,
      vertical: sports ? 'sports' : 'music',
      ...(sports ? { league: random() < 0.6 ? 'mlb' : 'nfl' } : {}),
      title: `Night ${index}`,
      startLocal: `${dateAt(start)}T19:30:00`,
      days: isTrip ? shape.map((step) => dateAt(start + step)) : [dateAt(start)],
      score: Math.round(30 + random() * 50),
      hassle: Math.floor(random() * 7),
      priceUsd: random() < 0.3 ? null : random() < 0.1 ? 0 : Math.round(15 + random() * 185),
      venue: sports ? 'Stadium' : `Room ${Math.floor(random() * venues)}`,
      tier: sports ? null : isTrip ? 'destination' : tier,
      isTrip,
      isNew: !sports && (isTrip || tier !== 'direct')
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------

test('constraint normalization survives hostile input', () => {
  assert.deepEqual(normalizePlanConstraints(), DEFAULT_PLAN_CONSTRAINTS);
  for (const hostile of [null, 'x', 42, [], [{ windowDays: 60 }], () => {}, Symbol('s')]) {
    assert.deepEqual(normalizePlanConstraints(hostile), DEFAULT_PLAN_CONSTRAINTS);
  }
  const throwing = { get windowDays() { throw new Error('boom'); } };
  assert.deepEqual(normalizePlanConstraints(throwing), DEFAULT_PLAN_CONSTRAINTS);
  const coercing = { nightsPerWeek: { valueOf() { throw new Error('boom'); } }, budgetUsd: { valueOf: () => 5 } };
  assert.deepEqual(normalizePlanConstraints(coercing), DEFAULT_PLAN_CONSTRAINTS);

  assert.deepEqual(
    normalizePlanConstraints({ windowDays: 45, nightsPerWeek: 99, budgetUsd: -20, avoidBackToBack: 'no', includeTrips: 0, __proto__: { admin: true }, extra: 1 }),
    { windowDays: 30, nightsPerWeek: 7, budgetUsd: 0, avoidBackToBack: true, includeTrips: true }
  );
  assert.deepEqual(
    normalizePlanConstraints({ windowDays: 90, nightsPerWeek: 0, budgetUsd: 1e9, avoidBackToBack: false, includeTrips: false }),
    { windowDays: 90, nightsPerWeek: 1, budgetUsd: 100000, avoidBackToBack: false, includeTrips: false }
  );
  assert.equal(normalizePlanConstraints({ nightsPerWeek: 2.6 }).nightsPerWeek, 3);
  assert.equal(normalizePlanConstraints({ nightsPerWeek: NaN }).nightsPerWeek, 2);
  assert.equal(normalizePlanConstraints({ windowDays: '60' }).windowDays, 60);
  assert.equal(normalizePlanConstraints({ budgetUsd: Infinity }).budgetUsd, null);
  assert.equal(normalizePlanConstraints({ budgetUsd: '' }).budgetUsd, null);
  assert.equal(normalizePlanConstraints({ budgetUsd: 120.456 }).budgetUsd, 120.46);
  assert.deepEqual(Object.keys(normalizePlanConstraints({ a: 1 })).sort(), Object.keys(DEFAULT_PLAN_CONSTRAINTS).sort());
  assert.ok(Object.isFrozen(PLAN_POLICY) && Object.isFrozen(DEFAULT_PLAN_CONSTRAINTS));
});

test('candidates are normalized from music, sports and destination rows', () => {
  const events = [
    {
      id: 'ticketmaster:1', title: 'Direct Artist', startLocal: '2026-11-21T20:00:00', timeTbd: false,
      venue: { name: 'The Wiltern', city: 'Los Angeles' }, eventType: 'concert', destination: null,
      ticketObservation: { lowestPriceUsd: 64.5 },
      ranking: { utility: 60.4, hassleScore: 2, excluded: false, discovery: { tier: 'direct' } }
    },
    {
      id: 'framework:2', title: 'Promoter Night', startLocal: '2026-11-13T22:00:00', timeTbd: true,
      venue: { name: 'Sound', city: 'Los Angeles' }, eventType: 'dj set', destination: null,
      ticketObservation: { lowestPriceUsd: null },
      ranking: { utility: 33, hassleScore: 14, excluded: false, discovery: { tier: 'promoter-night' } }
    },
    {
      id: 'ticketmaster:3', title: 'Proper NYE', startLocal: '2026-12-31T15:00:00',
      venue: { name: 'Petco Park', city: 'San Diego' }, eventType: 'festival',
      destination: { name: 'Proper NYE', days: ['2027-01-01', '2026-12-31', 'garbage'], distanceLabel: 'about 110 mi from Los Angeles' },
      ticketObservation: { lowestPriceUsd: 189 },
      ranking: { utility: 72, hassleScore: 2, excluded: false, discovery: { tier: 'destination' } }
    },
    { id: 'gone', title: 'Excluded', startLocal: '2026-11-20T20:00:00', venue: { name: 'X' }, ranking: { utility: 90, hassleScore: 0, excluded: true, discovery: { tier: 'direct' } } },
    { id: 'past', title: 'Yesterday', startLocal: '2026-11-10T20:00:00', venue: { name: 'X' }, ranking: { utility: 90, hassleScore: 0, excluded: false } },
    { id: 'undated', title: 'No date', startLocal: 'TBD', venue: { name: 'X' }, ranking: { utility: 90, hassleScore: 0 } },
    { id: 'impossible', title: 'Bad date', startLocal: '2026-02-31T20:00:00', venue: { name: 'X' }, ranking: { utility: 90, hassleScore: 0 } },
    { id: 'edge', title: 'Day 60', startLocal: '2027-01-10T20:00:00', venue: { name: 'X' }, ranking: { utility: 50, hassleScore: 0, discovery: { tier: 'none' } } },
    { id: 'unscored', title: 'No score', startLocal: '2026-11-20T20:00:00', venue: { name: 'X' }, ranking: {} },
    null
  ];
  const sports = [
    {
      id: 'nfl:401873079', league: 'nfl', startLocal: '2026-11-25T17:00:00-08:00',
      homeTeam: { name: 'Los Angeles Rams', shortName: 'Rams' }, awayTeam: { name: 'Green Bay Packers', shortName: 'Packers' },
      venue: { name: 'SoFi Stadium', city: 'Inglewood' },
      ticketObservations: [{ lowestPriceUsd: null }, { lowestPriceUsd: 142 }, { lowestPriceUsd: 118.5 }],
      ranking: { utility: 67, hassleScore: 4, excluded: false }
    },
    {
      id: 'mlb:868122', league: 'mlb', startLocal: '2026-12-01T19:10:00-08:00',
      homeTeam: { name: 'Los Angeles Dodgers', shortName: 'LA Dodgers' }, awayTeam: { name: 'Arizona Diamondbacks', shortName: 'Arizona' },
      venue: { name: 'Dodger Stadium' }, ticketObservations: [{ lowestPriceUsd: null }],
      ranking: { utility: 51, hassleScore: 2, excluded: false }
    }
  ];

  const candidates = planCandidates({ events, sports, now: NOW, windowDays: 60 });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ['framework:2', 'ticketmaster:1', 'nfl:401873079', 'mlb:868122', 'ticketmaster:3']);
  const byId = Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate]));

  assert.deepEqual(byId['ticketmaster:1'], {
    id: 'ticketmaster:1', vertical: 'music', title: 'Direct Artist', startLocal: '2026-11-21T20:00:00', days: ['2026-11-21'],
    score: 60, hassle: 2, priceUsd: 64.5, venue: 'The Wiltern', tier: 'direct', isTrip: false, isNew: false
  });
  assert.equal(byId['framework:2'].isNew, true);
  assert.equal(byId['framework:2'].priceUsd, null);
  assert.equal(byId['framework:2'].hassle, 10, 'hassle is clamped to its 0-10 scale');
  assert.deepEqual(byId['ticketmaster:3'].days, ['2026-12-31', '2027-01-01']);
  assert.equal(byId['ticketmaster:3'].isTrip, true);
  assert.equal(byId['ticketmaster:3'].isNew, true);
  assert.deepEqual(byId['nfl:401873079'], {
    id: 'nfl:401873079', vertical: 'sports', league: 'nfl', title: 'Rams vs. Packers', startLocal: '2026-11-25T17:00:00-08:00', days: ['2026-11-25'],
    score: 67, hassle: 4, priceUsd: 118.5, venue: 'SoFi Stadium', tier: null, isTrip: false, isNew: false
  });
  assert.equal(byId['mlb:868122'].title, 'Dodgers vs. Diamondbacks');
  assert.equal(byId['mlb:868122'].priceUsd, null);

  // The window is [today, today + windowDays): day 59 is in, day 60 is out.
  assert.ok(!candidates.some((candidate) => candidate.id === 'edge'));
  assert.ok(planCandidates({ events, sports, now: NOW, windowDays: 61 }).some((candidate) => candidate.id === 'edge'));
  assert.equal(planCandidates({ events, sports, now: NOW, windowDays: 61 }).find((candidate) => candidate.id === 'edge').isNew, false);

  // An instant is read as a Los Angeles date: 03:00 UTC on the 12th is still the 11th.
  const fromInstant = planCandidates({ events, sports, now: new Date('2026-11-12T03:00:00Z'), windowDays: 60 });
  assert.deepEqual(fromInstant, candidates);
  assert.deepEqual(planCandidates({ events, sports, now: '2026-11-12T03:00:00Z', windowDays: 60 }), candidates);
  // A zone-less string is already local wall-clock time.
  assert.deepEqual(planCandidates({ events, sports, now: '2026-11-11T23:30:00', windowDays: 60 }), candidates);
  // Today itself is in the window; an unusable clock yields nothing rather than a guess.
  assert.ok(planCandidates({ events, now: '2026-11-13', windowDays: 14 }).some((candidate) => candidate.id === 'framework:2'));
  assert.deepEqual(planCandidates({ events, sports, now: 'soon', windowDays: 60 }), []);
  assert.deepEqual(planCandidates({ events, sports, windowDays: 60 }), []);
  assert.deepEqual(planCandidates(), []);
});

test('one thing per day, and the result describes its window', () => {
  const result = solve([night('a', '2026-11-17', 70), night('b', '2026-11-17', 55), night('late', '2026-12-25', 90)]);
  assert.equal(result.policyVersion, PLAN_POLICY.version);
  assert.deepEqual(result.window, { startDate: '2026-11-11', endDate: '2026-12-10', days: 30 });
  assert.deepEqual(result.constraints, DEFAULT_PLAN_CONSTRAINTS);
  assert.equal(result.consideredCount, 2, 'a candidate outside the window is not considered');
  assert.equal(result.worthwhileCount, 2);
  assert.equal(result.empty, false);
  const best = planFor(result, 'best');
  assert.deepEqual(ids(best), ['a']);
  assert.equal(best.exact, true);
  assert.equal(best.versusBest, null);
  assert.deepEqual(best.gaveUp, [{
    id: 'b', title: 'Show b', startLocal: '2026-11-17T20:00:00', score: 55,
    reason: { kind: 'same-day', withId: 'a', text: 'Same night as Show a' }
  }]);
  assert.deepEqual(best.picks[0], { ...night('a', '2026-11-17', 70), pinned: false, why: 'top score that week' });
});

test('weekly cap counts occupied days in a Monday-to-Sunday week', () => {
  const candidates = [night('mon', '2026-11-16', 60), night('wed', '2026-11-18', 70), night('fri', '2026-11-20', 65), night('sun', '2026-11-22', 50)];
  const capped = planFor(solve(candidates, { nightsPerWeek: 2 }), 'best');
  assert.deepEqual(ids(capped), ['wed', 'fri']);
  assert.equal(capped.totals.nights, 2);
  assert.deepEqual(capped.gaveUp.map((item) => [item.id, item.reason.kind, item.reason.text]), [
    ['mon', 'weekly-cap', 'Would be a third night that week'],
    ['sun', 'weekly-cap', 'Would be a third night that week']
  ]);
  assert.deepEqual(ids(planFor(solve(candidates, { nightsPerWeek: 1 }), 'best')), ['wed']);
  assert.deepEqual(ids(planFor(solve(candidates, { nightsPerWeek: 4 }), 'best')), ['mon', 'wed', 'fri', 'sun']);
});

test('back-to-back nights are avoided only when asked', () => {
  const candidates = [night('tue', '2026-11-17', 60), night('wed', '2026-11-18', 70), night('thu', '2026-11-19', 60)];
  const apart = planFor(solve(candidates, { nightsPerWeek: 3, avoidBackToBack: true }), 'best');
  assert.deepEqual(ids(apart), ['tue', 'thu']);
  assert.deepEqual(apart.gaveUp[0].reason, { kind: 'back-to-back', withId: 'tue', text: 'Back-to-back with Show tue' });
  assert.deepEqual(ids(planFor(solve(candidates, { nightsPerWeek: 3, avoidBackToBack: false }), 'best')), ['tue', 'wed', 'thu']);
});

test('week boundary: Sunday and Monday are different weeks but still consecutive days', () => {
  // Sat 14, Sun 15 | Mon 16, Tue 17
  const candidates = [night('sat', '2026-11-14', 60), night('sun', '2026-11-15', 70), night('mon', '2026-11-16', 65), night('tue', '2026-11-17', 50)];
  // One night a week: the best of each week, even though they touch.
  assert.deepEqual(ids(planFor(solve(candidates, { nightsPerWeek: 1, avoidBackToBack: false }), 'best')), ['sun', 'mon']);
  // Back-to-back applies across the boundary: Sunday and Monday cannot both be picked.
  const apart = planFor(solve(candidates, { nightsPerWeek: 1, avoidBackToBack: true }), 'best');
  assert.deepEqual(ids(apart), ['sat', 'mon']);
  assert.deepEqual(apart.gaveUp[0], {
    id: 'sun', title: 'Show sun', startLocal: '2026-11-15T20:00:00', score: 70,
    reason: { kind: 'back-to-back', withId: 'sat', text: 'Back-to-back with Show sat' }
  });
  // With room for two a week and no spacing rule, both weeks fill up.
  assert.deepEqual(ids(planFor(solve(candidates, { nightsPerWeek: 2, avoidBackToBack: false }), 'best')), ['sat', 'sun', 'mon', 'tue']);
});

test('budget counts known prices only and reports unknown ones', () => {
  const candidates = [
    night('a', '2026-11-16', 70, { priceUsd: 90 }),
    night('b', '2026-11-18', 68, { priceUsd: 80 }),
    night('c', '2026-11-20', 55, { priceUsd: null }),
    night('d', '2026-11-22', 52, { priceUsd: 0 })
  ];
  const rules = { nightsPerWeek: 4, avoidBackToBack: false };
  const unlimited = planFor(solve(candidates, rules), 'best');
  assert.deepEqual(ids(unlimited), ['a', 'b', 'c', 'd']);
  assert.equal(unlimited.totals.knownCostUsd, 170);
  assert.equal(unlimited.totals.unpricedCount, 1);

  const capped = planFor(solve(candidates, { ...rules, budgetUsd: 130 }), 'best');
  assert.deepEqual(ids(capped), ['a', 'c', 'd'], 'unknown and free prices count as zero');
  assert.equal(capped.totals.knownCostUsd, 90);
  assert.equal(capped.totals.unpricedCount, 1);
  assert.deepEqual(capped.gaveUp, [{
    id: 'b', title: 'Show b', startLocal: '2026-11-18T20:00:00', score: 68,
    reason: { kind: 'budget', text: 'Would put the plan $40 over budget' }
  }]);

  // The budget is a knapsack, not a greedy fill: two cheaper nights beat the single best one.
  const knapsack = [
    night('big', '2026-11-16', 75, { priceUsd: 100 }),
    night('s1', '2026-11-18', 62, { priceUsd: 50 }),
    night('s2', '2026-11-20', 61, { priceUsd: 49.5 })
  ];
  const packed = planFor(solve(knapsack, { ...rules, budgetUsd: 100 }), 'best');
  assert.deepEqual(ids(packed), ['s1', 's2']);
  assert.equal(packed.totals.knownCostUsd, 99.5);
  assert.equal(packed.gaveUp[0].reason.text, 'Would put the plan $99.50 over budget');

  const free = planFor(solve(candidates, { ...rules, budgetUsd: 0 }), 'best');
  assert.deepEqual(ids(free), ['c', 'd']);
});

test('trips can be turned off, unless pinned', () => {
  const candidates = [trip('fest', ['2026-11-20', '2026-11-21'], 80), night('wed', '2026-11-18', 60)];
  assert.deepEqual(ids(planFor(solve(candidates, { nightsPerWeek: 3 }), 'best')), ['wed', 'fest']);
  const off = planFor(solve(candidates, { includeTrips: false, nightsPerWeek: 3 }), 'best');
  assert.deepEqual(ids(off), ['wed']);
  assert.deepEqual(off.gaveUp[0].reason, { kind: 'trip', text: 'Trips are turned off' });
  const pinned = solve(candidates, { includeTrips: false, nightsPerWeek: 3 }, { pinnedIds: ['fest'] });
  assert.deepEqual(ids(planFor(pinned, 'best')), ['wed', 'fest']);
});

test('a multi-day trip occupies every day and one weekly slot per day', () => {
  // Fri 20 + Sat 21 are both in the week of Mon 16.
  const candidates = [trip('fest', ['2026-11-20', '2026-11-21'], 70), night('wed', '2026-11-18', 65), night('sat', '2026-11-21', 90)];
  const result = solve(candidates.slice(0, 2), { nightsPerWeek: 2 });
  const best = planFor(result, 'best');
  assert.deepEqual(ids(best), ['fest'], 'the trip uses both of the week\'s nights');
  assert.equal(best.totals.nights, 2);
  assert.deepEqual(best.gaveUp[0].reason, { kind: 'weekly-cap', text: 'Would be a third night that week' });
  assert.deepEqual(ids(planFor(solve(candidates.slice(0, 2), { nightsPerWeek: 3 }), 'best')), ['wed', 'fest']);

  // A single night on one of the trip's days conflicts with the whole trip.
  const clash = planFor(solve(candidates, { nightsPerWeek: 3 }), 'best');
  assert.deepEqual(ids(clash), ['wed', 'sat']);
  assert.deepEqual(clash.gaveUp[0].reason, { kind: 'same-day', withId: 'sat', text: 'Overlaps Show sat' });

  // A trip across Sunday/Monday uses one slot in each week, and its own days are not "back-to-back".
  const spanning = [trip('nye', ['2026-11-22', '2026-11-23'], 75), night('thu', '2026-11-19', 60), night('wed2', '2026-11-25', 60), night('tue2', '2026-11-24', 88)];
  const across = planFor(solve(spanning, { nightsPerWeek: 2, avoidBackToBack: true }), 'best');
  assert.deepEqual(ids(across), ['thu', 'nye', 'wed2']);
  assert.equal(across.totals.nights, 4);
  assert.deepEqual(across.gaveUp[0].reason, { kind: 'back-to-back', withId: 'nye', text: 'Back-to-back with Festival nye' });

  // A two-day trip does not fit a one-night week at all.
  const tight = planFor(solve([trip('fest', ['2026-11-20', '2026-11-21'], 95)], { nightsPerWeek: 1 }), 'best');
  assert.deepEqual(ids(tight), []);
  assert.equal(tight.gaveUp[0].reason.text, 'Would make 2 nights that week, over your limit of 1');
});

test('a trip whose days are not consecutive leaves the gap open', () => {
  const candidates = [trip('split', ['2026-11-17', '2026-11-19'], 80), night('between', '2026-11-18', 70), night('after', '2026-11-21', 60)];
  const apart = planFor(solve(candidates, { nightsPerWeek: 4, avoidBackToBack: true }), 'best');
  assert.deepEqual(ids(apart), ['split', 'after']);
  assert.equal(apart.gaveUp[0].reason.kind, 'back-to-back');
  const together = planFor(solve(candidates, { nightsPerWeek: 4, avoidBackToBack: false }), 'best');
  assert.deepEqual(ids(together), ['split', 'between', 'after']);
  assert.equal(together.totals.nights, 4);
});

test('pinned nights are fixed points the plan is built around', () => {
  const candidates = [
    night('held', '2026-11-17', 20, { priceUsd: 150 }),
    night('rival', '2026-11-17', 95),
    night('next', '2026-11-18', 90),
    night('thu', '2026-11-19', 60, { priceUsd: 30 }),
    night('sat', '2026-11-21', 70),
    night('sun', '2026-11-22', 65, { priceUsd: null })
  ];
  const result = solve(candidates, { nightsPerWeek: 2 }, { pinnedIds: ['held', 'not-in-window'] });
  assert.deepEqual(result.pinned, ['held']);
  assert.deepEqual(result.pinnedConflicts, []);
  for (const plan of result.plans) {
    const held = plan.picks.find((pick) => pick.id === 'held');
    assert.equal(held.pinned, true, 'a pinned night below the bar is in every plan');
    assert.equal(held.why, 'pinned: you saved this');
  }
  const best = planFor(result, 'best');
  // The pinned night takes its day, the day after, and one of the week's two slots.
  assert.deepEqual(ids(best), ['held', 'sat']);
  assert.equal(best.totals.value, 20 - 40 + 30);
  assert.deepEqual(best.gaveUp.map((item) => [item.id, item.reason.kind, item.reason.withId ?? null]), [
    ['rival', 'same-day', 'held'],
    ['next', 'back-to-back', 'held'],
    ['sun', 'back-to-back', 'sat']
  ]);

  // Pinned spending comes out of the budget; what is left is zero, never negative.
  const spending = [candidates[0], candidates[3], candidates[4]];
  const overBudget = planFor(solve(spending, { nightsPerWeek: 3, budgetUsd: 100 }, { pinnedIds: ['held'] }), 'best');
  assert.deepEqual(ids(overBudget), ['held', 'sat'], 'unpriced nights still fit; the priced one does not');
  assert.equal(overBudget.totals.knownCostUsd, 150);
  assert.deepEqual(overBudget.gaveUp, [{
    id: 'thu', title: 'Show thu', startLocal: '2026-11-19T20:00:00', score: 60,
    reason: { kind: 'budget', text: 'Would put the plan $80 over budget' }
  }]);
});

test('two pinned nights on the same day are both kept and reported', () => {
  const candidates = [
    night('a', '2026-11-17', 70), night('b', '2026-11-17', 30), night('c', '2026-11-19', 80), night('d', '2026-11-21', 75),
    trip('t', ['2026-11-19', '2026-11-20'], 50)
  ];
  const result = solve(candidates, { nightsPerWeek: 2 }, { pinnedIds: ['b', 'a', 't', 'c'] });
  assert.deepEqual(result.pinned, ['a', 'b', 'c', 't']);
  assert.deepEqual(result.pinnedConflicts, [{ ids: ['a', 'b'], day: '2026-11-17' }, { ids: ['c', 't'], day: '2026-11-19' }]);
  assert.equal(result.plans.length, 1);
  const best = result.plans[0];
  assert.deepEqual(ids(best), ['a', 'b', 'c', 't']);
  assert.deepEqual(best.alsoLenses, ['easy', 'mix']);
  assert.equal(best.totals.nights, 3, 'three distinct days are occupied');
  assert.equal(best.gaveUp[0].id, 'd');
  assert.equal(best.gaveUp[0].reason.kind, 'back-to-back');

  // Pinned nights alone may exceed the weekly cap; nothing is dropped and nothing is added.
  const over = solve([night('a', '2026-11-16', 70), night('b', '2026-11-18', 70), night('c', '2026-11-20', 70), night('d', '2026-11-22', 99)],
    { nightsPerWeek: 2 }, { pinnedIds: ['a', 'b', 'c'] });
  assert.deepEqual(ids(over.plans[0]), ['a', 'b', 'c']);
  assert.equal(over.plans[0].gaveUp[0].reason.text, 'Would be a fourth night that week');
});

test('excluded ids are removed entirely', () => {
  const candidates = [night('a', '2026-11-17', 90), night('b', '2026-11-17', 60), night('c', '2026-11-19', 55)];
  const result = solve(candidates, {}, { excludedIds: ['a', 'missing'] });
  assert.equal(result.consideredCount, 2);
  const best = planFor(result, 'best');
  assert.deepEqual(ids(best), ['b', 'c']);
  assert.ok(!best.gaveUp.some((item) => item.id === 'a'));
  // Saved and passed-on at once: the saved night stays.
  const both = solve(candidates, {}, { excludedIds: ['a'], pinnedIds: ['a'] });
  assert.deepEqual(ids(planFor(both, 'best')), ['a', 'c']);
});

test('the three lenses trade score, effort and variety against each other', () => {
  const candidates = [
    night('a', '2026-11-17', 70, { hassle: 5, venue: 'Forum' }),
    night('b', '2026-11-19', 66, { venue: 'Forum' }),
    night('c', '2026-11-21', 60, { venue: 'Forum' }),
    game('Packers', '2026-11-21', 59, { hassle: 1 })
  ];
  const result = solve(candidates, { nightsPerWeek: 2 });
  assert.deepEqual(result.plans.map((plan) => plan.lens), ['best', 'easy', 'mix']);
  const [best, easy, mix] = result.plans;

  assert.deepEqual([best.label, easy.label, mix.label], ['Best nights', 'Least effort', 'Widest mix']);
  assert.equal(best.tagline, 'The highest-value way to spend the next 30 days.');
  assert.deepEqual(ids(best), ['a', 'b']);
  assert.deepEqual(ids(easy), ['b', 'c']);
  assert.deepEqual(ids(mix), ['a', 'Packers']);

  assert.equal(best.totals.value, 30 + 26);
  assert.equal(easy.totals.value, (26 - 4) + (20 - 4));
  assert.equal(mix.totals.value, 30 + 19 + 2 * PLAN_POLICY.mix.kindBonus + 2 * PLAN_POLICY.mix.venueBonus);
  for (const plan of result.plans) assert.equal(plan.totals.value, objective(plan.lens, plan.picks));

  assert.deepEqual(best.totals, {
    score: 136, value: 56, nights: 2, knownCostUsd: 0, unpricedCount: 2, hassle: 5, averageHassle: 2.5,
    verticals: { music: 2, sports: 0 }, newCount: 0
  });
  assert.equal(best.versusBest, null);
  assert.deepEqual(easy.versusBest, { score: -10, knownCostUsd: 0, hassle: -5, nights: 0 });
  assert.deepEqual(mix.versusBest, { score: -7, knownCostUsd: 0, hassle: 1, nights: 0 });
  assert.deepEqual(mix.totals.verticals, { music: 1, sports: 1 });

  assert.deepEqual(best.picks.map((pick) => pick.why), ['top score that week', 'fits around the rest of the plan']);
  assert.deepEqual(easy.picks.map((pick) => pick.why), ['lowest-effort good night that week', 'lowest-effort good night that week']);
  assert.deepEqual(mix.picks.map((pick) => pick.why), ['adds live music to the mix', 'adds football to the mix']);
  assert.deepEqual(mix.gaveUp[0].reason, { kind: 'weekly-cap', text: 'Would be a third night that week' });
  assert.deepEqual(mix.gaveUp[1].reason, { kind: 'same-day', withId: 'Packers', text: 'Same night as Rams vs. Packers' });
});

test('variety bonuses are concave and never override a large score gap', () => {
  // Discoveries pay for the first two only.
  const discoveries = [
    night('n1', '2026-11-17', 50, { isNew: true, tier: 'similar', venue: 'Room' }),
    night('n2', '2026-11-19', 50, { isNew: true, tier: 'similar', venue: 'Room' }),
    night('n3', '2026-11-24', 50, { isNew: true, tier: 'similar', venue: 'Room' }),
    night('old', '2026-11-24', 52, { venue: 'Room' })
  ];
  const mix = planFor(solve(discoveries), 'mix');
  assert.deepEqual(ids(mix), ['n1', 'n2', 'old'], 'a third discovery earns nothing, so the higher score wins');
  assert.equal(mix.totals.newCount, 2);
  assert.equal(objective('mix', mix.picks), 10 + 10 + 12 + PLAN_POLICY.mix.kindBonus + PLAN_POLICY.mix.venueBonus + 2 * PLAN_POLICY.mix.discoveryBonus);

  // A discovery is worth a marginal swap: three points, enough to beat a two-point lead.
  const swap = solve([night('known', '2026-11-17', 52, { venue: 'Room' }), night('fresh', '2026-11-17', 50, { isNew: true, tier: 'roster', venue: 'Room' })]);
  assert.deepEqual(ids(planFor(swap, 'best')), ['known']);
  const fresh = swap.plans.find((plan) => plan.lens === 'mix');
  assert.deepEqual(ids(fresh), ['fresh']);
  assert.equal(fresh.totals.value, 10 + PLAN_POLICY.mix.kindBonus + PLAN_POLICY.mix.venueBonus + PLAN_POLICY.mix.discoveryBonus);
  assert.equal(fresh.picks[0].why, 'adds a discovery to the mix');
  assert.deepEqual(fresh.gaveUp[0].reason, { kind: 'same-day', withId: 'fresh', text: 'Same night as Show fresh' });

  // A new kind, venue and discovery together are worth 10.5 points: not enough to beat a 20-point gap.
  const gap = [night('strong', '2026-11-17', 80, { venue: 'Room' }), game('Packers', '2026-11-17', 60), night('other', '2026-11-19', 70, { venue: 'Room' })];
  const result = solve(gap);
  assert.deepEqual(ids(planFor(result, 'mix')), ['strong', 'other']);
  assert.equal(result.plans.length, 1);

  // A kind a pinned night already represents earns nothing more.
  const kinds = [game('Packers', '2026-11-17', 45), game('Bears', '2026-11-24', 55), night('m', '2026-11-24', 52)];
  assert.deepEqual(ids(planFor(solve(kinds.slice(1)), 'mix')), ['Bears'], 'unpinned, football is as new a kind as music');
  const withPinned = solve(kinds, {}, { pinnedIds: ['Packers'] });
  assert.deepEqual(ids(planFor(withPinned, 'best')), ['Packers', 'Bears']);
  assert.deepEqual(ids(planFor(withPinned, 'mix')), ['Packers', 'm']);
});

test('lenses that agree are returned once', () => {
  const result = solve([night('only', '2026-11-17', 80)]);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].lens, 'best');
  assert.deepEqual(result.plans[0].alsoLenses, ['easy', 'mix']);
  assert.equal(result.plans[0].versusBest, null);

  // Two agree, one differs: the earlier lens keeps the plan.
  const partial = solve([night('a', '2026-11-17', 70), night('b', '2026-11-19', 45, { hassle: 3 })]);
  assert.deepEqual(partial.plans.map((plan) => [plan.lens, plan.alsoLenses]), [['best', ['mix']], ['easy', []]]);
});

test('every kind of gave-up reason is reported with accurate wording', () => {
  const reasonOf = (plan, id) => plan.gaveUp.find((item) => item.id === id).reason;

  const sameDay = planFor(solve([night('a', '2026-11-17', 70), night('b', '2026-11-17', 60)]), 'best');
  assert.deepEqual(reasonOf(sameDay, 'b'), { kind: 'same-day', withId: 'a', text: 'Same night as Show a' });

  const backToBack = planFor(solve([night('a', '2026-11-17', 70), night('b', '2026-11-18', 60)]), 'best');
  assert.deepEqual(reasonOf(backToBack, 'b'), { kind: 'back-to-back', withId: 'a', text: 'Back-to-back with Show a' });

  const weekly = planFor(solve([night('a', '2026-11-16', 70), night('b', '2026-11-18', 60), night('c', '2026-11-20', 50)], { nightsPerWeek: 1 }), 'best');
  assert.deepEqual(reasonOf(weekly, 'b'), { kind: 'weekly-cap', text: 'Would be a second night that week' });

  const budget = planFor(solve([night('a', '2026-11-16', 70, { priceUsd: 60 }), night('b', '2026-11-18', 60, { priceUsd: 55.5 })], { budgetUsd: 100 }), 'best');
  assert.deepEqual(reasonOf(budget, 'b'), { kind: 'budget', text: 'Would put the plan $15.50 over budget' });

  const trips = planFor(solve([trip('t', ['2026-11-20', '2026-11-21'], 70)], { includeTrips: false }), 'best');
  assert.deepEqual(reasonOf(trips, 't'), { kind: 'trip', text: 'Trips are turned off' });

  const effort = solve([night('a', '2026-11-16', 70), night('b', '2026-11-18', 45, { hassle: 1 }), trip('t', ['2026-11-24', '2026-11-25'], 55)]);
  assert.deepEqual(ids(planFor(effort, 'best')), ['a', 'b', 't']);
  const easy = planFor(effort, 'easy');
  assert.deepEqual(ids(easy), ['a']);
  assert.deepEqual(reasonOf(easy, 'b'), { kind: 'outweighed', text: 'More effort than it adds' });
  assert.deepEqual(reasonOf(easy, 't'), { kind: 'outweighed', text: 'A trip is more effort than it adds' });

  // At most three, highest score first.
  const many = planFor(solve(['a', 'b', 'c', 'd', 'e'].map((id, index) => night(id, '2026-11-17', 90 - index * 5))), 'best');
  assert.deepEqual(many.gaveUp.map((item) => item.score), [85, 80, 75]);
});

test('"stay in" is a valid answer', () => {
  const none = solve([night('a', '2026-11-17', 40), night('b', '2026-11-19', 12), game('Packers', '2026-11-21', 39)]);
  assert.equal(none.empty, true);
  assert.equal(none.consideredCount, 3);
  assert.equal(none.worthwhileCount, 0);
  assert.equal(none.plans.length, 1);
  assert.deepEqual(none.plans[0].picks, []);
  assert.deepEqual(none.plans[0].alsoLenses, ['easy', 'mix']);
  assert.deepEqual(none.plans[0].gaveUp, []);
  assert.equal(none.plans[0].tagline, 'Nothing fits the next 30 days. Staying in is the plan.');
  assert.deepEqual(none.plans[0].totals, {
    score: 0, value: 0, nights: 0, knownCostUsd: 0, unpricedCount: 0, hassle: 0, averageHassle: 0,
    verticals: { music: 0, sports: 0 }, newCount: 0
  });

  for (const input of [undefined, {}, { candidates: null }, { candidates: [null, 3, {}, { id: 'x' }, { id: 'y', days: ['nope'], score: 90 }], now: NOW }]) {
    const result = buildDecisionPlans(input);
    assert.equal(result.empty, true);
    assert.equal(result.plans.length, 1);
    assert.equal(result.consideredCount, 0);
  }
  // Without a clock the window starts at the earliest candidate rather than at a guess.
  const clockless = buildDecisionPlans({ candidates: [night('a', '2026-11-17', 70), night('far', '2027-03-01', 90)] });
  assert.deepEqual(clockless.window, { startDate: '2026-11-17', endDate: '2026-12-16', days: 30 });
  assert.deepEqual(ids(clockless.plans[0]), ['a']);
});

test('output is deterministic and independent of input order', () => {
  const random = mulberry32(20261111);
  const candidates = randomCandidates(random, 60, 45, { venues: 6 });
  const rules = { windowDays: 60, nightsPerWeek: 3, budgetUsd: 600 };
  const pinnedIds = ['c004', 'c031'];
  const excludedIds = ['c010'];
  const first = buildDecisionPlans({ candidates, constraints: rules, pinnedIds, excludedIds, now: NOW });
  const second = buildDecisionPlans({ candidates, constraints: rules, pinnedIds, excludedIds, now: NOW });
  assert.deepEqual(second, first);
  assert.ok(first.plans.length >= 2);

  for (let round = 0; round < 5; round += 1) {
    const shuffled = [...candidates];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    const again = buildDecisionPlans({ candidates: shuffled, constraints: rules, pinnedIds: [...pinnedIds].reverse(), excludedIds, now: NOW });
    assert.deepEqual(again, first);
  }

  // Equal scores: the earlier date wins, then the lower id.
  const ties = [night('z', '2026-11-17', 60), night('m', '2026-11-17', 60), night('a', '2026-11-18', 60)];
  assert.deepEqual(ids(planFor(solve(ties), 'best')), ['m']);
  assert.deepEqual(ids(planFor(solve([...ties].reverse()), 'best')), ['m']);

  // The input is never mutated.
  const frozen = candidates.map((candidate) => Object.freeze({ ...candidate, days: Object.freeze([...candidate.days]) }));
  assert.deepEqual(buildDecisionPlans({ candidates: Object.freeze(frozen), constraints: Object.freeze(rules), pinnedIds, excludedIds, now: NOW }), first);
});

test('exactness: every lens matches brute force on random small instances', () => {
  const random = mulberry32(0x7a57e);
  const pick = (list) => list[Math.floor(random() * list.length)];
  let nonEmpty = 0;
  let differing = 0;
  for (let round = 0; round < 220; round += 1) {
    const candidates = randomCandidates(random, 4 + Math.floor(random() * 9), 16, { venues: 3, tripRate: 0.25 });
    const rules = normalizePlanConstraints({
      windowDays: 30,
      nightsPerWeek: pick([1, 2, 2, 3, 4]),
      budgetUsd: pick([null, null, 0, 60, 150, 300, 450]),
      avoidBackToBack: random() < 0.6,
      includeTrips: random() < 0.8
    });
    const pinnedIds = candidates.filter(() => random() < 0.12).map((candidate) => candidate.id);
    const excludedIds = candidates.filter((candidate) => !pinnedIds.includes(candidate.id) && random() < 0.08).map((candidate) => candidate.id);
    const result = buildDecisionPlans({ candidates, constraints: rules, pinnedIds, excludedIds, now: NOW });
    const context = JSON.stringify({ round, rules, pinnedIds, excludedIds });
    const pinned = candidates.filter((candidate) => pinnedIds.includes(candidate.id));

    assert.ok(result.plans.length >= 1 && result.plans.length <= 3, context);
    if (result.plans.length > 1) differing += 1;
    for (const lens of PLAN_POLICY.lensOrder) {
      const plan = planFor(result, lens);
      assert.ok(plan, `${lens} missing: ${context}`);
      assert.equal(plan.exact, true, context);
      const picks = plan.picks.map((item) => candidates.find((candidate) => candidate.id === item.id));
      const added = picks.filter((item) => !pinnedIds.includes(item.id));
      assert.equal(picks.length - added.length, pinned.length, `every pinned night is kept: ${context}`);
      assert.ok(added.every((item) => item.score > PLAN_POLICY.bar && !excludedIds.includes(item.id)), context);
      assert.ok(feasible(added, pinned, rules), `${lens} broke a hard constraint: ${context}`);
      const expected = bruteForce(lens, candidates, rules, pinnedIds, excludedIds);
      assert.ok(Math.abs(objective(lens, picks) - expected) < 1e-9, `${lens}: got ${objective(lens, picks)}, optimum ${expected}: ${context}`);
      if (plan.lens === lens) assert.ok(Math.abs(plan.totals.value - expected) < 1e-9, context);
      if (plan.picks.length) nonEmpty += 1;

      // Every stated reason must be true of the finished plan.
      for (const item of plan.gaveUp) {
        const candidate = candidates.find((entry) => entry.id === item.id);
        const blocked = !feasible([...added, candidate], pinned, rules);
        assert.equal(item.reason.kind !== 'outweighed', blocked, `${lens} ${item.id} ${item.reason.kind}: ${context}`);
        if (item.reason.kind === 'outweighed') assert.equal(lens, 'easy', context);
        if (item.reason.withId) assert.ok(plan.picks.some((entry) => entry.id === item.reason.withId), context);
      }
    }
  }
  // The generator must actually exercise the solver, not produce trivial cases.
  assert.ok(nonEmpty > 400, `only ${nonEmpty} non-empty plans`);
  assert.ok(differing > 60, `lenses differed in only ${differing} rounds`);
});

test('a realistic large window solves exactly and quickly', (t) => {
  const random = mulberry32(90130);
  const candidates = randomCandidates(random, 130, 90, { venues: 12, tripRate: 0.04 });
  const setups = [
    { constraints: { windowDays: 90 } },
    { constraints: { windowDays: 90, nightsPerWeek: 3, budgetUsd: 900 }, pinnedIds: ['c007', 'c064'] },
    { constraints: { windowDays: 90, nightsPerWeek: 7, avoidBackToBack: false, budgetUsd: 2500 }, excludedIds: ['c011'] }
  ];
  // Warm up once so the measurement is of the solver, not of first-call compilation.
  buildDecisionPlans({ candidates, now: NOW, ...setups[0] });
  let slowest = 0;
  for (const setup of setups) {
    const started = performance.now();
    const result = buildDecisionPlans({ candidates, now: NOW, ...setup });
    const elapsed = performance.now() - started;
    slowest = Math.max(slowest, elapsed);
    assert.equal(result.consideredCount, 130 - (setup.excludedIds?.length ?? 0));
    assert.ok(result.worthwhileCount > 80);
    assert.ok(result.plans.length >= 2);
    assert.ok(result.plans.every((plan) => plan.exact), 'all three lenses are solved to optimality');
    assert.ok(planFor(result, 'best').picks.length >= 12);
    assert.ok(elapsed < 1500, `three lenses took ${elapsed.toFixed(1)} ms`);
  }
  t.diagnostic(`130 candidates / 90 days, three lenses: slowest ${slowest.toFixed(1)} ms`);
});

test('an exhausted search budget returns the best plan found and says so', () => {
  const random = mulberry32(77);
  const candidates = randomCandidates(random, 60, 40, { venues: 5 });
  const rules = { windowDays: 60, nightsPerWeek: 3, budgetUsd: 500 };
  const full = buildDecisionPlans({ candidates, constraints: rules, now: NOW });
  const starved = buildDecisionPlans({ candidates, constraints: rules, now: NOW, policy: { ...PLAN_POLICY, nodeBudget: 3 } });
  assert.ok(full.plans.every((plan) => plan.exact));
  assert.ok(starved.plans.every((plan) => !plan.exact));
  const normalized = normalizePlanConstraints(rules);
  for (const plan of starved.plans) {
    const picks = plan.picks.map((item) => candidates.find((candidate) => candidate.id === item.id));
    assert.ok(feasible(picks, [], normalized), 'a truncated plan still obeys every hard constraint');
    assert.ok(plan.totals.value <= planFor(full, plan.lens).totals.value);
  }
});

test('a second listing of a night already in the plan is not reported as left out', () => {
  const night = (id, score, title = 'Solomun') => ({ id, vertical: 'music', title, startLocal: '2026-11-28T21:00:00', days: ['2026-11-28'], score, hassle: 2, priceUsd: null, venue: 'Hollywood BLVD', tier: 'direct', isTrip: false, isNew: false });
  const result = buildDecisionPlans({
    candidates: [night('late', 46), night('early', 44, 'Solomun (21+)'), night('other', 43, 'Someone Else')],
    constraints: normalizePlanConstraints({ windowDays: 30, nightsPerWeek: 2 }),
    now: '2026-11-11'
  });
  const best = result.plans[0];
  assert.deepEqual(best.picks.map((pick) => pick.id), ['late']);
  assert.deepEqual(best.gaveUp.map((item) => [item.id, item.reason.kind]), [['other', 'same-day']]);
});
