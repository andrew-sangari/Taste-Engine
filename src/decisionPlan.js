// The decision planner. Pure (no I/O, no clock, no randomness): the site bundles
// it and re-solves in the browser whenever the person saves or passes on
// something, so the same input must always give the same plans.
//
// A ranked list answers "what is good". This answers "what should I actually
// do": given everything ranked in a window, which combination of nights is
// worth going to under the person's own limits, and what does each alternative
// give up. It is a small exact optimizer, not a heuristic and not a model.
//
// Design:
// - Three lenses share the same hard constraints and differ only in objective,
//   so the alternatives are honest trade-offs rather than three rankings.
// - A night is only worth planning above a bar. Value is `score - bar`, so
//   "stay in" is a valid answer and an extra mediocre night never pads a plan.
// - Things the person saved or holds are fixed points. The solver fills around
//   them and reports a clash; it never drops one silently.
// - Prices are never guessed. An unknown price counts as $0 toward a budget
//   and is surfaced through `unpricedCount`.
// - Every "why" and every "gave up" reason is composed from the numbers the
//   solver used, so the wording cannot drift from the result.
export const PLAN_POLICY = Object.freeze({
  version: 1,
  // A score at or below the bar is not worth a night and is never picked
  // unless pinned.
  bar: 40,
  windowDayOptions: Object.freeze([14, 30, 60, 90]),
  maxNightsPerWeek: 7,
  maxBudgetUsd: 100000,
  // Longest window `planCandidates` will normalize, whatever the caller asks.
  maxCandidateWindowDays: 366,
  timeZone: 'America/Los_Angeles',
  lensOrder: Object.freeze(['best', 'easy', 'mix']),
  // "Least effort" prices hassle, charges a flat cost for every night out (so
  // the plan is shorter, not just gentler) and charges a trip once more.
  easy: Object.freeze({ hassleWeight: 3, nightCost: 4, tripPenalty: 10 }),
  // "Widest mix" bonuses are concave: each distinct kind and venue pays once,
  // discoveries pay for the first `discoveryLimit` only. One night can earn at
  // most kind + discovery + venue = 10.5 points, well short of a 20-point gap.
  mix: Object.freeze({ kindBonus: 6, discoveryBonus: 3, discoveryLimit: 2, venueBonus: 1.5 }),
  gaveUpLimit: 3,
  // Search nodes per lens before the solver returns its best so far and marks
  // the plan `exact: false`. Realistic inputs use a few hundred.
  nodeBudget: 250000,
  // States remembered per (day, week load, yesterday) for dominance pruning.
  labelsPerState: 256,
  // How many budget prices (Lagrange multipliers) the upper bound is taken over.
  budgetMultipliers: 12
});

export const DEFAULT_PLAN_CONSTRAINTS = Object.freeze({
  windowDays: 30,
  nightsPerWeek: 2,
  budgetUsd: null,
  avoidBackToBack: true,
  includeTrips: true
});

const LENS_COPY = {
  best: { label: 'Best nights', tagline: (days) => `The highest-value way to spend the next ${days} days.` },
  easy: { label: 'Least effort', tagline: () => 'Fewer, easier nights that still clear the bar.' },
  mix: { label: 'Widest mix', tagline: () => 'A spread across kinds of night, venues and discoveries.' }
};

// Objective values are integer hundredths of a point and prices are integer
// cents, so sums and ties are exact and never depend on float rounding.
const UNIT = 100;
const DAY_MS = 86_400_000;
const NO_CLAIMS = Object.freeze([]);
const NO_BITS = Object.freeze([]);
const BITS_PER_WORD = 30;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
// Same nicknames `src/overview.js` uses: the MLB feed's short names are city
// names ("Arizona", "LA Dodgers"), so the nickname is read from the full name.
const TEAM_NICKNAMES = ['Dodgers', 'Diamondbacks', 'Padres', 'Giants', 'Yankees', 'Mets', 'Cubs', 'Cardinals', 'Astros', 'Red Sox', 'Braves', 'Phillies', 'Brewers', 'Marlins', 'Nationals', 'Reds', 'Pirates', 'Rockies', 'Tigers', 'Twins', 'White Sox', 'Guardians', 'Rays', 'Blue Jays', 'Orioles', 'Royals', 'Angels', 'Athletics', 'Mariners', 'Rangers'];
const ORDINALS = ['', 'a first', 'a second', 'a third', 'a fourth', 'a fifth', 'a sixth', 'a seventh', 'an eighth'];

/**
 * Clamp untrusted constraints (they are synced from a browser) into a full,
 * valid object. Unknown keys are dropped, bad values fall back to the default,
 * and nothing here can throw.
 */
export function normalizePlanConstraints(input) {
  const result = { ...DEFAULT_PLAN_CONSTRAINTS };
  let source;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
    source = {
      windowDays: input.windowDays,
      nightsPerWeek: input.nightsPerWeek,
      budgetUsd: input.budgetUsd,
      avoidBackToBack: input.avoidBackToBack,
      includeTrips: input.includeTrips
    };
  } catch {
    return result;
  }
  const windowDays = plainNumber(source.windowDays);
  if (PLAN_POLICY.windowDayOptions.includes(windowDays)) result.windowDays = windowDays;
  const nights = plainNumber(source.nightsPerWeek);
  if (Number.isFinite(nights)) result.nightsPerWeek = Math.max(1, Math.min(PLAN_POLICY.maxNightsPerWeek, Math.round(nights)));
  const budget = source.budgetUsd == null ? NaN : plainNumber(source.budgetUsd);
  if (Number.isFinite(budget)) result.budgetUsd = Math.round(Math.max(0, Math.min(PLAN_POLICY.maxBudgetUsd, budget)) * 100) / 100;
  if (typeof source.avoidBackToBack === 'boolean') result.avoidBackToBack = source.avoidBackToBack;
  if (typeof source.includeTrips === 'boolean') result.includeTrips = source.includeTrips;
  return result;
}

