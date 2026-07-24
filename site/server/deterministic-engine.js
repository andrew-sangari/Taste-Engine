// Generated from the deterministic Taste Engine source modules for the Sites Worker runtime.

// ../src/ranking.js
var URGENCY_PRIORITY = Object.freeze({ "safe to wait": 0, watch: 1, "buy now": 2 });
var UNORDERED_URGENCIES = Object.freeze(["unknown", "likely unavailable"]);
function rankCandidates(candidates, artistSnapshot, config, now = /* @__PURE__ */ new Date()) {
  const bySpotifyId = new Map((artistSnapshot.artists ?? []).filter((artist) => artist.spotifyArtistId).map((artist) => [artist.spotifyArtistId, artist]));
  const bySeatGeekId = new Map((artistSnapshot.artists ?? []).filter((artist) => artist.seatGeekPerformerId).map((artist) => [String(artist.seatGeekPerformerId), artist]));
  const byNormalizedName = /* @__PURE__ */ new Map();
  for (const artist of artistSnapshot.artists ?? []) {
    for (const name of [artist.name, ...artist.aliases ?? []]) {
      const key = normalizeArtistName(name);
      if (!key) continue;
      const matches = byNormalizedName.get(key) ?? [];
      if (!matches.includes(artist)) matches.push(artist);
      byNormalizedName.set(key, matches);
    }
  }
  const pinned = new Set(config.pinnedArtists.map(normalizeArtistName));
  const excludedArtists = new Set(config.excludedArtists.map(normalizeArtistName));
  const excludedVenues = new Set(config.excludedVenues.map(normalizeArtistName));
  const maximumSeedStrength = Math.max(1, ...(artistSnapshot.artists ?? []).map((artist) => artist.seedStrength ?? 0));
  return candidates.map((candidate) => {
    const matches = candidate.performers.map((performer) => ({
      performer,
      artist: bySeatGeekId.get(String(performer.sourceId)) ?? (performer.spotifyId ? bySpotifyId.get(performer.spotifyId) : null) ?? uniqueNameMatch(byNormalizedName.get(normalizeArtistName(performer.name)))
    })).filter((match) => match.artist);
    const excluded = candidate.performers.some((performer) => excludedArtists.has(normalizeArtistName(performer.name))) || excludedVenues.has(normalizeArtistName(candidate.venue.name));
    const scoredMatches = matches.map((match) => {
      const playlistAffinity = playlistAffinityFor(match.artist, maximumSeedStrength);
      const topAffinity = topItemsAffinityFor(match.artist, artistSnapshot.topItems, now);
      const corroborationBonus = playlistAffinity > 0 && topAffinity > 0 ? Math.min(6, Math.round(Math.min(playlistAffinity, topAffinity) * 0.1)) : 0;
      const directAffinity = Math.min(60, Math.max(playlistAffinity, topAffinity) + corroborationBonus);
      return { ...match, playlistAffinity, topAffinity, corroborationBonus, directAffinity };
    });
    const strongestMatch = scoredMatches.sort((a, b) => b.directAffinity - a.directAffinity || b.artist.seedStrength - a.artist.seedStrength)[0];
    const artistFit = strongestMatch?.directAffinity ?? 0;
    const pinnedBonus = candidate.performers.some((performer) => pinned.has(normalizeArtistName(performer.name))) ? 15 : 0;
    const distanceMiles4 = distanceBetween(config.home, candidate.venue);
    const hassleScore = calculateHassle(candidate, config, distanceMiles4);
    const urgency = ticketUrgency(candidate.ticketObservation, candidate.startLocal, now);
    const utility = excluded ? -100 : artistFit + pinnedBonus - hassleScore * 2;
    const confidence = strongestMatch ? ["similar", "tag", "promoter"].includes(strongestMatch.artist.origin) ? "medium" : "high" : "low";
    return {
      ...candidate,
      matchedArtists: scoredMatches.map((match) => ({
        spotifyArtistId: match.artist.spotifyArtistId,
        name: match.artist.name,
        seedStrength: match.artist.seedStrength,
        origin: match.artist.origin ?? "source",
        matchMethod: match.performer.sourceId && match.artist.seatGeekPerformerId && String(match.performer.sourceId) === String(match.artist.seatGeekPerformerId) ? "seatgeek-performer-id" : match.performer.spotifyId ? "spotify-id" : "exact-name",
        primary: match.performer.primary
      })),
      ranking: {
        excluded,
        artistFit,
        playlistAffinity: strongestMatch?.playlistAffinity ?? 0,
        topItemsAffinity: strongestMatch?.topAffinity ?? 0,
        corroborationBonus: strongestMatch?.corroborationBonus ?? 0,
        directAffinity: artistFit,
        pinnedBonus,
        hassleScore,
        hassleReasons: hassleReasons(candidate, config, distanceMiles4),
        utility,
        confidence,
        urgency,
        whyYou: strongestMatch ? whyYouReason(strongestMatch.artist, candidate, artistSnapshot.topItems, now) : "No exact match to the selected Spotify artists yet."
      }
    };
  }).sort((a, b) => b.ranking.utility - a.ranking.utility || String(a.startLocal).localeCompare(String(b.startLocal)));
}
function playlistAffinityFor(artist, maximumSeedStrength) {
  return artist ? Math.round(Number(artist.seedStrength ?? 0) / Math.max(1, maximumSeedStrength) * 60) : 0;
}
function topItemsAffinityFor(artist, topItems = {}, now = /* @__PURE__ */ new Date()) {
  const evidence = artist?.topEvidence;
  if (!evidence) return 0;
  const windows = [
    ["shortTerm", 0.4, evidence.shortTermRank],
    ["mediumTerm", 0.35, evidence.mediumTermRank],
    ["longTerm", 0.25, evidence.longTermRank]
  ].filter(([key]) => usableTopWindow(topItems?.windows?.[key], now));
  const totalWeight = windows.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = windows.reduce((sum, [, weight, rank]) => sum + weight * rankAffinity(rank), 0);
  return Math.round(weighted / totalWeight);
}
function rankAffinity(rank) {
  const value = Number(rank);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? 60 * (51 - value) / 50 : 0;
}
function whyYouReason(artist, candidate = {}, topItems = {}, now = /* @__PURE__ */ new Date()) {
  const labels = topPreferenceLabels(artist, topItems, now);
  if (labels.length) {
    const labelText = labels.join(" and ");
    const count = artist.evidence?.length ?? 0;
    return count ? `${artist.name} is a ${labelText} and a strong signal in ${count} selected playlist${count === 1 ? "" : "s"}.` : `${artist.name} is a ${labelText} based on Spotify affinity.`;
  }
  if (artist.topEvidence && artist.origin === "top-items" && hasUsableTopWindow(topItems, now)) return `${artist.name} is a direct Spotify top-artist signal.`;
  if (!artist.origin || artist.origin === "source") {
    const count = artist.evidence?.length ?? 0;
    const trackCount = artist.evidence?.[0]?.trackCount ?? 0;
    if (count >= 3) return `${artist.name} runs through ${count} of your selected playlists.`;
    if (count === 2) return `${artist.name} anchors two of your selected playlists.`;
    if (count === 1 && trackCount >= 3) return `${artist.name} shows up ${trackCount} times in one of your core playlists.`;
    if (count === 1) return `${artist.name} is a strong signal in one of your selected playlists.`;
    return `${artist.name} is a direct signal from your selected playlists.`;
  }
  const similar = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === "lastfm-similar");
  if (similar) return `${artist.name} is a Last.fm neighbor of ${similar.sourceArtist}, one of your stronger playlist signals.`;
  const tag = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === "lastfm-tag");
  if (tag) return `${artist.name} ranks within your recurring \u201C${tag.tag}\u201D taste cluster.`;
  const frameworkRoster = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === "framework-roster");
  if (frameworkRoster) {
    const providers = listingProviders(candidate);
    return providers.length ? `${artist.name} is in the Framework artist roster; this listing comes from ${providers.join(" + ")}.` : `${artist.name} is in the Framework artist roster.`;
  }
  const promoter = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === "promoter-event" || evidence.type === "promoter");
  if (promoter) return `${artist.name} is here because you explicitly follow ${promoter.promoter}'s calendar.`;
  return `${artist.name} is an adjacent discovery from your playlist-derived taste graph.`;
}
function topPreferenceLabels(artist, topItems = {}, now = /* @__PURE__ */ new Date()) {
  const evidence = artist?.topEvidence;
  if (!evidence) return [];
  const shortAvailable = usableTopWindow(topItems.windows?.shortTerm, now);
  const mediumAvailable = usableTopWindow(topItems.windows?.mediumTerm, now);
  const longAvailable = usableTopWindow(topItems.windows?.longTerm, now);
  const labels = [];
  if (shortAvailable && evidence.shortTermRank != null && evidence.shortTermRank <= 10) labels.push("current top artist");
  if (mediumAvailable && longAvailable && evidence.mediumTermRank != null && evidence.mediumTermRank <= 25 && evidence.longTermRank != null && evidence.longTermRank <= 25) {
    labels.push("sustained favorite");
  }
  if (shortAvailable && mediumAvailable && evidence.shortTermRank != null && evidence.shortTermRank <= 10 && (evidence.mediumTermRank == null || evidence.mediumTermRank > 25)) {
    labels.push("current surge");
  }
  return labels;
}
function usableTopWindow(window, now) {
  if (!["fresh", "cached"].includes(window?.status)) return false;
  if (!window.expiresAt) return true;
  const expiry = new Date(window.expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > new Date(now).getTime();
}
function hasUsableTopWindow(topItems, now) {
  return Object.values(topItems?.windows ?? {}).some((window) => usableTopWindow(window, now));
}
function uniqueNameMatch(matches = []) {
  return matches.length === 1 ? matches[0] : null;
}
function listingProviders(candidate) {
  const sources = new Set((candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.source).filter(Boolean));
  if (candidate.source) sources.add(candidate.source);
  const labels = { seatgeek: "SeatGeek", ticketmaster: "Ticketmaster", framework: "Framework", insomniac: "Insomniac" };
  return [...sources].map((source) => labels[source] ?? source);
}
function normalizeArtistName(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(live|dj set|live set)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function calculateHassle(candidate, config, distanceMiles4) {
  let score = distanceMiles4 == null ? 5 : Math.min(7, Math.round(distanceMiles4 / 10));
  const lowestPrice = candidate.ticketObservation.lowestPriceUsd;
  if (lowestPrice != null && lowestPrice > config.maxTicketPriceUsd) score += 2;
  if (candidate.timeTbd || candidate.dateTbd) score += 2;
  return Math.min(10, score);
}
function hassleReasons(candidate, config, distanceMiles4) {
  const reasons = [];
  if (distanceMiles4 != null) reasons.push(`${Math.round(distanceMiles4)} mi from ${config.home.label}`);
  if (candidate.ticketObservation.lowestPriceUsd != null) reasons.push(`from $${candidate.ticketObservation.lowestPriceUsd}`);
  if (candidate.ticketObservation.lowestPriceUsd != null && candidate.ticketObservation.lowestPriceUsd > config.maxTicketPriceUsd) reasons.push("above ticket budget");
  if (candidate.timeTbd || candidate.dateTbd) reasons.push("time or date is TBD");
  return reasons;
}
function ticketUrgency(ticketObservation, startLocal, now) {
  const listingCount = ticketObservation.listingCount;
  const daysUntil2 = daysUntilEvent(startLocal, now);
  if (listingCount != null && listingCount <= 10) return "buy now";
  if (daysUntil2 != null && daysUntil2 <= 3 && listingCount != null && listingCount <= 30) return "buy now";
  if (daysUntil2 != null && daysUntil2 <= 7) return "watch";
  return "safe to wait";
}
function daysUntilEvent(startLocal, now) {
  if (!startLocal) return null;
  const start = new Date(startLocal);
  if (Number.isNaN(start.getTime())) return null;
  return Math.ceil((start.getTime() - now.getTime()) / 864e5);
}
function distanceBetween(home, venue) {
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return null;
  const radians = Math.PI / 180;
  const dLat = (venue.lat - home.lat) * radians;
  const dLon = (venue.lon - home.lon) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(home.lat * radians) * Math.cos(venue.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ../src/seatgeek.js
var API_ROOT = "https://api.seatgeek.com/2";
var EVENTS_URL = `${API_ROOT}/events`;
var PERFORMERS_URL = `${API_ROOT}/performers`;
async function fetchSeatGeekWeekendEvents(options) {
  return fetchSeatGeekEvents({ ...options, maxPages: 1 });
}
async function fetchSeatGeekEvents({
  clientId,
  startDate,
  endDate,
  config,
  maxPages = 1,
  windowDays = null,
  diagnostics = null,
  fetchImpl = fetch
}) {
  if (!clientId) throw new Error("Set SEATGEEK_CLIENT_ID in your environment before generating a brief.");
  const windows = windowDays ? splitDateWindows(startDate, endDate, windowDays) : [{ startDate, endDate }];
  const events = [];
  const seen = /* @__PURE__ */ new Set();
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
      const key = String(event.id ?? event.url ?? "");
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
      throw new Error(`SeatGeek request failed (${response.status}) for ${startDate} through ${endDate}.${detail ? ` ${detail}` : ""}`);
    }
    const body = await response.json();
    const pageEvents = Array.isArray(body.events) ? body.events : [];
    events.push(...pageEvents);
    const total = Number(body.meta?.total ?? 0);
    if (pageEvents.length < 100 || events.length >= total) break;
  }
  return events;
}
function splitDateWindows(startDate, endDate, windowDays) {
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new Error("windowDays must be a positive integer");
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start > end) throw new Error("SeatGeek startDate must not be after endDate");
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
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ISO date: ${value}`);
  return date;
}
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
function eventSearchUrl({ clientId, startDate, endDate, config, page, performerIds = null, includeGeography = true }) {
  const url = new URL(EVENTS_URL);
  url.searchParams.set("client_id", clientId);
  if (includeGeography) {
    url.searchParams.set("lat", String(config.home.lat));
    url.searchParams.set("lon", String(config.home.lon));
    url.searchParams.set("range", `${config.searchRadiusMiles}mi`);
  }
  if (performerIds?.length) url.searchParams.set("performers.id", performerIds.join(","));
  url.searchParams.set("taxonomies.name", "concert");
  url.searchParams.set("datetime_local.gte", startDate);
  url.searchParams.set("datetime_local.lte", `${endDate}T23:59:59`);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "datetime_local.asc");
  return url;
}
async function resolveSeatGeekPerformers(artists, {
  clientId,
  fetchImpl = fetch,
  concurrency = 5,
  cache = {}
} = {}) {
  if (!clientId) throw new Error("Set SEATGEEK_CLIENT_ID before resolving performers.");
  const resolved = new Array(artists.length);
  let next = 0;
  async function worker() {
    while (next < artists.length) {
      const index = next;
      next += 1;
      const artist = artists[index];
      const key = normalizeArtistName(artist.name);
      const cacheKey = `${key}|${artist.spotifyArtistId ?? ""}`;
      if (Object.hasOwn(cache, cacheKey)) {
        resolved[index] = cache[cacheKey];
        continue;
      }
      const candidates = await searchSeatGeekPerformers(artist.name, { clientId, fetchImpl });
      const selected = selectSeatGeekPerformer(artist, candidates);
      const result = selected ? {
        artistName: artist.name,
        artistOrigin: artist.origin ?? "source",
        spotifyArtistId: artist.spotifyArtistId ?? null,
        performerId: String(selected.id),
        performerName: selected.name,
        performerSlug: selected.slug ?? null,
        matchMethod: spotifyIdFromLinks(selected.links) === artist.spotifyArtistId ? "spotify-id" : "exact-name"
      } : null;
      cache[cacheKey] = result;
      resolved[index] = result;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, artists.length) }, worker));
  return { resolved: resolved.filter(Boolean), unresolvedCount: resolved.filter((item) => !item).length, cache };
}
async function searchSeatGeekPerformers(name, { clientId, fetchImpl = fetch, limit = 10 } = {}) {
  if (!clientId) throw new Error("Set SEATGEEK_CLIENT_ID before searching performers.");
  const url = new URL(PERFORMERS_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("q", name);
  url.searchParams.set("taxonomies.name", "concert");
  url.searchParams.set("per_page", String(limit));
  const body = await seatGeekJson(url, fetchImpl, `performer search for ${name}`);
  return Array.isArray(body.performers) ? body.performers : [];
}
function selectSeatGeekPerformer(artist, candidates) {
  const spotifyId = String(artist.spotifyArtistId ?? "");
  const bySpotify = spotifyId ? candidates.filter((candidate) => spotifyIdFromLinks(candidate.links) === spotifyId) : [];
  const normalized = normalizeArtistName(artist.name);
  const exact = candidates.filter((candidate) => normalizeArtistName(candidate.name) === normalized || normalizeArtistName(candidate.short_name) === normalized);
  const pool = bySpotify.length ? bySpotify : exact;
  return pool.sort((a, b) => Number(Boolean(b.has_upcoming_events)) - Number(Boolean(a.has_upcoming_events)) || (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
}
async function fetchSeatGeekEventsForPerformers({
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
  if (!clientId) throw new Error("Set SEATGEEK_CLIENT_ID before fetching performer events.");
  const uniqueIds = [...new Set(performerIds.map(String).filter(Boolean))];
  const windows = windowDays ? splitDateWindows(startDate, endDate, windowDays) : [{ startDate, endDate }];
  const events = /* @__PURE__ */ new Map();
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
function eventWithinRadius(event, home, radiusMiles) {
  const lat = Number(event.venue?.location?.lat);
  const lon = Number(event.venue?.location?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return distanceMiles(home.lat, home.lon, lat, lon) <= radiusMiles;
}
function distanceMiles(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function normalizeSeatGeekEvent(event, retrievedAt = /* @__PURE__ */ new Date()) {
  const venue = event.venue ?? {};
  const performers = (Array.isArray(event.performers) ? event.performers : []).map((performer) => ({
    sourceId: performer.id == null ? null : String(performer.id),
    name: String(performer.name ?? performer.short_name ?? "").trim(),
    primary: performer.primary === true,
    spotifyId: spotifyIdFromLinks(performer.links)
  })).filter((performer) => performer.name);
  return {
    schemaVersion: 1,
    id: `seatgeek:${event.id}`,
    source: "seatgeek",
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ""),
    retrievedAt: new Date(retrievedAt).toISOString(),
    title: String(event.title ?? event.short_title ?? "").trim(),
    type: String(event.type ?? "").trim(),
    startLocal: event.datetime_local ?? null,
    startUtc: event.datetime_utc ?? null,
    timeTbd: Boolean(event.time_tbd),
    dateTbd: Boolean(event.date_tbd),
    status: event.status ?? "scheduled",
    venue: {
      sourceId: venue.id == null ? null : String(venue.id),
      name: String(venue.name ?? "").trim(),
      city: String(venue.city ?? "").trim(),
      state: String(venue.state ?? "").trim(),
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
function spotifyIdFromLinks(links) {
  const spotify = (Array.isArray(links) ? links : []).find((link) => String(link.provider ?? "").toLowerCase() === "spotify");
  if (!spotify) return null;
  const explicit = String(spotify.id ?? "").trim();
  if (explicit) {
    const segments = explicit.split(":");
    return segments.at(-1) || explicit;
  }
  const url = String(spotify.url ?? "");
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
    return "";
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
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(3e4, retryAfter * 1e3) : 1e3 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const detail = await safeResponseText(response);
    throw new Error(`SeatGeek ${context} failed (${response.status}).${detail ? ` ${detail}` : ""}`);
  }
  throw new Error(`SeatGeek ${context} failed after retries.`);
}

// ../src/ticketmaster.js
var API_URL = "https://app.ticketmaster.com/discovery/v2/events.json";
async function fetchTicketmasterEvents({
  apiKey,
  startDate,
  endDate,
  config,
  maxPages = 5,
  keyword = null,
  fetchImpl = fetch
}) {
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY is not configured.");
  const events = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(API_URL);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("classificationName", "music");
    if (keyword) url.searchParams.set("keyword", String(keyword));
    url.searchParams.set("latlong", `${config.home.lat},${config.home.lon}`);
    url.searchParams.set("radius", String(config.searchRadiusMiles));
    url.searchParams.set("unit", "miles");
    url.searchParams.set("startDateTime", `${startDate}T00:00:00Z`);
    url.searchParams.set("endDateTime", `${endDate}T23:59:59Z`);
    url.searchParams.set("includeTBA", "yes");
    url.searchParams.set("includeTBD", "yes");
    url.searchParams.set("size", "200");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "date,asc");
    const body = await requestJson(url, fetchImpl);
    const pageEvents = body._embedded?.events ?? [];
    events.push(...pageEvents);
    const totalPages = Number(body.page?.totalPages ?? 0);
    if (!pageEvents.length || page + 1 >= totalPages) break;
  }
  return events;
}
async function fetchTicketmasterEventsForArtists({
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
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY is not configured.");
  const watchlist = [...new Map(artists.map((artist) => [normalizeArtistName(artist.name), artist]).filter(([key]) => key)).values()].slice(0, maxArtists);
  const events = /* @__PURE__ */ new Map();
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
          events.set(String(event.id ?? event.url ?? `${artist.name}|${event.name ?? ""}`), event);
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
function ticketmasterEventMatchesArtist(event, artistName) {
  const target = normalizeArtistName(artistName);
  if (!target) return false;
  const attractions = (event?._embedded?.attractions ?? []).map((attraction) => normalizeArtistName(attraction.name)).filter(Boolean);
  if (attractions.length) return attractions.includes(target);
  return normalizeArtistName(event?.name) === target;
}
function normalizeTicketmasterEvent(event, retrievedAt = /* @__PURE__ */ new Date()) {
  const venue = event._embedded?.venues?.[0] ?? {};
  const attractions = event._embedded?.attractions ?? [];
  const localDate3 = event.dates?.start?.localDate ?? null;
  const localTime = event.dates?.start?.localTime ?? null;
  return {
    schemaVersion: 1,
    id: `ticketmaster:${event.id}`,
    source: "ticketmaster",
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ""),
    sourceOccurrences: [{ source: "ticketmaster", sourceEventId: String(event.id), sourceUrl: String(event.url ?? "") }],
    retrievedAt: new Date(retrievedAt).toISOString(),
    title: String(event.name ?? "").trim(),
    type: "concert",
    startLocal: localDate3 ? `${localDate3}T${localTime || "00:00:00"}` : null,
    startUtc: event.dates?.start?.dateTime ?? null,
    timeTbd: Boolean(event.dates?.start?.timeTBA || !localTime),
    dateTbd: Boolean(event.dates?.start?.dateTBA || !localDate3),
    status: event.dates?.status?.code ?? "scheduled",
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: String(venue.name ?? "").trim(),
      city: String(venue.city?.name ?? "").trim(),
      state: String(venue.state?.stateCode ?? venue.state?.name ?? "").trim(),
      lat: numberOrNull2(venue.location?.latitude),
      lon: numberOrNull2(venue.location?.longitude)
    },
    performers: attractions.map((attraction, index) => ({
      sourceId: attraction.id ? String(attraction.id) : null,
      name: String(attraction.name ?? "").trim(),
      primary: index === 0,
      spotifyId: null
    })).filter((performer) => performer.name),
    ticketObservation: {
      listingCount: null,
      lowestPriceUsd: numberOrNull2(event.priceRanges?.[0]?.min),
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
function numberOrNull2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ../src/framework.js
var API_URL2 = "https://thisisframework.com/wp-json/tribe/events/v1/events";
var ARTISTS_URL = "https://thisisframework.com/artists/";
async function fetchFrameworkEvents({ startDate, endDate, maxPages = 10, fetchImpl = fetch }) {
  const events = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(API_URL2);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));
    const response = await fetchImpl(url, { headers: { "user-agent": "Taste Engine private personal event importer/0.1" } });
    if (!response.ok) throw new Error(`Framework event feed failed (${response.status}).`);
    const body = await response.json();
    const pageEvents = Array.isArray(body.events) ? body.events : [];
    events.push(...pageEvents);
    if (!pageEvents.length || page >= Number(body.total_pages ?? 1)) break;
  }
  return events;
}
async function fetchFrameworkArtists({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(ARTISTS_URL, {
    headers: { "user-agent": "Taste Engine private personal event importer/0.1" }
  });
  if (!response.ok) throw new Error(`Framework artist roster failed (${response.status}).`);
  return parseFrameworkArtists(await response.text());
}
function parseFrameworkArtists(html) {
  const artists = [];
  const seen = /* @__PURE__ */ new Set();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html ?? "").matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    if (!/\bclass\s*=\s*["'][^"']*\bartist-block\b[^"']*["']/i.test(attributes)) continue;
    const hrefMatch = attributes.match(/\bhref\s*=\s*["']?([^\s"'>]+)/i);
    const sourceUrl = canonicalArtistUrl(hrefMatch?.[1]);
    if (!sourceUrl) continue;
    const nameMatch = match[2].match(/\bartist-block-name\b[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i);
    const name = decodeText(nameMatch?.[1] ?? "");
    const key = normalizeArtistName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    artists.push({
      id: `framework-artist:${sourceUrl.split("/").filter(Boolean).at(-1)}`,
      source: "framework",
      name,
      sourceUrl,
      slug: sourceUrl.split("/").filter(Boolean).at(-1) ?? null
    });
  }
  return artists;
}
function normalizeFrameworkEvent(event, retrievedAt = /* @__PURE__ */ new Date()) {
  const title = decodeText(event.title);
  const venue = event.venue ?? {};
  return {
    schemaVersion: 1,
    id: `framework:${event.id}`,
    source: "framework",
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? event.website ?? ""),
    sourceOccurrences: [{ source: "framework", sourceEventId: String(event.id), sourceUrl: String(event.url ?? event.website ?? "") }],
    retrievedAt: new Date(retrievedAt).toISOString(),
    title,
    type: "concert",
    startLocal: normalizeLocalDate(event.start_date),
    startUtc: event.utc_start_date ? `${String(event.utc_start_date).replace(" ", "T")}Z` : null,
    timeTbd: false,
    dateTbd: false,
    status: event.status ?? "scheduled",
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: decodeText(venue.venue),
      city: decodeText(venue.city),
      state: decodeText(venue.stateprovince ?? ""),
      lat: numberOrNull3(venue.geo_lat),
      lon: numberOrNull3(venue.geo_lng)
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
function frameworkPerformers(title) {
  const cleaned = decodeText(title).replace(/^framework\s+presents\s*/i, "").replace(/\([^)]*(?:show added|open\s+to\s+close)[^)]*\)/gi, "").trim();
  return cleaned.split(/\s+b2b\s+|\s+&\s+/i).map((name, index) => ({ sourceId: null, name: name.trim(), primary: index === 0, spotifyId: null })).filter((performer) => performer.name);
}
function normalizeLocalDate(value) {
  const text = String(value ?? "").trim();
  return text ? text.replace(" ", "T") : null;
}
function firstPrice(value) {
  const match = String(value ?? "").match(/\$?([0-9]+(?:\.[0-9]{1,2})?)/);
  return match ? Number(match[1]) : null;
}
function decodeText(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&#x([0-9a-f]+);|&#([0-9]+);|&([a-z]+);/gi, (_, hex, decimal, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return {
      amp: "&",
      apos: "'",
      nbsp: " ",
      quot: '"',
      aacute: "\xE1",
      acirc: "\xE2",
      auml: "\xE4",
      eacute: "\xE9",
      ecirc: "\xEA",
      euml: "\xEB",
      iacute: "\xED",
      icirc: "\xEE",
      iuml: "\xEF",
      oacute: "\xF3",
      ocirc: "\xF4",
      ouml: "\xF6",
      uacute: "\xFA",
      ucirc: "\xFB",
      uuml: "\xFC",
      ntilde: "\xF1",
      rsquo: "\u2019",
      ldquo: "\u201C",
      rdquo: "\u201D"
    }[String(named).toLowerCase()] ?? `&${named};`;
  }).replace(/\s+/g, " ").trim();
}
function canonicalArtistUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text, ARTISTS_URL);
    if (url.origin !== "https://thisisframework.com") return null;
    const match = url.pathname.match(/^\/artist\/([^/]+)\/?$/i);
    return match ? `https://thisisframework.com/artist/${match[1]}/` : null;
  } catch {
    return null;
  }
}
function numberOrNull3(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ../src/insomniac.js
var EVENTS_URL2 = "https://www.insomniac.com/events/los-angeles-ca/";
async function fetchInsomniacEvents({
  startDate,
  endDate,
  pageUrl = EVENTS_URL2,
  fetchImpl = fetch
} = {}) {
  const response = await fetchImpl(pageUrl, {
    headers: { "user-agent": "Taste Engine private personal event importer/0.1" }
  });
  if (!response.ok) throw new Error(`Insomniac event page failed (${response.status}).`);
  const html = await response.text();
  if (isChallengePage(html)) throw new Error("Insomniac event page returned an access challenge.");
  const events = parseInsomniacEvents(html, { pageUrl });
  if (!events.length && /events found|upcoming events|load more/i.test(html)) {
    throw new Error("Insomniac event page shape was not recognized.");
  }
  return events.filter((event) => inDateWindow(event.startDate ?? event.startLocal, startDate, endDate));
}
function parseInsomniacEvents(html, { pageUrl = EVENTS_URL2 } = {}) {
  const events = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (event) => {
    const normalized = coerceEvent(event, pageUrl);
    if (!normalized) return;
    const key = normalized.id ?? normalized.url ?? `${normalized.name}|${normalized.startDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(normalized);
  };
  const jsonLdPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(jsonLdPattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      for (const item of flattenJsonLd(parsed)) {
        if (isEventLike(item)) add(item);
      }
    } catch {
    }
  }
  const jsonAttributePattern = /data-(?:event|event-json|event-data)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(jsonAttributePattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      if (isEventLike(parsed)) add(parsed);
    } catch {
    }
  }
  const cardPattern = /<(?:article|li|div)[^>]+(?:data-event-id|data-event-url|data-start-date)=[^>]*>[\s\S]*?<\/(?:article|li|div)>/gi;
  for (const match of html.matchAll(cardPattern)) add(parseCardAttributes(match[0], pageUrl));
  return events;
}
function normalizeInsomniacEvent(event, retrievedAt = /* @__PURE__ */ new Date()) {
  const title = cleanText(event.title ?? event.name ?? event.eventName ?? "");
  const startLocal = normalizeStartLocal(event.startLocal ?? event.startDate ?? event.start_date ?? event.date);
  const sourceUrl = String(event.sourceUrl ?? event.url ?? event.link ?? EVENTS_URL2).trim();
  const sourceEventId = String(event.sourceEventId ?? event.id ?? stableId(`${title}|${startLocal}|${sourceUrl}`));
  const performers = normalizePerformers(event.performers ?? event.performer ?? event.artistNames ?? event.artists, title);
  const venue = event.venue ?? event.location ?? {};
  const status = cleanText(event.status ?? event.availability ?? "scheduled").toLowerCase() || "scheduled";
  const retrieved = new Date(retrievedAt).toISOString();
  return {
    schemaVersion: 1,
    id: `insomniac:${sourceEventId}`,
    source: "insomniac",
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [{ source: "insomniac", sourceEventId, sourceUrl }],
    retrievedAt: retrieved,
    title,
    type: isFestival(title, event.type) ? "music_festival" : "concert",
    startLocal,
    startUtc: event.startUtc ?? event.startDateTime ?? null,
    timeTbd: !hasTime(startLocal),
    dateTbd: !startLocal,
    status,
    venue: {
      sourceId: event.venueId ?? venue.id ? String(event.venueId ?? venue.id) : null,
      name: cleanText(venue.name ?? venue.venue ?? event.venueName ?? "Los Angeles"),
      city: cleanText(venue.city ?? event.city ?? "Los Angeles"),
      state: cleanText(venue.state ?? venue.stateCode ?? event.state ?? "CA"),
      lat: numberOrNull4(venue.lat ?? venue.latitude),
      lon: numberOrNull4(venue.lon ?? venue.longitude)
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
  if (!event || typeof event !== "object") return null;
  if (!isEventLike(event)) return null;
  return {
    ...event,
    sourceUrl: event.sourceUrl ?? event.url ?? event.link ?? pageUrl,
    url: event.url ?? event.link ?? event.sourceUrl ?? pageUrl
  };
}
function parseCardAttributes(fragment, pageUrl) {
  const value = (name) => {
    const match = fragment.match(new RegExp(`data-${name}=["']([^"']*)["']`, "i"));
    return match ? decodeHtml(match[1]) : "";
  };
  const title = value("title") || value("name");
  const startDate = value("start-date") || value("date");
  const url = value("event-url") || value("url") || pageUrl;
  const id = value("event-id") || value("id") || stableId(`${title}|${startDate}|${url}`);
  if (!title && !startDate) return null;
  return { id, name: title, startDate, url, venue: { name: value("venue") || "Los Angeles", city: "Los Angeles", state: "CA" } };
}
function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === "object" && Array.isArray(value["@graph"])) return value["@graph"].flatMap(flattenJsonLd);
  return value ? [value] : [];
}
function isEventLike(value) {
  if (!value || typeof value !== "object") return false;
  const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  return type.some((item) => /event/i.test(String(item))) || Boolean(value.startDate ?? value.start_date ?? value.startLocal) && Boolean(value.name ?? value.title);
}
function normalizePerformers(value, title) {
  const names = Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : item?.name ?? item?.artistName).filter(Boolean) : typeof value === "string" ? value.split(/\s*[,&]\s*/g) : [];
  const cleaned = names.map((name) => cleanPerformer(name)).filter(Boolean);
  if (cleaned.length) return uniquePerformers(cleaned);
  const fallback = cleanPerformer(title.replace(/\b(?:festival|presented by|sold out|buy tickets|sign up for waitlist)\b.*$/i, ""));
  return fallback ? [{ sourceId: null, name: fallback, primary: true, spotifyId: null }] : [];
}
function uniquePerformers(names) {
  const seen = /* @__PURE__ */ new Set();
  return names.filter((name) => {
    const key = name.toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((name, index) => ({ sourceId: null, name, primary: index === 0, spotifyId: null }));
}
function cleanPerformer(value) {
  return cleanText(value).replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeStartLocal(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.replace(/([+-]\d{2}:?\d{2}|Z)$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00`;
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*[-+]\s*\d{1,2})?,?\s+(\d{4})\b/i);
  if (!match) return null;
  const parsed = /* @__PURE__ */ new Date(`${match[1]} ${match[2]}, ${match[3]} 00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}T00:00:00`;
}
function inDateWindow(value, startDate, endDate) {
  if (!value) return false;
  const date = String(normalizeStartLocal(value) ?? value).slice(0, 10);
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}
function hasTime(value) {
  return Boolean(value && /T\d{2}:\d{2}/.test(value) && !value.endsWith("T00:00:00"));
}
function isFestival(title, type) {
  return /festival/i.test(String(type ?? "")) || /festival/i.test(title);
}
function isChallengePage(html) {
  return /Just a moment|challenge-platform|Enable JavaScript and cookies to continue/i.test(String(html ?? ""));
}
function cleanText(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function decodeHtml(value) {
  return String(value ?? "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#x2F;|&#47;/gi, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function numberOrNull4(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function stableId(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `generated-${(hash >>> 0).toString(16)}`;
}

// ../src/candidates.js
var SOURCE_PRIORITY = { seatgeek: 3, ticketmaster: 2, framework: 1, insomniac: 1 };
function deduplicateCandidates(candidates, diagnostics = null) {
  const merged = [];
  if (diagnostics) {
    diagnostics.inputCount = candidates.length;
    diagnostics.mergedCount = 0;
    diagnostics.venueAliasUse = 0;
  }
  for (const candidate of candidates) {
    const match = merged.find((existing) => sameOccurrence(existing, candidate));
    if (!match) {
      merged.push({
        ...candidate,
        sourceOccurrences: sourceOccurrencesFor(candidate)
      });
      continue;
    }
    if (diagnostics) {
      diagnostics.mergedCount += 1;
      if (normalizeArtistName(match.venue?.name) !== normalizeArtistName(candidate.venue?.name)) {
        diagnostics.venueAliasUse += 1;
      }
    }
    mergeInto(match, candidate);
  }
  if (diagnostics) {
    diagnostics.canonicalCount = merged.length;
    diagnostics.sourceOccurrenceCount = merged.reduce((sum, candidate) => sum + (candidate.sourceOccurrences?.length ?? 0), 0);
  }
  return merged;
}
function sameOccurrence(left, right) {
  if (occurrenceClass(left.type) !== occurrenceClass(right.type) || localDate(left.startLocal) !== localDate(right.startLocal)) return false;
  const leftPerformers = new Set(left.performers.map((performer) => normalizeArtistName(performer.name)).filter(Boolean));
  const performerOverlap = right.performers.some((performer) => leftPerformers.has(normalizeArtistName(performer.name)));
  const titleLeft = canonicalEventTitle(left.title);
  const titleRight = canonicalEventTitle(right.title);
  const titleMatch = titleLeft === titleRight || titleLeft.length > 8 && titleRight.length > 8 && (titleLeft.includes(titleRight) || titleRight.includes(titleLeft));
  if (!performerOverlap && !titleMatch) return false;
  const venueMatch = sameVenue(left.venue, right.venue);
  const sameCity = normalizeArtistName(left.venue.city) && normalizeArtistName(left.venue.city) === normalizeArtistName(right.venue.city);
  const sameCityFestival = sameCity && titleMatch && titleLeft.includes("festival");
  if (!venueMatch && !(sameCity && performerOverlap) && !sameCityFestival) return false;
  const timeDelta = Math.abs(new Date(left.startLocal).getTime() - new Date(right.startLocal).getTime());
  return Number.isNaN(timeDelta) || timeDelta <= 4 * 60 * 60 * 1e3;
}
function occurrenceClass(type) {
  const normalized = normalizeArtistName(type);
  if (normalized.includes("concert") || normalized.includes("music") || normalized.includes("festival")) return "music";
  return normalized;
}
function canonicalEventTitle(value) {
  return normalizeArtistName(value).replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/g, "").replace(/\bwith\b.*$/g, "").replace(/\bpresents?\b/g, "").replace(/\s+/g, " ").trim();
}
function sameVenue(left, right) {
  if (Number.isFinite(left.lat) && Number.isFinite(left.lon) && Number.isFinite(right.lat) && Number.isFinite(right.lon)) {
    return distanceMiles2(left.lat, left.lon, right.lat, right.lon) <= 1.5;
  }
  const leftName = normalizeArtistName(left.name);
  const rightName = normalizeArtistName(right.name);
  return Boolean(leftName && rightName && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName)));
}
function mergeInto(target, incoming) {
  target.sourceOccurrences.push(...sourceOccurrencesFor(incoming));
  const performerKeys = new Set(target.performers.map((performer) => normalizeArtistName(performer.name)));
  for (const performer of incoming.performers) {
    if (!performerKeys.has(normalizeArtistName(performer.name))) target.performers.push(performer);
  }
  if ((SOURCE_PRIORITY[incoming.source] ?? 0) > (SOURCE_PRIORITY[target.source] ?? 0)) {
    for (const field of ["id", "source", "sourceEventId", "sourceUrl", "title", "startLocal", "startUtc", "timeTbd", "dateTbd", "status", "venue"]) {
      target[field] = incoming[field];
    }
  }
  if (target.ticketObservation.lowestPriceUsd == null) target.ticketObservation.lowestPriceUsd = incoming.ticketObservation.lowestPriceUsd;
}
function sourceOccurrencesFor(candidate) {
  const existing = Array.isArray(candidate.sourceOccurrences) && candidate.sourceOccurrences.length ? candidate.sourceOccurrences : [{ source: candidate.source, sourceEventId: candidate.sourceEventId, sourceUrl: candidate.sourceUrl }];
  return existing.map((occurrence) => ({
    ...occurrence,
    title: occurrence.title ?? candidate.title,
    startLocal: occurrence.startLocal ?? candidate.startLocal,
    venue: occurrence.venue ?? candidate.venue,
    performerNames: occurrence.performerNames ?? (candidate.performers ?? []).map((performer) => performer.name)
  }));
}
function localDate(value) {
  return String(value ?? "").slice(0, 10);
}
function distanceMiles2(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ../src/edmtrain.js
var EDMTRAIN_API_BASE_URL = "https://edmtrain.com/api/";
function buildEdmtrainUrl(path, params = {}) {
  const url = new URL(String(path).replace(/^\/+/, ""), EDMTRAIN_API_BASE_URL);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== "") url.searchParams.set(key, String(value));
  return url;
}
async function fetchEdmtrainEvents({ clientKey, startDate, endDate, city = "Los Angeles", state = "California", fetchImpl = fetch }) {
  if (!clientKey) throw new Error("EDMTRAIN_CLIENT_KEY is not configured");
  const locationsUrl = buildEdmtrainUrl("locations", { state, city, client: clientKey });
  const locations = await requestJson2(locationsUrl, fetchImpl);
  const location = unwrap(locations, ["locations", "data"]).find((item) => normalizeArtistName(item.city) === normalizeArtistName(city) && normalizeArtistName(item.state ?? item.stateName) === normalizeArtistName(state) && (!item.country || normalizeArtistName(item.country).includes("united states")));
  if (!location?.id) throw new Error(`EDMTrain location not found for ${city}, ${state}`);
  const eventsUrl = buildEdmtrainUrl("events", {
    locationIds: location.id,
    startDate,
    endDate,
    livestreamInd: false,
    includeElectronicGenreInd: true,
    includeOtherGenreInd: false,
    client: clientKey
  });
  const body = await requestJson2(eventsUrl, fetchImpl);
  return unwrap(body, ["events", "data"]).map(normalizeEdmtrainEvent).filter((event) => event.id && event.date);
}
function normalizeEdmtrainEvent(raw) {
  const artists = Array.isArray(raw.artistList) ? raw.artistList : [];
  let group = 0;
  const orderedArtists = artists.map((artist, index) => {
    const b2bWithNext = Boolean(artist.b2bInd);
    const entry = {
      lineupEntryId: `${raw.id ?? "event"}:${index}`,
      displayName: String(artist.name ?? artist.artistName ?? "").trim(),
      billingGroupIndex: group,
      b2bWithNext
    };
    if (!b2bWithNext) group += 1;
    return entry;
  }).filter((artist) => artist.displayName);
  return {
    id: String(raw.id ?? ""),
    sourceUrl: raw.link ? String(raw.link) : null,
    name: String(raw.name ?? raw.eventName ?? "").trim(),
    date: String(raw.date ?? raw.eventDate ?? "").slice(0, 10),
    ages: raw.ages ? String(raw.ages) : null,
    festival: Boolean(raw.festivalInd),
    venue: {
      name: String(raw.venue?.name ?? raw.venueName ?? "").trim(),
      city: String(raw.venue?.location?.city ?? raw.venue?.city ?? "").trim(),
      lat: finite(raw.venue?.latitude ?? raw.venue?.lat),
      lon: finite(raw.venue?.longitude ?? raw.venue?.lon)
    },
    orderedArtists
  };
}
function enrichEventsWithEdmtrain(events, edmEvents, artistSnapshot) {
  const audit = [];
  let matchedCount = 0;
  let ambiguousCount = 0;
  let lineupArtistCount = 0;
  for (const edm of edmEvents) {
    const candidates = events.filter((event2) => localDate2(event2.startLocal) === edm.date).map((event2) => ({ event: event2, rule: matchRule(event2, edm) })).filter((item) => item.rule);
    if (candidates.length !== 1) {
      if (candidates.length > 1) ambiguousCount += 1;
      audit.push({ edmtrainEventId: edm.id, status: candidates.length ? "ambiguous" : "unmatched", candidateCount: candidates.length });
      continue;
    }
    const { event, rule } = candidates[0];
    const resolved = resolveLineup(edm.orderedArtists, artistSnapshot);
    const existing = new Set(event.performers.map((performer) => normalizeArtistName(performer.name)));
    for (const artist of resolved.filter((item) => item.relation !== "unknown")) {
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
      directCount: resolved.filter((item) => item.relation === "direct").length,
      adjacentCount: resolved.filter((item) => item.relation === "adjacent").length,
      ages: edm.ages,
      sourceUrl: edm.sourceUrl
    };
    matchedCount += 1;
    lineupArtistCount += resolved.length;
    audit.push({ edmtrainEventId: edm.id, canonicalEventId: event.id, status: "matched", rule, lineupCount: resolved.length });
  }
  return { events, audit, matchedCount, ambiguousCount, unmatchedCount: audit.filter((item) => item.status === "unmatched").length, lineupArtistCount };
}
function matchRule(event, edm) {
  const venue = sameVenue2(event.venue, edm.venue);
  const title = exactUsefulTitle(event.title, edm.name);
  const eventArtists = new Set(event.performers.map((performer) => normalizeArtistName(performer.name)).filter(Boolean));
  const overlap = edm.orderedArtists.some((artist) => eventArtists.has(normalizeArtistName(artist.displayName)));
  const primary = edm.orderedArtists[0] && eventArtists.has(normalizeArtistName(edm.orderedArtists[0].displayName));
  const coordinates = coordinateDistanceMeters(event.venue, edm.venue) <= 500;
  if (venue && overlap) return "A";
  if (venue && title) return "B";
  if (coordinates && primary) return "C";
  if (edm.festival && title && (venue || coordinates)) return "D";
  return null;
}
function resolveLineup(entries, snapshot) {
  const artists = snapshot.artists ?? [];
  return entries.map((entry) => {
    const key = normalizeArtistName(entry.displayName);
    const matches = artists.filter((artist2) => [artist2.name, ...artist2.aliases ?? []].some((name) => normalizeArtistName(name) === key));
    const artist = matches.length === 1 ? matches[0] : null;
    const relation = !artist ? "unknown" : ["source", "top-items"].includes(artist.origin ?? "source") ? "direct" : "adjacent";
    return { ...entry, relation };
  });
}
function displayShape(edm, event) {
  if (edm.festival) return "festival";
  if (edm.orderedArtists.some((artist) => artist.b2bWithNext)) return "b2b";
  if (edm.name && !edm.orderedArtists.length) return "named-event";
  const venue = normalizeArtistName(event.venue?.name);
  if (/arena|hall|theatre|theater|dome/.test(venue)) return "arena-hall";
  if (/club|lounge/.test(venue) || edm.ages) return "club-show";
  return "general-show";
}
function exactUsefulTitle(left, right) {
  const a = canonicalEventTitle(left);
  const b = canonicalEventTitle(right);
  return Boolean(a && b && a.length >= 5 && a === b);
}
function sameVenue2(left = {}, right = {}) {
  const a = normalizeArtistName(left.name);
  const b = normalizeArtistName(right.name);
  return Boolean(a && b && (a === b || a.length > 8 && b.length > 8 && (a.includes(b) || b.includes(a))));
}
function coordinateDistanceMeters(left = {}, right = {}) {
  if (![left.lat, left.lon, right.lat, right.lon].every(Number.isFinite)) return Infinity;
  const radians = Math.PI / 180;
  const dLat = (right.lat - left.lat) * radians;
  const dLon = (right.lon - left.lon) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(left.lat * radians) * Math.cos(right.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function requestJson2(url, fetchImpl) {
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
function localDate2(value) {
  return String(value ?? "").slice(0, 10);
}

// ../src/mlb.js
var MLB_GAMEDAY_ROOT = "https://www.mlb.com/gameday";
async function fetchDodgersHomeGames({
  teamId = 119,
  startDate,
  endDate,
  homeVenueIds = [],
  season = null,
  timezone = "America/Los_Angeles",
  fetchImpl = fetch
} = {}) {
  if (!startDate || !endDate) throw new Error("MLB schedule requires startDate and endDate.");
  const url = new URL("/api/v1/schedule", "https://statsapi.mlb.com");
  url.searchParams.set("sportId", "1");
  url.searchParams.set("teamId", String(teamId));
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("hydrate", "team,venue,seriesStatus,probablePitcher");
  url.searchParams.set("includeSeriesNumber", "true");
  if (season != null) url.searchParams.set("season", String(season));
  const body = await requestJson3(url, fetchImpl, "schedule");
  const games = (body.dates ?? []).flatMap((date) => date.games ?? []);
  return games.filter((game) => isHomeGame(game, teamId, homeVenueIds)).map((game) => normalizeMlbGame(game, { timezone, teamId }));
}
async function fetchMlbStandings({
  season,
  leagueIds = ["103", "104"],
  fetchImpl = fetch
} = {}) {
  const url = new URL("/api/v1/standings", "https://statsapi.mlb.com");
  url.searchParams.set("leagueId", leagueIds.join(","));
  url.searchParams.set("standingsTypes", "regularSeason");
  url.searchParams.set("hydrate", "team");
  if (season != null) url.searchParams.set("season", String(season));
  const body = await requestJson3(url, fetchImpl, "standings");
  return normalizeStandings(body);
}
async function fetchMlbPitcherStats(pitcherIds, {
  season,
  maxPitchers = 48,
  fetchImpl = fetch,
  concurrency = 4
} = {}) {
  const ids = [...new Set((pitcherIds ?? []).map(String).filter(Boolean))].slice(0, maxPitchers);
  const result = /* @__PURE__ */ new Map();
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const url = new URL(`/api/v1/people/${encodeURIComponent(id)}`, "https://statsapi.mlb.com");
        url.searchParams.set("hydrate", `stats(group=pitching,type=season${season != null ? `,season=${season}` : ""})`);
        const body = await requestJson3(url, fetchImpl, `pitcher stats ${id}`);
        const person = body.people?.[0];
        const split = person?.stats?.flatMap((item) => item.splits ?? [])?.[0];
        const stat = split?.stat;
        if (person && stat) result.set(id, {
          id,
          name: person.fullName ?? null,
          era: numberOrNull5(stat.era),
          whip: numberOrNull5(stat.whip),
          strikeoutsPer9: numberOrNull5(stat.strikeoutsPer9Inn),
          inningsPitched: numberOrNull5(String(stat.inningsPitched ?? "").replace(/[^0-9.]/g, "")),
          wins: numberOrNull5(stat.wins),
          losses: numberOrNull5(stat.losses),
          season: split.season ?? season ?? null
        });
      } catch {
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return result;
}
function normalizeMlbGame(game, { timezone = "America/Los_Angeles", teamId = 119, retrievedAt = /* @__PURE__ */ new Date() } = {}) {
  const home = game.teams?.home ?? {};
  const away = game.teams?.away ?? {};
  const homeTeam = normalizeTeam(home.team);
  const awayTeam = normalizeTeam(away.team);
  const venue = game.venue ?? home.team?.venue ?? {};
  const season = game.season ?? game.seasonDisplay ?? null;
  const seriesNumber = game.seriesNumber ?? home.seriesNumber ?? away.seriesNumber ?? null;
  const seriesId = season != null && seriesNumber != null ? `mlb:${season}:${seriesNumber}:${Math.min(Number(homeTeam.id ?? teamId), Number(awayTeam.id ?? 0))}:${Math.max(Number(homeTeam.id ?? teamId), Number(awayTeam.id ?? 0))}` : null;
  return {
    schemaVersion: 1,
    id: `mlb:${game.gamePk}`,
    source: "mlb",
    sourceEventId: String(game.gamePk),
    sourceUrl: `${MLB_GAMEDAY_ROOT}/${game.gamePk}`,
    retrievedAt: new Date(retrievedAt).toISOString(),
    title: `${awayTeam.name ?? "Away"} at ${homeTeam.name ?? "Home"}`,
    type: "baseball",
    startLocal: game.gameDate ? toLocalIso(game.gameDate, timezone) : null,
    startUtc: game.gameDate ?? null,
    timeTbd: Boolean(game.status?.startTimeTBD),
    dateTbd: !game.officialDate,
    status: game.status?.detailedState ?? "Scheduled",
    venue: {
      sourceId: venue.id == null ? null : String(venue.id),
      name: String(venue.name ?? "Dodger Stadium").trim(),
      city: "Los Angeles",
      state: "CA",
      lat: numberOrNull5(venue.location?.latitude ?? venue.geoLocation?.latitude),
      lon: numberOrNull5(venue.location?.longitude ?? venue.geoLocation?.longitude)
    },
    homeTeam,
    awayTeam,
    series: {
      id: seriesId,
      gameNumber: numberOrNull5(game.seriesStatus?.gameNumber ?? game.seriesGameNumber ?? game.gameNumber),
      gameCount: numberOrNull5(game.seriesStatus?.totalGames ?? game.gamesInSeries)
    },
    probablePitchers: {
      home: normalizePitcher(home.probablePitcher),
      away: normalizePitcher(away.probablePitcher),
      confirmed: Boolean(home.probablePitcher?.id && away.probablePitcher?.id)
    },
    ticketObservations: [],
    sourceOccurrences: [{
      source: "mlb",
      sourceEventId: String(game.gamePk),
      sourceUrl: `${MLB_GAMEDAY_ROOT}/${game.gamePk}`,
      title: `${awayTeam.name ?? "Away"} at ${homeTeam.name ?? "Home"}`,
      startLocal: game.gameDate ? toLocalIso(game.gameDate, timezone) : null,
      venue: {
        name: String(venue.name ?? "Dodger Stadium").trim(),
        city: "Los Angeles",
        state: "CA"
      },
      performerNames: [awayTeam.name, homeTeam.name].filter(Boolean)
    }]
  };
}
function normalizeStandings(body) {
  const standings = /* @__PURE__ */ new Map();
  for (const record of body.records ?? []) {
    for (const teamRecord of record.teamRecords ?? []) {
      const team = normalizeTeam(teamRecord.team);
      const lastTen = (teamRecord.records?.splitRecords ?? []).find((split) => split.type === "lastTen");
      standings.set(String(team.id), {
        team,
        leagueRank: numberOrNull5(teamRecord.leagueRank),
        divisionRank: numberOrNull5(teamRecord.divisionRank),
        wins: numberOrNull5(teamRecord.wins ?? teamRecord.leagueRecord?.wins),
        losses: numberOrNull5(teamRecord.losses ?? teamRecord.leagueRecord?.losses),
        winPct: numberOrNull5(teamRecord.winningPercentage ?? teamRecord.leagueRecord?.pct),
        lastTen: lastTen ? `${lastTen.wins}-${lastTen.losses}` : null,
        streak: teamRecord.streak?.streakCode ?? null,
        gamesBack: numberOrNull5(teamRecord.gamesBack),
        division: team.division,
        league: team.league
      });
    }
  }
  return standings;
}
function normalizeTeam(team = {}) {
  return {
    id: team.id == null ? null : String(team.id),
    name: String(team.name ?? "").trim(),
    shortName: String(team.shortName ?? team.teamName ?? "").trim(),
    abbreviation: String(team.abbreviation ?? "").trim(),
    league: team.league ? { id: String(team.league.id), name: String(team.league.name ?? "") } : null,
    division: team.division ? { id: String(team.division.id), name: String(team.division.name ?? "") } : null
  };
}
function normalizePitcher(pitcher) {
  if (!pitcher?.id && !pitcher?.fullName) return null;
  return {
    id: pitcher.id == null ? null : String(pitcher.id),
    name: String(pitcher.fullName ?? "").trim(),
    era: null,
    whip: null,
    strikeoutsPer9: null,
    inningsPitched: null
  };
}
function applyPitcherStats(games, stats) {
  return games.map((game) => {
    const pitcherStats = (pitcher) => pitcher ? { ...pitcher, ...stats.get(String(pitcher.id)) ?? {} } : null;
    return {
      ...game,
      probablePitchers: {
        home: pitcherStats(game.probablePitchers?.home),
        away: pitcherStats(game.probablePitchers?.away),
        confirmed: game.probablePitchers?.confirmed ?? false
      }
    };
  });
}
function isHomeGame(game, teamId, homeVenueIds) {
  if (String(game.teams?.home?.team?.id ?? "") !== String(teamId)) return false;
  if (!homeVenueIds?.length) return true;
  return homeVenueIds.map(String).includes(String(game.venue?.id ?? game.teams?.home?.team?.venue?.id ?? ""));
}
function toLocalIso(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const offset = String(values.timeZoneName ?? "GMT").replace(/^GMT/, "") || "+00:00";
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}${offset}`;
}
async function requestJson3(url, fetchImpl, context) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`MLB ${context} request failed (${response.status}).`);
  return response.json();
}
function numberOrNull5(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ../src/sports.js
var SEATGEEK_EVENTS_URL = "https://api.seatgeek.com/2/events";
var TICKETMASTER_EVENTS_URL = "https://app.ticketmaster.com/discovery/v2/events.json";
async function fetchSeatGeekSportsEvents({
  clientId,
  startDate,
  endDate,
  config,
  maxPages = 3,
  fetchImpl = fetch
} = {}) {
  if (!clientId) throw new Error("SEATGEEK_CLIENT_ID is not configured.");
  const events = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(SEATGEEK_EVENTS_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("q", config.teamName ?? "Los Angeles Dodgers");
    url.searchParams.set("taxonomies.name", "baseball");
    url.searchParams.set("lat", String(config.home?.lat ?? 34.0522));
    url.searchParams.set("lon", String(config.home?.lon ?? -118.2437));
    url.searchParams.set("range", `${config.searchRadiusMiles ?? 60}mi`);
    url.searchParams.set("datetime_local.gte", startDate);
    url.searchParams.set("datetime_local.lte", `${endDate}T23:59:59`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "datetime_local.asc");
    const body = await requestJson4(url, fetchImpl, "SeatGeek sports");
    const pageEvents = Array.isArray(body.events) ? body.events : [];
    events.push(...pageEvents);
    if (!pageEvents.length || pageEvents.length < 100 || events.length >= Number(body.meta?.total ?? 0)) break;
  }
  return events;
}
async function fetchTicketmasterSportsEvents({
  apiKey,
  startDate,
  endDate,
  config,
  maxPages = 3,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY is not configured.");
  const events = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(TICKETMASTER_EVENTS_URL);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("classificationName", "Sports");
    url.searchParams.set("keyword", config.teamName ?? "Los Angeles Dodgers");
    url.searchParams.set("latlong", `${config.home?.lat ?? 34.0522},${config.home?.lon ?? -118.2437}`);
    url.searchParams.set("radius", String(config.searchRadiusMiles ?? 60));
    url.searchParams.set("unit", "miles");
    url.searchParams.set("startDateTime", `${startDate}T00:00:00Z`);
    url.searchParams.set("endDateTime", `${endDate}T23:59:59Z`);
    url.searchParams.set("includeTBA", "yes");
    url.searchParams.set("includeTBD", "yes");
    url.searchParams.set("size", "200");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "date,asc");
    const body = await requestJson4(url, fetchImpl, "Ticketmaster sports");
    const pageEvents = body._embedded?.events ?? [];
    events.push(...pageEvents);
    if (!pageEvents.length || page + 1 >= Number(body.page?.totalPages ?? 0)) break;
  }
  return events;
}
function normalizeSeatGeekSportsEvent(event, retrievedAt = /* @__PURE__ */ new Date()) {
  const venue = event.venue ?? {};
  const names = (event.performers ?? []).map((performer) => performer.name ?? performer.short_name).filter(Boolean);
  return {
    source: "seatgeek",
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ""),
    title: String(event.title ?? event.short_title ?? "").trim(),
    startLocal: event.datetime_local ?? null,
    venue: normalizeTicketVenue(venue),
    teamNames: [...names, event.title ?? ""].filter(Boolean),
    ticketObservation: {
      source: "seatgeek",
      sourceEventId: String(event.id),
      url: String(event.url ?? ""),
      lowestPriceUsd: numberOrNull6(event.stats?.lowest_price),
      averagePriceUsd: numberOrNull6(event.stats?.average_price),
      listingCount: numberOrNull6(event.stats?.listing_count),
      status: event.status ?? "scheduled",
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}
function normalizeTicketmasterSportsEvent(event, retrievedAt = /* @__PURE__ */ new Date()) {
  const venue = event._embedded?.venues?.[0] ?? {};
  const attractions = event._embedded?.attractions ?? [];
  const localDate3 = event.dates?.start?.localDate ?? null;
  const localTime = event.dates?.start?.localTime ?? "00:00:00";
  const names = attractions.map((attraction) => attraction.name).filter(Boolean);
  return {
    source: "ticketmaster",
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ""),
    title: String(event.name ?? "").trim(),
    startLocal: localDate3 ? `${localDate3}T${localTime}` : null,
    venue: normalizeTicketVenue(venue),
    teamNames: [...names, event.name ?? ""].filter(Boolean),
    ticketObservation: {
      source: "ticketmaster",
      sourceEventId: String(event.id),
      url: String(event.url ?? ""),
      lowestPriceUsd: numberOrNull6(event.priceRanges?.[0]?.min),
      averagePriceUsd: null,
      listingCount: null,
      status: event.dates?.status?.code ?? "scheduled",
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}
function enrichSportsGames(games, standings, config, {
  now = /* @__PURE__ */ new Date(),
  pitcherStats = /* @__PURE__ */ new Map()
} = {}) {
  return games.map((game) => {
    const opponent = standings.get(String(game.awayTeam?.id));
    const rivalry = config.rivalries?.[String(game.awayTeam?.id)] ?? { tier: "none", label: null };
    const sportsContext = {
      opponentWinPct: opponent?.winPct ?? null,
      opponentLeagueRank: opponent?.leagueRank ?? null,
      opponentDivisionRank: opponent?.divisionRank ?? null,
      opponentLast10: opponent?.lastTen ?? null,
      opponentStreak: opponent?.streak ?? null,
      rivalryTier: rivalry.tier,
      probablePitchers: {
        home: mergePitcherStats(game.probablePitchers?.home, pitcherStats),
        away: mergePitcherStats(game.probablePitchers?.away, pitcherStats),
        confirmed: game.probablePitchers?.confirmed ?? false
      },
      playoffLeverage: playoffLeverage(game.startLocal, opponent)
    };
    const tags = sportsTags(game, opponent, rivalry, sportsContext);
    const ranking = scoreSportsGame({ ...game, sportsContext, tags }, config, now);
    return { ...game, sportsContext, tags, ranking };
  });
}
function scoreSportsGame(game, config, now = /* @__PURE__ */ new Date()) {
  const opponentQuality = opponentQualityScore(game.sportsContext);
  const rivalryScore = { high: 15, medium: 8, low: 3, none: 0 }[game.sportsContext?.rivalryTier] ?? 0;
  const pitchingScore = pitchingMatchupScore(game.sportsContext?.probablePitchers);
  const leverageScore = { high: 10, medium: 6, low: 2, unknown: 0 }[game.sportsContext?.playoffLeverage] ?? 0;
  const convenienceScore = dateConvenience(game.startLocal);
  const hassleScore = sportsHassle(game, config);
  const interestScore = Math.min(100, 35 + opponentQuality + rivalryScore + pitchingScore + leverageScore + convenienceScore);
  const urgency = sportsTicketUrgency(game.ticketObservations ?? [], game.startLocal, now);
  const confidence = game.sportsContext?.opponentWinPct == null ? "medium" : game.sportsContext.probablePitchers.confirmed ? "high" : "medium";
  const whyYou = sportsWhyYou(game, { opponentQuality, rivalryScore, pitchingScore, leverageScore, convenienceScore, hassleScore });
  return {
    excluded: false,
    interestScore,
    utility: interestScore - hassleScore * 2,
    opponentQuality,
    rivalryScore,
    pitchingScore,
    leverageScore,
    convenienceScore,
    hassleScore,
    hassleReasons: sportsHassleReasons(game, config),
    urgency,
    confidence,
    whyYou
  };
}
function sportsWhyYou(game, { opponentQuality, rivalryScore, pitchingScore, leverageScore, convenienceScore, hassleScore }) {
  const date = game.startLocal ? new Date(game.startLocal) : null;
  const day = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { weekday: "long" }) : null;
  const friction = hassleScore <= 4 ? "Low-hassle" : hassleScore <= 6 ? "Manageable" : "Higher-hassle";
  const reasons = [];
  if (rivalryScore >= 15) reasons.push(`${game.awayTeam.shortName || game.awayTeam.name} rivalry`);
  else if (opponentQuality >= 8) reasons.push("a stronger-than-usual matchup");
  if (pitchingScore >= 7) reasons.push("a strong pitching matchup");
  if (leverageScore >= 6) reasons.push("useful late-season leverage");
  if (!reasons.length && convenienceScore >= 8) reasons.push("a good weekend timing window");
  if (!reasons.length) reasons.push("a worthwhile Dodgers home-game setup");
  return `${friction} ${day ? `${day} ` : ""}game with ${joinReasons(reasons)}.`;
}
function joinReasons(reasons) {
  if (reasons.length === 1) return reasons[0];
  if (reasons.length === 2) return `${reasons[0]} and ${reasons[1]}`;
  return `${reasons.slice(0, -1).join(", ")}, and ${reasons.at(-1)}`;
}
function joinSportsTickets(games, ticketEvents, config, now = /* @__PURE__ */ new Date()) {
  return games.map((game) => {
    const matches = ticketEvents.filter((ticket) => ticketMatchesGame(ticket, game));
    const observations = dedupeObservations(matches.map((ticket) => ticket.ticketObservation));
    const sourceOccurrences = [
      ...game.sourceOccurrences ?? [],
      ...observations.map((observation) => ({
        source: observation.source,
        sourceEventId: observation.sourceEventId,
        sourceUrl: observation.url
      }))
    ];
    const next = { ...game, ticketObservations: observations, sourceOccurrences };
    return { ...next, ranking: scoreSportsGame(next, config, now) };
  });
}
function sportsTicketUrgency(observations, startLocal, now = /* @__PURE__ */ new Date()) {
  if (!observations?.length) return "unknown";
  if (observations.some((observation) => /sold|cancel/i.test(String(observation.status)))) return "likely unavailable";
  const listingCount = observations.map((observation) => observation.listingCount).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
  const days = daysUntil(startLocal, now);
  if (listingCount != null && listingCount <= 10) return "buy now";
  if (days != null && days <= 7) return "watch";
  return "safe to wait";
}
function ticketMatchesGame(ticket, game) {
  if (!ticket.startLocal || !game.startLocal || ticket.startLocal.slice(0, 10) !== game.startLocal.slice(0, 10)) return false;
  if (!venueMatches(ticket.venue, game.venue)) return false;
  const haystack = normalizeTeamText([ticket.title, ...ticket.teamNames ?? []].join(" "));
  if (!teamMatches(haystack, game.homeTeam)) return false;
  const opponentKnown = teamMatches(haystack, game.awayTeam);
  const anyOpponentMentioned = game.awayTeam?.name && normalizeTeamText(haystack).includes(normalizeTeamText(game.awayTeam.name).split(" ")[0]);
  return opponentKnown || !anyOpponentMentioned;
}
function sportsTags(game, opponent, rivalry, context) {
  const tags = [];
  if (rivalry.label) tags.push(`${game.awayTeam.shortName || game.awayTeam.name} rivalry`);
  if (opponent?.divisionRank === 1) tags.push(`${opponent.division?.name ?? "Division"} leader`);
  if (opponent?.leagueRank != null && opponent.leagueRank <= 5) tags.push("Contending opponent");
  if (context.probablePitchers.confirmed && pitchingMatchupScore(context.probablePitchers) >= 7) tags.push("Strong pitching matchup");
  if (context.playoffLeverage === "high") tags.push("Late-season leverage");
  if ([0, 6].includes(new Date(game.startLocal).getDay())) tags.push("Weekend game");
  return tags;
}
function opponentQualityScore(context = {}) {
  if (Number.isFinite(context.opponentLeagueRank)) return Math.max(0, Math.min(20, Math.round(20 - (context.opponentLeagueRank - 1) * 1.25)));
  if (Number.isFinite(context.opponentWinPct)) return Math.max(0, Math.min(20, Math.round((context.opponentWinPct - 0.35) * 66.67)));
  return 0;
}
function pitchingMatchupScore(pitchers = {}) {
  const quality = (pitcher) => {
    if (!pitcher) return 0;
    if (pitcher.era == null && pitcher.whip == null) return 1;
    let score = 0;
    if (pitcher.era != null) score += pitcher.era <= 3 ? 3 : pitcher.era <= 4 ? 2 : 1;
    if (pitcher.whip != null) score += pitcher.whip <= 1.1 ? 2 : pitcher.whip <= 1.3 ? 1 : 0;
    return Math.min(5, score);
  };
  return Math.min(10, quality(pitchers.home) + quality(pitchers.away));
}
function playoffLeverage(startLocal, opponent) {
  if (!opponent) return "unknown";
  const month = Number(String(startLocal ?? "").slice(5, 7));
  if (month >= 9 && (opponent.divisionRank <= 2 || opponent.gamesBack != null && opponent.gamesBack <= 5)) return "high";
  if (opponent.divisionRank <= 2 || opponent.gamesBack != null && opponent.gamesBack <= 5) return "medium";
  return "low";
}
function dateConvenience(startLocal) {
  const date = new Date(startLocal);
  if (Number.isNaN(date.getTime())) return 0;
  const day = date.getDay();
  if (day === 0 || day === 6) return 10;
  if (day === 5) return 8;
  return 4;
}
function sportsHassle(game, config) {
  let score = 4;
  if (!game.ticketObservations?.length) score += 1;
  if (game.timeTbd || game.dateTbd) score += 2;
  if (config.homeVenueNames?.length && !config.homeVenueNames.some((name) => normalizeTeamText(game.venue.name).includes(normalizeTeamText(name)))) score += 1;
  return Math.min(10, score);
}
function sportsHassleReasons(game, config) {
  const reasons = ["Dodger Stadium logistics"];
  if (!game.ticketObservations?.length) reasons.push("ticket coverage unknown");
  if (game.timeTbd || game.dateTbd) reasons.push("time or date is TBD");
  if (config.homeVenueNames?.length && !config.homeVenueNames.some((name) => normalizeTeamText(game.venue.name).includes(normalizeTeamText(name)))) reasons.push("venue confirmation pending");
  return reasons;
}
function mergePitcherStats(pitcher, stats) {
  return pitcher ? { ...pitcher, ...stats.get(String(pitcher.id)) ?? {} } : null;
}
function ticketObservationKey(observation) {
  return `${observation.source}|${observation.sourceEventId}|${observation.url}`;
}
function dedupeObservations(observations) {
  return [...new Map(observations.filter(Boolean).map((observation) => [ticketObservationKey(observation), observation])).values()];
}
function venueMatches(left = {}, right = {}) {
  if (Number.isFinite(left.lat) && Number.isFinite(left.lon) && Number.isFinite(right.lat) && Number.isFinite(right.lon)) {
    return distanceMiles3(left.lat, left.lon, right.lat, right.lon) <= 3;
  }
  const leftName = normalizeTeamText(left.name);
  const rightName = normalizeTeamText(right.name);
  return Boolean(leftName && rightName && (leftName.includes(rightName) || rightName.includes(leftName) || leftName.includes("dodger") && rightName.includes("dodger")));
}
function teamMatches(haystack, team = {}) {
  const aliases = new Set([
    normalizeTeamText(team.name),
    normalizeTeamText(team.shortName),
    normalizeTeamText(team.abbreviation),
    ...(team.name ?? "").toLowerCase().split(/\s+/).slice(-1)
  ].filter(Boolean));
  return [...aliases].some((alias) => alias.length >= 3 && haystack.includes(alias));
}
function normalizeTeamText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(the|los|la)\b/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeTicketVenue(venue = {}) {
  return {
    sourceId: venue.id == null ? null : String(venue.id),
    name: String(venue.name ?? "").trim(),
    city: String(venue.city?.name ?? venue.city ?? "").trim(),
    state: String(venue.state?.stateCode ?? venue.state ?? "").trim(),
    lat: numberOrNull6(venue.location?.latitude ?? venue.location?.lat),
    lon: numberOrNull6(venue.location?.longitude ?? venue.location?.lon)
  };
}
function distanceMiles3(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function daysUntil(startLocal, now) {
  const date = new Date(startLocal);
  return Number.isNaN(date.getTime()) ? null : Math.ceil((date.getTime() - now.getTime()) / 864e5);
}
async function requestJson4(url, fetchImpl, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
  return response.json();
}
function numberOrNull6(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ../src/tmdb.js
var DISCOVER_URL = "https://api.themoviedb.org/3/discover/movie";
async function fetchUpcomingMovies({
  accessToken,
  apiKey,
  startDate,
  endDate,
  maxPages = 5,
  fetchImpl = fetch
}) {
  const auth = resolveTmdbAuth(accessToken, apiKey);
  if (!auth.accessToken && !auth.apiKey) throw new Error("TMDB_ACCESS_TOKEN or TMDB_API_KEY is not configured.");
  const movies = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(DISCOVER_URL);
    url.searchParams.set("language", "en-US");
    url.searchParams.set("region", "US");
    url.searchParams.set("include_adult", "false");
    url.searchParams.set("include_video", "false");
    url.searchParams.set("with_release_type", "2|3");
    url.searchParams.set("release_date.gte", startDate);
    url.searchParams.set("release_date.lte", endDate);
    url.searchParams.set("sort_by", "popularity.desc");
    url.searchParams.set("page", String(page));
    if (auth.apiKey) url.searchParams.set("api_key", auth.apiKey);
    const headers = auth.accessToken ? { authorization: `Bearer ${auth.accessToken}`, accept: "application/json" } : { accept: "application/json" };
    const response = await fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`TMDB request failed (${response.status}).`);
    const body = await response.json();
    movies.push(...Array.isArray(body.results) ? body.results : []);
    if (page >= Number(body.total_pages ?? 1)) break;
  }
  return movies;
}
async function enrichMovieMetadata(movies, {
  accessToken,
  apiKey,
  limit = 40,
  concurrency = 4,
  fetchImpl = fetch
}) {
  const auth = resolveTmdbAuth(accessToken, apiKey);
  const selected = movies.slice(0, limit);
  const output = new Array(selected.length);
  let next = 0;
  async function worker() {
    while (next < selected.length) {
      const index = next;
      next += 1;
      const movie = selected[index];
      const url = new URL(`https://api.themoviedb.org/3/movie/${movie.id}`);
      url.searchParams.set("language", "en-US");
      url.searchParams.set("append_to_response", "credits,keywords,release_dates");
      if (auth.apiKey) url.searchParams.set("api_key", auth.apiKey);
      const headers = auth.accessToken ? { authorization: `Bearer ${auth.accessToken}`, accept: "application/json" } : { accept: "application/json" };
      const response = await fetchImpl(url, { headers });
      if (!response.ok) throw new Error(`TMDB movie metadata request failed (${response.status}).`);
      output[index] = { ...movie, ...await response.json() };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  return output;
}
function resolveTmdbAuth(accessToken, apiKey) {
  const token = String(accessToken ?? "").trim().replace(/^Bearer\s+/i, "");
  const key = String(apiKey ?? "").trim();
  if (key) return { accessToken: token || null, apiKey: key };
  if (/^[a-f0-9]{32}$/i.test(token)) return { accessToken: null, apiKey: token };
  return { accessToken: token || null, apiKey: null };
}
function normalizeTmdbMovie(movie, retrievedAt = /* @__PURE__ */ new Date()) {
  const crew = movie.credits?.crew ?? [];
  const usRelease = (movie.release_dates?.results ?? []).find((item) => item.iso_3166_1 === "US");
  return {
    id: `tmdb:${movie.id}`,
    source: "tmdb",
    sourceUrl: `https://www.themoviedb.org/movie/${movie.id}`,
    retrievedAt: new Date(retrievedAt).toISOString(),
    title: String(movie.title ?? movie.original_title ?? "").trim(),
    releaseDate: movie.release_date || null,
    overview: String(movie.overview ?? "").trim(),
    popularity: Number(movie.popularity) || 0,
    voteAverage: Number(movie.vote_average) || 0,
    runtimeMinutes: Number(movie.runtime) || null,
    genres: (movie.genres ?? []).map((genre) => genre.name).filter(Boolean),
    directors: crew.filter((person) => person.job === "Director").map((person) => person.name),
    cinematographers: crew.filter((person) => person.job === "Director of Photography").map((person) => person.name),
    cast: (movie.credits?.cast ?? []).slice(0, 8).map((person) => person.name),
    companies: (movie.production_companies ?? []).map((company) => company.name),
    keywords: (movie.keywords?.keywords ?? []).map((keyword) => keyword.name),
    usReleaseDates: (usRelease?.release_dates ?? []).map((release) => ({
      date: release.release_date ?? null,
      type: release.type ?? null,
      note: release.note ?? ""
    })),
    posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    backdropUrl: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
    releaseType: "theatrical-candidate",
    premiumFormatConfirmed: false,
    format: null,
    theater: null,
    urgency: null,
    hassle: null,
    experienceScore: null,
    formatStatus: "verification pending"
  };
}

// ../src/movieSelection.js
var GENRES = /* @__PURE__ */ new Map([
  [12, "adventure"],
  [14, "fantasy"],
  [16, "animation"],
  [27, "horror"],
  [28, "action"],
  [53, "thriller"],
  [878, "science fiction"]
]);
function selectMovieCandidates(movies, config) {
  const preferred = new Set(config.preferredGenreIds ?? []);
  const excluded = new Set(config.excludedGenreIds ?? []);
  return movies.filter((movie) => !(movie.genre_ids ?? []).some((id) => excluded.has(id))).map((movie) => {
    const preferredGenres = (movie.genre_ids ?? []).filter((id) => preferred.has(id));
    const popularity = Number(movie.popularity) || 0;
    const names = new Set([
      ...(movie.credits?.crew ?? []).map((person) => person.name),
      ...(movie.credits?.cast ?? []).map((person) => person.name),
      ...(movie.production_companies ?? []).map((company) => company.name)
    ].map(normalize));
    const keywords = new Set((movie.keywords?.keywords ?? []).map((keyword) => normalize(keyword.name)));
    const profileMatches = [
      ...config.preferredDirectors ?? [],
      ...config.preferredCinematographers ?? [],
      ...config.preferredCast ?? [],
      ...config.preferredCompanies ?? []
    ].filter((name) => names.has(normalize(name)));
    const keywordMatches = (config.preferredKeywords ?? []).filter((keyword) => keywords.has(normalize(keyword)));
    const genreEvidence = profileMatches.length || keywordMatches.length ? preferredGenres : preferredGenres.filter((id) => id !== 16);
    const tasteTier = profileMatches.length || keywordMatches.length >= 2 ? "strong" : keywordMatches.length === 1 || genreEvidence.length >= 2 ? "potential" : "stretch";
    const qualifies = preferredGenres.length > 0 || popularity >= config.highPopularityOverride;
    const score = popularity + genreEvidence.length * 20 + profileMatches.length * 35 + keywordMatches.length * 12 + (Number(movie.vote_average) || 0) * 2;
    const reasons = [];
    if (profileMatches.length) reasons.push(`Taste-profile match: ${profileMatches.slice(0, 3).join(", ")}.`);
    if (keywordMatches.length) reasons.push(`Preferred film themes: ${keywordMatches.slice(0, 3).join(", ")}.`);
    if (preferredGenres.length) reasons.push(`Premium-format potential: ${preferredGenres.map((id) => GENRES.get(id) ?? `genre ${id}`).join(", ")}.`);
    if (!reasons.length) reasons.push("High-profile theatrical release worth checking for a premium-format engagement.");
    return {
      movie,
      qualifies: (qualifies || profileMatches.length > 0 || keywordMatches.length > 0) && popularity >= config.minimumPopularity,
      score,
      tasteTier,
      reasons
    };
  }).filter((item) => item.qualifies).sort((a, b) => tierRank(a.tasteTier) - tierRank(b.tasteTier) || b.score - a.score || String(a.movie.release_date).localeCompare(String(b.movie.release_date))).slice(0, config.maxCandidates);
}
function tierRank(tier) {
  return tier === "strong" ? 0 : tier === "potential" ? 1 : 2;
}
function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

// ../src/visuals.js
var TMDB_IMAGE_HOST = "image.tmdb.org";
var DEFAULT_FOCAL_POINT = Object.freeze({ x: 50, y: 50 });
function resolveMusicVisual(event = {}) {
  const title = String(event.title ?? "").toLowerCase();
  const venue = String(event.venue?.name ?? "").toLowerCase();
  const eventType = String(event.eventType ?? event.type ?? "").toLowerCase();
  if (eventType.includes("festival") || title.includes("festival")) {
    return textureVisual("music-crowd-silhouette", "Crowd and stage haze atmosphere", { x: 76, y: 52 });
  }
  if (eventType.includes("dj") || title.includes("open to close") || venue.includes("warehouse")) {
    return textureVisual("music-warehouse-beams", "Directional warehouse performance light", { x: 82, y: 48 });
  }
  if (/arena|hall|amphitheater|pavilion|theatre|theater/.test(venue)) {
    return textureVisual("music-architectural-light", "Architectural venue light", { x: 76, y: 46 });
  }
  return textureVisual("music-stage-haze", "Stage haze and directional performance light", { x: 78, y: 50 });
}
function resolveSportsVisual(game = {}) {
  const context = game.sportsContext ?? {};
  if (context.playoffLeverage === "high") {
    return textureVisual("sports-scoreboard-glow", "Restrained night-game scoreboard glow", { x: 84, y: 42 });
  }
  if (context.rivalryTier === "high") {
    return textureVisual("sports-field-lines", "Night-game field geometry", { x: 82, y: 58 });
  }
  const hour = localHour(game.startLocal);
  if (hour != null && hour >= 18) {
    return textureVisual("sports-night-game", "Stadium floodlights and dark stands", { x: 82, y: 42 });
  }
  return textureVisual("sports-stadium-lights", "Stadium light atmosphere", { x: 80, y: 50 });
}
function resolveMovieVisual(movie = {}) {
  const title = String(movie.title ?? "Movie").trim();
  const imageUrl = isAllowedTmdbImage(movie.backdropUrl) ? movie.backdropUrl : isAllowedTmdbImage(movie.posterUrl) ? movie.posterUrl : null;
  if (imageUrl) {
    return normalizeVisual({
      kind: "image",
      url: imageUrl,
      alt: `${title} film image`,
      focalPoint: { x: 72, y: 50 },
      variant: "movie-tmdb",
      attribution: "TMDB"
    });
  }
  if (title) return textureVisual("movie-projection-light", "Projection light and film grain", { x: 80, y: 50 });
  return { kind: "none" };
}
function normalizeVisual(visual) {
  if (!visual || typeof visual !== "object") return { kind: "none" };
  const kind = ["image", "texture", "none"].includes(visual.kind) ? visual.kind : "none";
  const normalized = { kind };
  if (visual.url && kind === "image") normalized.url = String(visual.url);
  if (visual.alt) normalized.alt = String(visual.alt);
  if (visual.variant) normalized.variant = String(visual.variant);
  if (visual.attribution) normalized.attribution = String(visual.attribution);
  if (kind !== "none") normalized.focalPoint = normalizeFocalPoint(visual.focalPoint);
  return normalized;
}
function normalizeFocalPoint(value) {
  return {
    x: clampPercent(value?.x),
    y: clampPercent(value?.y)
  };
}
function isAllowedTmdbImage(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && url.hostname === TMDB_IMAGE_HOST && url.pathname.startsWith("/t/p/");
  } catch {
    return false;
  }
}
function textureVisual(variant, alt, focalPoint) {
  return normalizeVisual({ kind: "texture", variant, alt, focalPoint });
}
function localHour(value) {
  const match = String(value ?? "").match(/T(\d{2}):/);
  const hour = match ? Number(match[1]) : NaN;
  return Number.isFinite(hour) ? hour : null;
}
function clampPercent(value) {
  if (value == null || value === "") return 50;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 50;
}

// ../src/overview.js
function buildOverview(events = [], sports = []) {
  return selectRepresentatives(buildCandidates(events, sports)).slice(0, 5);
}
function buildOverviewBuckets(events = [], sports = [], {
  now = /* @__PURE__ */ new Date(),
  currentDays = 14,
  planAheadLimit = 3,
  planAheadMinScore = 55,
  horizonDays = null
} = {}) {
  const candidates = buildCandidates(events, sports);
  const currentPool = candidates.filter((candidate) => {
    const days = daysFrom(candidate.startLocal, now);
    return days != null && days >= 0 && days <= currentDays;
  });
  const currentRepresentatives = selectRepresentativeCandidates(currentPool).slice(0, 5);
  const current = currentRepresentatives.map((candidate) => ({ ...toOverviewDisplay(candidate), bucket: "current" }));
  const currentIds = new Set(current.map((candidate) => candidate.id));
  const currentGroups = new Set(currentRepresentatives.map((candidate) => candidate.overviewGroupKey));
  const planAhead = selectRepresentatives(candidates.filter((candidate) => {
    const days = daysFrom(candidate.startLocal, now);
    return !currentIds.has(candidate.id) && !currentGroups.has(candidate.overviewGroupKey) && days != null && days > currentDays && (horizonDays == null || days <= horizonDays) && candidate.score >= planAheadMinScore && candidate.call !== "skip";
  })).slice(0, planAheadLimit).map((candidate) => ({ ...candidate, bucket: "plan-ahead" }));
  return { current, planAhead };
}
function buildCandidates(events = [], sports = []) {
  return [...events.map((event) => ({
    vertical: "music",
    id: event.id,
    title: event.title,
    sourceUrl: event.sourceUrl,
    startLocal: event.startLocal,
    venue: event.venue,
    score: event.ranking.utility,
    interestScore: event.ranking.artistFit,
    hassleScore: event.ranking.hassleScore,
    urgency: event.ranking.urgency,
    confidence: event.ranking.confidence,
    reason: event.ranking.whyYou,
    call: event.ranking.call ?? event.call ?? callLabel(event.ranking.utility),
    localEnhancement: event.localEnhancement,
    sources: event.sources,
    eventType: event.eventType,
    visual: event.visual ?? resolveMusicVisual(event),
    feedbackSnapshot: event.feedbackSnapshot ?? null,
    overviewGroupKey: overviewMusicGroupKey(event)
  })), ...sports.map((game) => ({
    vertical: "sports",
    id: game.id,
    title: friendlySportsTitle(game),
    sourceUrl: game.sourceUrl,
    startLocal: game.startLocal,
    venue: game.venue,
    score: game.ranking.utility,
    interestScore: game.ranking.interestScore,
    hassleScore: game.ranking.hassleScore,
    urgency: game.ranking.urgency,
    confidence: game.ranking.confidence,
    reason: game.ranking.whyYou,
    call: game.ranking.call ?? game.call ?? callLabel(game.ranking.utility),
    localEnhancement: game.localEnhancement,
    sources: [...new Set((game.ticketObservations ?? []).map((observation) => observation.source))],
    eventType: "baseball",
    visual: game.visual ?? resolveSportsVisual(game),
    feedbackSnapshot: game.feedbackSnapshot ?? null,
    overviewGroupKey: `sports:${game.series?.id ?? normalizeArtistName(game.awayTeam?.name ?? game.id)}`
  }))].sort(overviewComparator);
}
function selectRepresentatives(candidates) {
  return selectRepresentativeCandidates(candidates).map(toOverviewDisplay);
}
function selectRepresentativeCandidates(candidates) {
  const seenGroups = /* @__PURE__ */ new Set();
  const selected = [];
  for (const candidate of candidates) {
    if (seenGroups.has(candidate.overviewGroupKey)) continue;
    seenGroups.add(candidate.overviewGroupKey);
    selected.push(candidate);
  }
  return selected;
}
function toOverviewDisplay(candidate) {
  const { overviewGroupKey: _overviewGroupKey, localEnhancement: _localEnhancement, sources: _sources, ...display } = candidate;
  return display;
}
function overviewMusicGroupKey(event) {
  const primary = event.matchedArtists?.find((artist) => artist.primary) ?? event.matchedArtists?.[0];
  if (primary?.name) return `music:${normalizeArtistName(primary.name)}`;
  if (event.eventType === "festival") return `music-festival:${normalizeArtistName(event.title)}`;
  return `music:${normalizeArtistName(event.title)}`;
}
function friendlySportsTitle(game) {
  const opponent = friendlyTeamName(game.awayTeam);
  return `Dodgers vs. ${opponent}`;
}
function friendlyTeamName(team = {}) {
  const name = String(team.name ?? team.shortName ?? "Opponent");
  const known = ["Diamondbacks", "Padres", "Giants", "Yankees", "Mets", "Cubs", "Cardinals", "Astros", "Red Sox", "Braves", "Phillies", "Brewers", "Marlins", "Nationals", "Reds", "Pirates", "Rockies", "Tigers", "Twins", "White Sox", "Guardians", "Rays", "Blue Jays", "Orioles", "Royals", "Angels", "Athletics", "Mariners", "Rangers"];
  const match = known.find((label) => name.toLocaleLowerCase().includes(label.toLocaleLowerCase()));
  if (match) return match;
  return String(team.shortName ?? name).replace(/^Arizona$/i, "Diamondbacks").replace(/^Los Angeles\s+/i, "").trim();
}
function overviewComparator(left, right) {
  const scoreDelta = right.score - left.score;
  if (Math.abs(scoreDelta) <= 5 && left.vertical !== right.vertical) return left.vertical === "music" ? -1 : 1;
  return scoreDelta || String(left.startLocal).localeCompare(String(right.startLocal));
}
function callLabel(score) {
  if (score >= 75) return "Strong fit";
  if (score >= 55) return "Selective";
  if (score >= 40) return "Wildcard";
  return "Watch";
}
function daysFrom(value, now) {
  if (!value) return null;
  const date = new Date(value);
  const reference = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) return null;
  return Math.ceil((date.getTime() - reference.getTime()) / 864e5);
}

