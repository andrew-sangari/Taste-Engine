import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEEDBACK_POLICY,
  applyFeedbackOverlay,
  deriveFeedbackSignals,
  describeLearning,
  feedbackKeysFor
} from '../src/feedbackPolicy.js';

const NOW = new Date('2026-11-01T12:00:00Z');
const event = (overrides = {}) => ({
  id: 'e1', title: 'Josh Baker', startLocal: '2026-11-21T20:00:00', eventType: 'concert',
  venue: { name: 'Sears Building', city: 'Los Angeles' },
  performers: [{ name: 'Josh Baker', primary: true }],
  sources: ['seatgeek', 'framework'],
  ranking: { utility: 40, call: 'Wildcard', excluded: false },
  ...overrides
});
const record = (overrides = {}) => ({
  feedbackId: `f-${Math.random()}`, canonicalEventId: 'past-1', eventDateLocal: '2026-10-10',
  eventTitleSnapshot: 'Josh Baker', status: 'attended-worth-it', rating: null, reasonCodes: [], signalTags: [],
  recordedAt: '2026-10-11T18:00:00Z', feedbackKeys: feedbackKeysFor(event({ startLocal: '2026-10-10T20:00:00' })),
  ...overrides
});
const artistDelta = (records) => deriveFeedbackSignals(records, { now: NOW }).taste.get('artist:josh baker')?.delta ?? 0;

test('keys are namespaced, display-derived and identical for raw and display rows', () => {
  const keys = feedbackKeysFor(event());
  assert.deepEqual(keys.artist, [{ key: 'artist:josh baker', label: 'Josh Baker' }]);
  assert.equal(keys.venue[0].key, 'venue:sears building los angeles');
  assert.deepEqual(keys.promoter, [{ key: 'promoter:framework', label: 'Framework' }]);
  assert.equal(keys.weekday[0].key, 'weekday:saturday');
  const raw = { ...event(), eventType: undefined, sources: undefined, source: 'seatgeek', sourceOccurrences: [{ source: 'seatgeek' }, { source: 'framework' }] };
  assert.deepEqual(feedbackKeysFor(raw), keys);
  const sports = feedbackKeysFor({ startLocal: '2026-09-23T19:10:00', venue: { name: 'Dodger Stadium', city: 'Los Angeles' }, awayTeam: { name: 'San Diego Padres' } }, 'sports');
  assert.equal(sports.opponent[0].key, 'opponent:san diego padres');
});

test('evidence is graded and shrinks: one outcome moves a little, agreement moves more', () => {
  const one = artistDelta([record()]);
  const loved = artistDelta([record({ rating: 5 })]);
  const three = artistDelta([1, 2, 3].map((n) => record({ canonicalEventId: `past-${n}`, rating: 5 })));
  assert.ok(one > 0 && one < loved && loved < three, `${one} < ${loved} < ${three}`);
  assert.ok(three < FEEDBACK_POLICY.caps.artist);
  const mixed = artistDelta([record({ rating: 5 }), record({ canonicalEventId: 'past-2', status: 'attended-not-worth-it' })]);
  assert.ok(Math.abs(mixed) < 0.5, 'opposing outcomes cancel');
});

test('old outcomes fade and pre-event interest is a weak positive', () => {
  const recent = artistDelta([record({ rating: 5 })]);
  const old = artistDelta([record({ rating: 5, eventDateLocal: '2023-10-10', recordedAt: '2026-10-30T00:00:00Z' })]);
  assert.ok(old < recent * 0.25, 'decay runs from the night, not from when it was logged');
  const interested = artistDelta([record({ status: 'interested', rating: 5, eventDateLocal: '2026-12-01', recordedAt: '2026-10-30T00:00:00Z' })]);
  assert.ok(interested > 0 && interested < recent);
});

test('logistics never becomes a taste signal, and taste reasons are scoped', () => {
  const logistics = deriveFeedbackSignals([
    record({ status: 'did-not-attend-logistical', reasonCodes: ['timing'] }),
    record({ canonicalEventId: 'past-2', status: 'lost-interest', reasonCodes: ['price'] })
  ], { now: NOW });
  assert.equal(logistics.taste.size, 0);
  assert.ok(logistics.friction.get('venue:sears building los angeles').delta > 0);

  const venueOnly = deriveFeedbackSignals([record({ status: 'lost-interest', reasonCodes: ['venue'] })], { now: NOW });
  assert.ok(venueOnly.taste.get('venue:sears building los angeles').delta < 0);
  assert.equal(venueOnly.taste.has('artist:josh baker'), false);
});

