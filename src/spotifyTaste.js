export async function fetchSpotifyPlaylistEvidence(config, fetchImpl = fetch) {
  const evidence = [];
  const warnings = [];

  for (const playlist of config.playlists.filter((item) => item.enabled)) {
    const url = new URL('/api/spotify/playlist-artists', `${config.playlistSyncBaseUrl}/`);
    url.searchParams.set('playlistId', playlist.id);
    url.searchParams.set('limit', String(config.maxTracksPerPlaylist));

    let response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      throw new Error(`Could not reach Playlist Sync at ${config.playlistSyncBaseUrl}. Start it and connect Spotify first. ${error.message}`);
    }

    if (!response.ok) {
      const detail = await safeResponseText(response);
      throw new Error(`Playlist Sync could not read “${playlist.name}” (${response.status}).${detail ? ` ${detail}` : ''}`);
    }

    const body = await response.json();
    evidence.push({ playlist, artists: Array.isArray(body.artists) ? body.artists : [] });
    warnings.push(...(Array.isArray(body.warnings) ? body.warnings.map((warning) => `${playlist.name}: ${warning}`) : []));
  }

  return { evidence, warnings };
}

export async function fetchSpotifyTopArtistEvidence({ playlistSyncBaseUrl, limit = 50 }, fetchImpl = fetch) {
  // Preflight the scope before spending time on three Top Artists calls. This
  // keeps scheduled refreshes non-interactive when the existing token predates
  // user-top-read; the playlist lane remains usable immediately.
  try {
    const statusUrl = new URL('/api/status', `${playlistSyncBaseUrl}/`);
    const statusResponse = await fetchImpl(statusUrl);
    if (statusResponse.ok) {
      const status = await statusResponse.json().catch(() => ({}));
      const missingScopes = status.spotifyAuth?.missingScopes ?? [];
      if (missingScopes.includes('user-top-read')) {
        return unavailableTopArtists('Spotify Top Artists scope is missing. Reconnect Spotify in Playlist Sync; continuing with playlist-only evidence.');
      }
    }
  } catch {
    // A status preflight failure is not itself a reason to discard the lane;
    // the endpoint below still provides the authoritative source response.
  }

  const url = new URL('/api/spotify/top-artists', `${playlistSyncBaseUrl}/`);
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, Number(limit) || 50))));
  try {
    const response = await fetchImpl(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return unavailableTopArtists(body.error || `Playlist Sync Top Artists request failed (${response.status}).`, body.details?.windows ?? body.windows);
    }
    return {
      status: body.status ?? 'unavailable',
      generatedAt: body.generatedAt ?? new Date().toISOString(),
      windows: body.windows ?? emptyTopWindows(),
      artists: Array.isArray(body.artists) ? body.artists : [],
      warnings: Array.isArray(body.warnings) ? body.warnings : []
    };
  } catch (error) {
    return unavailableTopArtists(`Could not reach Playlist Sync Top Artists endpoint. ${error.message}`);
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
    source: 'playlist-sync',
    playlistCount: evidence.length,
    sourceArtistCount: normalizedArtists.filter((artist) => artist.evidence.length > 0).length,
    topArtistCount: normalizedArtists.filter((artist) => artist.topEvidence).length,
    artistCount: normalizedArtists.length,
    warnings: [...new Set(combinedWarnings)],
    topItems,
    artists: normalizedArtists
  };
}

async function safeResponseText(response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
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
