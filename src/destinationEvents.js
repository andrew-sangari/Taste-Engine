import { fetchEdmtrainEvents } from './edmtrain.js';
import { normalizeArtistName } from './ranking.js';
import { fetchSeatGeekEventsByQuery, normalizeSeatGeekEvent } from './seatgeek.js';
import { fetchTicketmasterEventsByKeyword, normalizeTicketmasterEvent } from './ticketmaster.js';

// Destination events are a short owner-chosen list of named events worth a
// trip. They sit outside the home search radius, so the regional sweeps never
// see them. This module asks the two structured ticketing APIs for each name,
// regardless of the home radius, and returns ordinary concert candidates marked
// `destination` so ranking can present them as a trip instead of scoring the
// distance as everyday hassle.
//
// Source roles (docs/source-strategy.md):
//   - Ticketmaster Discovery keyword search and SeatGeek `q` search create
//     candidates. SeatGeek results stay on the deterministic path.
//   - EDMTrain adds a lineup to a candidate one of the ticketing APIs already
//     produced, on the same date and place. It creates a candidate in exactly
//     one case, authorized by the owner on 2026-11-11: a festival-flagged
//     EDMTrain record whose name is exactly a watchlist name, in the watch
//     area, for an edition no ticketing API lists yet. That candidate is marked
//     `destination.announcedBy: 'edmtrain'`, links to EDMTrain, carries no
//     ticket facts, and is replaced by the ticketing listing once one exists.
//     EDMTrain is still not a discovery source for anything off the watchlist.
//   - The festival's own site is not read: it publishes no structured data.
//
// Matching is exact on the watchlist names and never fuzzy.

export const DEFAULT_DESTINATION_WATCHLIST = Object.freeze([
  Object.freeze({ name: 'CRSSD', aliases: Object.freeze(['CRSSD Festival', 'CRSSD Fest']), city: 'San Diego', maxDistanceMiles: 160 }),
  Object.freeze({ name: 'Proper NYE', aliases: Object.freeze(['PROPER NYE/NYD']), city: 'San Diego', maxDistanceMiles: 160 })
]);

const SOURCE_PRIORITY = { seatgeek: 3, ticketmaster: 2 };
const MAX_EDITION_DAYS = 7;

/** Validate the `destinationEvents` config key. Omitted means the default list; `[]` turns the source off. */
export function resolveDestinationWatchlist(input) {
  if (input == null) return DEFAULT_DESTINATION_WATCHLIST.map((entry) => resolveEntry(entry, 0));
  if (!Array.isArray(input)) throw new Error('destinationEvents must be an array of { name, aliases, city, maxDistanceMiles }');
  return input.map(resolveEntry);
}

function resolveEntry(entry, index) {
  const name = String(entry?.name ?? '').trim();
  // A one- or two-character name cannot be matched safely.
  if (normalizeArtistName(name).length < 3) throw new Error(`destinationEvents[${index}].name must be at least three characters`);
  const maxDistanceMiles = Number(entry.maxDistanceMiles ?? 160);
  if (!Number.isFinite(maxDistanceMiles) || maxDistanceMiles <= 0) throw new Error(`destinationEvents[${index}].maxDistanceMiles must be greater than zero`);
  const aliases = [...new Set((Array.isArray(entry.aliases) ? entry.aliases : []).map((alias) => String(alias).trim()).filter((alias) => normalizeArtistName(alias).length >= 3))];
  return {
    name,
    aliases,
    city: entry.city ? String(entry.city).trim() : null,
    state: String(entry.state ?? 'California').trim(),
    maxDistanceMiles,
    type: String(entry.type ?? 'music_festival')
  };
}

/**
 * Decide which watchlist entry, if any, an event belongs to.
 *
 * Exact only. An event matches when one of its billed attractions is exactly a
 * watchlist name, or when the event's own name begins with a watchlist name on
 * a word boundary ("CRSSD Festival Spring 2027 - Saturday"). When a title reads
 * "X presents Y" only Y is the event's own name, so "FNGRS CRSSD presents
 * <a club night>" is not CRSSD. The most specific name wins.
 */
