import assert from 'node:assert/strict';
import test from 'node:test';
import { diffProjections, formatProjectionDiff } from '../src/projectionDiff.js';

function projection(overrides = {}) {
  return {
    schemaVersion: 5,
    generatedAt: '2026-07-12T19:00:00Z',
    horizon: { startDate: '2026-07-12', endDate: '2027-01-08', days: 180 },
    events: [
      event('one', 'One', 80, '2026-07-15T20:00:00', 'https://ticketmaster.example/one'),
      event('two', 'Two', 70, '2026-07-16T20:00:00', 'https://seatgeek.example/two')
    ],
    sports: [],
    movies: [],
    sourceHealth: [{ source: 'seatgeek', status: 'active', itemCount: 2, warningCount: 0 }],
    overview: [{ id: 'one', vertical: 'music' }],
    overviewPlanAhead: [{ id: 'two', vertical: 'music' }],
    ...overrides
  };
}

function event(id, title, utility, startLocal, url, extra = {}) {
  return {
    id,
    title,
    startLocal,
    sourceLinks: [{ source: url.includes('seatgeek') ? 'seatgeek' : 'ticketmaster', url }],
    visual: { kind: 'texture', variant: 'music-stage-haze' },
    ranking: { utility, confidence: 'high', urgency: 'watch', hassleScore: 3, whyYou: `${title} fits.` },
    ...extra
  };
}

test('reports seeded ranking, membership, identity, provenance, health, visual, and field changes', () => {
  const before = projection({
    events: [
      event('keep', 'Keep', 65, '2026-07-14T20:00:00', 'https://ticketmaster.example/keep'),
      event('merge-a', 'Merge A', 80, '2026-07-15T20:00:00', 'https://seatgeek.example/a'),
      event('merge-b', 'Merge B', 70, '2026-07-15T20:00:00', 'https://ticketmaster.example/b'),
      event('split', 'Split', 60, '2026-07-16T20:00:00', 'https://seatgeek.example/split-a', { sourceLinks: [
        { source: 'seatgeek', url: 'https://seatgeek.example/split-a' },
        { source: 'ticketmaster', url: 'https://ticketmaster.example/split-b' }
      ] })
    ],
    overview: [{ id: 'merge-a', vertical: 'music' }, { id: 'split', vertical: 'music' }],
    overviewPlanAhead: [{ id: 'merge-b', vertical: 'music' }]
  });
  const after = projection({
    events: [
      event('merged', 'Merged title', 90, '2026-07-15T20:00:00', 'https://seatgeek.example/a', {
        sourceLinks: [
          { source: 'seatgeek', url: 'https://seatgeek.example/a' },
          { source: 'ticketmaster', url: 'https://ticketmaster.example/b' }
        ],
        ranking: { utility: 90, confidence: 'medium', urgency: 'buy now', hassleScore: 5, whyYou: 'Changed whyYou.' },
        visual: { kind: 'texture', variant: 'music-warehouse-beams' },
        newOptionalField: 'allowed optional delta'
      }),
      event('split-a', 'Split A', 55, '2026-07-16T20:00:00', 'https://seatgeek.example/split-a'),
      event('keep', 'Keep changed', 64, '2026-07-14T20:00:00', 'https://ticketmaster.example/keep-new', {
        sourceLinks: [{ source: 'ticketmaster', url: 'https://ticketmaster.example/keep-new' }],
        ranking: { utility: 64, confidence: 'medium', urgency: 'buy now', hassleScore: 5, whyYou: 'Keep changed whyYou.' },
        visual: { kind: 'texture', variant: 'music-warehouse-beams' },
        newOptionalField: 'allowed optional delta'
      }),
      event('split-b', 'Split B', 54, '2026-07-16T20:00:00', 'https://ticketmaster.example/split-b')
    ],
    sourceHealth: [{ source: 'seatgeek', status: 'partial', itemCount: 3, warningCount: 1 }],
    overview: [{ id: 'merged', vertical: 'music' }, { id: 'split-b', vertical: 'music' }],
    overviewPlanAhead: [{ id: 'split-a', vertical: 'music' }]
  });
  const diff = diffProjections(before, after);
  assert.equal(diff.schema.changed, false);
  assert.ok(diff.candidates.added.some((item) => item.id === 'merged'));
  assert.ok(diff.candidates.removed.some((item) => item.id === 'merge-a'));
  assert.ok(diff.canonicalIdentity.merges.length >= 1);
  assert.ok(diff.canonicalIdentity.splits.length >= 1);
  assert.ok(diff.rankChanges.length >= 1);
  assert.ok(diff.scoreChanges.length >= 1);
  assert.ok(diff.advisoryChanges.length >= 1);
  assert.ok(diff.contentChanges.title.length >= 1);
  assert.ok(diff.contentChanges.whyYou.length >= 1);
  assert.ok(diff.sourceLinkChanges.length >= 1);
  assert.ok(diff.sourceHealthChanges.length >= 1);
  assert.ok(diff.visualContractChanges.length >= 1);
  assert.ok(diff.unexpectedFields.added.some((path) => path.includes('newOptionalField')));
  assert.match(formatProjectionDiff(diff), /Compatibility: compatible/);
});

test('does not infer identity changes from title similarity alone and redacts authenticated URL material', () => {
  const before = projection({ events: [event('a', 'Similar title', 50, '2026-07-15T20:00:00', 'https://example.test/a?token=secret')] });
  const after = projection({ events: [event('b', 'Similar title', 50, '2026-07-15T20:00:00', 'https://example.test/b?token=other')] });
  const diff = diffProjections(before, after);
  assert.deepEqual(diff.canonicalIdentity, { merges: [], splits: [] });
  assert.doesNotMatch(JSON.stringify(diff), /secret|other/);
});

test('returns a nonzero result for structural incompatibility or configured material count thresholds', () => {
  const incompatible = diffProjections(projection(), { ...projection(), schemaVersion: 4, events: undefined });
  assert.equal(incompatible.exitCode, 2);
  const threshold = diffProjections(projection(), projection({ events: [] }), { maxCountChange: 0.1 });
  assert.equal(threshold.exitCode, 2);
  assert.equal(threshold.thresholds.exceeded, true);
});
