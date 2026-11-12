import { classifyEventType } from './eventType.js';
import { callLabel, normalizeArtistName, PROMOTER_SOURCES } from './ranking.js';

// The one feedback-learning policy. Pure (no I/O): the site runs it in the
// browser and on the server through generated bundles, and the local tools run
// it directly, so there is exactly one implementation of the math.
//
// Feedback is a read-time overlay. The published projection always carries
// the canonical, feedback-free scores; `applyFeedbackOverlay` lays the
// person's own reads and outcomes on top when a page is shown, so a new
// answer re-ranks immediately and can be switched off without a refresh.
//
// Design, in place of the previous threshold rules:
// - Every signal is graded. A night you loved, a night that was fine, a date
//   you wanted but missed and a card you waved off all count, with different
//   strength, instead of only "attended twice" unlocking a fixed step.
// - Evidence shrinks toward zero: score = Σ(w·v·d) / (Σ(w·d) + k). One outcome
//   moves a little, several agreeing outcomes move more, mixed outcomes cancel,
//   and old outcomes fade. There is no cliff to tune.
// - Taste and logistics never mix. "Couldn't make the time work" can raise the
//   friction of a venue or weeknight; it can never lower an artist.
// - Keys come from what a card displays (names, venue, promoter, kind of
//   night), frozen into the record when the feedback is given, so an outcome
//   still teaches after the event has left the projection.
export const FEEDBACK_POLICY = Object.freeze({
  version: 4,
  priorStrength: 1.5,
  tasteHalfLifeDays: 365,
  frictionHalfLifeDays: 180,
  caps: Object.freeze({ artist: 6, venue: 3, promoter: 2, shape: 1.5, opponent: 3 }),
  maxTotalAdjustment: 10,
  maxFriction: 2
});

export const INTEREST_STATUS = 'interested';
export const WITHDRAWN_STATUS = 'withdrawn';
export const TASTE_REASONS = Object.freeze(['artist', 'lineup', 'production', 'crowd', 'venue']);
export const LOGISTICS_REASONS = Object.freeze(['timing', 'hassle', 'price', 'distance', 'availability', 'calendar', 'recovery']);