export function matchDestinationWatch({ title, performerNames = [] } = {}, watchlist = DEFAULT_DESTINATION_WATCHLIST) {
  const normalizedTitle = normalizeArtistName(title);
  const presented = normalizedTitle.match(/^.*?\bpresents?\b\s*(.+)$/);
  const ownName = presented ? presented[1] : normalizedTitle;
  const attractions = new Set(performerNames.map(normalizeArtistName).filter(Boolean));
  let best = null;
  for (const watch of watchlist) {
    for (const name of watchNames(watch)) {
      const matchedOn = attractions.has(name) ? 'attraction' : ownName === name || ownName.startsWith(`${name} `) ? 'title' : null;
      if (!matchedOn) continue;
      const score = (matchedOn === 'attraction' ? 1000 : 0) + name.length;
      if (!best || score > best.score) best = { watch, matchedOn, matchedName: name, score };
    }
  }
  return best ? { watch: best.watch, matchedOn: best.matchedOn, matchedName: best.matchedName } : null;
}

/**
 * Query the ticketing APIs for every watchlist name and return destination
 * candidates. One candidate is returned per edition (a run of consecutive
 * days), keeping every provider listing as a source occurrence with its own
 * link and retrieval time.
 *
 * Returns `{ events, pending, audit, warnings, sources }`. `pending` holds
 * exact matches that cannot be published yet (no usable date). `audit` is the
 * private EDMTrain trail. A provider failure is a warning; the call only
 * throws when every configured ticketing query failed. A watchlist edition
 * that only EDMTrain announces is returned as an announced candidate.
 */
export async function fetchDestinationEvents({
  watchlist,
  config = {},
  startDate = null,
  endDate = null,
  ticketmasterApiKey = null,
  seatGeekClientId = null,
  edmtrainClientKey = null,
  artistSnapshot = null,
  retrievedAt = new Date(),
  fetchImpl = fetch
} = {}) {
  // An explicit watchlist wins; otherwise the `destinationEvents` config key, then the default list.
  const watches = resolveDestinationWatchlist(watchlist ?? config.destinationEvents);
  const home = config.home ?? null;
  const warnings = [];
  const sources = {
    ticketmaster: { configured: Boolean(ticketmasterApiKey), queries: 0, failures: 0, matched: 0 },
    seatgeek: { configured: Boolean(seatGeekClientId), queries: 0, failures: 0, matched: 0 },
    edmtrain: { configured: Boolean(edmtrainClientKey), queries: 0, failures: 0, matched: 0, announced: 0 }
  };
  const raw = new Map();
  let firstError = null;

  for (const watch of watches) {
    for (const term of queryTerms(watch)) {
      const radius = { home, radiusMiles: watch.maxDistanceMiles, rangeMiles: watch.maxDistanceMiles };
      const providers = [
        ticketmasterApiKey && ['ticketmaster', () => fetchTicketmasterEventsByKeyword({ apiKey: ticketmasterApiKey, keyword: term, startDate, endDate, ...radius, fetchImpl })],
        seatGeekClientId && ['seatgeek', () => fetchSeatGeekEventsByQuery({ clientId: seatGeekClientId, query: term, startDate, endDate, ...radius, fetchImpl })]
      ].filter(Boolean);
      for (const [source, request] of providers) {
        sources[source].queries += 1;
        try {
          for (const event of await request()) {
            if (event?.id != null) raw.set(`${source}:${event.id}`, { source, event });
          }
        } catch (error) {
          sources[source].failures += 1;
          firstError ??= error;
          warnings.push(`Destination search "${term}" on ${source} failed: ${error.message}`);
        }
      }
    }
  }
  const queries = sources.ticketmaster.queries + sources.seatgeek.queries;
  if (queries && queries === sources.ticketmaster.failures + sources.seatgeek.failures) {
    throw new Error(`Destination event search failed on every ticketing query: ${firstError.message}`);
  }

  const occurrences = [];
  const pending = [];
  for (const { source, event } of raw.values()) {
    const candidate = source === 'ticketmaster' ? normalizeTicketmasterEvent(event, retrievedAt) : normalizeSeatGeekEvent(event, retrievedAt);
    const match = matchDestinationWatch({ title: candidate.title, performerNames: candidate.performers.map((performer) => performer.name) }, watches);
    if (!match || !withinWatchArea(candidate.venue, match.watch, home)) continue;
    sources[source].matched += 1;
    const dates = publishedDays(candidate, event, source) ?? (source === 'ticketmaster' ? newYearDays(candidate.title, event) : null);
    occurrences.push({ watch: match.watch, candidate, dates });
  }

  const events = [];
  for (const watch of watches) {
    const mine = occurrences.filter((occurrence) => occurrence.watch === watch);
    const editions = groupEditions(mine.filter((occurrence) => occurrence.dates));
    const undated = mine.filter((occurrence) => !occurrence.dates);
    // A listing with no date of its own (a pass sold "date TBA") can only be
    // attached when there is exactly one edition it could belong to.
    if (editions.length === 1) editions[0].push(...undated.splice(0));
    for (const occurrence of undated) {
      pending.push({
        watch: watch.name,
        source: occurrence.candidate.source,
        sourceEventId: occurrence.candidate.sourceEventId,
        sourceUrl: occurrence.candidate.sourceUrl,
        retrievedAt: occurrence.candidate.retrievedAt,
        reason: 'The provider lists this event without a date, and no dated listing or corroborated title date was found.'
      });
    }
    for (const edition of editions) {
      const event = buildEdition(edition, watch, home, config);
      if ((startDate && event.destination.endDate < startDate) || (endDate && event.destination.startDate > endDate)) continue;
      events.push(event);
    }
  }
  events.sort((left, right) => String(left.startLocal).localeCompare(String(right.startLocal)));

  let audit = [];
  if (edmtrainClientKey) {
    const edmEvents = [];
    for (const [city, state] of new Map(watches.filter((watch) => watch.city).map((watch) => [`${watch.city}|${watch.state}`, [watch.city, watch.state]])).values()) {
      sources.edmtrain.queries += 1;
      try {
        edmEvents.push(...await fetchEdmtrainEvents({ clientKey: edmtrainClientKey, startDate, endDate, city, state, fetchImpl }));
      } catch (error) {
        sources.edmtrain.failures += 1;
        warnings.push(`Destination lineup enrichment for ${city} failed: ${error.message}`);
      }
    }
    const announced = announcedEditions(events, edmEvents, watches, { home, config, startDate, endDate, retrievedAt });
    events.push(...announced);
    events.sort((left, right) => String(left.startLocal).localeCompare(String(right.startLocal)));
    const enrichment = enrichDestinationEventsWithEdmtrain(events, edmEvents, artistSnapshot ?? { artists: [] }, { watchlist: watches });
    audit = enrichment.audit;
    sources.edmtrain.matched = enrichment.matchedCount;
    sources.edmtrain.announced = announced.length;
  }
  return { events, pending, audit, warnings, sources };
}

