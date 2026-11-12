// Every urgency value the engine can emit, in escalation order. 'unknown'
// and 'likely unavailable' are deliberately unmapped: they carry no ordering,
// so consumers must not report an "upgrade" into or out of them.
export const URGENCY_PRIORITY = Object.freeze({ 'safe to wait': 0, watch: 1, 'buy now': 2 });
export const UNORDERED_URGENCIES = Object.freeze(['unknown', 'likely unavailable']);
export const PROMOTER_SOURCES = Object.freeze(['framework', 'insomniac']);
const DESTINATION_INTEREST = 36;
// Tags that say nothing about a scene: listener habits and nationalities.
export const NOISY_TAGS = new Set([
  'albums i own', 'awesome', 'favorite', 'favorites', 'favourite', 'favourites', 'female vocalists', 'male vocalists',
  'seen live', 'spotify', 'under 2000 listeners', 'under 5000 listeners', 'all', 'music', 'dj', 'djs', 'producer',
  'american', 'usa', 'british', 'uk', 'english', 'german', 'dutch', 'french', 'italian', 'spanish', 'swedish',
  'australian', 'canadian', 'korean', 'japanese', 'belgian', 'irish', 'scottish', 'brazilian'
]);
const DIRECT_ORIGINS = ['source', 'top-items'];

// One vocabulary for the call, shared by the ranker, the Overview and the site.
export function callLabel(score) {
  if (score >= 75) return 'Strong fit';
  if (score >= 55) return 'Selective';
  if (score >= 40) return 'Wildcard';
  return 'Watch';
}
import { localDateDifference } from './localDate.js';