const TASTE_CATEGORIES = ['artist', 'venue', 'promoter', 'shape', 'opponent'];
const FRICTION_CATEGORIES = ['venue', 'weekday', 'shape'];
// What a stated reason (or "what made it") is evidence about.
const REASON_SCOPE = {
  artist: ['artist'],
  lineup: ['artist'],
  venue: ['venue'],
  production: ['venue', 'promoter'],
  crowd: ['venue', 'promoter', 'shape']
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Stable, namespaced keys for anything feedback can be about. Works on a raw
 * candidate and on a published display row, because it reads only fields both
 * carry. Returns `{ category: [{ key, label }] }`.
 */
export function feedbackKeysFor(item, vertical = 'music') {
  if (!item || typeof item !== 'object') return {};
  const keys = {};
  const add = (category, id, label) => {
    const normalized = normalizeArtistName(id);
    if (!normalized) return;
    const list = keys[category] ?? (keys[category] = []);
    const key = `${category}:${normalized}`;
    if (!list.some((entry) => entry.key === key)) list.push({ key, label: String(label ?? id).trim().slice(0, 120) });
  };
  const venue = item.venue ?? {};
  if (venue.name) add('venue', `${venue.name} ${venue.city ?? ''}`, venue.name);
  const weekday = weekdayOf(item.startLocal);
  if (weekday != null) add('weekday', WEEKDAYS[weekday], `${WEEKDAYS[weekday]}s`);
  if (vertical === 'sports') {
    const football = (item.league ?? item.sportsContext?.league) === 'nfl' || String(item.id ?? '').startsWith('nfl:');
    add('shape', football ? 'football' : 'baseball', football ? 'Rams games' : 'Dodgers games');
    const opponent = item.awayTeam?.name ?? item.awayTeam?.shortName;
    if (opponent) add('opponent', opponent, opponent);
    return keys;
  }
  for (const performer of (item.performers ?? []).slice(0, 12)) add('artist', performer?.name, performer?.name);
  const sources = new Set([
    ...(item.sources ?? []),
    ...(item.sourceOccurrences ?? []).map((occurrence) => occurrence?.source),
    item.source
  ].filter(Boolean));
  for (const promoter of item.promoters ?? []) add('promoter', promoter, promoter);
  for (const source of PROMOTER_SOURCES) {
    if (sources.has(source)) add('promoter', source, source === 'insomniac' ? 'Insomniac' : 'Framework');
  }
  const shape = item.eventType ?? classifyEventType(item);
  add('shape', shape, shape === 'dj set' ? 'DJ sets' : `${shape}s`);
  return keys;
}

/**
 * Replay durable records into per-key taste and friction signals.
 * Records are append-only; the latest record for an event is the one that
 * counts, and a `withdrawn` record erases the event's signal.
 */
export function deriveFeedbackSignals(records = [], { now = new Date(), policy = FEEDBACK_POLICY } = {}) {
  const nowMs = new Date(now).getTime();
  const latestByEvent = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const eventKey = `${record.canonicalEventId ?? ''}|${record.eventDateLocal ?? ''}`;
    const current = latestByEvent.get(eventKey);
    if (!current || String(record.recordedAt ?? '') >= String(current.recordedAt ?? '')) latestByEvent.set(eventKey, record);
  }
  const taste = new Map();
  const friction = new Map();
  let countedRecords = 0;
  for (const record of latestByEvent.values()) {
    const reading = readRecord(record);
    if (!reading.taste && !reading.friction) continue;
    const keys = recordKeys(record);
    if (!Object.keys(keys).length) continue;
    countedRecords += 1;
    const date = signalDate(record, nowMs);
    const ageDays = Math.max(0, (nowMs - date) / 86_400_000);
    if (reading.taste) {
      const decay = 2 ** (-ageDays / policy.tasteHalfLifeDays);
      for (const category of reading.taste.categories.filter((item) => TASTE_CATEGORIES.includes(item))) {
        for (const entry of keys[category] ?? []) accumulate(taste, category, entry, reading.taste.value, reading.taste.weight * decay, record);
      }
    }
    if (reading.friction) {
      const decay = 2 ** (-ageDays / policy.frictionHalfLifeDays);
      for (const category of FRICTION_CATEGORIES) {
        for (const entry of keys[category] ?? []) accumulate(friction, category, entry, reading.friction.value, reading.friction.weight * decay, record);
      }
    }
  }
  for (const signal of taste.values()) finalize(signal, policy, policy.caps[signal.category] ?? 0);
  for (const signal of friction.values()) finalize(signal, policy, policy.maxFriction);
  return { policyVersion: policy.version, taste, friction, countedRecords };
}

/**
 * Lay learned taste and friction over published rows. Nothing is mutated and
 * nothing is persisted: the canonical score stays on the row as
 * `ranking.baseUtility`, and every moved row says why.
 *
 * Friction raises (or lowers) the hassle score and costs two utility points
 * per hassle point, exactly as the ranker prices hassle.
 */