/**
 * Add an EDMTrain lineup to destination candidates that already exist. A
 * festival-flagged EDMTrain record is used when it carries the same exact
 * watchlist name, falls on one of the candidate's days and is at the same
 * venue or in the same city. Everything else is audit-only. A candidate that
 * `announcedEditions` built from EDMTrain is audited as `announced-surfaced`.
 */
export function enrichDestinationEventsWithEdmtrain(events, edmEvents, artistSnapshot = { artists: [] }, { watchlist = DEFAULT_DESTINATION_WATCHLIST } = {}) {
  const watches = resolveDestinationWatchlist(watchlist);
  const audit = [];
  const matchedByEvent = new Map();
  for (const edm of edmEvents) {
    const match = edm.festival ? matchDestinationWatch({ title: edm.name }, watches) : null;
    if (!match) continue;
    const candidates = events.filter((event) => event.destination?.name === match.watch.name
      && event.destination.days.includes(edm.date)
      && samePlace(event.venue, edm.venue));
    if (candidates.length !== 1) {
      audit.push({
        watch: match.watch.name,
        edmtrainEventId: edm.id,
        date: edm.date,
        sourceUrl: edm.sourceUrl,
        status: candidates.length ? 'ambiguous' : 'announced-no-permitted-candidate'
      });
      continue;
    }
    matchedByEvent.set(candidates[0], [...(matchedByEvent.get(candidates[0]) ?? []), edm]);
    audit.push({
      watch: match.watch.name,
      edmtrainEventId: edm.id,
      date: edm.date,
      sourceUrl: edm.sourceUrl,
      status: candidates[0].destination.announcedBy === 'edmtrain' ? 'announced-surfaced' : 'matched',
      canonicalEventId: candidates[0].id,
      lineupCount: edm.orderedArtists.length
    });
  }

  let lineupArtistCount = 0;
  for (const [event, records] of matchedByEvent) {
    records.sort((left, right) => left.date.localeCompare(right.date));
    const ordered = [];
    const seen = new Set();
    let group = 0;
    for (const record of records) {
      let last = -1;
      for (const artist of record.orderedArtists) {
        const key = normalizeArtistName(artist.displayName);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (artist.billingGroupIndex !== last) group += 1;
        last = artist.billingGroupIndex;
        ordered.push({ ...artist, billingGroupIndex: group - 1, relation: lineupRelation(artist.displayName, artistSnapshot) });
      }
    }
    if (!ordered.length) continue;
    const billed = new Set(event.performers.map((performer) => normalizeArtistName(performer.name)));
    for (const artist of ordered.filter((item) => item.relation !== 'unknown')) {
      const key = normalizeArtistName(artist.displayName);
      if (billed.has(key)) continue;
      billed.add(key);
      event.performers.push({ sourceId: null, name: artist.displayName, primary: false });
    }
    event.lineupDisplay = {
      displayTitle: records[0].name || event.title,
      displayShape: 'festival',
      orderedArtists: ordered,
      totalArtists: ordered.length,
      directCount: ordered.filter((item) => item.relation === 'direct').length,
      adjacentCount: ordered.filter((item) => item.relation === 'adjacent').length,
      ages: records.find((record) => record.ages)?.ages ?? null,
      sourceUrl: records[0].sourceUrl
    };
    lineupArtistCount += ordered.length;
  }
  return { events, audit, matchedCount: [...matchedByEvent.values()].filter((records) => records.some((record) => record.orderedArtists.length)).length, lineupArtistCount };
}

