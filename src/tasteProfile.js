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
  const topArtists = [...artists]
    .filter((artist) => (Number(artist.seedStrength) || 0) > 0)
    .sort((left, right) => (Number(right.seedStrength) || 0) - (Number(left.seedStrength) || 0)
      || normalizeArtistName(left.name ?? '').localeCompare(normalizeArtistName(right.name ?? '')))
    .slice(0, topArtistLimit)
    .map((artist) => ({
      name: String(artist.name ?? ''),
      relativeSignal: maxSeedStrength > 0 ? Math.round(((Number(artist.seedStrength) || 0) / maxSeedStrength) * 100) : 0,
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
  if (['similar', 'tag', 'promoter'].includes(artist.origin)) labels.push('Adjacent discovery');
  return labels;
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
