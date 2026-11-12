import { createEvidenceFact, createEventEvidence, meaningfulClassifications } from './eventEvidence.js';
import { parsePromoterTitle } from './eventTitle.js';

const SITE_ORIGIN = 'https://www.insomniac.com';
const EVENTS_URL = `${SITE_ORIGIN}/events/los-angeles-ca/`;
const USER_AGENT = 'Taste Engine private personal event importer/0.1';

// Verified 2026-11-11 against the live Los Angeles listing and a live event
// page; test/fixtures/insomniac/ holds the trimmed markup both were read from.
// What the site publishes, and therefore what this adapter reads:
//
//   - The location listing is server-rendered HTML cards: title, canonical
//     event link, date (no clock time), "City, ST" (no venue), category, age,
//     presenter line and a sold-out marker. It carries no JSON-LD.
//   - Each event page on insomniac.com carries one schema.org Event JSON-LD
//     block with the venue, address, clock times and the performer list.
//
// The listing renders only its first 24 events; the rest sit behind a
// script-driven "load more" call to an undocumented nonce-protected endpoint,
// which this adapter deliberately does not call. The standard WordPress REST
// API does not expose the event type, so there is no documented feed.
export const INSOMNIAC_ADAPTER_VERIFIED = true;

export const INSOMNIAC_DEFAULT_LOCATIONS = ['los-angeles-ca'];

// Insomniac's own brands. "Bassrush presents X" is the house presenting an act,
// never an act called Bassrush.
const HOUSE_PROMOTERS = ['Insomniac', 'Factory 93', 'Bassrush', 'Basscon', 'Dreamstate', 'Day Trip', 'Mutate', 'Fixture', 'HARD', 'Lost In Dreams'];

/**
 * A failure the source-health layer can classify without parsing prose.
 * `failure` is one of `blocked` (an access challenge was returned and was not
 * retried or worked around), `unavailable` (transport or HTTP failure) and
 * `parser-failed` (a page arrived but its markup was not the verified shape).
 */
export class InsomniacSourceError extends Error {
  constructor(message, failure) {
    super(message);
    this.name = 'InsomniacSourceError';
    this.failure = failure;
  }
}

/**
 * Fetch the public Insomniac location calendar and the event pages it links.
 * Low-frequency by design: one request per listing, then at most
 * `maxDetailPages` sequential event-page requests with a pause between them.
 * A listing failure fails the source; an event-page failure only downgrades
 * that one event to listing-level facts and is reported in
 * `diagnostics.warnings`. An access challenge is never retried or bypassed.
 */
