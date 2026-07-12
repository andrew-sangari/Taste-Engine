import { normalizeArtistName } from './ranking.js';

const API_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

export async function fetchTicketmasterEvents({
  apiKey,
  startDate,
  endDate,
  config,
  maxPages = 5,
  keyword = null,
  fetchImpl = fetch
}) {
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY is not configured.');
  const events = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(API_URL);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('classificationName', 'music');
    if (keyword) url.searchParams.set('keyword', String(keyword));
    url.searchParams.set('latlong', `${config.home.lat},${config.home.lon}`);
    url.searchParams.set('radius', String(config.searchRadiusMiles));
    url.searchParams.set('unit', 'miles');
    url.searchParams.set('startDateTime', `${startDate}T00:00:00Z`);
    url.searchParams.set('endDateTime', `${endDate}T23:59:59Z`);
    url.searchParams.set('includeTBA', 'yes');
    url.searchParams.set('includeTBD', 'yes');
    url.searchParams.set('size', '200');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'date,asc');
    const body = await requestJson(url, fetchImpl);
    const pageEvents = body._embedded?.events ?? [];
    events.push(...pageEvents);
    const totalPages = Number(body.page?.totalPages ?? 0);
    if (!pageEvents.length || page + 1 >= totalPages) break;
  }
  return events;
}

/**
 * Query Ticketmaster with a bounded artist watchlist. The broad regional query
 * remains the primary path; this expansion catches Framework roster artists
 * that fall outside the broad page window. Results are retained only when the
 * Ticketmaster response names the artist in its attractions (or exact event
 * title when attractions are absent), avoiding loose keyword false positives.
 */
export async function fetchTicketmasterEventsForArtists({
  artists = [],
  apiKey,
  startDate,
  endDate,
  config,
  maxArtists = 200,
  maxPages = 1,
  concurrency = 4,
  diagnostics = null,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY is not configured.');
  const watchlist = [...new Map(artists
    .map((artist) => [normalizeArtistName(artist.name), artist])
    .filter(([key]) => key)).values()].slice(0, maxArtists);
  const events = new Map();
  const warnings = [];
  let next = 0;

  async function worker() {
    while (next < watchlist.length) {
      const artist = watchlist[next++];
      if (diagnostics) diagnostics.artistQueries = (diagnostics.artistQueries ?? 0) + 1;
      try {
        const raw = await fetchTicketmasterEvents({
          apiKey,
          startDate,
          endDate,
          config,
          maxPages,
          keyword: artist.name,
          fetchImpl
        });
        for (const event of raw) {
          if (!ticketmasterEventMatchesArtist(event, artist.name)) continue;
          events.set(String(event.id ?? event.url ?? `${artist.name}|${event.name ?? ''}`), event);
        }
      } catch (error) {
        warnings.push(error.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, watchlist.length) }, worker));
  if (diagnostics) diagnostics.artistEventsMatched = events.size;
  return { events: [...events.values()], warnings, artistCount: watchlist.length };
}

export function ticketmasterEventMatchesArtist(event, artistName) {
  const target = normalizeArtistName(artistName);
  if (!target) return false;
  const attractions = (event?._embedded?.attractions ?? [])
    .map((attraction) => normalizeArtistName(attraction.name))
    .filter(Boolean);
  if (attractions.length) return attractions.includes(target);
  return normalizeArtistName(event?.name) === target;
}

export function normalizeTicketmasterEvent(event, retrievedAt = new Date()) {
  const venue = event._embedded?.venues?.[0] ?? {};
  const attractions = event._embedded?.attractions ?? [];
  const localDate = event.dates?.start?.localDate ?? null;
  const localTime = event.dates?.start?.localTime ?? null;
  return {
    schemaVersion: 1,
    id: `ticketmaster:${event.id}`,
    source: 'ticketmaster',
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ''),
    sourceOccurrences: [{ source: 'ticketmaster', sourceEventId: String(event.id), sourceUrl: String(event.url ?? '') }],
    retrievedAt: new Date(retrievedAt).toISOString(),
    title: String(event.name ?? '').trim(),
    type: 'concert',
    startLocal: localDate ? `${localDate}T${localTime || '00:00:00'}` : null,
    startUtc: event.dates?.start?.dateTime ?? null,
    timeTbd: Boolean(event.dates?.start?.timeTBA || !localTime),
    dateTbd: Boolean(event.dates?.start?.dateTBA || !localDate),
    status: event.dates?.status?.code ?? 'scheduled',
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: String(venue.name ?? '').trim(),
      city: String(venue.city?.name ?? '').trim(),
      state: String(venue.state?.stateCode ?? venue.state?.name ?? '').trim(),
      lat: numberOrNull(venue.location?.latitude),
      lon: numberOrNull(venue.location?.longitude)
    },
    performers: attractions.map((attraction, index) => ({
      sourceId: attraction.id ? String(attraction.id) : null,
      name: String(attraction.name ?? '').trim(),
      primary: index === 0,
      spotifyId: null
    })).filter((performer) => performer.name),
    ticketObservation: {
      listingCount: null,
      lowestPriceUsd: numberOrNull(event.priceRanges?.[0]?.min),
      averagePriceUsd: null,
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}

async function requestJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Ticketmaster request failed (${response.status}).`);
  return response.json();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
