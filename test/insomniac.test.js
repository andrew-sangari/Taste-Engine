import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deduplicateCandidates } from '../src/candidates.js';
import { normalizeFrameworkEvent } from '../src/framework.js';
import {
  INSOMNIAC_ADAPTER_VERIFIED,
  InsomniacSourceError,
  fetchInsomniacEvents,
  isInsomniacChallenge,
  normalizeInsomniacEvent,
  parseInsomniacEventPage,
  parseInsomniacEvents,
  parseInsomniacListing
} from '../src/insomniac.js';

// Trimmed real markup retrieved 2026-11-11; see the comment at the top of each file.
const fixture = (name) => readFile(new URL(`./fixtures/insomniac/${name}`, import.meta.url), 'utf8');
const LISTING_URL = 'https://www.insomniac.com/events/los-angeles-ca/';
const ELI_BROWN_URL = 'https://www.insomniac.com/events/eli-brown-2026-11-14-los-angeles-ca/';

// Serves the two saved pages and 404s everything else, recording each request.
async function fixtureFetch() {
  const [listing, eventPage] = await Promise.all([fixture('los-angeles-listing.html'), fixture('event-eli-brown.html')]);
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), userAgent: init?.headers?.['user-agent'] });
    if (String(url) === LISTING_URL) return new Response(listing);
    if (String(url) === ELI_BROWN_URL) return new Response(eventPage);
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, requests, listing, eventPage };
}

