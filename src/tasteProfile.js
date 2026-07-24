import { normalizeArtistName } from './ranking.js';

// Builds the public taste profile block through explicit per-field
// construction. Nothing here may be object-spread from the private snapshot:
// playlist names/ids, sample tracks, raw evidence arrays, top-artist window
// ranks and weights, Spotify genres/popularity/followers, and Spotify artist
// ids all stay private. Tags come only from the Last.fm-derived taxonomy.
export function buildTasteProfile(expandedSnapshot, { feedbackState = null, topArtistLimit = 12 } = {}) {
  if (!expandedSnapshot || !Array.isArray(expandedSnapshot.artists)) return null;
  const artists = expandedSnapshot.artists;
  const maxSeedStrength = artists.reduce((max, artist) => Math.max(max, Number(artist.seedStrength) || 0), 0);
  const now = new Date(expandedSnapshot.generatedAt ?? Date.now());
  const signalRows = artists.map((artist) => ({
    artist,
    contribution: signalContribution(artist, maxSeedStrength, expandedSnapshot.topItems, now)
  })).filter((row) => row.contribution > 0);
  const maxContribution = Math.max(1, ...signalRows.map((row) => row.contribution));
  const topArtists = signalRows
    .sort((left, right) => right.contribution - left.contribution
      || normalizeArtistName(left.artist.name ?? '').localeCompare(normalizeArtistName(right.artist.name ?? '')))
    .slice(0, topArtistLimit)
    .map(({ artist, contribution }) => ({
      name: String(artist.name ?? ''),
      relativeSignal: Math.round((contribution / maxContribution) * 100),
      signalContribution: Math.round(contribution),
      playlistDiversity: safeCount(artist.playlistDiversity),
      seedTrackCount: safeCount(artist.trackCount),
      origin: publicOrigin(artist.origin),
      signalKind: directOrigin(artist.origin) ? 'direct' : 'inferred',
      evidenceLabels: coarseEvidenceLabels(artist)
    }));
  const expansionByOrigin = {};
  for (const artist of artists) {
    const origin = publicOrigin(artist.origin);
    expansionByOrigin[origin] = (expansionByOrigin[origin] ?? 0) + 1;
  }
  return {
    generatedAt: String(expandedSnapshot.generatedAt ?? ''),
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
  if (top?.shortTermRank != null && top.shortTermRank <= 10) labels.push('Current top artist');
  if (top?.mediumTermRank != null && top.mediumTermRank <= 25 && top?.longTermRank != null && top.longTermRank <= 25) labels.push('Sustained favorite');
  if (safeCount(artist.playlistDiversity) >= 2) labels.push('Playlist anchor');
  if (artist.origin === 'top-items' && !labels.length) labels.push('Spotify Top Artist');
  if (['similar', 'tag', 'promoter'].includes(artist.origin)) labels.push('Adjacent discovery');
  return labels;
}

function signalContribution(artist, maximumSeed, topItems, now) {
  const playlist = maximumSeed > 0 ? (Math.max(0, Number(artist.seedStrength) || 0) / maximumSeed) * 60 : 0;
  const top = topArtistContribution(artist.topEvidence, topItems, now);
  // Discovery strength is deliberately bounded below direct preference. It is
  // still visible and sortable, but cannot crowd out the direct taste seed.
  const inferred = directOrigin(artist.origin) ? 0 : Math.min(32, playlist * 0.55);
  return directOrigin(artist.origin) ? Math.max(playlist, top) : Math.max(inferred, top);
}

function topArtistContribution(evidence, topItems, now) {
  if (!evidence) return 0;
  const windows = [
    ['shortTerm', 0.40, evidence.shortTermRank],
    ['mediumTerm', 0.35, evidence.mediumTermRank],
    ['longTerm', 0.25, evidence.longTermRank]
  ].filter(([key]) => usableWindow(topItems?.windows?.[key], now));
  const total = windows.reduce((sum, [, weight]) => sum + weight, 0);
  if (!total) return 0;
  return windows.reduce((sum, [, weight, rank]) => sum + weight * rankContribution(rank), 0) / total;
}

function usableWindow(window, now) {
  if (!['fresh', 'cached', 'active', 'partial'].includes(window?.status)) return false;
  if (!window.expiresAt) return true;
  const expires = new Date(window.expiresAt).getTime();
  return Number.isFinite(expires) && expires > new Date(now).getTime();
}

function rankContribution(rank) {
  const value = Number(rank);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? 60 * (51 - value) / 50 : 0;
}

function directOrigin(origin) {
  return !['similar', 'tag', 'promoter'].includes(origin);
}

function publicOrigin(origin) {
  return ['source', 'similar', 'tag', 'promoter', 'top-items'].includes(origin) ? origin : 'source';
}

function publicFeedbackAggregates(feedbackState) {
  if (!feedbackState || typeof feedbackState !== 'object') return null;
  const outcomes = feedbackState.outcomesByStatus;
  if (!outcomes || typeof outcomes !== 'object') return null;
  const statusCounts = {};
  let attendedCount = 0;
  for (const [status, count] of Object.entries(outcomes)) {
    statusCounts[status] = safeCount(count);
    if (status.startsWith('attended-')) attendedCount += safeCount(count);
  }
  return { statusCounts, attendedCount };
}

function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}