/**
 * Normalize published music and sports rows into uniform plan candidates whose
 * local start date falls in `[today, today + windowDays)`.
 *
 * "Today" is a Los Angeles calendar date. A zone-less string (`'2026-11-11'`,
 * `'2026-11-11T19:30:00'`) is already local wall-clock time, like `startLocal`,
 * and its first ten characters are used as given. A Date, an epoch number or a
 * string carrying `Z` or an offset is an instant and is converted to the Los
 * Angeles date. An unusable `now` yields no candidates rather than a guess.
 */
export function planCandidates({ events = [], sports = [], now, windowDays } = {}) {
  const today = todayNumber(now);
  if (today == null) return [];
  const requested = plainNumber(windowDays);
  const span = Number.isFinite(requested) && requested >= 1
    ? Math.min(PLAN_POLICY.maxCandidateWindowDays, Math.floor(requested))
    : DEFAULT_PLAN_CONSTRAINTS.windowDays;
  const candidates = [];
  const collect = (rows, build) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== 'object' || row.id == null || row.ranking?.excluded === true) continue;
      const start = dayNumber(row.startLocal);
      const utility = row.ranking?.utility;
      if (start == null || start < today || start >= today + span) continue;
      if (typeof utility !== 'number' || !Number.isFinite(utility)) continue;
      candidates.push(build(row, start));
    }
  };
  collect(events, musicCandidate);
  collect(sports, sportsCandidate);
  return candidates.sort((left, right) => compareText(left.startLocal, right.startLocal) || compareText(left.id, right.id));
}

/**
 * Solve the three lenses over `candidates` and describe each plan: what it
 * picks and why, what it adds up to, what it gave up and for which reason, and
 * how it differs from the best plan.
 *
 * Hard constraints, identical for every lens:
 * 1. One thing per day; a multi-day candidate occupies every one of its days.
 * 2. At most `nightsPerWeek` occupied days per Monday-to-Sunday week.
 * 3. With `avoidBackToBack`, no two different picks on consecutive days.
 * 4. With a budget, the known prices of the picks stay within it. Unknown
 *    prices count as $0 and are reported in `unpricedCount`.
 * 5. With `includeTrips` off, trips are left out unless pinned.
 * 6. `excludedIds` are removed. `pinnedIds` are in every plan whatever they
 *    violate; they use up days, weekly capacity and budget, and whatever is
 *    left (possibly nothing) is filled around them. An id that is both pinned
 *    and excluded stays pinned: losing a held night silently is the worse error.
 *
 * `now` follows `planCandidates`. Without a usable `now` the window starts at
 * the earliest candidate, because this module never reads the clock.
 */
export function buildDecisionPlans({ candidates = [], constraints, pinnedIds = [], excludedIds = [], now, policy = PLAN_POLICY } = {}) {
  const rules = normalizePlanConstraints(constraints);
  const pinnedSet = idSet(pinnedIds);
  const excludedSet = idSet(excludedIds);
  const prepared = prepareCandidates(candidates);
  const start = todayNumber(now, policy.timeZone) ?? (prepared.length ? prepared[0].first : null);
  const end = start == null ? null : start + rules.windowDays - 1;
  const considered = prepared.filter((entry) => entry.first >= start && entry.first <= end
    && (pinnedSet.has(entry.id) || !excludedSet.has(entry.id)));
  const pinned = considered.filter((entry) => pinnedSet.has(entry.id));
  const worthwhile = considered.filter((entry) => entry.score > policy.bar);
  const env = planEnvironment(considered, pinned, rules, policy);

  const solved = [];
  for (const lens of policy.lensOrder) {
    const model = buildModel(lens, env, policy);
    const outcome = search(model, policy.nodeBudget, policy.labelsPerState);
    const picks = [...pinned, ...outcome.entries].sort(compareEntries);
    const signature = picks.map((entry) => entry.id).join('\u0000');
    const twin = solved.find((plan) => plan.signature === signature);
    if (twin) {
      twin.alsoLenses.push(lens);
      // The shared answer is only as proven as its weakest search.
      twin.exact = twin.exact && outcome.exact;
      continue;
    }
    solved.push({ lens, alsoLenses: [], picks, signature, exact: outcome.exact });
  }

  const plans = solved.map((plan) => describePlan(plan, { env, worthwhile, rules, policy }));
  const best = plans[0];
  for (const plan of plans.slice(1)) {
    plan.versusBest = {
      score: round2(plan.totals.score - best.totals.score),
      knownCostUsd: round2(plan.totals.knownCostUsd - best.totals.knownCostUsd),
      hassle: round2(plan.totals.hassle - best.totals.hassle),
      nights: plan.totals.nights - best.totals.nights
    };
  }
  return {
    policyVersion: policy.version,
    window: {
      startDate: start == null ? null : dateKey(start),
      endDate: end == null ? null : dateKey(end),
      days: rules.windowDays
    },
    constraints: rules,
    consideredCount: considered.length,
    worthwhileCount: worthwhile.length,
    pinned: pinned.map((entry) => entry.id),
    pinnedConflicts: pinnedConflicts(pinned),
    plans,
    empty: plans.every((plan) => plan.picks.length === 0)
  };
}

