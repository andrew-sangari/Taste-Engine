import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, buildOverviewBuckets } from '../src/overview.js';

function music(id, artist, score, startLocal = '2026-07-11T20:00:00') {
  return {
    id,
    title: `${artist} live`,
    sourceUrl: id,
    startLocal,
    venue: { name: 'Venue', city: 'Los Angeles' },
    eventType: 'concert',
    matchedArtists: [{ name: artist, primary: true }],
    ranking: { utility: score, artistFit: score, hassleScore: 2, urgency: 'watch', confidence: 'high', whyYou: `${artist} fits.` },
    sources: ['ticketmaster']
  };
}

function game(id, seriesId, score, startLocal) {
  return {
    id,
    sourceUrl: id,
    startLocal,
    venue: { name: 'Dodger Stadium', city: 'Los Angeles' },
    awayTeam: { name: 'San Diego Padres', shortName: 'Padres' },
    homeTeam: { name: 'Los Angeles Dodgers', shortName: 'Dodgers' },
    series: { id: seriesId },
    ranking: { utility: score, interestScore: score, hassleScore: 2, urgency: 'unknown', confidence: 'high', whyYou: 'Rivalry.' },
    ticketObservations: []
  };
}

test('keeps one representative per music artist and sports series in the overview', () => {
  const overview = buildOverview([
    music('joji-1', 'Joji', 60),
    music('joji-2', 'Joji', 59, '2026-07-12T20:00:00'),
    music('other', 'Other Artist', 55)
  ], [
    game('game-1', 'series-1', 58, '2026-07-13T19:00:00'),
    game('game-2', 'series-1', 57, '2026-07-14T19:00:00'),
    game('game-3', 'series-2', 40, '2026-07-20T19:00:00')
  ]);
  assert.deepEqual(overview.map((item) => item.id), ['joji-1', 'other', 'game-1', 'game-3']);
});

test('separates the current shortlist from exceptional plan-ahead dates', () => {
  const buckets = buildOverviewBuckets([
    music('current', 'Current Artist', 80, '2026-07-15T20:00:00'),
    music('future', 'Future Artist', 90, '2026-08-15T20:00:00')
  ], [], { now: '2026-07-11T12:00:00Z', currentDays: 14, planAheadMinScore: 70 });
  assert.deepEqual(buckets.current.map((item) => item.id), ['current']);
  assert.deepEqual(buckets.planAhead.map((item) => item.id), ['future']);
  assert.equal(buckets.current[0].bucket, 'current');
  assert.equal(buckets.planAhead[0].bucket, 'plan-ahead');
});

test('Plan ahead applies the horizon, skip, and represented artist/series exclusions', () => {
  const skipped = music('later-skip', 'Skip Artist', 99, '2026-08-16T20:00:00');
  skipped.ranking.call = 'skip';
  const buckets = buildOverviewBuckets([
    music('current-artist', 'Artist One', 80, '2026-07-15T20:00:00'),
    music('later-artist-date', 'Artist One', 99, '2026-08-15T20:00:00'),
    skipped
  ], [
    game('current-series', 'series-1', 80, '2026-07-16T19:00:00'),
    game('later-series', 'series-1', 99, '2026-08-16T19:00:00'),
    game('outside-horizon', 'series-2', 99, '2027-02-01T19:00:00')
  ], { now: '2026-07-11T12:00:00Z', currentDays: 14, planAheadMinScore: 55, horizonDays: 180 });
  assert.deepEqual(buckets.planAhead.map((item) => item.id), []);
});

test('overview carries declared vertical visual metadata', () => {
  const festival = music('festival', 'Festival Artist', 80, '2026-07-15T20:00:00');
  festival.eventType = 'festival';
  const [item] = buildOverview([festival], []);
  assert.equal(item.visual.kind, 'texture');
  assert.equal(item.visual.variant, 'music-crowd-silhouette');
});

test('does not admit movie candidates into the mixed overview', () => {
  const buckets = buildOverviewBuckets([], [], { now: '2026-07-11T12:00:00Z' });
  assert.deepEqual(buckets.current, []);
  assert.deepEqual(buckets.planAhead, []);
});
