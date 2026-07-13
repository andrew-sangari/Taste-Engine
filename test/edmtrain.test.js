import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEdmtrainUrl, enrichEventsWithEdmtrain, fetchEdmtrainEvents, normalizeEdmtrainEvent } from '../src/edmtrain.js';

test('uses the path-safe EDMTrain API base and required filters', async () => {
  const urls = [];
  const events = await fetchEdmtrainEvents({ clientKey: 'secret', startDate: '2026-07-13', endDate: '2027-01-09', fetchImpl: async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(url.pathname.endsWith('/locations')
      ? { locations: [{ id: 7, city: 'Los Angeles', state: 'California', country: 'United States' }] }
      : { events: [{ id: 1, date: '2026-08-01', name: 'Night', artistList: [] }] }));
  }});
  assert.equal(buildEdmtrainUrl('events').pathname, '/api/events');
  assert.equal(events.length, 1);
  assert.equal(urls[1].searchParams.get('locationIds'), '7');
  assert.equal(urls[1].searchParams.get('livestreamInd'), 'false');
  assert.equal(urls[1].searchParams.get('includeOtherGenreInd'), 'false');
});

test('preserves repeated billing occurrences and enriches only one confident match', () => {
  const edm = normalizeEdmtrainEvent({ id: 9, date: '2026-08-01', name: 'Festival', festivalInd: true, venue: { name: 'Expo Park' }, artistList: [
    { name: 'Artist A', b2bInd: true }, { name: 'Artist B', b2bInd: false }, { name: 'Artist A', b2bInd: false }
  ] });
  const candidate = { id: 'tm:1', title: 'Festival', startLocal: '2026-08-01T19:00:00', venue: { name: 'Expo Park' }, performers: [{ name: 'Artist A', primary: true }] };
  const result = enrichEventsWithEdmtrain([candidate], [edm], { artists: [{ name: 'Artist A', origin: 'source' }, { name: 'Artist B', origin: 'similar' }] });
  assert.equal(result.matchedCount, 1);
  assert.equal(candidate.lineupDisplay.orderedArtists.length, 3);
  assert.deepEqual(candidate.lineupDisplay.orderedArtists.map((item) => item.billingGroupIndex), [0, 0, 1]);
  assert.equal(candidate.lineupDisplay.displayShape, 'festival');
});

test('keeps non-confident EDMTrain events audit-only', () => {
  const candidate = { id: 'tm:1', title: 'Different', startLocal: '2026-08-01T19:00:00', venue: { name: 'Venue A' }, performers: [{ name: 'Artist A' }] };
  const result = enrichEventsWithEdmtrain([candidate], [normalizeEdmtrainEvent({ id: 2, date: '2026-08-01', name: 'Other', venue: { name: 'Venue B' }, artistList: [{ name: 'Artist B' }] })], { artists: [] });
  assert.equal(result.matchedCount, 0);
  assert.equal(candidate.lineupDisplay, undefined);
  assert.equal(result.audit[0].status, 'unmatched');
});
