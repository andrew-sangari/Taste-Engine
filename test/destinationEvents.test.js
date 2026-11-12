import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_DESTINATION_WATCHLIST,
  announcedEditions,
  enrichDestinationEventsWithEdmtrain,
  fetchDestinationEvents,
  matchDestinationWatch,
  resolveDestinationWatchlist
} from '../src/destinationEvents.js';
import { normalizeEdmtrainEvent } from '../src/edmtrain.js';
import { normalizeTicketmasterEvent } from '../src/ticketmaster.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/destination/${name}`, import.meta.url), 'utf8'));
const config = { home: { label: 'Home', lat: 34.05, lon: -118.25 }, searchRadiusMiles: 60 };
const window = { startDate: '2026-11-11', endDate: '2027-05-10' };
const RETRIEVED = '2026-11-11T23:30:00Z';

// Routes each provider to its fixture and records every request.
async function providers({ ticketmaster, seatgeek, edmtrain } = {}) {
  const real = await fixture('ticketmaster-keyword-crssd.json');
  const sg = await fixture('seatgeek-query-proper-nye.synthetic.json');
  const edm = await fixture('edmtrain-san-diego.synthetic.json');
  const requests = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.hostname === 'app.ticketmaster.com') return ticketmaster ? ticketmaster(url, json) : json(real);
    if (url.hostname === 'api.seatgeek.com') return seatgeek ? seatgeek(url, json) : json(url.searchParams.get('q') === 'Proper NYE' ? sg : { events: [], meta: { total: 0 } });
    if (url.hostname === 'edmtrain.com') return edmtrain ? edmtrain(url, json) : json(url.pathname.endsWith('/locations') ? { data: edm.locations } : { data: edm.events });
    throw new Error(`unexpected request to ${url.hostname}`);
  };
  return { fetchImpl, requests, real, sg, edm };
}

test('the default watchlist is CRSSD and Proper NYE, and the config key replaces it', () => {
  assert.deepEqual(DEFAULT_DESTINATION_WATCHLIST, [
    { name: 'CRSSD', aliases: ['CRSSD Festival', 'CRSSD Fest'], city: 'San Diego', maxDistanceMiles: 160 },
    { name: 'Proper NYE', aliases: ['PROPER NYE/NYD'], city: 'San Diego', maxDistanceMiles: 160 }
  ]);
  assert.deepEqual(resolveDestinationWatchlist(undefined).map((entry) => entry.name), ['CRSSD', 'Proper NYE']);
  assert.deepEqual(resolveDestinationWatchlist([]), []);
  assert.deepEqual(resolveDestinationWatchlist([{ name: 'Movement', city: 'Detroit', state: 'Michigan', maxDistanceMiles: 2500 }]), [
    { name: 'Movement', aliases: [], city: 'Detroit', state: 'Michigan', maxDistanceMiles: 2500, type: 'music_festival' }
  ]);
  assert.throws(() => resolveDestinationWatchlist({ name: 'CRSSD' }), /must be an array/);
  assert.throws(() => resolveDestinationWatchlist([{ name: 'XX' }]), /at least three characters/);
  assert.throws(() => resolveDestinationWatchlist([{ name: 'CRSSD', maxDistanceMiles: 0 }]), /greater than zero/);
});

test('matches watchlist names exactly and never fuzzily', () => {
  const name = (input) => matchDestinationWatch(input)?.watch.name ?? null;
  assert.equal(name({ title: 'CRSSD' }), 'CRSSD');
  assert.equal(name({ title: 'CRSSD Festival Spring 2027 - Saturday' }), 'CRSSD');
  assert.equal(name({ title: 'CRSSD Fest' }), 'CRSSD');
  assert.equal(name({ title: 'Some Listing', performerNames: ['CRSSD Festival'] }), 'CRSSD');
  assert.equal(name({ title: 'Proper NYE/NYD 2027 - Two Day Pass' }), 'Proper NYE');
  // The real Ticketmaster title: the presenter is FNGRS CRSSD, the event is Proper NYE.
  assert.equal(name({ title: 'FNGRS CRSSD presents Proper NYE/NYD 2027 (21 and Over) - Two Day Pass', performerNames: ['Proper NYE/NYD'] }), 'Proper NYE');

  // A presenter credit is not the event, and near-misses are not matches.
  assert.equal(name({ title: 'FNGRS CRSSD presents Example Artist' }), null);
  assert.equal(name({ title: 'CRSSD presents Example Artist' }), null);
  assert.equal(name({ title: 'Example Artist at CRSSD Afterparty' }), null);
  assert.equal(name({ title: 'CRSSDX Festival' }), null);
  assert.equal(name({ title: 'Crossed Festival' }), null);
  assert.equal(name({ title: 'A Proper New Years Eve' }), null);
  assert.equal(name({ title: 'Improper NYE' }), null);
  assert.equal(name({ title: 'Example', performerNames: ['CRSSD Festival Allstars'] }), null);
});

