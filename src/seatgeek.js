import { normalizeArtistName } from './ranking.js';

const API_ROOT = 'https://api.seatgeek.com/2';
const EVENTS_URL = `${API_ROOT}/events`;
const PERFORMERS_URL = `${API_ROOT}/performers`;

export async function fetchSeatGeekWeekendEvents(options) {
  return fetchSeatGeekEvents({ ...options, maxPages: 1 });
}

export async function fetchSeatGeekEvents({
  clientId,
  startDate,
  endDate,
  config,
  maxPages = 1,
  windowDays = null,
  diagnostics = null,
  fetchImpl = fetch
}) {
  if (!clientId) throw new Error('Set SEATGEEK_CLIENT_ID in your environment before generating a brief.');
  const windows = windowDays
    ? splitDateWindows(startDate, endDate, windowDays)
    : [{ startDate, endDate }];
  const events = [];
  const seen = new Set();

  for (const window of windows) {
    const windowEvents = await fetchSeatGeekWindow({
      clientId,
      ...window,
      config,
      maxPages,
      diagnostics,
      fetchImpl
    });
    for (const event of windowEvents) {
      const key = String(event.id ?? event.url ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return events;
}

async function fetchSeatGeekWindow({ clientId, startDate, endDate, config, maxPages, diagnostics, fetchImpl }) {
  const events = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = eventSearchUrl({ clientId, startDate, endDate, config, page });
    if (diagnostics) diagnostics.geographicPagesFetched = (diagnostics.geographicPagesFetched ?? 0) + 1;
    let response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      throw new Error(`SeatGeek request failed for ${startDate} through ${endDate}: ${error.message}`);
    }
    if (!response.ok) {
      const detail = await safeResponseText(response);
      throw new Error(`SeatGeek request failed (${response.status}) for ${startDate} through ${endDate}.${detail ? ` ${detail}` : ''}`);
    }
    const body = await response.json();
    const pageEvents = Array.isArray(body.events) ? body.events : [];
    events.push(...pageEvents);
    const total = Number(body.meta?.total ?? 0);
    if (pageEvents.length < 100 || events.length >= total) break;
  }
  return events;
}

export function splitDateWindows(startDate, endDate, windowDays) {
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new Error('windowDays must be a positive integer');
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start > end) throw new Error('SeatGeek startDate must not be after endDate');

  const windows = [];
  let cursor = start;
  while (cursor <= end) {
    const windowEnd = new Date(cursor);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + windowDays - 1);
    if (windowEnd > end) windowEnd.setTime(end.getTime());
    windows.push({ startDate: isoDate(cursor), endDate: isoDate(windowEnd) });
    cursor = new Date(windowEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return windows;
}

function parseIsoDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ISO date: ${value}`);
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function eventSearchUrl({ clientId, startDate, endDate, config, page, performerIds = null, includeGeography = true }) {
  const url = new URL(EVENTS_URL);
  url.searchParams.set('client_id', clientId);
  if (includeGeography) {
    url.searchParams.set('lat', String(config.home.lat));
    url.searchParams.set('lon', String(config.home.lon));
    url.searchParams.set('range', `${config.searchRadiusMiles}mi`);
  }
  if (performerIds?.length) url.searchParams.set('performers.id', performerIds.join(','));
  url.searchParams.set('taxonomies.name', 'concert');
  url.searchParams.set('datetime_local.gte', startDate);
  url.searchParams.set('datetime_local.lte', `${endDate}T23:59:59`);
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', String(page));
  url.searchParams.set('sort', 'datetime_local.asc');
  return url;
}

export async function resolveSeatGeekPerformers(artists, {
  clientId,
  fetchImpl = fetch,
  concurrency = 5,
  cache = {}
} = {}) {
  if (!clientId) throw new Error('Set SEATGEEK_CLIENT_ID before resolving performers.');
  const resolved = new Array(artists.length);
  let next = 0;

  async function worker() {
    while (next < artists.length) {
      const index = next;
      next += 1;
      const artist = artists[index];
      const key = normalizeArtistName(artist.name);
      const cacheKey = `${key}|${artist.spotifyArtistId ?? ''}`;
      if (Object.hasOwn(cache, cacheKey)) {
        resolved[index] = cache[cacheKey];
        continue;
      }
      const candidates = await searchSeatGeekPerformers(artist.name, { clientId, fetchImpl });
      const selected = selectSeatGeekPerformer(artist, candidates);
      const result = selected ? {
        artistName: artist.name,
        artistOrigin: artist.origin ?? 'source',
        spotifyArtistId: artist.spotifyArtistId ?? null,
        performerId: String(selected.id),
        performerName: selected.name,
        performerSlug: selected.slug ?? null,
        matchMethod: spotifyIdFromLinks(selected.links) === artist.spotifyArtistId ? 'spotify-id' : 'exact-name'
      } : null;
      cache[cacheKey] = result;
      resolved[index] = result;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, artists.length) }, worker));
  return { resolved: resolved.filter(Boolean), unresolvedCount: resolved.filter((item) => !item).length, cache };
}

export async function searchSeatGeekPerformers(name, { clientId, fetchImpl = fetch, limit = 10 } = {}) {
  if (!clientId) throw new Error('Set SEATGEEK_CLIENT_ID before searching performers.');
  const url = new URL(PERFORMERS_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('q', name);
  url.searchParams.set('taxonomies.name', 'concert');
  url.searchParams.set('per_page', String(limit));
  const body = await seatGeekJson(url, fetchImpl, `performer search for ${name}`);
  return Array.isArray(body.performers) ? body.performers : [];
}

export function selectSeatGeekPerformer(artist, candidates) {
  const spotifyId = String(artist.spotifyArtistId ?? '');
  const bySpotify = spotifyId
    ? candidates.filter((candidate) => spotifyIdFromLinks(candidate.links) === spotifyId)
    : [];
  const normalized = normalizeArtistName(artist.name);
  const exact = candidates.filter((candidate) => (
    normalizeArtistName(candidate.name) === normalized
    || normalizeArtistName(candidate.short_name) === normalized
  ));
  const pool = bySpotify.length ? bySpotify : exact;
  return pool
    .sort((a, b) => Number(Boolean(b.has_upcoming_events)) - Number(Boolean(a.has_upcoming_events)) || (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
}

export async function fetchSeatGeekEventsForPerformers({
  performerIds,
  clientId,
  startDate,
  endDate,
  config,
  maxPages = 5,
  windowDays = null,
  batchSize = 50,
  diagnostics = null,
  fetchImpl = fetch
}) {
  if (!clientId) throw new Error('Set SEATGEEK_CLIENT_ID before fetching performer events.');
  const uniqueIds = [...new Set(performerIds.map(String).filter(Boolean))];
  const windows = windowDays
    ? splitDateWindows(startDate, endDate, windowDays)
    : [{ startDate, endDate }];
  const events = new Map();
  for (let offset = 0; offset < uniqueIds.length; offset += batchSize) {
    const ids = uniqueIds.slice(offset, offset + batchSize);
    for (const window of windows) {
      let fetchedInWindow = 0;
      for (let page = 1; page <= maxPages; page += 1) {
        const url = eventSearchUrl({
          clientId,
          ...window,
          config,
          page,
          performerIds: ids,
          includeGeography: false
        });
        if (diagnostics) diagnostics.performerPagesFetched = (diagnostics.performerPagesFetched ?? 0) + 1;
        const body = await seatGeekJson(url, fetchImpl, `events for performer batch ${offset / batchSize + 1}`);
        const pageEvents = Array.isArray(body.events) ? body.events : [];
        fetchedInWindow += pageEvents.length;
        for (const event of pageEvents) events.set(String(event.id), event);
        const total = Number(body.meta?.total ?? 0);
        if (pageEvents.length < 100 || fetchedInWindow >= total) break;
      }
    }
  }
  return [...events.values()];
}

export function eventWithinRadius(event, home, radiusMiles) {
  const lat = Number(event.venue?.location?.lat);
  const lon = Number(event.venue?.location?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return distanceMiles(home.lat, home.lon, lat, lon) <= radiusMiles;
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function normalizeSeatGeekEvent(event, retrievedAt = new Date()) {
  const venue = event.venue ?? {};
  const performers = (Array.isArray(event.performers) ? event.performers : []).map((performer) => ({
    sourceId: performer.id == null ? null : String(performer.id),
    name: String(performer.name ?? performer.short_name ?? '').trim(),
    primary: performer.primary === true,
    spotifyId: spotifyIdFromLinks(performer.links)
  })).filter((performer) => performer.name);

  return {
    schemaVersion: 1,
    id: `seatgeek:${event.id}`,
    source: 'seatgeek',
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ''),
    retrievedAt: new Date(retrievedAt).toISOString(),
    title: String(event.title ?? event.short_title ?? '').trim(),
    type: String(event.type ?? '').trim(),
    startLocal: event.datetime_local ?? null,
    startUtc: event.datetime_utc ?? null,
    timeTbd: Boolean(event.time_tbd),
    dateTbd: Boolean(event.date_tbd),
    status: event.status ?? 'scheduled',
    venue: {
      sourceId: venue.id == null ? null : String(venue.id),
      name: String(venue.name ?? '').trim(),
      city: String(venue.city ?? '').trim(),
      state: String(venue.state ?? '').trim(),
      lat: numberOrNull(venue.location?.lat),
      lon: numberOrNull(venue.location?.lon)
    },
    performers,
    ticketObservation: {
      listingCount: numberOrNull(event.stats?.listing_count),
      lowestPriceUsd: numberOrNull(event.stats?.lowest_price),
      averagePriceUsd: numberOrNull(event.stats?.average_price),
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}

export function spotifyIdFromLinks(links) {
  const spotify = (Array.isArray(links) ? links : []).find((link) => String(link.provider ?? '').toLowerCase() === 'spotify');
  if (!spotify) return null;
  const explicit = String(spotify.id ?? '').trim();
  if (explicit) {
    const segments = explicit.split(':');
    return segments.at(-1) || explicit;
  }
  const url = String(spotify.url ?? '');
  const match = url.match(/artist\/([A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function safeResponseText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

async function seatGeekJson(url, fetchImpl, context, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      throw new Error(`SeatGeek ${context} failed: ${error.message}`);
    }
    if (response.ok) return response.json();
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(30_000, retryAfter * 1000)
        : 1000 * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const detail = await safeResponseText(response);
    throw new Error(`SeatGeek ${context} failed (${response.status}).${detail ? ` ${detail}` : ''}`);
  }
  throw new Error(`SeatGeek ${context} failed after retries.`);
}
