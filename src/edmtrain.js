import { canonicalEventTitle } from './candidates.js';
import { normalizeArtistName } from './ranking.js';

export const EDMTRAIN_API_BASE_URL = 'https://edmtrain.com/api/';

export function buildEdmtrainUrl(path, params = {}) {
  const url = new URL(String(path).replace(/^\/+/, ''), EDMTRAIN_API_BASE_URL);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  return url;
}

export async function fetchEdmtrainEvents({ clientKey, startDate, endDate, city = 'Los Angeles', state = 'California', fetchImpl = fetch }) {
  if (!clientKey) throw new Error('EDMTRAIN_CLIENT_KEY is not configured');
  const locationsUrl = buildEdmtrainUrl('locations', { state, city, client: clientKey });
  const locations = await requestJson(locationsUrl, fetchImpl);
  const location = unwrap(locations, ['locations', 'data']).find((item) => normalizeArtistName(item.city) === normalizeArtistName(city)
    && normalizeArtistName(item.state ?? item.stateName) === normalizeArtistName(state)
    && (!item.country || normalizeArtistName(item.country).includes('united states')));
  if (!location?.id) throw new Error(`EDMTrain location not found for ${city}, ${state}`);
  const eventsUrl = buildEdmtrainUrl('events', {
    locationIds: location.id,
    startDate,
    endDate,
    livestreamInd: false,
    includeElectronicGenreInd: true,
    includeOtherGenreInd: false,
    client: clientKey
  });
  const body = await requestJson(eventsUrl, fetchImpl);
  return unwrap(body, ['events', 'data']).map(normalizeEdmtrainEvent).filter((event) => event.id && event.date);
}

export function normalizeEdmtrainEvent(raw) {
  const artists = Array.isArray(raw.artistList) ? raw.artistList : [];
  let group = 0;
  const orderedArtists = artists.map((artist, index) => {
    const b2bWithNext = Boolean(artist.b2bInd);
    const entry = {
      lineupEntryId: `${raw.id ?? 'event'}:${index}`,
      displayName: String(artist.name ?? artist.artistName ?? '').trim(),
      billingGroupIndex: group,
      b2bWithNext
    };
    if (!b2bWithNext) group += 1;
    return entry;
  }).filter((artist) => artist.displayName);
  return {
    id: String(raw.id ?? ''),
    sourceUrl: raw.link ? String(raw.link) : null,
    name: String(raw.name ?? raw.eventName ?? '').trim(),
    date: String(raw.date ?? raw.eventDate ?? '').slice(0, 10),
    ages: raw.ages ? String(raw.ages) : null,
    festival: Boolean(raw.festivalInd),
    venue: {
      name: String(raw.venue?.name ?? raw.venueName ?? '').trim(),
      city: String(raw.venue?.location?.city ?? raw.venue?.city ?? '').trim(),
      lat: finite(raw.venue?.latitude ?? raw.venue?.lat),
      lon: finite(raw.venue?.longitude ?? raw.venue?.lon)
    },
    orderedArtists
  };
}