test('the real Ticketmaster listing becomes a dated destination candidate', async () => {
  const { fetchImpl, requests, real } = await providers();
  const result = await fetchDestinationEvents({ config, ...window, ticketmasterApiKey: 'key', retrievedAt: RETRIEVED, fetchImpl });
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.warnings, []);
  const event = result.events[0];
  assert.equal(event.title, 'FNGRS CRSSD presents Proper NYE/NYD 2027 (21 and Over) - Two Day Pass');
  assert.equal(event.id, 'ticketmaster:Z7r9jZ1AAvsAP');
  assert.equal(event.source, 'ticketmaster');
  assert.equal(event.sourceUrl, 'https://www.ticketmaster.com/event/Z7r9jZ1AAvsAP');
  assert.equal(event.retrievedAt, '2026-11-11T23:30:00.000Z');
  assert.equal(event.type, 'music_festival');
  assert.deepEqual({ name: event.venue.name, city: event.venue.city, state: event.venue.state }, { name: 'Gallagher Square at Petco Park', city: 'San Diego', state: 'CA' });

  // Ticketmaster sells this pass "date TBA". The two days come from the
  // title and are accepted because the provider's sale end agrees; the
  // candidate says so instead of presenting them as a published date.
  assert.equal(event.startLocal, '2026-12-31T00:00:00');
  assert.equal(event.dateTbd, false);
  assert.equal(event.timeTbd, true);
  assert.deepEqual(event.destination, {
    name: 'Proper NYE',
    city: 'San Diego',
    distanceMiles: 111,
    distanceLabel: 'about 110 mi from Home',
    days: ['2026-12-31', '2027-01-01'],
    startDate: '2026-12-31',
    endDate: '2027-01-01',
    dateSource: 'derived-from-title',
    dateNote: 'The provider lists the date as TBA. 2026-12-31 to 2027-01-01 is read from "NYE/NYD 2027" in the listing title and agrees with the provider\'s public sale end (2027-01-03).'
  });

  // Ticketmaster bills the festival as its own attraction; that is not an act.
  assert.deepEqual(event.performers, []);
  // Same candidate contract as the regional Ticketmaster path, plus the marker.
  const regional = normalizeTicketmasterEvent(real._embedded.events[0], RETRIEVED);
  assert.deepEqual(Object.keys(event).sort(), [...Object.keys(regional), 'destination'].sort());
  assert.equal(event.sourceOccurrences.length, 1);
  assert.equal(event.sourceOccurrences[0].sourceUrl, event.sourceUrl);
  assert.equal(event.sourceOccurrences[0].retrievedAt, '2026-11-11T23:30:00.000Z');
  assert.equal(event.eventEvidence.provider, 'ticketmaster');

  // One query per distinct name, by name, on the watch entry's own radius and
  // without the music-only filter that hides festival passes.
  assert.deepEqual(requests.map((url) => url.searchParams.get('keyword')), ['CRSSD', 'Proper NYE']);
  for (const url of requests) {
    assert.equal(url.searchParams.get('radius'), '160');
    assert.equal(url.searchParams.get('latlong'), '34.05,-118.25');
    assert.equal(url.searchParams.get('classificationName'), null);
    assert.equal(url.searchParams.get('includeTBA'), 'yes');
  }
  assert.deepEqual(result.sources.ticketmaster, { configured: true, queries: 2, failures: 0, matched: 1 });
  assert.equal(result.sources.seatgeek.configured, false);
});