// ---------------------------------------------------------------------------
// Candidate normalization

function musicCandidate(row, start) {
  const destination = row.destination && typeof row.destination === 'object' ? row.destination : null;
  const tripDays = uniqueDayNumbers(Array.isArray(destination?.days) ? destination.days : []);
  const tier = typeof row.ranking.discovery?.tier === 'string' ? row.ranking.discovery.tier : null;
  return {
    id: String(row.id),
    vertical: 'music',
    title: String(row.title ?? row.eventName ?? destination?.name ?? 'Untitled event'),
    startLocal: String(row.startLocal),
    days: (tripDays.length ? tripDays : [start]).map(dateKey),
    score: Math.round(row.ranking.utility),
    hassle: hassleOf(row.ranking.hassleScore),
    priceUsd: priceOf(row.ticketObservation?.lowestPriceUsd),
    venue: venueName(row.venue),
    tier,
    isTrip: Boolean(destination),
    // A discovery is anything that reached the list by a path other than the
    // person's own playlists. It is a path, not proof the artist is unheard.
    isNew: tier != null && tier !== 'direct' && tier !== 'none'
  };
}

function sportsCandidate(row, start) {
  const league = String(row.league ?? row.sportsContext?.league ?? '').toLowerCase() === 'nfl' || String(row.id).startsWith('nfl:')
    ? 'nfl'
    : 'mlb';
  const prices = (Array.isArray(row.ticketObservations) ? row.ticketObservations : [])
    .map((observation) => priceOf(observation?.lowestPriceUsd))
    .filter((price) => price != null);
  return {
    id: String(row.id),
    vertical: 'sports',
    league,
    title: `${teamNickname(row.homeTeam, league === 'nfl' ? 'Rams' : 'Dodgers')} vs. ${teamNickname(row.awayTeam, 'Opponent')}`,
    startLocal: String(row.startLocal),
    days: [dateKey(start)],
    score: Math.round(row.ranking.utility),
    hassle: hassleOf(row.ranking.hassleScore),
    priceUsd: prices.length ? Math.min(...prices) : null,
    venue: venueName(row.venue),
    tier: null,
    isTrip: false,
    isNew: false
  };
}

function teamNickname(team, fallback) {
  const name = String(team?.name ?? team?.shortName ?? '').trim();
  if (!name) return fallback;
  const lowered = name.toLowerCase();
  const known = TEAM_NICKNAMES.find((nickname) => lowered.includes(nickname.toLowerCase()));
  if (known) return known;
  return String(team.shortName ?? name).replace(/^Arizona$/i, 'Diamondbacks').replace(/^(Los Angeles|LA)\s+/i, '').trim() || fallback;
}

function venueName(venue) {
  if (typeof venue === 'string') return venue.trim();
  return typeof venue?.name === 'string' ? venue.name.trim() : '';
}

function priceOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function hassleOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(10, value)) : 0;
}

/**
 * Turn caller-supplied candidates into solver entries in one canonical order
 * (first day, then id), so the result does not depend on input order. Anything
 * without an id, a date or a score is ignored rather than guessed at.
 */
function prepareCandidates(candidates) {
  const entries = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate !== 'object' || candidate.id == null) continue;
    const days = uniqueDayNumbers(Array.isArray(candidate.days) && candidate.days.length ? candidate.days : [candidate.startLocal]);
    const score = plainNumber(candidate.score);
    if (!days.length || !Number.isFinite(score)) continue;
    const price = priceOf(candidate.priceUsd);
    const sports = candidate.vertical === 'sports';
    entries.push({
      id: String(candidate.id),
      candidate,
      days,
      first: days[0],
      weeks: weekCounts(days),
      score,
      hassle: hassleOf(candidate.hassle),
      cents: price == null ? null : Math.round(price * 100),
      isTrip: Boolean(candidate.isTrip),
      isNew: Boolean(candidate.isNew),
      sports,
      kind: sports ? `sports:${String(candidate.league ?? 'mlb').toLowerCase()}` : 'music',
      venueKey: typeof candidate.venue === 'string' ? candidate.venue.trim().toLowerCase() : '',
      title: String(candidate.title ?? candidate.id),
      startLocal: String(candidate.startLocal ?? dateKey(days[0]))
    });
  }
  entries.sort((left, right) => compareEntries(left, right)
    || right.score - left.score
    || compareText(left.title, right.title)
    || compareText(left.days.join(), right.days.join()));
  // A repeated id is one event; the first in canonical order stands for it.
  const seen = new Set();
  return entries.filter((entry) => !seen.has(entry.id) && seen.add(entry.id));
}

// ---------------------------------------------------------------------------
// Constraint environment shared by every lens

/**
 * Everything the pinned nights fix before any lens runs: which days are taken,
 * how much weekly capacity and budget is left, and which other candidates can
 * still be placed at all.
 */
