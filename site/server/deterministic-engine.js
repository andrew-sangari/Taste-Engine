// Generated from deterministic Taste Engine modules. Do not edit directly.


// ../src/localDate.js
function localDateKey(value) {
  const key = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}
function localDateAtNoon(value) {
  const key = localDateKey(value);
  return key ? /* @__PURE__ */ new Date(`${key}T12:00:00Z`) : null;
}
function weekdayForLocalDate(value, locale = "en-US") {
  const date = localDateAtNoon(value);
  return date ? date.toLocaleDateString(locale, { timeZone: "UTC", weekday: "long" }) : null;
}
function localWeekdayIndex(value) {
  const date = localDateAtNoon(value);
  return date ? date.getUTCDay() : null;
}
function localDateDifference(value, now = /* @__PURE__ */ new Date(), timeZone = "America/Los_Angeles") {
  const event = localDateAtNoon(value);
  if (!event || Number.isNaN(new Date(now).getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(now)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const reference = /* @__PURE__ */ new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  return Math.round((event.getTime() - reference.getTime()) / 864e5);
}

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
    const distanceMiles5 = distanceBetween(config.home, candidate.venue);
    const hassle = calculateHassle(candidate, config, distanceMiles5);
    const hassleScore = hassle.score;
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
        hassleBreakdown: hassle,
        hassleReasons: hassle.reasons,
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
function calculateHassle(candidate, config, distanceMiles5) {
  const logisticalReasons = [];
  const commercialReasons = [];
  let logistical = 0;
  let commercial = 0;
  if (distanceMiles5 != null) {
    logistical = Math.min(6, Math.round(distanceMiles5 / 12));
    if (distanceMiles5 >= 12) logisticalReasons.push(`${Math.round(distanceMiles5)} mi from ${config.home.label}`);
  }
  if (candidate.timeTbd || candidate.dateTbd) {
    logistical += 2;
    logisticalReasons.push("time or date is TBD");
  }
  const lowestPrice = candidate.ticketObservation?.lowestPriceUsd;
  if (lowestPrice != null) {
    commercialReasons.push(`from $${lowestPrice}`);
    if (lowestPrice > config.maxTicketPriceUsd) {
      commercial += 2;
      commercialReasons.push("above ticket budget");
    }
  }
  const personalContext = Math.max(-2, Math.min(2, Number(candidate.personalContextFriction ?? 0) || 0));
  const score = Math.max(0, Math.min(10, logistical + commercial + personalContext));
  return {
    score,
    logistical,
    commercial,
    personalContext,
    commercialUncertain: lowestPrice == null,
    reasons: [...logisticalReasons, ...commercialReasons]
  };
}
function ticketUrgency(ticketObservation, startLocal, now) {
  const listingCount = ticketObservation.listingCount;
  const daysUntil3 = daysUntilEvent(startLocal, now);
  if (listingCount != null && listingCount <= 10) return "buy now";
  if (daysUntil3 != null && daysUntil3 <= 3 && listingCount != null && listingCount <= 30) return "buy now";
  if (daysUntil3 != null && daysUntil3 <= 7) return "watch";
  return "safe to wait";
}
function daysUntilEvent(startLocal, now) {
  return localDateDifference(startLocal, now);
}
function distanceBetween(home, venue) {
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return null;
  const radians = Math.PI / 180;
  const dLat = (venue.lat - home.lat) * radians;
  const dLon = (venue.lon - home.lon) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(home.lat * radians) * Math.cos(venue.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    return distanceMiles(left.lat, left.lon, right.lat, right.lon) <= 1.5;
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
  const existing = Array.isArray(candidate.sourceOccurrences) && candidate.sourceOccurrences.length ? candidate.sourceOccurrences : [{
    source: candidate.source,
    sourceEventId: candidate.sourceEventId,
    sourceUrl: candidate.sourceUrl,
    retrievedAt: candidate.retrievedAt,
    evidence: candidate.eventEvidence
  }];
  return existing.map((occurrence) => ({
    ...occurrence,
    title: occurrence.title ?? candidate.title,
    startLocal: occurrence.startLocal ?? candidate.startLocal,
    venue: occurrence.venue ?? candidate.venue,
    performerNames: occurrence.performerNames ?? (candidate.performers ?? []).map((performer) => performer.name),
    retrievedAt: occurrence.retrievedAt ?? candidate.retrievedAt,
    evidence: occurrence.evidence ?? occurrence.eventEvidence ?? (!occurrence.source || occurrence.source === candidate.source ? candidate.eventEvidence : null)
  }));
}
function localDate(value) {
  return String(value ?? "").slice(0, 10);
}
function distanceMiles(lat1, lon1, lat2, lon2) {
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
  const locations = await requestJson(locationsUrl, fetchImpl);
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
  const body = await requestJson(eventsUrl, fetchImpl);
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
  url.searchParams.set("hydrate", "team,venue,seriesStatus,probablePitcher,linescore");
  url.searchParams.set("includeSeriesNumber", "true");
  if (season != null) url.searchParams.set("season", String(season));
  const body = await requestJson2(url, fetchImpl, "schedule");
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
  const body = await requestJson2(url, fetchImpl, "standings");
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
        const body = await requestJson2(url, fetchImpl, `pitcher stats ${id}`);
        const person = body.people?.[0];
        const split = person?.stats?.flatMap((item) => item.splits ?? [])?.[0];
        const stat = split?.stat;
        if (person && stat) result.set(id, {
          id,
          name: person.fullName ?? null,
          era: numberOrNull(stat.era),
          whip: numberOrNull(stat.whip),
          strikeoutsPer9: numberOrNull(stat.strikeoutsPer9Inn),
          strikeouts: numberOrNull(stat.strikeOuts ?? stat.strikeouts),
          inningsPitched: numberOrNull(String(stat.inningsPitched ?? "").replace(/[^0-9.]/g, "")),
          wins: numberOrNull(stat.wins),
          losses: numberOrNull(stat.losses),
          handedness: pitcherHandedness(person),
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
    schemaVersion: 2,
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
    scheduleStatus: {
      abstractState: String(game.status?.abstractGameState ?? "").trim() || null,
      detailedState: String(game.status?.detailedState ?? "").trim() || "Scheduled",
      codedState: String(game.status?.codedGameState ?? game.status?.statusCode ?? "").trim() || null,
      reason: String(game.status?.reason ?? game.rescheduleGameDate ?? "").trim() || null,
      changed: scheduleChanged(game.status),
      delayed: /delay/i.test(String(game.status?.detailedState ?? "")),
      postponed: /postpon|suspend/i.test(String(game.status?.detailedState ?? "")),
      rescheduled: /resched/i.test(String(game.status?.detailedState ?? ""))
    },
    venue: {
      sourceId: venue.id == null ? null : String(venue.id),
      name: String(venue.name ?? "Dodger Stadium").trim(),
      city: "Los Angeles",
      state: "CA",
      lat: numberOrNull(venue.location?.latitude ?? venue.geoLocation?.latitude),
      lon: numberOrNull(venue.location?.longitude ?? venue.geoLocation?.longitude)
    },
    homeTeam,
    awayTeam,
    series: {
      id: seriesId,
      gameNumber: numberOrNull(game.seriesStatus?.gameNumber ?? game.seriesGameNumber ?? game.gameNumber),
      gameCount: numberOrNull(game.seriesStatus?.totalGames ?? game.gamesInSeries)
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
      const splits = teamRecord.records?.splitRecords ?? [];
      const lastTen = splitRecord(splits, "lastTen");
      standings.set(String(team.id), {
        team,
        leagueRank: numberOrNull(teamRecord.leagueRank),
        divisionRank: numberOrNull(teamRecord.divisionRank),
        wins: numberOrNull(teamRecord.wins ?? teamRecord.leagueRecord?.wins),
        losses: numberOrNull(teamRecord.losses ?? teamRecord.leagueRecord?.losses),
        winPct: numberOrNull(teamRecord.winningPercentage ?? teamRecord.leagueRecord?.pct),
        lastTen: lastTen ? `${lastTen.wins}-${lastTen.losses}` : null,
        lastTenRecord: lastTen,
        streak: teamRecord.streak?.streakCode ?? null,
        gamesBack: numberOrNull(teamRecord.gamesBack),
        wildCardGamesBack: numberOrNull(teamRecord.wildCardGamesBack),
        runDifferential: numberOrNull(teamRecord.runDifferential),
        runsScored: numberOrNull(teamRecord.runsScored),
        runsAllowed: numberOrNull(teamRecord.runsAllowed),
        homeRecord: splitRecord(splits, "home"),
        awayRecord: splitRecord(splits, "away"),
        above500Record: splitRecord(splits, "vsAbove500"),
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
    handedness: pitcherHandedness(pitcher),
    era: null,
    whip: null,
    strikeoutsPer9: null,
    strikeouts: null,
    inningsPitched: null,
    wins: null,
    losses: null
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
async function requestJson2(url, fetchImpl, context) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`MLB ${context} request failed (${response.status}).`);
  return response.json();
}
function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function splitRecord(splits, type) {
  const split = splits.find((item) => String(item?.type ?? "").toLowerCase() === type.toLowerCase());
  if (!split) return null;
  const wins = numberOrNull(split.wins);
  const losses = numberOrNull(split.losses);
  if (wins == null || losses == null) return null;
  return { wins, losses, winPct: wins + losses ? wins / (wins + losses) : null };
}
function pitcherHandedness(person) {
  const code = String(person?.pitchHand?.code ?? person?.pitchHand?.description ?? "").trim().toUpperCase();
  return code === "L" || code === "R" ? code : null;
}
function scheduleChanged(status = {}) {
  const detailed = String(status?.detailedState ?? "");
  const abstract = String(status?.abstractGameState ?? "");
  return /postpon|delay|suspend|resched|cancel/i.test(`${detailed} ${abstract}`);
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
    const body = await requestJson3(url, fetchImpl, "SeatGeek sports");
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
    const body = await requestJson3(url, fetchImpl, "Ticketmaster sports");
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
      lowestPriceUsd: numberOrNull2(event.stats?.lowest_price),
      averagePriceUsd: numberOrNull2(event.stats?.average_price),
      listingCount: numberOrNull2(event.stats?.listing_count),
      status: event.status ?? "scheduled",
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}
function normalizeTicketmasterSportsEvent(event, retrievedAt = /* @__PURE__ */ new Date()) {
  const venue = event._embedded?.venues?.[0] ?? {};
  const attractions = event._embedded?.attractions ?? [];
  const localDate3 = event.dates?.start?.localDate ?? null;
  const localTime2 = event.dates?.start?.localTime ?? "00:00:00";
  const names = attractions.map((attraction) => attraction.name).filter(Boolean);
  return {
    source: "ticketmaster",
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ""),
    title: String(event.name ?? "").trim(),
    startLocal: localDate3 ? `${localDate3}T${localTime2}` : null,
    venue: normalizeTicketVenue(venue),
    teamNames: [...names, event.name ?? ""].filter(Boolean),
    ticketObservation: {
      source: "ticketmaster",
      sourceEventId: String(event.id),
      url: String(event.url ?? ""),
      lowestPriceUsd: numberOrNull2(event.priceRanges?.[0]?.min),
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
    const probablePitchers = {
      home: mergePitcherStats(game.probablePitchers?.home, pitcherStats),
      away: mergePitcherStats(game.probablePitchers?.away, pitcherStats),
      confirmed: game.probablePitchers?.confirmed ?? false
    };
    const matchupTier = pitcherMatchupTier(probablePitchers);
    const seriesPosition = seriesPositionFor(game);
    const opponentTags = opponentStakesTags(game, opponent, rivalry);
    const sportsContext = {
      opponentWinPct: opponent?.winPct ?? null,
      opponentLeagueRank: opponent?.leagueRank ?? null,
      opponentDivisionRank: opponent?.divisionRank ?? null,
      opponentLast10: opponent?.lastTen ?? null,
      opponentLastTenRecord: opponent?.lastTenRecord ?? null,
      opponentStreak: opponent?.streak ?? null,
      opponentWildCardGamesBack: opponent?.wildCardGamesBack ?? null,
      opponentRunDifferential: opponent?.runDifferential ?? null,
      opponentHomeRecord: opponent?.homeRecord ?? null,
      opponentAwayRecord: opponent?.awayRecord ?? null,
      opponentAbove500Record: opponent?.above500Record ?? null,
      opponentLeagueName: opponent?.league?.name ?? null,
      opponentDivisionName: opponent?.division?.name ?? null,
      rivalryTier: rivalry.tier,
      probablePitchers,
      pitcherMatchupTier: matchupTier,
      seriesPosition,
      opponentTags,
      schedule: game.scheduleStatus ?? {
        detailedState: game.status ?? "Scheduled",
        changed: false,
        delayed: false,
        postponed: false,
        rescheduled: false
      },
      playoffLeverage: playoffLeverage(game.startLocal, opponent),
      // A small, deterministic context object keeps the card explanation
      // legible without turning the Sports vertical into a stats dashboard.
      gameContext: {
        opponent: {
          tags: opponentTags,
          leagueRank: opponent?.leagueRank ?? null,
          divisionRank: opponent?.divisionRank ?? null,
          wildCardGamesBack: opponent?.wildCardGamesBack ?? null,
          runDifferential: opponent?.runDifferential ?? null,
          lastTen: opponent?.lastTen ?? null,
          streak: opponent?.streak ?? null
        },
        pitching: { matchupTier, confirmed: probablePitchers.confirmed },
        series: seriesPosition,
        schedule: game.scheduleStatus ?? { detailedState: game.status ?? "Scheduled", changed: false }
      }
    };
    const tags = sportsTags(game, opponent, rivalry, sportsContext);
    const ranking = scoreSportsGame({ ...game, sportsContext, tags }, config, now);
    return { ...game, sportsContext, tags, ranking };
  });
}
function scoreSportsGame(game, config, now = /* @__PURE__ */ new Date()) {
  const opponentQuality = opponentQualityScore(game.sportsContext);
  const opponentStakesScore = opponentStakesScoreFor(game.sportsContext);
  const rivalryScore = { high: 15, medium: 8, low: 3, none: 0 }[game.sportsContext?.rivalryTier] ?? 0;
  const pitchingScore = pitchingMatchupScore(game.sportsContext?.probablePitchers);
  const leverageScore = { high: 10, medium: 6, low: 2, unknown: 0 }[game.sportsContext?.playoffLeverage] ?? 0;
  const leagueRelevanceScore = leagueRelevance(game.sportsContext);
  const convenienceScore = dateConvenience(game.startLocal);
  const hassle = sportsHassle(game, config);
  const hassleScore = hassle.score;
  const interestScore = Math.min(100, 35 + opponentQuality + opponentStakesScore + rivalryScore + pitchingScore + leverageScore + leagueRelevanceScore + convenienceScore);
  const urgency = sportsTicketUrgency(game.ticketObservations ?? [], game.startLocal, now);
  const confidence = game.sportsContext?.opponentWinPct == null ? "medium" : game.sportsContext.probablePitchers.confirmed ? "high" : "medium";
  const whyYou = sportsWhyYou(game, { opponentQuality, opponentStakesScore, rivalryScore, pitchingScore, leverageScore, leagueRelevanceScore, convenienceScore, hassleScore });
  return {
    excluded: false,
    interestScore,
    utility: interestScore - hassleScore * 2,
    opponentQuality,
    opponentStakesScore,
    rivalryScore,
    pitchingScore,
    leverageScore,
    leagueRelevanceScore,
    convenienceScore,
    hassleScore,
    hassleBreakdown: hassle,
    hassleReasons: hassle.reasons,
    urgency,
    confidence,
    whyYou
  };
}
function sportsWhyYou(game, { opponentQuality, opponentStakesScore, rivalryScore, pitchingScore, leverageScore, leagueRelevanceScore, convenienceScore, hassleScore }) {
  const day = weekdayForLocalDate(game.startLocal);
  const friction = hassleScore <= 4 ? "Low-hassle" : hassleScore <= 6 ? "Manageable" : "Higher-hassle";
  const reasons = [];
  if (rivalryScore >= 15) reasons.push(`${game.awayTeam.shortName || game.awayTeam.name} rivalry`);
  else if (opponentStakesScore >= 4 || opponentQuality >= 8) reasons.push("a stronger-than-usual matchup");
  if (game.sportsContext?.pitcherMatchupTier === "ace") reasons.push("an ace matchup");
  else if (pitchingScore >= 5) reasons.push("a notable pitching matchup");
  if (leverageScore >= 6) reasons.push("useful late-season leverage");
  if (leagueRelevanceScore >= 4) reasons.push("an AL East measuring-stick matchup");
  if (!reasons.length && convenienceScore >= 8) reasons.push("a good weekend timing window");
  if (!reasons.length) reasons.push("a worthwhile Dodgers home-game setup");
  const series = game.sportsContext?.seriesPosition?.label;
  const schedule = game.sportsContext?.schedule;
  const statusNote = schedule?.changed ? ` ${schedule.detailedState || "Schedule update"} \u2014 check MLB before leaving.` : "";
  return `${friction} ${day ? `${day} ` : ""}game with ${joinReasons(reasons)}.${series ? ` ${series}.` : ""}${statusNote}`;
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
  const tags = [...context.opponentTags ?? []];
  if (rivalry.label) tags.push(`${game.awayTeam.shortName || game.awayTeam.name} rivalry`);
  if (/american league/i.test(String(opponent?.league?.name ?? ""))) tags.push("AL matchup");
  if (/american league east|al east/i.test(String(opponent?.division?.name ?? ""))) tags.push("AL East matchup");
  if (context.pitcherMatchupTier === "ace") tags.push("Ace matchup");
  else if (context.pitcherMatchupTier === "notable") tags.push("Notable pitching matchup");
  if (context.seriesPosition?.label) tags.push(context.seriesPosition.label);
  if (context.schedule?.postponed) tags.push("Schedule update");
  if (context.playoffLeverage === "high") tags.push("Late-season leverage");
  if ([0, 6].includes(localWeekdayIndex(game.startLocal))) tags.push("Weekend game");
  return [...new Set(tags)].slice(0, 7);
}
function opponentQualityScore(context = {}) {
  if (Number.isFinite(context.opponentLeagueRank)) return Math.max(0, Math.min(20, Math.round(20 - (context.opponentLeagueRank - 1) * 1.25)));
  if (Number.isFinite(context.opponentWinPct)) return Math.max(0, Math.min(20, Math.round((context.opponentWinPct - 0.35) * 66.67)));
  return 0;
}
function opponentStakesScoreFor(context = {}) {
  let score = 0;
  if (context.opponentDivisionRank === 1) score += 3;
  else if (Number.isFinite(context.opponentWildCardGamesBack) && context.opponentWildCardGamesBack <= 3) score += 2;
  if (Number.isFinite(context.opponentLeagueRank) && context.opponentLeagueRank <= 5) score += 2;
  if (Number.isFinite(context.opponentRunDifferential)) {
    if (context.opponentRunDifferential >= 75) score += 3;
    else if (context.opponentRunDifferential >= 35) score += 2;
    else if (context.opponentRunDifferential >= 15) score += 1;
  }
  if (context.opponentLastTenRecord?.wins >= 7) score += 1;
  if (/^W[4-9]|^W\d{2,}/i.test(String(context.opponentStreak ?? ""))) score += 1;
  return Math.min(10, score);
}
function leagueRelevance(context = {}) {
  const league = String(context.opponentLeagueName ?? "");
  const division = String(context.opponentDivisionName ?? "");
  if (/american league east|al east/i.test(division)) return 5;
  if (/american league/i.test(league)) return 2;
  return 0;
}
function pitchingMatchupScore(pitchers = {}) {
  if (!pitchers.confirmed) return 0;
  const quality = (pitcher) => {
    if (!pitcher || pitcher.era == null || pitcher.whip == null || (pitcher.inningsPitched ?? 0) < 45) return 0;
    if (pitcher.era <= 3.15 && pitcher.whip <= 1.15) return 5;
    if (pitcher.era <= 3.75 && pitcher.whip <= 1.28) return 3;
    return 1;
  };
  const homeQuality = quality(pitchers.home);
  const awayQuality = quality(pitchers.away);
  if (!homeQuality || !awayQuality) return 0;
  return Math.min(10, homeQuality + awayQuality);
}
function pitcherMatchupTier(pitchers = {}) {
  const score = pitchingMatchupScore(pitchers);
  if (!pitchers.confirmed || !score) return "unknown";
  if (score >= 9) return "ace";
  if (score >= 4) return "notable";
  return "standard";
}
function opponentStakesTags(game, opponent, rivalry) {
  if (!opponent) return rivalry.label ? [`${game.awayTeam.shortName || game.awayTeam.name} rivalry`] : [];
  const tags = [];
  if (opponent.divisionRank === 1) tags.push(`${compactDivision(opponent.division?.name) || "Division"} leader`);
  else if (Number.isFinite(opponent.wildCardGamesBack) && opponent.wildCardGamesBack <= 3) tags.push("Wild-card contender");
  if (Number.isFinite(opponent.leagueRank) && opponent.leagueRank <= 5) tags.push("Top-five league record");
  if (Number.isFinite(opponent.runDifferential) && opponent.runDifferential >= 15) tags.push(`${opponent.runDifferential >= 0 ? "+" : ""}${Math.round(opponent.runDifferential)} run differential`);
  if (opponent.lastTenRecord?.wins >= 7) tags.push(`Won ${opponent.lastTenRecord.wins} of last 10`);
  else if (/^W([4-9]|\d{2,})/i.test(String(opponent.streak ?? ""))) tags.push(`Won ${String(opponent.streak).slice(1)} straight`);
  return tags;
}
function compactDivision(value) {
  return String(value ?? "").replace(/^National League\s+/i, "NL ").replace(/^American League\s+/i, "AL ").trim();
}
function seriesPositionFor(game) {
  const gameNumber = Number(game.series?.gameNumber);
  const gameCount = Number(game.series?.gameCount);
  if (!Number.isFinite(gameNumber) || !Number.isFinite(gameCount) || gameCount < 2) return { label: "Single game", gameNumber: null, gameCount: null };
  if (gameNumber === 1) return { label: "Series opener", gameNumber, gameCount };
  if (gameNumber >= gameCount) return { label: "Series finale", gameNumber, gameCount };
  return { label: `Game ${gameNumber} of ${gameCount}`, gameNumber, gameCount };
}
function playoffLeverage(startLocal, opponent) {
  if (!opponent) return "unknown";
  const month = Number(String(startLocal ?? "").slice(5, 7));
  if (month >= 9 && (opponent.divisionRank <= 2 || opponent.gamesBack != null && opponent.gamesBack <= 5)) return "high";
  if (opponent.divisionRank <= 2 || opponent.gamesBack != null && opponent.gamesBack <= 5) return "medium";
  return "low";
}
function dateConvenience(startLocal) {
  const day = localWeekdayIndex(startLocal);
  if (day == null) return 0;
  if (day === 0 || day === 6) return 10;
  if (day === 5) return 8;
  return 4;
}
function sportsHassle(game, config) {
  const logisticalReasons = ["Dodger Stadium logistics"];
  const commercialReasons = [];
  let logistical = 2;
  let commercial = 0;
  if (game.timeTbd || game.dateTbd) {
    logistical += 2;
    logisticalReasons.push("time or date is TBD");
  }
  if (config.homeVenueNames?.length && !config.homeVenueNames.some((name) => normalizeTeamText(game.venue.name).includes(normalizeTeamText(name)))) {
    logistical += 1;
    logisticalReasons.push("venue confirmation pending");
  }
  const lowest = (game.ticketObservations ?? []).map((item) => Number(item.lowestPriceUsd)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (lowest != null) {
    commercialReasons.push(`from $${lowest}`);
    if (Number.isFinite(config.maxTicketPriceUsd) && lowest > config.maxTicketPriceUsd) {
      commercial += 2;
      commercialReasons.push("above ticket budget");
    }
  }
  const personalContext = Math.max(-2, Math.min(2, Number(game.personalContextFriction ?? 0) || 0));
  return {
    score: Math.max(0, Math.min(10, logistical + commercial + personalContext)),
    logistical,
    commercial,
    personalContext,
    commercialUncertain: lowest == null,
    reasons: [...logisticalReasons, ...commercialReasons]
  };
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
    return distanceMiles2(left.lat, left.lon, right.lat, right.lon) <= 3;
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
    lat: numberOrNull2(venue.location?.latitude ?? venue.location?.lat),
    lon: numberOrNull2(venue.location?.longitude ?? venue.location?.lon)
  };
}
function distanceMiles2(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function daysUntil(startLocal, now) {
  return localDateDifference(startLocal, now);
}
async function requestJson3(url, fetchImpl, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
  return response.json();
}
function numberOrNull2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
  return distanceMiles3(home.lat, home.lon, lat, lon) <= radiusMiles;
}
function distanceMiles3(lat1, lon1, lat2, lon2) {
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
      lat: numberOrNull3(venue.location?.lat),
      lon: numberOrNull3(venue.location?.lon)
    },
    performers,
    ticketObservation: {
      listingCount: numberOrNull3(event.stats?.listing_count),
      lowestPriceUsd: numberOrNull3(event.stats?.lowest_price),
      averagePriceUsd: numberOrNull3(event.stats?.average_price),
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
function numberOrNull3(value) {
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
      const delay2 = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(3e4, retryAfter * 1e3) : 1e3 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay2));
      continue;
    }
    const detail = await safeResponseText(response);
    throw new Error(`SeatGeek ${context} failed (${response.status}).${detail ? ` ${detail}` : ""}`);
  }
  throw new Error(`SeatGeek ${context} failed after retries.`);
}

// ../src/eventEvidence.js
var EVENT_EVIDENCE_SCHEMA_VERSION = 1;
var EVIDENCE_FIELDS = [
  "title",
  "description",
  "classification",
  "namedLineup",
  "format",
  "doorTime",
  "startTime",
  "endTime",
  "venueInfo",
  "agePolicy"
];
var EVIDENCE_ASSERTION_KINDS = ["published-fact", "descriptive-copy", "derived-estimate"];
var EVIDENCE_CONFIDENCE = ["verified", "partial", "unknown"];
var PERMITTED_EVIDENCE_PROVIDERS = ["ticketmaster", "framework"];
var DEFAULT_PERMISSION = Object.freeze({
  internalUse: true,
  display: false,
  modelInput: false,
  persist: true
});
var STRUCTURED_MODEL_FIELDS = /* @__PURE__ */ new Set([
  "title",
  "classification",
  "namedLineup",
  "format",
  "doorTime",
  "startTime",
  "endTime",
  "venueInfo",
  "agePolicy"
]);
function createEvidenceFact({
  value,
  field,
  provider,
  sourceEventId = null,
  sourceUrl = null,
  retrievedAt = null,
  assertionKind = "published-fact",
  permission = {},
  confidence = "verified"
} = {}) {
  if (!EVIDENCE_FIELDS.includes(field)) throw new Error(`Unknown evidence field: ${field}`);
  if (!PERMITTED_EVIDENCE_PROVIDERS.includes(provider)) return null;
  if (value == null || value === "" || Array.isArray(value) && value.length === 0) return null;
  if (!EVIDENCE_ASSERTION_KINDS.includes(assertionKind)) throw new Error(`Unknown evidence assertion kind: ${assertionKind}`);
  if (!EVIDENCE_CONFIDENCE.includes(confidence)) throw new Error(`Unknown evidence confidence: ${confidence}`);
  const normalized = normalizeFactValue(value, field);
  if (normalized == null || normalized === "" || Array.isArray(normalized) && normalized.length === 0 || typeof normalized === "object" && !Array.isArray(normalized) && Object.keys(normalized).length === 0) return null;
  const rights = {
    ...DEFAULT_PERMISSION,
    ...permission
  };
  return {
    value: normalized,
    field,
    provider,
    ...sourceEventId ? { sourceEventId: String(sourceEventId) } : {},
    ...sourceUrl ? { sourceUrl: String(sourceUrl) } : {},
    ...retrievedAt ? { retrievedAt: new Date(retrievedAt).toISOString() } : {},
    assertionKind,
    permission: {
      internalUse: Boolean(rights.internalUse),
      display: Boolean(rights.display),
      modelInput: Boolean(rights.modelInput),
      persist: Boolean(rights.persist)
    },
    confidence
  };
}
function createEventEvidence({
  eventRef,
  provider,
  sourceEventId = null,
  sourceUrl = null,
  retrievedAt = null,
  facts = {},
  withheldOrMissing = []
} = {}) {
  const permittedFacts = {};
  for (const field of EVIDENCE_FIELDS) {
    const fact = facts[field];
    if (!fact) continue;
    const normalized = fact.field ? fact : createEvidenceFact({
      value: fact,
      field,
      provider,
      sourceEventId,
      sourceUrl,
      retrievedAt,
      permission: defaultPermissionFor(provider, field)
    });
    if (normalized) permittedFacts[field] = normalized;
  }
  const missing = new Set(withheldOrMissing.filter(Boolean));
  for (const field of EVIDENCE_FIELDS) {
    if (!permittedFacts[field]) missing.add(field);
  }
  return {
    schemaVersion: EVENT_EVIDENCE_SCHEMA_VERSION,
    ...eventRef ? { eventRef: String(eventRef) } : {},
    ...provider ? { provider } : {},
    ...sourceEventId ? { sourceEventId: String(sourceEventId) } : {},
    ...sourceUrl ? { sourceUrl: String(sourceUrl) } : {},
    ...retrievedAt ? { retrievedAt: new Date(retrievedAt).toISOString() } : {},
    permittedFacts,
    withheldOrMissing: [...missing]
  };
}
function evidenceForOccurrence(occurrence) {
  return occurrence?.evidence ?? occurrence?.eventEvidence ?? null;
}
function buildEventEvidence(candidate) {
  const evidenceItems = [];
  if (candidate?.eventEvidence) evidenceItems.push(candidate.eventEvidence);
  for (const occurrence of candidate?.sourceOccurrences ?? []) {
    const evidence = evidenceForOccurrence(occurrence);
    if (evidence) evidenceItems.push(evidence);
  }
  const facts = {};
  const conflicts = {};
  for (const evidence of evidenceItems) {
    for (const [field, fact] of Object.entries(evidence.permittedFacts ?? {})) {
      if (!fact || !fact.permission?.internalUse) continue;
      const current = facts[field];
      if (!current || factPreference(fact) > factPreference(current)) {
        if (current && !sameFactValue(current, fact)) conflicts[field] = [...conflicts[field] ?? [], current];
        facts[field] = fact;
      } else if (!sameFactValue(current, fact)) {
        conflicts[field] = [...conflicts[field] ?? [], fact];
      }
    }
  }
  reconcileTitleAgePolicy(facts, conflicts);
  const missing = /* @__PURE__ */ new Set();
  for (const evidence of evidenceItems) {
    for (const field of evidence.withheldOrMissing ?? []) missing.add(field);
  }
  for (const field of EVIDENCE_FIELDS) {
    if (!facts[field]) missing.add(field);
    else missing.delete(field);
  }
  return {
    schemaVersion: EVENT_EVIDENCE_SCHEMA_VERSION,
    eventRef: candidate?.id ?? null,
    permittedFacts: facts,
    conflicts,
    withheldOrMissing: [...missing]
  };
}
function ageRestrictionFromText(text2) {
  const value = String(text2 ?? "");
  const plus = value.match(/(?:^|[^\d])(21|18)\s*\+/);
  if (plus) return `${plus[1]}+`;
  const over = value.match(/\b(21|18)\s*(?:and|&)\s*(?:over|up|older)\b/i);
  if (over) return `${over[1]}+`;
  if (/\ball[\s-]+ages\b/i.test(value)) return "All ages";
  return null;
}
function reconcileTitleAgePolicy(facts, conflicts) {
  const titles = [facts.title, ...conflicts.title ?? []].filter(Boolean);
  const title = titles.find((fact) => ageRestrictionFromText(fact.value));
  const stated = title ? ageRestrictionFromText(title.value) : null;
  if (!stated) return;
  const derived = {
    ...title,
    field: "agePolicy",
    value: stated,
    derivedFrom: "title"
  };
  const policy = facts.agePolicy;
  if (!policy) {
    facts.agePolicy = derived;
    return;
  }
  const published = ageRestrictionFromText(policy.value);
  if (published && published !== stated) {
    conflicts.agePolicy = [...conflicts.agePolicy ?? [], derived];
  }
}
function serializeEventEvidenceForModel(evidence) {
  const publishedFacts = {};
  const evidenceRefs = {};
  const knownUnknowns = new Set(evidence?.withheldOrMissing ?? []);
  for (const [field, fact] of Object.entries(evidence?.permittedFacts ?? {})) {
    if (!fact.permission?.modelInput) {
      knownUnknowns.add(field);
      continue;
    }
    publishedFacts[field] = fact.value;
    evidenceRefs[field] = opaqueEvidenceRef(evidence, field);
  }
  return {
    publishedFacts,
    evidenceRefs,
    knownUnknowns: [...knownUnknowns]
  };
}
function serializeEventEvidenceForDisplay(evidence) {
  const facts = {};
  for (const [field, fact] of Object.entries(evidence?.permittedFacts ?? {})) {
    if (!fact.permission?.display) continue;
    facts[field] = displayFact(fact);
  }
  const conflicts = {};
  for (const [field, alternatives] of Object.entries(evidence?.conflicts ?? {})) {
    if (!facts[field]) continue;
    const visible = alternatives.filter((fact) => fact?.permission?.display).map(displayFact);
    if (visible.length) conflicts[field] = visible;
  }
  return {
    schemaVersion: EVENT_EVIDENCE_SCHEMA_VERSION,
    facts,
    ...Object.keys(conflicts).length ? { conflicts } : {},
    withheldOrMissing: [...new Set(evidence?.withheldOrMissing ?? [])]
  };
}
function displayFact(fact) {
  return {
    value: fact.value,
    provider: fact.provider,
    ...fact.sourceUrl ? { sourceUrl: fact.sourceUrl } : {},
    ...fact.retrievedAt ? { retrievedAt: fact.retrievedAt } : {},
    assertionKind: fact.assertionKind,
    ...fact.derivedFrom ? { derivedFrom: fact.derivedFrom } : {},
    confidence: fact.confidence
  };
}
var PLACEHOLDER_CLASSIFICATIONS = /* @__PURE__ */ new Set([
  "undefined",
  "unknown",
  "uncategorized",
  "uncategorised",
  "other",
  "general",
  "miscellaneous",
  "misc",
  "events",
  "event",
  "n/a",
  "none"
]);
function meaningfulClassifications(values = [], { provider = null } = {}) {
  const promoter = String(provider ?? "").trim().toLowerCase();
  const output = [];
  for (const value of values) {
    const text2 = String(value ?? "").trim();
    if (!text2) continue;
    const normalized = text2.toLowerCase();
    if (PLACEHOLDER_CLASSIFICATIONS.has(normalized)) continue;
    if (promoter && normalized === promoter) continue;
    if (!output.some((existing) => existing.toLowerCase() === normalized)) output.push(text2);
  }
  return output;
}
function defaultPermissionFor(provider, field) {
  return {
    internalUse: true,
    display: true,
    modelInput: provider !== "insomniac" && (STRUCTURED_MODEL_FIELDS.has(field) && field !== "title" ? true : field === "title"),
    persist: true
  };
}
function summarizeEvidenceCoverage(items = []) {
  const counts = Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, 0]));
  let modelEligibleCount = 0;
  let evidenceCount = 0;
  for (const item of items) {
    const evidence = item?.eventEvidence ?? buildEventEvidence(item);
    const facts = evidence?.permittedFacts ?? {};
    if (Object.keys(facts).length) evidenceCount += 1;
    if (Object.values(facts).some((fact) => fact?.permission?.modelInput)) modelEligibleCount += 1;
    for (const field of EVIDENCE_FIELDS) {
      if (facts[field]) counts[field] += 1;
    }
  }
  const fieldCoverage = Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, {
    count: counts[field],
    rate: items.length ? Number((counts[field] / items.length).toFixed(3)) : 0
  }]));
  for (const [alias, field] of Object.entries({ genre: "classification", blurb: "description", doors: "doorTime", end: "endTime", venuePolicy: "agePolicy" })) {
    fieldCoverage[alias] = fieldCoverage[field];
  }
  return {
    evidenceCount,
    modelEligibleCount,
    fieldCoverage
  };
}
function normalizeFactValue(value, field) {
  if (Array.isArray(value)) {
    const values = value.flatMap((item) => Array.isArray(item) ? item : [item]).map((item) => normalizeFactValue(item, "text")).filter(Boolean);
    return [...new Set(values)];
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== "").map(([key, item]) => [key, typeof item === "string" ? cleanText(item, 500) : item]));
  }
  if (typeof value === "string") return cleanText(value, field === "description" ? 280 : 300);
  return value;
}
function cleanText(value, maxLength) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function factPreference(fact) {
  return (fact.confidence === "verified" ? 3 : fact.confidence === "partial" ? 2 : 1) + (fact.permission?.modelInput ? 1 : 0) + (fact.permission?.display ? 0.25 : 0);
}
function sameFactValue(left, right) {
  return JSON.stringify(left?.value) === JSON.stringify(right?.value);
}
function opaqueEvidenceRef(evidence, field) {
  return `event/${field}`;
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
    const body = await requestJson4(url, fetchImpl);
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
  const localTime2 = event.dates?.start?.localTime ?? null;
  const retrieved = new Date(retrievedAt).toISOString();
  const sourceEventId = String(event.id);
  const sourceUrl = String(event.url ?? "");
  const title = cleanText2(event.name);
  const startLocal = localDate3 ? `${localDate3}T${localTime2 || "00:00:00"}` : null;
  const startUtc = event.dates?.start?.dateTime ?? null;
  const doorsUtc = event.dates?.start?.doorsDateTime ?? null;
  const endUtc = event.dates?.end?.dateTime ?? null;
  const doorsLocal = event.dates?.start?.doorsLocalDate && event.dates?.start?.doorsLocalTime ? `${event.dates.start.doorsLocalDate}T${event.dates.start.doorsLocalTime}` : null;
  const endLocal = event.dates?.end?.localDate ? `${event.dates.end.localDate}T${event.dates.end.localTime || "00:00:00"}` : null;
  const classifications = ticketmasterClassifications(event);
  const namedLineup = attractions.map((attraction) => cleanText2(attraction.name)).filter(Boolean);
  const description = [event.info, event.pleaseNote].map(cleanText2).filter(Boolean).join(" ");
  const venueInfo = {
    name: cleanText2(venue.name),
    city: cleanText2(venue.city?.name),
    state: cleanText2(venue.state?.stateCode ?? venue.state?.name),
    accessibility: cleanText2(venue.accessibility?.info ?? venue.accessibility?.ticketLimit)
  };
  const eventEvidence = createEventEvidence({
    eventRef: `ticketmaster:${sourceEventId}`,
    provider: "ticketmaster",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    facts: {
      title: createEvidenceFact({
        value: title,
        field: "title",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      description: createEvidenceFact({
        value: description,
        field: "description",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        assertionKind: "descriptive-copy",
        permission: { internalUse: true, display: true, modelInput: false, persist: true }
      }),
      classification: createEvidenceFact({
        value: classifications,
        field: "classification",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      namedLineup: createEvidenceFact({
        value: namedLineup,
        field: "namedLineup",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      format: createEvidenceFact({
        value: event.eventType ?? event.format ?? null,
        field: "format",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      doorTime: createEvidenceFact({
        value: doorsLocal ?? doorsUtc,
        field: "doorTime",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      startTime: createEvidenceFact({
        value: { local: startLocal, utc: startUtc },
        field: "startTime",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      endTime: createEvidenceFact({
        value: endLocal ?? endUtc,
        field: "endTime",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      venueInfo: createEvidenceFact({
        value: venueInfo,
        field: "venueInfo",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      }),
      agePolicy: createEvidenceFact({
        value: event.ageRestrictions?.legalAge ?? event.ageRestrictions?.description ?? null,
        field: "agePolicy",
        provider: "ticketmaster",
        sourceEventId,
        sourceUrl,
        retrievedAt: retrieved,
        permission: { internalUse: true, display: true, modelInput: true, persist: true }
      })
    }
  });
  const sourceOccurrence = {
    source: "ticketmaster",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    title,
    startLocal,
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: cleanText2(venue.name),
      city: cleanText2(venue.city?.name),
      state: cleanText2(venue.state?.stateCode ?? venue.state?.name),
      lat: numberOrNull4(venue.location?.latitude),
      lon: numberOrNull4(venue.location?.longitude)
    },
    performerNames: namedLineup,
    evidence: eventEvidence
  };
  return {
    schemaVersion: 1,
    id: `ticketmaster:${sourceEventId}`,
    source: "ticketmaster",
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [sourceOccurrence],
    eventEvidence,
    retrievedAt: retrieved,
    title,
    type: "concert",
    startLocal,
    startUtc,
    doorsLocal,
    endLocal,
    timeTbd: Boolean(event.dates?.start?.timeTBA || !localTime2),
    dateTbd: Boolean(event.dates?.start?.dateTBA || !localDate3),
    status: event.dates?.status?.code ?? "scheduled",
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: cleanText2(venue.name),
      city: cleanText2(venue.city?.name),
      state: cleanText2(venue.state?.stateCode ?? venue.state?.name),
      lat: numberOrNull4(venue.location?.latitude),
      lon: numberOrNull4(venue.location?.longitude)
    },
    performers: attractions.map((attraction, index) => ({
      sourceId: attraction.id ? String(attraction.id) : null,
      name: cleanText2(attraction.name),
      primary: index === 0,
      spotifyId: null
    })).filter((performer) => performer.name),
    ticketObservation: {
      listingCount: null,
      lowestPriceUsd: numberOrNull4(event.priceRanges?.[0]?.min),
      averagePriceUsd: null,
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}
function ticketmasterClassifications(event) {
  const values = [];
  for (const classification of event.classifications ?? []) {
    for (const [parent, child] of [["segment", null], ["genre", "subGenre"], ["type", "subType"]]) {
      const value = cleanText2(classification?.[parent]?.name);
      const eventStyle = /^event style$/i.test(value);
      if (parent !== "type" || eventStyle) {
        if (value) values.push(value);
      }
      if (child && eventStyle) {
        const detail = cleanText2(classification?.[child]?.name);
        if (detail) values.push(detail);
      }
    }
  }
  return meaningfulClassifications(values, { provider: "ticketmaster" });
}
function cleanText2(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, 1200);
}
async function requestJson4(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Ticketmaster request failed (${response.status}).`);
  return response.json();
}
function numberOrNull4(value) {
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
  const retrieved = new Date(retrievedAt).toISOString();
  const sourceEventId = String(event.id);
  const sourceUrl = String(event.url ?? event.website ?? "");
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
    state: decodeText(venue.stateprovince ?? ""),
    address: decodeText(venue.address ?? venue.address_line_1 ?? venue.street)
  };
  const eventEvidence = createEventEvidence({
    eventRef: `framework:${sourceEventId}`,
    provider: "framework",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    facts: {
      title: frameworkFact(title, "title", { sourceEventId, sourceUrl, retrieved }),
      description: frameworkFact(description, "description", {
        sourceEventId,
        sourceUrl,
        retrieved,
        assertionKind: "descriptive-copy",
        permission: { internalUse: true, display: true, modelInput: false, persist: true }
      }),
      classification: frameworkFact(classifications, "classification", { sourceEventId, sourceUrl, retrieved }),
      namedLineup: hasExplicitLineup ? frameworkFact(performers.map((performer) => performer.name), "namedLineup", { sourceEventId, sourceUrl, retrieved }) : null,
      format: frameworkFact(event.format ?? event.event_type ?? null, "format", { sourceEventId, sourceUrl, retrieved }),
      doorTime: frameworkFact(doorsLocal, "doorTime", { sourceEventId, sourceUrl, retrieved }),
      startTime: frameworkFact(publishedStartLocal, "startTime", { sourceEventId, sourceUrl, retrieved }),
      endTime: frameworkFact(endLocal, "endTime", { sourceEventId, sourceUrl, retrieved }),
      venueInfo: frameworkFact(venueInfo, "venueInfo", { sourceEventId, sourceUrl, retrieved }),
      agePolicy: frameworkFact(event.age_policy ?? event.ageRestriction ?? event.age_restrictions, "agePolicy", { sourceEventId, sourceUrl, retrieved })
    }
  });
  const sourceOccurrence = {
    source: "framework",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    title,
    startLocal,
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: decodeText(venue.venue),
      city: decodeText(venue.city),
      state: decodeText(venue.stateprovince ?? ""),
      lat: numberOrNull5(venue.geo_lat),
      lon: numberOrNull5(venue.geo_lng)
    },
    performerNames: performers.map((performer) => performer.name),
    evidence: eventEvidence
  };
  return {
    schemaVersion: 1,
    id: `framework:${sourceEventId}`,
    source: "framework",
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [sourceOccurrence],
    eventEvidence,
    retrievedAt: retrieved,
    title,
    type: "concert",
    startLocal,
    startUtc: event.utc_start_date ? `${String(event.utc_start_date).replace(" ", "T")}Z` : null,
    doorsLocal,
    endLocal,
    // An all-day listing has a date but no published clock time.
    timeTbd: allDay,
    dateTbd: false,
    status: event.status ?? "scheduled",
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: decodeText(venue.venue),
      city: decodeText(venue.city),
      state: decodeText(venue.stateprovince ?? ""),
      lat: numberOrNull5(venue.geo_lat),
      lon: numberOrNull5(venue.geo_lng)
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
function frameworkFact(value, field, { sourceEventId, sourceUrl, retrieved, assertionKind = "published-fact", permission } = {}) {
  return createEvidenceFact({
    value,
    field,
    provider: "framework",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    assertionKind,
    permission: permission ?? { internalUse: true, display: true, modelInput: true, persist: true }
  });
}
function isAllDay(event) {
  const flag = event.all_day ?? event.allDay;
  if (flag === true || flag === "true" || flag === 1 || flag === "1") return true;
  const start = String(event.start_date ?? event.startDate ?? event.start ?? "");
  const end = String(event.end_date ?? event.endDate ?? event.end ?? "");
  return /\b00:00(:00)?$/.test(start) && /\b23:59(:\d{2})?$/.test(end);
}
function isEndOfDaySentinel(endLocal, startLocal) {
  if (!endLocal) return true;
  if (/T23:59(:\d{2})?$/.test(endLocal)) return true;
  return /T00:00(:00)?$/.test(endLocal) && endLocal.slice(0, 10) === String(startLocal ?? "").slice(0, 10);
}
function frameworkClassifications(event) {
  const values = [];
  for (const source of [event.tags, event.categories, event.category, event.genre]) {
    const items = Array.isArray(source) ? source : source == null ? [] : [source];
    for (const item of items) {
      const value = typeof item === "object" ? item.name ?? item.title ?? item.slug : item;
      const normalized = decodeText(value);
      if (normalized) values.push(normalized);
    }
  }
  return meaningfulClassifications(values, { provider: "framework" });
}
function frameworkPerformersFromEvent(event, title) {
  const raw = event.performers ?? event.artists ?? event.artistNames ?? event.lineup;
  if (!raw) return frameworkPerformers(title);
  const values = Array.isArray(raw) ? raw : [raw];
  const performers = values.map((item, index) => {
    const name = decodeText(typeof item === "object" ? item.name ?? item.title : item);
    return { sourceId: typeof item === "object" && item.id ? String(item.id) : null, name, primary: index === 0, spotifyId: null };
  }).filter((performer) => performer.name);
  return performers.length ? performers : frameworkPerformers(title);
}
function hasExplicitFrameworkPerformers(event) {
  const raw = event.performers ?? event.artists ?? event.artistNames ?? event.lineup;
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.some((item) => decodeText(typeof item === "object" ? item.name ?? item.title : item));
  return Boolean(decodeText(raw));
}
function frameworkPerformers(title) {
  const cleaned = decodeText(title).replace(/^framework\s+presents\s*/i, "").replace(/\([^)]*(?:show added|open\s+to\s+close)[^)]*\)/gi, "").trim();
  return cleaned.split(/\s+b2b\s+|\s+&\s+/i).map((name, index) => ({ sourceId: null, name: name.trim(), primary: index === 0, spotifyId: null })).filter((performer) => performer.name);
}
function normalizeLocalDate(value) {
  const text2 = String(value ?? "").trim();
  return text2 ? text2.replace(" ", "T") : null;
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
  const text2 = String(value ?? "").trim();
  if (!text2) return null;
  try {
    const url = new URL(text2, ARTISTS_URL);
    if (url.origin !== "https://thisisframework.com") return null;
    const match = url.pathname.match(/^\/artist\/([^/]+)\/?$/i);
    return match ? `https://thisisframework.com/artist/${match[1]}/` : null;
  } catch {
    return null;
  }
}
function numberOrNull5(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ../src/insomniac.js
var EVENTS_URL2 = "https://www.insomniac.com/events/los-angeles-ca/";
var INSOMNIAC_ADAPTER_VERIFIED = false;
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
  if (!events.length) {
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
  const title = cleanText3(event.title ?? event.name ?? event.eventName ?? "");
  const startLocal = normalizeStartLocal(event.startLocal ?? event.startDate ?? event.start_date ?? event.date);
  const sourceUrl = String(event.sourceUrl ?? event.url ?? event.link ?? EVENTS_URL2).trim();
  const sourceEventId = String(event.sourceEventId ?? event.id ?? stableId(`${title}|${startLocal}|${sourceUrl}`));
  const performers = normalizePerformers(event.performers ?? event.performer ?? event.artistNames ?? event.artists, title);
  const venue = event.venue ?? event.location ?? {};
  const status = cleanText3(event.status ?? event.availability ?? "scheduled").toLowerCase() || "scheduled";
  const retrieved = new Date(retrievedAt).toISOString();
  const endLocal = normalizeStartLocal(event.endLocal ?? event.endDate ?? event.end_date ?? event.endTime);
  const doorsLocal = normalizeStartLocal(event.doorsLocal ?? event.doorsDate ?? event.doors_date ?? event.doors);
  const classifications = [event.genre, event.category, event.type, event.format].flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => cleanText3(typeof value === "object" ? value?.name : value)).filter(Boolean);
  const eventEvidence = createEventEvidence({
    eventRef: `insomniac:${sourceEventId}`,
    provider: "insomniac",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    facts: {
      title: insomniacFact(title, "title", sourceEventId, sourceUrl, retrieved),
      description: insomniacFact(event.description ?? event.summary ?? null, "description", sourceEventId, sourceUrl, retrieved, {
        assertionKind: "descriptive-copy",
        permission: { internalUse: true, display: true, modelInput: false, persist: true }
      }),
      classification: insomniacFact([...new Set(classifications)], "classification", sourceEventId, sourceUrl, retrieved),
      namedLineup: insomniacFact(performers.map((performer) => performer.name), "namedLineup", sourceEventId, sourceUrl, retrieved),
      format: insomniacFact(event.format ?? event.eventType ?? null, "format", sourceEventId, sourceUrl, retrieved),
      doorTime: insomniacFact(doorsLocal, "doorTime", sourceEventId, sourceUrl, retrieved),
      startTime: insomniacFact(startLocal, "startTime", sourceEventId, sourceUrl, retrieved),
      endTime: insomniacFact(endLocal, "endTime", sourceEventId, sourceUrl, retrieved),
      venueInfo: insomniacFact({
        name: cleanText3(venue.name ?? venue.venue ?? event.venueName),
        city: cleanText3(venue.city ?? event.city),
        state: cleanText3(venue.state ?? venue.stateCode ?? event.state)
      }, "venueInfo", sourceEventId, sourceUrl, retrieved),
      agePolicy: insomniacFact(event.agePolicy ?? event.ageRestriction ?? event.age_restrictions, "agePolicy", sourceEventId, sourceUrl, retrieved)
    }
  });
  return {
    schemaVersion: 1,
    id: `insomniac:${sourceEventId}`,
    source: "insomniac",
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [{
      source: "insomniac",
      sourceEventId,
      sourceUrl,
      retrievedAt: retrieved,
      title,
      startLocal,
      venue: {
        sourceId: event.venueId ?? venue.id ? String(event.venueId ?? venue.id) : null,
        name: cleanText3(venue.name ?? venue.venue ?? event.venueName),
        city: cleanText3(venue.city ?? event.city),
        state: cleanText3(venue.state ?? venue.stateCode ?? event.state),
        lat: numberOrNull6(venue.lat ?? venue.latitude),
        lon: numberOrNull6(venue.lon ?? venue.longitude)
      },
      performerNames: performers.map((performer) => performer.name),
      evidence: eventEvidence
    }],
    eventEvidence,
    retrievedAt: retrieved,
    title,
    type: isFestival(title, event.type) ? "music_festival" : "concert",
    startLocal,
    startUtc: event.startUtc ?? event.startDateTime ?? null,
    doorsLocal,
    endLocal,
    timeTbd: !hasTime(startLocal),
    dateTbd: !startLocal,
    status,
    venue: {
      sourceId: event.venueId ?? venue.id ? String(event.venueId ?? venue.id) : null,
      name: cleanText3(venue.name ?? venue.venue ?? event.venueName ?? "Los Angeles"),
      city: cleanText3(venue.city ?? event.city ?? "Los Angeles"),
      state: cleanText3(venue.state ?? venue.stateCode ?? event.state ?? "CA"),
      lat: numberOrNull6(venue.lat ?? venue.latitude),
      lon: numberOrNull6(venue.lon ?? venue.longitude)
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
function insomniacFact(value, field, sourceEventId, sourceUrl, retrieved, extra = {}) {
  return createEvidenceFact({
    value,
    field,
    provider: "insomniac",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    permission: { internalUse: true, display: true, modelInput: false, persist: true },
    ...extra
  });
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
  return cleanText3(value).replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeStartLocal(value) {
  const text2 = cleanText3(value);
  if (!text2) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text2)) return text2.replace(/([+-]\d{2}:?\d{2}|Z)$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text2)) return `${text2}T00:00:00`;
  const match = text2.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*[-+]\s*\d{1,2})?,?\s+(\d{4})\b/i);
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
function cleanText3(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function decodeHtml(value) {
  return String(value ?? "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#x2F;|&#47;/gi, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function numberOrNull6(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function stableId(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `generated-${(hash >>> 0).toString(16)}`;
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
    semanticInsight: event.semanticInsight ?? null,
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
  return localDateDifference(value, now);
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

// ../src/diagnostics.js
import { createHash } from "node:crypto";
var TIMESTAMP_KEYS = /* @__PURE__ */ new Set([
  "generatedAt",
  "retrievedAt",
  "observedAt",
  "fetchedAt",
  "expiresAt",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "lastSuccessfulRefresh",
  "cacheExpiry",
  "lastUsableFreshness"
]);
var UNORDERED_ARRAY_KEYS = /* @__PURE__ */ new Set([
  "sourceHealth",
  "sourceLinks",
  "sourceOccurrences",
  "sources",
  "warnings",
  "genres",
  "tags",
  "reasons",
  "ticketObservations",
  "decisionPreferences",
  "background"
]);
var UNSUPPORTED_CLAIMS = /\b(?:sell[ -]?out|scarcity|limited availability|access loss|loss of access|will disappear|tickets? (?:disappear|vanish)|become unavailable)\b/i;
function sanitizeDiagnosticString(value, context = {}) {
  let output = String(value ?? "");
  if (!output) return output;
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]").replace(/((?:access[_-]?token|api[_-]?key|client[_-]?id|secret|password|token))=([^&\s]+)/gi, "$1=[REDACTED]").replace(/https?:\/\/[^\s)]+/gi, (url) => sanitizePublicUrl(url));
  if (UNSUPPORTED_CLAIMS.test(output) && context.kind === "model-error") return "unsupported scarcity claim";
  return output.slice(0, 500);
}
function sanitizeErrorMessage(error) {
  return sanitizeDiagnosticString(error?.message ?? String(error ?? ""), { kind: "model-error" });
}
function sanitizePublicUrl(value) {
  if (value == null || value === "") return value == null ? null : "";
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[URL REDACTED]";
  }
}
function containsUnsupportedModelClaim(value) {
  if (typeof value === "string") return UNSUPPORTED_CLAIMS.test(value);
  if (Array.isArray(value)) return value.some(containsUnsupportedModelClaim);
  if (value && typeof value === "object") return Object.values(value).some(containsUnsupportedModelClaim);
  return false;
}
function normalizeProjectionForComparison(value, path = []) {
  if (Array.isArray(value)) {
    const key = path.at(-1);
    const normalized = value.map((item, index) => normalizeProjectionForComparison(item, [...path, String(index)]));
    return UNORDERED_ARRAY_KEYS.has(key) ? sortStable(normalized) : normalized;
  }
  if (value == null || typeof value !== "object") return value;
  const output = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    output[key] = TIMESTAMP_KEYS.has(key) ? typeof value[key] === "string" && value[key] ? "[TIMESTAMP]" : value[key] : normalizeProjectionForComparison(value[key], [...path, key]);
  }
  return output;
}
function digestValue(value) {
  return createHash("sha256").update(JSON.stringify(normalizeProjectionForComparison(value))).digest("hex");
}
function sortStable(items) {
  return [...items].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

// ../src/eventEnhancement.js
function classifyEventType(event) {
  const title = String(event.title ?? "").toLowerCase();
  if (title.includes("festival") || (event.performers?.length ?? 0) >= 6) return "festival";
  if (title.includes("dj set") || title.includes("open to close")) return "dj set";
  return "concert";
}

// ../src/nightlife/semanticInput.js
var SEMANTIC_INPUT_SCHEMA_VERSION = 2;
var PERMITTED_EVIDENCE_PROVIDERS2 = ["ticketmaster", "framework"];
var FIELD_PROVENANCE = {
  ref: "derived",
  eventType: "derived",
  daysUntil: "derived",
  dayOfWeek: "derived",
  startPeriod: "derived",
  startClock: "permitted-provider",
  providerContext: "permitted-provider",
  eventTitle: "permitted-provider",
  venueName: "permitted-provider",
  neighborhood: "permitted-provider",
  city: "permitted-provider",
  namedPerformerCount: "permitted-provider",
  advertisedPriceUsd: "permitted-provider",
  publishedFacts: "permitted-provider",
  travelMinutesEstimate: "derived",
  knownUnknowns: "derived"
};
var RESTRICTED_KEY = /(?:seatgeek|spotify|edmtrain|playlist|affinity|seed.?strength|top.?artists|personal.?context|feedback|lastfm.?similar|api.?key|token|secret)/i;
var RESTRICTED_VALUE = /(?:seatgeek\.com|open\.spotify\.com|edmtrain\.com|api\.seatgeek|spotify:artist)/i;
var SourcePolicyError = class extends Error {
};
function nightlifeEvidenceFor(candidate) {
  const occurrences = candidate.sourceOccurrences ?? [];
  if (!occurrences.length && Array.isArray(candidate.sources)) return evidenceFromPublishedRow(candidate);
  const sources = new Set(occurrences.map((occurrence) => occurrence.source));
  const evidence = buildEventEvidence(candidate);
  const facts = evidence.permittedFacts ?? {};
  const permittedProviders = [...new Set(Object.values(facts).map((fact) => fact?.provider).filter((provider) => PERMITTED_EVIDENCE_PROVIDERS2.includes(provider)))];
  for (const occurrence of occurrences) {
    if (PERMITTED_EVIDENCE_PROVIDERS2.includes(occurrence.source)) permittedProviders.push(occurrence.source);
  }
  const uniquePermittedProviders = [...new Set(permittedProviders)];
  const permitted = occurrences.find((occurrence) => uniquePermittedProviders.includes(occurrence.source)) ?? null;
  const venueFact = facts.venueInfo?.value;
  const venue = permitted?.venue ?? (venueFact && typeof venueFact === "object" ? venueFact : null);
  const title = facts.title?.value ?? permitted?.title ?? null;
  const namedLineup = Array.isArray(facts.namedLineup?.value) ? facts.namedLineup.value : permitted?.performerNames ?? [];
  const price = candidate.ticketObservation?.lowestPriceUsd;
  return {
    restricted: !uniquePermittedProviders.length,
    provider: uniquePermittedProviders[0] ?? permitted?.source ?? null,
    title,
    venueName: venue?.name ?? null,
    city: venue?.city ?? null,
    venuePoint: Number.isFinite(venue?.lat) && Number.isFinite(venue?.lon) ? { lat: venue.lat, lon: venue.lon } : null,
    namedPerformerCount: namedLineup.filter(Boolean).length,
    // Quoted only when no restricted provider contributed to the merged
    // ticket observation at all.
    advertisedPriceUsd: !sources.has("seatgeek") && Number.isFinite(price) ? Math.round(price) : null
  };
}
function evidenceFromPublishedRow(candidate) {
  const sources = new Set(candidate.sources ?? []);
  const permitted = PERMITTED_EVIDENCE_PROVIDERS2.find((source) => sources.has(source));
  const restricted = sources.has("seatgeek") || !permitted;
  const price = candidate.ticketObservation?.lowestPriceUsd;
  return {
    restricted,
    provider: restricted ? null : permitted,
    title: restricted ? null : candidate.title ?? null,
    venueName: restricted ? null : candidate.venue?.name ?? null,
    city: restricted ? null : candidate.venue?.city ?? null,
    venuePoint: !restricted && Number.isFinite(candidate.venue?.lat) && Number.isFinite(candidate.venue?.lon) ? { lat: candidate.venue.lat, lon: candidate.venue.lon } : null,
    namedPerformerCount: restricted ? 0 : (candidate.performers ?? []).filter((performer) => performer?.name).length,
    advertisedPriceUsd: !restricted && Number.isFinite(price) ? Math.round(price) : null
  };
}
function buildSemanticCandidateInput(candidate, { ref, now = /* @__PURE__ */ new Date(), startArea = null, transport = "drive" } = {}) {
  if (!ref) throw new SourcePolicyError("A candidate input requires an opaque ref.");
  const evidence = candidate.nightlifeEvidence ?? nightlifeEvidenceFor(candidate);
  const fullEvidence = evidence.eventEvidence ?? buildEventEvidence(candidate);
  const serializedModelEvidence = serializeEventEvidenceForModel(fullEvidence);
  const modelPublishedFacts = evidence.publishedFacts ?? serializedModelEvidence.publishedFacts;
  const restricted = evidence.restricted;
  const start = candidate.startLocal ? new Date(candidate.startLocal) : null;
  const hasTime2 = Boolean(start && !Number.isNaN(start.getTime()) && !candidate.timeTbd);
  const fields = {
    ref,
    eventType: classifyEventType(candidate),
    daysUntil: daysUntil2(candidate.startLocal, now),
    dayOfWeek: start ? weekday(start) : "unknown",
    startPeriod: startPeriodFor(start, candidate.timeTbd)
  };
  if (!restricted && Object.keys(modelPublishedFacts).length) {
    fields.publishedFacts = modelPublishedFacts;
  }
  if (!restricted) {
    if (hasTime2) fields.startClock = clock(start);
    fields.providerContext = evidence.provider;
    if (evidence.title) fields.eventTitle = evidence.title;
    if (evidence.venueName) fields.venueName = evidence.venueName;
    if (evidence.city) fields.city = evidence.city;
    const area = coarseArea({ city: evidence.city, ...evidence.venuePoint ?? {} });
    if (area) fields.neighborhood = area;
    fields.namedPerformerCount = evidence.namedPerformerCount;
    if (evidence.advertisedPriceUsd != null) fields.advertisedPriceUsd = evidence.advertisedPriceUsd;
    const travel = travelMinutes(evidence.venuePoint, startArea, transport);
    if (travel != null) fields.travelMinutesEstimate = travel;
  }
  fields.knownUnknowns = [.../* @__PURE__ */ new Set([
    ...knownUnknownsFor({ restricted, hasTime: hasTime2, evidence, fields }),
    ...serializedModelEvidence.knownUnknowns
  ])];
  const input = {
    ref,
    restricted,
    fields,
    evidenceRefs: [
      ...Object.keys(fields).filter((key) => key !== "ref" && key !== "knownUnknowns").filter((key) => key !== "publishedFacts").map((key) => `${ref}/${key}`),
      ...Object.keys(fields.publishedFacts ?? {}).map((field) => `${ref}/publishedFacts/${field}`)
    ]
  };
  assertFieldProvenance(fields);
  return input;
}
function buildSemanticRequest(candidates, context, { now = /* @__PURE__ */ new Date() } = {}) {
  const inputs = candidates.map((candidate, index) => buildSemanticCandidateInput(candidate, {
    ref: `cand-${index + 1}`,
    now,
    startArea: context?.startArea ?? null,
    transport: context?.transport ?? "drive"
  }));
  const evidenceOnly = inputs.length > 0 && inputs.every((input) => Object.keys(input.fields?.publishedFacts ?? {}).length > 0);
  const payload = {
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    ...evidenceOnly ? {} : { context: serializeContext(context) },
    candidates: inputs.map((input) => {
      const { ref, restricted, fields } = input;
      if (Object.keys(fields?.publishedFacts ?? {}).length) {
        return {
          event: {
            ref,
            published: fields.publishedFacts,
            missing: fields.knownUnknowns ?? []
          }
        };
      }
      return { ref, restricted, ...omitRef(fields) };
    })
  };
  assertNoRestrictedEvidence(payload);
  return { payload, inputs };
}
function serializeContext(context = {}) {
  const output = {
    goal: cappedText(context.goal, 400),
    date: context.window?.date ?? null,
    earliestStart: context.window?.earliestStart ?? null,
    latestReturn: context.window?.latestReturn ?? null,
    startArea: context.startArea?.label ?? null,
    transport: context.transport ?? null,
    budgetUsd: Number.isFinite(context.budgetUsd) ? context.budgetUsd : null,
    party: context.party ?? null,
    preferredMusic: (context.preferredMusic ?? []).slice(0, 8).map((value) => cappedText(value, 40)),
    energy: context.energy ?? null,
    lateNightIntent: context.lateNightIntent ?? null,
    noveltyAppetite: context.noveltyAppetite ?? null
  };
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value != null && value !== ""));
}
function assertNoRestrictedEvidence(payload) {
  walk(payload, []);
  return payload;
  function walk(value, path) {
    if (typeof value === "string") {
      if (RESTRICTED_VALUE.test(value)) {
        throw new SourcePolicyError(`Restricted source evidence reached the model payload at ${path.join(".") || "root"}.`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, [...path, String(index)]));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (RESTRICTED_KEY.test(key)) {
        throw new SourcePolicyError(`Restricted field "${key}" reached the model payload at ${[...path, key].join(".")}.`);
      }
      walk(entry, [...path, key]);
    }
  }
}
function assertFieldProvenance(fields) {
  for (const key of Object.keys(fields)) {
    if (!FIELD_PROVENANCE[key]) {
      throw new SourcePolicyError(`Field "${key}" has no declared provenance and may not be serialized.`);
    }
  }
}
function knownUnknownsFor({ restricted, hasTime: hasTime2, evidence, fields }) {
  const unknowns = [];
  if (!fields.publishedFacts?.endTime) unknowns.push("end-time");
  unknowns.push("closing-hours", "after-hours");
  if (!hasTime2) unknowns.push("capacity");
  if (restricted || !fields.namedPerformerCount) unknowns.push("lineup");
  if (restricted) unknowns.push("genre", "neighborhood");
  else if (!fields.publishedFacts?.classification && !fields.publishedFacts?.description) unknowns.push("genre");
  else if (!evidence?.city) unknowns.push("neighborhood");
  if (!fields.publishedFacts?.agePolicy) unknowns.push("age-policy");
  unknowns.push("ticket-availability");
  if (fields.advertisedPriceUsd == null) unknowns.push("cover-price");
  return [...new Set(unknowns)];
}
function omitRef(fields) {
  const { ref: _ref, ...rest } = fields;
  return rest;
}
function daysUntil2(startLocal, now) {
  const start = new Date(startLocal);
  return Number.isNaN(start.getTime()) ? null : Math.max(0, Math.ceil((start.getTime() - new Date(now).getTime()) / 864e5));
}
function weekday(start) {
  return start && !Number.isNaN(start.getTime()) ? start.toLocaleDateString("en-US", { weekday: "long" }) : "unknown";
}
function clock(start) {
  return `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
}
function startPeriodFor(start, timeTbd) {
  if (timeTbd || !start || Number.isNaN(start.getTime())) return "unknown";
  const hour = start.getHours();
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "late";
}
function coarseArea(venue) {
  if (!venue) return null;
  const city = String(venue.city ?? "").trim();
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return city || null;
  const area = LA_AREAS.find((candidate) => distanceMiles4(venue.lat, venue.lon, candidate.lat, candidate.lon) <= candidate.radiusMiles);
  return area?.label ?? (city || null);
}
var LA_AREAS = [
  { label: "Downtown / Arts District", lat: 34.043, lon: -118.24, radiusMiles: 3 },
  { label: "Hollywood", lat: 34.0983, lon: -118.3267, radiusMiles: 3 },
  { label: "Silver Lake / Echo Park", lat: 34.087, lon: -118.26, radiusMiles: 2.5 },
  { label: "Westside", lat: 34.0195, lon: -118.4912, radiusMiles: 6 },
  { label: "South Bay", lat: 33.8847, lon: -118.4109, radiusMiles: 8 },
  { label: "San Fernando Valley", lat: 34.187, lon: -118.448, radiusMiles: 10 },
  { label: "Long Beach", lat: 33.7701, lon: -118.1937, radiusMiles: 6 },
  { label: "Pasadena / San Gabriel Valley", lat: 34.1478, lon: -118.1445, radiusMiles: 8 }
];
var TRANSPORT_MPH = { walk: 3, transit: 12, rideshare: 20, drive: 22, bike: 9 };
function travelMinutes(venue, startArea, transport = "drive") {
  if (!venue || !startArea || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return null;
  if (!Number.isFinite(startArea.lat) || !Number.isFinite(startArea.lon)) return null;
  const miles = distanceMiles4(venue.lat, venue.lon, startArea.lat, startArea.lon);
  const mph = TRANSPORT_MPH[transport] ?? TRANSPORT_MPH.drive;
  return Math.round(miles / mph * 60);
}
function distanceMiles4(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function cappedText(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max) : null;
}

// ../src/nightlife/personalRelevance.js
var DIRECT_ORIGINS = /* @__PURE__ */ new Set(["source", "top-items"]);
var DISTINCT_EXPERIENCES = /* @__PURE__ */ new Set(["dance_floor", "festival_multi_stage", "seated_listening"]);
var USABLE_CERTAINTY = /* @__PURE__ */ new Set(["high", "moderate"]);
var DESCRIPTIVE_MODEL_FACTS = ["classification", "format", "namedLineup"];
function preferenceSignalsFor(candidate, preferences = {}) {
  const directArtists = [];
  const matched = [...candidate?.matchedArtists ?? []].sort((left, right) => Number(Boolean(right?.primary)) - Number(Boolean(left?.primary)));
  for (const artist of matched) {
    const name = String(artist?.name ?? "").trim();
    if (!name || !DIRECT_ORIGINS.has(artist.origin)) continue;
    if (!directArtists.includes(name)) directArtists.push(name);
  }
  const topTags = [...new Set((preferences?.topTags ?? []).map((tag) => normalizeTag(tag)).filter(Boolean))];
  return { directArtists, topTags };
}
function eventExperienceFor({ facts = {}, modelFacts = {}, assessment = null } = {}) {
  const classifications = listValues(facts.classification?.value);
  if (classifications.some((value) => /\bfestival\b/i.test(value))) {
    return {
      experience: "festival_multi_stage",
      basis: "documented-attribute",
      facts: [facts.classification, facts.namedLineup].filter(Boolean)
    };
  }
  const format = textValue(facts.format?.value);
  const documented = format ? formatExperience(format) : null;
  if (documented) return { experience: documented, basis: "documented-attribute", facts: [facts.format] };
  const characterized = assessment?.experienceCharacter;
  if (!DISTINCT_EXPERIENCES.has(characterized)) return null;
  if (!USABLE_CERTAINTY.has(assessment?.certainty?.experienceCharacter)) return null;
  const grounding = DESCRIPTIVE_MODEL_FACTS.filter((field) => modelFacts[field] != null && facts[field]);
  if (!grounding.length) return null;
  return {
    experience: characterized,
    basis: "model-characterization",
    characterization: "experienceCharacter",
    facts: [...grounding, "startTime"].map((field) => facts[field]).filter(Boolean)
  };
}
function assessPersonalRelevance({ candidate, facts = {}, modelFacts = {}, assessment = null, preferences = {} } = {}) {
  const signals = preferenceSignalsFor(candidate, preferences);
  const claims = [];
  const experience = eventExperienceFor({ facts, modelFacts, assessment });
  const artist = signals.directArtists[0];
  if (artist && experience) {
    const text2 = familiarArtistText(artist, experience.experience, listValues(facts.namedLineup?.value).length);
    if (text2) {
      claims.push({
        comparison: "familiar-artist-in-format",
        text: text2,
        // A calculated match is only as certain as its weaker half. The
        // artist match is exact; the event half may be a model inference.
        status: experience.basis === "documented-attribute" ? "verified" : "inferred",
        basis: "calculated-match",
        eventBasis: experience.basis,
        ...experience.characterization ? { characterization: experience.characterization } : {},
        preference: { signal: "direct-artist", label: `${artist} is in your selected listening` },
        facts: experience.facts
      });
    }
  }
  if (!artist && signals.topTags.length && facts.classification) {
    const genre = listValues(facts.classification.value).find((value) => classificationTokens(value).some((token) => signals.topTags.includes(token)));
    if (genre) {
      claims.push({
        comparison: "taste-tag-genre",
        text: `Published as ${genre}, one of the recurring tags in your taste profile.`,
        status: "verified",
        basis: "calculated-match",
        eventBasis: "documented-attribute",
        preference: { signal: "taste-tag", label: "Recurring taste-profile tag" },
        facts: [facts.classification]
      });
    }
  }
  return claims;
}
function familiarArtistText(artist, experience, lineupCount) {
  if (experience === "festival_multi_stage") {
    return lineupCount >= 3 ? `${artist}, already in your listening, is one of ${lineupCount} named acts on a festival bill.` : `${artist}, already in your listening, plays this as part of a festival.`;
  }
  if (experience === "dance_floor") return `The listing points to a dance-floor set from ${artist}, who is already in your listening.`;
  if (experience === "seated_listening") return `The listing describes a seated show from ${artist}, who is already in your listening.`;
  return null;
}
function formatExperience(format) {
  if (/\bseated\b|\blistening (?:room|session)\b/i.test(format)) return "seated_listening";
  if (/\bdj set\b|\bextended set\b|\bopen to close\b|\ball night long\b|\bb2b\b/i.test(format)) return "dance_floor";
  if (/\bfestival\b/i.test(format)) return "festival_multi_stage";
  return null;
}
function classificationTokens(value) {
  const whole = normalizeTag(value);
  return [...new Set([whole, ...String(value).split(/[/&,]/).map(normalizeTag)].filter(Boolean))];
}
function normalizeTag(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function listValues(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item).trim()).filter(Boolean);
}
function textValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.join(" \xB7 ");
  if (typeof value === "object") return String(value.local ?? value.value ?? "").trim() || null;
  return String(value).trim() || null;
}

// ../src/nightlife/cardInsight.js
var UNINFORMATIVE_CLASSIFICATIONS = /* @__PURE__ */ new Set([
  "music",
  "event style",
  "concert",
  "live",
  "undefined",
  // Ticketmaster attraction types: they describe the act's shape, not its sound.
  "individual",
  "group",
  "musician",
  "other"
]);
var WEIGHT = {
  personalMatch: 100,
  conflict: 90,
  modelExperience: 70,
  documentedFormat: 65,
  // Whether you can get in at all outranks how late it runs.
  agePolicy: 62,
  lateStartNoEnd: 60,
  lateWindow: 55,
  classification: 40,
  eventWindow: 35,
  doorsAndStart: 30
};
var MAX_CLAIMS = 3;
function composeInsightClaims(candidate, assessment = null, { preferences = null } = {}) {
  const evidence = buildEventEvidence(candidate);
  const display = serializeEventEvidenceForDisplay(evidence);
  const facts = display.facts ?? {};
  const conflicts = display.conflicts ?? {};
  const modelFacts = serializeEventEvidenceForModel(evidence).publishedFacts ?? {};
  const claims = [];
  const personal = assessPersonalRelevance({ candidate, facts, modelFacts, assessment, preferences: preferences ?? {} });
  for (const match of personal) {
    claims.push({
      kind: "whyItMayFit",
      weight: WEIGHT.personalMatch,
      text: match.text,
      status: match.status,
      basis: "calculated-match",
      eventBasis: match.eventBasis,
      ...match.characterization ? { characterization: match.characterization } : {},
      comparison: match.comparison,
      preference: match.preference,
      facts: match.facts
    });
  }
  const personalExperience = personal.some((match) => match.comparison === "familiar-artist-in-format");
  const experience = eventExperienceFor({ facts, modelFacts, assessment });
  const modelExperience = !personalExperience && experience?.basis === "model-characterization";
  if (modelExperience) {
    claims.push({
      kind: "whatToExpect",
      weight: WEIGHT.modelExperience,
      text: experienceText(experience.experience),
      status: "inferred",
      basis: "model-characterization",
      eventBasis: "model-characterization",
      characterization: experience.characterization,
      facts: experience.facts
    });
  }
  if (facts.format && !personalExperience) {
    claims.push({
      kind: "whatToExpect",
      weight: WEIGHT.documentedFormat,
      text: `${providerLabel(facts.format.provider)} lists the format as ${factText(facts.format)}.`,
      status: "verified",
      basis: "documented-attribute",
      facts: [facts.format]
    });
  }
  const saidFestival = (personalExperience || modelExperience) && experience?.experience === "festival_multi_stage";
  const informative = factList(facts.classification).filter((value) => !UNINFORMATIVE_CLASSIFICATIONS.has(value.toLowerCase())).filter((value) => !(saidFestival && /festival/i.test(value)));
  if (informative.length) {
    claims.push({
      kind: "whatToExpect",
      weight: WEIGHT.classification,
      text: `${providerLabel(facts.classification.provider)} classifies it as ${informative.slice(0, 2).join(" \xB7 ")}.`,
      status: "verified",
      basis: "documented-attribute",
      facts: [facts.classification]
    });
  }
  const start = localTime(facts.startTime);
  const end = localTime(facts.endTime);
  const doors = localTime(facts.doorTime);
  if (end) {
    const startFact = [facts.startTime, ...conflicts.startTime ?? []].find((fact) => fact && fact.provider === facts.endTime.provider);
    const windowStart = localTime(startFact);
    const nextDay = windowStart ? end.date > windowStart.date : true;
    const lateFinish = nextDay && end.hour >= 1 && end.hour < 7;
    const provider = providerLabel(facts.endTime.provider);
    const window = windowStart ? `${article(windowStart.label)} ${windowStart.label} \u2013 ${end.label} window` : `an end time of ${end.label}`;
    claims.push({
      kind: "worthPlanning",
      weight: lateFinish ? WEIGHT.lateWindow : WEIGHT.eventWindow,
      text: lateFinish ? `${provider} lists ${window}, so plan for a late way home.` : `${provider} lists ${window}.`,
      status: "verified",
      basis: "documented-attribute",
      facts: [startFact, facts.endTime].filter(Boolean)
    });
  } else if (doors && start) {
    claims.push({
      kind: "worthPlanning",
      weight: WEIGHT.doorsAndStart,
      text: `Doors at ${doors.label}, start at ${start.label}, per ${providerLabel(facts.doorTime.provider)}.`,
      status: "verified",
      basis: "documented-attribute",
      facts: [facts.doorTime, facts.startTime]
    });
  }
  for (const field of ["startTime", "endTime"]) {
    const disagreement = timeConflict(facts[field], conflicts[field]);
    if (disagreement) {
      claims.push({
        kind: "worthChecking",
        weight: WEIGHT.conflict,
        text: `${disagreement.summary}; confirm the ${field === "startTime" ? "start" : "finish"} before planning.`,
        status: "not known",
        basis: "conflict",
        facts: [facts[field], ...conflicts[field]]
      });
    }
  }
  const age = ageClaim(candidate, facts, conflicts);
  if (age) claims.push(age);
  if (!end && start && start.late && !candidate?.timeTbd) {
    claims.push({
      kind: "worthChecking",
      weight: WEIGHT.lateStartNoEnd,
      text: `Starts at ${start.label} and no end time is published, so how late it runs is not known.`,
      status: "not known",
      basis: "uncertainty",
      facts: [facts.startTime]
    });
  }
  return claims.sort((left, right) => right.weight - left.weight);
}
function buildSemanticEventInsight(candidate, assessment = null, options = {}) {
  const claims = composeInsightClaims(candidate, assessment, options);
  const byKind = /* @__PURE__ */ new Map();
  for (const claim of claims) {
    if (!byKind.has(claim.kind)) byKind.set(claim.kind, claim);
  }
  const selected = [...byKind.values()].sort((left, right) => right.weight - left.weight).slice(0, MAX_CLAIMS);
  const lead = selected.find((claim) => claim.status !== "not known");
  if (!lead) return null;
  const insight = { summary: lead.text, claimOrder: selected.map((claim) => claim.kind) };
  for (const claim of selected) insight[claim.kind] = publishClaim(claim);
  return insight;
}
function publishClaim(claim) {
  return {
    text: claim.text,
    status: claim.status,
    basis: claim.basis,
    // For a personal match, whether its event half was documented by a source
    // or characterized by Jev. Diagnostics read this; the card does not.
    ...claim.basis === "calculated-match" ? { eventBasis: claim.eventBasis } : {},
    evidence: [
      ...evidenceFor(...claim.facts ?? []),
      ...claim.preference ? [{ source: `Your taste profile: ${claim.preference.label}`, url: null, retrievedAt: null, status: "verified" }] : []
    ]
  };
}
function ageClaim(candidate, facts, conflicts) {
  const policy = facts.agePolicy;
  const displayedTitleAge = ageRestrictionFromText(candidate?.title);
  const policyAge = policy ? ageRestrictionFromText(policy.value) ?? factText(policy) : null;
  const alternative = (conflicts.agePolicy ?? [])[0];
  if (policy && alternative) {
    return {
      kind: "worthChecking",
      weight: WEIGHT.conflict,
      text: `${sourcePhrase(alternative)} says ${alternative.value}, but ${sourcePhrase(policy)} says ${policyAge}; confirm entry before you go.`,
      status: "not known",
      basis: "conflict",
      facts: [policy, alternative]
    };
  }
  if (policy && displayedTitleAge && policyAge && ageRestrictionFromText(policyAge) && ageRestrictionFromText(policyAge) !== displayedTitleAge) {
    return {
      kind: "worthChecking",
      weight: WEIGHT.conflict,
      text: `The listing title says ${displayedTitleAge}, but ${sourcePhrase(policy)} says ${policyAge}; confirm entry before you go.`,
      status: "not known",
      basis: "conflict",
      facts: [policy]
    };
  }
  if (!policy || !policyAge) return null;
  if (displayedTitleAge && displayedTitleAge === ageRestrictionFromText(policyAge)) return null;
  return {
    kind: "worthChecking",
    weight: WEIGHT.agePolicy,
    text: policy.derivedFrom === "title" ? `${providerLabel(policy.provider)}'s listing marks this ${policyAge}.` : `${providerLabel(policy.provider)} lists entry as ${policyAge}.`,
    status: "verified",
    basis: "documented-attribute",
    facts: [policy]
  };
}
function sourcePhrase(fact) {
  const provider = providerLabel(fact.provider);
  return fact.derivedFrom === "title" ? `${provider}'s listing title` : `${provider}'s published policy`;
}
function timeConflict(fact, alternatives = []) {
  const primary = localTime(fact);
  if (!primary) return null;
  const other = alternatives.map((item) => ({ item, time: localTime(item) })).find(({ time }) => time && time.minutes !== primary.minutes);
  if (!other) return null;
  return {
    summary: `${providerLabel(fact.provider)} lists ${primary.label} and ${providerLabel(other.item.provider)} lists ${other.time.label}`
  };
}
function experienceText(value) {
  return {
    dance_floor: "The listing points to a dance-floor night.",
    seated_listening: "The listing points to a seated show.",
    festival_multi_stage: "The listing points to a festival-style, multi-act program."
  }[value] ?? null;
}
function evidenceFor(...facts) {
  const seen = /* @__PURE__ */ new Set();
  return facts.filter(Boolean).flatMap((fact) => {
    const entry = {
      source: providerLabel(fact.provider),
      url: safeHttpUrl(fact.sourceUrl),
      retrievedAt: fact.retrievedAt ?? null,
      status: fact.confidence === "verified" ? "verified" : "inferred"
    };
    const key = `${entry.source}|${entry.url}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [entry];
  });
}
function factText(fact) {
  if (!fact || fact.value == null) return null;
  if (typeof fact.value === "string" || typeof fact.value === "number") return String(fact.value).trim() || null;
  if (Array.isArray(fact.value)) return fact.value.map(String).map((value) => value.trim()).filter(Boolean).join(" \xB7 ") || null;
  const local = fact.value.local ?? fact.value.value ?? null;
  return local == null ? null : String(local).trim() || null;
}
function factList(fact) {
  if (!fact) return [];
  const values = Array.isArray(fact.value) ? fact.value : [fact.value];
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
}
function localTime(fact) {
  const text2 = factText(fact);
  const match = text2?.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  return {
    date: match[1],
    hour,
    minutes: hour * 60 + minute,
    // A start at 9 PM or later, or in the small hours, is a late start.
    late: hour >= 21 || hour < 4,
    label: clockLabel(hour, minute)
  };
}
function article(label) {
  return /^(?:8|11|18)\b/.test(label) ? "an" : "a";
}
function clockLabel(hour, minute) {
  if (hour === 0 && minute === 0) return "midnight";
  const suffix = hour >= 12 ? "PM" : "AM";
  return minute ? `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}` : `${hour % 12 || 12} ${suffix}`;
}
function providerLabel(value) {
  return { ticketmaster: "Ticketmaster", framework: "Framework", insomniac: "Insomniac" }[value] ?? String(value ?? "The source");
}
function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

// ../src/projection.js
function toDisplayEvent(candidate, localEnhancement = null) {
  const occurrences = Array.isArray(candidate?.sourceOccurrences) ? candidate.sourceOccurrences : [];
  const sourceLinks = [...new Map(occurrences.filter((occurrence) => occurrence?.sourceUrl).map((occurrence) => [
    `${occurrence.source}|${occurrence.sourceUrl}`,
    { source: occurrence.source, url: occurrence.sourceUrl }
  ])).values()];
  const { playlistAffinity: _playlistAffinity, topItemsAffinity: _topItemsAffinity, corroborationBonus: _corroborationBonus, ...safeRanking } = candidate?.ranking ?? {};
  return {
    id: candidate.id,
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    sources: [...new Set(occurrences.map((occurrence) => occurrence.source))],
    sourceLinks,
    eventType: classifyEventType(candidate),
    startLocal: candidate.startLocal,
    timeTbd: candidate.timeTbd === true,
    venue: candidate.venue,
    performers: (candidate.performers ?? []).map((performer) => ({ name: performer?.name, primary: performer?.primary === true })),
    ticketObservation: candidate.ticketObservation,
    matchedArtists: (candidate.matchedArtists ?? []).map(({ spotifyArtistId, name, seedStrength, origin, matchMethod, primary }) => ({ spotifyArtistId, name, seedStrength, origin, matchMethod, primary })),
    lineupDisplay: sanitizeLineupDisplay(candidate.lineupDisplay),
    visual: candidate.visual ?? resolveMusicVisual(candidate),
    ranking: safeRanking,
    // Optional and advisory only. Enrichment composes it at refresh time; a
    // caller that ran no enrichment gets the deterministic composition. It
    // never changes ranking or eligibility.
    semanticInsight: "semanticInsight" in candidate ? candidate.semanticInsight ?? null : buildSemanticEventInsight(candidate),
    localEnhancement
  };
}
function sanitizeLineupDisplay(value) {
  if (!value) return null;
  return {
    displayTitle: value.displayTitle || null,
    displayShape: value.displayShape || "general-show",
    orderedArtists: (value.orderedArtists ?? []).map(({ lineupEntryId, displayName, relation, billingGroupIndex, b2bWithNext }) => ({ lineupEntryId, displayName, relation, billingGroupIndex, b2bWithNext })),
    totalArtists: Number(value.totalArtists ?? 0),
    directCount: Number(value.directCount ?? 0),
    adjacentCount: Number(value.adjacentCount ?? 0),
    ages: value.ages || null,
    sourceUrl: value.sourceUrl || null
  };
}
function toDisplaySportsGame(game, localEnhancement = null) {
  const sourceLinks = [...new Map([
    ...(game.sourceOccurrences ?? []).filter((occurrence) => occurrence?.sourceUrl).map((occurrence) => ({ source: occurrence.source, url: occurrence.sourceUrl })),
    ...(game.ticketObservations ?? []).filter((observation) => observation?.url).map((observation) => ({ source: observation.source, url: observation.url }))
  ].map((link) => [`${link.source}|${link.url}`, link])).values()];
  return {
    id: game.id,
    source: "mlb",
    sourceUrl: game.sourceUrl,
    startLocal: game.startLocal,
    timeTbd: game.timeTbd === true,
    venue: game.venue,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    series: game.series,
    sportsContext: game.sportsContext,
    tags: game.tags,
    ticketObservations: game.ticketObservations,
    sourceLinks,
    ranking: game.ranking,
    visual: game.visual ?? resolveSportsVisual(game),
    localEnhancement
  };
}

// ../src/nightlife/assessmentCache.js
function candidateRevision(candidate) {
  return digestValue({
    startLocal: candidate.startLocal ?? null,
    timeTbd: Boolean(candidate.timeTbd),
    status: candidate.status ?? null,
    venue: candidate.venue?.name ?? null,
    sources: [...new Set((candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.source))].sort(),
    sourceEventIds: (candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.sourceEventId ?? null).sort(),
    evidence: (candidate.sourceOccurrences ?? []).map((occurrence) => ({
      source: occurrence.source ?? null,
      sourceEventId: occurrence.sourceEventId ?? null,
      retrievedAt: occurrence.retrievedAt ?? occurrence.evidence?.retrievedAt ?? null,
      evidenceSchemaVersion: occurrence.evidence?.schemaVersion ?? null,
      fields: Object.keys(occurrence.evidence?.permittedFacts ?? {}).sort()
    })).sort((left, right) => `${left.source}|${left.sourceEventId}`.localeCompare(`${right.source}|${right.sourceEventId}`)),
    candidateEvidence: candidate.eventEvidence ? {
      schemaVersion: candidate.eventEvidence.schemaVersion ?? null,
      retrievedAt: candidate.eventEvidence.retrievedAt ?? null,
      fields: Object.entries(candidate.eventEvidence.permittedFacts ?? {}).map(([field, fact]) => [field, fact?.value ?? null, fact?.permission?.modelInput === true]).sort(([left], [right]) => left.localeCompare(right))
    } : null
  });
}
function assessmentCacheKey({
  candidateRevision: revision,
  input,
  context,
  schemaVersion,
  promptVersion,
  questionIds = [],
  evidenceSchemaVersion = null,
  criteriaVersion = null,
  provider,
  model
}) {
  return digestValue({
    revision,
    input,
    context,
    schemaVersion,
    promptVersion,
    questionIds: [...questionIds].sort(),
    evidenceSchemaVersion,
    criteriaVersion,
    provider,
    model
  });
}
function createAssessmentCache({ maxEntries = 500 } = {}) {
  const entries = /* @__PURE__ */ new Map();
  return {
    get(key) {
      if (!entries.has(key)) return null;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    },
    invalidate(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    }
  };
}

// ../src/nightlife/questions.js
var QUESTION_SET_VERSION = 3;
var DEFAULT_CERTAINTY_THRESHOLDS = { high: 0.75, moderate: 0.5 };
var DEFAULT_NOUL_THRESHOLDS = { flag: 0.65, clear: 0.35 };
var SHARED_PREFACE = "You are judging one Los Angeles nightlife candidate for one private person. Some evidence is intentionally withheld by source policy; absent detail is uncertainty, not a negative. Judge only from the supplied state.";
var CHOICE_QUESTIONS = {
  context_fit: {
    field: "contextFit",
    type: "choice",
    instructions: `${SHARED_PREFACE} How well does this candidate match the kind of night the person described in request.goal and the rest of the request?`,
    criteria: {
      strong: "Clearly the kind of night described, on the supplied evidence.",
      possible: "Plausibly matches, with some part of the described night unaddressed.",
      exploratory: "A stretch from what was described, but a reasonable risk worth surfacing.",
      poor: "Contradicts something the person explicitly asked for, such as the wrong night, the wrong energy, or the wrong part of town."
    }
  },
  music_fit: {
    field: "musicAtmosphereFit",
    type: "choice",
    instructions: `${SHARED_PREFACE} How well does the likely music and room atmosphere match request.preferredMusic and request.energy? Judge from the event title, venue, event type and lineup size only. If the lineup or genre was withheld, that is uncertainty.`,
    criteria: {
      strong: "The supplied title, venue or event type points clearly at the music and energy asked for.",
      possible: "Consistent with what was asked for, without direct evidence of the specific sound.",
      weak: "The supplied evidence points at a different sound or a different kind of room."
    }
  },
  late_night_fit: {
    field: "lateNightFit",
    type: "choice",
    instructions: `${SHARED_PREFACE} Does this candidate support staying out as late as request.lateNightIntent describes? No source here publishes an end time or a venue's closing hour, so "confirmed" requires the supplied evidence itself to establish a late schedule.`,
    criteria: {
      confirmed: "The supplied schedule evidence itself establishes a late-running event.",
      possible: "The start time and event type are consistent with a late night, without confirming it.",
      unlikely: "The supplied start time or event type points at an early finish."
    }
  },
  novelty: {
    field: "novelty",
    type: "choice",
    instructions: `${SHARED_PREFACE} How novel is this candidate relative to the person's established taste?`,
    criteria: {
      familiar: "Squarely inside the established taste, on the supplied discovery evidence.",
      adjacent: "One step out: a neighbouring sound, scene or promoter.",
      exploratory: "Genuinely outside the established pattern."
    }
  }
};
var NOUL_QUESTIONS = {
  friction_travel: {
    flag: "long-travel",
    type: "noul",
    instructions: `${SHARED_PREFACE} Getting to this candidate from request.startArea and home again inside the stated window is a real logistical burden, given candidate.travelMinutesEstimate and request.transport.`,
    criteria: {
      true: "The journey is a meaningful cost of the evening.",
      false: "The journey is unremarkable for a night out in Los Angeles."
    }
  },
  friction_timing: {
    flag: "late-start",
    type: "noul",
    instructions: `${SHARED_PREFACE} The start time sits awkwardly against the window the person described, for example starting so late that the earlier part of the evening is wasted, or so early that it conflicts with the stated earliest start.`,
    criteria: {
      true: "The timing works against the described night.",
      false: "The timing fits the described night."
    }
  },
  friction_coordination: {
    flag: "group-coordination",
    type: "noul",
    instructions: `${SHARED_PREFACE} This candidate takes meaningful coordination for the party described in request.party, for example a group needing tickets together or a plan that is awkward to do solo.`,
    criteria: {
      true: "It needs real coordination for the stated party.",
      false: "It is straightforward for the stated party."
    }
  }
};
var EVENT_CHARACTERIZATION_QUESTIONS = {
  event_experience: {
    field: "experienceCharacter",
    requires: ["format", "description", "classification"],
    type: "choice",
    instructions: `${SHARED_PREFACE} Characterize the documented event experience using only the published event facts. Do not infer an experience from the start time alone and do not fill gaps with common knowledge about the venue or promoter.`,
    criteria: {
      dance_floor: "The supplied facts describe a dance-floor or club-oriented experience.",
      live_performance: "The supplied facts describe a live performance or concert experience.",
      seated_listening: "The supplied facts explicitly describe seated, reserved, or listening-room participation.",
      festival_multi_stage: "The supplied facts describe a festival or multi-stage program.",
      mixed_or_other: "The supplied facts describe an experience that does not fit the other categories.",
      unknown: "The supplied facts are insufficient or inconclusive."
    }
  },
  music_character: {
    field: "musicCharacter",
    requires: ["classification", "description", "namedLineup"],
    type: "choice",
    instructions: `${SHARED_PREFACE} Characterize the music evidence that is explicitly published for this event. A missing genre or lineup is uncertainty, not evidence against a style.`,
    criteria: {
      electronic_dance: "The supplied classification or description explicitly points to electronic or dance music.",
      band_or_live: "The supplied classification, description, or named lineup points to a band or live music program.",
      mixed_lineup: "The supplied facts explicitly describe multiple contrasting music formats or a mixed lineup.",
      named_style: "The supplied facts publish a specific music style that is not covered by the other options.",
      unknown: "The supplied facts are insufficient or inconclusive."
    }
  },
  participation_format: {
    field: "participationFormat",
    requires: ["format", "description"],
    type: "choice",
    instructions: `${SHARED_PREFACE} Characterize how a person participates in the event only when the supplied event or venue facts state it. Do not infer standing, seating, or access from a venue name alone.`,
    criteria: {
      standing_or_floor: "The supplied facts explicitly describe standing, floor, or dance-floor participation.",
      seated: "The supplied facts explicitly describe reserved or seated participation.",
      mixed: "The supplied facts explicitly describe both seated and standing/floor participation.",
      not_published: "The supplied facts do not establish a participation format.",
      unknown: "The supplied facts are insufficient or inconclusive."
    }
  },
  schedule_character: {
    field: "scheduleCharacter",
    requires: ["endTime"],
    type: "choice",
    instructions: `${SHARED_PREFACE} Characterize the published event schedule from its door, start, and end facts. Do not infer a late-running event from a late start, event type, or venue reputation.`,
    criteria: {
      published_late_window: "The published event times establish a late-running window.",
      published_early_window: "The published event times establish an early-evening window.",
      published_event_window: "The event publishes a bounded window without establishing an especially early or late character.",
      unknown: "The published times are insufficient or inconclusive."
    }
  },
  entry_policy: {
    field: "entryPolicy",
    requires: ["agePolicy"],
    type: "choice",
    instructions: `${SHARED_PREFACE} Characterize the published age or entry policy. Do not infer age access from the event type, venue, or title.`,
    criteria: {
      age_restricted: "The supplied policy explicitly restricts entry by age.",
      all_ages: "The supplied policy explicitly says the event is all ages or otherwise open by age.",
      policy_other: "The supplied policy is published but does not fit the other options.",
      unknown: "The supplied policy is insufficient or inconclusive."
    }
  },
  venue_character: {
    field: "venueCharacter",
    requires: ["venueInfo", "format"],
    type: "choice",
    instructions: `${SHARED_PREFACE} Characterize the venue or room only from explicit venue metadata and event-format facts. A venue name alone is not enough to assert a room type.`,
    criteria: {
      club_or_dance_room: "The supplied metadata explicitly describes a club or dance-room setting.",
      concert_hall: "The supplied metadata explicitly describes a concert hall or live-room setting.",
      outdoor_or_festival: "The supplied metadata explicitly describes an outdoor or festival setting.",
      other_published: "The supplied metadata establishes a venue character not covered above.",
      unknown: "The supplied metadata is insufficient or inconclusive."
    }
  }
};
function buildQuestionSet({ input = null, legacy = false } = {}) {
  if (legacy) return buildLegacyQuestionSet();
  if (input && Object.keys(input?.fields?.publishedFacts ?? {}).length) {
    return buildEvidenceQuestionSet(input);
  }
  return {};
}
function buildEvidenceQuestionSet(input) {
  const available = new Set(Object.keys(input?.fields?.publishedFacts ?? {}));
  const questions = {};
  for (const [id, definition] of Object.entries(EVENT_CHARACTERIZATION_QUESTIONS)) {
    if (!definition.requires.some((field) => available.has(field))) continue;
    if (id === "schedule_character" && !available.has("endTime")) continue;
    if (id === "venue_character" && !hasExplicitVenueCharacterEvidence(input.fields.publishedFacts?.venueInfo)) continue;
    questions[id] = {
      type: definition.type,
      field: definition.field,
      instructions: definition.instructions,
      criteria: definition.criteria
    };
  }
  return questions;
}
function hasExplicitVenueCharacterEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return ["type", "venueType", "setting", "roomType", "generalInfo", "rules", "accessibility"].some((key) => {
    const item = value[key];
    return typeof item === "string" && item.trim() || Array.isArray(item) && item.length;
  });
}
function buildLegacyQuestionSet() {
  const questions = {};
  for (const [id, definition] of Object.entries(CHOICE_QUESTIONS)) {
    questions[id] = { type: "choice", instructions: definition.instructions, criteria: definition.criteria };
  }
  for (const [id, definition] of Object.entries(NOUL_QUESTIONS)) {
    questions[id] = { type: "noul", instructions: definition.instructions, criteria: definition.criteria };
  }
  return questions;
}
function certaintyBand(confidence, thresholds = DEFAULT_CERTAINTY_THRESHOLDS) {
  if (!Number.isFinite(confidence)) return "low";
  if (confidence >= thresholds.high) return "high";
  if (confidence >= thresholds.moderate) return "moderate";
  return "low";
}
function nulBand(noul, thresholds = DEFAULT_NOUL_THRESHOLDS) {
  if (!Number.isFinite(noul)) return "unknown";
  if (noul >= thresholds.flag) return "yes";
  if (noul <= thresholds.clear) return "no";
  return "unknown";
}

// ../src/nightlife/cardEnrichment.js
async function enrichSemanticEventCards(events = [], options = {}) {
  try {
    return await enrichOrThrow(events, options);
  } catch (error) {
    return {
      byId: /* @__PURE__ */ new Map(),
      assessmentById: /* @__PURE__ */ new Map(),
      assessedCandidateCount: 0,
      enrichedCandidateCount: 0,
      modelEligibleCandidateCount: 0,
      selectedCandidateCount: 0,
      contributions: emptyContributions(),
      failed: true,
      telemetry: {
        status: "enrichment failed",
        errors: [sanitizeErrorMessage(error)],
        coverage: { requested: 0, covered: 0, uncovered: [] }
      }
    };
  }
}
async function enrichOrThrow(events = [], {
  provider,
  now = /* @__PURE__ */ new Date(),
  requiredIds = [],
  maxCandidates = 24,
  // Profile-scoped preference signals (the public taste-profile block). They
  // are compared locally after inference and never enter a model request or
  // the event-level assessment cache.
  preferences = null
} = {}) {
  const required = new Set(requiredIds.map(String));
  const ordered = [...events].sort((left, right) => {
    const requiredDelta = Number(required.has(String(right.id))) - Number(required.has(String(left.id)));
    return requiredDelta || Number(right.ranking?.utility ?? 0) - Number(left.ranking?.utility ?? 0);
  });
  const { inputs: allInputs } = buildSemanticRequest(ordered, {}, { now });
  const eligible = ordered.map((candidate, index) => ({ candidate, input: allInputs[index] })).filter(({ input }) => Object.keys(buildQuestionSet({ input })).length > 0);
  const budget = Math.max(required.size, maxCandidates);
  const chosen = eligible.slice(0, budget);
  const selected = chosen.map(({ candidate }) => candidate);
  const inputs = chosen.map(({ input }) => input);
  inputs.forEach((input, index) => {
    input.revision = candidateRevision(selected[index]);
  });
  const modelEligibleCandidateCount = inputs.length;
  const eligibleBeyondBudget = eligible.length - chosen.length;
  const result = provider ? await provider.assessCandidates(inputs, {}) : { assessments: /* @__PURE__ */ new Map(), telemetry: { status: "not configured", coverage: { requested: inputs.length, covered: 0, uncovered: inputs.map((input) => input.ref) } } };
  const assessmentById = /* @__PURE__ */ new Map();
  inputs.forEach((input, index) => {
    const assessment = result.assessments.get(input.ref) ?? null;
    if (assessment) assessmentById.set(String(selected[index].id), assessment);
  });
  const byId = /* @__PURE__ */ new Map();
  const contributions = emptyContributions();
  for (const event of events) {
    const assessment = assessmentById.get(String(event.id)) ?? null;
    const insight = buildSemanticEventInsight(event, assessment, { preferences });
    if (!insight) continue;
    byId.set(String(event.id), insight);
    countContributions(contributions, insight);
  }
  return {
    byId,
    assessmentById,
    assessedCandidateCount: assessmentById.size,
    enrichedCandidateCount: byId.size,
    modelEligibleCandidateCount,
    eligibleBeyondBudget,
    selectedCandidateCount: selected.length,
    contributions,
    telemetry: result.telemetry
  };
}
function emptyContributions() {
  return { documentedClaims: 0, modelDerivedClaims: 0, personalClaims: 0, uncertaintyClaims: 0, cardsWithModelDerivedClaim: 0, cardsWithPersonalClaim: 0 };
}
function countContributions(totals, insight) {
  let model = false;
  let personal = false;
  for (const kind of insight.claimOrder ?? []) {
    const claim = insight[kind];
    if (!claim) continue;
    if (claim.basis === "calculated-match") {
      totals.personalClaims += 1;
      personal = true;
      if (claim.eventBasis === "model-characterization") model = true;
    } else if (claim.basis === "model-characterization") {
      totals.modelDerivedClaims += 1;
      model = true;
    } else if (claim.basis === "documented-attribute") {
      totals.documentedClaims += 1;
    } else {
      totals.uncertaintyClaims += 1;
    }
  }
  if (model) totals.cardsWithModelDerivedClaim += 1;
  if (personal) totals.cardsWithPersonalClaim += 1;
}
function semanticSourceHealth(enrichment) {
  const eligible = enrichment.modelEligibleCandidateCount ?? 0;
  const assessed = enrichment.assessedCandidateCount ?? 0;
  const inferenceStatus = enrichment.telemetry?.status;
  let status;
  if (enrichment.failed) status = "unavailable";
  else if (inferenceStatus === "not configured") status = "not configured";
  else if (eligible === 0 || assessed >= eligible) status = "active";
  else if (assessed > 0) status = "partial";
  else status = "unavailable";
  return {
    source: "jev-events",
    status,
    itemCount: enrichment.enrichedCandidateCount ?? 0,
    warningCount: Math.max(0, eligible - assessed),
    details: {
      evidenceCount: enrichment.enrichedCandidateCount ?? 0,
      modelEligibleCount: eligible,
      assessedCount: assessed,
      modelDerivedCardCount: enrichment.contributions?.cardsWithModelDerivedClaim ?? 0,
      personalMatchCardCount: enrichment.contributions?.cardsWithPersonalClaim ?? 0,
      eligibleBeyondBudget: enrichment.eligibleBeyondBudget ?? 0,
      // Source health is published, so a failure message carries no URL at all:
      // a provider error can echo an endpoint, and host and path are enough to leak.
      ...enrichment.failed ? { failure: redactUrls(enrichment.telemetry?.errors?.[0] ?? "enrichment failed") } : {}
    }
  };
}
function redactUrls(message) {
  return String(message).replace(/https?:\/\/\S+/g, "[URL REDACTED]");
}

// ../src/nightlife/decisionSchema.js
var DECISION_SCHEMA_VERSION = 2;
var CONTEXT_FIT = ["strong", "possible", "exploratory", "poor", "unknown"];
var MUSIC_ATMOSPHERE_FIT = ["strong", "possible", "weak", "unknown"];
var LATE_NIGHT_FIT = ["confirmed", "possible", "unlikely", "unknown"];
var NOVELTY = ["familiar", "adjacent", "exploratory", "unknown"];
var FRICTION_FLAGS = [
  "long-travel",
  "late-start",
  "group-coordination",
  "schedule-unconfirmed",
  "ticket-unknown",
  "cost-unknown"
];
var DecisionSchemaError = class extends Error {
};
var DIMENSIONS = {
  contextFit: { allowed: CONTEXT_FIT, questionId: "context_fit" },
  musicAtmosphereFit: { allowed: MUSIC_ATMOSPHERE_FIT, questionId: "music_fit" },
  lateNightFit: { allowed: LATE_NIGHT_FIT, questionId: "late_night_fit" },
  novelty: { allowed: NOVELTY, questionId: "novelty" }
};
var EVENT_DIMENSIONS = {
  experienceCharacter: { allowed: ["dance_floor", "live_performance", "seated_listening", "festival_multi_stage", "mixed_or_other", "unknown"], questionId: "event_experience" },
  musicCharacter: { allowed: ["electronic_dance", "band_or_live", "mixed_lineup", "named_style", "unknown"], questionId: "music_character" },
  participationFormat: { allowed: ["standing_or_floor", "seated", "mixed", "not_published", "unknown"], questionId: "participation_format" },
  scheduleCharacter: { allowed: ["published_late_window", "published_early_window", "published_event_window", "unknown"], questionId: "schedule_character" },
  entryPolicy: { allowed: ["age_restricted", "all_ages", "policy_other", "unknown"], questionId: "entry_policy" },
  venueCharacter: { allowed: ["club_or_dance_room", "concert_hall", "outdoor_or_festival", "other_published", "unknown"], questionId: "venue_character" }
};
function assessmentFromAnswers(answers, {
  candidateRef,
  input,
  certaintyThresholds = DEFAULT_CERTAINTY_THRESHOLDS,
  noulThresholds = DEFAULT_NOUL_THRESHOLDS
} = {}) {
  if (!candidateRef) throw new DecisionSchemaError("An assessment requires a candidate ref.");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new DecisionSchemaError("Provider answers must be an object keyed by question id.");
  }
  const evidenceMode = Object.keys(input?.fields?.publishedFacts ?? {}).length > 0;
  const questionSet = buildQuestionSet({ input });
  const dimensions = evidenceMode ? EVENT_DIMENSIONS : DIMENSIONS;
  const assessment = {
    candidateRef,
    schemaVersion: DECISION_SCHEMA_VERSION,
    questionSetVersion: QUESTION_SET_VERSION
  };
  const certainty = {};
  const signals = {};
  let answeredCount = 0;
  for (const [field, { allowed, questionId }] of Object.entries(dimensions)) {
    if (evidenceMode && !questionSet[questionId]) {
      assessment[field] = "unknown";
      certainty[field] = "low";
      continue;
    }
    const answer = answers[questionId];
    if (answer == null) {
      assessment[field] = "unknown";
      certainty[field] = "low";
      continue;
    }
    const choice = validateChoiceAnswer(answer, questionId, questionSet);
    const band = certaintyBand(choice.confidence, certaintyThresholds);
    const value = band === "low" ? "unknown" : choice.choice;
    if (!allowed.includes(value)) {
      throw new DecisionSchemaError(`Provider returned an unsupported ${field} value.`);
    }
    assessment[field] = value;
    certainty[field] = band;
    signals[questionId] = { choice: choice.choice, confidence: round2(choice.confidence), probabilities: roundAll(choice.probabilities) };
    answeredCount += 1;
  }
  const frictionFlags = [];
  for (const [questionId, definition] of Object.entries(evidenceMode ? {} : NOUL_QUESTIONS)) {
    const answer = answers[questionId];
    if (answer == null) continue;
    const noul = validateNoulAnswer(answer, questionId);
    const band = nulBand(noul, noulThresholds);
    signals[questionId] = { noul: round2(noul), band };
    if (band === "yes") frictionFlags.push(definition.flag);
    answeredCount += 1;
  }
  if (input?.fields) {
    if (input.fields.startPeriod === "unknown") frictionFlags.push("schedule-unconfirmed");
    if (input.fields.advertisedPriceUsd == null) frictionFlags.push("cost-unknown");
    if (evidenceMode && !input.fields.publishedFacts?.endTime) frictionFlags.push("schedule-unconfirmed");
    frictionFlags.push("ticket-unknown");
  }
  assessment.frictionFlags = [...new Set(frictionFlags)].filter((flag) => FRICTION_FLAGS.includes(flag));
  assessment.evidenceRefs = [...input?.evidenceRefs ?? []];
  assessment.unknowns = [...input?.fields?.knownUnknowns ?? []];
  assessment.certainty = certainty;
  assessment.signals = signals;
  assessment.answeredQuestionCount = answeredCount;
  assessment.reason = composeReason(assessment, input);
  if (containsUnsupportedModelClaim(assessment.reason)) {
    throw new DecisionSchemaError("Composed reason made an unsupported availability claim.");
  }
  return assessment;
}
function composeReason(assessment, input) {
  const fields = input?.fields ?? {};
  const parts = [];
  if (fields.publishedFacts) return composeEvidenceReason(assessment, fields);
  const fitClause = {
    strong: "Matches the night you described",
    possible: "Plausibly matches the night you described",
    exploratory: "A stretch from what you asked for, kept as a wildcard",
    poor: "Works against something you asked for",
    unknown: "Not enough evidence to judge the overall fit"
  }[assessment.contextFit];
  parts.push(fitClause);
  if (assessment.musicAtmosphereFit === "strong") parts.push("the room and sound look right");
  else if (assessment.musicAtmosphereFit === "weak") parts.push("the likely sound points elsewhere");
  else if (assessment.musicAtmosphereFit === "unknown") parts.push("the lineup was not available to judge the sound");
  if (assessment.lateNightFit === "confirmed") parts.push("the published schedule runs late");
  else if (assessment.lateNightFit === "possible") parts.push("it could run late, though no source publishes an end time");
  else if (assessment.lateNightFit === "unlikely") parts.push("it looks like an early finish");
  if (assessment.novelty === "exploratory") parts.push("it is outside your usual pattern");
  else if (assessment.novelty === "adjacent") parts.push("it sits one step off your usual pattern");
  if (assessment.frictionFlags.includes("long-travel")) {
    parts.push(fields.travelMinutesEstimate ? `the trip is roughly ${fields.travelMinutesEstimate} minutes each way` : "the trip is a real part of the evening");
  }
  if (assessment.frictionFlags.includes("late-start")) parts.push("the start time sits awkwardly in your window");
  if (assessment.frictionFlags.includes("group-coordination")) parts.push("it takes some coordination for your party");
  return `${sentence(parts)}.`;
}
function composeEvidenceReason(assessment, fields) {
  const published = fields.publishedFacts ?? {};
  const parts = [];
  const experience = {
    dance_floor: "Published details describe a dance-floor experience",
    live_performance: "Published details describe a live-performance experience",
    seated_listening: "Published details describe a seated listening experience",
    festival_multi_stage: "Published details describe a festival or multi-stage program",
    mixed_or_other: "Published details describe a mixed or other event format"
  }[assessment.experienceCharacter];
  if (experience && (published.format || published.description || published.classification || published.venueInfo)) parts.push(experience);
  const music = {
    electronic_dance: "published music details point to electronic dance music",
    band_or_live: "published music details point to a band or live program",
    mixed_lineup: "published music details describe a mixed lineup",
    named_style: "published music details name a specific style"
  }[assessment.musicCharacter];
  if (music && (published.classification || published.description || published.namedLineup)) parts.push(music);
  const participation = {
    standing_or_floor: "the published format is standing or floor-oriented",
    seated: "the published format is seated",
    mixed: "the published format includes seated and floor participation",
    not_published: "the event does not publish a participation format"
  }[assessment.participationFormat];
  if (participation && (published.format || published.venueInfo || published.description)) parts.push(participation);
  const schedule = {
    published_late_window: "published event times establish a late-running window",
    published_early_window: "published event times establish an early-evening window",
    published_event_window: "published event times establish a bounded event window"
  }[assessment.scheduleCharacter];
  if (schedule && published.endTime) parts.push(schedule);
  const entry = {
    age_restricted: "the published entry policy is age-restricted",
    all_ages: "the published entry policy is all-ages",
    policy_other: "the event publishes an entry policy"
  }[assessment.entryPolicy];
  if (entry && published.agePolicy) parts.push(entry);
  const venue = {
    club_or_dance_room: "published venue metadata describes a club or dance room",
    concert_hall: "published venue metadata describes a concert hall",
    outdoor_or_festival: "published venue metadata describes an outdoor or festival setting",
    other_published: "published venue metadata establishes another room character"
  }[assessment.venueCharacter];
  if (venue && published.venueInfo) parts.push(venue);
  if (!parts.length) return "Published event details were insufficient for a typed characterization.";
  return `${parts[0]}${parts.length > 1 ? `; ${parts.slice(1).join(", ")}` : ""}.`;
}
function validateAnswerEnvelope(answers, { expectedQuestionIds } = {}) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new DecisionSchemaError("Provider response did not contain an answers map.");
  }
  const expected = new Set(expectedQuestionIds ?? [...Object.keys(CHOICE_QUESTIONS), ...Object.keys(NOUL_QUESTIONS)]);
  for (const id of Object.keys(answers)) {
    if (!expected.has(id)) throw new DecisionSchemaError(`Provider answered an unrequested question (${id}).`);
  }
  return answers;
}
function validateChoiceAnswer(answer, questionId, questionSet = null) {
  if (answer.type && answer.type !== "choice") {
    throw new DecisionSchemaError(`Question ${questionId} expected a choice answer.`);
  }
  const definition = questionSet?.[questionId] ?? CHOICE_QUESTIONS[questionId];
  if (!definition) throw new DecisionSchemaError(`Unknown choice question ${questionId}.`);
  const allowed = Object.keys(definition.criteria);
  if (typeof answer.choice !== "string" || !allowed.includes(answer.choice)) {
    throw new DecisionSchemaError(`Question ${questionId} returned an option outside its criteria.`);
  }
  const confidence = Number(answer.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new DecisionSchemaError(`Question ${questionId} returned an out-of-range confidence.`);
  }
  const probabilities = answer.probabilities ?? {};
  if (probabilities && typeof probabilities === "object") {
    for (const key of Object.keys(probabilities)) {
      if (!allowed.includes(key)) {
        throw new DecisionSchemaError(`Question ${questionId} returned a probability for an unknown option.`);
      }
    }
  }
  return { choice: answer.choice, confidence, probabilities };
}
function validateNoulAnswer(answer, questionId) {
  if (answer.type && answer.type !== "noul") {
    throw new DecisionSchemaError(`Question ${questionId} expected a noul answer.`);
  }
  const noul = Number(answer.noul);
  if (!Number.isFinite(noul) || noul < 0 || noul > 1) {
    throw new DecisionSchemaError(`Question ${questionId} returned an out-of-range noul value.`);
  }
  return noul;
}
function sentence(parts) {
  const cleaned = parts.filter(Boolean);
  if (cleaned.length <= 1) return cleaned[0] ?? "No assessment was available";
  return `${cleaned[0]}; ${cleaned.slice(1).join(", ")}`;
}
function round2(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}
function roundAll(probabilities) {
  if (!probabilities || typeof probabilities !== "object") return {};
  return Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, round2(Number(value))]));
}

// ../src/nightlife/providers/systemOneTransport.js
var InferenceTransportError = class extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
};
var RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 529]);
async function postSystemOne({
  route,
  headers,
  model,
  state,
  questions,
  signal,
  timeoutMs,
  fetchImpl,
  unwrap: unwrap2 = (body) => body
}) {
  assertNoRestrictedEvidence(state);
  const started = Date.now();
  let response;
  try {
    response = await fetchImpl(route, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ state, model, questions }),
      signal: signal ?? AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new InferenceTransportError(
      timedOut ? "The inference request timed out." : "The inference request could not be sent.",
      { retryable: timedOut }
    );
  }
  if (!response.ok) {
    throw new InferenceTransportError(`The inference request failed (${response.status}).`, {
      retryable: RETRYABLE_STATUSES.has(response.status) || response.status >= 500,
      status: response.status
    });
  }
  let body;
  try {
    body = unwrap2(await response.json());
  } catch {
    throw new InferenceTransportError("The inference response was not valid JSON.");
  }
  if (!body || typeof body !== "object" || !body.answers || typeof body.answers !== "object") {
    throw new InferenceTransportError("The inference response contained no answers map.");
  }
  return {
    answers: body.answers,
    latencyMs: Date.now() - started,
    route,
    // The alias may move, so the versioned id that actually answered is
    // recorded rather than the id we asked for.
    model: typeof body.model === "string" ? body.model : model,
    usage: {
      inputTokens: integerOrNull(body.usage?.input_tokens),
      outputTokens: integerOrNull(body.usage?.output_tokens)
    }
  };
}
function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