// ../src/lastfm.js
var API_URL3 = "https://ws.audioscrobbler.com/2.0/";
async function getSimilarArtists(artist, { apiKey, limit = 6, fetchImpl = fetch } = {}) {
  const body = await lastFmRequest("artist.getsimilar", { artist, limit, autocorrect: 1 }, { apiKey, fetchImpl });
  return (Array.isArray(body.similarartists?.artist) ? body.similarartists.artist : []).map((item) => ({
    name: String(item.name ?? "").trim(),
    mbid: String(item.mbid ?? "").trim() || null,
    url: String(item.url ?? "").trim() || null,
    match: boundedNumber(item.match, 0, 1)
  })).filter((item) => item.name);
}
async function getTopArtistsForTag(tag, { apiKey, limit = 25, page = 1, fetchImpl = fetch } = {}) {
  const body = await lastFmRequest("tag.gettopartists", { tag, limit, page }, { apiKey, fetchImpl });
  return (Array.isArray(body.topartists?.artist) ? body.topartists.artist : []).map((item, index) => ({
    name: String(item.name ?? "").trim(),
    mbid: String(item.mbid ?? "").trim() || null,
    url: String(item.url ?? "").trim() || null,
    rank: positiveInteger(item["@attr"]?.rank, index + 1)
  })).filter((item) => item.name);
}
async function lastFmRequest(method, params, { apiKey, fetchImpl }) {
  if (!apiKey) throw new Error("Set LASTFM_API_KEY before expanding taste signals.");
  const url = new URL(API_URL3);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`Last.fm ${method} request failed: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Last.fm ${method} request failed (${response.status}).`);
  const body = await response.json();
  if (body.error) throw new Error(`Last.fm ${method} request failed (${body.error}): ${body.message ?? "Unknown API error"}`);
  return body;
}
function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
}
function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