function planEnvironment(considered, pinned, rules, policy) {
  const pinnedDays = new Set();
  for (const entry of pinned) for (const day of entry.days) pinnedDays.add(day);
  const pinnedWeekLoad = new Map();
  for (const day of pinnedDays) pinnedWeekLoad.set(weekIndex(day), (pinnedWeekLoad.get(weekIndex(day)) ?? 0) + 1);
  const capacity = (week) => rules.nightsPerWeek - (pinnedWeekLoad.get(week) ?? 0);
  const budgetCents = rules.budgetUsd == null ? null : Math.round(rules.budgetUsd * 100);
  const pinnedCents = pinned.reduce((sum, entry) => sum + (entry.cents ?? 0), 0);
  // Pinned nights may already exceed the budget; then only free or unpriced
  // nights can still be added, and the remaining budget is zero, not negative.
  const budgetLeft = budgetCents == null ? Infinity : Math.max(0, budgetCents - pinnedCents);
  const blocked = (day) => pinnedDays.has(day)
    || (rules.avoidBackToBack && (pinnedDays.has(day - 1) || pinnedDays.has(day + 1)));
  const pinnedIdSet = new Set(pinned.map((entry) => entry.id));
  const pool = considered.filter((entry) => !pinnedIdSet.has(entry.id)
    && entry.score > policy.bar
    && (rules.includeTrips || !entry.isTrip)
    && !entry.days.some(blocked)
    && entry.weeks.every(([week, count]) => count <= capacity(week))
    && (entry.cents ?? 0) <= budgetLeft);
  return { considered, pinned, pool, capacity, budgetCents, budgetLeft, avoid: rules.avoidBackToBack };
}

function pinnedConflicts(pinned) {
  const conflicts = [];
  for (let a = 0; a < pinned.length; a += 1) {
    for (let b = a + 1; b < pinned.length; b += 1) {
      const day = pinned[a].days.find((value) => pinned[b].days.includes(value));
      if (day != null) conflicts.push({ ids: [pinned[a].id, pinned[b].id], day: dateKey(day) });
    }
  }
  return conflicts.sort((left, right) => compareText(left.day, right.day));
}

// ---------------------------------------------------------------------------
// Objectives

/** The part of a lens's objective that belongs to one night alone, in hundredths. */
function nightValue(lens, entry, policy) {
  const base = entry.score - policy.bar;
  if (lens !== 'easy') return Math.round(base * UNIT);
  const effort = policy.easy.hassleWeight * entry.hassle
    + policy.easy.nightCost * entry.days.length
    + (entry.isTrip ? policy.easy.tripPenalty : 0);
  return Math.round((base - effort) * UNIT);
}

/**
 * The full objective of a finished pick set, computed directly from the
 * definition rather than from solver state, so `totals.value` is checkable.
 */