test('the adapter is enabled only alongside its real-markup fixtures', async () => {
  assert.equal(INSOMNIAC_ADAPTER_VERIFIED, true);
  assert.match(await fixture('los-angeles-listing.html'), /Trimmed real markup from https:\/\/www\.insomniac\.com\/events\/los-angeles-ca\//);
});

test('reads the real Los Angeles listing cards and drops cross-region featured promotions', async () => {
  const listing = parseInsomniacListing(await fixture('los-angeles-listing.html'), { pageUrl: LISTING_URL });
  assert.equal(listing.cardCount, 15);
  assert.equal(listing.listedCount, 12);
  assert.equal(listing.foundPosts, 34);
  assert.equal(listing.events.length, 12);
  assert.deepEqual(listing.warnings, []);

  const titles = listing.events.map((event) => event.name);
  // Featured-only cards (a New York festival, a Long Beach festival) are not
  // Los Angeles listings; the featured Los Angeles festival is kept once.
  assert.ok(!titles.includes('Time Warp New York City 2026'));
  assert.ok(!titles.includes('Dreamstate Southern California 2026'));
  assert.equal(titles.filter((title) => title === 'Time Warp Los Angeles 2026').length, 1);

  const eli = listing.events.find((event) => event.name === 'Eli Brown');
  assert.equal(eli.url, ELI_BROWN_URL);
  assert.equal(eli.startDate, '2026-11-14');
  assert.equal(eli.location.address.addressLocality, 'Los Angeles');
  assert.equal(eli.location.address.addressRegion, 'CA');
  assert.equal(eli.category, 'Concerts');
  assert.equal(eli.ageRestriction, '21+');
  assert.equal(eli.subtitle, 'presented by Factory 93');
  assert.equal(eli.listingOnly, true);

  const festival = listing.events.find((event) => event.name === 'Time Warp Los Angeles 2026');
  assert.equal(festival.startDate, '2026-11-27');
  assert.equal(festival.category, 'Festivals');
  assert.equal(listing.events.find((event) => /Adrián Mills/.test(event.name)).soldOut, true);
  assert.deepEqual(parseInsomniacEvents(await fixture('los-angeles-listing.html')).map((event) => event.name), titles);
});

test('reads venue, local clock, lineup and genres from a real event page', async () => {
  const event = parseInsomniacEventPage(await fixture('event-eli-brown.html'), { pageUrl: ELI_BROWN_URL });
  assert.equal(event.name, 'Eli Brown');
  assert.equal(event.url, ELI_BROWN_URL);
  assert.equal(event.location.name, 'City Market');
  assert.deepEqual(event.location.address, { streetAddress: '1057 San Pedro St.', addressLocality: 'Los Angeles', addressRegion: 'CA', postalCode: '90015' });
  // The JSON-LD says 17:00+00:00 for a 5 PM Los Angeles start. The wall clock
  // is kept; the offset is never applied.
  assert.equal(event.startDate, '2026-11-14T17:00:00');
  assert.equal(event.endDate, '2026-11-14T23:00:00');
  assert.equal(event.clockSource, 'page-time');
  assert.equal(event.clockConflict, false);
  assert.deepEqual(event.performer.map((performer) => performer.name), ['Eli Brown', 'HNTR', 'Leisan', 'Linska']);
  assert.deepEqual(event.genres, ['House', 'Techno', 'Tech House']);
  assert.equal(event.ageRestriction, '21+');
  assert.equal(event.category, 'Concerts');
});

test('a real event survives ingestion and normalization in the Framework candidate shape', async () => {
  const { fetchImpl, requests } = await fixtureFetch();
  const diagnostics = {};
  const raw = await fetchInsomniacEvents({ startDate: '2026-11-11', endDate: '2026-11-20', detailDelayMs: 0, diagnostics, fetchImpl });
  assert.deepEqual(raw.map((event) => event.name), ['240 KM/H presents Adrián Mills (All Night Long)', 'Eli Brown', 'Valentino Khan', 'BOLO']);

  const event = normalizeInsomniacEvent(raw.find((item) => item.name === 'Eli Brown'), '2026-11-11T23:00:00Z', { knownArtistNames: [] });
  assert.equal(event.id, 'insomniac:eli-brown-2026-11-14-los-angeles-ca');
  assert.equal(event.source, 'insomniac');
  assert.equal(event.title, 'Eli Brown');
  assert.equal(event.sourceUrl, ELI_BROWN_URL);
  assert.equal(event.retrievedAt, '2026-11-11T23:00:00.000Z');
  assert.equal(event.type, 'concert');
  assert.equal(event.startLocal, '2026-11-14T17:00:00');
  assert.equal(event.endLocal, '2026-11-14T23:00:00');
  assert.equal(event.startUtc, null);
  assert.equal(event.timeTbd, false);
  assert.equal(event.dateTbd, false);
  assert.deepEqual(event.venue, { sourceId: null, name: 'City Market', city: 'Los Angeles', state: 'CA', lat: null, lon: null });
  assert.deepEqual(event.performers.map((performer) => performer.name), ['Eli Brown', 'HNTR', 'Leisan', 'Linska']);
  assert.deepEqual(event.performers.map((performer) => performer.primary), [true, false, false, false]);
  assert.deepEqual(event.promoters, ['Insomniac', 'Factory 93']);
  assert.equal(event.eventName, null);

  // Same top-level contract as the Framework normalizer.
  const framework = normalizeFrameworkEvent({ id: 1, title: 'Artist', url: 'https://thisisframework.com/event/x/', start_date: '2026-11-14 21:00:00', venue: { venue: 'Venue', city: 'Los Angeles' } }, '2026-11-11T23:00:00Z');
  assert.deepEqual(Object.keys(event).sort(), Object.keys(framework).sort());
  assert.deepEqual(Object.keys(event.sourceOccurrences[0]).sort(), Object.keys(framework.sourceOccurrences[0]).sort());
  assert.deepEqual(Object.keys(event.performers[0]).sort(), Object.keys(framework.performers[0]).sort());
  assert.equal(event.sourceOccurrences[0].sourceUrl, ELI_BROWN_URL);
  assert.equal(event.sourceOccurrences[0].retrievedAt, '2026-11-11T23:00:00.000Z');
  assert.deepEqual(event.sourceOccurrences[0].performerNames, ['Eli Brown', 'HNTR', 'Leisan', 'Linska']);
  assert.equal(event.eventEvidence.provider, 'insomniac');
  assert.equal(event.eventEvidence.eventRef, event.id);
  assert.equal(event.sourceOccurrences[0].evidence, event.eventEvidence);
  // Whatever facts the evidence layer admits for this provider stay out of model input.
  for (const fact of Object.values(event.eventEvidence.permittedFacts)) assert.equal(fact.permission.modelInput, false);

  // One listing request, then only insomniac.com event pages: never a ticket
  // vendor or an external festival site.
  assert.equal(requests[0].url, LISTING_URL);
  assert.ok(requests.every((request) => request.url.startsWith('https://www.insomniac.com/events/')));
  assert.ok(requests.every((request) => request.userAgent === 'Taste Engine private personal event importer/0.1'));
  assert.equal(new Set(requests.map((request) => request.url)).size, requests.length);
  assert.equal(diagnostics.detailPagesFetched, 1);
  assert.equal(diagnostics.detailPagesFailed, 3);
  assert.ok(diagnostics.warnings.some((warning) => /renders 12 of 34 events/.test(warning)));
});

test('an event page failure keeps listing-level facts and guesses nothing', async () => {
  const { fetchImpl } = await fixtureFetch();
  const diagnostics = {};
  const raw = await fetchInsomniacEvents({ startDate: '2026-11-11', endDate: '2026-11-30', detailDelayMs: 0, diagnostics, fetchImpl });
  const khan = normalizeInsomniacEvent(raw.find((item) => item.name === 'Valentino Khan'), '2026-11-11T23:00:00Z');
  assert.equal(khan.startLocal, '2026-11-14T00:00:00');
  assert.equal(khan.timeTbd, true);
  assert.equal(khan.venue.name, '');
  assert.equal(khan.venue.city, 'Los Angeles');
  assert.equal(khan.endLocal, '2026-11-15T01:30:00');
  assert.ok(diagnostics.warnings.some((warning) => /valentino-khan.*HTTP 404/.test(warning)));

  // An external festival card has no event page to read: no venue, no lineup,
  // and the festival's name is not turned into an act.
  const festival = normalizeInsomniacEvent(raw.find((item) => item.name === 'Time Warp Los Angeles 2026'), '2026-11-11T23:00:00Z');
  assert.equal(festival.type, 'music_festival');
  assert.equal(festival.startLocal, '2026-11-27T00:00:00');
  assert.deepEqual(festival.performers, []);
  assert.equal(festival.eventName, 'Time Warp Los Angeles 2026');
  assert.equal(festival.sourceUrl, 'https://www.time-warp.de/');
  assert.equal(normalizeInsomniacEvent(raw.find((item) => /Adrián Mills/.test(item.name))).status, 'sold out');
});

test('titles without a published lineup are parsed with the promoter title parser', () => {
  const card = {
    name: '240 KM/H presents Adrián Mills (All Night Long)',
    url: 'https://www.insomniac.com/events/240-km-h-presents-adrian-mills-all-night-long-2026-11-13-los-angeles-ca/',
    startDate: '2026-11-13',
    location: { name: '', address: { addressLocality: 'Los Angeles', addressRegion: 'CA' } },
    category: 'Concerts',
    subtitle: 'presented by Factory 93'
  };
  const event = normalizeInsomniacEvent(card, '2026-11-11T23:00:00Z', { knownArtistNames: ['Adrián Mills'] });
  assert.deepEqual(event.performers.map((performer) => performer.name), ['Adrián Mills']);
  assert.deepEqual(event.promoters, ['Insomniac', '240 KM/H', 'Factory 93']);

  const tour = normalizeInsomniacEvent({ ...card, name: 'Virtual Riot & Blanke', subtitle: 'Far From Home Tour · presented by Bassrush' }, '2026-11-11T23:00:00Z');
  assert.deepEqual(tour.performers.map((performer) => performer.name), ['Virtual Riot', 'Blanke']);
  assert.deepEqual(tour.promoters, ['Insomniac', 'Bassrush']);
  assert.equal(tour.eventName, 'Far From Home Tour');

  // A published lineup wins over the title, and tells the parser who the act is.
  const hosted = normalizeInsomniacEvent({ ...card, name: 'Mau P presents Generation Rebrand', subtitle: null, performer: [{ name: 'Mau P' }] }, '2026-11-11T23:00:00Z');
  assert.deepEqual(hosted.performers.map((performer) => performer.name), ['Mau P']);
  assert.equal(hosted.eventName, 'Generation Rebrand');
  assert.deepEqual(hosted.promoters, ['Insomniac']);
});

test('an access challenge fails closed and is never mistaken for an ordinary page', async () => {
  const { listing, eventPage } = await fixtureFetch();
  // Real pages carry Cloudflare's passive beacon under /cdn-cgi/challenge-platform/.
  assert.match(listing, /cdn-cgi\/challenge-platform\/scripts\/jsd/);
  assert.equal(isInsomniacChallenge({ html: listing }), false);
  assert.equal(isInsomniacChallenge({ html: eventPage }), false);
  assert.equal(isInsomniacChallenge({ html: '<html><head><title>Just a moment...</title></head></html>' }), true);
  assert.equal(isInsomniacChallenge({ status: 403, headers: new Headers({ 'cf-mitigated': 'challenge' }), html: '' }), true);

  const blocked = async () => new Response('<html><head><title>Just a moment...</title></head><body></body></html>', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  await assert.rejects(fetchInsomniacEvents({ fetchImpl: blocked }), (error) => {
    assert.ok(error instanceof InsomniacSourceError);
    assert.equal(error.failure, 'blocked');
    assert.match(error.message, /access challenge \(HTTP 403\); it was not retried or bypassed/);
    return true;
  });
  await assert.rejects(fetchInsomniacEvents({ fetchImpl: async () => new Response('<html><body><p>Redesigned.</p></body></html>') }), (error) => {
    assert.equal(error.failure, 'parser-failed');
    assert.match(error.message, /0 event cards and 0 JSON-LD events/);
    return true;
  });
  await assert.rejects(fetchInsomniacEvents({ fetchImpl: async () => new Response('down', { status: 502 }) }), (error) => error.failure === 'unavailable' && /HTTP 502/.test(error.message));

  // A challenge on one event page stops the remaining event-page requests.
  const requests = [];
  const diagnostics = {};
  const events = await fetchInsomniacEvents({
    startDate: '2026-11-11',
    endDate: '2026-11-30',
    detailDelayMs: 0,
    diagnostics,
    fetchImpl: async (url) => {
      requests.push(String(url));
      return String(url) === LISTING_URL ? new Response(listing) : blocked();
    }
  });
  assert.equal(requests.length, 2);
  assert.equal(events.length, 12);
  assert.ok(events.every((event) => event.listingOnly));
  assert.ok(diagnostics.warnings.some((warning) => /not fetched \(access challenge\)/.test(warning)));
});

test('a normalized Insomniac event deduplicates against a ticketing occurrence of the same night', async () => {
  const { fetchImpl } = await fixtureFetch();
  const raw = await fetchInsomniacEvents({ startDate: '2026-11-14', endDate: '2026-11-14', detailDelayMs: 0, fetchImpl });
  const insomniac = normalizeInsomniacEvent(raw.find((item) => item.name === 'Eli Brown'), '2026-11-11T23:00:00Z');
  const ticketed = {
    id: 'ticketmaster:tm1', source: 'ticketmaster', sourceEventId: 'tm1', sourceUrl: 'https://ticketmaster.example/tm1',
    type: 'concert', title: 'Eli Brown', startLocal: '2026-11-14T17:00:00',
    venue: { name: 'City Market Los Angeles', city: 'Los Angeles', state: 'CA', lat: 34.03, lon: -118.25 },
    performers: [{ name: 'Eli Brown' }], ticketObservation: { lowestPriceUsd: 60 }
  };
  const merged = deduplicateCandidates([insomniac, ticketed]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sourceOccurrences.map((occurrence) => occurrence.source).sort(), ['insomniac', 'ticketmaster']);
  assert.ok(merged[0].performers.some((performer) => performer.name === 'HNTR'));
});
