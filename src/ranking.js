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

  return candidates.map((candidate) => {
    const matches = candidate.performers.map((performer) => ({
      performer,
        artist: bySeatGeekId.get(String(performer.sourceId))
        ?? (performer.spotifyId ? bySpotifyId.get(performer.spotifyId) : null)
        ?? uniqueNameMatch(byNormalizedName.get(normalizeArtistName(performer.name)))
    })).filter((match) => match.artist);

    const excluded = candidate.performers.some((performer) => excludedArtists.has(normalizeArtistName(performer.name)))
      || excludedVenues.has(normalizeArtistName(candidate.venue.name));
    const scoredMatches = matches.map((match) => {
      const playlistAffinity = playlistAffinityFor(match.artist, maximumSeedStrength);
      const topAffinity = topItemsAffinityFor(match.artist, artistSnapshot.topItems, now);
      const corroborationBonus = playlistAffinity > 0 && topAffinity > 0
        ? Math.min(6, Math.round(Math.min(playlistAffinity, topAffinity) * 0.10))
        : 0;
      const directAffinity = Math.min(60, Math.max(playlistAffinity, topAffinity) + corroborationBonus);
      return { ...match, playlistAffinity, topAffinity, corroborationBonus, directAffinity };
    });
    const strongestMatch = scoredMatches.sort((a, b) => b.directAffinity - a.directAffinity || b.artist.seedStrength - a.artist.seedStrength)[0];
    const artistFit = strongestMatch?.directAffinity ?? 0;
    const pinnedBonus = candidate.performers.some((performer) => pinned.has(normalizeArtistName(performer.name))) ? 15 : 0;
    const distanceMiles = distanceBetween(config.home, candidate.venue);
    const hassleScore = calculateHassle(candidate, config, distanceMiles);
    const urgency = ticketUrgency(candidate.ticketObservation, candidate.startLocal, now);
    const utility = excluded ? -100 : artistFit + pinnedBonus - hassleScore * 2;
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
        excluded,
        artistFit,
        playlistAffinity: strongestMatch?.playlistAffinity ?? 0,
        topItemsAffinity: strongestMatch?.topAffinity ?? 0,
        corroborationBonus: strongestMatch?.corroborationBonus ?? 0,
        directAffinity: artistFit,
        pinnedBonus,
        hassleScore,
        hassleReasons: hassleReasons(candidate, config, distanceMiles),
        utility,
        confidence,
        urgency,
        whyYou: strongestMatch
          ? whyYouReason(strongestMatch.artist, candidate, artistSnapshot.topItems, now)
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

function whyYouReason(artist, candidate = {}, topItems = {}, now = new Date()) {
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
    return `${artist.name} is a strong signal in ${count} selected playlist${count === 1 ? '' : 's'}.`;
  }
  const similar = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === 'lastfm-similar');
  if (similar) return `${artist.name} is a Last.fm neighbor of ${similar.sourceArtist}, one of your stronger playlist signals.`;
  const tag = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === 'lastfm-tag');
  if (tag) return `${artist.name} ranks within your recurring “${tag.tag}” taste cluster.`;
  const frameworkRoster = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === 'framework-roster');
  if (frameworkRoster) {
    const providers = listingProviders(candidate);
    return providers.length
      ? `${artist.name} is in the Framework artist roster; this listing comes from ${providers.join(' + ')}.`
      : `${artist.name} is in the Framework artist roster.`;
  }
  const promoter = (artist.discoveryEvidence ?? []).find((evidence) => evidence.type === 'promoter-event' || evidence.type === 'promoter');
  if (promoter) return `${artist.name} is here because you explicitly follow ${promoter.promoter}'s calendar.`;
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

function calculateHassle(candidate, config, distanceMiles) {
  let score = distanceMiles == null ? 5 : Math.min(7, Math.round(distanceMiles / 10));
  const lowestPrice = candidate.ticketObservation.lowestPriceUsd;
  if (lowestPrice != null && lowestPrice > config.maxTicketPriceUsd) score += 2;
  if (candidate.timeTbd || candidate.dateTbd) score += 2;
  return Math.min(10, score);
}

function hassleReasons(candidate, config, distanceMiles) {
  const reasons = [];
  if (distanceMiles != null) reasons.push(`${Math.round(distanceMiles)} mi from ${config.home.label}`);
  if (candidate.ticketObservation.lowestPriceUsd != null) reasons.push(`from $${candidate.ticketObservation.lowestPriceUsd}`);
  if (candidate.ticketObservation.lowestPriceUsd != null && candidate.ticketObservation.lowestPriceUsd > config.maxTicketPriceUsd) reasons.push('above ticket budget');
  if (candidate.timeTbd || candidate.dateTbd) reasons.push('time or date is TBD');
  return reasons;
}

function ticketUrgency(ticketObservation, startLocal, now) {
  const listingCount = ticketObservation.listingCount;
  const daysUntil = daysUntilEvent(startLocal, now);
  if (listingCount != null && listingCount <= 10) return 'buy now';
  if (daysUntil != null && daysUntil <= 3 && listingCount != null && listingCount <= 30) return 'buy now';
  if (daysUntil != null && daysUntil <= 7) return 'watch';
  return 'safe to wait';
}

function daysUntilEvent(startLocal, now) {
  if (!startLocal) return null;
  const start = new Date(startLocal);
  if (Number.isNaN(start.getTime())) return null;
  return Math.ceil((start.getTime() - now.getTime()) / 86_400_000);
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