test('ticketing listings of one edition merge into one candidate and keep every link', async () => {
  const { fetchImpl, requests } = await providers();
  const result = await fetchDestinationEvents({ config, ...window, ticketmasterApiKey: 'key', seatGeekClientId: 'client', retrievedAt: RETRIEVED, fetchImpl });
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  // The same-named party in another city is not the watched event.
  assert.deepEqual(event.sourceOccurrences.map((occurrence) => `${occurrence.source}:${occurrence.sourceEventId}`), ['ticketmaster:Z7r9jZ1AAvsAP', 'seatgeek:900001', 'seatgeek:900002']);
  assert.ok(event.sourceOccurrences.every((occurrence) => occurrence.sourceUrl && occurrence.retrievedAt === '2026-11-11T23:30:00.000Z'));
  assert.equal(event.source, 'seatgeek');
  assert.equal(event.startLocal, '2026-12-31T16:00:00');
  assert.equal(event.timeTbd, false);
  assert.deepEqual(event.destination.days, ['2026-12-31', '2027-01-01']);
  assert.equal(event.destination.dateSource, 'published');
  assert.equal(event.destination.dateNote, undefined);
  assert.equal(event.destination.name, 'Proper NYE');
  assert.equal(event.ticketObservation.lowestPriceUsd, 189);
  assert.deepEqual(event.performers, []);

  const seatgeek = requests.filter((url) => url.hostname === 'api.seatgeek.com');
  assert.deepEqual(seatgeek.map((url) => url.searchParams.get('q')), ['CRSSD', 'Proper NYE']);
  assert.ok(seatgeek.every((url) => url.searchParams.get('range') === '160mi'));
  assert.equal(result.sources.seatgeek.matched, 2);
});

test('EDMTrain enriches a listed edition and surfaces a watchlist edition no ticketing API lists', async () => {
  const { fetchImpl } = await providers();
  const artistSnapshot = { artists: [{ name: 'Example Headliner', origin: 'source' }, { name: 'Example Opener', origin: 'similar' }] };
  const result = await fetchDestinationEvents({ config, ...window, ticketmasterApiKey: 'key', edmtrainClientKey: 'client', artistSnapshot, retrievedAt: RETRIEVED, fetchImpl });

  // Proper NYE is listed by Ticketmaster, so EDMTrain only adds its lineup.
  // CRSSD Spring 2027 is announced on EDMTrain alone: it becomes one announced
  // candidate for the two-day edition.
  assert.deepEqual(result.events.map((event) => [event.destination.name, event.source]), [['Proper NYE', 'ticketmaster'], ['CRSSD', 'edmtrain']]);
  assert.deepEqual(result.audit.map((item) => [item.watch, item.date, item.status]), [
    ['Proper NYE', '2026-12-31', 'matched'],
    ['Proper NYE', '2027-01-01', 'matched'],
    ['CRSSD', '2027-03-13', 'announced-surfaced'],
    ['CRSSD', '2027-03-14', 'announced-surfaced']
  ]);
  assert.ok(result.audit.every((item) => item.sourceUrl));
  assert.equal(result.sources.edmtrain.announced, 1);

  const crssd = result.events[1];
  assert.equal(crssd.id, 'edmtrain:410003');
  assert.equal(crssd.title, 'CRSSD Spring 2027');
  assert.equal(crssd.sourceUrl, 'https://edmtrain.example/san-diego-ca/crssd-spring-2027-410003');
  assert.equal(crssd.status, 'announced');
  assert.equal(crssd.startLocal, '2027-03-13T00:00:00');
  assert.equal(crssd.timeTbd, true);
  assert.deepEqual({ name: crssd.venue.name, city: crssd.venue.city, state: crssd.venue.state }, { name: 'Waterfront Park San Diego', city: 'San Diego', state: 'CA' });
  assert.deepEqual(crssd.destination.days, ['2027-03-13', '2027-03-14']);
  assert.equal(crssd.destination.announcedBy, 'edmtrain');
  assert.match(crssd.destination.dateNote, /Announced on EDMTrain/);
  assert.match(crssd.destination.distanceLabel, /^about 1\d\d mi from Home$/);
  // Nothing is claimed about tickets, and no typed evidence is kept for a non-permitted provider.
  assert.deepEqual({ ...crssd.ticketObservation, observedAt: null }, { listingCount: null, lowestPriceUsd: null, averagePriceUsd: null, observedAt: null });
  assert.equal(crssd.eventEvidence, null);
  assert.deepEqual(crssd.sourceOccurrences.map((occurrence) => [occurrence.source, occurrence.sourceEventId]), [['edmtrain', '410003'], ['edmtrain', '410004']]);
  assert.ok(crssd.sourceOccurrences.every((occurrence) => occurrence.sourceUrl && occurrence.retrievedAt === '2026-11-11T23:30:00.000Z'));
  // Same candidate contract as a ticketing destination candidate.
  assert.deepEqual(Object.keys(crssd).sort(), Object.keys(result.events[0]).filter((key) => key !== 'lineupDisplay').sort());

  const event = result.events[0];
  assert.equal(event.lineupDisplay.displayShape, 'festival');
  assert.deepEqual(event.lineupDisplay.orderedArtists.map((artist) => [artist.displayName, artist.billingGroupIndex, artist.relation]), [
    ['Example Headliner', 0, 'direct'],
    ['Example Duo A', 1, 'unknown'],
    ['Example Duo B', 1, 'unknown'],
    ['Example Opener', 2, 'adjacent']
  ]);
  assert.equal(event.lineupDisplay.ages, '21+');
  // Only artists the taste profile knows join the performers.
  assert.deepEqual(event.performers.map((performer) => performer.name), ['Example Headliner', 'Example Opener']);
  // EDMTrain supplies no date: the candidate's days are still the ticketing source's.
  assert.equal(event.destination.dateSource, 'derived-from-title');
  assert.equal(result.sources.edmtrain.matched, 1);

  // A non-festival record or one in another place enriches nothing.
  const lone = { id: 'ticketmaster:x', title: 'Proper NYE/NYD', venue: { name: 'Gallagher Square at Petco Park', city: 'San Diego' }, performers: [], destination: { name: 'Proper NYE', days: ['2026-12-31'] } };
  const elsewhere = normalizeEdmtrainEvent({ id: 1, name: 'Proper NYE/NYD', date: '2026-12-31', festivalInd: true, venue: { name: 'Example Arena' }, artistList: [{ name: 'Example Headliner' }] });
  const notFestival = normalizeEdmtrainEvent({ id: 2, name: 'Proper NYE/NYD', date: '2026-12-31', festivalInd: false, venue: { name: 'Petco Park' }, artistList: [{ name: 'Example Headliner' }] });
  const untouched = enrichDestinationEventsWithEdmtrain([lone], [elsewhere, notFestival], artistSnapshot);
  assert.equal(untouched.matchedCount, 0);
  assert.equal(lone.lineupDisplay, undefined);
  assert.deepEqual(untouched.audit.map((item) => item.status), ['announced-no-permitted-candidate']);
});

