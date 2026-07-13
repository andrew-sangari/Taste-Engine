import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEventTitle, deduplicateCandidates } from '../src/candidates.js';
import { fetchFrameworkArtists, fetchFrameworkEvents, normalizeFrameworkEvent, parseFrameworkArtists } from '../src/framework.js';
import { fetchInsomniacEvents, normalizeInsomniacEvent, parseInsomniacEvents } from '../src/insomniac.js';
import { selectMovieCandidates } from '../src/movieSelection.js';
import { fetchTicketmasterEvents, fetchTicketmasterEventsForArtists, normalizeTicketmasterEvent } from '../src/ticketmaster.js';
import { fetchUpcomingMovies, normalizeTmdbMovie, resolveTmdbAuth } from '../src/tmdb.js';

test('normalizes Framework events and promoter-billed performers', async () => {
  const event = normalizeFrameworkEvent({
    id: 10,
    title: 'Max Dean B2B Luke Dean',
    url: 'https://thisisframework.com/event/example/',
    start_date: '2026-07-25 18:00:00',
    utc_start_date: '2026-07-26 01:00:00',
    venue: { id: 4, venue: 'Expo Lawn', city: 'Los Angeles' }
  }, '2026-07-10T00:00:00Z');
  assert.equal(event.startLocal, '2026-07-25T18:00:00');
  assert.deepEqual(event.performers.map((performer) => performer.name), ['Max Dean', 'Luke Dean']);

  let pages = 0;
  const fetched = await fetchFrameworkEvents({
    startDate: '2026-07-10',
    endDate: '2026-12-31',
    fetchImpl: async () => {
      pages += 1;
      return new Response(JSON.stringify({ events: pages === 1 ? [{ id: 1 }] : [], total_pages: 1 }));
    }
  });
  assert.equal(fetched.length, 1);
});

test('parses the Framework artist roster and decodes canonical links', async () => {
  const html = `<a href=https://thisisframework.com/artist/rufus-du-sol/ class="ct-link artist-block"><div class="artist-block-name"><span class="ct-span">R&uuml;f&uuml;s Du Sol</span></div></a>
    <a href="https://thisisframework.com/artist/rufus-du-sol/" class="ct-link artist-block"><div class="artist-block-name"><span class="ct-span">R&uuml;f&uuml;s Du Sol</span></div></a>
    <a href="https://example.com/artist/nope/" class="ct-link artist-block"><div class="artist-block-name"><span class="ct-span">Nope</span></div></a>`;
  const parsed = parseFrameworkArtists(html);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Rüfüs Du Sol');
  assert.equal(parsed[0].sourceUrl, 'https://thisisframework.com/artist/rufus-du-sol/');

  const fetched = await fetchFrameworkArtists({ fetchImpl: async () => new Response(html) });
  assert.equal(fetched[0].slug, 'rufus-du-sol');
});