export function enrichEventsWithEdmtrain(events, edmEvents, artistSnapshot) {
  const audit = [];
  let matchedCount = 0;
  let ambiguousCount = 0;
  let lineupArtistCount = 0;
  for (const edm of edmEvents) {
    const candidates = events.filter((event) => localDate(event.startLocal) === edm.date)
      .map((event) => ({ event, rule: matchRule(event, edm) })).filter((item) => item.rule);
    if (candidates.length !== 1) {
      if (candidates.length > 1) ambiguousCount += 1;
      audit.push({ edmtrainEventId: edm.id, status: candidates.length ? 'ambiguous' : 'unmatched', candidateCount: candidates.length });
      continue;
    }
    const { event, rule } = candidates[0];
    const resolved = resolveLineup(edm.orderedArtists, artistSnapshot);
    const existing = new Set(event.performers.map((performer) => normalizeArtistName(performer.name)));
    for (const artist of resolved.filter((item) => item.relation !== 'unknown')) {
      const key = normalizeArtistName(artist.displayName);
      if (key && !existing.has(key)) {
        event.performers.push({ sourceId: null, name: artist.displayName, primary: false });
        existing.add(key);
      }
    }
    event.lineupDisplay = {
      displayTitle: edm.name || event.title,
      displayShape: displayShape(edm, event),
      orderedArtists: resolved,
      totalArtists: resolved.length,
      directCount: resolved.filter((item) => item.relation === 'direct').length,
      adjacentCount: resolved.filter((item) => item.relation === 'adjacent').length,
      ages: edm.ages,
      sourceUrl: edm.sourceUrl
    };
    matchedCount += 1;
    lineupArtistCount += resolved.length;
    audit.push({ edmtrainEventId: edm.id, canonicalEventId: event.id, status: 'matched', rule, lineupCount: resolved.length });
  }
  return { events, audit, matchedCount, ambiguousCount, unmatchedCount: audit.filter((item) => item.status === 'unmatched').length, lineupArtistCount };
}

function matchRule(event, edm) {
  const venue = sameVenue(event.venue, edm.venue);
  const title = exactUsefulTitle(event.title, edm.name);
  const eventArtists = new Set(event.performers.map((performer) => normalizeArtistName(performer.name)).filter(Boolean));
  const overlap = edm.orderedArtists.some((artist) => eventArtists.has(normalizeArtistName(artist.displayName)));
  const primary = edm.orderedArtists[0] && eventArtists.has(normalizeArtistName(edm.orderedArtists[0].displayName));
  const coordinates = coordinateDistanceMeters(event.venue, edm.venue) <= 500;
  if (venue && overlap) return 'A';
  if (venue && title) return 'B';
  if (coordinates && primary) return 'C';
  if (edm.festival && title && (venue || coordinates)) return 'D';
  return null;
}

function resolveLineup(entries, snapshot) {
  const artists = snapshot.artists ?? [];
  return entries.map((entry) => {
    const key = normalizeArtistName(entry.displayName);
    const matches = artists.filter((artist) => [artist.name, ...(artist.aliases ?? [])].some((name) => normalizeArtistName(name) === key));
    const artist = matches.length === 1 ? matches[0] : null;
    const relation = !artist ? 'unknown' : ['source', 'top-items'].includes(artist.origin ?? 'source') ? 'direct' : 'adjacent';
    return { ...entry, relation };
  });
}

function displayShape(edm, event) {
  if (edm.festival) return 'festival';
  if (edm.orderedArtists.some((artist) => artist.b2bWithNext)) return 'b2b';
  if (edm.name && !edm.orderedArtists.length) return 'named-event';
  const venue = normalizeArtistName(event.venue?.name);
  if (/arena|hall|theatre|theater|dome/.test(venue)) return 'arena-hall';
  if (/club|lounge/.test(venue) || edm.ages) return 'club-show';
  return 'general-show';
}

function exactUsefulTitle(left, right) {
  const a = canonicalEventTitle(left);
  const b = canonicalEventTitle(right);
  return Boolean(a && b && a.length >= 5 && a === b);
}

function sameVenue(left = {}, right = {}) {
  const a = normalizeArtistName(left.name);
  const b = normalizeArtistName(right.name);
  return Boolean(a && b && (a === b || (a.length > 8 && b.length > 8 && (a.includes(b) || b.includes(a)))));
}

function coordinateDistanceMeters(left = {}, right = {}) {
  if (![left.lat, left.lon, right.lat, right.lon].every(Number.isFinite)) return Infinity;
  const radians = Math.PI / 180;
  const dLat = (right.lat - left.lat) * radians;
  const dLon = (right.lon - left.lon) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(left.lat * radians) * Math.cos(right.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function requestJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`EDMTrain request failed (${response.status})`);
  return response.json();
}

function unwrap(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  return [];
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function localDate(value) { return String(value ?? '').slice(0, 10); }