/**
 * Build a candidate for each watchlist edition that EDMTrain announces and no
 * ticketing API lists. Exact watchlist name, festival-flagged, a real date, a
 * link, and a venue inside the watch area are all required; a record on or
 * next to the days of a ticketing edition of the same watch belongs to that
 * edition and creates nothing.
 */
export function announcedEditions(events, edmEvents, watchlist, { home = null, config = {}, startDate = null, endDate = null, retrievedAt = new Date() } = {}) {
  const retrieved = new Date(retrievedAt).toISOString();
  const announced = [];
  for (const watch of watchlist) {
    const listedDays = new Set(events.filter((event) => event.destination?.name === watch.name)
      .flatMap((event) => event.destination.days.flatMap((day) => [addDays(day, -1), day, addDays(day, 1)])));
    const records = [...new Map(edmEvents
      .filter((edm) => edm.festival && edm.sourceUrl && /^\d{4}-\d{2}-\d{2}$/.test(edm.date)
        && matchDestinationWatch({ title: edm.name }, watchlist)?.watch === watch
        && withinWatchArea(edm.venue, watch, home)
        && !listedDays.has(edm.date))
      .map((edm) => [edm.id, edm])).values()]
      .sort((left, right) => left.date.localeCompare(right.date));
    const editions = [];
    for (const record of records) {
      const current = editions.at(-1);
      if (current && record.date <= addDays(current.at(-1).date, 1)) current.push(record);
      else editions.push([record]);
    }
    for (const edition of editions) {
      const days = [...new Set(edition.map((record) => record.date))].slice(0, MAX_EDITION_DAYS);
      if ((startDate && days.at(-1) < startDate) || (endDate && days[0] > endDate)) continue;
      const first = edition[0];
      const located = edition.map((record) => record.venue).find((venue) => Number.isFinite(venue?.lat) && Number.isFinite(venue?.lon));
      const venue = {
        sourceId: null,
        name: first.venue.name,
        city: first.venue.city || watch.city || '',
        state: watch.state === 'California' ? 'CA' : watch.state,
        lat: located?.lat ?? null,
        lon: located?.lon ?? null
      };
      const distanceMiles = home && located ? Math.round(milesBetween(home, located)) : null;
      const city = watch.city ?? venue.city ?? null;
      const startLocal = `${days[0]}T00:00:00`;
      announced.push({
        schemaVersion: 1,
        id: `edmtrain:${first.id}`,
        source: 'edmtrain',
        sourceEventId: first.id,
        sourceUrl: first.sourceUrl,
        sourceOccurrences: edition.map((record) => ({
          source: 'edmtrain',
          sourceEventId: record.id,
          sourceUrl: record.sourceUrl,
          retrievedAt: retrieved,
          title: record.name,
          startLocal: `${record.date}T00:00:00`,
          venue,
          performerNames: [],
          evidence: null
        })),
        // EDMTrain is not a permitted evidence provider: no typed evidence is kept.
        eventEvidence: null,
        retrievedAt: retrieved,
        title: first.name,
        type: watch.type,
        startLocal,
        startUtc: null,
        doorsLocal: null,
        endLocal: null,
        timeTbd: true,
        dateTbd: false,
        status: 'announced',
        venue,
        performers: [],
        // No ticketing source lists it, so nothing is known about tickets.
        ticketObservation: { listingCount: null, lowestPriceUsd: null, averagePriceUsd: null, observedAt: retrieved },
        destination: {
          name: watch.name,
          city,
          distanceMiles,
          distanceLabel: distanceMiles != null
            ? `about ${Math.round(distanceMiles / 5) * 5} mi from ${config.home?.label ?? 'home'}`
            : city ? `in ${city}` : 'outside the home radius',
          days,
          startDate: days[0],
          endDate: days.at(-1),
          dateSource: 'published',
          announcedBy: 'edmtrain',
          dateNote: 'Announced on EDMTrain; no ticketing listing has been found yet, so prices and availability are unknown.'
        }
      });
    }
  }
  return announced;
}