export function rankCandidates(candidates, artistSnapshot, config, now = new Date()) {
  const bySpotifyId = new Map((artistSnapshot.artists ?? []).filter((artist) => artist.spotifyArtistId).map((artist) => [artist.spotifyArtistId, artist]));
  const bySeatGeekId = new Map((artistSnapshot.artists ?? []).filter((artist) => artist.seatGeekPerformerId).map((artist) => [String(artist.seatGeekPerformerId), artist]));
  const byNormalizedName = new Map();
  for (const artist of artistSnapshot.artists ?? []) {
    for (const name of [artist.name, ...(artist.aliases ?? [])]) {
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
    artist: bySeatGeekId.get(String(performer.sourceId))
      ?? (performer.spotifyId ? bySpotifyId.get(performer.spotifyId) : null)
      ?? uniqueNameMatch(byNormalizedName.get(normalizeArtistName(performer.name)))
  })).filter((match) => match.artist);
  const directAffinityOf = (artist) => {
    const playlistAffinity = playlistAffinityFor(artist, maximumSeedStrength);
    const topAffinity = topItemsAffinityFor(artist, artistSnapshot.topItems, now);
    const corroborationBonus = playlistAffinity > 0 && topAffinity > 0
      ? Math.min(6, Math.round(Math.min(playlistAffinity, topAffinity) * 0.10))
      : 0;
    return { playlistAffinity, topAffinity, corroborationBonus, directAffinity: Math.min(60, Math.max(playlistAffinity, topAffinity) + corroborationBonus) };
  };
  const sceneProfile = buildSceneProfile(artistSnapshot.artists ?? []);
  // Who a discovered artist is billed with, across every bill in the horizon.
  // Sharing a lineup with artists you already play is the strongest evidence
  // available about an artist the taste profile has never seen.
  const coBilling = new Map();
  for (const candidate of candidates) {
    const matches = matchPerformers(candidate);
    const direct = matches
      .filter((match) => DIRECT_ORIGINS.includes(match.artist.origin ?? 'source'))
      .map((match) => ({ name: match.artist.name, affinity: directAffinityOf(match.artist).directAffinity }))
      .filter((item) => item.affinity > 0)
      .sort((a, b) => b.affinity - a.affinity);
    if (!direct.length) continue;
    for (const match of matches) {
      if (match.artist.origin !== 'promoter') continue;
      const key = normalizeArtistName(match.artist.name);
      const current = coBilling.get(key);
      if (!current || direct[0].affinity > current.affinity) coBilling.set(key, direct[0]);
    }
  }

  return candidates.map((candidate) => {
    const matches = matchPerformers(candidate);
    const promoterShow = promoterShowFor(candidate);

    const excluded = candidate.performers.some((performer) => excludedArtists.has(normalizeArtistName(performer.name)))
      || excludedVenues.has(normalizeArtistName(candidate.venue.name));
    const rosterArtistsOnBill = matches.filter((match) => match.artist.origin === 'promoter').length;
    const scoredMatches = matches.map((match) => {
      if (match.artist.origin === 'promoter') {
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
    // A second or third artist you already play on the same bill is worth
    // something, but far less than the headline match.
    const lineupBonus = Math.min(8, Math.round(scoredMatches.slice(1)
      .filter((match) => !match.inferred)
      .reduce((sum, match) => sum + match.directAffinity * 0.12, 0)));
    const artistFit = Math.min(68, (strongestMatch?.directAffinity ?? 0) + lineupBonus);
    // A destination festival is on the watchlist by name: explicit interest in
    // the event itself, whoever is on the bill.
    // It guarantees a hearing when nobody on the bill is known and tapers as
    // artist fit takes over, so the two never stack into a runaway score.
    const pinnedBonus = (candidate.performers.some((performer) => pinned.has(normalizeArtistName(performer.name))) ? 15 : 0)
      + (candidate.destination ? Math.max(8, DESTINATION_INTEREST - Math.round(artistFit * 0.5)) : 0);
    const distanceMiles = distanceBetween(config.home, candidate.venue);
    const hassle = calculateHassle(candidate, config, distanceMiles);
    const hassleScore = hassle.score;
    const urgency = ticketUrgency(candidate.ticketObservation, candidate.startLocal, now);
    const lowestPrice = candidate.ticketObservation?.lowestPriceUsd;
    // A multi-day festival pass is not comparable to one night's ticket.
    const aboveHardCeiling = !candidate.destination && config.hardMaxTicketPriceUsd != null && lowestPrice != null && lowestPrice > config.hardMaxTicketPriceUsd;
    const excludedByRule = excluded || aboveHardCeiling;
    const utility = excludedByRule ? -100 : artistFit + pinnedBonus - hassleScore * 2;
    const confidence = strongestMatch
      ? (['similar', 'tag', 'promoter'].includes(strongestMatch.artist.origin) ? 'medium' : 'high')
      : 'low';

    return {
      ...candidate,
      matchedArtists: scoredMatches.map((match) => ({
        spotifyArtistId: match.artist.spotifyArtistId,
        name: match.artist.name,
        seedStrength: match.artist.seedStrength,
        origin: match.artist.origin ?? 'source',
        matchMethod: match.performer.sourceId && match.artist.seatGeekPerformerId
          && String(match.performer.sourceId) === String(match.artist.seatGeekPerformerId)
          ? 'seatgeek-performer-id'
          : (match.performer.spotifyId ? 'spotify-id' : 'exact-name'),
        primary: match.performer.primary
      })),
      ranking: {
        excluded: excludedByRule,
        exclusionReason: excluded ? 'explicit exclusion' : aboveHardCeiling ? 'above hard price ceiling' : null,
        call: callLabel(utility),
        discovery: candidate.destination
          ? { tier: 'destination', promoterShow, rosterPromoter: null, destination: candidate.destination.name }
          : discoveryFor(strongestMatch, promoterShow),
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
        whyYou: candidate.destination
          ? destinationReason(candidate, strongestMatch?.artist)
          : strongestMatch
          ? whyYouReason(strongestMatch.artist, candidate, artistSnapshot.topItems, now, strongestMatch.inferred)
          : 'No exact match to the selected Spotify artists yet.'
      }
    };
  }).sort((a, b) => b.ranking.utility - a.ranking.utility || String(a.startLocal).localeCompare(String(b.startLocal)));
}

export function playlistAffinityFor(artist, maximumSeedStrength) {
  return artist
    ? Math.round((Number(artist.seedStrength ?? 0) / Math.max(1, maximumSeedStrength)) * 60)
    : 0;
}

export function topItemsAffinityFor(artist, topItems = {}, now = new Date()) {
  const evidence = artist?.topEvidence;
  if (!evidence) return 0;
  const windows = [
    ['shortTerm', 0.40, evidence.shortTermRank],
    ['mediumTerm', 0.35, evidence.mediumTermRank],
    ['longTerm', 0.25, evidence.longTermRank]
  ].filter(([key]) => usableTopWindow(topItems?.windows?.[key], now));
  const totalWeight = windows.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = windows.reduce((sum, [, weight, rank]) => sum + weight * rankAffinity(rank), 0);
  return Math.round(weighted / totalWeight);
}

export function rankAffinity(rank) {
  const value = Number(rank);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? 60 * (51 - value) / 50 : 0;
}

function whyYouReason(artist, candidate = {}, topItems = {}, now = new Date(), inferred = null) {
  const labels = topPreferenceLabels(artist, topItems, now);
  if (labels.length) {
    const labelText = labels.join(' and ');
    const count = artist.evidence?.length ?? 0;
    return count
      ? `${artist.name} is a ${labelText} and a strong signal in ${count} selected playlist${count === 1 ? '' : 's'}.`
      : `${artist.name} is a ${labelText} based on Spotify affinity.`;
  }
  if (artist.topEvidence && artist.origin === 'top-items' && hasUsableTopWindow(topItems, now)) return `${artist.name} is a direct Spotify top-artist signal.`;
  if (!artist.origin || artist.origin === 'source') {
    const count = artist.evidence?.length ?? 0;
    const trackCount = artist.evidence?.[0]?.trackCount ?? 0;
    if (count >= 3) return `${artist.name} runs through ${count} of your selected playlists.`;
    if (count === 2) return `${artist.name} anchors two of your selected playlists.`;
    if (count === 1 && trackCount >= 3) return `${artist.name} shows up ${trackCount} times in one of your core playlists.`;
    if (count === 1) return `${artist.name} is a strong signal in one of your selected playlists.`;
    return `${artist.name} is a direct signal from your selected playlists.`;
  }
  const similar = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === 'lastfm-similar');
  if (similar) return `${artist.name} is a Last.fm neighbor of ${similar.sourceArtist}, one of your stronger playlist signals.`;
  const tag = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === 'lastfm-tag');
  if (tag) return `${artist.name} ranks within your recurring “${tag.tag}” taste cluster.`;
  const roster = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === 'framework-roster');
  const calendar = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === 'promoter-event' || evidence.type === 'promoter');
  if (roster || calendar) {
    // Say only what is true of this listing: a roster artist playing someone
    // else's night was found through the roster, not promoted by Framework.
    const promoter = promoterShowFor(candidate);
    const providers = listingProviders(candidate).filter((label) => label !== promoter);
    const listing = providers.length ? `this listing is from ${providers.join(' + ')}` : null;
    const found = roster
      ? promoter === roster.promoter
        ? `${artist.name} is on the ${roster.promoter} artist roster, and this is a ${roster.promoter} night`
        : promoter
          ? `${artist.name} is on the ${roster.promoter} artist roster; this night is on ${promoter}'s calendar`
          : `${artist.name} is on the ${roster.promoter} artist roster${listing ? `; ${listing}, not a ${roster.promoter} night` : ''}`
      : promoter
        ? `${artist.name} is on ${promoter}'s calendar, which you follow`
        : `${artist.name} plays ${calendar.promoter} nights you follow${listing ? `; ${listing}` : ''}`;
    const sceneTags = inferred?.scene?.points >= 4 ? inferred.scene.tags : [];
    const because = [
      inferred?.coBilled ? ` Shares a bill with ${inferred.coBilled.name}, who is in your rotation.` : '',
      sceneTags.length ? ` Tagged ${sceneTags.join(' and ')}, ${sceneTags.length > 1 ? 'scenes' : 'a scene'} your listening is built on.` : ''
    ].join('') || ' No listening evidence yet, so this is a discovery rather than a match.';
    return `${found}.${because}`;
  }
  return `${artist.name} is an adjacent discovery from your playlist-derived taste graph.`;
}

