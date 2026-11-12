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
function formatLocalDate(value, options = {}, locale = "en-US") {
  const date = localDateAtNoon(value);
  return date ? date.toLocaleDateString(locale, { timeZone: "UTC", ...options }) : null;
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
var PROMOTER_SOURCES = Object.freeze(["framework", "insomniac"]);
var DESTINATION_INTEREST = 36;
var NOISY_TAGS = /* @__PURE__ */ new Set([
  "albums i own",
  "awesome",
  "favorite",
  "favorites",
  "favourite",
  "favourites",
  "female vocalists",
  "male vocalists",
  "seen live",
  "spotify",
  "under 2000 listeners",
  "under 5000 listeners",
  "all",
  "music",
  "dj",
  "djs",
  "producer",
  "american",
  "usa",
  "british",
  "uk",
  "english",
  "german",
  "dutch",
  "french",
  "italian",
  "spanish",
  "swedish",
  "australian",
  "canadian",
  "korean",
  "japanese",
  "belgian",
  "irish",
  "scottish",
  "brazilian"
]);
var DIRECT_ORIGINS = ["source", "top-items"];
function callLabel(score) {
  if (score >= 75) return "Strong fit";
  if (score >= 55) return "Selective";
  if (score >= 40) return "Wildcard";
  return "Watch";
}
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
  const matchPerformers = (candidate) => candidate.performers.map((performer) => ({
    performer,
    artist: bySeatGeekId.get(String(performer.sourceId)) ?? (performer.spotifyId ? bySpotifyId.get(performer.spotifyId) : null) ?? uniqueNameMatch(byNormalizedName.get(normalizeArtistName(performer.name)))
  })).filter((match) => match.artist);
  const directAffinityOf = (artist) => {
    const playlistAffinity = playlistAffinityFor(artist, maximumSeedStrength);
    const topAffinity = topItemsAffinityFor(artist, artistSnapshot.topItems, now);
    const corroborationBonus = playlistAffinity > 0 && topAffinity > 0 ? Math.min(6, Math.round(Math.min(playlistAffinity, topAffinity) * 0.1)) : 0;
    return { playlistAffinity, topAffinity, corroborationBonus, directAffinity: Math.min(60, Math.max(playlistAffinity, topAffinity) + corroborationBonus) };
  };
  const sceneProfile = buildSceneProfile(artistSnapshot.artists ?? []);
  const coBilling = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const matches = matchPerformers(candidate);
    const direct = matches.filter((match) => DIRECT_ORIGINS.includes(match.artist.origin ?? "source")).map((match) => ({ name: match.artist.name, affinity: directAffinityOf(match.artist).directAffinity })).filter((item) => item.affinity > 0).sort((a, b) => b.affinity - a.affinity);
    if (!direct.length) continue;
    for (const match of matches) {
      if (match.artist.origin !== "promoter") continue;
      const key = normalizeArtistName(match.artist.name);
      const current = coBilling.get(key);
      if (!current || direct[0].affinity > current.affinity) coBilling.set(key, direct[0]);
    }
  }
  return candidates.map((candidate) => {
    const matches = matchPerformers(candidate);
    const promoterShow = promoterShowFor(candidate);
    const excluded = candidate.performers.some((performer) => excludedArtists.has(normalizeArtistName(performer.name))) || excludedVenues.has(normalizeArtistName(candidate.venue.name));
    const rosterArtistsOnBill = matches.filter((match) => match.artist.origin === "promoter").length;
    const scoredMatches = matches.map((match) => {
      if (match.artist.origin === "promoter") {
        const inferred = promoterAffinityFor(match.artist, {
          promoterShow,
          coBilled: coBilling.get(normalizeArtistName(match.artist.name)) ?? null,
          scene: sceneFitFor(match.artist, sceneProfile),
          rosterArtistsOnBill
        });
        return { ...match, playlistAffinity: 0, topAffinity: 0, corroborationBonus: 0, directAffinity: inferred.affinity, inferred };
      }
      return { ...match, ...directAffinityOf(match.artist), inferred: null };
    });
    const strongestMatch = scoredMatches.sort((a, b) => b.directAffinity - a.directAffinity || b.artist.seedStrength - a.artist.seedStrength)[0];
    const lineupBonus = Math.min(8, Math.round(scoredMatches.slice(1).filter((match) => !match.inferred).reduce((sum, match) => sum + match.directAffinity * 0.12, 0)));
    const artistFit = Math.min(68, (strongestMatch?.directAffinity ?? 0) + lineupBonus);
    const pinnedBonus = (candidate.performers.some((performer) => pinned.has(normalizeArtistName(performer.name))) ? 15 : 0) + (candidate.destination ? Math.max(8, DESTINATION_INTEREST - Math.round(artistFit * 0.5)) : 0);
    const distanceMiles4 = distanceBetween(config.home, candidate.venue);
    const hassle = calculateHassle(candidate, config, distanceMiles4);
    const hassleScore = hassle.score;
    const urgency = ticketUrgency(candidate.ticketObservation, candidate.startLocal, now);
    const lowestPrice = candidate.ticketObservation?.lowestPriceUsd;
    const aboveHardCeiling = !candidate.destination && config.hardMaxTicketPriceUsd != null && lowestPrice != null && lowestPrice > config.hardMaxTicketPriceUsd;
    const excludedByRule = excluded || aboveHardCeiling;
    const utility = excludedByRule ? -100 : artistFit + pinnedBonus - hassleScore * 2;
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
        excluded: excludedByRule,
        exclusionReason: excluded ? "explicit exclusion" : aboveHardCeiling ? "above hard price ceiling" : null,
        call: callLabel(utility),
        discovery: candidate.destination ? { tier: "destination", promoterShow, rosterPromoter: null, destination: candidate.destination.name } : discoveryFor(strongestMatch, promoterShow),
        lineupBonus,
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
        whyYou: candidate.destination ? destinationReason(candidate, strongestMatch?.artist) : strongestMatch ? whyYouReason(strongestMatch.artist, candidate, artistSnapshot.topItems, now, strongestMatch.inferred) : "No exact match to the selected Spotify artists yet."
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
function whyYouReason(artist, candidate = {}, topItems = {}, now = /* @__PURE__ */ new Date(), inferred = null) {
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
  const roster = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === "framework-roster");
  const calendar = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === "promoter-event" || evidence.type === "promoter");
  if (roster || calendar) {
    const promoter = promoterShowFor(candidate);
    const providers = listingProviders(candidate).filter((label) => label !== promoter);
    const listing = providers.length ? `this listing is from ${providers.join(" + ")}` : null;
    const found = roster ? promoter === roster.promoter ? `${artist.name} is on the ${roster.promoter} artist roster, and this is a ${roster.promoter} night` : promoter ? `${artist.name} is on the ${roster.promoter} artist roster; this night is on ${promoter}'s calendar` : `${artist.name} is on the ${roster.promoter} artist roster${listing ? `; ${listing}, not a ${roster.promoter} night` : ""}` : promoter ? `${artist.name} is on ${promoter}'s calendar, which you follow` : `${artist.name} plays ${calendar.promoter} nights you follow${listing ? `; ${listing}` : ""}`;
    const sceneTags = inferred?.scene?.points >= 4 ? inferred.scene.tags : [];
    const because = [
      inferred?.coBilled ? ` Shares a bill with ${inferred.coBilled.name}, who is in your rotation.` : "",
      sceneTags.length ? ` Tagged ${sceneTags.join(" and ")}, ${sceneTags.length > 1 ? "scenes" : "a scene"} your listening is built on.` : ""
    ].join("") || " No listening evidence yet, so this is a discovery rather than a match.";
    return `${found}.${because}`;
  }
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
function destinationReason(candidate, artist) {
  const { name, distanceLabel, dateNote } = candidate.destination;
  const trip = distanceLabel ? ` It is a trip: ${distanceLabel}.` : "";
  const lineup = artist ? ` ${artist.name} is on the bill and in your profile.` : "";
  return `${name} is on your destination watchlist.${trip}${lineup}${dateNote ? ` ${dateNote}` : ""}`;
}
function promoterAffinityFor(artist, { promoterShow = null, coBilled = null, rosterArtistsOnBill = 1, scene = null } = {}) {
  const base = 12;
  const ownNight = promoterShow ? 4 : 0;
  const coBilling = coBilled ? Math.min(14, Math.round(coBilled.affinity * 0.3)) : 0;
  const depth = Math.min(4, Math.max(0, rosterArtistsOnBill - 1) * 2);
  const sceneFit = scene?.points ?? 0;
  return { affinity: base + ownNight + coBilling + depth + sceneFit, base, ownNight, coBilling, depth, sceneFit, scene, coBilled };
}
var SCENE_FIT_MAX = 14;
function buildSceneProfile(artists = []) {
  const weights = /* @__PURE__ */ new Map();
  for (const artist of artists) {
    if (!DIRECT_ORIGINS.includes(artist.origin ?? "source")) continue;
    const weight = Math.max(0.1, Number(artist.seedStrength) || 0.1);
    for (const tag of normalizedTags(artist)) weights.set(tag, (weights.get(tag) ?? 0) + weight);
  }
  const discovered = artists.filter((artist) => artist.origin === "promoter" && normalizedTags(artist).length);
  const frequency = /* @__PURE__ */ new Map();
  for (const artist of discovered) for (const tag of normalizedTags(artist)) frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
  const top = [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  const strongest = Math.max(1, ...top.map(([, weight]) => weight));
  const tags = new Map(top.map(([tag, weight]) => {
    const share = discovered.length >= 8 ? (frequency.get(tag) ?? 0) / discovered.length : 0;
    return [tag, weight / strongest * (1 - Math.min(0.85, share))];
  }));
  const norm = [...tags.values()].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
  return { tags, norm };
}
function sceneFitFor(artist, profile) {
  if (!profile?.norm) return { points: 0, tags: [] };
  const matched = normalizedTags(artist).filter((tag) => profile.tags.has(tag)).map((tag) => ({ tag, weight: profile.tags.get(tag) })).sort((a, b) => b.weight - a.weight);
  const covered = matched.slice(0, 3).reduce((sum, item) => sum + item.weight, 0);
  return { points: Math.round(SCENE_FIT_MAX * Math.min(1, covered / profile.norm)), tags: matched.slice(0, 2).map((item) => item.tag) };
}
function normalizedTags(artist) {
  return [...new Set((artist?.genres ?? []).map((tag) => normalizeArtistName(tag)).filter((tag) => tag && !NOISY_TAGS.has(tag)))];
}
function promoterShowFor(candidate = {}) {
  const sources = new Set((candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.source));
  if (candidate.source) sources.add(candidate.source);
  if (sources.has("framework")) return "Framework";
  if (sources.has("insomniac")) return "Insomniac";
  return null;
}
function discoveryFor(match, promoterShow) {
  const origin = match?.artist?.origin ?? (match ? "source" : null);
  const rosterPromoter = (match?.artist?.discoveryEvidence ?? []).find((evidence) => evidence.type === "framework-roster")?.promoter ?? null;
  const tier = !match ? "none" : DIRECT_ORIGINS.includes(origin) ? "direct" : origin === "similar" ? "similar" : origin === "tag" ? "tag" : promoterShow ? "promoter-night" : "roster";
  return { tier, promoterShow, rosterPromoter };
}
function selectPublishedConcerts(candidates, limit = 120) {
  return candidates.filter((candidate) => !candidate.ranking?.excluded && ((candidate.matchedArtists ?? []).length > 0 || candidate.destination) && candidate.ranking.artistFit + candidate.ranking.pinnedBonus > 0).sort((a, b) => b.ranking.utility - a.ranking.utility || String(a.startLocal).localeCompare(String(b.startLocal))).slice(0, limit);
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
  const logisticalReasons = [];
  const commercialReasons = [];
  let logistical = 0;
  let commercial = 0;
  if (candidate.destination) {
    logistical = 2;
    logisticalReasons.push(`destination trip${candidate.destination.distanceLabel ? ` \xB7 ${candidate.destination.distanceLabel}` : ""}`);
  } else if (distanceMiles4 != null) {
    logistical = Math.min(6, Math.round(distanceMiles4 / 12));
    if (distanceMiles4 >= 12) logisticalReasons.push(`${Math.round(distanceMiles4)} mi from ${config.home.label}`);
  }
  if (candidate.timeTbd || candidate.dateTbd) {
    logistical += 2;
    logisticalReasons.push("time or date is TBD");
  }
  const lowestPrice = candidate.ticketObservation?.lowestPriceUsd;
  if (lowestPrice != null) {
    commercialReasons.push(`from $${lowestPrice}`);
    if (lowestPrice > config.maxTicketPriceUsd) {
      commercial += lowestPrice > config.maxTicketPriceUsd * 1.5 ? 4 : 2;
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
  const listingCount = ticketObservation?.listingCount ?? null;
  const daysUntil2 = daysUntilEvent(startLocal, now);
  if (listingCount != null && listingCount <= 10) return "buy now";
  if (daysUntil2 != null && daysUntil2 <= 3 && listingCount != null && listingCount <= 30) return "buy now";
  if (daysUntil2 != null && daysUntil2 <= 7) return "watch";
  if (listingCount == null) return "unknown";
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

// ../src/discovery.js
function addPromoterEvidence(snapshot, promoterEvents = [], rosterArtists = []) {
  const artists = (snapshot?.artists ?? []).map((artist) => ({ ...artist }));
  const byKey = new Map(artists.map((artist) => [normalizeArtistName(artist.name), artist]));
  const add = (name, promoter, sourceUrl, type) => {
    const key = normalizeArtistName(name);
    if (!key) return;
    const evidence = { type, promoter, sourceUrl: sourceUrl ?? null };
    const existing = byKey.get(key);
    if (existing) {
      existing.discoveryEvidence = [...existing.discoveryEvidence ?? []];
      if (!existing.discoveryEvidence.some((item) => item.type === type && item.promoter === promoter)) {
        existing.discoveryEvidence.push(evidence);
      }
      return;
    }
    const artist = {
      spotifyArtistId: null,
      name: String(name).trim(),
      seedStrength: 0,
      evidence: [],
      origin: "promoter",
      discoveryEvidence: [evidence]
    };
    byKey.set(key, artist);
    artists.push(artist);
  };
  for (const artist of rosterArtists) add(artist?.name, "Framework", artist?.sourceUrl, "framework-roster");
  for (const event of promoterEvents) {
    const promoter = event?.source === "insomniac" ? "Insomniac" : "Framework";
    for (const performer of event?.performers ?? []) add(performer?.name, promoter, event?.sourceUrl, "promoter-event");
  }
  return { ...snapshot, artists, artistCount: artists.length };
}
function applyArtistTags(snapshot, tags, keyFor = normalizeArtistName) {
  if (!tags?.size) return snapshot;
  return {
    ...snapshot,
    artists: (snapshot.artists ?? []).map((artist) => {
      if (artist.origin !== "promoter" || artist.genres?.length) return artist;
      const found = tags.get(keyFor(artist.name));
      return found?.length ? { ...artist, genres: found.slice(0, 12) } : artist;
    })
  };
}
function knownArtistNames(snapshot, rosterArtists = []) {
  return [
    ...(snapshot?.artists ?? []).flatMap((artist) => [artist?.name, ...artist?.aliases ?? []]),
    ...rosterArtists.map((artist) => artist?.name)
  ].filter(Boolean);
}

// ../src/artistTags.js
var LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
var MUSICBRAINZ_API_URL = "https://musicbrainz.org/ws/2/artist/";
var MUSICBRAINZ_MIN_INTERVAL_MS = 1100;
var MUSICBRAINZ_MIN_SCORE = 95;
var MAX_TAGS = 20;
var MAX_CONSECUTIVE_FAILURES = 5;
var DAY_MS = 24 * 60 * 60 * 1e3;
var MUSICBRAINZ_USER_AGENT = "TasteEngine/0.1 (private personal event importer)";
function artistTagKey(name) {
  return normalizeArtistName(name) || String(name ?? "").trim().toLowerCase();
}
async function resolveArtistTags(names, {
  lastFmApiKey = null,
  cache = {},
  now = /* @__PURE__ */ new Date(),
  fetchImpl = fetch,
  maxLookups = 200,
  ttlDays = 60,
  sleep: sleep2 = defaultSleep,
  timeoutMs = 15e3
} = {}) {
  const provider = lastFmApiKey ? "lastfm" : "musicbrainz";
  const providerLabel2 = lastFmApiKey ? "Last.fm" : "MusicBrainz";
  const currentTime = new Date(now);
  const ttlMs = ttlDays * DAY_MS;
  const nextCache = { ...cache && typeof cache === "object" ? cache : {} };
  const tags = /* @__PURE__ */ new Map();
  const warnings = [];
  const pending = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rawName of names ?? []) {
    const name = String(rawName ?? "").trim();
    const key = artistTagKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = nextCache[key];
    if (isFresh(entry, currentTime, ttlMs)) tags.set(key, cleanTags(entry.tags));
    else pending.push({ name, key });
  }
  const request = { fetchImpl, timeoutMs, sleep: sleep2, lastFmApiKey };
  let lookups = 0;
  let consecutiveFailures = 0;
  let deferred = 0;
  let abandoned = 0;
  for (const { name, key } of pending) {
    const stale = Array.isArray(nextCache[key]?.tags) ? cleanTags(nextCache[key].tags) : null;
    if (lookups >= maxLookups) {
      deferred += 1;
      if (stale) tags.set(key, stale);
      continue;
    }
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      abandoned += 1;
      if (stale) tags.set(key, stale);
      continue;
    }
    lookups += 1;
    try {
      const found = lastFmApiKey ? await lastFmTopTags(name, request) : await musicBrainzTags(name, request);
      nextCache[key] = { tags: found, provider, fetchedAt: currentTime.toISOString() };
      tags.set(key, found);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (stale) tags.set(key, stale);
      warnings.push(`No ${providerLabel2} tags for ${name}: ${error?.message ?? "lookup failed"}`);
    }
  }
  if (abandoned > 0) {
    warnings.push(`${providerLabel2} tag lookups stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures; ${abandoned} artist(s) left unresolved this run.`);
  }
  if (deferred > 0) {
    warnings.push(`${deferred} artist(s) were not looked up this run (budget of ${maxLookups} ${providerLabel2} lookups); they resolve on later runs.`);
  }
  return { tags, cache: nextCache, lookups, provider, warnings };
}
async function lastFmTopTags(artistName, { fetchImpl, timeoutMs, lastFmApiKey }) {
  const url = new URL(LASTFM_API_URL);
  url.searchParams.set("method", "artist.gettoptags");
  url.searchParams.set("artist", artistName);
  url.searchParams.set("api_key", lastFmApiKey);
  url.searchParams.set("format", "json");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await safeJson(response);
  if (Number(body?.error) === 6) return [];
  if (!response.ok || !body || body.error) {
    throw new Error(body?.message ? String(body.message) : `Last.fm tag lookup failed (${response.status})`);
  }
  const raw = Array.isArray(body?.toptags?.tag) ? body.toptags.tag : body?.toptags?.tag ? [body.toptags.tag] : [];
  return cleanTags(raw.map((tag) => tag?.name));
}
async function musicBrainzTags(artistName, { fetchImpl, timeoutMs, sleep: sleep2 }) {
  const url = new URL(MUSICBRAINZ_API_URL);
  url.searchParams.set("query", `artist:"${artistName.replace(/[\\"]/g, "\\$&")}"`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "3");
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await sleep2(MUSICBRAINZ_MIN_INTERVAL_MS);
    response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": MUSICBRAINZ_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status !== 503 && response.status !== 429) break;
  }
  const body = await safeJson(response);
  if (!response.ok || !Array.isArray(body?.artists)) {
    throw new Error(typeof body?.error === "string" ? body.error : `MusicBrainz lookup failed (${response.status})`);
  }
  const wanted = artistTagKey(artistName);
  const matches = body.artists.filter((artist) => Number(artist?.score) >= MUSICBRAINZ_MIN_SCORE && [artist?.name, ...Array.isArray(artist?.aliases) ? artist.aliases.map((alias) => alias?.name) : []].some((candidate) => candidate && artistTagKey(candidate) === wanted));
  if (matches.length !== 1) return [];
  const ranked = (Array.isArray(matches[0].tags) ? matches[0].tags : []).filter((tag) => typeof tag?.name === "string" && Number(tag.count) > 0).sort((left, right) => Number(right.count) - Number(left.count) || left.name.localeCompare(right.name));
  return cleanTags(ranked.map((tag) => tag.name));
}
function isFresh(entry, now, ttlMs) {
  if (!entry || !Array.isArray(entry.tags)) return false;
  const fetchedAt = Date.parse(entry.fetchedAt);
  return Number.isFinite(fetchedAt) && now.getTime() - fetchedAt < ttlMs;
}
function cleanTags(values) {
  const result = [];
  for (const value of values ?? []) {
    if (typeof value !== "string") continue;
    const tag = value.trim().toLowerCase();
    if (tag && !result.includes(tag)) result.push(tag);
    if (result.length >= MAX_TAGS) break;
  }
  return result;
}
function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
async function safeJson(response) {
  try {
    const text3 = await response.text();
    return text3 ? JSON.parse(text3) : null;
  } catch {
    return null;
  }
}

// ../src/eventType.js
function classifyEventType(event) {
  const title = String(event?.title ?? "").toLowerCase();
  if (title.includes("festival") || String(event?.type ?? "").includes("festival") || (event?.destination?.days?.length ?? 0) > 1 || (event?.performers?.length ?? 0) >= 6) return "festival";
  if (title.includes("dj set") || title.includes("open to close")) return "dj set";
  return "concert";
}

// ../src/feedbackPolicy.js
var FEEDBACK_POLICY = Object.freeze({
  version: 4,
  priorStrength: 1.5,
  tasteHalfLifeDays: 365,
  frictionHalfLifeDays: 180,
  caps: Object.freeze({ artist: 6, venue: 3, promoter: 2, shape: 1.5, opponent: 3 }),
  maxTotalAdjustment: 10,
  maxFriction: 2
});
var INTEREST_STATUS = "interested";
var TASTE_REASONS = Object.freeze(["artist", "lineup", "production", "crowd", "venue"]);
var LOGISTICS_REASONS = Object.freeze(["timing", "hassle", "price", "distance", "availability", "calendar", "recovery"]);
var TASTE_CATEGORIES = ["artist", "venue", "promoter", "shape", "opponent"];
var FRICTION_CATEGORIES = ["venue", "weekday", "shape"];
var REASON_SCOPE = {
  artist: ["artist"],
  lineup: ["artist"],
  venue: ["venue"],
  production: ["venue", "promoter"],
  crowd: ["venue", "promoter", "shape"]
};
var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function feedbackKeysFor(item, vertical = "music") {
  if (!item || typeof item !== "object") return {};
  const keys = {};
  const add = (category, id, label) => {
    const normalized = normalizeArtistName(id);
    if (!normalized) return;
    const list = keys[category] ?? (keys[category] = []);
    const key = `${category}:${normalized}`;
    if (!list.some((entry) => entry.key === key)) list.push({ key, label: String(label ?? id).trim().slice(0, 120) });
  };
  const venue = item.venue ?? {};
  if (venue.name) add("venue", `${venue.name} ${venue.city ?? ""}`, venue.name);
  const weekday = weekdayOf(item.startLocal);
  if (weekday != null) add("weekday", WEEKDAYS[weekday], `${WEEKDAYS[weekday]}s`);
  if (vertical === "sports") {
    const football = (item.league ?? item.sportsContext?.league) === "nfl" || String(item.id ?? "").startsWith("nfl:");
    add("shape", football ? "football" : "baseball", football ? "Rams games" : "Dodgers games");
    const opponent = item.awayTeam?.name ?? item.awayTeam?.shortName;
    if (opponent) add("opponent", opponent, opponent);
    return keys;
  }
  for (const performer of (item.performers ?? []).slice(0, 12)) add("artist", performer?.name, performer?.name);
  const sources = new Set([
    ...item.sources ?? [],
    ...(item.sourceOccurrences ?? []).map((occurrence) => occurrence?.source),
    item.source
  ].filter(Boolean));
  for (const promoter of item.promoters ?? []) add("promoter", promoter, promoter);
  for (const source of PROMOTER_SOURCES) {
    if (sources.has(source)) add("promoter", source, source === "insomniac" ? "Insomniac" : "Framework");
  }
  const shape = item.eventType ?? classifyEventType(item);
  add("shape", shape, shape === "dj set" ? "DJ sets" : `${shape}s`);
  return keys;
}
function deriveFeedbackSignals(records = [], { now = /* @__PURE__ */ new Date(), policy = FEEDBACK_POLICY } = {}) {
  const nowMs = new Date(now).getTime();
  const latestByEvent = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const eventKey = `${record.canonicalEventId ?? ""}|${record.eventDateLocal ?? ""}`;
    const current = latestByEvent.get(eventKey);
    if (!current || String(record.recordedAt ?? "") >= String(current.recordedAt ?? "")) latestByEvent.set(eventKey, record);
  }
  const taste = /* @__PURE__ */ new Map();
  const friction = /* @__PURE__ */ new Map();
  let countedRecords = 0;
  for (const record of latestByEvent.values()) {
    const reading = readRecord(record);
    if (!reading.taste && !reading.friction) continue;
    const keys = recordKeys(record);
    if (!Object.keys(keys).length) continue;
    countedRecords += 1;
    const date = signalDate(record, nowMs);
    const ageDays = Math.max(0, (nowMs - date) / 864e5);
    if (reading.taste) {
      const decay = 2 ** (-ageDays / policy.tasteHalfLifeDays);
      for (const category of reading.taste.categories.filter((item) => TASTE_CATEGORIES.includes(item))) {
        for (const entry of keys[category] ?? []) accumulate(taste, category, entry, reading.taste.value, reading.taste.weight * decay, record);
      }
    }
    if (reading.friction) {
      const decay = 2 ** (-ageDays / policy.frictionHalfLifeDays);
      for (const category of FRICTION_CATEGORIES) {
        for (const entry of keys[category] ?? []) accumulate(friction, category, entry, reading.friction.value, reading.friction.weight * decay, record);
      }
    }
  }
  for (const signal of taste.values()) finalize(signal, policy, policy.caps[signal.category] ?? 0);
  for (const signal of friction.values()) finalize(signal, policy, policy.maxFriction);
  return { policyVersion: policy.version, taste, friction, countedRecords };
}
function applyFeedbackOverlay(rows, vertical, signals, { policy = FEEDBACK_POLICY } = {}) {
  const audit = { policyVersion: policy.version, adjustedCount: 0, totalAbsoluteAdjustment: 0, maxTotalAdjustment: policy.maxTotalAdjustment };
  if (!signals?.taste?.size && !signals?.friction?.size) return { rows, audit };
  const adjusted = rows.map((row) => {
    if (!row?.ranking || row.ranking.excluded) return row;
    const keys = row.feedbackKeys && Object.keys(row.feedbackKeys).length ? row.feedbackKeys : feedbackKeysFor(row, vertical);
    const taste = matchSignals(keys, signals.taste, TASTE_CATEGORIES);
    const friction = matchSignals(keys, signals.friction, FRICTION_CATEGORIES);
    const tasteDelta = Math.max(-policy.maxTotalAdjustment, Math.min(policy.maxTotalAdjustment, taste.reduce((sum, match) => sum + match.delta, 0)));
    const baseHassle = Number(row.ranking.hassleScore ?? 0);
    const frictionPoints = Math.max(-policy.maxFriction, Math.min(policy.maxFriction, Math.round(friction.reduce((sum, match) => sum + match.delta, 0))));
    const hassleScore = Math.max(0, Math.min(10, baseHassle + frictionPoints));
    const scoreDelta = round(tasteDelta - (hassleScore - baseHassle) * 2);
    if (!scoreDelta) return row;
    audit.adjustedCount += 1;
    audit.totalAbsoluteAdjustment = round(audit.totalAbsoluteAdjustment + Math.abs(scoreDelta));
    const baseUtility = Number(row.ranking.utility ?? 0);
    const utility = round(baseUtility + scoreDelta);
    const reasons = [
      ...taste.map((match) => ({ kind: "taste", category: match.category, label: match.label, delta: round(match.delta), outcomes: match.outcomes })),
      ...hassleScore !== baseHassle ? friction.map((match) => ({ kind: "friction", category: match.category, label: match.label, delta: round(-(hassleScore - baseHassle) * 2 / friction.length), outcomes: match.outcomes })) : []
    ].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
    return {
      ...row,
      ranking: {
        ...row.ranking,
        baseUtility,
        utility,
        hassleScore,
        ...row.ranking.call ? { call: callLabel(utility) } : {},
        feedbackAdjustment: { applied: true, scoreDelta, policyVersion: policy.version, reasons }
      }
    };
  });
  return { rows: adjusted, audit };
}
function describeLearning(signals, { limit = 12 } = {}) {
  const rows = [];
  for (const [kind, map] of [["taste", signals?.taste], ["friction", signals?.friction]]) {
    for (const signal of map?.values() ?? []) {
      if (Math.abs(signal.delta) < 0.25) continue;
      rows.push({
        kind,
        category: signal.category,
        label: signal.label,
        direction: signal.delta > 0 ? "up" : "down",
        strength: round(Math.abs(signal.score)),
        delta: round(signal.delta),
        outcomes: signal.outcomes,
        lastDate: signal.lastDate
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label)).slice(0, limit);
}
function readRecord(record) {
  const status = String(record.status ?? "");
  const rating = Number.isInteger(record.rating) ? record.rating : null;
  const reasons = Array.isArray(record.reasonCodes) ? record.reasonCodes.map(String) : [];
  const tags = Array.isArray(record.signalTags) ? record.signalTags.map(String) : [];
  const tasteReasons = reasons.filter((reason) => TASTE_REASONS.includes(reason));
  const logistics = [...reasons, ...tags].some((reason) => LOGISTICS_REASONS.includes(reason));
  const scoped = (names) => {
    const categories = [...new Set(names.flatMap((name) => REASON_SCOPE[name] ?? []))];
    return categories.length ? categories : TASTE_CATEGORIES;
  };
  switch (status) {
    case "attended-worth-it":
      return {
        taste: { value: rating === 5 ? 1 : 0.6, weight: 1, categories: scoped(tags) },
        // It was worth the trouble: evidence against treating it as friction.
        friction: logistics ? { value: 0.5, weight: 0.5 } : { value: -0.5, weight: 0.5 }
      };
    case "attended-not-worth-it": {
      const onlyLogistics = logistics && !tasteReasons.length && !tags.some((tag) => REASON_SCOPE[tag]);
      return {
        taste: onlyLogistics ? null : { value: rating === 3 ? -0.3 : -1, weight: 1, categories: scoped([...tasteReasons, ...tags]) },
        friction: logistics ? { value: 1, weight: 0.8 } : null
      };
    }
    case "wanted-to-attend":
      return { taste: { value: 0.4, weight: 0.5, categories: TASTE_CATEGORIES }, friction: logistics ? { value: 1, weight: 0.4 } : null };
    case INTEREST_STATUS:
      return { taste: { value: rating === 5 ? 0.5 : 0.25, weight: rating === 5 ? 0.5 : 0.35, categories: ["artist", "promoter", "opponent"] }, friction: null };
    case "lost-interest":
      return {
        taste: tasteReasons.length ? { value: -0.7, weight: 0.6, categories: scoped(tasteReasons) } : null,
        friction: logistics ? { value: 1, weight: 0.5 } : null
      };
    case "did-not-attend-logistical":
      return { taste: null, friction: { value: 1, weight: 0.6 } };
    default:
      return { taste: null, friction: null };
  }
}
function recordKeys(record) {
  const frozen = record.feedbackKeys;
  if (frozen && typeof frozen === "object" && !Array.isArray(frozen)) {
    const keys = {};
    for (const [category, entries] of Object.entries(frozen)) {
      const list = (Array.isArray(entries) ? entries : []).filter((entry) => entry && typeof entry.key === "string" && entry.key.startsWith(`${category}:`)).map((entry) => ({ key: entry.key, label: String(entry.label ?? entry.key.slice(category.length + 1)) }));
      if (list.length) keys[category] = list;
    }
    if (Object.keys(keys).length) return keys;
  }
  const title = String(record.eventTitleSnapshot ?? "").replace(/\s*[([][^)\]]*[)\]]/g, "").trim();
  const game = title.match(/^(.+?)\s+at\s+(?:the\s+)?Los Angeles (Dodgers|Rams)$/i);
  if (game) {
    const football = /rams/i.test(game[2]);
    return {
      opponent: [{ key: `opponent:${normalizeArtistName(game[1])}`, label: game[1] }],
      shape: [{ key: `shape:${football ? "football" : "baseball"}`, label: football ? "Rams games" : "Dodgers games" }]
    };
  }
  const headliner = title.split(/\s+with\s+/i)[0].trim();
  if (headliner && !/[:&,]|\bpresents?\b|\bvs\.?\b|\bat\b|\bfestival\b/i.test(headliner)) {
    return { artist: [{ key: `artist:${normalizeArtistName(headliner)}`, label: headliner }] };
  }
  return {};
}
function accumulate(map, category, entry, value, weight, record) {
  if (!(weight > 0)) return;
  const signal = map.get(entry.key) ?? { key: entry.key, category, label: entry.label, weighted: 0, evidence: 0, events: /* @__PURE__ */ new Set(), lastDate: null };
  signal.weighted += value * weight;
  signal.evidence += weight;
  signal.events.add(`${record.canonicalEventId}|${record.eventDateLocal}`);
  const date = String(record.eventDateLocal ?? "").slice(0, 10) || null;
  if (date && (!signal.lastDate || date > signal.lastDate)) signal.lastDate = date;
  map.set(entry.key, signal);
}
function finalize(signal, policy, cap) {
  signal.score = signal.weighted / (signal.evidence + policy.priorStrength);
  signal.delta = signal.score * cap;
  signal.outcomes = signal.events.size;
  delete signal.events;
}
function matchSignals(keys, signalMap, categories) {
  const matches = [];
  for (const category of categories) {
    const hits = (keys[category] ?? []).map((entry) => signalMap.get(entry.key)).filter(Boolean);
    if (!hits.length) continue;
    const evidence = hits.reduce((sum, hit) => sum + hit.evidence, 0);
    const delta = hits.reduce((sum, hit) => sum + hit.delta * hit.evidence, 0) / (evidence || 1);
    const strongest = [...hits].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    matches.push({ category, label: strongest.label, delta, outcomes: hits.reduce((sum, hit) => sum + hit.outcomes, 0) });
  }
  return matches;
}
function signalDate(record, nowMs) {
  const eventMs = Date.parse(`${String(record.eventDateLocal ?? "").slice(0, 10)}T12:00:00Z`);
  const recordedMs = Date.parse(String(record.recordedAt ?? ""));
  if (Number.isFinite(eventMs) && eventMs <= nowMs) return eventMs;
  return Number.isFinite(recordedMs) ? Math.min(recordedMs, nowMs) : nowMs;
}
function weekdayOf(startLocal) {
  const key = String(startLocal ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return (/* @__PURE__ */ new Date(`${key}T12:00:00Z`)).getUTCDay();
}
function round(value) {
  return Math.round(value * 100) / 100;
}

// ../src/deadline.js
var SOURCE_DEADLINE_MS = 6e4;
function withDeadline(promise, ms = SOURCE_DEADLINE_MS, label = "source") {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(ms / 1e3)}s`)), ms);
  });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
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
  currentMinScore = 28,
  horizonDays = null
} = {}) {
  const candidates = buildCandidates(events, sports);
  const currentPool = candidates.filter((candidate) => {
    const days = daysFrom(candidate.startLocal, now);
    return days != null && days >= 0 && days <= currentDays;
  });
  const representatives = selectRepresentativeCandidates(currentPool).filter((candidate) => candidate.call !== "skip");
  const clearing = representatives.filter((candidate) => candidate.score >= currentMinScore).slice(0, 5);
  const fallback = !clearing.length && representatives[0] && representatives[0].score >= currentMinScore * 0.6 ? [representatives[0]] : [];
  const currentRepresentatives = clearing.length ? clearing : fallback;
  const current = currentRepresentatives.map((candidate) => ({
    ...toOverviewDisplay(candidate),
    bucket: "current",
    ...clearing.length ? {} : { fallback: true }
  }));
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
    feedbackKeys: event.feedbackKeys ?? null,
    discovery: event.ranking.discovery ?? null,
    feedbackAdjustment: event.ranking.feedbackAdjustment ?? null,
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
    eventType: game.league === "nfl" ? "football" : "baseball",
    league: game.league ?? "mlb",
    visual: game.visual ?? resolveSportsVisual(game),
    feedbackSnapshot: game.feedbackSnapshot ?? null,
    feedbackKeys: game.feedbackKeys ?? null,
    feedbackAdjustment: game.ranking.feedbackAdjustment ?? null,
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
  const home = game.homeTeam?.name || game.homeTeam?.shortName ? friendlyTeamName(game.homeTeam) : "Dodgers";
  return `${home} vs. ${opponent}`;
}
function friendlyTeamName(team = {}) {
  const name = String(team.name ?? team.shortName ?? "Opponent");
  const known = ["Dodgers", "Diamondbacks", "Padres", "Giants", "Yankees", "Mets", "Cubs", "Cardinals", "Astros", "Red Sox", "Braves", "Phillies", "Brewers", "Marlins", "Nationals", "Reds", "Pirates", "Rockies", "Tigers", "Twins", "White Sox", "Guardians", "Rays", "Blue Jays", "Orioles", "Royals", "Angels", "Athletics", "Mariners", "Rangers"];
  const match = known.find((label) => name.toLocaleLowerCase().includes(label.toLocaleLowerCase()));
  if (match) return match;
  return String(team.shortName ?? name).replace(/^Arizona$/i, "Diamondbacks").replace(/^Los Angeles\s+/i, "").trim();
}
function overviewComparator(left, right) {
  const scoreDelta = right.score - left.score;
  if (Math.abs(scoreDelta) <= 5 && left.vertical !== right.vertical) return left.vertical === "music" ? -1 : 1;
  return scoreDelta || String(left.startLocal).localeCompare(String(right.startLocal));
}
function daysFrom(value, now) {
  return localDateDifference(value, now);
}

// ../src/feedbackReview.js
function buildFeedbackReview({ projection = {}, records = [], now = /* @__PURE__ */ new Date(), currentMinScore = 28, planAheadMinScore = 55, policy = FEEDBACK_POLICY } = {}) {
  const signals = deriveFeedbackSignals(records, { now, policy });
  const baseline = {
    events: (projection.events ?? []).map(withoutAppliedLearning),
    sports: (projection.sports ?? []).map(withoutAppliedLearning)
  };
  const music = applyFeedbackOverlay(baseline.events, "music", signals, { policy });
  const sports = applyFeedbackOverlay(baseline.sports, "sports", signals, { policy });
  const movements = [
    ...movementsFor(baseline.events, music.rows, "music"),
    ...movementsFor(baseline.sports, sports.rows, "sports")
  ].sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta) || a.id.localeCompare(b.id));
  const options = { now, currentDays: 14, currentMinScore, planAheadMinScore, horizonDays: projection.horizon?.days ?? null };
  const before = buildOverviewBuckets(baseline.events, baseline.sports, options);
  const after = buildOverviewBuckets(music.rows, sports.rows, options);
  const shortlist = {
    current: membershipChange(before.current, after.current),
    planAhead: membershipChange(before.planAhead, after.planAhead)
  };
  const learned = describeLearning(signals, { limit: 50 });
  const review = {
    schemaVersion: 2,
    policyVersion: policy.version,
    generatedAt: new Date(now).toISOString(),
    projectionGeneratedAt: projection.generatedAt ?? null,
    countedOutcomeCount: signals.countedRecords,
    learned,
    candidateCount: baseline.events.length + baseline.sports.length,
    adjustedCandidateCount: movements.length,
    largestAdjustment: movements[0]?.scoreDelta ?? 0,
    maxTotalAdjustment: policy.maxTotalAdjustment,
    movements,
    shortlist,
    shortlistChanged: Boolean(shortlist.current.added.length || shortlist.current.removed.length || shortlist.planAhead.added.length || shortlist.planAhead.removed.length)
  };
  return { ...review, digest: digestOf({ policyVersion: review.policyVersion, learned, movements: movements.map(({ id, scoreDelta }) => [id, scoreDelta]) }) };
}
function withoutAppliedLearning(item) {
  const adjustment = item?.ranking?.feedbackAdjustment;
  if (!item?.ranking) return item;
  const { feedbackAdjustment: _adjustment, ...ranking } = item.ranking;
  if (!adjustment?.applied) return { ...item, ranking };
  const { baseUtility, ...rest } = ranking;
  return { ...item, ranking: { ...rest, utility: baseUtility ?? round2(Number(ranking.utility ?? 0) - Number(adjustment.scoreDelta ?? 0)) } };
}
function movementsFor(before, after, vertical) {
  const rank = (items) => new Map([...items].sort((a, b) => b.ranking.utility - a.ranking.utility || String(a.id).localeCompare(String(b.id))).map((item, index) => [item.id, index + 1]));
  const beforeRank = rank(before.filter((item) => item?.ranking));
  const afterRank = rank(after.filter((item) => item?.ranking));
  return after.flatMap((item) => {
    const adjustment = item?.ranking?.feedbackAdjustment;
    if (!adjustment?.scoreDelta) return [];
    return [{
      id: String(item.id),
      vertical,
      title: String(item.title ?? `${item.awayTeam?.name ?? "Away"} at ${item.homeTeam?.name ?? "Home"}`),
      scoreDelta: adjustment.scoreDelta,
      scoreBefore: round2(item.ranking.utility - adjustment.scoreDelta),
      scoreAfter: item.ranking.utility,
      rankBefore: beforeRank.get(item.id) ?? null,
      rankAfter: afterRank.get(item.id) ?? null,
      reasons: adjustment.reasons ?? []
    }];
  });
}
function membershipChange(before, after) {
  const beforeIds = new Set(before.map((item) => String(item.id)));
  const afterIds = new Set(after.map((item) => String(item.id)));
  return {
    added: [...afterIds].filter((id) => !beforeIds.has(id)).sort(),
    removed: [...beforeIds].filter((id) => !afterIds.has(id)).sort()
  };
}
function digestOf(value) {
  const text3 = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text3.length; index += 1) {
    hash ^= text3.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fr${hash.toString(16).padStart(8, "0")}-${text3.length.toString(36)}`;
}
function round2(value) {
  return Math.round(value * 100) / 100;
}

// ../src/movieEngagements.js
var ENGAGEMENT_FORMATS = Object.freeze(["IMAX", "IMAX 70mm", "70mm", "35mm", "Dolby Cinema", "Standard"]);
var DEFAULT_ENGAGEMENT_EXPIRY_DAYS = 21;
var ENGAGEMENT_TIME_ZONE = "America/Los_Angeles";
var ENGAGEMENT_SOURCE = "movie-engagements";
var FORMAT_RANK = new Map(["IMAX 70mm", "70mm", "IMAX", "Dolby Cinema", "35mm", "Standard"].map((format, index) => [format, index]));
var FORMAT_BY_KEY = new Map(ENGAGEMENT_FORMATS.map((format) => [normalizeName(format), format]));
var MAX_NOTE_LENGTH = 280;
var ENTRY_FIELDS = /* @__PURE__ */ new Set([
  "tmdbId",
  "title",
  "year",
  "theater",
  "format",
  "startDate",
  "endDate",
  "showtimes",
  "sourceUrl",
  "confirmedAt",
  "expiresAt",
  "note",
  "allowOtherTheater",
  // Derived by normalizeEngagements; accepted so its output can be fed back in.
  "index",
  "premium",
  "priorityTheater"
]);
function normalizeEngagements(input, { now = /* @__PURE__ */ new Date(), priorityTheaters = [], timeZone = ENGAGEMENT_TIME_ZONE } = {}) {
  const clock = localClock(now, timeZone);
  const result = { configured: input != null, engagements: [], rejected: [], expired: [], warnings: [], error: null };
  if (input == null) return result;
  const list = Array.isArray(input) ? input : Array.isArray(input?.engagements) ? input.engagements : null;
  if (!list) {
    result.error = 'Engagement list must be an array or an object with an "engagements" array.';
    return result;
  }
  const theaters = theaterAllowlist(priorityTheaters);
  const seen = /* @__PURE__ */ new Map();
  list.forEach((raw, position) => {
    const index = isPlainObject(raw) && Number.isInteger(raw.index) && raw.index >= 0 ? raw.index : position;
    const outcome = normalizeEntry(raw, { clock, theaters, timeZone });
    const label = { index, title: outcome.title ?? null };
    if (outcome.reason) {
      result.rejected.push({ ...label, reason: outcome.reason });
      return;
    }
    const engagement = { index, ...outcome.engagement };
    const duplicateKey = [engagement.tmdbId ?? `${normalizeName(engagement.title)}#${engagement.year ?? ""}`, normalizeName(engagement.theater), engagement.format, engagement.startDate, engagement.endDate ?? ""].join("|");
    if (seen.has(duplicateKey)) {
      result.rejected.push({ ...label, reason: `duplicate of entry ${seen.get(duplicateKey)}` });
      return;
    }
    seen.set(duplicateKey, index);
    const lapse = expiryReason(engagement, clock, timeZone);
    if (lapse) {
      result.expired.push({ ...label, theater: engagement.theater, format: engagement.format, expiresAt: engagement.expiresAt, reason: lapse });
      return;
    }
    if (outcome.warning) result.warnings.push({ ...label, reason: outcome.warning });
    result.engagements.push(engagement);
  });
  return result;
}
function applyEngagements(movies, engagements, { priorityTheaters = [], now = /* @__PURE__ */ new Date(), timeZone = ENGAGEMENT_TIME_ZONE } = {}) {
  const clock = localClock(now, timeZone);
  const films = Array.isArray(movies) ? movies : [];
  const normalized = normalizeEngagements(engagements, { now, priorityTheaters, timeZone });
  const carried = isPlainObject(engagements) ? engagements : {};
  const rejected = [...reportList(carried.rejected), ...normalized.rejected];
  const expired = [...reportList(carried.expired), ...normalized.expired];
  const configured = carried.configured === false ? false : normalized.configured;
  const error = normalized.error ?? (typeof carried.error === "string" ? carried.error : null);
  const unmatched = [];
  const byTmdbId = /* @__PURE__ */ new Map();
  const byTitle = /* @__PURE__ */ new Map();
  films.forEach((movie, position) => {
    const id = movieTmdbId(movie);
    if (id && !byTmdbId.has(id)) byTmdbId.set(id, position);
    const key = normalizeName(movie?.title);
    if (key) byTitle.set(key, [...byTitle.get(key) ?? [], position]);
  });
  const matches = /* @__PURE__ */ new Map();
  for (const engagement of normalized.engagements) {
    const match = matchFilm(engagement, films, byTmdbId, byTitle);
    if (match.reason) {
      unmatched.push({
        index: engagement.index,
        title: engagement.title,
        year: engagement.year,
        tmdbId: engagement.tmdbId,
        theater: engagement.theater,
        format: engagement.format,
        reason: match.reason
      });
      continue;
    }
    matches.set(match.position, [...matches.get(match.position) ?? [], displayEngagement(engagement, clock)]);
  }
  let appliedCount = 0;
  const output = films.map((movie, position) => {
    const display = matches.get(position);
    if (!display?.length) return movie;
    display.sort(compareEngagements);
    appliedCount += display.length;
    const headline = display.find((engagement) => engagement.premium) ?? display[0];
    return {
      ...movie,
      engagements: display,
      premiumFormatConfirmed: display.some((engagement) => engagement.premium),
      formatStatus: "confirmed",
      theater: headline.theater,
      format: headline.format,
      actionable: true,
      nextScreening: headline.nextScreening
    };
  });
  return {
    movies: output,
    configured,
    error,
    appliedCount,
    confirmedMovieCount: matches.size,
    unmatched,
    expired,
    rejected,
    warnings: normalized.warnings
  };
}
function engagementSourceHealth(result = {}) {
  const count = (value) => Array.isArray(value) ? value.length : 0;
  const applied = Number(result.appliedCount) || 0;
  const unmatched = count(result.unmatched);
  const expired = count(result.expired);
  const rejected = count(result.rejected);
  const conflicts = count(result.warnings);
  const warningCount = unmatched + rejected + conflicts + (result.error ? 1 : 0);
  let status;
  if (result.error) status = "unavailable";
  else if (!result.configured) status = "not configured";
  else if (warningCount > 0) status = "partial";
  else status = "active";
  const expiries = (Array.isArray(result.movies) ? result.movies : []).flatMap((movie) => Array.isArray(movie?.engagements) ? movie.engagements : []).map((engagement) => String(engagement.expiresAt ?? "").slice(0, 10)).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  return {
    source: ENGAGEMENT_SOURCE,
    status,
    itemCount: applied,
    warningCount,
    details: {
      confirmedFilms: Number(result.confirmedMovieCount) || 0,
      activeEngagements: applied,
      unmatchedEngagements: unmatched,
      expiredEngagements: expired,
      rejectedEngagements: rejected,
      formatConflicts: conflicts,
      nextExpiry: expiries[0] ?? null
    }
  };
}
function normalizeEntry(raw, { clock, theaters, timeZone }) {
  if (!isPlainObject(raw)) return { reason: "entry must be an object" };
  const title = cleanText(raw.title);
  const fail = (reason) => ({ title: title || null, reason });
  if (!title || !normalizeName(title)) return fail("title is required");
  const unknown = Object.keys(raw).find((key) => !ENTRY_FIELDS.has(key));
  if (unknown) return fail(`unknown field "${unknown}"`);
  const sourceUrl = httpsUrl(raw.sourceUrl);
  if (!sourceUrl) return fail("sourceUrl is required and must be an https URL");
  let tmdbId = null;
  if (raw.tmdbId != null && raw.tmdbId !== "") {
    tmdbId = parseTmdbId(raw.tmdbId);
    if (!tmdbId) return fail("tmdbId must be a positive integer");
  }
  let year = null;
  if (raw.year != null && raw.year !== "") {
    year = Number(raw.year);
    if (!Number.isInteger(year) || year < 1888 || year > 2200) return fail("year must be a four-digit year");
  }
  const format = FORMAT_BY_KEY.get(normalizeName(raw.format));
  if (!format) return fail(`format must be one of: ${ENGAGEMENT_FORMATS.join(", ")}`);
  const theaterInput = cleanText(raw.theater);
  const theaterKey = normalizeName(theaterInput);
  if (!theaterKey) return fail("theater is required");
  const listed = theaters.get(theaterKey);
  if (raw.allowOtherTheater != null && typeof raw.allowOtherTheater !== "boolean") return fail("allowOtherTheater must be true or false");
  if (!listed && raw.allowOtherTheater !== true) return fail("theater is not a configured priority theater (set allowOtherTheater: true to permit it)");
  if (!isDateKey(raw.startDate)) return fail("startDate is required as YYYY-MM-DD");
  const startDate = raw.startDate;
  let endDate = null;
  if (raw.endDate != null && raw.endDate !== "") {
    if (!isDateKey(raw.endDate)) return fail("endDate must be YYYY-MM-DD");
    if (raw.endDate < startDate) return fail("endDate is before startDate");
    endDate = raw.endDate;
  }
  let showtimes = [];
  if (raw.showtimes != null) {
    if (!Array.isArray(raw.showtimes)) return fail("showtimes must be an array of local ISO date-times");
    const parsed = raw.showtimes.map(parseLocalShowtime);
    if (parsed.some((value) => !value)) return fail("showtimes must be local ISO date-times such as 2026-12-18T19:00 (no time zone suffix)");
    if (parsed.some((value) => value.slice(0, 10) < startDate || endDate && value.slice(0, 10) > endDate)) return fail("a showtime falls outside startDate/endDate");
    showtimes = [...new Set(parsed)].sort();
  }
  const confirmed = parseStamp(raw.confirmedAt, timeZone);
  if (!confirmed) return fail("confirmedAt is required as YYYY-MM-DD or an ISO timestamp with a time zone");
  if (confirmed.dateKey > clock.date) return fail("confirmedAt is in the future");
  let expires = null;
  if (raw.expiresAt != null && raw.expiresAt !== "") {
    expires = parseStamp(raw.expiresAt, timeZone);
    if (!expires) return fail("expiresAt must be YYYY-MM-DD or an ISO timestamp with a time zone");
  }
  let note = null;
  if (raw.note != null && raw.note !== "") {
    if (typeof raw.note !== "string") return fail("note must be text");
    note = cleanText(raw.note).slice(0, MAX_NOTE_LENGTH) || null;
  }
  const premium = format !== "Standard";
  const conflict = listed && premium && listed.formats.size && !listed.formats.has(format) ? `${format} is not among the formats configured for this priority theater` : null;
  return {
    title,
    warning: conflict,
    engagement: {
      tmdbId,
      title,
      year,
      theater: listed?.name ?? theaterInput,
      format,
      premium,
      priorityTheater: Boolean(listed),
      ...listed ? {} : { allowOtherTheater: true },
      startDate,
      endDate,
      showtimes,
      sourceUrl,
      confirmedAt: confirmed.value,
      // Default expiry: the run's end date, else three weeks after review.
      expiresAt: expires?.value ?? endDate ?? addDays(confirmed.dateKey, DEFAULT_ENGAGEMENT_EXPIRY_DAYS),
      note
    }
  };
}
function expiryReason(engagement, clock, timeZone) {
  const expires = parseStamp(engagement.expiresAt, timeZone);
  if (expires?.instant != null ? clock.instant > expires.instant : clock.date > expires.dateKey) return "confirmation expired";
  if (engagement.endDate && clock.date > engagement.endDate) return "run ended";
  if (!engagement.endDate && engagement.showtimes.length && engagement.showtimes.every((showtime) => showtime < clock.dateTime)) {
    return "published showtimes have passed";
  }
  return null;
}
function matchFilm(engagement, films, byTmdbId, byTitle) {
  if (engagement.tmdbId) {
    const position = byTmdbId.get(engagement.tmdbId);
    return position == null ? { reason: "no shortlisted film has this TMDB id" } : { position };
  }
  let candidates = byTitle.get(normalizeName(engagement.title)) ?? [];
  if (engagement.year != null) {
    candidates = candidates.filter((position) => String(films[position]?.releaseDate ?? "").slice(0, 4) === String(engagement.year));
  }
  if (!candidates.length) {
    return { reason: engagement.year != null ? "no shortlisted film has this exact title and year" : "no shortlisted film has this exact title" };
  }
  if (candidates.length > 1) return { reason: "title matches more than one shortlisted film; add tmdbId or year" };
  return { position: candidates[0] };
}
function displayEngagement(engagement, clock) {
  const upcoming = engagement.showtimes.filter((showtime) => showtime >= clock.dateTime);
  let nextScreening;
  let nextScreeningBasis;
  if (upcoming.length) {
    nextScreening = upcoming[0].slice(0, 10);
    nextScreeningBasis = "showtime";
  } else if (engagement.startDate >= clock.date) {
    nextScreening = engagement.startDate;
    nextScreeningBasis = "run-start";
  } else {
    nextScreening = clock.date;
    nextScreeningBasis = "run-in-progress";
  }
  return {
    theater: engagement.theater,
    format: engagement.format,
    premium: engagement.premium,
    priorityTheater: engagement.priorityTheater,
    startDate: engagement.startDate,
    endDate: engagement.endDate,
    showtimes: upcoming,
    nextScreening,
    nextShowtime: upcoming[0] ?? null,
    nextScreeningBasis,
    sourceUrl: engagement.sourceUrl,
    confirmedAt: engagement.confirmedAt,
    expiresAt: engagement.expiresAt,
    note: engagement.note
  };
}
function compareEngagements(left, right) {
  return left.nextScreening.localeCompare(right.nextScreening) || String(left.nextShowtime ?? "9999").localeCompare(String(right.nextShowtime ?? "9999")) || FORMAT_RANK.get(left.format) - FORMAT_RANK.get(right.format) || left.theater.localeCompare(right.theater) || left.startDate.localeCompare(right.startDate);
}
function movieTmdbId(movie) {
  return parseTmdbId(movie?.tmdbId) ?? parseTmdbId(movie?.id);
}
function theaterAllowlist(priorityTheaters) {
  const allowlist = /* @__PURE__ */ new Map();
  for (const entry of Array.isArray(priorityTheaters) ? priorityTheaters : []) {
    const name = cleanText(typeof entry === "string" ? entry : entry?.name);
    const key = normalizeName(name);
    if (!key || allowlist.has(key)) continue;
    const formats = new Set((Array.isArray(entry?.formats) ? entry.formats : []).map((format) => FORMAT_BY_KEY.get(normalizeName(format))).filter(Boolean));
    allowlist.set(key, { name, formats });
  }
  return allowlist;
}
function parseTmdbId(value) {
  const match = String(value ?? "").trim().match(/^(?:tmdb:)?([1-9]\d*)$/i);
  return match ? match[1] : null;
}
function httpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
function parseLocalShowtime(value) {
  const match = typeof value === "string" ? value.trim().match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/) : null;
  return match && isDateKey(match[1]) ? `${match[1]}T${match[2]}:${match[3]}` : null;
}
function parseStamp(value, timeZone) {
  if (typeof value !== "string") return null;
  const text3 = value.trim();
  if (isDateKey(text3)) return { value: text3, dateKey: text3, instant: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text3)) return null;
  const instant = Date.parse(text3);
  if (Number.isNaN(instant)) return null;
  const date = new Date(instant);
  return { value: date.toISOString(), dateKey: localClock(date, timeZone).date, instant };
}
function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function addDays(dateKey, days) {
  const date = /* @__PURE__ */ new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function localClock(now, timeZone) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new TypeError('movieEngagements: "now" must be a valid date.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { instant: date.getTime(), date: day, dateTime: `${day}T${parts.hour}:${parts.minute}` };
}
function normalizeName(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
function reportList(value) {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ../src/nfl.js
var ESPN_SITE_API = "https://site.api.espn.com";
var ESPN_GAME_ROOT = "https://www.espn.com/nfl/game/_/gameId";
var REQUEST_HEADERS = { accept: "application/json", "user-agent": "taste-engine-schedule/0.1" };
var SEASON_TYPES = { 1: "preseason", 2: "regular", 3: "postseason" };
var BROADCAST_ZONE = "America/New_York";
var RAMS_TEAM_ID = "14";
var SOFI_STADIUM = Object.freeze({
  name: "SoFi Stadium",
  city: "Inglewood",
  state: "CA",
  lat: 33.9535,
  lon: -118.3392
});
async function fetchRamsHomeGames({
  startDate,
  endDate,
  timezone = "America/Los_Angeles",
  fetchImpl = fetch,
  teamId = RAMS_TEAM_ID,
  homeVenueNames = [SOFI_STADIUM.name],
  homeVenue = SOFI_STADIUM,
  seasons = null,
  seasonTypes = [2, 3],
  // Optional collector. A partial failure (postseason or next-season request)
  // is pushed here so the caller can report the source as `partial`.
  warnings = [],
  retrievedAt = /* @__PURE__ */ new Date()
} = {}) {
  if (!startDate || !endDate) throw new Error("NFL schedule requires startDate and endDate.");
  const seasonYears = seasons?.length ? seasons : nflSeasonsForWindow(startDate, endDate);
  const requests = seasonYears.flatMap((season) => seasonTypes.map((seasonType) => ({ season, seasonType })));
  const events = /* @__PURE__ */ new Map();
  for (const [index, request] of requests.entries()) {
    const label = `${request.season} ${SEASON_TYPES[request.seasonType] ?? `type ${request.seasonType}`}`;
    try {
      const body = await requestSchedule({ teamId, ...request, fetchImpl });
      if (index === 0 && !body.events.length && seasonIsUnderway(startDate)) {
        warnings.push(`NFL ${label} schedule returned no events.`);
      }
      for (const event of body.events) {
        if (event?.id != null && !events.has(String(event.id))) events.set(String(event.id), event);
      }
    } catch (error) {
      if (index === 0) throw error;
      warnings.push(`NFL ${label} schedule unavailable: ${error.message}`);
    }
  }
  return [...events.values()].map((event) => normalizeNflGame(event, { timezone, teamId, retrievedAt, homeVenue })).filter((game) => isHomeGame(game, teamId, homeVenueNames)).filter((game) => !game.scheduleStatus.completed).filter((game) => {
    const date = String(game.startLocal ?? "").slice(0, 10);
    return Boolean(date) && date >= startDate && date <= endDate;
  }).sort((left, right) => String(left.startLocal).localeCompare(String(right.startLocal)));
}
async function fetchNflStandings({ season = null, fetchImpl = fetch } = {}) {
  const url = new URL("/apis/v2/sports/football/nfl/standings", ESPN_SITE_API);
  url.searchParams.set("level", "3");
  if (season != null) url.searchParams.set("season", String(season));
  const standings = normalizeNflStandings(await requestJson(url, fetchImpl, "standings"));
  if (!standings.size) throw new Error("NFL standings response had an unexpected shape.");
  return standings;
}
function nflSeasonsForWindow(startDate, endDate) {
  const seasonFor = (value) => {
    const year = Number(String(value ?? "").slice(0, 4));
    const month = Number(String(value ?? "").slice(5, 7));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !year) return null;
    return month >= 3 ? year : year - 1;
  };
  const first = seasonFor(startDate);
  const last = seasonFor(endDate);
  if (first == null || last == null) throw new Error("NFL schedule dates must be YYYY-MM-DD.");
  const seasons = [];
  for (let season = first; season <= Math.max(first, last); season += 1) seasons.push(season);
  return seasons;
}
function normalizeNflGame(event = {}, {
  timezone = "America/Los_Angeles",
  teamId = RAMS_TEAM_ID,
  retrievedAt = /* @__PURE__ */ new Date(),
  homeVenue = SOFI_STADIUM
} = {}) {
  const competition = event.competitions?.[0] ?? {};
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.find((competitor) => competitor?.homeAway === "home") ?? {};
  const away = competitors.find((competitor) => competitor?.homeAway === "away") ?? {};
  const homeTeam = normalizeNflTeam(home.team ?? (home.id != null ? { id: home.id } : {}));
  const awayTeam = normalizeNflTeam(away.team ?? (away.id != null ? { id: away.id } : {}));
  const eventId = String(event.id ?? competition.id ?? "");
  const rawDate = event.date ?? competition.date ?? null;
  const timeValid = (event.timeValid ?? competition.timeValid) !== false;
  const status = competition.status ?? event.status ?? {};
  const statusType = status.type ?? {};
  const flex = status.isTBDFlex === true;
  const timeTbd = !rawDate || !timeValid;
  const startLocal = localStart(rawDate, timeValid, timezone);
  const notes = (Array.isArray(competition.notes) ? competition.notes : []).map((note) => String(note?.headline ?? "").trim()).filter(Boolean);
  const flexDates = flex && timeTbd ? flexCandidateDates(notes, startLocal) : [];
  const startUtc = rawDate && timeValid && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate).toISOString() : null;
  const venue = normalizeVenue(competition.venue, homeVenue);
  const broadcasts = broadcastNames(competition);
  const seasonTypeNumber = Number(event.seasonType?.type ?? event.seasonType?.id);
  const seasonType = SEASON_TYPES[seasonTypeNumber] ?? null;
  const weekNumber = numberOrNull(event.week?.number);
  const weekLabel = String(event.week?.text ?? "").trim() || (weekNumber != null ? `Week ${weekNumber}` : null);
  const seasonYear = numberOrNull(event.season?.year);
  const sourceUrl = gameUrl(event, eventId);
  const title = `${awayTeam.name || "Away"} at ${homeTeam.name || "Home"}`;
  const detailedState = String(statusType.description ?? "").trim() || "Scheduled";
  const stateText = `${statusType.name ?? ""} ${detailedState}`;
  return {
    schemaVersion: 2,
    id: `nfl:${eventId}`,
    league: "nfl",
    source: "espn",
    sourceEventId: eventId,
    sourceUrl,
    retrievedAt: new Date(retrievedAt).toISOString(),
    title,
    type: "football",
    startLocal,
    startUtc,
    timeTbd,
    dateTbd: !startLocal,
    status: detailedState,
    scheduleStatus: {
      abstractState: String(statusType.state ?? "").trim() || null,
      detailedState,
      codedState: String(statusType.name ?? "").trim() || null,
      reason: null,
      changed: /postpon|delay|suspend|resched|cancel/i.test(stateText),
      delayed: /delay/i.test(stateText),
      postponed: /postpon|suspend/i.test(stateText),
      rescheduled: /resched/i.test(stateText),
      completed: statusType.completed === true,
      flex,
      dateTentative: flex && timeTbd,
      flexDates
    },
    venue,
    neutralSite: competition.neutralSite === true,
    homeTeam,
    awayTeam,
    season: {
      year: seasonYear,
      type: seasonType,
      week: weekNumber,
      weekLabel,
      // The round name for a playoff game ("NFC Wild Card Playoffs").
      headline: seasonType === "postseason" ? plainLabel(notes[0]) : null
    },
    // One NFL date is one matchup. A distinct id keeps each home date its own
    // card and its own overview representative.
    series: { id: `nfl:${seasonYear ?? "season"}:${eventId}`, gameNumber: null, gameCount: null },
    kickoff: kickoffWindow(startUtc, timeTbd, competition),
    broadcasts,
    // Present so MLB-shaped consumers can read the field without a league branch.
    probablePitchers: { home: null, away: null, confirmed: false },
    ticketObservations: [],
    sourceOccurrences: [{
      source: "espn",
      sourceEventId: eventId,
      sourceUrl,
      title,
      startLocal,
      venue: { name: venue.name, city: venue.city, state: venue.state },
      performerNames: [awayTeam.name, homeTeam.name].filter(Boolean)
    }]
  };
}
function normalizeNflTeam(team = {}) {
  const nickname = String(team.shortDisplayName ?? team.nickname ?? team.name ?? "").trim();
  const location = String(team.location ?? "").trim();
  return {
    id: team.id == null ? null : String(team.id),
    name: String(team.displayName ?? [location, nickname].filter(Boolean).join(" ")).trim(),
    shortName: nickname,
    abbreviation: String(team.abbreviation ?? "").trim(),
    league: null,
    division: null
  };
}
function normalizeNflStandings(body = {}) {
  const standings = /* @__PURE__ */ new Map();
  const visit = (group, conference) => {
    if (!group || typeof group !== "object") return;
    const isConference = group.isConference === true || /conference/i.test(String(group.name ?? ""));
    const nextConference = isConference ? groupRef(group) : conference;
    const entries = group.standings?.entries;
    if (Array.isArray(entries)) {
      const division = isConference ? null : groupRef(group);
      entries.forEach((entry, index) => {
        const team = normalizeNflTeam(entry?.team);
        if (!team.id) return;
        const stats = statLookup(entry.stats);
        const wins = stats.number("wins");
        const losses = stats.number("losses");
        const ties = stats.number("ties") ?? 0;
        const gamesPlayed = wins != null && losses != null ? wins + losses + ties : null;
        const seed = stats.number("playoffseed");
        standings.set(team.id, {
          team: { ...team, league: nextConference, division },
          league: nextConference,
          division,
          leagueRank: seed,
          playoffSeed: seed,
          // ESPN orders a division group by rank; a conference-only response
          // carries no division order, so the rank stays unknown.
          divisionRank: division ? index + 1 : null,
          wins,
          losses,
          ties,
          gamesPlayed,
          winPct: stats.number("winpercent") ?? (gamesPlayed ? (wins + ties / 2) / gamesPlayed : null),
          record: wins != null && losses != null ? `${wins}-${losses}${ties ? `-${ties}` : ""}` : stats.display("total"),
          lastTen: null,
          lastTenRecord: null,
          streak: stats.display("streak"),
          gamesBack: stats.number("gamesbehind"),
          wildCardGamesBack: null,
          playoffGamesBack: null,
          pointDifferential: stats.number("pointdifferential") ?? stats.number("differential"),
          pointsFor: stats.number("pointsfor"),
          pointsAgainst: stats.number("pointsagainst"),
          homeRecord: parseRecord(stats.display("home")),
          awayRecord: parseRecord(stats.display("road")),
          divisionRecord: parseRecord(stats.display("vsdiv")),
          conferenceRecord: parseRecord(stats.display("vsconf"))
        });
      });
    }
    for (const child of group.children ?? []) visit(child, nextConference);
  };
  visit(body, null);
  applyPlayoffGamesBack(standings);
  return standings;
}
function applyNflStandings(games, standings) {
  const withRecord = (team) => {
    const record = standings?.get?.(String(team?.id));
    return record ? { ...team, league: record.league, division: record.division, record: record.record } : team;
  };
  return (games ?? []).map((game) => ({
    ...game,
    homeTeam: withRecord(game.homeTeam),
    awayTeam: withRecord(game.awayTeam)
  }));
}
async function requestSchedule({ teamId, season, seasonType, fetchImpl }) {
  const url = new URL(`/apis/site/v2/sports/football/nfl/teams/${encodeURIComponent(String(teamId))}/schedule`, ESPN_SITE_API);
  url.searchParams.set("season", String(season));
  url.searchParams.set("seasontype", String(seasonType));
  const body = await requestJson(url, fetchImpl, "schedule");
  if (!Array.isArray(body?.events)) throw new Error("NFL schedule response had an unexpected shape.");
  return body;
}
var NFL_RETRY = { attempts: 2, delayMs: 800 };
async function requestJson(url, fetchImpl, context) {
  let lastError = null;
  for (let attempt = 1; attempt <= NFL_RETRY.attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: REQUEST_HEADERS });
      if (response.ok) return await response.json();
      lastError = new Error(`NFL ${context} request failed (${response.status}).`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < NFL_RETRY.attempts) await new Promise((resolve) => setTimeout(resolve, NFL_RETRY.delayMs));
  }
  throw lastError;
}
function isHomeGame(game, teamId, homeVenueNames) {
  if (String(game.homeTeam?.id ?? "") !== String(teamId)) return false;
  if (game.neutralSite) return false;
  if (!homeVenueNames?.length) return true;
  const venue = normalizeText(game.venue?.name);
  if (!venue) return true;
  return homeVenueNames.some((name) => venue.includes(normalizeText(name)));
}
function seasonIsUnderway(startDate) {
  const month = Number(String(startDate ?? "").slice(5, 7));
  return month >= 9 || month === 1;
}
function localStart(rawDate, timeValid, timezone) {
  if (!rawDate) return null;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return null;
  if (timeValid) return toLocalIso(date, timezone);
  const dateKey = toLocalIso(date, BROADCAST_ZONE)?.slice(0, 10);
  if (!dateKey) return null;
  const offset = toLocalIso(/* @__PURE__ */ new Date(`${dateKey}T20:00:00Z`), timezone)?.slice(19) ?? "";
  return `${dateKey}T00:00:00${offset}`;
}
function kickoffWindow(startUtc, timeTbd, competition) {
  if (timeTbd || !startUtc) return { code: "tbd", label: "Kickoff TBD", primetime: false };
  const eastern = toLocalIso(new Date(startUtc), BROADCAST_ZONE);
  const weekday = (/* @__PURE__ */ new Date(`${eastern.slice(0, 10)}T12:00:00Z`)).getUTCDay();
  const hour = Number(eastern.slice(11, 13));
  const night = hour >= 19;
  if (weekday === 4 && night) return { code: "TNF", label: "Thursday Night Football", primetime: true };
  if (weekday === 0 && night) return { code: "SNF", label: "Sunday Night Football", primetime: true };
  if (weekday === 1 && night) return { code: "MNF", label: "Monday Night Football", primetime: true };
  if (weekday === 0) {
    return hour >= 16 ? { code: "sunday-late", label: "Sunday late-afternoon kickoff", primetime: false } : { code: "sunday-early", label: "Sunday early kickoff", primetime: false };
  }
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday];
  if (hasNationalBroadcast(competition)) {
    return { code: "standalone", label: `${dayName}${night ? " night" : ""} national broadcast`, primetime: night };
  }
  return { code: "other", label: `${dayName} kickoff`, primetime: false };
}
function flexCandidateDates(notes, startLocal) {
  const anchor = String(startLocal ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return [];
  const anchorTime = Date.parse(`${anchor}T12:00:00Z`);
  const dates = /* @__PURE__ */ new Set();
  for (const note of notes) {
    if (!/flex/i.test(note)) continue;
    for (const match of note.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const candidate = [-1, 0, 1].map((offset) => Date.UTC(Number(anchor.slice(0, 4)) + offset, month - 1, day, 12)).sort((left, right) => Math.abs(left - anchorTime) - Math.abs(right - anchorTime))[0];
      if (Math.abs(candidate - anchorTime) <= 7 * 864e5) dates.add(new Date(candidate).toISOString().slice(0, 10));
    }
  }
  return [...dates].sort();
}
function plainLabel(value) {
  const label = String(value ?? "").replace(/[^A-Za-z0-9 .,:&'/-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return label || null;
}
function hasNationalBroadcast(competition = {}) {
  return (competition.broadcasts ?? []).some((broadcast) => /national/i.test(String(broadcast?.market?.type ?? broadcast?.market ?? "")));
}
function broadcastNames(competition = {}) {
  const names = [
    ...(competition.broadcasts ?? []).flatMap((broadcast) => [broadcast?.media?.shortName, ...Array.isArray(broadcast?.names) ? broadcast.names : []]),
    ...(competition.geoBroadcasts ?? []).map((broadcast) => broadcast?.media?.shortName),
    typeof competition.broadcast === "string" ? competition.broadcast : null
  ].map((name) => String(name ?? "").trim()).filter(Boolean);
  return [...new Set(names)];
}
function normalizeVenue(venue = {}, homeVenue = SOFI_STADIUM) {
  const name = String(venue?.fullName ?? venue?.name ?? "").trim();
  const isHomeVenue = Boolean(name && homeVenue?.name && normalizeText(name).includes(normalizeText(homeVenue.name)));
  return {
    sourceId: venue?.id == null ? null : String(venue.id),
    name,
    city: String(venue?.address?.city ?? (isHomeVenue ? homeVenue.city : "") ?? "").trim(),
    state: String(venue?.address?.state ?? (isHomeVenue ? homeVenue.state : "") ?? "").trim(),
    // ESPN's schedule carries no coordinates; the configured home venue does.
    lat: isHomeVenue ? numberOrNull(homeVenue.lat) : null,
    lon: isHomeVenue ? numberOrNull(homeVenue.lon) : null
  };
}
function gameUrl(event, eventId) {
  const link = (event.links ?? []).find((item) => (item?.rel ?? []).includes("summary") && (item?.rel ?? []).includes("desktop"));
  try {
    const url = new URL(String(link?.href ?? ""));
    if (url.protocol === "https:" && /(^|\.)espn\.com$/.test(url.hostname)) return url.toString();
  } catch {
  }
  return `${ESPN_GAME_ROOT}/${eventId}`;
}
function groupRef(group) {
  return { id: group.id == null ? null : String(group.id), name: String(group.name ?? "").trim() };
}
function statLookup(stats) {
  const byKey = /* @__PURE__ */ new Map();
  for (const stat of Array.isArray(stats) ? stats : []) {
    for (const key of [stat?.type, stat?.name]) {
      const normalized = String(key ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normalized && !byKey.has(normalized)) byKey.set(normalized, stat);
    }
  }
  return {
    number: (key) => {
      const stat = byKey.get(key);
      return stat && stat.value != null ? numberOrNull(stat.value) : null;
    },
    display: (key) => {
      const value = String(byKey.get(key)?.displayValue ?? byKey.get(key)?.summary ?? "").trim();
      return value || null;
    }
  };
}
function parseRecord(value) {
  const match = String(value ?? "").match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  const ties = Number(match[3] ?? 0);
  const games = wins + losses + ties;
  return { wins, losses, ties, winPct: games ? (wins + ties / 2) / games : null };
}
function applyPlayoffGamesBack(standings) {
  const conferences = /* @__PURE__ */ new Map();
  for (const record of standings.values()) {
    const key = record.league?.id ?? record.league?.name ?? "league";
    conferences.set(key, [...conferences.get(key) ?? [], record]);
  }
  for (const records of conferences.values()) {
    const cutoff = records.find((record) => record.playoffSeed === 7);
    if (!cutoff || cutoff.wins == null || cutoff.losses == null) continue;
    for (const record of records) {
      if (record.wins == null || record.losses == null || record.playoffSeed == null) continue;
      record.playoffGamesBack = record.playoffSeed <= 7 ? 0 : Math.max(0, (cutoff.wins - record.wins + (record.losses - cutoff.losses)) / 2);
    }
  }
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
function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ../src/sports.js
var LEAGUE_DEFAULTS = {
  nfl: {
    enabled: true,
    teamId: RAMS_TEAM_ID,
    teamName: "Los Angeles Rams",
    homeVenueNames: [SOFI_STADIUM.name],
    homeVenue: { lat: SOFI_STADIUM.lat, lon: SOFI_STADIUM.lon },
    seatGeekTaxonomy: "football",
    // Eight or nine regular-season home dates a year against MLB's 81: each
    // one starts from a higher floor, and a 70,000-seat building starts from
    // a higher hassle floor.
    baseInterest: 42,
    baseHassle: 3,
    rivalries: {
      "25": { tier: "high", label: "49ers rivalry", division: true },
      "26": { tier: "medium", label: "Seahawks rivalry", division: true },
      "22": { tier: "medium", label: "Cardinals rivalry", division: true }
    }
  }
};
var SHARED_CONFIG_KEYS = ["home", "searchRadiusMiles", "maxTicketPriceUsd", "maxTicketPages", "featuredInterestThreshold"];
function sportsLeagueOf(game = {}) {
  const league = String(game?.league ?? game?.sportsContext?.league ?? "").toLowerCase();
  if (league === "nfl" || String(game?.id ?? "").startsWith("nfl:")) return "nfl";
  return "mlb";
}
function sportsLeagueConfig(config = {}, league = "mlb") {
  const defaults = LEAGUE_DEFAULTS[league];
  if (!defaults) return config ?? {};
  if (config?.league === league) return config;
  const shared = Object.fromEntries(SHARED_CONFIG_KEYS.filter((key) => config?.[key] !== void 0).map((key) => [key, config[key]]));
  return { ...defaults, ...shared, ...config?.[league] ?? {}, league };
}
var SEATGEEK_EVENTS_URL = "https://api.seatgeek.com/2/events";
var TICKETMASTER_EVENTS_URL = "https://app.ticketmaster.com/discovery/v2/events.json";
async function fetchSeatGeekSportsEvents({
  clientId,
  startDate,
  endDate,
  config,
  league = null,
  maxPages = 3,
  fetchImpl = fetch
} = {}) {
  if (!clientId) throw new Error("SEATGEEK_CLIENT_ID is not configured.");
  config = sportsLeagueConfig(config, league ?? config?.league);
  const events = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(SEATGEEK_EVENTS_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("q", config.teamName ?? "Los Angeles Dodgers");
    url.searchParams.set("taxonomies.name", config.seatGeekTaxonomy ?? "baseball");
    url.searchParams.set("lat", String(config.home?.lat ?? 34.0522));
    url.searchParams.set("lon", String(config.home?.lon ?? -118.2437));
    url.searchParams.set("range", `${config.searchRadiusMiles ?? 60}mi`);
    url.searchParams.set("datetime_local.gte", startDate);
    url.searchParams.set("datetime_local.lte", `${endDate}T23:59:59`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "datetime_local.asc");
    const body = await requestJson2(url, fetchImpl, "SeatGeek sports");
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
  league = null,
  maxPages = 3,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY is not configured.");
  config = sportsLeagueConfig(config, league ?? config?.league);
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
    const body = await requestJson2(url, fetchImpl, "Ticketmaster sports");
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
    if (sportsLeagueOf(game) === "nfl") return enrichNflGame(game, standings, sportsLeagueConfig(config, "nfl"), now);
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
  if (sportsLeagueOf(game) === "nfl") return scoreNflGame(game, sportsLeagueConfig(config, "nfl"), now);
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
  if (sportsLeagueOf(game) === "nfl") return nflTicketMatchesGame(ticket, game);
  if (!ticket.startLocal || !game.startLocal || ticket.startLocal.slice(0, 10) !== game.startLocal.slice(0, 10)) return false;
  if (!venueMatches(ticket.venue, game.venue)) return false;
  const haystack = normalizeTeamText([ticket.title, ...ticket.teamNames ?? []].join(" "));
  if (!teamMatches(haystack, game.homeTeam)) return false;
  const opponentKnown = teamMatches(haystack, game.awayTeam);
  const anyOpponentMentioned = game.awayTeam?.name && normalizeTeamText(haystack).includes(normalizeTeamText(game.awayTeam.name).split(" ")[0]);
  return opponentKnown || !anyOpponentMentioned;
}
var NFL_ESTABLISHED_GAMES = 4;
var NFL_PRIMETIME_SCORES = { SNF: 8, MNF: 7, TNF: 6 };
var NON_GAME_LISTING = /\b(parking|tailgate|tailgating|shuttle|bus|tour|deposit|package|pass|passes|voucher|hospitality|experience)\b/;
function enrichNflGame(game, standings, config, now) {
  const opponent = standings?.get?.(String(game.awayTeam?.id)) ?? null;
  const home = standings?.get?.(String(game.homeTeam?.id)) ?? null;
  const configured = config.rivalries?.[String(game.awayTeam?.id)] ?? null;
  const homeDivision = home?.division ?? game.homeTeam?.division ?? null;
  const opponentDivision = opponent?.division ?? game.awayTeam?.division ?? null;
  const sameDivision = Boolean(homeDivision?.name && opponentDivision?.name && homeDivision.name === opponentDivision.name);
  const divisionGame = sameDivision || configured?.division === true;
  const rivalry = configured ?? (sameDivision ? { tier: "medium", label: null } : { tier: "none", label: null });
  const divisionName = sameDivision ? compactDivision(homeDivision.name) : null;
  const schedule = game.scheduleStatus ?? {
    detailedState: game.status ?? "Scheduled",
    changed: false,
    delayed: false,
    postponed: false,
    rescheduled: false
  };
  const kickoffWindow2 = game.kickoff ?? null;
  const weekLabel = game.season?.weekLabel ?? null;
  const opponentTags = nflOpponentTags(opponent);
  const sportsContext = {
    league: "nfl",
    opponentWinPct: opponent?.winPct ?? null,
    opponentRecord: opponent?.record ?? null,
    opponentGamesPlayed: opponent?.gamesPlayed ?? null,
    opponentLeagueRank: opponent?.leagueRank ?? null,
    opponentDivisionRank: opponent?.divisionRank ?? null,
    opponentLast10: null,
    opponentLastTenRecord: null,
    opponentStreak: opponent?.streak ?? null,
    opponentWildCardGamesBack: null,
    opponentPlayoffGamesBack: opponent?.playoffGamesBack ?? null,
    opponentRunDifferential: null,
    opponentPointDifferential: opponent?.pointDifferential ?? null,
    opponentHomeRecord: opponent?.homeRecord ?? null,
    opponentAwayRecord: opponent?.awayRecord ?? null,
    opponentAbove500Record: null,
    opponentLeagueName: opponent?.league?.name ?? null,
    opponentDivisionName: opponentDivision?.name ?? null,
    homeRecord: home?.record ?? null,
    homeLeagueRank: home?.leagueRank ?? null,
    homePlayoffGamesBack: home?.playoffGamesBack ?? null,
    rivalryTier: rivalry.tier ?? "none",
    divisionGame,
    divisionName,
    // No football analogue. The fields stay so MLB-shaped consumers can read
    // them without branching, and they never score.
    probablePitchers: { home: null, away: null, confirmed: false },
    pitcherMatchupTier: "unknown",
    seriesPosition: { label: weekLabel, gameNumber: null, gameCount: null },
    kickoffWindow: kickoffWindow2,
    broadcasts: game.broadcasts ?? [],
    seasonType: game.season?.type ?? null,
    week: game.season?.week ?? null,
    opponentTags,
    schedule,
    playoffLeverage: nflPlayoffLeverage(game, opponent, home, divisionGame),
    gameContext: {
      opponent: {
        tags: opponentTags,
        record: opponent?.record ?? null,
        leagueRank: opponent?.leagueRank ?? null,
        divisionRank: opponent?.divisionRank ?? null,
        pointDifferential: opponent?.pointDifferential ?? null,
        streak: opponent?.streak ?? null
      },
      kickoff: kickoffWindow2,
      schedule
    }
  };
  const tags = nflTags(game, rivalry, sportsContext);
  const ranking = scoreNflGame({ ...game, sportsContext, tags }, config, now);
  return { ...game, sportsContext, tags, ranking };
}
function scoreNflGame(game, config, now = /* @__PURE__ */ new Date()) {
  const context = game.sportsContext ?? {};
  const established = nflRecordEstablished(context.opponentGamesPlayed);
  const opponentQuality = established && Number.isFinite(context.opponentWinPct) ? Math.max(0, Math.min(20, Math.round((context.opponentWinPct - 0.3) * 40))) : 0;
  const opponentStakesScore = established ? nflOpponentStakesScore(context) : 0;
  const rivalryScore = { high: 15, medium: 8, low: 3, none: 0 }[context.rivalryTier] ?? 0;
  const primetimeScore = context.seasonType === "postseason" ? 0 : NFL_PRIMETIME_SCORES[context.kickoffWindow?.code] ?? (context.kickoffWindow?.primetime ? 5 : 0);
  const leverageScore = { high: 10, medium: 6, low: 2, unknown: 0 }[context.playoffLeverage] ?? 0;
  const convenienceScore = dateConvenience(game.startLocal);
  const hassle = nflHassle(game, config);
  const hassleScore = hassle.score;
  const baseInterest = Number.isFinite(config.baseInterest) ? config.baseInterest : LEAGUE_DEFAULTS.nfl.baseInterest;
  const interestScore = Math.min(100, baseInterest + opponentQuality + opponentStakesScore + rivalryScore + primetimeScore + leverageScore + convenienceScore);
  const urgency = sportsTicketUrgency(game.ticketObservations ?? [], game.startLocal, now);
  const confidence = established && Number.isFinite(context.opponentWinPct) && !game.timeTbd && !game.dateTbd && !context.schedule?.changed ? "high" : "medium";
  const whyYou = nflWhyYou(game, { opponentQuality, rivalryScore, primetimeScore, leverageScore, convenienceScore, hassleScore });
  return {
    excluded: false,
    league: "nfl",
    interestScore,
    utility: interestScore - hassleScore * 2,
    opponentQuality,
    opponentStakesScore,
    rivalryScore,
    pitchingScore: 0,
    primetimeScore,
    leverageScore,
    leagueRelevanceScore: 0,
    convenienceScore,
    hassleScore,
    hassleBreakdown: hassle,
    hassleReasons: hassle.reasons,
    urgency,
    confidence,
    whyYou
  };
}
function nflRecordEstablished(gamesPlayed) {
  return Number.isFinite(gamesPlayed) && gamesPlayed >= NFL_ESTABLISHED_GAMES;
}
function nflOpponentStakesScore(context = {}) {
  let score = 0;
  if (context.opponentDivisionRank === 1) score += 3;
  else if (Number.isFinite(context.opponentLeagueRank) && context.opponentLeagueRank <= 7) score += 2;
  if (Number.isFinite(context.opponentLeagueRank) && context.opponentLeagueRank <= 2) score += 2;
  if (Number.isFinite(context.opponentPointDifferential)) {
    if (context.opponentPointDifferential >= 75) score += 3;
    else if (context.opponentPointDifferential >= 40) score += 2;
    else if (context.opponentPointDifferential >= 15) score += 1;
  }
  if (/^W([4-9]|\d{2,})/i.test(String(context.opponentStreak ?? ""))) score += 1;
  return Math.min(10, score);
}
function nflOpponentTags(opponent) {
  if (!opponent || !nflRecordEstablished(opponent.gamesPlayed)) return [];
  const tags = [];
  if (opponent.record) tags.push(`${opponent.record} record`);
  const conference = String(opponent.league?.name ?? "").match(/\b(American|National)\b/i)?.[1];
  const conferenceLabel = conference ? `${conference[0].toUpperCase()}FC` : null;
  if (opponent.divisionRank === 1) tags.push(`${compactDivision(opponent.division?.name) || "Division"} leader`);
  else if (Number.isFinite(opponent.leagueRank) && opponent.leagueRank <= 7) tags.push(`${conferenceLabel ? `${conferenceLabel} ` : ""}No. ${opponent.leagueRank} seed today`);
  if (Number.isFinite(opponent.pointDifferential) && opponent.pointDifferential >= 40) tags.push(`+${Math.round(opponent.pointDifferential)} point differential`);
  else if (/^W([4-9]|\d{2,})/i.test(String(opponent.streak ?? ""))) tags.push(`Won ${String(opponent.streak).slice(1)} straight`);
  return tags.slice(0, 3);
}
function nflPlayoffLeverage(game, opponent, home, divisionGame) {
  if (game.season?.type === "postseason") return "high";
  const inRace = (team) => Boolean(team && nflRecordEstablished(team.gamesPlayed) && (Number.isFinite(team.playoffSeed) && team.playoffSeed <= 7 || Number.isFinite(team.playoffGamesBack) && team.playoffGamesBack <= 1.5));
  const known = [opponent, home].some((team) => team && nflRecordEstablished(team.gamesPlayed));
  if (!known) return "unknown";
  const week = Number(game.season?.week);
  const month = Number(String(game.startLocal ?? "").slice(5, 7));
  const late = Number.isFinite(week) && week > 0 ? week >= 14 : month === 12 || month === 1;
  const middle = Number.isFinite(week) && week > 0 ? week >= 10 : month === 11;
  const homeAlive = inRace(home);
  const opponentAlive = inRace(opponent);
  if (late && homeAlive && (opponentAlive || divisionGame)) return "high";
  if (late && (homeAlive || opponentAlive)) return "medium";
  if (middle && homeAlive && opponentAlive) return "medium";
  return "low";
}
function nflTags(game, rivalry, context) {
  const tags = [];
  if (context.schedule?.changed) tags.push("Schedule update");
  if (context.seasonType === "postseason") tags.push("Playoff game");
  if (rivalry.tier === "high" && rivalry.label) tags.push(rivalry.label);
  if (context.divisionGame) tags.push(context.divisionName ? `${context.divisionName} rival` : "Division rival");
  if (context.kickoffWindow?.primetime && context.kickoffWindow.label) tags.push(context.kickoffWindow.label);
  if (context.seasonType !== "postseason" && context.playoffLeverage === "high") tags.push("Late-season leverage");
  tags.push(...context.opponentTags ?? []);
  if (context.schedule?.dateTentative) tags.push("Date and kickoff TBD");
  else if (game.timeTbd || game.dateTbd) tags.push("Kickoff TBD");
  if (context.seriesPosition?.label) tags.push(context.seriesPosition.label);
  if (!context.schedule?.dateTentative && [0, 6].includes(localWeekdayIndex(game.startLocal))) tags.push("Weekend game");
  return [...new Set(tags)].slice(0, 7);
}
function nflHassle(game, config) {
  const venueName = String(game.venue?.name ?? "").trim();
  const logisticalReasons = [`${venueName || "Stadium"} logistics`];
  const commercialReasons = [];
  let logistical = Number.isFinite(config.baseHassle) ? config.baseHassle : LEAGUE_DEFAULTS.nfl.baseHassle;
  let commercial = 0;
  const weekday = localWeekdayIndex(game.startLocal);
  const hour = Number(String(game.startLocal ?? "").match(/T(\d{2}):/)?.[1]);
  if (game.timeTbd || game.dateTbd) {
    logistical += 2;
    logisticalReasons.push(game.scheduleStatus?.dateTentative ? "date and kickoff time are TBD" : "kickoff time is TBD");
  } else if (weekday >= 1 && weekday <= 5 && Number.isFinite(hour) && hour >= 15 && hour < 19) {
    logistical += 1;
    logisticalReasons.push("weeknight rush-hour kickoff");
  }
  if (config.homeVenueNames?.length && !config.homeVenueNames.some((name) => normalizeTeamText(venueName).includes(normalizeTeamText(name)))) {
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
function nflWhyYou(game, { opponentQuality, rivalryScore, primetimeScore, leverageScore, convenienceScore, hassleScore }) {
  const context = game.sportsContext ?? {};
  const tentative = context.schedule?.dateTentative === true;
  const day = tentative ? null : weekdayForLocalDate(game.startLocal);
  const friction = hassleScore <= 3 ? "" : hassleScore <= 5 ? "Manageable" : "Higher-hassle";
  const opponentName = game.awayTeam?.shortName || game.awayTeam?.name || "visiting team";
  const homeName = game.homeTeam?.shortName || game.homeTeam?.name || "home";
  const record = nflRecordEstablished(context.opponentGamesPlayed) && context.opponentRecord ? ` (${context.opponentRecord})` : "";
  const reasons = [];
  if (context.seasonType === "postseason") reasons.push("a home playoff game");
  if (rivalryScore >= 15) reasons.push(context.divisionGame ? "a marquee division rivalry" : "a marquee rivalry");
  else if (context.divisionGame) reasons.push(context.divisionName ? `an ${context.divisionName} division matchup` : "a division matchup");
  if (opponentQuality >= 15) reasons.push("a top-tier opponent");
  else if (opponentQuality >= 9) reasons.push("a winning opponent");
  if (primetimeScore > 0 && context.kickoffWindow?.label) {
    reasons.push(NFL_PRIMETIME_SCORES[context.kickoffWindow.code] ? `a prime-time ${context.kickoffWindow.label} window` : `a ${context.kickoffWindow.label}`);
  }
  if (context.seasonType !== "postseason" && leverageScore >= 10) reasons.push("late-season playoff leverage");
  if (!reasons.length && convenienceScore >= 8 && !tentative) reasons.push("a weekend kickoff");
  if (!reasons.length) reasons.push(`one of the few ${homeName} home dates this season`);
  const opening = [friction, day, "home game"].filter(Boolean).join(" ");
  const week = context.seriesPosition?.label;
  const flexDays = (context.schedule?.flexDates ?? []).map((date) => formatLocalDate(date, { weekday: "long", month: "long", day: "numeric" })).filter(Boolean);
  const tbdNote = tentative ? ` Date and kickoff time are not final under NFL flexible scheduling${flexDays.length >= 2 ? ` (${flexDays.join(" or ")})` : ""}.` : game.timeTbd || game.dateTbd ? " Kickoff time is still TBD." : "";
  const statusNote = context.schedule?.changed ? ` ${context.schedule.detailedState || "Schedule update"} \u2014 check the NFL schedule before leaving.` : "";
  return `${opening[0].toUpperCase()}${opening.slice(1)} against the ${opponentName}${record}: ${joinReasons(reasons)}.${week ? ` ${week}.` : ""}${tbdNote}${statusNote}`;
}
function nflTicketMatchesGame(ticket, game) {
  if (!ticket?.startLocal || !game?.startLocal) return false;
  const dates = /* @__PURE__ */ new Set([game.startLocal.slice(0, 10), ...game.scheduleStatus?.dateTentative ? game.scheduleStatus.flexDates ?? [] : []]);
  if (!dates.has(ticket.startLocal.slice(0, 10))) return false;
  if (!nflVenueMatches(ticket.venue, game.venue)) return false;
  const haystack = ` ${normalizeTeamText([ticket.title, ...ticket.teamNames ?? []].join(" "))} `;
  if (NON_GAME_LISTING.test(haystack)) return false;
  return teamNamedAsWords(haystack, game.homeTeam) && teamNamedAsWords(haystack, game.awayTeam);
}
function nflVenueMatches(left = {}, right = {}) {
  const leftName = normalizeTeamText(left.name);
  const rightName = normalizeTeamText(right.name);
  if (leftName && rightName) return leftName.includes(rightName) || rightName.includes(leftName);
  if (Number.isFinite(left.lat) && Number.isFinite(left.lon) && Number.isFinite(right.lat) && Number.isFinite(right.lon)) {
    return distanceMiles(left.lat, left.lon, right.lat, right.lon) <= 0.5;
  }
  return false;
}
function teamNamedAsWords(haystack, team = {}) {
  return [team.name, team.shortName].map(normalizeTeamText).filter((alias) => alias.length >= 4).some((alias) => haystack.includes(` ${alias} `));
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
    return distanceMiles(left.lat, left.lon, right.lat, right.lon) <= 3;
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
function distanceMiles(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function daysUntil(startLocal, now) {
  return localDateDifference(startLocal, now);
}
async function requestJson2(url, fetchImpl, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
  return response.json();
}
function numberOrNull2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ../src/eventTitle.js
var SEPARATOR = /\s+b[23]b\s+|\s+&\s+|\s+\+\s+|\s*,\s+|\s+vs\.?\s+/i;
var TRAILING_DECORATION = /\s+(?:nye|nyd|halloween|new\s+year'?s?\s+(?:eve|day)|(?:day|night)\s+\d+|live|dj\s+set|all\s+night\s+long|open\s+to\s+close|extended\s+set)$/i;
var PLACEHOLDER = /^(?:tba|tbd|tbc|special\s+guests?|friends|more|support|guests?)$/i;
var DESCRIPTOR = /\b(?:anniversary|years?|party|experience|festival|halloween|nye|opening|closing|weekend|day|night|showcase|tour|edition|vol\.?|presents?)\b|\d/i;
function parsePromoterTitle(rawTitle, { knownArtistNames: knownArtistNames2 = [], housePromoters = [] } = {}) {
  const known = knownArtistNames2 instanceof Set ? knownArtistNames2 : new Set([...knownArtistNames2].map(normalizeArtistName).filter(Boolean));
  const house = new Set(housePromoters.map(normalizeArtistName).filter(Boolean));
  const title = String(rawTitle ?? "").replace(/\s+/g, " ").trim();
  const notes = [...title.matchAll(/[([]([^)\]]*)[)\]]/g)].map((match) => match[1].trim()).filter(Boolean);
  const text3 = title.replace(/\s*[([][^)\]]*[)\]]/g, " ").replace(/\s+/g, " ").trim();
  const isKnown = (value) => known.has(normalizeArtistName(value));
  const anyKnown = (value) => splitNames(value, known).some(isKnown);
  let body = text3;
  let eventName = null;
  let presenters = [];
  const presents = text3.match(/^(.*?)\s*\bpresents?\b\s*:?\s*(.+)$/i);
  const colon = presents ? null : text3.match(/^([^:]+):\s*(.+)$/);
  if (presents) {
    const [, left, right] = presents;
    const leftNames = splitNames(left, known);
    const houseLed = !left.trim() || leftNames.some((name) => house.has(normalizeArtistName(name)));
    if (houseLed || anyKnown(right) && !anyKnown(left)) {
      presenters = leftNames;
      body = right;
    } else {
      body = left;
      eventName = right.trim() || null;
    }
  } else if (colon) {
    const [, prefix, rest] = colon;
    if (anyKnown(rest)) [body, eventName] = [rest, prefix.trim()];
    else if (anyKnown(prefix)) [body, eventName] = [prefix, rest.trim()];
    else if (DESCRIPTOR.test(rest) && (!DESCRIPTOR.test(prefix) || /\d|anniversary/i.test(rest))) [body, eventName] = [prefix, rest.trim()];
    else [body, eventName] = [rest, prefix.trim()];
  }
  if (/\b(?:passes|pass|ticket\s+bundle|bundle)\b/i.test(text3) && !anyKnown(body)) {
    return { performers: [], presenters: presenters.map((name) => name.trim()).filter(Boolean), eventName: text3, notes };
  }
  const names = [];
  const seen = /* @__PURE__ */ new Set();
  for (const part of splitNames(body, known)) {
    const name = stripDecorations(part, known);
    const key = normalizeArtistName(name);
    if (!key || PLACEHOLDER.test(name) || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return {
    performers: names.map((name, index) => ({ name, primary: index === 0, identityVerified: isKnown(name) })),
    presenters: presenters.map((name) => name.trim()).filter(Boolean),
    eventName,
    notes
  };
}
function splitNames(value, known) {
  const text3 = String(value ?? "").trim();
  if (!text3) return [];
  if (known.has(normalizeArtistName(text3))) return [text3];
  const parts = text3.split(SEPARATOR).map((part) => part.trim()).filter(Boolean);
  const merged = [];
  for (let index = 0; index < parts.length; index += 1) {
    const joined = index + 1 < parts.length ? `${parts[index]} & ${parts[index + 1]}` : null;
    if (joined && known.has(normalizeArtistName(joined))) {
      merged.push(joined);
      index += 1;
    } else {
      merged.push(parts[index]);
    }
  }
  return merged;
}
function stripDecorations(value, known) {
  let name = String(value ?? "").replace(/^['"“”‘’]+|['"“”‘’]+$/g, "").trim();
  while (!known.has(normalizeArtistName(name)) && TRAILING_DECORATION.test(name)) {
    name = name.replace(TRAILING_DECORATION, "").trim();
  }
  return name;
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
  if (!target.destination && incoming.destination) target.destination = incoming.destination;
  if (incoming.promoters?.length) target.promoters = [.../* @__PURE__ */ new Set([...target.promoters ?? [], ...incoming.promoters])];
  if (!target.eventName && incoming.eventName) target.eventName = incoming.eventName;
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
  const locations = await requestJson3(locationsUrl, fetchImpl);
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
  const body = await requestJson3(eventsUrl, fetchImpl);
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
      // The API gives the place as one string, "San Diego, CA".
      city: String(raw.venue?.location?.city ?? raw.venue?.city ?? (typeof raw.venue?.location === "string" ? raw.venue.location.split(",")[0] : "")).trim(),
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
async function requestJson3(url, fetchImpl) {
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
  const body = await requestJson4(url, fetchImpl, "schedule");
  const games = (body.dates ?? []).flatMap((date) => date.games ?? []);
  return games.filter((game) => isHomeGame2(game, teamId, homeVenueIds)).map((game) => normalizeMlbGame(game, { timezone, teamId }));
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
  const body = await requestJson4(url, fetchImpl, "standings");
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
        const body = await requestJson4(url, fetchImpl, `pitcher stats ${id}`);
        const person = body.people?.[0];
        const split = person?.stats?.flatMap((item) => item.splits ?? [])?.[0];
        const stat = split?.stat;
        if (person && stat) result.set(id, {
          id,
          name: person.fullName ?? null,
          era: numberOrNull3(stat.era),
          whip: numberOrNull3(stat.whip),
          strikeoutsPer9: numberOrNull3(stat.strikeoutsPer9Inn),
          strikeouts: numberOrNull3(stat.strikeOuts ?? stat.strikeouts),
          inningsPitched: numberOrNull3(String(stat.inningsPitched ?? "").replace(/[^0-9.]/g, "")),
          wins: numberOrNull3(stat.wins),
          losses: numberOrNull3(stat.losses),
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
    startLocal: game.gameDate ? toLocalIso2(game.gameDate, timezone) : null,
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
      lat: numberOrNull3(venue.location?.latitude ?? venue.geoLocation?.latitude),
      lon: numberOrNull3(venue.location?.longitude ?? venue.geoLocation?.longitude)
    },
    homeTeam,
    awayTeam,
    series: {
      id: seriesId,
      gameNumber: numberOrNull3(game.seriesStatus?.gameNumber ?? game.seriesGameNumber ?? game.gameNumber),
      gameCount: numberOrNull3(game.seriesStatus?.totalGames ?? game.gamesInSeries)
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
      startLocal: game.gameDate ? toLocalIso2(game.gameDate, timezone) : null,
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
        leagueRank: numberOrNull3(teamRecord.leagueRank),
        divisionRank: numberOrNull3(teamRecord.divisionRank),
        wins: numberOrNull3(teamRecord.wins ?? teamRecord.leagueRecord?.wins),
        losses: numberOrNull3(teamRecord.losses ?? teamRecord.leagueRecord?.losses),
        winPct: numberOrNull3(teamRecord.winningPercentage ?? teamRecord.leagueRecord?.pct),
        lastTen: lastTen ? `${lastTen.wins}-${lastTen.losses}` : null,
        lastTenRecord: lastTen,
        streak: teamRecord.streak?.streakCode ?? null,
        gamesBack: numberOrNull3(teamRecord.gamesBack),
        wildCardGamesBack: numberOrNull3(teamRecord.wildCardGamesBack),
        runDifferential: numberOrNull3(teamRecord.runDifferential),
        runsScored: numberOrNull3(teamRecord.runsScored),
        runsAllowed: numberOrNull3(teamRecord.runsAllowed),
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
function isHomeGame2(game, teamId, homeVenueIds) {
  if (String(game.teams?.home?.team?.id ?? "") !== String(teamId)) return false;
  if (!homeVenueIds?.length) return true;
  return homeVenueIds.map(String).includes(String(game.venue?.id ?? game.teams?.home?.team?.venue?.id ?? ""));
}
function toLocalIso2(value, timezone) {
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
async function requestJson4(url, fetchImpl, context) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`MLB ${context} request failed (${response.status}).`);
  return response.json();
}
function numberOrNull3(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function splitRecord(splits, type) {
  const split = splits.find((item) => String(item?.type ?? "").toLowerCase() === type.toLowerCase());
  if (!split) return null;
  const wins = numberOrNull3(split.wins);
  const losses = numberOrNull3(split.losses);
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
      lat: numberOrNull4(venue.location?.lat),
      lon: numberOrNull4(venue.location?.lon)
    },
    performers,
    ticketObservation: {
      listingCount: numberOrNull4(event.stats?.listing_count),
      lowestPriceUsd: numberOrNull4(event.stats?.lowest_price),
      averagePriceUsd: numberOrNull4(event.stats?.average_price),
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
function numberOrNull4(value) {
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
async function fetchSeatGeekEventsByQuery({
  clientId,
  query,
  startDate,
  endDate,
  home = null,
  rangeMiles = null,
  perPage = 50,
  fetchImpl = fetch
} = {}) {
  if (!clientId) throw new Error("Set SEATGEEK_CLIENT_ID before searching events by name.");
  if (!String(query ?? "").trim()) throw new Error("SeatGeek name search needs a query.");
  const url = new URL(EVENTS_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("q", String(query).trim());
  if (home && Number.isFinite(home.lat) && Number.isFinite(home.lon) && Number.isFinite(rangeMiles)) {
    url.searchParams.set("lat", String(home.lat));
    url.searchParams.set("lon", String(home.lon));
    url.searchParams.set("range", `${Math.ceil(rangeMiles)}mi`);
  }
  if (startDate) url.searchParams.set("datetime_local.gte", startDate);
  if (endDate) url.searchParams.set("datetime_local.lte", `${endDate}T23:59:59`);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("sort", "datetime_local.asc");
  const body = await seatGeekJson(url, fetchImpl, `name search for ${query}`);
  return Array.isArray(body.events) ? body.events : [];
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
var PERMITTED_EVIDENCE_PROVIDERS = ["ticketmaster", "framework", "insomniac"];
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
function ageRestrictionFromText(text3) {
  const value = String(text3 ?? "");
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
    const text3 = String(value ?? "").trim();
    if (!text3) continue;
    const normalized = text3.toLowerCase();
    if (PLACEHOLDER_CLASSIFICATIONS.has(normalized)) continue;
    if (promoter && normalized === promoter) continue;
    if (!output.some((existing) => existing.toLowerCase() === normalized)) output.push(text3);
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
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== "").map(([key, item]) => [key, typeof item === "string" ? cleanText2(item, 500) : item]));
  }
  if (typeof value === "string") return cleanText2(value, field === "description" ? 280 : 300);
  return value;
}
function cleanText2(value, maxLength) {
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
    const body = await requestJson5(url, fetchImpl);
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
  const title = cleanText3(event.name);
  const startLocal = localDate3 ? `${localDate3}T${localTime2 || "00:00:00"}` : null;
  const startUtc = event.dates?.start?.dateTime ?? null;
  const doorsUtc = event.dates?.start?.doorsDateTime ?? null;
  const endUtc = event.dates?.end?.dateTime ?? null;
  const doorsLocal = event.dates?.start?.doorsLocalDate && event.dates?.start?.doorsLocalTime ? `${event.dates.start.doorsLocalDate}T${event.dates.start.doorsLocalTime}` : null;
  const endLocal = event.dates?.end?.localDate ? `${event.dates.end.localDate}T${event.dates.end.localTime || "00:00:00"}` : null;
  const classifications = ticketmasterClassifications(event);
  const namedLineup = attractions.map((attraction) => cleanText3(attraction.name)).filter(Boolean);
  const description = [event.info, event.pleaseNote].map(cleanText3).filter(Boolean).join(" ");
  const venueInfo = {
    name: cleanText3(venue.name),
    city: cleanText3(venue.city?.name),
    state: cleanText3(venue.state?.stateCode ?? venue.state?.name),
    accessibility: cleanText3(venue.accessibility?.info ?? venue.accessibility?.ticketLimit)
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
      name: cleanText3(venue.name),
      city: cleanText3(venue.city?.name),
      state: cleanText3(venue.state?.stateCode ?? venue.state?.name),
      lat: numberOrNull5(venue.location?.latitude),
      lon: numberOrNull5(venue.location?.longitude)
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
      name: cleanText3(venue.name),
      city: cleanText3(venue.city?.name),
      state: cleanText3(venue.state?.stateCode ?? venue.state?.name),
      lat: numberOrNull5(venue.location?.latitude),
      lon: numberOrNull5(venue.location?.longitude)
    },
    performers: attractions.map((attraction, index) => ({
      sourceId: attraction.id ? String(attraction.id) : null,
      name: cleanText3(attraction.name),
      primary: index === 0,
      spotifyId: null
    })).filter((performer) => performer.name),
    ticketObservation: {
      listingCount: null,
      lowestPriceUsd: numberOrNull5(event.priceRanges?.[0]?.min),
      averagePriceUsd: null,
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}
function ticketmasterClassifications(event) {
  const values = [];
  for (const classification of event.classifications ?? []) {
    for (const [parent, child] of [["segment", null], ["genre", "subGenre"], ["type", "subType"]]) {
      const value = cleanText3(classification?.[parent]?.name);
      const eventStyle = /^event style$/i.test(value);
      if (parent !== "type" || eventStyle) {
        if (value) values.push(value);
      }
      if (child && eventStyle) {
        const detail = cleanText3(classification?.[child]?.name);
        if (detail) values.push(detail);
      }
    }
  }
  return meaningfulClassifications(values, { provider: "ticketmaster" });
}
function cleanText3(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, 1200);
}
async function requestJson5(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Ticketmaster request failed (${response.status}).`);
  return response.json();
}
function numberOrNull5(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
async function fetchTicketmasterEventsByKeyword({
  apiKey,
  keyword,
  startDate,
  endDate,
  home = null,
  radiusMiles = null,
  countryCode = "US",
  size = 50,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error("TICKETMASTER_API_KEY is not configured.");
  if (!String(keyword ?? "").trim()) throw new Error("Ticketmaster keyword search needs a keyword.");
  const url = new URL(API_URL);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("keyword", String(keyword).trim());
  if (countryCode) url.searchParams.set("countryCode", countryCode);
  if (home && Number.isFinite(home.lat) && Number.isFinite(home.lon) && Number.isFinite(radiusMiles)) {
    url.searchParams.set("latlong", `${home.lat},${home.lon}`);
    url.searchParams.set("radius", String(Math.ceil(radiusMiles)));
    url.searchParams.set("unit", "miles");
  }
  if (startDate) url.searchParams.set("startDateTime", `${startDate}T00:00:00Z`);
  if (endDate) url.searchParams.set("endDateTime", `${endDate}T23:59:59Z`);
  url.searchParams.set("includeTBA", "yes");
  url.searchParams.set("includeTBD", "yes");
  url.searchParams.set("size", String(size));
  url.searchParams.set("sort", "date,asc");
  const body = await requestJson5(url, fetchImpl);
  return body._embedded?.events ?? [];
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
function normalizeFrameworkEvent(event, retrievedAt = /* @__PURE__ */ new Date(), { knownArtistNames: knownArtistNames2 = [] } = {}) {
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
  const billing = frameworkBilling(event, title, knownArtistNames2);
  const performers = billing.performers;
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
      lat: numberOrNull6(venue.geo_lat),
      lon: numberOrNull6(venue.geo_lng)
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
    // Framework's own calendar: Framework promotes this night. Co-presenters
    // and the night's name are kept apart from the performers.
    promoters: [.../* @__PURE__ */ new Set(["Framework", ...billing.presenters.filter((name) => !/^framework$/i.test(name))])],
    eventName: billing.eventName,
    venue: {
      sourceId: venue.id ? String(venue.id) : null,
      name: decodeText(venue.venue),
      city: decodeText(venue.city),
      state: decodeText(venue.stateprovince ?? ""),
      lat: numberOrNull6(venue.geo_lat),
      lon: numberOrNull6(venue.geo_lng)
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
function frameworkBilling(event, title, knownArtistNames2 = []) {
  const parsed = parsePromoterTitle(title, { knownArtistNames: knownArtistNames2, housePromoters: ["Framework"] });
  const raw = event.performers ?? event.artists ?? event.artistNames ?? event.lineup;
  const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const explicit = values.map((item, index) => {
    const name = decodeText(typeof item === "object" ? item.name ?? item.title : item);
    return { sourceId: typeof item === "object" && item.id ? String(item.id) : null, name, primary: index === 0, spotifyId: null };
  }).filter((performer) => performer.name);
  return {
    performers: explicit.length ? explicit : frameworkPerformers(title, { knownArtistNames: knownArtistNames2 }),
    presenters: parsed.presenters,
    eventName: parsed.eventName
  };
}
function hasExplicitFrameworkPerformers(event) {
  const raw = event.performers ?? event.artists ?? event.artistNames ?? event.lineup;
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.some((item) => decodeText(typeof item === "object" ? item.name ?? item.title : item));
  return Boolean(decodeText(raw));
}
function frameworkPerformers(title, { knownArtistNames: knownArtistNames2 = [] } = {}) {
  return parsePromoterTitle(decodeText(title), { knownArtistNames: knownArtistNames2, housePromoters: ["Framework"] }).performers.map((performer) => ({ sourceId: null, name: performer.name, primary: performer.primary, spotifyId: null }));
}
function normalizeLocalDate(value) {
  const text3 = String(value ?? "").trim();
  return text3 ? text3.replace(" ", "T") : null;
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
  const text3 = String(value ?? "").trim();
  if (!text3) return null;
  try {
    const url = new URL(text3, ARTISTS_URL);
    if (url.origin !== "https://thisisframework.com") return null;
    const match = url.pathname.match(/^\/artist\/([^/]+)\/?$/i);
    return match ? `https://thisisframework.com/artist/${match[1]}/` : null;
  } catch {
    return null;
  }
}
function numberOrNull6(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ../src/insomniac.js
var SITE_ORIGIN = "https://www.insomniac.com";
var EVENTS_URL2 = `${SITE_ORIGIN}/events/los-angeles-ca/`;
var USER_AGENT = "Taste Engine private personal event importer/0.1";
var INSOMNIAC_ADAPTER_VERIFIED = true;
var INSOMNIAC_DEFAULT_LOCATIONS = ["los-angeles-ca"];
var HOUSE_PROMOTERS = ["Insomniac", "Factory 93", "Bassrush", "Basscon", "Dreamstate", "Day Trip", "Mutate", "Fixture", "HARD", "Lost In Dreams"];
var InsomniacSourceError = class extends Error {
  constructor(message, failure) {
    super(message);
    this.name = "InsomniacSourceError";
    this.failure = failure;
  }
};
async function fetchInsomniacEvents({
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
  const pageUrls = pageUrl ? [pageUrl] : locationSlugs.map((slug) => `${SITE_ORIGIN}/events/${String(slug).replace(/[^a-z0-9-]/gi, "")}/`);
  const events = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [index, url] of pageUrls.entries()) {
    let listing;
    try {
      listing = parseInsomniacListing(await requestPage(url, fetchImpl, "listing"), { pageUrl: url });
      if (!listing.events.length) {
        throw new InsomniacSourceError(`Insomniac listing shape was not recognized at ${url}: 0 event cards and 0 JSON-LD events.`, "parser-failed");
      }
    } catch (error) {
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
  const inWindow = events.filter((event) => inDateWindow(event.startDate, startDate, endDate)).sort((left, right) => String(left.startDate).localeCompare(String(right.startDate)));
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
      const detail = parseInsomniacEventPage(await requestPage(event.url, fetchImpl, "event page"), { pageUrl: event.url });
      if (!detail) throw new InsomniacSourceError(`Insomniac event page ${event.url} carried no schema.org Event block.`, "parser-failed");
      const merged = mergeListingWithDetail(event, detail);
      if (!merged) throw new InsomniacSourceError(`Insomniac event page ${event.url} did not match its listing card (title or date differs).`, "parser-failed");
      if (detail.clockConflict) report.warnings.push(`Insomniac event page ${event.url} publishes two different start times; the visible local time was kept.`);
      inWindow[index] = merged;
      report.detailPagesFetched += 1;
    } catch (error) {
      report.detailPagesFailed += 1;
      report.warnings.push(error.message);
      if (error.failure === "blocked") challenged = true;
    }
  }
  if (skipped) report.warnings.push(`${skipped} Insomniac event pages were not fetched (${challenged ? "access challenge" : `limit of ${maxDetailPages}`}); those events keep listing-level facts only.`);
  return inWindow;
}
function parseInsomniacEvents(html, { pageUrl = EVENTS_URL2 } = {}) {
  const listing = parseInsomniacListing(html, { pageUrl });
  if (listing.cardCount) return listing.events;
  const detail = parseInsomniacEventPage(html, { pageUrl });
  if (detail) return [detail];
  return listing.events;
}
function parseInsomniacListing(html, { pageUrl = EVENTS_URL2 } = {}) {
  const source = String(html ?? "");
  const events = [];
  const warnings = [];
  const byKey = /* @__PURE__ */ new Map();
  const starts = [...source.matchAll(/<div class="card( card--feature)?">/g)];
  const boundary = firstIndexAfter(source, ["post-load-more-button-container", "</main>"], starts[0]?.index ?? 0);
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
    if (existing) {
      if (!featured) existing.featured = false;
      return;
    }
    byKey.set(key, card);
  });
  for (const card of byKey.values()) if (!card.featured) events.push(card);
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
function parseInsomniacEventPage(html, { pageUrl = EVENTS_URL2 } = {}) {
  const source = String(html ?? "");
  const item = jsonLdEvents(source)[0];
  if (!item) return null;
  const event = coerceJsonLdEvent(item, attribute(source.match(/<link rel="canonical"[^>]*>/i)?.[0], "href") || pageUrl);
  if (!event) return null;
  const time = source.match(/<h6>\s*Time\s*<\/h6>\s*<p>\s*<b>([^<]*)<\/b>\s*<\/p>(?:\s*<p>([^<]*)<\/p>)?/i);
  const visible = time ? visibleClock(parseDateText(time[1]).start, time[2]) : null;
  const published = wallClock(event.startDate);
  if (visible?.start) {
    event.clockConflict = Boolean(hasClock(published) && published.slice(0, 16) !== visible.start.slice(0, 16));
    event.startDate = visible.start;
    if (visible.end) event.endDate = visible.end;
    event.clockSource = "page-time";
  } else {
    event.clockConflict = false;
    event.clockSource = hasClock(published) ? "json-ld" : null;
  }
  const genreBlock = source.match(/<div class="genre">([\s\S]*?)<\/div>/i)?.[1] ?? "";
  event.genres = [...genreBlock.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((match) => text(match[1])).filter(Boolean);
  event.ageRestriction = text(source.match(/<h6>\s*Age\s*<\/h6>\s*<p>\s*<b>([^<]*)<\/b>/i)?.[1]) || null;
  event.subtitle = text(source.match(/<div class="page-header__meta">\s*<span>([\s\S]*?)<\/span>/i)?.[1]) || null;
  const breadcrumb = source.match(/<div class="breadcrumb">([\s\S]*?)<\/div>/i)?.[1] ?? "";
  event.category = [...breadcrumb.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => text(match[1])).filter((value) => value && !/^events$/i.test(value)).at(-1) ?? null;
  event.detailFetched = true;
  return event;
}
function normalizeInsomniacEvent(event, retrievedAt = /* @__PURE__ */ new Date(), { knownArtistNames: knownArtistNames2 = [] } = {}) {
  const title = text(event.title ?? event.name ?? "");
  const sourceUrl = String(event.sourceUrl ?? event.url ?? event.link ?? EVENTS_URL2).trim();
  const startLocal = wallClock(event.startLocal ?? event.startDate ?? event.start_date ?? event.date);
  const publishedEnd = publishedClock(event.endLocal ?? event.endDate ?? event.end_date);
  const endLocal = publishedEnd && (!startLocal || publishedEnd > startLocal) ? publishedEnd : null;
  const doorsLocal = publishedClock(event.doorsLocal ?? event.doorTime);
  const sourceEventId = String(event.sourceEventId ?? event.id ?? slugFromUrl(sourceUrl) ?? stableId(`${title}|${startLocal}|${sourceUrl}`));
  const retrieved = new Date(retrievedAt).toISOString();
  const place = event.location ?? event.venue ?? {};
  const address = place.address && typeof place.address === "object" ? place.address : {};
  const venue = {
    sourceId: null,
    name: text(place.name ?? event.venueName),
    city: tidyPlace(address.addressLocality ?? place.city ?? event.city),
    state: tidyPlace(address.addressRegion ?? place.state ?? event.state),
    lat: numberOrNull7(place.geo?.latitude ?? place.lat),
    lon: numberOrNull7(place.geo?.longitude ?? place.lon)
  };
  const category = text(event.category ?? "");
  const festival = /^festivals?$/i.test(category) || /\bfestival\b/i.test(title);
  const billing = insomniacBilling(event, title, { knownArtistNames: knownArtistNames2, festival });
  const performers = billing.performers;
  const classifications = meaningfulClassifications((Array.isArray(event.genres) ? event.genres : []).map(text), { provider: "insomniac" });
  const publishedStart = hasClock(startLocal) ? startLocal : null;
  const fact = (value, field, extra = {}) => insomniacFact(value, field, sourceEventId, sourceUrl, retrieved, extra);
  const eventEvidence = createEventEvidence({
    eventRef: `insomniac:${sourceEventId}`,
    provider: "insomniac",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    facts: {
      title: fact(title, "title"),
      description: fact(text(event.description ?? ""), "description", { assertionKind: "descriptive-copy" }),
      classification: fact(classifications, "classification"),
      // Only a lineup the promoter published counts as a named lineup; names
      // read out of a marketing title do not.
      namedLineup: billing.explicit ? fact(performers.map((performer) => performer.name), "namedLineup") : null,
      format: fact(category || null, "format"),
      doorTime: fact(doorsLocal, "doorTime"),
      startTime: fact(publishedStart, "startTime"),
      endTime: fact(endLocal, "endTime"),
      venueInfo: fact({ name: venue.name, city: venue.city, state: venue.state, address: text(address.streetAddress ?? "").replace(/[\s,]+$/, "") }, "venueInfo"),
      agePolicy: fact(event.ageRestriction ?? event.agePolicy ?? null, "agePolicy")
    }
  });
  const sourceOccurrence = {
    source: "insomniac",
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
    source: "insomniac",
    sourceEventId,
    sourceUrl,
    sourceOccurrences: [sourceOccurrence],
    eventEvidence,
    retrievedAt: retrieved,
    title,
    type: festival ? "music_festival" : "concert",
    startLocal,
    // The site labels local wall-clock times as UTC, so no UTC instant is
    // asserted from it.
    startUtc: null,
    doorsLocal,
    endLocal,
    timeTbd: !hasClock(startLocal),
    dateTbd: !startLocal,
    status: event.soldOut ? "sold out" : "scheduled",
    promoters: [.../* @__PURE__ */ new Set(["Insomniac", ...billing.presenters.filter((name) => !/^insomniac$/i.test(name))])],
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
function isInsomniacChallenge({ status = 200, headers = null, html = "" } = {}) {
  if (/challenge/i.test(String(headers?.get?.("cf-mitigated") ?? ""))) return true;
  const body = String(html ?? "");
  if (/<title>\s*(?:Just a moment|Attention Required)/i.test(body)) return true;
  if (/window\._cf_chl_opt|\/cdn-cgi\/challenge-platform\/h\/[a-z]\/orchestrate\//i.test(body)) return true;
  return [403, 429, 503].includes(status) && /cf-chl|challenges\.cloudflare\.com|captcha/i.test(body);
}
async function requestPage(url, fetchImpl, label) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
  } catch (error) {
    throw new InsomniacSourceError(`Insomniac ${label} request failed for ${url}: ${error.message}`, "unavailable");
  }
  const html = await response.text().catch(() => "");
  if (isInsomniacChallenge({ status: response.status, headers: response.headers, html })) {
    throw new InsomniacSourceError(`Insomniac ${label} ${url} returned an access challenge (HTTP ${response.status}); it was not retried or bypassed.`, "blocked");
  }
  if (!response.ok) throw new InsomniacSourceError(`Insomniac ${label} ${url} failed (HTTP ${response.status}).`, "unavailable");
  return html;
}
function parseListingCard(block, { pageUrl, featured }) {
  const name = text(block.match(/<h3 class="card__title">([\s\S]*?)<\/h3>/)?.[1]);
  const anchors = [...block.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
  const link = anchors.find((anchor) => /detail page via title/i.test(attribute(anchor, "aria-label"))) ?? anchors.find((anchor) => /detail page/i.test(attribute(anchor, "aria-label")));
  const url = absoluteUrl(attribute(link, "href"), pageUrl);
  const details = [...block.matchAll(/<div class="card__detail">([\s\S]*?)<\/div>/g)].map((match) => text(match[1]));
  const dates = parseDateText(details[0]);
  if (!name || !url || !dates.start) return null;
  const [city, state] = String(details[1] ?? "").split(/,\s*/);
  const categoryBlock = block.match(/<div class="card__category[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const endEpoch = Number(block.match(/\bevent_end_time="(\d+)"/)?.[1]);
  const alert = text(block.match(/<div class="card__alert[^"]*">([\s\S]*?)<\/div>/)?.[1]);
  return {
    "@type": "Event",
    id: isInsomniacEventUrl(url) ? slugFromUrl(url) : stableId(`${name}|${dates.start}|${url}`),
    name,
    url,
    startDate: dates.start,
    // The card's `event_end_time` is the published end as epoch seconds of the
    // local wall clock (the same convention as the event page's JSON-LD).
    endDate: Number.isFinite(endEpoch) && endEpoch > 0 ? new Date(endEpoch * 1e3).toISOString().slice(0, 19) : dates.end,
    location: { name: "", address: { addressLocality: tidyPlace(city), addressRegion: tidyPlace(state) } },
    performer: [],
    genres: [],
    category: text(categoryBlock.replace(/<span[\s\S]*?<\/span>/g, " ")) || null,
    ageRestriction: text(categoryBlock.match(/<span[^>]*>([\s\S]*?)<\/span>/)?.[1]) || null,
    subtitle: text(block.match(/<div class="card__subtitle">([\s\S]*?)<\/div>/)?.[1]) || null,
    soldOut: /^sold out$/i.test(alert),
    featured,
    listingOnly: true,
    listingUrl: pageUrl
  };
}
function mergeListingWithDetail(card, detail) {
  if (comparable(card.name) !== comparable(detail.name)) return null;
  if (String(wallClock(detail.startDate) ?? "").slice(0, 10) !== String(card.startDate).slice(0, 10)) return null;
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
  const name = text(item.name ?? item.title ?? "");
  const startDate = wallClock(item.startDate ?? item.start_date);
  if (!name || !startDate) return null;
  const place = Array.isArray(item.location) ? item.location[0] ?? {} : item.location ?? {};
  const address = place.address && typeof place.address === "object" ? place.address : {};
  const url = absoluteUrl(item.url ?? item.offers?.url ?? pageUrl, pageUrl);
  const performers = (Array.isArray(item.performer) ? item.performer : item.performer ? [item.performer] : []).map((performer) => typeof performer === "string" ? { name: text(performer) } : { name: text(performer?.name), ...performer?.sameAs ? { sameAs: String(performer.sameAs) } : {} }).filter((performer) => performer.name);
  return {
    "@type": "Event",
    id: isInsomniacEventUrl(url) ? slugFromUrl(url) : stableId(`${name}|${startDate}|${url}`),
    name,
    url,
    startDate,
    endDate: wallClock(item.endDate ?? item.end_date),
    location: {
      name: text(place.name ?? ""),
      address: {
        streetAddress: text(address.streetAddress ?? "").replace(/[\s,]+$/, ""),
        addressLocality: tidyPlace(address.addressLocality),
        addressRegion: tidyPlace(address.addressRegion),
        postalCode: text(address.postalCode ?? "")
      },
      ...place.geo ? { geo: place.geo } : {}
    },
    performer: performers,
    description: text(item.description ?? ""),
    genres: [],
    listingOnly: false
  };
}
function jsonLdEvents(html) {
  const events = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const item of flattenJsonLd(JSON.parse(match[1].trim()))) {
        const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
        if (types.some((type) => /event$/i.test(String(type ?? "")))) events.push(item);
      }
    } catch {
    }
  }
  return events;
}
function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === "object" && Array.isArray(value["@graph"])) return value["@graph"].flatMap(flattenJsonLd);
  return value && typeof value === "object" ? [value] : [];
}
function insomniacBilling(event, title, { knownArtistNames: knownArtistNames2, festival }) {
  const raw = event.performers ?? event.performer ?? event.artists ?? event.lineup;
  const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const seen = /* @__PURE__ */ new Set();
  const explicit = values.map((item) => text(typeof item === "object" ? item?.name : item)).filter((name) => name && !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase())).map((name, index) => ({ sourceId: null, name, primary: index === 0, spotifyId: null }));
  const known = [...knownArtistNames2 instanceof Set ? knownArtistNames2 : knownArtistNames2 ?? [], ...explicit.map((performer) => performer.name)];
  const parsed = parsePromoterTitle(title, { knownArtistNames: known, housePromoters: HOUSE_PROMOTERS });
  const presenters = [...parsed.presenters];
  let eventName = parsed.eventName;
  for (const part of String(event.subtitle ?? "").split(/\s+[·|]\s+/).map((value) => value.trim()).filter(Boolean)) {
    const presentedBy = part.match(/^presented by\s+(.+)$/i);
    const presents = part.match(/^presents:?\s+(.+)$/i);
    if (presentedBy) presenters.push(presentedBy[1].trim());
    else if (!eventName) eventName = presents ? presents[1].trim() : part;
  }
  let performers = explicit;
  if (!performers.length) {
    performers = festival ? [] : parsed.performers.map((performer) => ({ sourceId: null, name: performer.name, primary: performer.primary, spotifyId: null }));
    if (festival && !eventName) eventName = title;
  }
  return { performers, explicit: explicit.length > 0, presenters: [...new Set(presenters)], eventName: eventName || null };
}
function insomniacFact(value, field, sourceEventId, sourceUrl, retrieved, extra = {}) {
  return createEvidenceFact({
    value,
    field,
    provider: "insomniac",
    sourceEventId,
    sourceUrl,
    retrievedAt: retrieved,
    // Display and internal use only. Model eligibility is a separate decision.
    permission: { internalUse: true, display: true, modelInput: false, persist: true },
    ...extra
  });
}
var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function parseDateText(value) {
  const source = text(value);
  const years = [...source.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  const parts = [...source.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*(?:\+|&|-|–)\s*(\d{1,2})(?!\d))?(?:,?\s*(20\d{2}))?/gi)];
  if (!parts.length || !years.length) return { start: null, end: null };
  const iso = (part, day) => {
    const month = MONTHS.indexOf(part[1].toLowerCase()) + 1;
    const year = Number(part[4] ?? years.at(-1));
    if (!month || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  let start = iso(parts[0], Number(parts[0][2]));
  const last = parts.at(-1);
  const end = parts.length > 1 ? iso(last, Number(last[3] ?? last[2])) : parts[0][3] ? iso(parts[0], Number(parts[0][3])) : null;
  if (start && end && start > end) start = `${Number(start.slice(0, 4)) - 1}${start.slice(4)}`;
  return { start, end };
}
function visibleClock(date, value) {
  if (!date) return null;
  const times = [...text(value).matchAll(/\b(\d{1,2}):(\d{2})\s*([AP])\.?M\b/gi)].map((match) => {
    const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "P" ? 12 : 0);
    return `${String(hour).padStart(2, "0")}:${match[2]}:00`;
  });
  if (!times.length) return null;
  const start = `${date}T${times[0]}`;
  if (times.length < 2) return { start, end: null };
  const endDate = times[1] > times[0] ? date : addDays2(date, 1);
  return { start, end: `${endDate}T${times[1]}` };
}
function wallClock(value) {
  const source = text(value);
  if (!source) return null;
  const stamp = source.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (stamp) return `${stamp[1]}T${stamp[2]}:${stamp[3] ?? "00"}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return `${source}T00:00:00`;
  const parsed = parseDateText(source).start;
  return parsed ? `${parsed}T00:00:00` : null;
}
function publishedClock(value) {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text(value)) ? wallClock(value) : null;
}
function hasClock(value) {
  return Boolean(value && /T\d{2}:\d{2}/.test(value) && !/T00:00(:00)?$/.test(value));
}
function inDateWindow(value, startDate, endDate) {
  const date = String(wallClock(value) ?? "").slice(0, 10);
  if (!date) return false;
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}
function addDays2(date, days) {
  const value = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
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
    return new URL(String(value)).pathname.split("/").filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}
function absoluteUrl(value, base) {
  const source = decodeEntities(String(value ?? "").trim());
  if (!source) return null;
  try {
    const url = new URL(source, base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function attribute(tag, name) {
  const match = String(tag ?? "").match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? "") : "";
}
function firstIndexAfter(source, markers, from) {
  const found = markers.map((marker) => source.indexOf(marker, from)).filter((index) => index >= 0);
  return found.length ? Math.min(...found) : source.length;
}
function comparable(value) {
  return text(value).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function tidyPlace(value) {
  return text(value).replace(/[\s,]+$/, "");
}
function text(value) {
  return decodeEntities(String(value ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function decodeEntities(value) {
  return String(value ?? "").replace(/&#x([0-9a-f]+);|&#([0-9]+);|&([a-z]+);/gi, (entity, hex, decimal, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return { amp: "&", apos: "'", quot: '"', nbsp: " ", lt: "<", gt: ">", ndash: "\u2013", mdash: "\u2014", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201C", rdquo: "\u201D", middot: "\xB7" }[named.toLowerCase()] ?? entity;
  });
}
function numberOrNull7(value) {
  if (value == null || value === "") return null;
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

// ../src/destinationEvents.js
var DEFAULT_DESTINATION_WATCHLIST = Object.freeze([
  Object.freeze({ name: "CRSSD", aliases: Object.freeze(["CRSSD Festival", "CRSSD Fest"]), city: "San Diego", maxDistanceMiles: 160 }),
  Object.freeze({ name: "Proper NYE", aliases: Object.freeze(["PROPER NYE/NYD"]), city: "San Diego", maxDistanceMiles: 160 })
]);
var SOURCE_PRIORITY2 = { seatgeek: 3, ticketmaster: 2 };
var MAX_EDITION_DAYS = 7;
function resolveDestinationWatchlist(input) {
  if (input == null) return DEFAULT_DESTINATION_WATCHLIST.map((entry) => resolveEntry(entry, 0));
  if (!Array.isArray(input)) throw new Error("destinationEvents must be an array of { name, aliases, city, maxDistanceMiles }");
  return input.map(resolveEntry);
}
function resolveEntry(entry, index) {
  const name = String(entry?.name ?? "").trim();
  if (normalizeArtistName(name).length < 3) throw new Error(`destinationEvents[${index}].name must be at least three characters`);
  const maxDistanceMiles = Number(entry.maxDistanceMiles ?? 160);
  if (!Number.isFinite(maxDistanceMiles) || maxDistanceMiles <= 0) throw new Error(`destinationEvents[${index}].maxDistanceMiles must be greater than zero`);
  const aliases = [...new Set((Array.isArray(entry.aliases) ? entry.aliases : []).map((alias) => String(alias).trim()).filter((alias) => normalizeArtistName(alias).length >= 3))];
  return {
    name,
    aliases,
    city: entry.city ? String(entry.city).trim() : null,
    state: String(entry.state ?? "California").trim(),
    maxDistanceMiles,
    type: String(entry.type ?? "music_festival")
  };
}
function matchDestinationWatch({ title, performerNames = [] } = {}, watchlist = DEFAULT_DESTINATION_WATCHLIST) {
  const normalizedTitle = normalizeArtistName(title);
  const presented = normalizedTitle.match(/^.*?\bpresents?\b\s*(.+)$/);
  const ownName = presented ? presented[1] : normalizedTitle;
  const attractions = new Set(performerNames.map(normalizeArtistName).filter(Boolean));
  let best = null;
  for (const watch of watchlist) {
    for (const name of watchNames(watch)) {
      const matchedOn = attractions.has(name) ? "attraction" : ownName === name || ownName.startsWith(`${name} `) ? "title" : null;
      if (!matchedOn) continue;
      const score = (matchedOn === "attraction" ? 1e3 : 0) + name.length;
      if (!best || score > best.score) best = { watch, matchedOn, matchedName: name, score };
    }
  }
  return best ? { watch: best.watch, matchedOn: best.matchedOn, matchedName: best.matchedName } : null;
}
async function fetchDestinationEvents({
  watchlist,
  config = {},
  startDate = null,
  endDate = null,
  ticketmasterApiKey = null,
  seatGeekClientId = null,
  edmtrainClientKey = null,
  artistSnapshot = null,
  retrievedAt = /* @__PURE__ */ new Date(),
  fetchImpl = fetch
} = {}) {
  const watches = resolveDestinationWatchlist(watchlist ?? config.destinationEvents);
  const home = config.home ?? null;
  const warnings = [];
  const sources = {
    ticketmaster: { configured: Boolean(ticketmasterApiKey), queries: 0, failures: 0, matched: 0 },
    seatgeek: { configured: Boolean(seatGeekClientId), queries: 0, failures: 0, matched: 0 },
    edmtrain: { configured: Boolean(edmtrainClientKey), queries: 0, failures: 0, matched: 0, announced: 0 }
  };
  const raw = /* @__PURE__ */ new Map();
  let firstError = null;
  for (const watch of watches) {
    for (const term of queryTerms(watch)) {
      const radius = { home, radiusMiles: watch.maxDistanceMiles, rangeMiles: watch.maxDistanceMiles };
      const providers = [
        ticketmasterApiKey && ["ticketmaster", () => fetchTicketmasterEventsByKeyword({ apiKey: ticketmasterApiKey, keyword: term, startDate, endDate, ...radius, fetchImpl })],
        seatGeekClientId && ["seatgeek", () => fetchSeatGeekEventsByQuery({ clientId: seatGeekClientId, query: term, startDate, endDate, ...radius, fetchImpl })]
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
    const candidate = source === "ticketmaster" ? normalizeTicketmasterEvent(event, retrievedAt) : normalizeSeatGeekEvent(event, retrievedAt);
    const match = matchDestinationWatch({ title: candidate.title, performerNames: candidate.performers.map((performer) => performer.name) }, watches);
    if (!match || !withinWatchArea(candidate.venue, match.watch, home)) continue;
    sources[source].matched += 1;
    const dates = publishedDays(candidate, event, source) ?? (source === "ticketmaster" ? newYearDays(candidate.title, event) : null);
    occurrences.push({ watch: match.watch, candidate, dates });
  }
  const events = [];
  for (const watch of watches) {
    const mine = occurrences.filter((occurrence) => occurrence.watch === watch);
    const editions = groupEditions(mine.filter((occurrence) => occurrence.dates));
    const undated = mine.filter((occurrence) => !occurrence.dates);
    if (editions.length === 1) editions[0].push(...undated.splice(0));
    for (const occurrence of undated) {
      pending.push({
        watch: watch.name,
        source: occurrence.candidate.source,
        sourceEventId: occurrence.candidate.sourceEventId,
        sourceUrl: occurrence.candidate.sourceUrl,
        retrievedAt: occurrence.candidate.retrievedAt,
        reason: "The provider lists this event without a date, and no dated listing or corroborated title date was found."
      });
    }
    for (const edition of editions) {
      const event = buildEdition(edition, watch, home, config);
      if (startDate && event.destination.endDate < startDate || endDate && event.destination.startDate > endDate) continue;
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
function enrichDestinationEventsWithEdmtrain(events, edmEvents, artistSnapshot = { artists: [] }, { watchlist = DEFAULT_DESTINATION_WATCHLIST } = {}) {
  const watches = resolveDestinationWatchlist(watchlist);
  const audit = [];
  const matchedByEvent = /* @__PURE__ */ new Map();
  for (const edm of edmEvents) {
    const match = edm.festival ? matchDestinationWatch({ title: edm.name }, watches) : null;
    if (!match) continue;
    const candidates = events.filter((event) => event.destination?.name === match.watch.name && event.destination.days.includes(edm.date) && samePlace(event.venue, edm.venue));
    if (candidates.length !== 1) {
      audit.push({
        watch: match.watch.name,
        edmtrainEventId: edm.id,
        date: edm.date,
        sourceUrl: edm.sourceUrl,
        status: candidates.length ? "ambiguous" : "announced-no-permitted-candidate"
      });
      continue;
    }
    matchedByEvent.set(candidates[0], [...matchedByEvent.get(candidates[0]) ?? [], edm]);
    audit.push({
      watch: match.watch.name,
      edmtrainEventId: edm.id,
      date: edm.date,
      sourceUrl: edm.sourceUrl,
      status: candidates[0].destination.announcedBy === "edmtrain" ? "announced-surfaced" : "matched",
      canonicalEventId: candidates[0].id,
      lineupCount: edm.orderedArtists.length
    });
  }
  let lineupArtistCount = 0;
  for (const [event, records] of matchedByEvent) {
    records.sort((left, right) => left.date.localeCompare(right.date));
    const ordered = [];
    const seen = /* @__PURE__ */ new Set();
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
    for (const artist of ordered.filter((item) => item.relation !== "unknown")) {
      const key = normalizeArtistName(artist.displayName);
      if (billed.has(key)) continue;
      billed.add(key);
      event.performers.push({ sourceId: null, name: artist.displayName, primary: false });
    }
    event.lineupDisplay = {
      displayTitle: records[0].name || event.title,
      displayShape: "festival",
      orderedArtists: ordered,
      totalArtists: ordered.length,
      directCount: ordered.filter((item) => item.relation === "direct").length,
      adjacentCount: ordered.filter((item) => item.relation === "adjacent").length,
      ages: records.find((record) => record.ages)?.ages ?? null,
      sourceUrl: records[0].sourceUrl
    };
    lineupArtistCount += ordered.length;
  }
  return { events, audit, matchedCount: [...matchedByEvent.values()].filter((records) => records.some((record) => record.orderedArtists.length)).length, lineupArtistCount };
}
function announcedEditions(events, edmEvents, watchlist, { home = null, config = {}, startDate = null, endDate = null, retrievedAt = /* @__PURE__ */ new Date() } = {}) {
  const retrieved = new Date(retrievedAt).toISOString();
  const announced = [];
  for (const watch of watchlist) {
    const listedDays = new Set(events.filter((event) => event.destination?.name === watch.name).flatMap((event) => event.destination.days.flatMap((day) => [addDays3(day, -1), day, addDays3(day, 1)])));
    const records = [...new Map(edmEvents.filter((edm) => edm.festival && edm.sourceUrl && /^\d{4}-\d{2}-\d{2}$/.test(edm.date) && matchDestinationWatch({ title: edm.name }, watchlist)?.watch === watch && withinWatchArea(edm.venue, watch, home) && !listedDays.has(edm.date)).map((edm) => [edm.id, edm])).values()].sort((left, right) => left.date.localeCompare(right.date));
    const editions = [];
    for (const record of records) {
      const current = editions.at(-1);
      if (current && record.date <= addDays3(current.at(-1).date, 1)) current.push(record);
      else editions.push([record]);
    }
    for (const edition of editions) {
      const days = [...new Set(edition.map((record) => record.date))].slice(0, MAX_EDITION_DAYS);
      if (startDate && days.at(-1) < startDate || endDate && days[0] > endDate) continue;
      const first = edition[0];
      const located = edition.map((record) => record.venue).find((venue2) => Number.isFinite(venue2?.lat) && Number.isFinite(venue2?.lon));
      const venue = {
        sourceId: null,
        name: first.venue.name,
        city: first.venue.city || watch.city || "",
        state: watch.state === "California" ? "CA" : watch.state,
        lat: located?.lat ?? null,
        lon: located?.lon ?? null
      };
      const distanceMiles4 = home && located ? Math.round(milesBetween(home, located)) : null;
      const city = watch.city ?? venue.city ?? null;
      const startLocal = `${days[0]}T00:00:00`;
      announced.push({
        schemaVersion: 1,
        id: `edmtrain:${first.id}`,
        source: "edmtrain",
        sourceEventId: first.id,
        sourceUrl: first.sourceUrl,
        sourceOccurrences: edition.map((record) => ({
          source: "edmtrain",
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
        status: "announced",
        venue,
        performers: [],
        // No ticketing source lists it, so nothing is known about tickets.
        ticketObservation: { listingCount: null, lowestPriceUsd: null, averagePriceUsd: null, observedAt: retrieved },
        destination: {
          name: watch.name,
          city,
          distanceMiles: distanceMiles4,
          distanceLabel: distanceMiles4 != null ? `about ${Math.round(distanceMiles4 / 5) * 5} mi from ${config.home?.label ?? "home"}` : city ? `in ${city}` : "outside the home radius",
          days,
          startDate: days[0],
          endDate: days.at(-1),
          dateSource: "published",
          announcedBy: "edmtrain",
          dateNote: "Announced on EDMTrain; no ticketing listing has been found yet, so prices and availability are unknown."
        }
      });
    }
  }
  return announced;
}
function buildEdition(edition, watch, home, config) {
  const dated = edition.filter((occurrence) => occurrence.dates);
  const days = [...new Set(dated.flatMap((occurrence) => occurrence.dates.days))].sort();
  const primary = [...dated].sort((left, right) => (SOURCE_PRIORITY2[right.candidate.source] ?? 0) - (SOURCE_PRIORITY2[left.candidate.source] ?? 0) || left.dates.days[0].localeCompare(right.dates.days[0]) || Number(left.candidate.timeTbd) - Number(right.candidate.timeTbd))[0];
  const opening = dated.filter((occurrence) => occurrence.dates.days[0] === days[0] && !occurrence.dates.derived && !occurrence.candidate.timeTbd && occurrence.candidate.startLocal)[0];
  const derivedOnly = dated.every((occurrence) => occurrence.dates.derived);
  const names = new Set(watchNames(watch));
  const performers = [];
  const billed = /* @__PURE__ */ new Set();
  for (const occurrence of edition) {
    for (const performer of occurrence.candidate.performers) {
      const key = normalizeArtistName(performer.name);
      if (!key || names.has(key) || billed.has(key)) continue;
      billed.add(key);
      performers.push(performer);
    }
  }
  const located = [primary, ...edition].map((occurrence) => occurrence.candidate.venue).find((venue2) => Number.isFinite(venue2?.lat) && Number.isFinite(venue2?.lon));
  const venue = Number.isFinite(primary.candidate.venue?.lat) || !located ? primary.candidate.venue : { ...primary.candidate.venue, lat: located.lat, lon: located.lon };
  const distanceMiles4 = home && located ? Math.round(milesBetween(home, located)) : null;
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
      distanceMiles: distanceMiles4,
      distanceLabel: distanceMiles4 != null ? `about ${Math.round(distanceMiles4 / 5) * 5} mi from ${config.home?.label ?? "home"}` : city ? `in ${city}` : "outside the home radius",
      days,
      startDate: days[0],
      endDate: days.at(-1),
      // `derived-from-title` dates were not published as a date by any
      // provider; `dateNote` says exactly how they were arrived at.
      dateSource: derivedOnly ? "derived-from-title" : "published",
      ...derivedOnly ? { dateNote: dated[0].dates.note } : {}
    }
  };
}
function groupEditions(occurrences) {
  const editions = [];
  let lastDay = null;
  for (const occurrence of [...occurrences].sort((left, right) => left.dates.days[0].localeCompare(right.dates.days[0]))) {
    if (lastDay == null || occurrence.dates.days[0] > addDays3(lastDay, 1)) editions.push([]);
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
  const end = source === "ticketmaster" ? String(event.dates?.end?.localDate ?? "") : "";
  return { days: dayRange(start, /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start ? end : start), derived: false };
}
function newYearDays(title, event) {
  const year = Number(String(title ?? "").match(/\bNYE\s*(?:\/|&|\+|and)\s*NYD\s+(20\d{2})\b/i)?.[1]);
  const saleEnd = String(event?.sales?.public?.endDateTime ?? "").slice(0, 10);
  if (!year || !/^\d{4}-\d{2}-\d{2}$/.test(saleEnd)) return null;
  const end = `${year}-01-01`;
  if (saleEnd < end || saleEnd > addDays3(end, 3)) return null;
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
  return !(watch.city && cityMatches == null && inRange == null);
}
function samePlace(left = {}, right = {}) {
  const a = normalizeArtistName(left.name);
  const b = normalizeArtistName(right.name);
  if (a && b && (a === b || a.length > 8 && b.length > 8 && (a.includes(b) || b.includes(a)))) return true;
  if ([left.lat, left.lon, right.lat, right.lon].every(Number.isFinite)) return milesBetween(left, right) <= 1.5;
  const city = normalizeArtistName(left.city);
  return Boolean(city && city === normalizeArtistName(right.city));
}
function lineupRelation(name, snapshot) {
  const key = normalizeArtistName(name);
  const matches = (snapshot?.artists ?? []).filter((artist) => [artist.name, ...artist.aliases ?? []].some((alias) => normalizeArtistName(alias) === key));
  if (matches.length !== 1) return "unknown";
  return ["source", "top-items"].includes(matches[0].origin ?? "source") ? "direct" : "adjacent";
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
  return [...new Set([watch.name, ...watch.aliases ?? []].map(normalizeArtistName).filter((name) => name.length >= 3))];
}
function queryTerms(watch) {
  const terms = [watch.name, ...watch.aliases ?? []].map((term) => ({ term, key: normalizeArtistName(term) })).filter((item) => item.key.length >= 3);
  return terms.filter((item, index) => !terms.some((other, otherIndex) => otherIndex !== index && (item.key.startsWith(`${other.key} `) || item.key === other.key && otherIndex < index))).map((item) => item.term);
}
function dayRange(start, end) {
  const days = [start];
  while (days.at(-1) < end && days.length < MAX_EDITION_DAYS) days.push(addDays3(days.at(-1), 1));
  return days;
}
function addDays3(date, count) {
  const value = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
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
      const strength = round3(artist.seedStrength * result.match * 0.55, 4);
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
      const strength = round3(maximumSeed * 0.35 * (tag.weight / strongestTag) * rankDecay, 4);
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
    source: "spotify+lastfm",
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
  current.seedStrength = round3(Math.max(current.seedStrength, strength) + Math.min(current.seedStrength, strength) * 0.15, 4);
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
function round3(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ../src/nightlife/semanticInput.js
var SEMANTIC_INPUT_SCHEMA_VERSION = 3;
var PERMITTED_EVIDENCE_PROVIDERS2 = ["ticketmaster", "framework"];
var FIELD_PROVENANCE = {
  ref: "derived",
  publishedFacts: "permitted-provider",
  knownUnknowns: "derived"
};
var RESTRICTED_KEY = /(?:seatgeek|spotify|edmtrain|playlist|affinity|seed.?strength|top.?artists|matched.?artists|top.?tags|personal.?context|feedback|lastfm.?similar|api.?key|token|secret)/i;
var RESTRICTED_VALUE = /(?:seatgeek\.com|open\.spotify\.com|edmtrain\.com|api\.seatgeek|spotify:artist)/i;
var SourcePolicyError = class extends Error {
};
function buildSemanticCandidateInput(candidate, { ref } = {}) {
  if (!ref) throw new SourcePolicyError("A candidate input requires an opaque ref.");
  const evidence = permittedOnly(buildEventEvidence(candidate));
  const serialized = serializeEventEvidenceForModel(evidence);
  const publishedFacts = serialized.publishedFacts ?? {};
  const restricted = Object.keys(publishedFacts).length === 0;
  const fields = { ref };
  if (!restricted) fields.publishedFacts = publishedFacts;
  fields.knownUnknowns = [.../* @__PURE__ */ new Set([...eventUnknowns(publishedFacts), ...serialized.knownUnknowns])];
  const input = {
    ref,
    restricted,
    fields,
    evidenceRefs: Object.keys(publishedFacts).map((field) => `${ref}/publishedFacts/${field}`)
  };
  assertFieldProvenance(fields);
  return input;
}
function buildSemanticRequest(candidates) {
  const inputs = candidates.map((candidate, index) => buildSemanticCandidateInput(candidate, { ref: `cand-${index + 1}` }));
  const payload = {
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    candidates: inputs.filter((input) => !input.restricted).map(eventState)
  };
  assertNoRestrictedEvidence(payload);
  return { payload, inputs };
}
function eventState(input) {
  return {
    event: {
      ref: input.ref,
      published: input.fields.publishedFacts ?? {},
      missing: input.fields.knownUnknowns ?? []
    }
  };
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
function permittedOnly(evidence) {
  const permittedFacts = Object.fromEntries(Object.entries(evidence?.permittedFacts ?? {}).filter(([, fact]) => PERMITTED_EVIDENCE_PROVIDERS2.includes(fact?.provider)));
  return { ...evidence, permittedFacts };
}
function eventUnknowns(publishedFacts) {
  const unknowns = [];
  if (!publishedFacts.endTime) unknowns.push("end-time");
  unknowns.push("closing-hours", "after-hours");
  if (!publishedFacts.namedLineup) unknowns.push("lineup");
  if (!publishedFacts.classification) unknowns.push("genre");
  if (!publishedFacts.agePolicy) unknowns.push("age-policy");
  unknowns.push("ticket-availability");
  return unknowns;
}

// ../src/nightlife/personalRelevance.js
var DIRECT_ORIGINS2 = /* @__PURE__ */ new Set(["source", "top-items"]);
var DISTINCT_EXPERIENCES = /* @__PURE__ */ new Set(["dance_floor", "festival_multi_stage", "seated_listening"]);
var USABLE_CERTAINTY = /* @__PURE__ */ new Set(["high", "moderate"]);
var DESCRIPTIVE_MODEL_FACTS = ["classification", "format", "namedLineup"];
function preferenceSignalsFor(candidate, preferences = {}) {
  const directArtists = [];
  const matched = [...candidate?.matchedArtists ?? []].sort((left, right) => Number(Boolean(right?.primary)) - Number(Boolean(left?.primary)));
  for (const artist of matched) {
    const name = String(artist?.name ?? "").trim();
    if (!name || !DIRECT_ORIGINS2.has(artist.origin)) continue;
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
    const text3 = familiarArtistText(artist, experience.experience, listValues(facts.namedLineup?.value).length);
    if (text3) {
      claims.push({
        comparison: "familiar-artist-in-format",
        text: text3,
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
  const text3 = factText(fact);
  const match = text3?.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})/);
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
    promoters: Array.isArray(candidate.promoters) ? candidate.promoters.map(String) : [],
    eventName: candidate.eventName ?? null,
    destination: candidate.destination ?? null,
    // What feedback about this night can teach, derived only from fields this
    // row already displays. Frozen into a record when feedback is given.
    feedbackKeys: feedbackKeysFor(candidate, "music"),
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
    source: game.source ?? "mlb",
    league: game.league ?? "mlb",
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
    feedbackKeys: feedbackKeysFor(game, "sports"),
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
var QUESTION_SET_VERSION = 4;
var DEFAULT_CERTAINTY_THRESHOLDS = { high: 0.75, moderate: 0.5 };
var SHARED_PREFACE = "You are characterizing one Los Angeles event from its published facts. Some facts are intentionally withheld by source policy; absent detail is uncertainty, not a negative. Judge only from the supplied state.";
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
function buildQuestionSet({ input = null } = {}) {
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
function certaintyBand(confidence, thresholds = DEFAULT_CERTAINTY_THRESHOLDS) {
  if (!Number.isFinite(confidence)) return "low";
  if (confidence >= thresholds.high) return "high";
  if (confidence >= thresholds.moderate) return "moderate";
  return "low";
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
  requiredIds = [],
  // No shortlist by default: every candidate with model-eligible evidence is
  // assessed. The provider's own ceiling (NIGHTLIFE_MAX_CANDIDATES) still
  // bounds spend, and anything past it is reported, not hidden.
  maxCandidates = Infinity,
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
  const { inputs: allInputs } = buildSemanticRequest(ordered);
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
  const result = provider ? await provider.assessCandidates(inputs) : { assessments: /* @__PURE__ */ new Map(), telemetry: { status: "not configured", coverage: { requested: inputs.length, covered: 0, uncovered: inputs.map((input) => input.ref) } } };
  const assessmentById = /* @__PURE__ */ new Map();
  inputs.forEach((input, index) => {
    const assessment = result.assessments.get(input.ref) ?? null;
    if (assessment) assessmentById.set(String(selected[index].id), assessment);
  });
  const skippedByCeiling = result.telemetry?.skippedForBudget ?? 0;
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
    eligibleBeyondBudget: eligibleBeyondBudget + skippedByCeiling,
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
var DECISION_SCHEMA_VERSION = 3;
var DecisionSchemaError = class extends Error {
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
  certaintyThresholds = DEFAULT_CERTAINTY_THRESHOLDS
} = {}) {
  if (!candidateRef) throw new DecisionSchemaError("An assessment requires a candidate ref.");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new DecisionSchemaError("Provider answers must be an object keyed by question id.");
  }
  const questionSet = buildQuestionSet({ input });
  const assessment = {
    candidateRef,
    schemaVersion: DECISION_SCHEMA_VERSION,
    questionSetVersion: QUESTION_SET_VERSION
  };
  const certainty = {};
  const signals = {};
  let answeredCount = 0;
  for (const [field, { allowed, questionId }] of Object.entries(EVENT_DIMENSIONS)) {
    const answer = questionSet[questionId] ? answers[questionId] : null;
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
    signals[questionId] = { choice: choice.choice, confidence: round4(choice.confidence), probabilities: roundAll(choice.probabilities) };
    answeredCount += 1;
  }
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
  const lead = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return `${lead}${parts.length > 1 ? `; ${parts.slice(1).join(", ")}` : ""}.`;
}
function validateAnswerEnvelope(answers, { expectedQuestionIds } = {}) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new DecisionSchemaError("Provider response did not contain an answers map.");
  }
  const expected = new Set(expectedQuestionIds ?? []);
  for (const id of Object.keys(answers)) {
    if (!expected.has(id)) throw new DecisionSchemaError(`Provider answered an unrequested question (${id}).`);
  }
  return answers;
}
function validateChoiceAnswer(answer, questionId, questionSet = null) {
  if (answer.type && answer.type !== "choice") {
    throw new DecisionSchemaError(`Question ${questionId} expected a choice answer.`);
  }
  const definition = questionSet?.[questionId];
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
function round4(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}
function roundAll(probabilities) {
  if (!probabilities || typeof probabilities !== "object") return {};
  return Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, round4(Number(value))]));
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
var DEFAULT_MAX_CANDIDATES = 200;
function createDecisionInferenceProvider(config = {}, { fetchImpl = fetch, cache = createAssessmentCache() } = {}) {
  const adapter = adapterFor(config, fetchImpl);
  const concurrency = boundedInteger(config.concurrency, 1, 8, 4);
  const maxCandidates = boundedInteger(config.maxCandidates, 1, 500, DEFAULT_MAX_CANDIDATES);
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
     * @param {Array} inputs event-evidence inputs from `buildSemanticRequest`
     * @returns {Promise<{assessments: Map<string, object>, telemetry: object}>}
     */
    async assessCandidates(inputs, options = {}) {
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
      const deadline = started + deadlineMs;
      const pending = [];
      for (const input of requested) {
        const questions = buildQuestionSet({ input });
        const key = assessmentCacheKey({
          candidateRevision: input.revision ?? null,
          input: { publishedFacts: input.fields.publishedFacts ?? null, knownUnknowns: input.fields.knownUnknowns },
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
        pending.push({ input, key, questions });
      }
      await runWithConcurrency(pending, concurrency, async ({ input, key, questions }) => {
        if (!Object.keys(questions).length) return;
        if (Date.now() >= deadline) {
          telemetry.deadlineSkipped += 1;
          return;
        }
        if (maxCostUsd != null && (telemetry.costUsd ?? 0) >= maxCostUsd) {
          telemetry.budgetSkipped += 1;
          return;
        }
        const state = eventState(input);
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
            certaintyThresholds: config.certaintyThresholds
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
    // A per-refresh spend ceiling, not a shortlist. Every candidate with eligible
    // evidence is assessed; at ~$0.00004 each, 200 is under one cent.
    maxCandidates: integer(env.NIGHTLIFE_MAX_CANDIDATES, 200),
    maxAttempts: integer(env.NIGHTLIFE_MAX_ATTEMPTS, 3),
    deadlineMs: integer(env.NIGHTLIFE_DEADLINE_MS, 6e4),
    maxCostUsd: float(env.NIGHTLIFE_MAX_COST_USD, null),
    gateway: {
      apiKey: text2(env.AI_GATEWAY_API_KEY),
      model: text2(env.AI_GATEWAY_MODEL) ?? DEFAULT_GATEWAY_MODEL,
      baseUrl: text2(env.AI_GATEWAY_BASE_URL) ?? DEFAULT_GATEWAY_BASE_URL,
      requestPath: text2(env.AI_GATEWAY_REQUEST_PATH) ?? void 0
    },
    direct: {
      // TYPESAFE_API_KEY is the vendor SDK's conventional name; the longer
      // form is what this project's environment uses.
      apiKey: text2(env.TYPESAFE_AI_API_KEY) ?? text2(env.TYPESAFE_API_KEY),
      model: text2(env.TYPESAFE_AI_MODEL) ?? text2(env.TYPESAFE_MODEL) ?? DEFAULT_DIRECT_MODEL,
      baseUrl: text2(env.TYPESAFE_AI_BASE_URL) ?? text2(env.TYPESAFE_BASE_URL) ?? DEFAULT_DIRECT_BASE_URL,
      requestPath: text2(env.TYPESAFE_REQUEST_PATH) ?? void 0
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
function text2(value) {
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
  DEFAULT_DESTINATION_WATCHLIST,
  DEFAULT_FOCAL_POINT,
  EDMTRAIN_API_BASE_URL,
  EVENT_EVIDENCE_SCHEMA_VERSION,
  FEEDBACK_POLICY,
  INSOMNIAC_ADAPTER_VERIFIED,
  NOISY_TAGS,
  PROMOTER_SOURCES,
  RAMS_TEAM_ID,
  SOFI_STADIUM,
  SOURCE_DEADLINE_MS,
  UNORDERED_URGENCIES,
  URGENCY_PRIORITY,
  addPromoterEvidence,
  applyArtistTags,
  applyEngagements,
  applyFeedbackOverlay,
  applyNflStandings,
  applyPitcherStats,
  artistTagKey,
  buildEdmtrainUrl,
  buildEventEvidence,
  buildExpandedArtistSnapshot,
  buildFeedbackReview,
  buildOverview,
  buildOverviewBuckets,
  buildSceneProfile,
  buildSemanticCandidateInput,
  buildSemanticEventInsight,
  buildSemanticRequest,
  calculateHassle,
  callLabel,
  canonicalEventTitle,
  createAssessmentCache,
  createDecisionInferenceProvider,
  createEventEvidence,
  createEvidenceFact,
  deduplicateCandidates,
  deriveFeedbackSignals,
  describeLearning,
  describeNightlifeConfig,
  engagementSourceHealth,
  enrichEventsWithEdmtrain,
  enrichMovieMetadata,
  enrichSemanticEventCards,
  enrichSportsGames,
  eventWithinRadius,
  feedbackKeysFor,
  fetchDestinationEvents,
  fetchDodgersHomeGames,
  fetchEdmtrainEvents,
  fetchFrameworkArtists,
  fetchFrameworkEvents,
  fetchInsomniacEvents,
  fetchMlbPitcherStats,
  fetchMlbStandings,
  fetchNflStandings,
  fetchRamsHomeGames,
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
  knownArtistNames,
  nflSeasonsForWindow,
  nightlifeInferenceConfigured,
  normalizeArtistName,
  normalizeEdmtrainEvent,
  normalizeEngagements,
  normalizeFocalPoint,
  normalizeFrameworkEvent,
  normalizeInsomniacEvent,
  normalizeMlbGame,
  normalizeNflGame,
  normalizeNflStandings,
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
  parsePromoterTitle,
  playlistAffinityFor,
  promoterAffinityFor,
  rankAffinity,
  rankCandidates,
  readNightlifeConfig,
  resolveArtistTags,
  resolveDestinationWatchlist,
  resolveMovieVisual,
  resolveMusicVisual,
  resolveSeatGeekPerformers,
  resolveSportsVisual,
  resolveTmdbAuth,
  sameOccurrence,
  sceneFitFor,
  scoreSportsGame,
  searchSeatGeekPerformers,
  selectMovieCandidates,
  selectPublishedConcerts,
  selectSeatGeekPerformer,
  semanticSourceHealth,
  serializeEventEvidenceForDisplay,
  serializeEventEvidenceForModel,
  splitDateWindows,
  sportsLeagueConfig,
  sportsLeagueOf,
  sportsTicketUrgency,
  spotifyIdFromLinks,
  summarizeEvidenceCoverage,
  ticketMatchesGame,
  ticketmasterEventMatchesArtist,
  toDisplayEvent,
  toDisplaySportsGame,
  topItemsAffinityFor,
  topRecurringTags,
  withDeadline
};
