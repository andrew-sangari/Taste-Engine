import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchSeatGeekEvents,
  fetchSeatGeekEventsForPerformers,
  fetchSeatGeekWeekendEvents,
  normalizeSeatGeekEvent,
  selectSeatGeekPerformer,
  splitDateWindows,
  spotifyIdFromLinks
} from '../src/seatgeek.js';

test('normalizes SeatGeek events into the minimum candidate shape', () => {
  const candidate = normalizeSeatGeekEvent({
    id: 99,
    title: 'Artist One with Support',
    type: 'concert',
    url: 'https://seatgeek.example/event/99',
    datetime_local: '2026-07-11T20:00:00',
    datetime_utc: '2026-07-12T03:00:00',
    performers: [{
      id: 1,
      name: 'Artist One',
      primary: true,
      links: [{ provider: 'spotify', id: 'spotify-artist-one' }]
    }],
    venue: { id: 2, name: 'A Venue', city: 'Los Angeles', state: 'CA', location: { lat: 34.05, lon: -118.24 } },
    stats: { listing_count: 12, lowest_price: 40, average_price: 55 }
  }, '2026-07-10T00:00:00.000Z');

  assert.equal(candidate.id, 'seatgeek:99');
  assert.equal(candidate.performers[0].spotifyId, 'spotify-artist-one');
  assert.equal(candidate.ticketObservation.lowestPriceUsd, 40);
  assert.equal(candidate.venue.city, 'Los Angeles');
});

test('builds a narrow date-and-location request', async () => {
  let requestUrl;
  await fetchSeatGeekWeekendEvents({
    clientId: 'client-id',
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    config: { home: { lat: 34.0522, lon: -118.2437 }, searchRadiusMiles: 60 },
    fetchImpl: async (url) => {
      requestUrl = url;
      return new Response(JSON.stringify({ events: [] }));
    }
  });

  assert.equal(requestUrl.searchParams.get('client_id'), 'client-id');
  assert.equal(requestUrl.searchParams.get('range'), '60mi');
  assert.equal(requestUrl.searchParams.get('datetime_local.gte'), '2026-07-10');
  assert.equal(requestUrl.searchParams.get('datetime_local.lte'), '2026-07-12T23:59:59');
});

test('requires a SeatGeek client id', async () => {
  await assert.rejects(
    () => fetchSeatGeekWeekendEvents({ clientId: '', startDate: '2026-07-10', endDate: '2026-07-12', config: {} }),
    /SEATGEEK_CLIENT_ID/
  );
});

test('splits a long horizon into non-overlapping inclusive windows', () => {
  assert.deepEqual(splitDateWindows('2026-07-10', '2026-08-10', 14), [
    { startDate: '2026-07-10', endDate: '2026-07-23' },
    { startDate: '2026-07-24', endDate: '2026-08-06' },
    { startDate: '2026-08-07', endDate: '2026-08-10' }
  ]);
});

test('pages each date window and deduplicates event ids', async () => {
  const requests = [];
  const events = await fetchSeatGeekEvents({
    clientId: 'client-id',
    startDate: '2026-07-01',
    endDate: '2026-07-04',
    windowDays: 2,
    maxPages: 2,
    config: { home: { lat: 34, lon: -118 }, searchRadiusMiles: 60 },
    fetchImpl: async (url) => {
      requests.push(url);
      const firstWindow = url.searchParams.get('datetime_local.gte') === '2026-07-01';
      const id = firstWindow ? 1 : 2;
      return new Response(JSON.stringify({ events: [{ id }], meta: { total: 1 } }));
    }
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(events.map((event) => event.id), [1, 2]);
});

test('normalizes Spotify URI ids and prefers linked performer identity', () => {
  assert.equal(spotifyIdFromLinks([{ provider: 'spotify', id: 'spotify:artist:abc123' }]), 'abc123');
  const selected = selectSeatGeekPerformer(
    { name: 'Artist Name', spotifyArtistId: 'abc123' },
    [
      { id: 1, name: 'Artist Name', score: 100, links: [] },
      { id: 2, name: 'Artist Name Live', score: 1, links: [{ provider: 'spotify', id: 'spotify:artist:abc123' }] }
    ]
  );
  assert.equal(selected.id, 2);
});

test('queries performer ids without a geographic hard filter', async () => {
  let requestUrl;
  await fetchSeatGeekEventsForPerformers({
    performerIds: ['10', '20'],
    clientId: 'client-id',
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    windowDays: 30,
    config: { home: { lat: 34, lon: -118 }, searchRadiusMiles: 60 },
    fetchImpl: async (url) => {
      requestUrl = url;
      return new Response(JSON.stringify({ events: [], meta: { total: 0 } }));
    }
  });
  assert.equal(requestUrl.searchParams.get('performers.id'), '10,20');
  assert.equal(requestUrl.searchParams.has('lat'), false);
  assert.equal(requestUrl.searchParams.get('taxonomies.name'), 'concert');
});