// ../src/nightlife/providers/gateway.js
var DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
var DEFAULT_GATEWAY_MODEL = "typesafe-ai/jev";
function createGatewayProvider({
  apiKey,
  model = DEFAULT_GATEWAY_MODEL,
  baseUrl = DEFAULT_GATEWAY_BASE_URL,
  requestPath = "evaluate",
  timeoutMs = 45e3,
  fetchImpl = fetch
} = {}) {
  const route = `${String(baseUrl).replace(/\/$/, "")}/${String(requestPath).replace(/^\//, "")}`;
  const configured = Boolean(apiKey && model);
  return {
    name: "vercel-ai-gateway",
    model,
    route,
    configured,
    describe: () => ({ provider: "vercel-ai-gateway", model, route, configured }),
    async evaluate({ state, questions, signal } = {}) {
      if (!configured) throw new Error("The AI Gateway route is not configured.");
      return postSystemOne({
        route,
        headers: { authorization: `Bearer ${apiKey}` },
        model,
        state,
        questions: toGatewayQuestions(questions),
        signal,
        timeoutMs,
        fetchImpl,
        unwrap: (body) => fromGatewayBody(body)
      });
    }
  };
}
function toGatewayQuestions(questions = {}) {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [
    id,
    question?.type === "noul" ? { ...question, type: "boolean" } : question
  ]));
}
function fromGatewayBody(body) {
  const envelope = body?.answers ? body : body?.data ?? body?.result ?? body;
  if (!envelope?.answers || typeof envelope.answers !== "object") return envelope;
  return {
    ...envelope,
    answers: Object.fromEntries(Object.entries(envelope.answers).map(([id, answer]) => [id, fromGatewayAnswer(answer)]))
  };
}
function fromGatewayAnswer(answer) {
  if (!answer || typeof answer !== "object" || answer.type !== "boolean") return answer;
  const value = [answer.noul, answer.boolean, answer.probability, answer.value].find((candidate) => Number.isFinite(Number(candidate)));
  return { type: "noul", noul: Number(value) };
}

