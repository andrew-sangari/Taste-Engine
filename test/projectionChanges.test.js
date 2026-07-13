import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChangesSinceRefresh } from '../src/projectionChanges.js';
import { UNORDERED_URGENCIES, URGENCY_PRIORITY } from '../src/ranking.js';

function projection({ overview = [], planAhead = [], events = [], sports = [], generatedAt = '2026-07-05T00:00:00.000Z' } = {}) {
  return { generatedAt, overview, overviewPlanAhead: planAhead, events, sports };
}

function overviewItem(id, title = id) {
  return { id, vertical: 'music', title };
}

function eventItem(id, urgency = 'safe to wait', title = id) {
  return { id, title, ranking: { urgency } };
}

test('urgency priority map plus unordered list covers every engine urgency value', () => {
  // Values the engine can emit today: ranking.js ticketUrgency and
  // sports.js ticket urgency including unknown/likely unavailable.
  const engineValues = ['safe to wait', 'watch', 'buy now', 'unknown', 'likely unavailable'];
  for (const value of engineValues) {
    assert.ok(URGENCY_PRIORITY[value] != null || UNORDERED_URGENCIES.includes(value), `unmapped urgency: ${value}`);
  }
});

test('reports overview and plan-ahead membership with one mention per event', () => {
  const before = projection({
    overview: [overviewItem('a'), overviewItem('b')],
    planAhead: [overviewItem('p1')],
    events: [eventItem('a'), eventItem('b')]
  });
  const after = projection({
    overview: [overviewItem('a'), overviewItem('c', 'New Headliner')],
    planAhead: [overviewItem('p2')],
    events: [eventItem('c', 'buy now'), eventItem('a')]
  });
  const changes = buildChangesSinceRefresh(before, after);
  assert.deepEqual(changes.overview.added, [{ vertical: 'music', id: 'c', title: 'New Headliner' }]);
  assert.deepEqual(changes.overview.removed, [{ vertical: 'music', id: 'b', title: 'b' }]);
  assert.deepEqual(changes.planAhead.added.map((item) => item.id), ['p2']);
  assert.deepEqual(changes.planAhead.removed.map((item) => item.id), ['p1']);
  // 'c' is already announced as an overview addition: no duplicate mention as
  // newly shortlisted or urgency upgrade.
  assert.deepEqual(changes.urgencyUpgrades, []);
  assert.deepEqual(changes.newlyShortlisted, []);
  assert.equal(changes.previousGeneratedAt, '2026-07-05T00:00:00.000Z');
});

test('low-rank churn alone produces no strip and no reorder flag', () => {
  const before = projection({
    overview: [overviewItem('a'), overviewItem('b')],
    events: [eventItem('a'), eventItem('b'), ...Array.from({ length: 20 }, (_, i) => eventItem(`tail-${i}`))]
  });
  const after = projection({
    overview: [overviewItem('a'), overviewItem('b')],
    events: [eventItem('a'), eventItem('b')]
  });
  assert.equal(buildChangesSinceRefresh(before, after), null);
});

test('reordered only fires when surviving overview items change relative order', () => {
  const before = projection({ overview: [overviewItem('a'), overviewItem('b'), overviewItem('c')], events: [] });
  const removalOnly = projection({ overview: [overviewItem('a'), overviewItem('c')], events: [] });
  const removalChanges = buildChangesSinceRefresh(before, removalOnly);
  assert.equal(removalChanges.overview.reordered, false);
  const swapped = projection({ overview: [overviewItem('b'), overviewItem('a'), overviewItem('c')], events: [] });
  assert.equal(buildChangesSinceRefresh(before, swapped).overview.reordered, true);
});

test('urgency upgrades use engine priority and ignore unordered urgencies', () => {
  const before = projection({ events: [eventItem('up', 'safe to wait'), eventItem('unknown', 'unknown'), eventItem('down', 'buy now')] });
  const after = projection({ events: [eventItem('up', 'buy now'), eventItem('unknown', 'watch'), eventItem('down', 'watch')] });
  const changes = buildChangesSinceRefresh(before, after);
  assert.deepEqual(changes.urgencyUpgrades, [{ vertical: 'music', id: 'up', title: 'up', before: 'safe to wait', after: 'buy now' }]);
});

test('newly shortlisted covers top-N entrants including sports titles', () => {
  const before = projection({ events: [eventItem('a')], sports: [] });
  const after = projection({
    events: [eventItem('a')],
    sports: [{ id: 'mlb:1', awayTeam: { shortName: 'Padres' }, ranking: { urgency: 'unknown' } }]
  });
  const changes = buildChangesSinceRefresh(before, after, { topN: 5 });
  assert.deepEqual(changes.newlyShortlisted, [{ vertical: 'sports', id: 'mlb:1', title: 'Dodgers vs. Padres' }]);
});

test('missing or malformed baselines produce null instead of failing', () => {
  const next = projection({ overview: [overviewItem('a')], events: [eventItem('a')] });
  assert.equal(buildChangesSinceRefresh(null, next), null);
  assert.equal(buildChangesSinceRefresh({ not: 'a projection' }, next), null);
  assert.equal(buildChangesSinceRefresh([], next), null);
});

test('previousGeneratedAt is optional', () => {
  const before = projection({ overview: [overviewItem('a')], events: [], generatedAt: null });
  const after = projection({ overview: [overviewItem('b')], events: [] });
  const changes = buildChangesSinceRefresh(before, after);
  assert.equal(changes.previousGeneratedAt, null);
  assert.equal(changes.overview.added.length, 1);
});