test('an EDMTrain announcement creates a candidate only for an exact, located, unlisted watchlist festival', () => {
  const watchlist = resolveDestinationWatchlist(undefined);
  const home = config.home;
  const waterfront = { name: 'Waterfront Park San Diego', location: 'San Diego, CA', latitude: 32.7218, longitude: -117.1727 };
  const edm = (id, overrides = {}) => normalizeEdmtrainEvent({ id, name: 'CRSSD Spring 2027', date: '2027-03-13', festivalInd: true, link: `https://edmtrain.example/${id}`, venue: waterfront, artistList: [], ...overrides });
  const names = (records, events = []) => announcedEditions(events, records, watchlist, { home, config }).map((event) => event.id);

  assert.deepEqual(names([edm(1)]), ['edmtrain:1']);
  // Not festival-flagged, a presenter credit, a near-miss name, no link, no date: nothing.
  assert.deepEqual(names([edm(2, { festivalInd: false })]), []);
  assert.deepEqual(names([edm(3, { name: 'FNGRS CRSSD presents Example Artist' })]), []);
  assert.deepEqual(names([edm(4, { name: 'CRSSDX Festival' })]), []);
  assert.deepEqual(names([edm(5, { link: null })]), []);
  assert.deepEqual(names([edm(6, { date: '' })]), []);
  // Outside the watch area, or a place that cannot be verified at all.
  assert.deepEqual(names([edm(7, { venue: { name: 'Example Field', location: 'Phoenix, AZ', latitude: 33.4484, longitude: -112.074 } })]), []);
  assert.deepEqual(names([edm(8, { venue: { name: 'Somewhere' } })]), []);
  // A ticketing edition on or next to that day owns it: EDMTrain creates nothing.
  const listed = { id: 'ticketmaster:sat', destination: { name: 'CRSSD', days: ['2027-03-14'] } };
  assert.deepEqual(names([edm(9)], [listed]), []);
  // A later, separate edition is its own candidate; outside the window it is dropped.
  assert.deepEqual(names([edm(10), edm(11, { date: '2027-09-25' })]), ['edmtrain:10', 'edmtrain:11']);
  assert.deepEqual(announcedEditions([], [edm(12)], watchlist, { home, config, startDate: '2027-04-01', endDate: '2027-06-01' }), []);
});