// ../src/nightlife/providers/directServing.js
var DEFAULT_DIRECT_BASE_URL = "https://api.typesafe.ai/v1";
var DEFAULT_DIRECT_MODEL = "jev-latest";
function createDirectServingProvider({
  apiKey,
  model = DEFAULT_DIRECT_MODEL,
  baseUrl = DEFAULT_DIRECT_BASE_URL,
  requestPath = "systemone",
  timeoutMs = 45e3,
  fetchImpl = fetch
} = {}) {
  const route = `${String(baseUrl).replace(/\/$/, "")}/${String(requestPath).replace(/^\//, "")}`;
  const configured = Boolean(apiKey && model);
  return {
    name: "typesafe-direct",
    model,
    route,
    configured,
    describe: () => ({ provider: "typesafe-direct", model, route, configured }),
    async evaluate({ state, questions, signal } = {}) {
      if (!configured) throw new Error("The direct serving route is not configured.");
      return postSystemOne({
        route,
        headers: { authorization: `Bearer ${apiKey}` },
        model,
        state,
        questions,
        signal,
        timeoutMs,
        fetchImpl
      });
    }
  };
}

// ../src/nightlife/inference.js
var INPUT_TOKEN_COST_USD = 42 / 1e9;
function createDecisionInferenceProvider(config = {}, { fetchImpl = fetch, cache = createAssessmentCache() } = {}) {
  const adapter = adapterFor(config, fetchImpl);
  const concurrency = boundedInteger(config.concurrency, 1, 8, 4);
  const maxCandidates = boundedInteger(config.maxCandidates, 1, 80, 24);
  const maxAttempts = boundedInteger(config.maxAttempts, 1, 4, 3);
  const maxCostUsd = Number.isFinite(config.maxCostUsd) && config.maxCostUsd > 0 ? config.maxCostUsd : null;
  const deadlineMs = boundedInteger(config.deadlineMs, 1e3, 3e5, 6e4);
  const retryBaseMs = boundedInteger(config.retryBaseMs, 10, 5e3, 250);
  return {
    describe() {
      return {
        ...adapter.describe(),
        schemaVersion: DECISION_SCHEMA_VERSION,
        questionSetVersion: QUESTION_SET_VERSION,
        concurrency,
        maxCandidates,
        maxCostUsd,
        deadlineMs
      };
    },
    /**
     * @param {Array} inputs source-safe candidate inputs from `buildSemanticRequest`
     * @param {object} context normalized nightlife context
     * @returns {Promise<{assessments: Map<string, object>, telemetry: object}>}
     */
    async assessCandidates(inputs, context, options = {}) {
      const started = Date.now();
      const requested = inputs.slice(0, maxCandidates);
      const telemetry = baseTelemetry(adapter, {
        requestedCount: requested.length,
        skippedForBudget: inputs.length - requested.length
      });
      const assessments = /* @__PURE__ */ new Map();
      if (!adapter.configured || !requested.length) {
        telemetry.status = adapter.configured ? "no candidates" : "not configured";
        telemetry.totalMs = Date.now() - started;
        telemetry.coverage = coverage(requested, assessments);
        return { assessments, telemetry };
      }
      const safeContext = serializeContext(context);
      const deadline = started + deadlineMs;
      const pending = [];
      for (const input of requested) {
        const questions = buildQuestionSet({ input });
        const evidenceMode = Object.keys(input.fields?.publishedFacts ?? {}).length > 0;
        const key = assessmentCacheKey({
          candidateRevision: input.revision ?? null,
          input: evidenceMode ? { publishedFacts: input.fields.publishedFacts, knownUnknowns: input.fields.knownUnknowns } : input.fields,
          context: evidenceMode ? null : safeContext,
          schemaVersion: DECISION_SCHEMA_VERSION,
          promptVersion: QUESTION_SET_VERSION,
          questionIds: Object.keys(questions),
          evidenceSchemaVersion: EVENT_EVIDENCE_SCHEMA_VERSION,
          criteriaVersion: QUESTION_SET_VERSION,
          provider: adapter.name,
          model: adapter.model
        });
        const cached = options.refreshCache ? null : cache.get(key);
        if (cached) {
          telemetry.cacheHits += 1;
          assessments.set(input.ref, { ...cached, cached: true });
          continue;
        }
        pending.push({ input, key, questions, evidenceMode });
      }
      await runWithConcurrency(pending, concurrency, async ({ input, key, questions, evidenceMode }) => {
        if (!Object.keys(questions).length) return;
        if (Date.now() >= deadline) {
          telemetry.deadlineSkipped += 1;
          return;
        }
        if (maxCostUsd != null && (telemetry.costUsd ?? 0) >= maxCostUsd) {
          telemetry.budgetSkipped += 1;
          return;
        }
        const state = evidenceMode ? {
          event: {
            ref: input.ref,
            published: input.fields.publishedFacts,
            missing: input.fields.knownUnknowns ?? []
          }
        } : { request: safeContext, candidate: { ref: input.ref, restricted: input.restricted, ...withoutRef(input.fields) } };
        assertNoRestrictedEvidence(state);
        let result = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          telemetry.callsAttempted += 1;
          try {
            result = await adapter.evaluate({
              state,
              questions,
              signal: AbortSignal.timeout(Math.max(1e3, deadline - Date.now()))
            });
            break;
          } catch (error) {
            if (!error?.retryable || attempt === maxAttempts || Date.now() >= deadline) {
              telemetry.errors.push(sanitizeErrorMessage(error));
              return;
            }
            telemetry.retries += 1;
            await delay(retryBaseMs * 2 ** (attempt - 1));
          }
        }
        if (!result) return;
        telemetry.callsCompleted += 1;
        telemetry.latencyMsTotal += result.latencyMs ?? 0;
        telemetry.latencies.push(result.latencyMs ?? 0);
        accumulateUsage(telemetry, result.usage);
        if (result.model) telemetry.resolvedModels.add(result.model);
        let assessment;
        try {
          validateAnswerEnvelope(result.answers, { expectedQuestionIds: Object.keys(questions) });
          assessment = assessmentFromAnswers(result.answers, {
            candidateRef: input.ref,
            input,
            certaintyThresholds: config.certaintyThresholds,
            noulThresholds: config.noulThresholds
          });
        } catch (error) {
          telemetry.validationFailures += 1;
          telemetry.errors.push(sanitizeErrorMessage(error));
          return;
        }
        const stored = { ...assessment, provider: adapter.name, model: result.model ?? adapter.model };
        cache.set(key, stored);
        assessments.set(input.ref, { ...stored, cached: false });
      });
      telemetry.totalMs = Date.now() - started;
      telemetry.coverage = coverage(requested, assessments);
      telemetry.status = statusFor(telemetry);
      telemetry.resolvedModels = [...telemetry.resolvedModels];
      telemetry.latencyMsMedian = median(telemetry.latencies);
      telemetry.latencyMsMax = telemetry.latencies.length ? Math.max(...telemetry.latencies) : null;
      delete telemetry.latencies;
      telemetry.costPerAssessedCandidateUsd = telemetry.costUsd != null && telemetry.coverage.covered ? Number((telemetry.costUsd / telemetry.coverage.covered).toFixed(8)) : null;
      return { assessments, telemetry };
    }
  };
}
function adapterFor(config, fetchImpl) {
  const provider = String(config.provider ?? "disabled").toLowerCase();
  if (provider === "gateway") return createGatewayProvider({ ...config.gateway, timeoutMs: config.requestTimeoutMs, fetchImpl });
  if (provider === "direct") return createDirectServingProvider({ ...config.direct, timeoutMs: config.requestTimeoutMs, fetchImpl });
  if (provider === "custom" && config.adapter) return config.adapter;
  return disabledAdapter();
}
function disabledAdapter() {
  return {
    name: "disabled",
    model: null,
    route: null,
    configured: false,
    describe: () => ({ provider: "disabled", model: null, route: null, configured: false }),
    async evaluate() {
      throw new Error("Decision inference is disabled.");
    }
  };
}
function baseTelemetry(adapter, { requestedCount, skippedForBudget }) {
  const described = adapter.describe();
  return {
    provider: described.provider,
    model: described.model,
    route: described.route,
    resolvedModels: /* @__PURE__ */ new Set(),
    schemaVersion: DECISION_SCHEMA_VERSION,
    questionSetVersion: QUESTION_SET_VERSION,
    requestedCount,
    skippedForBudget,
    callsAttempted: 0,
    callsCompleted: 0,
    retries: 0,
    cacheHits: 0,
    validationFailures: 0,
    deadlineSkipped: 0,
    budgetSkipped: 0,
    latencies: [],
    latencyMsTotal: 0,
    latencyMsMedian: null,
    latencyMsMax: null,
    totalMs: 0,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    costPerAssessedCandidateUsd: null,
    errors: [],
    coverage: { requested: requestedCount, covered: 0, uncovered: [] },
    status: "pending"
  };
}
function accumulateUsage(telemetry, usage = {}) {
  if (Number.isInteger(usage.inputTokens)) {
    telemetry.inputTokens = (telemetry.inputTokens ?? 0) + usage.inputTokens;
    telemetry.costUsd = Number(((telemetry.costUsd ?? 0) + usage.inputTokens * INPUT_TOKEN_COST_USD).toFixed(10));
  }
  if (Number.isInteger(usage.outputTokens)) telemetry.outputTokens = (telemetry.outputTokens ?? 0) + usage.outputTokens;
}
function coverage(requested, assessments) {
  const uncovered = requested.filter((input) => !assessments.has(input.ref)).map((input) => input.ref);
  return { requested: requested.length, covered: requested.length - uncovered.length, uncovered };
}
function statusFor(telemetry) {
  if (!telemetry.coverage.covered) return "deterministic fallback";
  return telemetry.coverage.uncovered.length ? "partial inference" : "assessed";
}
async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
function withoutRef(fields) {
  const { ref: _ref, ...rest } = fields;
  return rest;
}
function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