// ../src/tasteExpansion.js
var NOISY_TAGS = /* @__PURE__ */ new Set([
  "albums i own",
  "awesome",
  "favorite",
  "favorites",
  "female vocalists",
  "male vocalists",
  "seen live",
  "spotify",
  "under 2000 listeners",
  "under 5000 listeners"
]);
function topRecurringTags(snapshot, limit = 5) {
  const totals = /* @__PURE__ */ new Map();
  for (const artist of snapshot.artists ?? []) {
    if (!artist.evidence?.length) continue;
    const weight = Math.max(0.1, Number(artist.seedStrength) || 0.1);
    for (const rawTag of new Set(artist.genres ?? [])) {
      const tag = normalizeArtistName(rawTag);
      if (!tag || NOISY_TAGS.has(tag)) continue;
      totals.set(tag, (totals.get(tag) ?? 0) + weight);
    }
  }
  return [...totals.entries()].map(([name, weight]) => ({ name, weight })).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, limit);
}
async function buildExpandedArtistSnapshot(snapshot, config, {
  apiKey,
  fetchImpl = fetch,
  generatedAt = /* @__PURE__ */ new Date()
} = {}) {
  if (!apiKey) throw new Error("Set LASTFM_API_KEY before expanding taste signals.");
  const sourceArtists = [...snapshot.artists ?? []].sort((a, b) => b.seedStrength - a.seedStrength);
  const seedArtists = sourceArtists.filter((artist) => artist.evidence?.length).slice(0, config.lastFmSeedArtistLimit);
  const topTags = topRecurringTags(snapshot, config.lastFmTopTagCount);
  const maximumSeed = Math.max(1, ...sourceArtists.map((artist) => artist.seedStrength ?? 0));
  const similarResults = await mapWithConcurrency(seedArtists, 4, async (artist) => ({
    artist,
    ...await safeDiscoveryCall(() => getSimilarArtists(artist.name, {
      apiKey,
      limit: config.lastFmSimilarPerArtist,
      fetchImpl
    }), `similar:${artist.name}`)
  }));
  const tagResults = await mapWithConcurrency(topTags, 3, async (tag) => ({
    tag,
    ...await safeDiscoveryCall(() => getTopArtistsForTag(tag.name, {
      apiKey,
      limit: config.lastFmArtistsPerTag,
      fetchImpl
    }), `tag:${tag.name}`)
  }));
  const allCalls = [...similarResults, ...tagResults];
  if (allCalls.length > 0 && allCalls.every((item) => item.warning)) {
    throw new Error(`All Last.fm expansion calls failed. First error: ${allCalls[0].warning}`);
  }
  const artists = new Map(sourceArtists.map((artist) => [normalizeArtistName(artist.name), {
    ...artist,
    origin: artist.origin === "top-items" ? "top-items" : "source",
    discoveryEvidence: [...artist.discoveryEvidence ?? []]
  }]));
  for (const { artist, results } of similarResults) {
    for (const result of results) {
      const strength = round(artist.seedStrength * result.match * 0.55, 4);
      mergeDiscovery(artists, result.name, strength, {
        type: "lastfm-similar",
        sourceArtist: artist.name,
        match: result.match
      });
    }
  }
  const strongestTag = Math.max(1, ...topTags.map((tag) => tag.weight));
  for (const { tag, results } of tagResults) {
    for (const result of results) {
      const rankDecay = Math.max(0.2, 1 - (result.rank - 1) / Math.max(1, config.lastFmArtistsPerTag));
      const strength = round(maximumSeed * 0.35 * (tag.weight / strongestTag) * rankDecay, 4);
      mergeDiscovery(artists, result.name, strength, {
        type: "lastfm-tag",
        tag: tag.name,
        rank: result.rank
      });
    }
  }
  const expandedArtists = [...artists.values()].map(finalizeArtist).sort((a, b) => b.seedStrength - a.seedStrength || a.name.localeCompare(b.name));
  return {
    version: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    source: "playlist-sync+lastfm",
    sourceGeneratedAt: snapshot.generatedAt,
    playlistCount: snapshot.playlistCount,
    sourceArtistCount: snapshot.sourceArtistCount ?? sourceArtists.filter((artist) => artist.evidence?.length).length,
    topArtistCount: snapshot.topArtistCount ?? sourceArtists.filter((artist) => artist.topEvidence).length,
    artistCount: expandedArtists.length,
    topTags: topTags.map(({ name }) => name),
    warnings: [...snapshot.warnings ?? [], ...allCalls.filter((item) => item.warning).map((item) => item.warning)],
    topItems: snapshot.topItems ?? null,
    artists: expandedArtists
  };
}
async function safeDiscoveryCall(callback, context) {
  try {
    return { results: await callback(), warning: null };
  } catch (error) {
    return { results: [], warning: `${context}: ${error.message}` };
  }
}
function mergeDiscovery(artists, name, strength, evidence) {
  const key = normalizeArtistName(name);
  if (!key || strength <= 0) return;
  const current = artists.get(key);
  if (current?.origin === "source") {
    current.discoveryEvidence.push(evidence);
    return;
  }
  if (!current) {
    artists.set(key, {
      spotifyArtistId: null,
      name,
      seedStrength: strength,
      playlistDiversity: 0,
      trackCount: 0,
      genres: evidence.tag ? [evidence.tag] : [],
      sampleTracks: [],
      evidence: [],
      origin: evidence.type === "lastfm-similar" ? "similar" : "tag",
      discoveryEvidence: [evidence]
    });
    return;
  }
  if (current.origin === "top-items") {
    current.discoveryEvidence.push(evidence);
    return;
  }
  current.seedStrength = round(Math.max(current.seedStrength, strength) + Math.min(current.seedStrength, strength) * 0.15, 4);
  current.discoveryEvidence.push(evidence);
  if (evidence.type === "lastfm-similar") current.origin = "similar";
  if (evidence.tag && !current.genres.includes(evidence.tag)) current.genres.push(evidence.tag);
}
function finalizeArtist(artist) {
  const discoveryEvidence = [...artist.discoveryEvidence].sort((a, b) => (b.match ?? 0) - (a.match ?? 0) || (a.rank ?? 999) - (b.rank ?? 999)).slice(0, 8);
  return { ...artist, discoveryEvidence };
}
async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}
function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ../src/tasteProfile.js
function buildTasteProfile(expandedSnapshot, { feedbackState = null, topArtistLimit = 12 } = {}) {
  if (!expandedSnapshot || !Array.isArray(expandedSnapshot.artists)) return null;
  const artists = expandedSnapshot.artists;
  const maxSeedStrength = artists.reduce((max, artist) => Math.max(max, Number(artist.seedStrength) || 0), 0);
  const topArtists = [...artists].filter((artist) => (Number(artist.seedStrength) || 0) > 0).sort((left, right) => (Number(right.seedStrength) || 0) - (Number(left.seedStrength) || 0) || normalizeArtistName(left.name ?? "").localeCompare(normalizeArtistName(right.name ?? ""))).slice(0, topArtistLimit).map((artist) => ({
    name: String(artist.name ?? ""),
    relativeSignal: maxSeedStrength > 0 ? Math.round((Number(artist.seedStrength) || 0) / maxSeedStrength * 100) : 0,
    playlistDiversity: safeCount(artist.playlistDiversity),
    seedTrackCount: safeCount(artist.trackCount),
    origin: publicOrigin(artist.origin),
    evidenceLabels: coarseEvidenceLabels(artist)
  }));
  const expansionByOrigin = {};
  for (const artist of artists) {
    const origin = publicOrigin(artist.origin);
    expansionByOrigin[origin] = (expansionByOrigin[origin] ?? 0) + 1;
  }
  return {
    generatedAt: String(expandedSnapshot.generatedAt ?? ""),
    seedSummary: {
      playlistCount: safeCount(expandedSnapshot.playlistCount),
      sourceArtistCount: safeCount(expandedSnapshot.sourceArtistCount),
      topArtistCount: safeCount(expandedSnapshot.topArtistCount),
      artistCount: safeCount(expandedSnapshot.artistCount)
    },
    topArtists,
    topTags: Array.isArray(expandedSnapshot.topTags) ? expandedSnapshot.topTags.slice(0, 8).map(String) : [],
    expansionByOrigin,
    feedback: publicFeedbackAggregates(feedbackState)
  };
}
function coarseEvidenceLabels(artist) {
  const labels = [];
  const top = artist.topEvidence ?? null;
  if (top?.shortTermRank != null && top.shortTermRank <= 10) labels.push("Current top artist");
  if (top?.mediumTermRank != null && top.mediumTermRank <= 25 && top?.longTermRank != null && top.longTermRank <= 25) labels.push("Sustained favorite");
  if (safeCount(artist.playlistDiversity) >= 2) labels.push("Playlist anchor");
  if (["similar", "tag", "promoter"].includes(artist.origin)) labels.push("Adjacent discovery");
  return labels;
}
function publicOrigin(origin) {
  return ["source", "similar", "tag", "promoter", "top-items"].includes(origin) ? origin : "source";
}
function publicFeedbackAggregates(feedbackState) {
  if (!feedbackState || typeof feedbackState !== "object") return null;
  const outcomes = feedbackState.outcomesByStatus;
  if (!outcomes || typeof outcomes !== "object") return null;
  const statusCounts = {};
  let attendedCount = 0;
  for (const [status, count] of Object.entries(outcomes)) {
    statusCounts[status] = safeCount(count);
    if (status.startsWith("attended-")) attendedCount += safeCount(count);
  }
  return { statusCounts, attendedCount };
}
function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}
export {
  DEFAULT_FOCAL_POINT,
  EDMTRAIN_API_BASE_URL,
  UNORDERED_URGENCIES,
  URGENCY_PRIORITY,
  applyPitcherStats,
  buildEdmtrainUrl,
  buildExpandedArtistSnapshot,
  buildOverview,
  buildOverviewBuckets,
  buildTasteProfile,
  canonicalEventTitle,
  deduplicateCandidates,
  enrichEventsWithEdmtrain,
  enrichMovieMetadata,
  enrichSportsGames,
  eventWithinRadius,
  fetchDodgersHomeGames,
  fetchEdmtrainEvents,
  fetchFrameworkArtists,
  fetchFrameworkEvents,
  fetchInsomniacEvents,
  fetchMlbPitcherStats,
  fetchMlbStandings,
  fetchSeatGeekEvents,
  fetchSeatGeekEventsForPerformers,
  fetchSeatGeekSportsEvents,
  fetchSeatGeekWeekendEvents,
  fetchTicketmasterEvents,
  fetchTicketmasterEventsForArtists,
  fetchTicketmasterSportsEvents,
  fetchUpcomingMovies,
  frameworkPerformers,
  isAllowedTmdbImage,
  joinSportsTickets,
  normalizeArtistName,
  normalizeEdmtrainEvent,
  normalizeFocalPoint,
  normalizeFrameworkEvent,
  normalizeInsomniacEvent,
  normalizeMlbGame,
  normalizePitcher,
  normalizeSeatGeekEvent,
  normalizeSeatGeekSportsEvent,
  normalizeStandings,
  normalizeTeam,
  normalizeTicketmasterEvent,
  normalizeTicketmasterSportsEvent,
  normalizeTmdbMovie,
  normalizeVisual,
  parseFrameworkArtists,
  parseInsomniacEvents,
  playlistAffinityFor,
  rankAffinity,
  rankCandidates,
  resolveMovieVisual,
  resolveMusicVisual,
  resolveSeatGeekPerformers,
  resolveSportsVisual,
  resolveTmdbAuth,
  sameOccurrence,
  scoreSportsGame,
  searchSeatGeekPerformers,
  selectMovieCandidates,
  selectSeatGeekPerformer,
  splitDateWindows,
  sportsTicketUrgency,
  spotifyIdFromLinks,
  ticketMatchesGame,
  ticketmasterEventMatchesArtist,
  topItemsAffinityFor,
  topRecurringTags
};