export function applyFeedbackOverlay(rows, vertical, signals, { policy = FEEDBACK_POLICY } = {}) {
  const audit = { policyVersion: policy.version, adjustedCount: 0, totalAbsoluteAdjustment: 0, maxTotalAdjustment: policy.maxTotalAdjustment };
  if (!signals?.taste?.size && !signals?.friction?.size) return { rows, audit };
  const adjusted = rows.map((row) => {
    if (!row?.ranking || row.ranking.excluded) return row;
    const keys = row.feedbackKeys && Object.keys(row.feedbackKeys).length ? row.feedbackKeys : feedbackKeysFor(row, vertical);
    const taste = matchSignals(keys, signals.taste, TASTE_CATEGORIES);
    const friction = matchSignals(keys, signals.friction, FRICTION_CATEGORIES);
    const tasteDelta = Math.max(-policy.maxTotalAdjustment, Math.min(policy.maxTotalAdjustment, taste.reduce((sum, match) => sum + match.delta, 0)));
    const baseHassle = Number(row.ranking.hassleScore ?? 0);
    const frictionPoints = Math.max(-policy.maxFriction, Math.min(policy.maxFriction, Math.round(friction.reduce((sum, match) => sum + match.delta, 0))));
    const hassleScore = Math.max(0, Math.min(10, baseHassle + frictionPoints));
    const scoreDelta = round(tasteDelta - (hassleScore - baseHassle) * 2);
    if (!scoreDelta) return row;
    audit.adjustedCount += 1;
    audit.totalAbsoluteAdjustment = round(audit.totalAbsoluteAdjustment + Math.abs(scoreDelta));
    const baseUtility = Number(row.ranking.utility ?? 0);
    const utility = round(baseUtility + scoreDelta);
    const reasons = [
      ...taste.map((match) => ({ kind: 'taste', category: match.category, label: match.label, delta: round(match.delta), outcomes: match.outcomes })),
      ...(hassleScore !== baseHassle
        ? friction.map((match) => ({ kind: 'friction', category: match.category, label: match.label, delta: round(-(hassleScore - baseHassle) * 2 / friction.length), outcomes: match.outcomes }))
        : [])
    ].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
    return {
      ...row,
      ranking: {
        ...row.ranking,
        baseUtility,
        utility,
        hassleScore,
        ...(row.ranking.call ? { call: callLabel(utility) } : {}),
        feedbackAdjustment: { applied: true, scoreDelta, policyVersion: policy.version, reasons }
      }
    };
  });
  return { rows: adjusted, audit };
}