function topPreferenceLabels(artist, topItems = {}, now = new Date()) {
  const evidence = artist?.topEvidence;
  if (!evidence) return [];
  const shortAvailable = usableTopWindow(topItems.windows?.shortTerm, now);
  const mediumAvailable = usableTopWindow(topItems.windows?.mediumTerm, now);
  const longAvailable = usableTopWindow(topItems.windows?.longTerm, now);
  const labels = [];
  if (shortAvailable && evidence.shortTermRank != null && evidence.shortTermRank <= 10) labels.push('current top artist');
  if (mediumAvailable && longAvailable && evidence.mediumTermRank != null && evidence.mediumTermRank <= 25 && evidence.longTermRank != null && evidence.longTermRank <= 25) {
    labels.push('sustained favorite');
  }
  if (shortAvailable && mediumAvailable && evidence.shortTermRank != null && evidence.shortTermRank <= 10 && (evidence.mediumTermRank == null || evidence.mediumTermRank > 25)) {
    labels.push('current surge');
  }
  return labels;
}

function usableTopWindow(window, now) {
  if (!['fresh', 'cached'].includes(window?.status)) return false;
  if (!window.expiresAt) return true;
  const expiry = new Date(window.expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > new Date(now).getTime();
}

function hasUsableTopWindow(topItems, now) {
  return Object.values(topItems?.windows ?? {}).some((window) => usableTopWindow(window, now));
}

function destinationReason(candidate, artist) {
  const { name, distanceLabel, dateNote } = candidate.destination;
  const trip = distanceLabel ? ` It is a trip: ${distanceLabel}.` : '';
  const lineup = artist ? ` ${artist.name} is on the bill and in your profile.` : '';
  return `${name} is on your destination watchlist.${trip}${lineup}${dateNote ? ` ${dateNote}` : ''}`;
}

// A discovered artist has no listening evidence. Fit is built only from what
// is known: the followed promoter is putting on this night, the artist shares
// a bill with artists in the profile, or several followed artists are on it.
export function promoterAffinityFor(artist, { promoterShow = null, coBilled = null, rosterArtistsOnBill = 1, scene = null } = {}) {
  const base = 12;
  const ownNight = promoterShow ? 4 : 0;
  const coBilling = coBilled ? Math.min(14, Math.round(coBilled.affinity * 0.3)) : 0;
  const depth = Math.min(4, Math.max(0, rosterArtistsOnBill - 1) * 2);
  const sceneFit = scene?.points ?? 0;
  return { affinity: base + ownNight + coBilling + depth + sceneFit, base, ownNight, coBilling, depth, sceneFit, scene, coBilled };
}

const SCENE_FIT_MAX = 14;

// The scenes the listening profile is built from, as weighted genre tags, with
// each tag discounted by how common it is among discovered artists. "Electronic"
// describes nearly every roster act and separates none of them; "tech house"
// does. Built only from tags already attached to artists.
export function buildSceneProfile(artists = []) {
  const weights = new Map();
  for (const artist of artists) {
    if (!DIRECT_ORIGINS.includes(artist.origin ?? 'source')) continue;
    const weight = Math.max(0.1, Number(artist.seedStrength) || 0.1);
    for (const tag of normalizedTags(artist)) weights.set(tag, (weights.get(tag) ?? 0) + weight);
  }
  const discovered = artists.filter((artist) => artist.origin === 'promoter' && normalizedTags(artist).length);
  const frequency = new Map();
  for (const artist of discovered) for (const tag of normalizedTags(artist)) frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
  const top = [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  const strongest = Math.max(1, ...top.map(([, weight]) => weight));
  const tags = new Map(top.map(([tag, weight]) => {
    const share = discovered.length >= 8 ? (frequency.get(tag) ?? 0) / discovered.length : 0;
    return [tag, (weight / strongest) * (1 - Math.min(0.85, share))];
  }));
  const norm = [...tags.values()].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
  return { tags, norm };
}

// How much of that profile a discovered artist's own tags cover.
export function sceneFitFor(artist, profile) {
  if (!profile?.norm) return { points: 0, tags: [] };
  const matched = normalizedTags(artist)
    .filter((tag) => profile.tags.has(tag))
    .map((tag) => ({ tag, weight: profile.tags.get(tag) }))
    .sort((a, b) => b.weight - a.weight);
  const covered = matched.slice(0, 3).reduce((sum, item) => sum + item.weight, 0);
  return { points: Math.round(SCENE_FIT_MAX * Math.min(1, covered / profile.norm)), tags: matched.slice(0, 2).map((item) => item.tag) };
}

function normalizedTags(artist) {
  return [...new Set((artist?.genres ?? []).map((tag) => normalizeArtistName(tag)).filter((tag) => tag && !NOISY_TAGS.has(tag)))];
}

function promoterShowFor(candidate = {}) {
  const sources = new Set((candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.source));
  if (candidate.source) sources.add(candidate.source);
  if (sources.has('framework')) return 'Framework';
  if (sources.has('insomniac')) return 'Insomniac';
  return null;
}

// How the strongest match was found, kept apart from who promotes the night.
function discoveryFor(match, promoterShow) {
  const origin = match?.artist?.origin ?? (match ? 'source' : null);
  const rosterPromoter = (match?.artist?.discoveryEvidence ?? []).find((evidence) => evidence.type === 'framework-roster')?.promoter ?? null;
  const tier = !match ? 'none'
    : DIRECT_ORIGINS.includes(origin) ? 'direct'
      : origin === 'similar' ? 'similar'
        : origin === 'tag' ? 'tag'
          : promoterShow ? 'promoter-night' : 'roster';
  return { tier, promoterShow, rosterPromoter };
}

// Published concerts: resolved, not excluded, and backed by some evidence.
// An artist whose only evidence has expired matches by name but carries no
// weight; publishing that as a zero-point card reads as a recommendation.
export function selectPublishedConcerts(candidates, limit = 120) {
  return candidates
    .filter((candidate) => !candidate.ranking?.excluded
      && ((candidate.matchedArtists ?? []).length > 0 || candidate.destination)
      && (candidate.ranking.artistFit + candidate.ranking.pinnedBonus) > 0)
    .sort((a, b) => b.ranking.utility - a.ranking.utility || String(a.startLocal).localeCompare(String(b.startLocal)))
    .slice(0, limit);
}

function uniqueNameMatch(matches = []) {
  return matches.length === 1 ? matches[0] : null;
}

function listingProviders(candidate) {
  const sources = new Set((candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.source).filter(Boolean));
  if (candidate.source) sources.add(candidate.source);
  const labels = { seatgeek: 'SeatGeek', ticketmaster: 'Ticketmaster', framework: 'Framework', insomniac: 'Insomniac' };
  return [...sources].map((source) => labels[source] ?? source);
}

export function normalizeArtistName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(live|dj set|live set)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function calculateHassle(candidate, config, distanceMiles) {
  const logisticalReasons = [];
  const commercialReasons = [];
  let logistical = 0;
  let commercial = 0;
  if (candidate.destination) {
    // A watched destination is a deliberate trip, not a long drive to price
    // out: a fixed planning cost and an honest label instead of the maximum.
    logistical = 2;
    logisticalReasons.push(`destination trip${candidate.destination.distanceLabel ? ` · ${candidate.destination.distanceLabel}` : ''}`);
  } else if (distanceMiles != null) {
    // Missing coordinates are uncertainty, not an invented travel penalty.
    logistical = Math.min(6, Math.round(distanceMiles / 12));
    if (distanceMiles >= 12) logisticalReasons.push(`${Math.round(distanceMiles)} mi from ${config.home.label}`);
  }
  if (candidate.timeTbd || candidate.dateTbd) {
    logistical += 2;
    logisticalReasons.push('time or date is TBD');
  }
  const lowestPrice = candidate.ticketObservation?.lowestPriceUsd;
  if (lowestPrice != null) {
    commercialReasons.push(`from $${lowestPrice}`);
    if (lowestPrice > config.maxTicketPriceUsd) {
      // Well past the budget is a different decision from just over it.
      commercial += lowestPrice > config.maxTicketPriceUsd * 1.5 ? 4 : 2;
      commercialReasons.push('above ticket budget');
    }
  }
  // Personal context is populated only by validated, repeated feedback. It is
  // deliberately capped and carried separately from verifiable event facts.
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
  const daysUntil = daysUntilEvent(startLocal, now);
  if (listingCount != null && listingCount <= 10) return 'buy now';
  if (daysUntil != null && daysUntil <= 3 && listingCount != null && listingCount <= 30) return 'buy now';
  if (daysUntil != null && daysUntil <= 7) return 'watch';
  // No inventory observation is not evidence that waiting is safe.
  if (listingCount == null) return 'unknown';
  return 'safe to wait';
}

function daysUntilEvent(startLocal, now) {
  return localDateDifference(startLocal, now);
}

function distanceBetween(home, venue) {
  if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return null;
  const radians = Math.PI / 180;
  const dLat = (venue.lat - home.lat) * radians;
  const dLon = (venue.lon - home.lon) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(home.lat * radians) * Math.cos(venue.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
