import { artistTagKey, resolveArtistTags } from './artistTags.js';
import { readTagCache, writeTagCache } from './artistTagsCache.js';
import { getSpotifyAuthStatus, getSpotifyPlaylistArtists } from './spotifyClient.js';
import { refreshTopArtists, removeTopArtistsCache } from './topArtists.js';

// MusicBrainz is limited to one request per second, so its per-run budget is
// small and the persistent cache fills over a few runs. Last.fm has no such
// limit and is looked up in full, as before.
const MUSICBRAINZ_LOOKUPS_PER_RUN = 200;
const LASTFM_LOOKUPS_PER_RUN = 2000;

export async function fetchSpotifyPlaylistEvidence(config, deps = {}) {
  const {
    getPlaylistArtists = getSpotifyPlaylistArtists,
    resolveTags = resolveArtistTags,
    readCache = readTagCache,
    writeCache = writeTagCache,
    tagCachePath = undefined,
    lastFmApiKey = process.env.LASTFM_API_KEY || null,
    maxTagLookups = lastFmApiKey ? LASTFM_LOOKUPS_PER_RUN : MUSICBRAINZ_LOOKUPS_PER_RUN,
    now = new Date()
  } = deps;
  const evidence = [];
  const warnings = [];

  for (const playlist of config.playlists.filter((item) => item.enabled)) {
    let artists;
    try {
      artists = await getPlaylistArtists(playlist.id, config.maxTracksPerPlaylist);
    } catch (error) {
      if (Number(error?.statusCode) === 401) {
        throw new Error(/spotify:connect/.test(error.message) ? error.message : `Spotify is not connected. Run \`npm run spotify:connect\` first. ${error.message}`);
      }
      throw new Error(`Spotify could not read “${playlist.name}”${error?.statusCode ? ` (${error.statusCode})` : ''}. ${error.message}`);
    }
    evidence.push({ playlist, artists: Array.isArray(artists) ? artists : [] });
  }

  // One tag pass for every playlist, most-played artists first so a limited
  // lookup budget is spent where it matters.
  const trackCounts = new Map();
  for (const { artists } of evidence) {
    for (const artist of artists) {
      const name = String(artist?.name ?? '').trim();
      if (name) trackCounts.set(name, (trackCounts.get(name) ?? 0) + (Number(artist.trackCount) || 0));
    }
  }
  const names = [...trackCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);

  let tags = new Map();
  let tagProvider = lastFmApiKey ? 'lastfm' : 'musicbrainz';
  let tagLookups = 0;
  try {
    const result = await resolveTags(names, { lastFmApiKey, cache: readCache(tagCachePath), now, maxLookups: maxTagLookups });
    tags = result.tags;
    tagProvider = result.provider;
    tagLookups = result.lookups;
    warnings.push(...result.warnings.map((warning) => `Artist tags: ${warning}`));
    if (result.lookups > 0) {
      try {
        writeCache(tagCachePath, result.cache);
      } catch (error) {
        warnings.push(`Artist tags: the tag cache could not be saved (${error.code ?? error.message}).`);
      }
    }
  } catch (error) {
    warnings.push(`Artist tags: external artist tags unavailable: ${error.message}`);
  }

  for (const item of evidence) {
    item.artists = item.artists.map((artist) => {
      const providerGenres = tags.get(artistTagKey(artist?.name)) ?? [];
      return {
        ...artist,
        providerGenres,
        genres: [...new Set([...(artist.genres ?? []), ...providerGenres])]
      };
    });
  }

  return { evidence, warnings, tagProvider, tagLookups };
}

export async function fetchSpotifyTopArtistEvidence(config = {}, deps = {}) {
  const {
    getAuthStatus = getSpotifyAuthStatus,
    refresh = refreshTopArtists,
    removeCache = removeTopArtistsCache
  } = deps;
  const limit = Math.min(50, Math.max(1, Number(config?.limit) || 50));

  // Preflight the scope before spending time on three Top Artists calls. A
  // token that predates user-top-read must not keep serving stale affinity
  // data, and must never block the playlist lane.
  try {
    const auth = getAuthStatus();
    if (!auth.connected) {
      return unavailableTopArtists('Spotify is not connected. Run `npm run spotify:connect`; continuing without Top Artists.');
    }
    if (auth.missingScopes.includes('user-top-read')) {
      try { removeCache(); } catch { /* replaceable cache */ }
      return unavailableTopArtists('Spotify Top Artists scope (user-top-read) is missing. Reconnect Spotify with `npm run spotify:connect`; continuing with playlist-only evidence.');
    }
  } catch {
    // An unreadable status is not itself a reason to discard the lane; the
    // refresh below reports the authoritative result.
  }

  try {
    const result = await refresh({ limit });
    if (result.status === 'unavailable') {
      return unavailableTopArtists(result.warnings?.[0] || 'Spotify Top Artists are unavailable.', result.windows);
    }
    return {
      status: result.status ?? 'unavailable',
      generatedAt: result.generatedAt ?? new Date().toISOString(),
      windows: result.windows ?? emptyTopWindows(),
      artists: Array.isArray(result.artists) ? result.artists : [],
      warnings: Array.isArray(result.warnings) ? result.warnings : []
    };
  } catch (error) {
    return unavailableTopArtists(`Spotify Top Artists could not be refreshed. ${error.message}`);
  }
}