function buildEdition(edition, watch, home, config) {
  const dated = edition.filter((occurrence) => occurrence.dates);
  const days = [...new Set(dated.flatMap((occurrence) => occurrence.dates.days))].sort();
  const primary = [...dated].sort((left, right) => (SOURCE_PRIORITY[right.candidate.source] ?? 0) - (SOURCE_PRIORITY[left.candidate.source] ?? 0)
    || left.dates.days[0].localeCompare(right.dates.days[0])
    || Number(left.candidate.timeTbd) - Number(right.candidate.timeTbd))[0];
  const opening = dated.filter((occurrence) => occurrence.dates.days[0] === days[0] && !occurrence.dates.derived && !occurrence.candidate.timeTbd && occurrence.candidate.startLocal)[0];
  const derivedOnly = dated.every((occurrence) => occurrence.dates.derived);
  const names = new Set(watchNames(watch));
  const performers = [];
  const billed = new Set();
  for (const occurrence of edition) {
    for (const performer of occurrence.candidate.performers) {
      const key = normalizeArtistName(performer.name);
      // A ticketing API bills a festival as its own attraction. The festival
      // is the event, not an act on it.
      if (!key || names.has(key) || billed.has(key)) continue;
      billed.add(key);
      performers.push(performer);
    }
  }
  const located = [primary, ...edition].map((occurrence) => occurrence.candidate.venue).find((venue) => Number.isFinite(venue?.lat) && Number.isFinite(venue?.lon));
  const venue = Number.isFinite(primary.candidate.venue?.lat) || !located ? primary.candidate.venue : { ...primary.candidate.venue, lat: located.lat, lon: located.lon };
  const distanceMiles = home && located ? Math.round(milesBetween(home, located)) : null;
  const city = watch.city ?? venue.city ?? null;
  const observation = { ...primary.candidate.ticketObservation };
  if (observation.lowestPriceUsd == null) {
    observation.lowestPriceUsd = edition.map((occurrence) => occurrence.candidate.ticketObservation?.lowestPriceUsd).find((price) => price != null) ?? null;
  }
  return {
    ...primary.candidate,
    sourceOccurrences: edition.flatMap((occurrence) => occurrencesFor(occurrence.candidate)),
    type: watch.type,
    startLocal: opening?.candidate.startLocal ?? `${days[0]}T00:00:00`,
    startUtc: opening?.candidate.startUtc ?? null,
    timeTbd: !opening,
    dateTbd: false,
    venue,
    performers,
    ticketObservation: observation,
    destination: {
      name: watch.name,
      city,
      distanceMiles,
      distanceLabel: distanceMiles != null
        ? `about ${Math.round(distanceMiles / 5) * 5} mi from ${config.home?.label ?? 'home'}`
        : city ? `in ${city}` : 'outside the home radius',
      days,
      startDate: days[0],
      endDate: days.at(-1),
      // `derived-from-title` dates were not published as a date by any
      // provider; `dateNote` says exactly how they were arrived at.
      dateSource: derivedOnly ? 'derived-from-title' : 'published',
      ...(derivedOnly ? { dateNote: dated[0].dates.note } : {})
    }
  };
}

// Consecutive or overlapping days of one watchlist entry are one edition.
function groupEditions(occurrences) {
  const editions = [];
  let lastDay = null;
  for (const occurrence of [...occurrences].sort((left, right) => left.dates.days[0].localeCompare(right.dates.days[0]))) {
    if (lastDay == null || occurrence.dates.days[0] > addDays(lastDay, 1)) editions.push([]);
    editions.at(-1).push(occurrence);
    const end = occurrence.dates.days.at(-1);
    if (lastDay == null || end > lastDay) lastDay = end;
  }
  return editions;
}