export async function fetchInsomniacEvents({
  startDate,
  endDate,
  pageUrl = null,
  locationSlugs = INSOMNIAC_DEFAULT_LOCATIONS,
  maxDetailPages = 30,
  detailDelayMs = 250,
  diagnostics = null,
  fetchImpl = fetch
} = {}) {
  const report = diagnostics ?? {};
  Object.assign(report, { listingPages: 0, listingEvents: 0, foundPosts: 0, detailPagesFetched: 0, detailPagesFailed: 0, warnings: [] });
  const pageUrls = pageUrl ? [pageUrl] : locationSlugs.map((slug) => `${SITE_ORIGIN}/events/${String(slug).replace(/[^a-z0-9-]/gi, '')}/`);
  const events = [];
  const seen = new Set();

  for (const [index, url] of pageUrls.entries()) {
    let listing;
    try {
      listing = parseInsomniacListing(await requestPage(url, fetchImpl, 'listing'), { pageUrl: url });
      if (!listing.events.length) {
        throw new InsomniacSourceError(`Insomniac listing shape was not recognized at ${url}: 0 event cards and 0 JSON-LD events.`, 'parser-failed');
      }
    } catch (error) {
      // The first listing is the source. Extra locations degrade independently.
      if (index === 0) throw error;
      report.warnings.push(error.message);
      continue;
    }
    report.listingPages += 1;
    report.foundPosts += listing.foundPosts ?? 0;
    if (listing.foundPosts != null && listing.foundPosts > listing.listedCount) {
      report.warnings.push(`Insomniac listing ${url} renders ${listing.listedCount} of ${listing.foundPosts} events; the rest are behind a script-only "load more" endpoint this adapter does not call.`);
    }
    for (const warning of listing.warnings) report.warnings.push(warning);
    for (const event of listing.events) {
      const key = `${event.url}|${String(event.startDate).slice(0, 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  report.listingEvents = events.length;

  const inWindow = events
    .filter((event) => inDateWindow(event.startDate, startDate, endDate))
    .sort((left, right) => String(left.startDate).localeCompare(String(right.startDate)));

  let challenged = false;
  let skipped = 0;
  for (const [index, event] of inWindow.entries()) {
    if (!event.listingOnly || !isInsomniacEventUrl(event.url)) continue;
    if (challenged || report.detailPagesFetched + report.detailPagesFailed >= maxDetailPages) {
      skipped += 1;
      continue;
    }
    if (report.detailPagesFetched + report.detailPagesFailed > 0 && detailDelayMs > 0) await sleep(detailDelayMs);
    try {
      const detail = parseInsomniacEventPage(await requestPage(event.url, fetchImpl, 'event page'), { pageUrl: event.url });
      if (!detail) throw new InsomniacSourceError(`Insomniac event page ${event.url} carried no schema.org Event block.`, 'parser-failed');
      const merged = mergeListingWithDetail(event, detail);
      if (!merged) throw new InsomniacSourceError(`Insomniac event page ${event.url} did not match its listing card (title or date differs).`, 'parser-failed');
      if (detail.clockConflict) report.warnings.push(`Insomniac event page ${event.url} publishes two different start times; the visible local time was kept.`);
      inWindow[index] = merged;
      report.detailPagesFetched += 1;
    } catch (error) {
      report.detailPagesFailed += 1;
      report.warnings.push(error.message);
      // A challenge on one event page will be a challenge on the next: stop
      // asking instead of hammering a site that has said no.
      if (error.failure === 'blocked') challenged = true;
    }
  }
  if (skipped) report.warnings.push(`${skipped} Insomniac event pages were not fetched (${challenged ? 'access challenge' : `limit of ${maxDetailPages}`}); those events keep listing-level facts only.`);
  return inWindow;
}

/**
 * Parse whatever structured events a saved or fetched Insomniac page carries:
 * listing cards on a location page, the JSON-LD Event on an event page.
 */
export function parseInsomniacEvents(html, { pageUrl = EVENTS_URL } = {}) {
  const listing = parseInsomniacListing(html, { pageUrl });
  if (listing.cardCount) return listing.events;
  const detail = parseInsomniacEventPage(html, { pageUrl });
  if (detail) return [detail];
  return listing.events;
}

/**
 * Parse a location listing. Cards are located by the listing's own card
 * structure, not by broad pattern matching, so a markup change yields zero
 * cards (a `parser-failed` source) instead of half-read events.
 */
export function parseInsomniacListing(html, { pageUrl = EVENTS_URL } = {}) {
  const source = String(html ?? '');
  const events = [];
  const warnings = [];
  const byKey = new Map();
  const starts = [...source.matchAll(/<div class="card( card--feature)?">/g)];
  const boundary = firstIndexAfter(source, ['post-load-more-button-container', '</main>'], starts[0]?.index ?? 0);
  let listedCount = 0;

  starts.forEach((match, position) => {
    const end = Math.min(starts[position + 1]?.index ?? boundary, boundary);
    if (match.index >= end) return;
    const featured = Boolean(match[1]);
    const card = parseListingCard(source.slice(match.index, end), { pageUrl, featured });
    if (!card) {
      warnings.push(`An Insomniac listing card at ${pageUrl} had no readable title, link or date and was skipped.`);
      return;
    }
    if (!featured) listedCount += 1;
    const key = `${card.url}|${card.startDate}`;
    const existing = byKey.get(key);
    // The featured strip promotes events from every region. One is kept only
    // when the location's own list repeats it.
    if (existing) {
      if (!featured) existing.featured = false;
      return;
    }
    byKey.set(key, card);
  });
  for (const card of byKey.values()) if (!card.featured) events.push(card);

  // A page with no cards may still be an event page or an older fixture.
  if (!starts.length) {
    for (const item of jsonLdEvents(source)) {
      const event = coerceJsonLdEvent(item, pageUrl);
      if (event && !events.some((existing) => existing.url === event.url && existing.startDate === event.startDate)) events.push(event);
    }
  }
  const found = source.match(/\bdata-found-posts="(\d+)"/);
  return {
    events,
    cardCount: starts.length,
    listedCount,
    foundPosts: found ? Number(found[1]) : null,
    warnings
  };
}

/**
 * Parse one event page. The JSON-LD block is the authority for venue, address
 * and lineup. The visible "Time" block is the authority for the clock: the
 * JSON-LD stamps local wall-clock times with a +00:00 offset (17:00+00:00 for
 * a 5 PM Los Angeles start), so its offset is never trusted.
 */
export function parseInsomniacEventPage(html, { pageUrl = EVENTS_URL } = {}) {
  const source = String(html ?? '');
  const item = jsonLdEvents(source)[0];
  if (!item) return null;
  const event = coerceJsonLdEvent(item, attribute(source.match(/<link rel="canonical"[^>]*>/i)?.[0], 'href') || pageUrl);
  if (!event) return null;

  const time = source.match(/<h6>\s*Time\s*<\/h6>\s*<p>\s*<b>([^<]*)<\/b>\s*<\/p>(?:\s*<p>([^<]*)<\/p>)?/i);
  const visible = time ? visibleClock(parseDateText(time[1]).start, time[2]) : null;
  const published = wallClock(event.startDate);
  if (visible?.start) {
    event.clockConflict = Boolean(hasClock(published) && published.slice(0, 16) !== visible.start.slice(0, 16));
    event.startDate = visible.start;
    if (visible.end) event.endDate = visible.end;
    event.clockSource = 'page-time';
  } else {
    event.clockConflict = false;
    event.clockSource = hasClock(published) ? 'json-ld' : null;
  }

  const genreBlock = source.match(/<div class="genre">([\s\S]*?)<\/div>/i)?.[1] ?? '';
  event.genres = [...genreBlock.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((match) => text(match[1])).filter(Boolean);
  event.ageRestriction = text(source.match(/<h6>\s*Age\s*<\/h6>\s*<p>\s*<b>([^<]*)<\/b>/i)?.[1]) || null;
  event.subtitle = text(source.match(/<div class="page-header__meta">\s*<span>([\s\S]*?)<\/span>/i)?.[1]) || null;
  const breadcrumb = source.match(/<div class="breadcrumb">([\s\S]*?)<\/div>/i)?.[1] ?? '';
  event.category = [...breadcrumb.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => text(match[1])).filter((value) => value && !/^events$/i.test(value)).at(-1) ?? null;
  event.detailFetched = true;
  return event;
}

export function normalizeInsomniacEvent(event, retrievedAt = new Date(), { knownArtistNames = [] } = {}) {
  const title = text(event.title ?? event.name ?? '');
  const sourceUrl = String(event.sourceUrl ?? event.url ?? event.link ?? EVENTS_URL).trim();
  const startLocal = wallClock(event.startLocal ?? event.startDate ?? event.start_date ?? event.date);
  // A published end keeps its clock even at midnight; a bare end date (the
  // last day of a festival) is not an end time.
  const publishedEnd = publishedClock(event.endLocal ?? event.endDate ?? event.end_date);
  const endLocal = publishedEnd && (!startLocal || publishedEnd > startLocal) ? publishedEnd : null;
  const doorsLocal = publishedClock(event.doorsLocal ?? event.doorTime);
  const sourceEventId = String(event.sourceEventId ?? event.id ?? slugFromUrl(sourceUrl) ?? stableId(`${title}|${startLocal}|${sourceUrl}`));
  const retrieved = new Date(retrievedAt).toISOString();
  const place = event.location ?? event.venue ?? {};
  const address = place.address && typeof place.address === 'object' ? place.address : {};
  const venue = {
    sourceId: null,
    name: text(place.name ?? event.venueName),
    city: tidyPlace(address.addressLocality ?? place.city ?? event.city),
    state: tidyPlace(address.addressRegion ?? place.state ?? event.state),
    lat: numberOrNull(place.geo?.latitude ?? place.lat),
    lon: numberOrNull(place.geo?.longitude ?? place.lon)
  };
  const category = text(event.category ?? '');
  const festival = /^festivals?$/i.test(category) || /\bfestival\b/i.test(title);
  const billing = insomniacBilling(event, title, { knownArtistNames, festival });
  const performers = billing.performers;
  const classifications = meaningfulClassifications((Array.isArray(event.genres) ? event.genres : []).map(text), { provider: 'insomniac' });
  const publishedStart = hasClock(startLocal) ? startLocal : null;
  const fact = (value, field, extra = {}) => insomniacFact(value, field, sourceEventId, sourceUrl, retrieved, extra);
  const eventEvidence = createEventEvidence({
    eventRef: `insomniac:${sourceEventId}`,
    provider: 'insomniac',
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    facts: {
      title: fact(title, 'title'),
      description: fact(text(event.description ?? ''), 'description', { assertionKind: 'descriptive-copy' }),
      classification: fact(classifications, 'classification'),
      // Only a lineup the promoter published counts as a named lineup; names
      // read out of a marketing title do not.
      namedLineup: billing.explicit ? fact(performers.map((performer) => performer.name), 'namedLineup') : null,
      format: fact(category || null, 'format'),
      doorTime: fact(doorsLocal, 'doorTime'),
      startTime: fact(publishedStart, 'startTime'),
      endTime: fact(endLocal, 'endTime'),
      venueInfo: fact({ name: venue.name, city: venue.city, state: venue.state, address: text(address.streetAddress ?? '').replace(/[\s,]+$/, '') }, 'venueInfo'),
      agePolicy: fact(event.ageRestriction ?? event.agePolicy ?? null, 'agePolicy')
    }
  });
  const sourceOccurrence = {
    source: 'insomniac',
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    title,
    startLocal,
    venue: { ...venue },
    performerNames: performers.map((performer) => performer.name),
    evidence: eventEvidence
  };
  return {
    schemaVersion: 1,
    id: `insomniac:${sourceEventId}`,
    source: 'insomniac',
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [sourceOccurrence],
    eventEvidence,
    retrievedAt: retrieved,
    title,
    type: festival ? 'music_festival' : 'concert',
    startLocal,
    // The site labels local wall-clock times as UTC, so no UTC instant is
    // asserted from it.
    startUtc: null,
    doorsLocal,
    endLocal,
    timeTbd: !hasClock(startLocal),
    dateTbd: !startLocal,
    status: event.soldOut ? 'sold out' : 'scheduled',
    promoters: [...new Set(['Insomniac', ...billing.presenters.filter((name) => !/^insomniac$/i.test(name))])],
    eventName: billing.eventName,
    venue,
    performers,
    ticketObservation: {
      listingCount: null,
      lowestPriceUsd: null,
      averagePriceUsd: null,
      observedAt: retrieved
    }
  };
}

/** True only for an actual access challenge, never for an ordinary page. */
export function isInsomniacChallenge({ status = 200, headers = null, html = '' } = {}) {
  if (/challenge/i.test(String(headers?.get?.('cf-mitigated') ?? ''))) return true;
  const body = String(html ?? '');
  // Cloudflare adds its passive `/cdn-cgi/challenge-platform/scripts/jsd/`
  // beacon to every ordinary page it serves, so that path alone proves nothing.
  // An interstitial is recognised by its own title and challenge bootstrap.
  if (/<title>\s*(?:Just a moment|Attention Required)/i.test(body)) return true;
  if (/window\._cf_chl_opt|\/cdn-cgi\/challenge-platform\/h\/[a-z]\/orchestrate\//i.test(body)) return true;
  return [403, 429, 503].includes(status) && /cf-chl|challenges\.cloudflare\.com|captcha/i.test(body);
}

async function requestPage(url, fetchImpl, label) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
  } catch (error) {
    throw new InsomniacSourceError(`Insomniac ${label} request failed for ${url}: ${error.message}`, 'unavailable');
  }
  const html = await response.text().catch(() => '');
  if (isInsomniacChallenge({ status: response.status, headers: response.headers, html })) {
    throw new InsomniacSourceError(`Insomniac ${label} ${url} returned an access challenge (HTTP ${response.status}); it was not retried or bypassed.`, 'blocked');
  }
  if (!response.ok) throw new InsomniacSourceError(`Insomniac ${label} ${url} failed (HTTP ${response.status}).`, 'unavailable');
  return html;
}

function parseListingCard(block, { pageUrl, featured }) {
  const name = text(block.match(/<h3 class="card__title">([\s\S]*?)<\/h3>/)?.[1]);
  const anchors = [...block.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
  const link = anchors.find((anchor) => /detail page via title/i.test(attribute(anchor, 'aria-label')))
    ?? anchors.find((anchor) => /detail page/i.test(attribute(anchor, 'aria-label')));
  const url = absoluteUrl(attribute(link, 'href'), pageUrl);
  const details = [...block.matchAll(/<div class="card__detail">([\s\S]*?)<\/div>/g)].map((match) => text(match[1]));
  const dates = parseDateText(details[0]);
  if (!name || !url || !dates.start) return null;
  const [city, state] = String(details[1] ?? '').split(/,\s*/);
  const categoryBlock = block.match(/<div class="card__category[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const endEpoch = Number(block.match(/\bevent_end_time="(\d+)"/)?.[1]);
  const alert = text(block.match(/<div class="card__alert[^"]*">([\s\S]*?)<\/div>/)?.[1]);
  return {
    '@type': 'Event',
    id: isInsomniacEventUrl(url) ? slugFromUrl(url) : stableId(`${name}|${dates.start}|${url}`),
    name,
    url,
    startDate: dates.start,
    // The card's `event_end_time` is the published end as epoch seconds of the
    // local wall clock (the same convention as the event page's JSON-LD).
    endDate: Number.isFinite(endEpoch) && endEpoch > 0 ? new Date(endEpoch * 1000).toISOString().slice(0, 19) : dates.end,
    location: { name: '', address: { addressLocality: tidyPlace(city), addressRegion: tidyPlace(state) } },
    performer: [],
    genres: [],
    category: text(categoryBlock.replace(/<span[\s\S]*?<\/span>/g, ' ')) || null,
    ageRestriction: text(categoryBlock.match(/<span[^>]*>([\s\S]*?)<\/span>/)?.[1]) || null,
    subtitle: text(block.match(/<div class="card__subtitle">([\s\S]*?)<\/div>/)?.[1]) || null,
    soldOut: /^sold out$/i.test(alert),
    featured,
    listingOnly: true,
    listingUrl: pageUrl
  };
}

// The event page must describe the same event as the card that linked to it.
function mergeListingWithDetail(card, detail) {
  if (comparable(card.name) !== comparable(detail.name)) return null;
  if (String(wallClock(detail.startDate) ?? '').slice(0, 10) !== String(card.startDate).slice(0, 10)) return null;
  return {
    ...card,
    ...detail,
    id: card.id,
    url: card.url,
    endDate: detail.endDate ?? card.endDate,
    category: detail.category ?? card.category,
    ageRestriction: detail.ageRestriction ?? card.ageRestriction,
    subtitle: detail.subtitle ?? card.subtitle,
    soldOut: card.soldOut,
    featured: card.featured,
    listingUrl: card.listingUrl,
    listingOnly: false
  };
}

function coerceJsonLdEvent(item, pageUrl) {
  const name = text(item.name ?? item.title ?? '');
  const startDate = wallClock(item.startDate ?? item.start_date);
  if (!name || !startDate) return null;
  const place = Array.isArray(item.location) ? item.location[0] ?? {} : item.location ?? {};
  const address = place.address && typeof place.address === 'object' ? place.address : {};
  const url = absoluteUrl(item.url ?? item.offers?.url ?? pageUrl, pageUrl);
  const performers = (Array.isArray(item.performer) ? item.performer : item.performer ? [item.performer] : [])
    .map((performer) => typeof performer === 'string' ? { name: text(performer) } : { name: text(performer?.name), ...(performer?.sameAs ? { sameAs: String(performer.sameAs) } : {}) })
    .filter((performer) => performer.name);
  return {
    '@type': 'Event',
    id: isInsomniacEventUrl(url) ? slugFromUrl(url) : stableId(`${name}|${startDate}|${url}`),
    name,
    url,
    startDate,
    endDate: wallClock(item.endDate ?? item.end_date),
    location: {
      name: text(place.name ?? ''),
      address: {
        streetAddress: text(address.streetAddress ?? '').replace(/[\s,]+$/, ''),
        addressLocality: tidyPlace(address.addressLocality),
        addressRegion: tidyPlace(address.addressRegion),
        postalCode: text(address.postalCode ?? '')
      },
      ...(place.geo ? { geo: place.geo } : {})
    },
    performer: performers,
    description: text(item.description ?? ''),
    genres: [],
    listingOnly: false
  };
}

function jsonLdEvents(html) {
  const events = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const item of flattenJsonLd(JSON.parse(match[1].trim()))) {
        const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
        if (types.some((type) => /event$/i.test(String(type ?? '')))) events.push(item);
      }
    } catch {
      // A malformed optional block must not fail the whole page.
    }
  }
  return events;
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === 'object' && Array.isArray(value['@graph'])) return value['@graph'].flatMap(flattenJsonLd);
  return value && typeof value === 'object' ? [value] : [];
}

function insomniacBilling(event, title, { knownArtistNames, festival }) {
  const raw = event.performers ?? event.performer ?? event.artists ?? event.lineup;
  const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  const explicit = values
    .map((item) => text(typeof item === 'object' ? item?.name : item))
    .filter((name) => name && !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()))
    .map((name, index) => ({ sourceId: null, name, primary: index === 0, spotifyId: null }));
  const known = [...(knownArtistNames instanceof Set ? knownArtistNames : knownArtistNames ?? []), ...explicit.map((performer) => performer.name)];
  const parsed = parsePromoterTitle(title, { knownArtistNames: known, housePromoters: HOUSE_PROMOTERS });
  const presenters = [...parsed.presenters];
  let eventName = parsed.eventName;
  // The presenter line under the title: "presented by Factory 93",
  // "presents Botas y Rave", "Far From Home Tour · presented by Bassrush".
  for (const part of String(event.subtitle ?? '').split(/\s+[·|]\s+/).map((value) => value.trim()).filter(Boolean)) {
    const presentedBy = part.match(/^presented by\s+(.+)$/i);
    const presents = part.match(/^presents:?\s+(.+)$/i);
    if (presentedBy) presenters.push(presentedBy[1].trim());
    else if (!eventName) eventName = presents ? presents[1].trim() : part;
  }
  let performers = explicit;
  if (!performers.length) {
    // A festival with no published lineup has no performers. Its name is not
    // an act, and a lineup is never guessed.
    performers = festival ? [] : parsed.performers.map((performer) => ({ sourceId: null, name: performer.name, primary: performer.primary, spotifyId: null }));
    if (festival && !eventName) eventName = title;
  }
  return { performers, explicit: explicit.length > 0, presenters: [...new Set(presenters)], eventName: eventName || null };
}

function insomniacFact(value, field, sourceEventId, sourceUrl, retrieved, extra = {}) {
  return createEvidenceFact({
    value,
    field,
    provider: 'insomniac',
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    // Display and internal use only. Model eligibility is a separate decision.
    permission: { internalUse: true, display: true, modelInput: false, persist: true },
    ...extra
  });
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// "Saturday, November 14, 2026", "November 27 + 28, 2026" and
// "December 31, 2026 + January 1, 2027".
function parseDateText(value) {
  const source = text(value);
  const years = [...source.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  const parts = [...source.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*(?:\+|&|-|–)\s*(\d{1,2})(?!\d))?(?:,?\s*(20\d{2}))?/gi)];
  if (!parts.length || !years.length) return { start: null, end: null };
  const iso = (part, day) => {
    const month = MONTHS.indexOf(part[1].toLowerCase()) + 1;
    const year = Number(part[4] ?? years.at(-1));
    if (!month || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  let start = iso(parts[0], Number(parts[0][2]));
  const last = parts.at(-1);
  const end = parts.length > 1 ? iso(last, Number(last[3] ?? last[2])) : parts[0][3] ? iso(parts[0], Number(parts[0][3])) : null;
  // "December 31 + January 1, 2027": the first day belongs to the year before.
  if (start && end && start > end) start = `${Number(start.slice(0, 4)) - 1}${start.slice(4)}`;
  return { start, end };
}

// "05:00 PM - 11:00 PM" on a known local date.
function visibleClock(date, value) {
  if (!date) return null;
  const times = [...text(value).matchAll(/\b(\d{1,2}):(\d{2})\s*([AP])\.?M\b/gi)].map((match) => {
    const hour = (Number(match[1]) % 12) + (match[3].toUpperCase() === 'P' ? 12 : 0);
    return `${String(hour).padStart(2, '0')}:${match[2]}:00`;
  });
  if (!times.length) return null;
  const start = `${date}T${times[0]}`;
  if (times.length < 2) return { start, end: null };
  // An end at or before the start runs past midnight.
  const endDate = times[1] > times[0] ? date : addDays(date, 1);
  return { start, end: `${endDate}T${times[1]}` };
}

// Local wall-clock form of a published date. Any offset is dropped, never applied.
function wallClock(value) {
  const source = text(value);
  if (!source) return null;
  const stamp = source.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (stamp) return `${stamp[1]}T${stamp[2]}:${stamp[3] ?? '00'}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return `${source}T00:00:00`;
  const parsed = parseDateText(source).start;
  return parsed ? `${parsed}T00:00:00` : null;
}

// A value that was published with a time of day, as opposed to a bare date.
function publishedClock(value) {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text(value)) ? wallClock(value) : null;
}

function hasClock(value) {
  return Boolean(value && /T\d{2}:\d{2}/.test(value) && !/T00:00(:00)?$/.test(value));
}

function inDateWindow(value, startDate, endDate) {
  const date = String(wallClock(value) ?? '').slice(0, 10);
  if (!date) return false;
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isInsomniacEventUrl(value) {
  try {
    const url = new URL(String(value));
    return url.origin === SITE_ORIGIN && /^\/events\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function slugFromUrl(value) {
  try {
    return new URL(String(value)).pathname.split('/').filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}

function absoluteUrl(value, base) {
  const source = decodeEntities(String(value ?? '').trim());
  if (!source) return null;
  try {
    const url = new URL(source, base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function attribute(tag, name) {
  const match = String(tag ?? '').match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? '') : '';
}

function firstIndexAfter(source, markers, from) {
  const found = markers.map((marker) => source.indexOf(marker, from)).filter((index) => index >= 0);
  return found.length ? Math.min(...found) : source.length;
}

function comparable(value) {
  return text(value).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tidyPlace(value) {
  return text(value).replace(/[\s,]+$/, '');
}

function text(value) {
  return decodeEntities(String(value ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value ?? '').replace(/&#x([0-9a-f]+);|&#([0-9]+);|&([a-z]+);/gi, (entity, hex, decimal, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return ({ amp: '&', apos: "'", quot: '"', nbsp: ' ', lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·' })[named.toLowerCase()] ?? entity;
  });
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stableId(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `generated-${(hash >>> 0).toString(16)}`;
}
