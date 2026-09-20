import { normalizeArtistName } from './ranking.js';
import { createEvidenceFact, createEventEvidence, meaningfulClassifications } from './eventEvidence.js';

const API_URL = 'https://thisisframework.com/wp-json/tribe/events/v1/events';
const ARTISTS_URL = 'https://thisisframework.com/artists/';

export async function fetchFrameworkEvents({ startDate, endDate, maxPages = 10, fetchImpl = fetch }) {
  const events = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(API_URL);
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('per_page', '50');
    url.searchParams.set('page', String(page));
    const response = await fetchImpl(url, { headers: { 'user-agent': 'Taste Engine private personal event importer/0.1' } });
    if (!response.ok) throw new Error(`Framework event feed failed (${response.status}).`);
    const body = await response.json();
    const pageEvents = Array.isArray(body.events) ? body.events : [];
    events.push(...pageEvents);
    if (!pageEvents.length || page >= Number(body.total_pages ?? 1)) break;
  }
  return events;
}

/**
 * Framework's artist roster is a public HTML page rather than a structured
 * WordPress endpoint. Keep this adapter deliberately small: retain only the
 * canonical artist link and display name needed to expand deterministic
 * SeatGeek/Ticketmaster lookups.
 */
export async function fetchFrameworkArtists({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(ARTISTS_URL, {
    headers: { 'user-agent': 'Taste Engine private personal event importer/0.1' }
  });
  if (!response.ok) throw new Error(`Framework artist roster failed (${response.status}).`);
  return parseFrameworkArtists(await response.text());
}

export function parseFrameworkArtists(html) {
  const artists = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html ?? '').matchAll(anchorPattern)) {
    const attributes = match[1] ?? '';
    if (!/\bclass\s*=\s*["'][^"']*\bartist-block\b[^"']*["']/i.test(attributes)) continue;
    const hrefMatch = attributes.match(/\bhref\s*=\s*["']?([^\s"'>]+)/i);
    const sourceUrl = canonicalArtistUrl(hrefMatch?.[1]);
    if (!sourceUrl) continue;
    const nameMatch = match[2].match(/\bartist-block-name\b[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i);
    const name = decodeText(nameMatch?.[1] ?? '');
    const key = normalizeArtistName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    artists.push({
      id: `framework-artist:${sourceUrl.split('/').filter(Boolean).at(-1)}`,
      source: 'framework',
      name,
      sourceUrl,
      slug: sourceUrl.split('/').filter(Boolean).at(-1) ?? null
    });
  }
  return artists;
}

export function normalizeFrameworkEvent(event, retrievedAt = new Date()) {
  const title = decodeText(event.title);
  const venue = event.venue ?? {};
  const retrieved = new Date(retrievedAt).toISOString();
  const sourceEventId = String(event.id);
  const sourceUrl = String(event.url ?? event.website ?? '');
  // The Events Calendar marks a listing with no published clock time as
  // all-day and fills the row with a 00:00:00 to 23:59:59 span. That span is a
  // placeholder, not a schedule: treating it as one would assert a start and an
  // end the promoter never published.
  const allDay = isAllDay(event);
  const startLocal = normalizeLocalDate(event.start_date ?? event.startDate ?? event.start);
  const rawEndLocal = normalizeLocalDate(event.end_date ?? event.endDate ?? event.end);
  const endLocal = allDay || isEndOfDaySentinel(rawEndLocal, startLocal) ? null : rawEndLocal;
  const doorsLocal = allDay ? null : normalizeLocalDate(event.doors_date ?? event.doorsDate ?? event.doors);
  const publishedStartLocal = allDay ? null : startLocal;
  const description = decodeText(event.description ?? event.excerpt ?? event.summary ?? event.content);
  const classifications = frameworkClassifications(event);
  const performers = frameworkPerformersFromEvent(event, title);
  const hasExplicitLineup = hasExplicitFrameworkPerformers(event);
  const venueInfo = {
    name: decodeText(venue.venue),
    city: decodeText(venue.city),
    state: decodeText(venue.stateprovince ?? ''),
    address: decodeText(venue.address ?? venue.address_line_1 ?? venue.street)
  };
  const eventEvidence = createEventEvidence({
    eventRef: `framework:${sourceEventId}`,
    provider: 'framework',
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    facts: {
      title: frameworkFact(title, 'title', { sourceEventId, sourceUrl, retrieved }),
      description: frameworkFact(description, 'description', {
        sourceEventId,
        sourceUrl,
        retrieved,
        assertionKind: 'descriptive-copy',
        permission: { internalUse: true, display: true, modelInput: false, persist: true }
      }),
      classification: frameworkFact(classifications, 'classification', { sourceEventId, sourceUrl, retrieved }),
      namedLineup: hasExplicitLineup
        ? frameworkFact(performers.map((performer) => performer.name), 'namedLineup', { sourceEventId, sourceUrl, retrieved })
        : null,
      format: frameworkFact(event.format ?? event.event_type ?? null, 'format', { sourceEventId, sourceUrl, retrieved }),
      doorTime: frameworkFact(doorsLocal, 'doorTime', { sourceEventId, sourceUrl, retrieved }),
      startTime: frameworkFact(publishedStartLocal, 'startTime', { sourceEventId, sourceUrl, retrieved }),
      endTime: frameworkFact(endLocal, 'endTime', { sourceEventId, sourceUrl, retrieved }),
      venueInfo: frameworkFact(venueInfo, 'venueInfo', { sourceEventId, sourceUrl, retrieved }),
      agePolicy: frameworkFact(event.age_policy ?? event.ageRestriction ?? event.age_restrictions, 'agePolicy', { sourceEventId, sourceUrl, retrieved })
    }
  });
  const sourceOccurrence = {
    source: 'framework',
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    title,
    startLocal,
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: decodeText(venue.venue),
      city: decodeText(venue.city),
      state: decodeText(venue.stateprovince ?? ''),
      lat: numberOrNull(venue.geo_lat),
      lon: numberOrNull(venue.geo_lng)
    },
    performerNames: performers.map((performer) => performer.name),
    evidence: eventEvidence
  };
  return {
    schemaVersion: 1,
    id: `framework:${sourceEventId}`,
    source: 'framework',
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [sourceOccurrence],
    eventEvidence,
    retrievedAt: retrieved,
    title,
    type: 'concert',
    startLocal,
    startUtc: event.utc_start_date ? `${String(event.utc_start_date).replace(' ', 'T')}Z` : null,
    doorsLocal,
    endLocal,
    // An all-day listing has a date but no published clock time.
    timeTbd: allDay,
    dateTbd: false,
    status: event.status ?? 'scheduled',
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: decodeText(venue.venue),
      city: decodeText(venue.city),
      state: decodeText(venue.stateprovince ?? ''),
      lat: numberOrNull(venue.geo_lat),
      lon: numberOrNull(venue.geo_lng)
    },
    performers,
    ticketObservation: {
      listingCount: null,
      lowestPriceUsd: firstPrice(event.cost),
      averagePriceUsd: null,
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}

function frameworkFact(value, field, { sourceEventId, sourceUrl, retrieved, assertionKind = 'published-fact', permission } = {}) {
  return createEvidenceFact({
    value,
    field,
    provider: 'framework',
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    assertionKind,
    permission: permission ?? { internalUse: true, display: true, modelInput: true, persist: true }
  });
}

// A listing is all-day when the feed says so, or when its span exactly covers
// one calendar day, which is how the same placeholder reaches us from feeds
// that omit the flag.
function isAllDay(event) {
  const flag = event.all_day ?? event.allDay;
  if (flag === true || flag === 'true' || flag === 1 || flag === '1') return true;
  const start = String(event.start_date ?? event.startDate ?? event.start ?? '');
  const end = String(event.end_date ?? event.endDate ?? event.end ?? '');
  return /\b00:00(:00)?$/.test(start) && /\b23:59(:\d{2})?$/.test(end);
}

function isEndOfDaySentinel(endLocal, startLocal) {
  if (!endLocal) return true;
  if (/T23:59(:\d{2})?$/.test(endLocal)) return true;
  // A midnight end on the same calendar day as the start is the feed's
  // end-of-day default rather than a published finish.
  return /T00:00(:00)?$/.test(endLocal) && endLocal.slice(0, 10) === String(startLocal ?? '').slice(0, 10);
}

function frameworkClassifications(event) {
  const values = [];
  for (const source of [event.tags, event.categories, event.category, event.genre]) {
    const items = Array.isArray(source) ? source : source == null ? [] : [source];
    for (const item of items) {
      const value = typeof item === 'object' ? item.name ?? item.title ?? item.slug : item;
      const normalized = decodeText(value);
      if (normalized) values.push(normalized);
    }
  }
  return meaningfulClassifications(values, { provider: 'framework' });
}

function frameworkPerformersFromEvent(event, title) {
  const raw = event.performers ?? event.artists ?? event.artistNames ?? event.lineup;
  if (!raw) return frameworkPerformers(title);
  const values = Array.isArray(raw) ? raw : [raw];
  const performers = values.map((item, index) => {
    const name = decodeText(typeof item === 'object' ? item.name ?? item.title : item);
    return { sourceId: typeof item === 'object' && item.id ? String(item.id) : null, name, primary: index === 0, spotifyId: null };
  }).filter((performer) => performer.name);
  return performers.length ? performers : frameworkPerformers(title);
}

function hasExplicitFrameworkPerformers(event) {
  const raw = event.performers ?? event.artists ?? event.artistNames ?? event.lineup;
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.some((item) => decodeText(typeof item === 'object' ? item.name ?? item.title : item));
  return Boolean(decodeText(raw));
}

export function frameworkPerformers(title) {
  const cleaned = decodeText(title)
    .replace(/^framework\s+presents\s*/i, '')
    .replace(/\([^)]*(?:show added|open\s+to\s+close)[^)]*\)/gi, '')
    .trim();
  return cleaned.split(/\s+b2b\s+|\s+&\s+/i)
    .map((name, index) => ({ sourceId: null, name: name.trim(), primary: index === 0, spotifyId: null }))
    .filter((performer) => performer.name);
}

function normalizeLocalDate(value) {
  const text = String(value ?? '').trim();
  return text ? text.replace(' ', 'T') : null;
}

function firstPrice(value) {
  const match = String(value ?? '').match(/\$?([0-9]+(?:\.[0-9]{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function decodeText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);|&#([0-9]+);|&([a-z]+);/gi, (_, hex, decimal, named) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      return ({
        amp: '&', apos: "'", nbsp: ' ', quot: '"',
        aacute: 'á', acirc: 'â', auml: 'ä', eacute: 'é', ecirc: 'ê', euml: 'ë',
        iacute: 'í', icirc: 'î', iuml: 'ï', oacute: 'ó', ocirc: 'ô', ouml: 'ö',
        uacute: 'ú', ucirc: 'û', uuml: 'ü', ntilde: 'ñ', rsquo: '’', ldquo: '“', rdquo: '”'
      }[String(named).toLowerCase()] ?? `&${named};`);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalArtistUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text, ARTISTS_URL);
    if (url.origin !== 'https://thisisframework.com') return null;
    const match = url.pathname.match(/^\/artist\/([^/]+)\/?$/i);
    return match ? `https://thisisframework.com/artist/${match[1]}/` : null;
  } catch {
    return null;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
