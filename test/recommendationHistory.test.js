import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecommendationHistory, collectSurfacedItems, serializeRecentHistory } from '../src/recommendationHistory.js';

function event(id, date, title = id) {
  return {
    id,
    title,
    startLocal: `${date}T20:00:00`,
    venue: { name: 'Venue', city: 'Los Angeles' },
    feedbackSnapshot: {
      feedbackSnapshotId: `fs-${id}-${date}`,
      canonicalEventId: id,
      eventDateLocal: date,
      eventTitleSnapshot: title,
      vertical: 'music'
    }
  };
}

function movie(id, date) {
  return { id, title: id, releaseDate: date, venue: null };
}

test('collects surfaced items, merges surfaces and limits each shortlist to five', () => {
  const events = Array.from({ length: 6 }, (_, index) => event(`event:${index + 1}`, `2026-08-${String(index + 1).padStart(2, '0')}`));
  const projection = {
    events,
    sports: [],
    movies: Array.from({ length: 6 }, (_, index) => movie(`movie:${index + 1}`, `2026-09-${String(index + 1).padStart(2, '0')}`)),
    overview: [{ ...events[0], vertical: 'music' }],
    overviewPlanAhead: [{ ...events[0], vertical: 'music' }]
  };
  const collected = collectSurfacedItems(projection);
  assert.equal(collected.length, 10);
  const first = collected.find((item) => item.canonicalEventId === 'event:1');
  assert.deepEqual(first.surfaces, ['overview', 'plan-ahead', 'shortlist']);
  assert.equal(first.bestRank, 1);
  assert.equal(collected.some((item) => item.canonicalEventId === 'event:6'), false);
  assert.equal(collected.find((item) => item.canonicalEventId === 'movie:1').feedbackSnapshotId, null);
});

test('uses deterministic occurrence IDs, preserves first shown time, and splits reschedules', () => {
  const now = new Date('2026-07-13T18:00:00.000Z');
  const projection = { events: [event('event:1', '2026-08-01')], sports: [], movies: [], overview: [], overviewPlanAhead: [] };
  const first = buildRecommendationHistory({ projection, now });
  const second = buildRecommendationHistory({ projection, previous: first, now: new Date('2026-07-14T18:00:00.000Z') });
  const one = Object.values(first.items)[0];
  const two = Object.values(second.items)[0];
  assert.equal(one.historyId, two.historyId);
  assert.equal(two.firstShownAt, one.firstShownAt);
  assert.equal(two.lastShownAt, '2026-07-14T18:00:00.000Z');

  const rescheduled = buildRecommendationHistory({
    projection: { ...projection, events: [event('event:1', '2026-08-02')] },
    previous: second,
    now: new Date('2026-07-15T18:00:00.000Z')
  });
  assert.equal(Object.keys(rescheduled.items).length, 2);
});

test('prunes items more than 90 days past and serializes only public allowlisted fields', () => {
  const previous = buildRecommendationHistory({
    projection: { events: [event('old', '2026-01-01'), event('recent', '2026-06-01')], sports: [], movies: [], overview: [], overviewPlanAhead: [] },
    now: new Date('2026-06-02T18:00:00.000Z')
  });
  Object.values(previous.items)[0].privateEvidence = 'must-not-publish';
  const state = buildRecommendationHistory({
    projection: { events: [], sports: [], movies: [], overview: [], overviewPlanAhead: [] },
    previous,
    now: new Date('2026-07-13T18:00:00.000Z')
  });
  const published = serializeRecentHistory(state);
  assert.deepEqual(published.map((item) => item.canonicalEventId), ['recent']);
  assert.deepEqual(Object.keys(published[0]).sort(), [
    'bestRank', 'canonicalEventId', 'dateLocal', 'feedbackSnapshotId', 'firstShownAt', 'historyId',
    'lastShownAt', 'locationLabel', 'surfaces', 'title', 'vertical'
  ]);
});