test('CRSSD is picked up as one edition as soon as a ticketing API lists it', async () => {
  const waterfront = { name: 'Waterfront Park', city: { name: 'San Diego' }, state: { stateCode: 'CA' }, location: { latitude: '32.7218', longitude: '-117.1727' } };
  const festivalBill = [{ id: 'crssd', name: 'CRSSD Festival' }, { id: 'a1', name: 'Example Headliner' }];
  const listing = (id, name, localDate, venue = waterfront, attractions = festivalBill) => ({
    id, name, url: `https://www.ticketmaster.com/event/${id}`,
    dates: { start: { localDate, localTime: '12:00:00' }, status: { code: 'onsale' } },
    _embedded: { venues: [venue], attractions }
  });
  const { fetchImpl } = await providers({
    ticketmaster: (url, json) => json(url.searchParams.get('keyword') === 'CRSSD' ? { _embedded: { events: [
      listing('sat', 'CRSSD Festival Spring 2027 - Saturday', '2027-03-13'),
      listing('sun', 'CRSSD Festival Spring 2027 - Sunday', '2027-03-14'),
      listing('club', 'FNGRS CRSSD presents Example Artist', '2027-02-06', { name: 'Example Club', city: { name: 'San Diego' }, state: { stateCode: 'CA' } }, [{ id: 'a2', name: 'Example Artist' }]),
      listing('far', 'CRSSD Festival', '2027-03-13', { name: 'Example Field', city: { name: 'Phoenix' }, state: { stateCode: 'AZ' }, location: { latitude: '33.4484', longitude: '-112.0740' } })
    ] } } : {})
  });
  const result = await fetchDestinationEvents({ config, ...window, ticketmasterApiKey: 'key', retrievedAt: RETRIEVED, fetchImpl });
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.equal(event.destination.name, 'CRSSD');
  assert.deepEqual(event.destination.days, ['2027-03-13', '2027-03-14']);
  assert.equal(event.destination.dateSource, 'published');
  assert.equal(event.startLocal, '2027-03-13T12:00:00');
  assert.deepEqual(event.sourceOccurrences.map((occurrence) => occurrence.sourceEventId), ['sat', 'sun']);
  // The festival attraction is dropped; the billed act stays.
  assert.deepEqual(event.performers.map((performer) => performer.name), ['Example Headliner']);
  assert.match(event.destination.distanceLabel, /^about 1\d\d mi from Home$/);

  // Outside the requested window the edition is not returned.
  const later = await fetchDestinationEvents({ config, startDate: '2027-03-20', endDate: '2027-06-01', ticketmasterApiKey: 'key', fetchImpl });
  assert.deepEqual(later.events, []);
});

test('an exact match with no usable date is held as pending, not published', async () => {
  const { fetchImpl, real } = await providers({
    ticketmaster: (url, json) => {
      const copy = structuredClone(real);
      delete copy._embedded.events[0].sales;
      return json(copy);
    }
  });
  const result = await fetchDestinationEvents({ config, ...window, ticketmasterApiKey: 'key', retrievedAt: RETRIEVED, fetchImpl });
  assert.deepEqual(result.events, []);
  assert.equal(result.pending.length, 1);
  assert.deepEqual({ watch: result.pending[0].watch, source: result.pending[0].source, sourceUrl: result.pending[0].sourceUrl }, {
    watch: 'Proper NYE', source: 'ticketmaster', sourceUrl: 'https://www.ticketmaster.com/event/Z7r9jZ1AAvsAP'
  });
  assert.match(result.pending[0].reason, /without a date/);
});

test('provider failures degrade independently and a total failure is an error', async () => {
  const partial = await providers({ seatgeek: (url, json) => json({ error: 'down' }, 500), edmtrain: (url, json) => json({}, 503) });
  const result = await fetchDestinationEvents({ config, ...window, ticketmasterApiKey: 'key', seatGeekClientId: 'client', edmtrainClientKey: 'client', retrievedAt: RETRIEVED, fetchImpl: partial.fetchImpl });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].source, 'ticketmaster');
  assert.equal(result.sources.seatgeek.failures, 2);
  assert.equal(result.sources.edmtrain.failures, 1);
  assert.equal(result.warnings.length, 3);
  assert.equal(result.events[0].lineupDisplay, undefined);

  const down = await providers({ ticketmaster: (url, json) => json({}, 500), seatgeek: (url, json) => json({}, 500) });
  await assert.rejects(
    fetchDestinationEvents({ config, ...window, ticketmasterApiKey: 'key', seatGeekClientId: 'client', fetchImpl: down.fetchImpl }),
    /Destination event search failed on every ticketing query/
  );

  // No ticketing credentials: nothing is requested and nothing is invented.
  const idle = await providers();
  const empty = await fetchDestinationEvents({ config, ...window, fetchImpl: idle.fetchImpl });
  assert.deepEqual(empty.events, []);
  assert.equal(idle.requests.length, 0);
  assert.equal(empty.sources.ticketmaster.configured, false);

  // An empty watchlist turns the source off.
  const off = await providers();
  assert.deepEqual((await fetchDestinationEvents({ watchlist: [], config, ...window, ticketmasterApiKey: 'key', fetchImpl: off.fetchImpl })).events, []);
  assert.equal(off.requests.length, 0);
});
