import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { digestValue, stableJson } from '../src/diagnostics.js';
import { evaluateFixture } from '../src/evaluation.js';
import { topItemsAffinityFor } from '../src/ranking.js';

process.env.TZ = 'America/Los_Angeles';
const fixture = JSON.parse(await readFile(new URL('./fixtures/evaluation/corpus.json', import.meta.url), 'utf8'));
const golden = JSON.parse(await readFile(new URL('./fixtures/evaluation/golden-summary.json', import.meta.url), 'utf8'));

test('runs the complete synthetic pipeline with a byte-stable normalized projection', async () => {
  const first = await evaluateFixture(fixture);
  const second = await evaluateFixture(fixture);

  assert.equal(stableJson(first.projection), stableJson(second.projection));
  assert.equal(digestValue(first.projection), golden.normalizedProjectionSha256);
  assert.deepEqual({
    events: first.projection.events.length,
    sports: first.projection.sports.length,
    movies: first.projection.movies.length
  }, golden.counts);
  assert.deepEqual(first.projection.overview.map((item) => item.id), golden.overview);
  assert.deepEqual(first.projection.overviewPlanAhead.map((item) => item.id), golden.planAhead);
  assert.equal(first.stages.deduplication.inputCount, golden.deduplication.inputCount);
  assert.equal(first.stages.deduplication.mergedCount, golden.deduplication.mergedCount);
  assert.equal(first.stages.deduplication.canonicalCount, golden.deduplication.canonicalCount);
  assert.equal(first.projection.schemaVersion, 5);
});

test('reversed provider arrays and object-key order do not change the fixture evaluation', async () => {
  const reversed = reverseFixture(fixture);
  const original = await evaluateFixture(fixture);
  const reordered = await evaluateFixture(reversed);
  assert.equal(digestValue(reordered.projection), digestValue(original.projection));
  assert.deepEqual(reordered.projection.overview.map((item) => item.id), original.projection.overview.map((item) => item.id));
  assert.deepEqual(reordered.projection.overviewPlanAhead.map((item) => item.id), original.projection.overviewPlanAhead.map((item) => item.id));
});

test('fixture covers provider resolution, taste windows, missing evidence, and sports series handling', async () => {
  const result = await evaluateFixture(fixture);
  const merged = result.stages.rankedAll.find((candidate) => candidate.id === 'seatgeek:sg-alpha-1');
  assert.deepEqual(new Set(merged.sourceOccurrences.map((occurrence) => occurrence.source)), new Set(['seatgeek', 'ticketmaster']));
  assert.deepEqual(merged.performers.map((performer) => performer.name), ['Alpha Signal', 'Beta Signal']);

  const topOnly = result.stages.rankedAll.find((candidate) => candidate.id === 'seatgeek:sg-top-only');
  const expired = result.stages.rankedAll.find((candidate) => candidate.id === 'seatgeek:sg-expired');
  const unresolved = result.stages.rankedAll.find((candidate) => candidate.id === 'seatgeek:sg-similar-name');
  assert.ok(topOnly.ranking.topItemsAffinity > 0);
  assert.ok(expired.ranking.topItemsAffinity > 0);
  assert.equal(topItemsAffinityFor(expired.matchedArtists.length ? { topEvidence: { shortTermRank: 1 } } : {}, fixture.taste.expiredTopItems, new Date(fixture.now)), 0);
  assert.equal(unresolved.matchedArtists.length, 0);
  assert.ok(result.stages.rankedAll.some((candidate) => candidate.ranking.utility === fixture.config.minimumUtility));
  assert.equal(result.stages.deduplication.venueAliasUse, 2);
  assert.equal(result.projection.sports.find((game) => game.id === 'mlb:9002').ticketObservations.length, 0);
  assert.equal(result.projection.sports.find((game) => game.id === 'mlb:9002').ranking.urgency, 'unknown');
});

test('model success is advisory-only and model absence, timeout, malformed output, and unsupported claims fall back', async () => {
  const deterministic = await evaluateFixture(fixture, { modelMode: 'absent' });
  const valid = await evaluateFixture(fixture, { modelMode: 'valid' });
  assert.equal(valid.projection.eventEnhancement.mode, 'ollama');
  assert.deepEqual(rankSignature(valid.projection), rankSignature(deterministic.projection));
  assert.ok(valid.projection.events.some((event) => event.localEnhancement));

  for (const mode of ['timeout', 'malformed', 'unsupported', 'ranking-mutation']) {
    const fallback = await evaluateFixture(fixture, { modelMode: mode });
    assert.deepEqual(rankSignature(fallback.projection), rankSignature(deterministic.projection), mode);
    assert.doesNotMatch(JSON.stringify(fallback.projection), /sell out|will disappear|utility.?":\s*999/);
  }
});

test('malformed optional fields, invalid dates, unknown enums, and long titles fail soft', async () => {
  const adversarial = structuredClone(fixture);
  adversarial.providers.framework.push({
    id: 'fw-malformed',
    title: 'X'.repeat(12000),
    start_date: 'not-a-date',
    type: 'unknown-provider-enum',
    venue: {}
  });
  adversarial.providers.seatgeek.push({
    id: 'sg-malformed',
    title: 'Unknown enum event',
    type: 'unknown',
    datetime_local: 'not-a-date',
    performers: [{ name: 'Unresolved Noise' }],
    venue: { location: {} },
    stats: null
  });
  const result = await evaluateFixture(adversarial);
  assert.equal(result.projection.schemaVersion, 5);
  assert.ok(result.projection.events.length >= fixture.providers.framework.length);
  assert.ok(result.projection.events.every((event) => event.title.length < 12000));
});

test('wall-clock changes on the same frozen local date do not change the normalized fixture result', async () => {
  const first = await evaluateFixture(fixture, { now: '2026-07-12T12:00:00-07:00' });
  const second = await evaluateFixture(fixture, { now: '2026-07-12T18:00:00-07:00' });
  assert.equal(digestValue(first.projection), digestValue(second.projection));
});

function rankSignature(projection) {
  return {
    events: projection.events.map((event) => [event.id, event.ranking.utility]),
    sports: projection.sports.map((game) => [game.id, game.ranking.utility]),
    overview: projection.overview.map((item) => item.id),
    planAhead: projection.overviewPlanAhead.map((item) => item.id)
  };
}

function reverseFixture(value) {
  if (Array.isArray(value)) return value.map(reverseFixture);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => {
    const next = reverseFixture(child);
    const shouldReverse = ['seatgeek', 'ticketmaster', 'framework', 'insomniac', 'games', 'standings'].includes(key);
    return [key, shouldReverse && Array.isArray(next) ? [...next].reverse() : next];
  }));
}