function objectiveValue(lens, picks, policy) {
  let value = picks.reduce((sum, entry) => sum + nightValue(lens, entry, policy), 0);
  if (lens === 'mix') {
    const kinds = new Set(picks.map((entry) => entry.kind));
    const venues = new Set(picks.map((entry) => entry.venueKey).filter(Boolean));
    const discoveries = Math.min(policy.mix.discoveryLimit, picks.filter((entry) => entry.isNew).length);
    value += kinds.size * Math.round(policy.mix.kindBonus * UNIT)
      + venues.size * Math.round(policy.mix.venueBonus * UNIT)
      + discoveries * Math.round(policy.mix.discoveryBonus * UNIT);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Solver
//
// Depth-first branch and bound over the days that have a candidate, in date
// order. At each day the search either skips it or takes one candidate that
// starts there. Three things keep it exact and small:
//
// 1. A tight admissible bound. Without the budget and the shared variety
//    bonuses the problem is a dynamic program over (day, nights used this
//    week, was yesterday taken), and that program is solved up front. Its table
//    is the bound, so for the "best" and "easy" lenses with no budget the first
//    descent is already optimal. The budget is priced in with Lagrange
//    multipliers (one table per price of a dollar; any price gives a valid
//    bound, the minimum is used) and shared variety bonuses are added as the
//    most that could still be earned.
// 2. Best-first ordering, so the first leaf reached is a strong incumbent.
// 3. Dominance: a state reached again with no more value, no more budget and
//    no more variety still to earn than before cannot do better, and is cut.
//
// Later days of a multi-day pick are carried as "claims" so any set of days,
// contiguous or not, is handled by the same rules.
//
// Measured on 130 candidates over 90 days: a few hundred to a few thousand
// nodes and single-digit milliseconds for all three lenses. The known hard
// case is "Widest mix" with a binding budget when nearly every candidate is
// worthwhile, priced, and priced in step with its score: that can reach the
// node budget (about half a second) and comes back marked `exact: false`.

/**
 * Build one lens's search model from the candidates that can still be placed.
 * Variety bonuses that only one candidate can earn are folded into that
 * candidate's own value; only bonuses several candidates compete for are
 * tracked as search state.
 */
function buildModel(lens, env, policy) {
  const budgeted = env.budgetLeft !== Infinity;
  const items = [];
  for (const entry of env.pool) {
    const value = nightValue(lens, entry, policy);
    if (value > 0) items.push({ entry, value, cost: budgeted ? entry.cents ?? 0 : 0, days: entry.days, weeks: entry.weeks, features: [], tracksNew: false });
  }
  const bonuses = [];
  let venueBitsFrom = 0;
  let slots = 0;
  const discoveryBonus = Math.round(policy.mix.discoveryBonus * UNIT);
  const kindBonus = Math.round(policy.mix.kindBonus * UNIT);
  const venueBonus = Math.round(policy.mix.venueBonus * UNIT);
  if (lens === 'mix') {
    const share = (keyOf, bonus) => {
      // What a pinned night already represents has been earned and cannot be earned again.
      const earned = new Set(env.pinned.map(keyOf));
      const groups = new Map();
      for (const item of items) {
        const key = keyOf(item.entry);
        if (!key || earned.has(key)) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      for (const group of groups.values()) {
        if (group.length === 1) {
          group[0].value += bonus;
          continue;
        }
        const bit = bonuses.push(bonus) - 1;
        for (const item of group) item.features.push(bit);
      }
    };
    share((entry) => entry.kind, kindBonus);
    venueBitsFrom = bonuses.length;
    share((entry) => entry.venueKey, venueBonus);
    const open = Math.max(0, policy.mix.discoveryLimit - env.pinned.filter((entry) => entry.isNew).length);
    const discoveries = items.filter((item) => item.entry.isNew);
    if (discoveries.length <= open) {
      for (const item of discoveries) item.value += discoveryBonus;
    } else if (open > 0) {
      slots = open;
      for (const item of discoveries) item.tracksNew = true;
    }
  }

  const dayNums = [...new Set(items.flatMap((item) => item.days))].sort((a, b) => a - b);
  const n = dayNums.length;
  const indexOf = new Map(dayNums.map((day, index) => [day, index]));
  const weekOf = dayNums.map(weekIndex);
  const startsAt = dayNums.map(() => []);
  items.forEach((item, order) => {
    item.order = order;
    // The leading run of consecutive days is what the bound's table models.
    item.run = 1;
    while (item.run < item.days.length && item.days[item.run] === item.days[item.run - 1] + 1) item.run += 1;
    startsAt[indexOf.get(item.days[0])].push(item);
  });

  const words = Math.ceil(bonuses.length / BITS_PER_WORD);
  // Which shared bonuses, and how many discoveries, can still be earned from each day on.
  const openFrom = new Array(n + 1);
  const discoveriesFrom = new Int32Array(n + 1);
  openFrom[n] = new Array(words).fill(0);
  for (let index = n - 1; index >= 0; index -= 1) {
    const open = openFrom[index + 1].slice();
    discoveriesFrom[index] = discoveriesFrom[index + 1];
    for (const item of startsAt[index]) {
      for (const bit of item.features) open[Math.floor(bit / BITS_PER_WORD)] |= 1 << (bit % BITS_PER_WORD);
      if (item.tracksNew) discoveriesFrom[index] += 1;
    }
    openFrom[index] = open;
  }

  const model = {
    n, dayNums, weekOf, startsAt, capacity: env.capacity, avoid: env.avoid, budgetLeft: env.budgetLeft,
    bonuses, words, slots, discoveryBonus, kindBonus, venueBonus, openFrom, discoveriesFrom
  };
  model.multipliers = budgeted ? budgetMultipliers(items, policy.budgetMultipliers) : [0];
  // A shared bonus pays once however many picks carry it, so it can be bounded
  // two ways: as a lump still to be earned (tight when the plan is long and
  // will reach every venue) or as something every pick carrying it earns
  // (tight when few picks remain). Both are valid; the search uses the lower.
  // Kinds are few and always bounded as lumps; venues get both treatments.
  const lumpAll = new Array(words).fill(0);
  const lumpKinds = new Array(words).fill(0);
  bonuses.forEach((_, bit) => {
    lumpAll[Math.floor(bit / BITS_PER_WORD)] |= 1 << (bit % BITS_PER_WORD);
    if (bit < venueBitsFrom) lumpKinds[Math.floor(bit / BITS_PER_WORD)] |= 1 << (bit % BITS_PER_WORD);
  });
  for (const item of items) {
    item.perPick = item.features.reduce((sum, bit) => sum + (bit >= venueBitsFrom ? bonuses[bit] : 0), 0);
  }
  model.kindBits = lumpKinds;
  model.bounds = [{ lumps: lumpAll, tables: model.multipliers.map((multiplier) => relaxedTable(model, multiplier, false)) }];
  if (bonuses.length > venueBitsFrom) {
    model.bounds.push({ lumps: lumpKinds, tables: model.multipliers.map((multiplier) => relaxedTable(model, multiplier, true)) });
  }
  return model;
}

/**
 * Prices of a budget cent to bound with. Each candidate's value-per-cent is a
 * breakpoint of the bound, so a spread of them plus zero (budget ignored) and
 * one above the highest (nothing paid for fits) covers the useful range.
 */
function budgetMultipliers(items, limit) {
  const ratios = [...new Set(items.filter((item) => item.cost > 0).map((item) => item.value / item.cost))].sort((a, b) => a - b);
  if (!ratios.length) return [0];
  const chosen = new Set([0, ratios[ratios.length - 1] * (1 + 1e-9) + 1e-9]);
  if (ratios.length <= limit) {
    for (const ratio of ratios) chosen.add(ratio);
  } else {
    for (let step = 0; step < limit; step += 1) chosen.add(ratios[Math.floor(((step + 0.5) * ratios.length) / limit)]);
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * The relaxed problem, solved exactly: best additive value from day index `i`
 * on, given `u` nights already used in that day's week and whether the day
 * before is taken (`p`). It ignores the budget (priced in through
 * `multiplier`), shared variety bonuses (or, with `perPick`, credits a shared
 * venue bonus to every pick at that venue) and any days of a multi-day
 * candidate after its first consecutive run, so it never underestimates.
 * Layout: `table[(i * 8 + u) * 2 + p]`.
 */
function relaxedTable(model, multiplier, perPick) {
  const { n, dayNums, weekOf, startsAt, capacity, avoid } = model;
  const table = new Float64Array((n + 1) * 16);
  for (let i = n - 1; i >= 0; i -= 1) {
    const sameWeekNext = i + 1 < n && weekOf[i + 1] === weekOf[i];
    for (let u = 0; u < 8; u += 1) {
      for (let p = 0; p < 2; p += 1) {
        let best = table[((i + 1) * 8 + (sameWeekNext ? u : 0)) * 2];
        if (!(avoid && p)) {
          for (const item of startsAt[i]) {
            const value = item.value + (perPick ? item.perPick : 0) - multiplier * item.cost;
            if (value <= 0) continue;
            let used = u;
            let fits = true;
            for (let step = 0; step < item.run && fits; step += 1) {
              if (step > 0 && weekOf[i + step] !== weekOf[i + step - 1]) used = 0;
              used += 1;
              fits = used <= capacity(weekOf[i + step]);
            }
            if (!fits) continue;
            const next = i + item.run;
            let after = 0;
            if (next < n) {
              const carried = weekOf[next] === weekOf[next - 1] ? used : 0;
              const adjacent = dayNums[next] === dayNums[next - 1] + 1 ? 1 : 0;
              after = table[(next * 8 + carried) * 2 + adjacent];
            }
            if (value + after > best) best = value + after;
          }
        }
        table[(i * 8 + u) * 2 + p] = best;
      }
    }
  }
  return table;
}

function search(model, nodeBudget, labelsPerState) {
  const { n, dayNums, weekOf, startsAt, capacity, avoid, bonuses, words, slots, discoveryBonus, kindBonus, venueBonus, kindBits, openFrom, discoveriesFrom, bounds, multipliers } = model;
  const tracksVariety = bonuses.length > 0 || slots > 0;
  const memo = new Map();
  let best = 0;
  let bestChain = null;
  let nodes = 0;
  let exhausted = false;

  // Every tracked bit is a kind or a venue, and each of those pays one amount,
  // so a set of bits is worth two population counts.
  const worth = (word, bits) => (bits
    ? bitCount(bits & kindBits[word]) * kindBonus + bitCount(bits & ~kindBits[word]) * venueBonus
    : 0);

  const claimsInWeek = (claims, week) => {
    let count = 0;
    for (const day of claims) if (weekIndex(day) === week) count += 1;
    return count;
  };

  // Move past day `i`, then past any following days an earlier multi-day pick
  // already occupies, so every search node sits on a day that is still open.
  const advance = (i, u, occupied, claims) => {
    for (;;) {
      const next = i + 1;
      if (next >= n) return { i: n, u: 0, p: 0, claims: NO_CLAIMS };
      const p = occupied && dayNums[next] === dayNums[i] + 1 ? 1 : 0;
      if (weekOf[next] !== weekOf[i]) u = claimsInWeek(claims, weekOf[next]);
      i = next;
      if (!claims.length || claims[0] !== dayNums[i]) return { i, u, p, claims };
      claims = claims.slice(1);
      occupied = true;
    }
  };

  const fits = (item, i, u, claims) => {
    for (const [week, count] of item.weeks) {
      const used = week === weekOf[i] ? u : claimsInWeek(claims, week);
      if (used + count > capacity(week)) return false;
    }
    for (const claim of claims) {
      for (const day of item.days) {
        const gap = claim - day;
        if (gap === 0 || (avoid && (gap === 1 || gap === -1))) return false;
      }
    }
    return true;
  };

  // Shared bonuses `a` has already collected that `b` has not and could still
  // earn from day `i` on: the most `b` can make up on `a` through variety.
  const varietyLead = (i, aBits, aNew, bBits, bNew) => {
    let lead = aNew > bNew ? Math.min(aNew - bNew, discoveriesFrom[i]) * discoveryBonus : 0;
    const open = openFrom[i];
    for (let word = 0; word < words; word += 1) lead += worth(word, aBits[word] & ~bBits[word] & open[word]);
    return lead;
  };

  // Most that can still be added from state onward: never less than the truth.
  const ceiling = (state, left, bits, found) => {
    if (state.i >= n) return 0;
    const offset = (state.i * 8 + state.u) * 2 + state.p;
    const open = openFrom[state.i];
    let lowest = Infinity;
    for (const { tables, lumps } of bounds) {
      let bound = Infinity;
      for (let t = 0; t < tables.length; t += 1) {
        const value = tables[t][offset] + (multipliers[t] ? multipliers[t] * left : 0);
        if (value < bound) bound = value;
      }
      // Reachable values are whole hundredths, so the bound can be floored.
      bound = Math.floor(bound + 1e-6);
      for (let word = 0; word < words; word += 1) bound += worth(word, open[word] & ~bits[word] & lumps[word]);
      if (bound < lowest) lowest = bound;
    }
    return lowest + (slots ? Math.min(slots - found, discoveriesFrom[state.i]) * discoveryBonus : 0);
  };

  const dominated = (state, left, bits, found, value) => {
    const key = state.claims.length
      ? `${state.i}|${state.u}|${state.p}|${state.claims.join(',')}`
      : (state.i * 8 + state.u) * 2 + state.p;
    const label = { value, left, bits, found };
    const seen = memo.get(key);
    if (!seen) {
      memo.set(key, [label]);
      return false;
    }
    for (const earlier of seen) {
      if (earlier.left >= left && earlier.value >= value
        && (!tracksVariety || earlier.value - varietyLead(state.i, earlier.bits, earlier.found, bits, found) >= value)) return true;
    }
    let kept = 0;
    for (const earlier of seen) {
      const beaten = left >= earlier.left && value >= earlier.value
        && (!tracksVariety || value - varietyLead(state.i, bits, found, earlier.bits, earlier.found) >= earlier.value);
      if (!beaten) seen[kept++] = earlier;
    }
    seen.length = kept;
    // Remembering fewer states only prunes less; it keeps one node's cost bounded.
    if (kept < labelsPerState) seen.push(label);
    return false;
  };

  const visit = (state, left, bits, found, value, chain) => {
    if (value > best) {
      best = value;
      bestChain = chain;
    }
    if (state.i >= n) return;
    if (nodes >= nodeBudget) {
      exhausted = true;
      return;
    }
    nodes += 1;
    if (dominated(state, left, bits, found, value)) return;

    const { i, u, p, claims } = state;
    const skipped = advance(i, u, false, claims);
    const options = [{ state: skipped, left, bits, found, value, chain, reach: value + ceiling(skipped, left, bits, found), order: Infinity }];
    if (!(avoid && p)) {
      for (const item of startsAt[i]) {
        if (item.cost > left || !fits(item, i, u, claims)) continue;
        let gain = item.value;
        let nextBits = bits;
        for (const bit of item.features) {
          const word = Math.floor(bit / BITS_PER_WORD);
          const mask = 1 << (bit % BITS_PER_WORD);
          if (nextBits[word] & mask) continue;
          if (nextBits === bits) nextBits = bits.slice();
          nextBits[word] |= mask;
          gain += bonuses[bit];
        }
        let nextFound = found;
        if (item.tracksNew && found < slots) {
          nextFound += 1;
          gain += discoveryBonus;
        }
        const claimed = item.days.length > 1 ? [...claims, ...item.days.slice(1)].sort((a, b) => a - b) : claims;
        const next = advance(i, u + item.weeks[0][1], true, claimed);
        const nextLeft = left - item.cost;
        options.push({
          state: next, left: nextLeft, bits: nextBits, found: nextFound, value: value + gain,
          chain: { item, previous: chain },
          reach: value + gain + ceiling(next, nextLeft, nextBits, nextFound),
          order: item.order
        });
      }
    }
    // Most promising first; on a tie take the earlier candidate before skipping.
    options.sort((a, b) => b.reach - a.reach || a.order - b.order);
    for (const option of options) {
      if (option.reach <= best) break;
      visit(option.state, option.left, option.bits, option.found, option.value, option.chain);
      if (exhausted) return;
    }
  };

  if (n > 0) {
    const origin = { i: 0, u: 0, p: 0, claims: NO_CLAIMS };
    visit(origin, model.budgetLeft, words ? new Array(words).fill(0) : NO_BITS, 0, 0, null);
  }
  const entries = [];
  for (let link = bestChain; link; link = link.previous) entries.push(link.item.entry);
  return { entries: entries.reverse(), exact: !exhausted, nodes };
}

function bitCount(bits) {
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// ---------------------------------------------------------------------------
// Describing a plan

function describePlan(plan, { env, worthwhile, rules, policy }) {
  const { lens, picks } = plan;
  const pinnedIds = new Set(env.pinned.map((entry) => entry.id));
  const occupied = new Map();
  for (const entry of picks) for (const day of entry.days) if (!occupied.has(day)) occupied.set(day, entry);
  const weekLoad = new Map();
  for (const day of occupied.keys()) weekLoad.set(weekIndex(day), (weekLoad.get(weekIndex(day)) ?? 0) + 1);
  const knownCents = picks.reduce((sum, entry) => sum + (entry.cents ?? 0), 0);
  const hassle = picks.reduce((sum, entry) => sum + entry.hassle, 0);
  const pickedIds = new Set(picks.map((entry) => entry.id));
  const pickedListings = new Set(picks.map(listingKey));
  const facts = { lens, picks, pinnedIds, occupied, weekLoad, knownCents, env, rules, policy, exact: plan.exact };

  return {
    lens,
    label: LENS_COPY[lens].label,
    tagline: picks.length ? LENS_COPY[lens].tagline(rules.windowDays) : `Nothing fits the next ${rules.windowDays} days. Staying in is the plan.`,
    alsoLenses: plan.alsoLenses,
    picks: picks.map((entry) => ({ ...entry.candidate, pinned: pinnedIds.has(entry.id), why: whyPicked(entry, facts) })),
    totals: {
      score: round2(picks.reduce((sum, entry) => sum + entry.score, 0)),
      value: objectiveValue(lens, picks, policy) / UNIT,
      nights: occupied.size,
      knownCostUsd: knownCents / 100,
      unpricedCount: picks.filter((entry) => entry.cents == null).length,
      hassle: round2(hassle),
      averageHassle: picks.length ? round2(hassle / picks.length) : 0,
      verticals: { music: picks.filter((entry) => !entry.sports).length, sports: picks.filter((entry) => entry.sports).length },
      newCount: picks.filter((entry) => entry.isNew).length
    },
    gaveUp: worthwhile
      .filter((entry) => !pickedIds.has(entry.id))
      // A second listing of a night already in the plan (an early and a late
      // show, or two ticket listings of one bill) is not a night given up.
      .filter((entry) => !pickedListings.has(listingKey(entry)))
      .sort((left, right) => right.score - left.score || compareEntries(left, right))
      .slice(0, policy.gaveUpLimit)
      .map((entry) => ({ id: entry.id, title: entry.title, startLocal: entry.startLocal, score: entry.score, reason: reasonLeftOut(entry, facts) })),
    versusBest: null,
    exact: plan.exact
  };
}

// The same bill on the same first day, ignoring a parenthetical such as "(21+)".
function listingKey(entry) {
  const title = String(entry.title ?? '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return `${title}|${entry.days[0]}`;
}

/** One short clause, from the plan's own numbers, for why a night is in it. */
function whyPicked(entry, { lens, picks, pinnedIds, env, policy }) {
  if (pinnedIds.has(entry.id)) return 'pinned: you saved this';
  const week = weekIndex(entry.first);
  const sameWeek = env.considered.filter((other) => weekIndex(other.first) === week);
  if (lens === 'mix') {
    const kinds = new Set(picks.map((pick) => pick.kind));
    if (kinds.size > 1 && picks.filter((pick) => pick.kind === entry.kind).length === 1) return `adds ${kindLabel(entry)} to the mix`;
    const counted = picks.filter((pick) => pick.isNew).slice(0, policy.mix.discoveryLimit);
    if (counted.includes(entry)) return 'adds a discovery to the mix';
  }
  if (lens === 'easy' && !entry.isTrip) {
    const good = sameWeek.filter((other) => other.score > policy.bar);
    if (good.every((other) => other.hassle >= entry.hassle)) return 'lowest-effort good night that week';
  }
  if (sameWeek.every((other) => other.score <= entry.score)) return 'top score that week';
  const sameDay = env.considered.filter((other) => other !== entry && other.days.some((day) => entry.days.includes(day)));
  if (sameDay.length && sameDay.every((other) => other.score <= entry.score)) return 'best option that night';
  return 'fits around the rest of the plan';
}

/**
 * Why a worthwhile night is not in the plan: the first thing that blocks
 * adding it to the finished pick set, or, when nothing does, that this lens
 * preferred to leave it out.
 */
function reasonLeftOut(entry, { lens, picks, occupied, weekLoad, knownCents, env, rules, policy, exact }) {
  if (entry.isTrip && !rules.includeTrips) return { kind: 'trip', text: 'Trips are turned off' };
  const single = entry.days.length === 1;
  const clash = picks.find((pick) => pick.days.some((day) => entry.days.includes(day)));
  if (clash) {
    return { kind: 'same-day', withId: clash.id, text: `${single && clash.days.length === 1 ? 'Same night as' : 'Overlaps'} ${clash.title}` };
  }
  if (rules.avoidBackToBack) {
    const neighbour = picks.find((pick) => pick.days.some((day) => entry.days.includes(day - 1) || entry.days.includes(day + 1)));
    if (neighbour) return { kind: 'back-to-back', withId: neighbour.id, text: `Back-to-back with ${neighbour.title}` };
  }
  for (const [week, count] of entry.weeks) {
    const total = (weekLoad.get(week) ?? 0) + count;
    if (total <= rules.nightsPerWeek) continue;
    const text = count === 1 && total < ORDINALS.length
      ? `Would be ${ORDINALS[total]} night that week`
      : `Would make ${total} nights that week, over your limit of ${rules.nightsPerWeek}`;
    return { kind: 'weekly-cap', text };
  }
  if (env.budgetCents != null && (entry.cents ?? 0) > 0 && knownCents + entry.cents > env.budgetCents) {
    return { kind: 'budget', text: `Would put the plan ${dollars(knownCents + entry.cents - env.budgetCents)} over budget` };
  }
  if (lens === 'easy' && nightValue('easy', entry, policy) <= 0) {
    return { kind: 'outweighed', text: entry.isTrip ? 'A trip is more effort than it adds' : 'More effort than it adds' };
  }
  // Nothing blocks it and it would add value: only possible when the search
  // stopped at its node budget before proving the plan.
  return { kind: 'outweighed', text: exact ? 'Left out of this plan' : 'Left out when the search stopped early' };
}

function kindLabel(entry) {
  if (!entry.sports) return 'live music';
  if (entry.kind === 'sports:nfl') return 'football';
  if (entry.kind === 'sports:mlb') return 'baseball';
  return entry.kind.slice('sports:'.length);
}

// ---------------------------------------------------------------------------
// Small helpers

/** Days since 1970-01-01 for a `YYYY-MM-DD…` value, or null. Pure calendar math, no timezone. */
function dayNumber(value) {
  const match = DATE_PATTERN.exec(typeof value === 'string' ? value : '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.round(date.getTime() / DAY_MS);
}

function dateKey(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Monday-to-Sunday week number. Day 0 (1970-01-01) was a Thursday, so Monday is day -3. */
function weekIndex(day) {
  return Math.floor((day + 3) / 7);
}

function weekCounts(days) {
  const counts = new Map();
  for (const day of days) counts.set(weekIndex(day), (counts.get(weekIndex(day)) ?? 0) + 1);
  return [...counts.entries()];
}

function uniqueDayNumbers(values) {
  return [...new Set(values.map(dayNumber).filter((day) => day != null))].sort((a, b) => a - b);
}

function todayNumber(now, timeZone = PLAN_POLICY.timeZone) {
  if (now == null) return null;
  if (typeof now === 'string' && !/T.*(Z|[+-]\d{2}:?\d{2})$/i.test(now.trim())) return dayNumber(now.trim());
  const date = now instanceof Date ? now : new Date(typeof now === 'string' ? now.trim() : now);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = {};
    for (const part of new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)) {
      parts[part.type] = part.value;
    }
    return dayNumber(`${parts.year}-${parts.month}-${parts.day}`);
  } catch {
    return null;
  }
}

/** A number, or a plainly numeric string. Never calls a hostile `valueOf`. */
function plainNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return NaN;
}

function idSet(ids) {
  return new Set((Array.isArray(ids) ? ids : []).filter((id) => id != null).map(String));
}

// Code-unit order, not locale order: the same everywhere the bundle runs.
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(left, right) {
  return left.first - right.first || compareText(left.id, right.id);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function dollars(cents) {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
