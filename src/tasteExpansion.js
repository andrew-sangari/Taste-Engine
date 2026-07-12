import { getSimilarArtists, getTopArtistsForTag } from './lastfm.js';
import { normalizeArtistName } from './ranking.js';

const NOISY_TAGS = new Set([
  'albums i own', 'awesome', 'favorite', 'favorites', 'female vocalists', 'male vocalists',
  'seen live', 'spotify', 'under 2000 listeners', 'under 5000 listeners'
]);

export function topRecurringTags(snapshot, limit = 5) {
  const totals = new Map();
  for (const artist of snapshot.artists ?? []) {
    if (!artist.evidence?.length) continue;
    const weight = Math.max(0.1, Number(artist.seedStrength) || 0.1);
    for (const rawTag of new Set(artist.genres ?? [])) {
      const tag = normalizeArtistName(rawTag);
      if (!tag || NOISY_TAGS.has(tag)) continue;
      totals.set(tag, (totals.get(tag) ?? 0) + weight);
    }
  }
  return [...totals.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function buildExpandedArtistSnapshot(snapshot, config, {
  apiKey,
  fetchImpl = fetch,
  generatedAt = new Date()
} = {}) {
  if (!apiKey) throw new Error('Set LASTFM_API_KEY before expanding taste signals.');
  const sourceArtists = [...(snapshot.artists ?? [])].sort((a, b) => b.seedStrength - a.seedStrength);
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
    origin: artist.origin === 'top-items' ? 'top-items' : 'source',
    discoveryEvidence: [...(artist.discoveryEvidence ?? [])]
  }]));

  for (const { artist, results } of similarResults) {
    for (const result of results) {
      const strength = round(artist.seedStrength * result.match * 0.55, 4);
      mergeDiscovery(artists, result.name, strength, {
        type: 'lastfm-similar',
        sourceArtist: artist.name,
        match: result.match
      });
    }
  }

  const strongestTag = Math.max(1, ...topTags.map((tag) => tag.weight));
  for (const { tag, results } of tagResults) {
    for (const result of results) {
      const rankDecay = Math.max(0.2, 1 - ((result.rank - 1) / Math.max(1, config.lastFmArtistsPerTag)));
      const strength = round(maximumSeed * 0.35 * (tag.weight / strongestTag) * rankDecay, 4);
      mergeDiscovery(artists, result.name, strength, {
        type: 'lastfm-tag',
        tag: tag.name,
        rank: result.rank
      });
    }
  }

  const expandedArtists = [...artists.values()]
    .map(finalizeArtist)
    .sort((a, b) => b.seedStrength - a.seedStrength || a.name.localeCompare(b.name));
  return {
    version: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    source: 'playlist-sync+lastfm',
    sourceGeneratedAt: snapshot.generatedAt,
    playlistCount: snapshot.playlistCount,
    sourceArtistCount: snapshot.sourceArtistCount ?? sourceArtists.filter((artist) => artist.evidence?.length).length,
    topArtistCount: snapshot.topArtistCount ?? sourceArtists.filter((artist) => artist.topEvidence).length,
    artistCount: expandedArtists.length,
    topTags: topTags.map(({ name }) => name),
    warnings: [...(snapshot.warnings ?? []), ...allCalls.filter((item) => item.warning).map((item) => item.warning)],
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
  if (current?.origin === 'source') {
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
      origin: evidence.type === 'lastfm-similar' ? 'similar' : 'tag',
      discoveryEvidence: [evidence]
    });
    return;
  }
  if (current.origin === 'top-items') {
    current.discoveryEvidence.push(evidence);
    return;
  }
  current.seedStrength = round(Math.max(current.seedStrength, strength) + Math.min(current.seedStrength, strength) * 0.15, 4);
  current.discoveryEvidence.push(evidence);
  if (evidence.type === 'lastfm-similar') current.origin = 'similar';
  if (evidence.tag && !current.genres.includes(evidence.tag)) current.genres.push(evidence.tag);
}

function finalizeArtist(artist) {
  const discoveryEvidence = [...artist.discoveryEvidence]
    .sort((a, b) => (b.match ?? 0) - (a.match ?? 0) || (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, 8);
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