function unavailableTopArtists(warning, windows = null) {
  return {
    status: 'unavailable',
    generatedAt: new Date().toISOString(),
    windows: windows ?? emptyTopWindows(),
    artists: [],
    warnings: [warning]
  };
}

export function emptyTopWindows() {
  return {
    shortTerm: { status: 'unavailable', warning: null, fetchedAt: null, expiresAt: null },
    mediumTerm: { status: 'unavailable', warning: null, fetchedAt: null, expiresAt: null },
    longTerm: { status: 'unavailable', warning: null, fetchedAt: null, expiresAt: null }
  };
}

export function buildArtistSnapshot({ evidence, warnings = [], topArtists = null }, generatedAt = new Date()) {
  const artists = new Map();

  for (const { playlist, artists: playlistArtists } of evidence) {
    for (const artist of playlistArtists) {
      const spotifyArtistId = String(artist.id ?? '').trim();
      const name = String(artist.name ?? '').trim();
      if (!spotifyArtistId || !name) continue;

      const current = artists.get(spotifyArtistId) ?? {
        spotifyArtistId,
        name,
        genres: new Set(),
        playlistDiversity: 0,
        weightedTrackCount: 0,
        trackCount: 0,
        sampleTracks: new Set(),
        evidence: []
      };

      const trackCount = nonNegativeNumber(artist.trackCount);
      current.playlistDiversity += playlist.weight;
      current.weightedTrackCount += trackCount * playlist.weight;
      current.trackCount += trackCount;
      for (const genre of artist.genres ?? []) if (genre) current.genres.add(String(genre));
      for (const track of artist.sampleTracks ?? []) if (track) current.sampleTracks.add(String(track));
      current.evidence.push({
        playlistId: playlist.id,
        playlistName: playlist.name,
        weight: playlist.weight,
        trackCount
      });
      artists.set(spotifyArtistId, current);
    }
  }

  for (const topArtist of topArtists?.artists ?? []) {
    const spotifyArtistId = String(topArtist.artistId ?? topArtist.id ?? '').trim();
    const name = String(topArtist.artistName ?? topArtist.name ?? '').trim();
    if (!spotifyArtistId || !name) continue;
    const current = artists.get(spotifyArtistId) ?? {
      spotifyArtistId,
      name,
      genres: new Set(),
      playlistDiversity: 0,
      weightedTrackCount: 0,
      trackCount: 0,
      sampleTracks: new Set(),
      evidence: [],
      origin: 'top-items',
      discoveryEvidence: [{ type: 'spotify-top-items' }]
    };
    current.topEvidence = {
      shortTermRank: integerOrNull(topArtist.shortTermRank),
      mediumTermRank: integerOrNull(topArtist.mediumTermRank),
      longTermRank: integerOrNull(topArtist.longTermRank)
    };
    artists.set(spotifyArtistId, current);
  }

  const normalizedArtists = [...artists.values()].map((artist) => ({
    spotifyArtistId: artist.spotifyArtistId,
    name: artist.name,
    seedStrength: round(3 * artist.playlistDiversity + Math.log1p(artist.weightedTrackCount), 4),
    playlistDiversity: round(artist.playlistDiversity, 4),
    trackCount: artist.trackCount,
    genres: [...artist.genres].sort((a, b) => a.localeCompare(b)),
    sampleTracks: [...artist.sampleTracks].slice(0, 6),
    evidence: artist.evidence.sort((a, b) => b.weight - a.weight || b.trackCount - a.trackCount),
    aliases: [...new Set(artist.aliases ?? [])],
    origin: artist.origin ?? 'source',
    discoveryEvidence: artist.discoveryEvidence ?? [],
    ...(artist.topEvidence ? { topEvidence: artist.topEvidence } : {})
  })).sort((a, b) => b.seedStrength - a.seedStrength || a.name.localeCompare(b.name));

  const topItems = {
    status: topArtists?.status ?? 'unavailable',
    generatedAt: topArtists?.generatedAt ?? null,
    windows: topArtists?.windows ?? emptyTopWindows(),
    warnings: topArtists?.warnings ?? []
  };
  const combinedWarnings = [...warnings, ...topItems.warnings.map((warning) => `Top Artists: ${warning}`)];

  return {
    version: 2,
    generatedAt: new Date(generatedAt).toISOString(),
    source: 'spotify',
    playlistCount: evidence.length,
    sourceArtistCount: normalizedArtists.filter((artist) => artist.evidence.length > 0).length,
    topArtistCount: normalizedArtists.filter((artist) => artist.topEvidence).length,
    artistCount: normalizedArtists.length,
    warnings: [...new Set(combinedWarnings)],
    topItems,
    artists: normalizedArtists
  };
}

function nonNegativeNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
