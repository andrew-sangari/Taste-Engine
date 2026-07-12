import { normalizeArtistName } from './ranking.js';

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
  return {
    schemaVersion: 1,
    id: `framework:${event.id}`,
    source: 'framework',
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? event.website ?? ''),
    sourceOccurrences: [{ source: 'framework', sourceEventId: String(event.id), sourceUrl: String(event.url ?? event.website ?? '') }],
    retrievedAt: new Date(retrievedAt).toISOString(),
    title,
    type: 'concert',
    startLocal: normalizeLocalDate(event.start_date),
    startUtc: event.utc_start_date ? `${String(event.utc_start_date).replace(' ', 'T')}Z` : null,
    timeTbd: false,
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
    performers: frameworkPerformers(title),
    ticketObservation: {
      listingCount: null,
      lowestPriceUsd: firstPrice(event.cost),
      averagePriceUsd: null,
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
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