/** A display-safe account of what has been learned, strongest first. */
export function describeLearning(signals, { limit = 12 } = {}) {
  const rows = [];
  for (const [kind, map] of [['taste', signals?.taste], ['friction', signals?.friction]]) {
    for (const signal of map?.values() ?? []) {
      if (Math.abs(signal.delta) < 0.25) continue;
      rows.push({
        kind,
        category: signal.category,
        label: signal.label,
        direction: signal.delta > 0 ? 'up' : 'down',
        strength: round(Math.abs(signal.score)),
        delta: round(signal.delta),
        outcomes: signal.outcomes,
        lastDate: signal.lastDate
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label)).slice(0, limit);
}

// What one record says. Returns a graded taste reading, a friction reading,
// both, or neither.
function readRecord(record) {
  const status = String(record.status ?? '');
  const rating = Number.isInteger(record.rating) ? record.rating : null;
  const reasons = Array.isArray(record.reasonCodes) ? record.reasonCodes.map(String) : [];
  const tags = Array.isArray(record.signalTags) ? record.signalTags.map(String) : [];
  const tasteReasons = reasons.filter((reason) => TASTE_REASONS.includes(reason));
  const logistics = [...reasons, ...tags].some((reason) => LOGISTICS_REASONS.includes(reason));
  const scoped = (names) => {
    const categories = [...new Set(names.flatMap((name) => REASON_SCOPE[name] ?? []))];
    return categories.length ? categories : TASTE_CATEGORIES;
  };
  switch (status) {
    case 'attended-worth-it':
      return {
        taste: { value: rating === 5 ? 1 : 0.6, weight: 1, categories: scoped(tags) },
        // It was worth the trouble: evidence against treating it as friction.
        friction: logistics ? { value: 0.5, weight: 0.5 } : { value: -0.5, weight: 0.5 }
      };
    case 'attended-not-worth-it': {
      const onlyLogistics = logistics && !tasteReasons.length && !tags.some((tag) => REASON_SCOPE[tag]);
      return {
        taste: onlyLogistics ? null : { value: rating === 3 ? -0.3 : -1, weight: 1, categories: scoped([...tasteReasons, ...tags]) },
        friction: logistics ? { value: 1, weight: 0.8 } : null
      };
    }
    case 'wanted-to-attend':
      return { taste: { value: 0.4, weight: 0.5, categories: TASTE_CATEGORIES }, friction: logistics ? { value: 1, weight: 0.4 } : null };
    case INTEREST_STATUS:
      return { taste: { value: rating === 5 ? 0.5 : 0.25, weight: rating === 5 ? 0.5 : 0.35, categories: ['artist', 'promoter', 'opponent'] }, friction: null };
    case 'lost-interest':
      return {
        taste: tasteReasons.length ? { value: -0.7, weight: 0.6, categories: scoped(tasteReasons) } : null,
        friction: logistics ? { value: 1, weight: 0.5 } : null
      };
    case 'did-not-attend-logistical':
      return { taste: null, friction: { value: 1, weight: 0.6 } };
    default:
      return { taste: null, friction: null };
  }
}

function recordKeys(record) {
  const frozen = record.feedbackKeys;
  if (frozen && typeof frozen === 'object' && !Array.isArray(frozen)) {
    const keys = {};
    for (const [category, entries] of Object.entries(frozen)) {
      const list = (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && typeof entry.key === 'string' && entry.key.startsWith(`${category}:`))
        .map((entry) => ({ key: entry.key, label: String(entry.label ?? entry.key.slice(category.length + 1)) }));
      if (list.length) keys[category] = list;
    }
    if (Object.keys(keys).length) return keys;
  }
  // Records captured before keys were frozen carry only a title. Two shapes
  // are unambiguous enough to use; anything else is skipped rather than guessed.
  const title = String(record.eventTitleSnapshot ?? '').replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
  // "Milwaukee Brewers at Los Angeles Dodgers": a game, about the opponent.
  const game = title.match(/^(.+?)\s+at\s+(?:the\s+)?Los Angeles (Dodgers|Rams)$/i);
  if (game) {
    const football = /rams/i.test(game[2]);
    return {
      opponent: [{ key: `opponent:${normalizeArtistName(game[1])}`, label: game[1] }],
      shape: [{ key: `shape:${football ? 'football' : 'baseball'}`, label: football ? 'Rams games' : 'Dodgers games' }]
    };
  }
  // "Headliner" or "Headliner with Support": the headliner.
  const headliner = title.split(/\s+with\s+/i)[0].trim();
  if (headliner && !/[:&,]|\bpresents?\b|\bvs\.?\b|\bat\b|\bfestival\b/i.test(headliner)) {
    return { artist: [{ key: `artist:${normalizeArtistName(headliner)}`, label: headliner }] };
  }
  return {};
}

function accumulate(map, category, entry, value, weight, record) {
  if (!(weight > 0)) return;
  const signal = map.get(entry.key) ?? { key: entry.key, category, label: entry.label, weighted: 0, evidence: 0, events: new Set(), lastDate: null };
  signal.weighted += value * weight;
  signal.evidence += weight;
  signal.events.add(`${record.canonicalEventId}|${record.eventDateLocal}`);
  const date = String(record.eventDateLocal ?? '').slice(0, 10) || null;
  if (date && (!signal.lastDate || date > signal.lastDate)) signal.lastDate = date;
  map.set(entry.key, signal);
}

function finalize(signal, policy, cap) {
  signal.score = signal.weighted / (signal.evidence + policy.priorStrength);
  signal.delta = signal.score * cap;
  signal.outcomes = signal.events.size;
  delete signal.events;
}

// Within a category, the evidence-weighted mean of matching keys, so a
// six-artist bill cannot multiply one category's cap.
function matchSignals(keys, signalMap, categories) {
  const matches = [];
  for (const category of categories) {
    const hits = (keys[category] ?? []).map((entry) => signalMap.get(entry.key)).filter(Boolean);
    if (!hits.length) continue;
    const evidence = hits.reduce((sum, hit) => sum + hit.evidence, 0);
    const delta = hits.reduce((sum, hit) => sum + hit.delta * hit.evidence, 0) / (evidence || 1);
    const strongest = [...hits].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    matches.push({ category, label: strongest.label, delta, outcomes: hits.reduce((sum, hit) => sum + hit.outcomes, 0) });
  }
  return matches;
}

// Outcomes age from the night itself; a signal given before the event ages
// from when it was given.
function signalDate(record, nowMs) {
  const eventMs = Date.parse(`${String(record.eventDateLocal ?? '').slice(0, 10)}T12:00:00Z`);
  const recordedMs = Date.parse(String(record.recordedAt ?? ''));
  if (Number.isFinite(eventMs) && eventMs <= nowMs) return eventMs;
  return Number.isFinite(recordedMs) ? Math.min(recordedMs, nowMs) : nowMs;
}

function weekdayOf(startLocal) {
  const key = String(startLocal ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function round(value) {
  return Math.round(value * 100) / 100;
}
