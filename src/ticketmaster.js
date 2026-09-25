import { normalizeArtistName } from './ranking.js';
import { createEvidenceFact, createEventEvidence, meaningfulClassifications } from './eventEvidence.js';

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
  const retrieved = new Date(retrievedAt).toISOString();
  const sourceEventId = String(event.id);
  const sourceUrl = String(event.url ?? '');
  const title = cleanText(event.name);
  const startLocal = localDate ? `${localDate}T${localTime || '00:00:00'}` : null;
  const startUtc = event.dates?.start?.dateTime ?? null;
  const doorsUtc = event.dates?.start?.doorsDateTime ?? null;
  const endUtc = event.dates?.end?.dateTime ?? null;
  const doorsLocal = event.dates?.start?.doorsLocalDate && event.dates?.start?.doorsLocalTime
    ? `${event.dates.start.doorsLocalDate}T${event.dates.start.doorsLocalTime}`
    : null;
  const endLocal = event.dates?.end?.localDate
    ? `${event.dates.end.localDate}T${event.dates.end.localTime || '00:00:00'}`
    : null;
  const classifications = ticketmasterClassifications(event);
  const namedLineup = attractions.map((attraction) => cleanText(attraction.name)).filter(Boolean);
  const description = [event.info, event.pleaseNote].map(cleanText).filter(Boolean).join(' ');
  const venueInfo = {
    name: cleanText(venue.name),
    city: cleanText(venue.city?.name),
    state: cleanText(venue.state?.stateCode ?? venue.state?.name),
    accessibility: cleanText(venue.accessibility?.info ?? venue.accessibility?.ticketLimit)
  };
  const eventEvidence = createEventEvidence({
    eventRef: `ticketmaster:${sourceEventId}`,
    provider: 'ticketmaster',
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    facts: {
      title: createEvidenceFact({
        value: title,
        field: 'title',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      description: createEvidenceFact({
        value: description,
        field: 'description',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        assertionKind: 'descriptive-copy',
        permission: { internalUse: true, display: true, modelInput: false, persist: true }
      }),
      classification: createEvidenceFact({
        value: classifications,
        field: 'classification',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      namedLineup: createEvidenceFact({
        value: namedLineup,
        field: 'namedLineup',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      format: createEvidenceFact({
        value: event.eventType ?? event.format ?? null,
        field: 'format',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      doorTime: createEvidenceFact({
        value: doorsLocal ?? doorsUtc,
        field: 'doorTime',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      startTime: createEvidenceFact({
        value: { local: startLocal, utc: startUtc },
        field: 'startTime',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      endTime: createEvidenceFact({
        value: endLocal ?? endUtc,
        field: 'endTime',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      venueInfo: createEvidenceFact({
        value: venueInfo,
        field: 'venueInfo',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      agePolicy: createEvidenceFact({
        value: event.ageRestrictions?.legalAge ?? event.ageRestrictions?.description ?? null,
        field: 'agePolicy',
        provider: 'ticketmaster',
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      })
    }
  });
  const sourceOccurrence = {
    source: 'ticketmaster',
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    title,
    startLocal,
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: cleanText(venue.name),
      city: cleanText(venue.city?.name),
      state: cleanText(venue.state?.stateCode ?? venue.state?.name),
      lat: numberOrNull(venue.location?.latitude),
      lon: numberOrNull(venue.location?.longitude)
    },
    performerNames: namedLineup,
    evidence: eventEvidence
  };
  return {
    schemaVersion: 1,
    id: `ticketmaster:${sourceEventId}`,
    source: 'ticketmaster',
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [sourceOccurrence],
    eventEvidence,
    retrievedAt: retrieved,
    title,
    type: 'concert',
    startLocal,
    startUtc,
    doorsLocal,
    endLocal,
    timeTbd: Boolean(event.dates?.start?.timeTBA || !localTime),
    dateTbd: Boolean(event.dates?.start?.dateTBA || !localDate),
    status: event.dates?.status?.code ?? 'scheduled',
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: cleanText(venue.name),
      city: cleanText(venue.city?.name),
      state: cleanText(venue.state?.stateCode ?? venue.state?.name),
      lat: numberOrNull(venue.location?.latitude),
      lon: numberOrNull(venue.location?.longitude)
    },
    performers: attractions.map((attraction, index) => ({
      sourceId: attraction.id ? String(attraction.id) : null,
      name: cleanText(attraction.name),
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

// Only the segment and genre levels are kept as a rule. Ticketmaster's music
// subgenre is assigned unreliably: in the September 2026 Los Angeles projection
// six of the eight Dance/Electronic events (John Summit, Bonobo, Sub Focus and
// others) carried the subgenre "Amapiano", which none of them are. Its
// attraction type/subType ("Individual", "Musician") describes the act's shape,
// not the event. Publishing either as a verified classification would state
// something the event never was, so neither is evidence.
//
// The one exception is "Event Style", which names a taxonomy branch rather
// than a sound or an act. Under it the child level ("Festival") is the event's
// actual type, so it is kept. Ticketmaster uses it at the genre level and at the
// type level (festival listings arrive as type "Event Style", subType
// "Festival"), so both pairs are read.
function ticketmasterClassifications(event) {
  const values = [];
  for (const classification of event.classifications ?? []) {
    for (const [parent, child] of [['segment', null], ['genre', 'subGenre'], ['type', 'subType']]) {
      const value = cleanText(classification?.[parent]?.name);
      const eventStyle = /^event style$/i.test(value);
      if (parent !== 'type' || eventStyle) {
        if (value) values.push(value);
      }
      if (child && eventStyle) {
        const detail = cleanText(classification?.[child]?.name);
        if (detail) values.push(detail);
      }
    }
  }
  return meaningfulClassifications(values, { provider: 'ticketmaster' });
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
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
