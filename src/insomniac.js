const EVENTS_URL = 'https://www.insomniac.com/events/los-angeles-ca/';

/**
 * Fetch the public Insomniac Los Angeles event calendar. The page is a
 * followed-promoter source, not a ticket inventory source. It is intentionally
 * low-frequency and fails closed when the site returns a bot challenge or an
 * HTML shape we cannot parse safely.
 */
export async function fetchInsomniacEvents({
  startDate,
  endDate,
  pageUrl = EVENTS_URL,
  fetchImpl = fetch
} = {}) {
  const response = await fetchImpl(pageUrl, {
    headers: { 'user-agent': 'Taste Engine private personal event importer/0.1' }
  });
  if (!response.ok) throw new Error(`Insomniac event page failed (${response.status}).`);
  const html = await response.text();
  if (isChallengePage(html)) throw new Error('Insomniac event page returned an access challenge.');
  const events = parseInsomniacEvents(html, { pageUrl });
  if (!events.length && /events found|upcoming events|load more/i.test(html)) {
    throw new Error('Insomniac event page shape was not recognized.');
  }
  return events.filter((event) => inDateWindow(event.startDate ?? event.startLocal, startDate, endDate));
}

/** Parse structured event data emitted by the public page or a saved fixture. */
export function parseInsomniacEvents(html, { pageUrl = EVENTS_URL } = {}) {
  const events = [];
  const seen = new Set();
  const add = (event) => {
    const normalized = coerceEvent(event, pageUrl);
    if (!normalized) return;
    const key = normalized.id ?? normalized.url ?? `${normalized.name}|${normalized.startDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(normalized);
  };

  // Prefer JSON-LD when present: it is the least brittle public representation.
  const jsonLdPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(jsonLdPattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      for (const item of flattenJsonLd(parsed)) {
        if (isEventLike(item)) add(item);
      }
    } catch {
      // A malformed optional block should not make the whole source fail.
    }
  }

  // Some Insomniac page builds expose the same object on a data-event JSON
  // attribute. Support both quoted JSON and simple data-* fields for fixtures.
  const jsonAttributePattern = /data-(?:event|event-json|event-data)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(jsonAttributePattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      if (isEventLike(parsed)) add(parsed);
    } catch {
      // Continue to the simple attribute parser below.
    }
  }
  const cardPattern = /<(?:article|li|div)[^>]+(?:data-event-id|data-event-url|data-start-date)=[^>]*>[\s\S]*?<\/(?:article|li|div)>/gi;
  for (const match of html.matchAll(cardPattern)) add(parseCardAttributes(match[0], pageUrl));

  return events;
}

export function normalizeInsomniacEvent(event, retrievedAt = new Date()) {
  const title = cleanText(event.title ?? event.name ?? event.eventName ?? '');
  const startLocal = normalizeStartLocal(event.startLocal ?? event.startDate ?? event.start_date ?? event.date);
  const sourceUrl = String(event.sourceUrl ?? event.url ?? event.link ?? EVENTS_URL).trim();
  const sourceEventId = String(event.sourceEventId ?? event.id ?? stableId(`${title}|${startLocal}|${sourceUrl}`));
  const performers = normalizePerformers(event.performers ?? event.performer ?? event.artistNames ?? event.artists, title);
  const venue = event.venue ?? event.location ?? {};
  const status = cleanText(event.status ?? event.availability ?? 'scheduled').toLowerCase() || 'scheduled';
  const retrieved = new Date(retrievedAt).toISOString();
  return {
    schemaVersion: 1,
    id: `insomniac:${sourceEventId}`,
    source: 'insomniac',
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [{ source: 'insomniac', sourceEventId, sourceUrl }],
    retrievedAt: retrieved,
    title,
    type: isFestival(title, event.type) ? 'music_festival' : 'concert',
    startLocal,
    startUtc: event.startUtc ?? event.startDateTime ?? null,
    timeTbd: !hasTime(startLocal),
    dateTbd: !startLocal,
    status,
    venue: {
      sourceId: event.venueId ?? venue.id ? String(event.venueId ?? venue.id) : null,
      name: cleanText(venue.name ?? venue.venue ?? event.venueName ?? 'Los Angeles'),
      city: cleanText(venue.city ?? event.city ?? 'Los Angeles'),
      state: cleanText(venue.state ?? venue.stateCode ?? event.state ?? 'CA'),
      lat: numberOrNull(venue.lat ?? venue.latitude),
      lon: numberOrNull(venue.lon ?? venue.longitude)
    },
    performers,
    ticketObservation: {
      listingCount: null,
      lowestPriceUsd: null,
      averagePriceUsd: null,
      observedAt: retrieved
    }
  };
}

function coerceEvent(event, pageUrl) {
  if (!event || typeof event !== 'object') return null;
  if (!isEventLike(event)) return null;
  return {
    ...event,
    sourceUrl: event.sourceUrl ?? event.url ?? event.link ?? pageUrl,
    url: event.url ?? event.link ?? event.sourceUrl ?? pageUrl
  };
}

function parseCardAttributes(fragment, pageUrl) {
  const value = (name) => {
    const match = fragment.match(new RegExp(`data-${name}=["']([^"']*)["']`, 'i'));
    return match ? decodeHtml(match[1]) : '';
  };
  const title = value('title') || value('name');
  const startDate = value('start-date') || value('date');
  const url = value('event-url') || value('url') || pageUrl;
  const id = value('event-id') || value('id') || stableId(`${title}|${startDate}|${url}`);
  if (!title && !startDate) return null;
  return { id, name: title, startDate, url, venue: { name: value('venue') || 'Los Angeles', city: 'Los Angeles', state: 'CA' } };
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === 'object' && Array.isArray(value['@graph'])) return value['@graph'].flatMap(flattenJsonLd);
  return value ? [value] : [];
}

function isEventLike(value) {
  if (!value || typeof value !== 'object') return false;
  const type = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  return type.some((item) => /event/i.test(String(item))) || Boolean(value.startDate ?? value.start_date ?? value.startLocal) && Boolean(value.name ?? value.title);
}

function normalizePerformers(value, title) {
  const names = Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item : item?.name ?? item?.artistName).filter(Boolean)
    : typeof value === 'string' ? value.split(/\s*[,&]\s*/g) : [];
  const cleaned = names.map((name) => cleanPerformer(name)).filter(Boolean);
  if (cleaned.length) return uniquePerformers(cleaned);
  const fallback = cleanPerformer(title.replace(/\b(?:festival|presented by|sold out|buy tickets|sign up for waitlist)\b.*$/i, ''));
  return fallback ? [{ sourceId: null, name: fallback, primary: true, spotifyId: null }] : [];
}

function uniquePerformers(names) {
  const seen = new Set();
  return names.filter((name) => {
    const key = name.toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((name, index) => ({ sourceId: null, name, primary: index === 0, spotifyId: null }));
}

function cleanPerformer(value) {
  return cleanText(value).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeStartLocal(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.replace(/([+-]\d{2}:?\d{2}|Z)$/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00`;
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*[-+]\s*\d{1,2})?,?\s+(\d{4})\b/i);
  if (!match) return null;
  const parsed = new Date(`${match[1]} ${match[2]}, ${match[3]} 00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}T00:00:00`;
}

function inDateWindow(value, startDate, endDate) {
  if (!value) return false;
  const date = String(normalizeStartLocal(value) ?? value).slice(0, 10);
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function hasTime(value) {
  return Boolean(value && /T\d{2}:\d{2}/.test(value) && !value.endsWith('T00:00:00'));
}

function isFestival(title, type) {
  return /festival/i.test(String(type ?? '')) || /festival/i.test(title);
}

function isChallengePage(html) {
  return /Just a moment|challenge-platform|Enable JavaScript and cookies to continue/i.test(String(html ?? ''));
}

function cleanText(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;|&#47;/gi, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableId(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `generated-${(hash >>> 0).toString(16)}`;
}