test('parses and normalizes Insomniac promoter events from structured public markup', async () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'MusicEvent', name: 'Beltran', startDate: '2026-08-08T20:00:00-07:00',
    url: 'https://www.insomniac.com/events/beltran/', location: { name: 'Los Angeles Warehouse', address: { addressLocality: 'Los Angeles', addressRegion: 'CA' } },
    performer: [{ name: 'Beltran' }]
  })}</script>`;
  const parsed = parseInsomniacEvents(html);
  assert.equal(parsed.length, 1);
  const event = normalizeInsomniacEvent(parsed[0], '2026-07-10T00:00:00Z');
  assert.equal(event.source, 'insomniac');
  assert.equal(event.startLocal, '2026-08-08T20:00:00');
  assert.equal(event.performers[0].name, 'Beltran');

  const fetched = await fetchInsomniacEvents({ startDate: '2026-07-01', endDate: '2026-08-31', fetchImpl: async () => new Response(html) });
  assert.equal(fetched.length, 1);
});

test('normalizes Ticketmaster attractions and pages event search', async () => {
  let requestUrl;
  const raw = await fetchTicketmasterEvents({
    apiKey: 'key',
    startDate: '2026-07-10',
    endDate: '2026-12-31',
    config: { home: { lat: 34, lon: -118 }, searchRadiusMiles: 60 },
    fetchImpl: async (url) => {
      requestUrl = url;
      return new Response(JSON.stringify({ _embedded: { events: [{ id: 'tm1' }] }, page: { totalPages: 1 } }));
    }
  });
  assert.equal(raw.length, 1);
  assert.equal(requestUrl.searchParams.get('classificationName'), 'music');
  const event = normalizeTicketmasterEvent({
    id: 'tm1', name: 'Artist Live', url: 'https://ticketmaster.example',
    dates: { start: { localDate: '2026-08-01', localTime: '20:00:00' } },
    _embedded: { attractions: [{ id: 'a1', name: 'Artist' }], venues: [{ name: 'Venue', city: { name: 'LA' } }] }
  });
  assert.equal(event.performers[0].name, 'Artist');
});

test('expands Ticketmaster with exact Framework artist matches', async () => {
  const requests = [];
  const expanded = await fetchTicketmasterEventsForArtists({
    artists: [{ name: 'Framework Artist' }, { name: 'No Match' }],
    apiKey: 'key',
    startDate: '2026-07-10',
    endDate: '2026-12-31',
    config: { home: { lat: 34, lon: -118 }, searchRadiusMiles: 60 },
    fetchImpl: async (url) => {
      requests.push(url);
      const keyword = url.searchParams.get('keyword');
      const event = keyword === 'Framework Artist'
        ? { id: 'framework-match', name: 'Framework Artist', _embedded: { attractions: [{ name: 'Framework Artist' }] } }
        : { id: 'false-positive', name: 'No Match Live', _embedded: { attractions: [{ name: 'Other Artist' }] } };
      return new Response(JSON.stringify({ _embedded: { events: [event] }, page: { totalPages: 1 } }));
    }
  });
  assert.equal(expanded.events.length, 1);
  assert.equal(expanded.events[0].id, 'framework-match');
  assert.deepEqual(new Set(requests.map((url) => url.searchParams.get('keyword'))), new Set(['Framework Artist', 'No Match']));
});

test('TMDB discovery uses theatrical filters and movie refinement caps output', async () => {
  let requestUrl;
  const raw = await fetchUpcomingMovies({
    apiKey: 'key', startDate: '2026-07-10', endDate: '2026-12-31',
    fetchImpl: async (url) => {
      requestUrl = url;
      return new Response(JSON.stringify({ results: [], total_pages: 1 }));
    }
  });
  assert.deepEqual(raw, []);
  assert.equal(requestUrl.searchParams.get('with_release_type'), '2|3');

  const selected = selectMovieCandidates([
    { id: 1, title: 'Cinematic', popularity: 12, vote_average: 7, genre_ids: [878] },
    { id: 2, title: 'Low signal', popularity: 2, vote_average: 9, genre_ids: [35] },
    { id: 3, title: 'TV movie', popularity: 90, genre_ids: [10770] }
  ], {
    preferredGenreIds: [878], excludedGenreIds: [10770], minimumPopularity: 8,
    highPopularityOverride: 30, maxCandidates: 1
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].movie.id, 1);
  assert.equal(normalizeTmdbMovie({ id: 1, title: 'Cinematic' }).formatStatus, 'verification pending');
  assert.deepEqual(resolveTmdbAuth('0123456789abcdef0123456789abcdef', ''), {
    accessToken: null,
    apiKey: '0123456789abcdef0123456789abcdef'
  });
});

test('deduplicates equivalent cross-source concert occurrences', () => {
  const base = {
    type: 'concert', startLocal: '2026-08-01T20:00:00', title: 'Artist Live',
    venue: { name: 'The Venue', lat: 34, lon: -118 },
    performers: [{ name: 'Artist' }], ticketObservation: { lowestPriceUsd: null }
  };
  const merged = deduplicateCandidates([
    { ...base, id: 'framework:1', source: 'framework', sourceEventId: '1', sourceUrl: 'framework' },
    { ...base, id: 'seatgeek:2', source: 'seatgeek', sourceEventId: '2', sourceUrl: 'seatgeek', ticketObservation: { lowestPriceUsd: 50 } }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'seatgeek');
  assert.equal(merged[0].sourceOccurrences.length, 2);
});

test('deduplicates same-date exact artists when sources name an LA venue differently', () => {
  const shared = {
    type: 'concert', startLocal: '2026-08-01T20:00:00', title: 'Artist Live',
    performers: [{ name: 'Artist' }], ticketObservation: { lowestPriceUsd: null }
  };
  const merged = deduplicateCandidates([
    { ...shared, id: 'framework:1', source: 'framework', sourceEventId: '1', sourceUrl: 'framework', venue: { name: 'Expo Lawn', city: 'Los Angeles', lat: null, lon: null } },
    { ...shared, id: 'seatgeek:2', source: 'seatgeek', sourceEventId: '2', sourceUrl: 'seatgeek', venue: { name: 'Los Angeles Expo Lawn', city: 'Los Angeles', lat: 34, lon: -118 } }
  ]);
  assert.equal(merged.length, 1);
});

test('canonicalizes festival billing suffixes for cross-source deduplication', () => {
  assert.equal(
    canonicalEventTitle('Hard Summer Music Festival - Saturday - with Mau P, Kali Uchis, and more'),
    canonicalEventTitle('HARD Summer Music Festival')
  );
});

test('deduplicates same-city festival listings with venue aliases and billing suffixes', () => {
  const shared = {
    type: 'concert', startLocal: '2026-08-01T14:00:00',
    ticketObservation: { lowestPriceUsd: null }
  };
  const merged = deduplicateCandidates([
    { ...shared, type: 'music_festival', id: 'seatgeek:1', source: 'seatgeek', sourceEventId: '1', sourceUrl: 'sg', title: 'Hard Summer Music Festival - Saturday - with Artist A and more', venue: { name: 'Hollywood Park - Inglewood', city: 'Inglewood', lat: null, lon: null }, performers: [{ name: 'Artist A' }] },
    { ...shared, id: 'ticketmaster:2', source: 'ticketmaster', sourceEventId: '2', sourceUrl: 'tm', title: 'HARD Summer Music Festival', venue: { name: 'Hollywood Park Grounds', city: 'Inglewood', lat: null, lon: null }, performers: [{ name: 'Artist B' }] }
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sourceOccurrences.map((item) => item.source).sort(), ['seatgeek', 'ticketmaster']);
});

test('grades movie taste tiers and keeps stretch candidates behind evidence-backed picks', () => {
  const config = {
    preferredGenreIds: [878, 12, 16], excludedGenreIds: [], minimumPopularity: 8,
    highPopularityOverride: 30, maxCandidates: 5,
    preferredDirectors: ['Auteur Prime'], preferredKeywords: ['imax']
  };
  const selected = selectMovieCandidates([
    { id: 1, title: 'Franchise Pups', popularity: 120, vote_average: 6, genre_ids: [12, 16] },
    { id: 2, title: 'Auteur Cut', popularity: 15, vote_average: 8, genre_ids: [878], credits: { crew: [{ name: 'Auteur Prime' }] } },
    { id: 3, title: 'Double Genre', popularity: 20, vote_average: 7, genre_ids: [878, 12] }
  ], config);
  assert.deepEqual(selected.map((item) => item.movie.id), [2, 3, 1]);
  assert.deepEqual(selected.map((item) => item.tasteTier), ['strong', 'potential', 'stretch']);
});