test('the latest record for a night wins and a withdrawal erases it', () => {
  const revised = artistDelta([
    record({ recordedAt: '2026-10-11T18:00:00Z' }),
    record({ status: 'attended-not-worth-it', recordedAt: '2026-10-12T18:00:00Z' })
  ]);
  assert.ok(revised < 0);
  const withdrawn = deriveFeedbackSignals([record(), record({ status: 'withdrawn', recordedAt: '2026-10-13T00:00:00Z' })], { now: NOW });
  assert.equal(withdrawn.taste.size, 0);
});

test('records without frozen keys use only unambiguous title shapes', () => {
  const legacy = (title, extra = {}) => ({ feedbackId: `l-${title}`, canonicalEventId: title, eventDateLocal: '2026-08-01', eventTitleSnapshot: title, status: 'attended-worth-it', rating: null, reasonCodes: [], signalTags: [], recordedAt: '2026-08-02T00:00:00Z', ...extra });
  const signals = deriveFeedbackSignals([
    legacy('Milwaukee Brewers at Los Angeles Dodgers'),
    legacy('Headline Act with Support Act'),
    legacy('Some Label presents: A Night, B & C')
  ], { now: NOW });
  assert.ok(signals.taste.has('opponent:milwaukee brewers'), 'a game is about the opponent, never an "artist"');
  assert.ok(signals.taste.has('artist:headline act'));
  assert.equal([...signals.taste.keys()].some((key) => key.startsWith('artist:milwaukee') || key.includes('some label')), false);
  assert.equal(signals.countedRecords, 2);
});

test('the overlay is explained, capped, non-destructive, and never touches excluded rows', () => {
  const signals = deriveFeedbackSignals([1, 2, 3, 4, 5, 6].map((n) => record({ canonicalEventId: `past-${n}`, rating: 5 })), { now: NOW });
  const source = [event(), event({ id: 'x', ranking: { utility: -100, excluded: true } })];
  const frozen = JSON.stringify(source);
  const { rows, audit } = applyFeedbackOverlay(source, 'music', signals);
  assert.equal(JSON.stringify(source), frozen, 'published rows are never mutated');
  const adjustment = rows[0].ranking.feedbackAdjustment;
  assert.ok(adjustment.scoreDelta > 0 && adjustment.scoreDelta <= FEEDBACK_POLICY.maxTotalAdjustment);
  assert.equal(rows[0].ranking.baseUtility, 40, 'the canonical score stays on the row');
  assert.equal(rows[0].ranking.utility, 40 + adjustment.scoreDelta);
  assert.equal(adjustment.reasons[0].label, 'Josh Baker');
  assert.equal(rows[1].ranking.feedbackAdjustment, undefined);
  assert.equal(audit.adjustedCount, 1);
  assert.ok(describeLearning(signals).some((row) => row.label === 'Josh Baker' && row.direction === 'up'));
  // No feedback, no change: the same array comes back untouched.
  assert.equal(applyFeedbackOverlay(source, 'music', deriveFeedbackSignals([], { now: NOW })).rows, source);
});

test('learned friction raises hassle and costs utility at the ranker\'s price, within its cap', () => {
  const signals = deriveFeedbackSignals([1, 2, 3, 4].map((n) => record({
    canonicalEventId: `past-${n}`, status: 'did-not-attend-logistical', reasonCodes: ['distance']
  })), { now: NOW });
  const base = event({ ranking: { utility: 40, hassleScore: 2, call: 'Wildcard', excluded: false } });
  const [row] = applyFeedbackOverlay([base], 'music', signals).rows;
  const added = row.ranking.hassleScore - 2;
  assert.ok(added >= 1 && added <= FEEDBACK_POLICY.maxFriction);
  assert.equal(row.ranking.utility, 40 - added * 2);
  assert.equal(row.ranking.feedbackAdjustment.reasons[0].kind, 'friction');
});

test('the site bundles run the identical policy', async () => {
  const records = [record({ rating: 5 }), record({ canonicalEventId: 'past-2', status: 'lost-interest', reasonCodes: ['venue'] })];
  const local = applyFeedbackOverlay([event()], 'music', deriveFeedbackSignals(records, { now: NOW }));
  for (const path of ['../site/server/deterministic-engine.js', '../site/app/engine-client.js']) {
    const bundle = await import(path);
    const hosted = bundle.applyFeedbackOverlay([event()], 'music', bundle.deriveFeedbackSignals(records, { now: NOW }));
    assert.deepEqual(hosted.rows, local.rows, path);
    assert.equal(bundle.FEEDBACK_POLICY.version, FEEDBACK_POLICY.version);
  }
});