function publishedDays(candidate, event, source) {
  if (candidate.dateTbd || !candidate.startLocal) return null;
  const start = String(candidate.startLocal).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const end = source === 'ticketmaster' ? String(event.dates?.end?.localDate ?? '') : '';
  return { days: dayRange(start, /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start ? end : start), derived: false };
}

/**
 * A New Year pass is often sold with its date marked TBA. "NYE/NYD 2027" names
 * its own two days: New Year's Day 2027 and the evening before. The dates are
 * accepted only when the provider's own public sale closes within three days
 * after that New Year's Day, so a differently-numbered edition is not misread.
 */
function newYearDays(title, event) {
  const year = Number(String(title ?? '').match(/\bNYE\s*(?:\/|&|\+|and)\s*NYD\s+(20\d{2})\b/i)?.[1]);
  const saleEnd = String(event?.sales?.public?.endDateTime ?? '').slice(0, 10);
  if (!year || !/^\d{4}-\d{2}-\d{2}$/.test(saleEnd)) return null;
  const end = `${year}-01-01`;
  if (saleEnd < end || saleEnd > addDays(end, 3)) return null;
  return {
    days: [`${year - 1}-12-31`, end],
    derived: true,
    note: `The provider lists the date as TBA. ${year - 1}-12-31 to ${end} is read from "NYE/NYD ${year}" in the listing title and agrees with the provider's public sale end (${saleEnd}).`
  };
}

function withinWatchArea(venue, watch, home) {
  const city = normalizeArtistName(venue?.city);
  const cityMatches = watch.city && city ? city === normalizeArtistName(watch.city) : null;
  const located = home && Number.isFinite(venue?.lat) && Number.isFinite(venue?.lon);
  const inRange = located ? milesBetween(home, venue) <= watch.maxDistanceMiles : null;
  if (cityMatches === false || inRange === false) return false;
  // With a city on the watch entry, something about the place must be verifiable.
  return !(watch.city && cityMatches == null && inRange == null);
}

function samePlace(left = {}, right = {}) {
  const a = normalizeArtistName(left.name);
  const b = normalizeArtistName(right.name);
  if (a && b && (a === b || (a.length > 8 && b.length > 8 && (a.includes(b) || b.includes(a))))) return true;
  if ([left.lat, left.lon, right.lat, right.lon].every(Number.isFinite)) return milesBetween(left, right) <= 1.5;
  const city = normalizeArtistName(left.city);
  return Boolean(city && city === normalizeArtistName(right.city));
}

function lineupRelation(name, snapshot) {
  const key = normalizeArtistName(name);
  const matches = (snapshot?.artists ?? []).filter((artist) => [artist.name, ...(artist.aliases ?? [])].some((alias) => normalizeArtistName(alias) === key));
  if (matches.length !== 1) return 'unknown';
  return ['source', 'top-items'].includes(matches[0].origin ?? 'source') ? 'direct' : 'adjacent';
}

function occurrencesFor(candidate) {
  if (Array.isArray(candidate.sourceOccurrences) && candidate.sourceOccurrences.length) return candidate.sourceOccurrences;
  return [{
    source: candidate.source,
    sourceEventId: candidate.sourceEventId,
    sourceUrl: candidate.sourceUrl,
    retrievedAt: candidate.retrievedAt,
    title: candidate.title,
    startLocal: candidate.startLocal,
    venue: candidate.venue,
    performerNames: candidate.performers.map((performer) => performer.name),
    evidence: candidate.eventEvidence ?? null
  }];
}

function watchNames(watch) {
  return [...new Set([watch.name, ...(watch.aliases ?? [])].map(normalizeArtistName).filter((name) => name.length >= 3))];
}

// One query per distinct name: "CRSSD" already returns "CRSSD Festival".
function queryTerms(watch) {
  const terms = [watch.name, ...(watch.aliases ?? [])].map((term) => ({ term, key: normalizeArtistName(term) })).filter((item) => item.key.length >= 3);
  return terms.filter((item, index) => !terms.some((other, otherIndex) => otherIndex !== index
    && (item.key.startsWith(`${other.key} `) || (item.key === other.key && otherIndex < index)))).map((item) => item.term);
}

function dayRange(start, end) {
  const days = [start];
  while (days.at(-1) < end && days.length < MAX_EDITION_DAYS) days.push(addDays(days.at(-1), 1));
  return days;
}

function addDays(date, count) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function milesBetween(left, right) {
  const radians = Math.PI / 180;
  const dLat = (right.lat - left.lat) * radians;
  const dLon = (right.lon - left.lon) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(left.lat * radians) * Math.cos(right.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