// ../src/nightlife/config.js
function readNightlifeConfig(env = process.env) {
  return {
    provider: resolveProvider(env),
    requestTimeoutMs: integer(env.NIGHTLIFE_REQUEST_TIMEOUT_MS, 45e3),
    concurrency: integer(env.NIGHTLIFE_CONCURRENCY, 4),
    maxCandidates: integer(env.NIGHTLIFE_MAX_CANDIDATES, 24),
    maxAttempts: integer(env.NIGHTLIFE_MAX_ATTEMPTS, 3),
    deadlineMs: integer(env.NIGHTLIFE_DEADLINE_MS, 6e4),
    maxCostUsd: float(env.NIGHTLIFE_MAX_COST_USD, null),
    gateway: {
      apiKey: text(env.AI_GATEWAY_API_KEY),
      model: text(env.AI_GATEWAY_MODEL) ?? DEFAULT_GATEWAY_MODEL,
      baseUrl: text(env.AI_GATEWAY_BASE_URL) ?? DEFAULT_GATEWAY_BASE_URL,
      requestPath: text(env.AI_GATEWAY_REQUEST_PATH) ?? void 0
    },
    direct: {
      // TYPESAFE_API_KEY is the vendor SDK's conventional name; the longer
      // form is what this project's environment uses.
      apiKey: text(env.TYPESAFE_AI_API_KEY) ?? text(env.TYPESAFE_API_KEY),
      model: text(env.TYPESAFE_AI_MODEL) ?? text(env.TYPESAFE_MODEL) ?? DEFAULT_DIRECT_MODEL,
      baseUrl: text(env.TYPESAFE_AI_BASE_URL) ?? text(env.TYPESAFE_BASE_URL) ?? DEFAULT_DIRECT_BASE_URL,
      requestPath: text(env.TYPESAFE_REQUEST_PATH) ?? void 0
    }
  };
}
function nightlifeInferenceConfigured(config) {
  if (config.provider === "gateway") return Boolean(config.gateway.apiKey && config.gateway.model);
  if (config.provider === "direct") return Boolean(config.direct.apiKey && config.direct.model);
  return false;
}
function describeNightlifeConfig(config) {
  return {
    provider: config.provider,
    configured: nightlifeInferenceConfigured(config),
    model: config.provider === "gateway" ? config.gateway.model : config.provider === "direct" ? config.direct.model : null,
    baseUrl: config.provider === "gateway" ? config.gateway.baseUrl : config.provider === "direct" ? config.direct.baseUrl : null,
    maxCandidates: config.maxCandidates,
    concurrency: config.concurrency,
    deadlineMs: config.deadlineMs,
    maxCostUsd: config.maxCostUsd
  };
}
function resolveProvider(env) {
  const explicit = String(env.NIGHTLIFE_INFERENCE_PROVIDER ?? "").trim().toLowerCase();
  if (["gateway", "direct", "disabled"].includes(explicit)) return explicit;
  if (env.TYPESAFE_AI_API_KEY || env.TYPESAFE_API_KEY) return "direct";
  if (env.AI_GATEWAY_API_KEY) return "gateway";
  return "disabled";
}
function text(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}
function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
function float(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
export {
  DEFAULT_FOCAL_POINT,
  EDMTRAIN_API_BASE_URL,
  EVENT_EVIDENCE_SCHEMA_VERSION,
  INSOMNIAC_ADAPTER_VERIFIED,
  UNORDERED_URGENCIES,
  URGENCY_PRIORITY,
  applyPitcherStats,
  buildEdmtrainUrl,
  buildEventEvidence,
  buildExpandedArtistSnapshot,
  buildOverview,
  buildOverviewBuckets,
  buildSemanticCandidateInput,
  buildSemanticEventInsight,
  buildSemanticRequest,
  calculateHassle,
  canonicalEventTitle,
  createAssessmentCache,
  createDecisionInferenceProvider,
  createEventEvidence,
  createEvidenceFact,
  deduplicateCandidates,
  describeNightlifeConfig,
  enrichEventsWithEdmtrain,
  enrichMovieMetadata,
  enrichSemanticEventCards,
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
  nightlifeInferenceConfigured,
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
  readNightlifeConfig,
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
  semanticSourceHealth,
  serializeContext,
  serializeEventEvidenceForDisplay,
  serializeEventEvidenceForModel,
  splitDateWindows,
  sportsTicketUrgency,
  spotifyIdFromLinks,
  summarizeEvidenceCoverage,
  ticketMatchesGame,
  ticketmasterEventMatchesArtist,
  toDisplayEvent,
  toDisplaySportsGame,
  topItemsAffinityFor,
  topRecurringTags
};
