import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSpotifySeedConfig } from '../src/config.js';
import { createTokenStore, getSpotifyAuthStatus, getSpotifyPlaylistArtists, getSpotifyTopArtists, SPOTIFY_SCOPES } from '../src/spotifyClient.js';
import { buildArtistSnapshot, fetchSpotifyPlaylistEvidence, fetchSpotifyTopArtistEvidence } from '../src/spotifyTaste.js';
import { refreshTopArtists } from '../src/topArtists.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');

// Every dependency that would touch the real token, cache files or network
// is replaced; nothing in this file reads the project's data directory.
function playlistDeps(overrides = {}) {
  const written = [];
  return {
    written,
    deps: {
      getPlaylistArtists: async () => [],
      resolveTags: async () => ({ tags: new Map(), cache: {}, lookups: 0, provider: 'musicbrainz', warnings: [] }),
      readCache: () => ({}),
      writeCache: (path, cache) => { written.push({ path, cache }); },
      tagCachePath: '/unused/artist-tags.json',
      lastFmApiKey: null,
      now: NOW,
      ...overrides
    }
  };
}

test('combines playlist diversity and track evidence into an artist seed', () => {
  const snapshot = buildArtistSnapshot({
    evidence: [
      {
        playlist: { id: 'one', name: 'One', weight: 1 },
        artists: [{ id: 'artist-1', name: 'Artist One', trackCount: 4, genres: ['house'], sampleTracks: ['A'] }]
      },
      {
        playlist: { id: 'two', name: 'Two', weight: 2 },
        artists: [{ id: 'artist-1', name: 'Artist One', trackCount: 2, genres: ['tech house'], sampleTracks: ['B'] }]
      }
    ],
    warnings: ['example warning']
  }, '2026-07-10T00:00:00.000Z');

  assert.equal(snapshot.artistCount, 1);
  assert.equal(snapshot.source, 'spotify');
  assert.equal(snapshot.artists[0].playlistDiversity, 3);
  assert.equal(snapshot.artists[0].trackCount, 6);
  assert.equal(snapshot.artists[0].seedStrength, 11.1972);
  assert.deepEqual(snapshot.artists[0].genres, ['house', 'tech house']);
  assert.deepEqual(snapshot.artists[0].sampleTracks, ['A', 'B']);
  assert.deepEqual(snapshot.warnings, ['example warning']);
});

test('reads only enabled playlists from Spotify with the configured track limit', async () => {
  const seen = [];
  const { deps } = playlistDeps({
    getPlaylistArtists: async (playlistId, limit) => {
      seen.push([playlistId, limit]);
      return [{ id: 'a', name: 'A', genres: [], trackCount: 1, sampleTracks: ['Song'] }];
    }
  });

  const result = await fetchSpotifyPlaylistEvidence({
    maxTracksPerPlaylist: 250,
    playlists: [
      { id: 'id with spaces', name: 'Enabled', enabled: true, weight: 1 },
      { id: 'off', name: 'Disabled', enabled: false, weight: 1 }
    ]
  }, deps);

  assert.deepEqual(seen, [['id with spaces', 250]]);
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.evidence[0].playlist, { id: 'id with spaces', name: 'Enabled', enabled: true, weight: 1 });
  assert.deepEqual(result.warnings, []);
});

test('fills playlist artist genres from resolved tags merged with Spotify genres, in one tag pass', async () => {
  const tagCalls = [];
  const { deps, written } = playlistDeps({
    getPlaylistArtists: async (playlistId) => playlistId === 'one'
      ? [
        { id: 'a1', name: 'Minor Act', genres: [], trackCount: 1, sampleTracks: ['x'] },
        { id: 'a2', name: 'Major Act', genres: ['house'], trackCount: 5, sampleTracks: ['y'] }
      ]
      : [{ id: 'a2', name: 'Major Act', genres: ['house'], trackCount: 4, sampleTracks: ['z'] }, { id: 'a3', name: 'Untagged', genres: [], trackCount: 2, sampleTracks: [] }],
    readCache: (path) => ({ loadedFrom: path }),
    resolveTags: async (names, options) => {
      tagCalls.push({ names, options });
      return {
        tags: new Map([['major act', ['house', 'french house']], ['minor act', ['ambient']]]),
        cache: { updated: true },
        lookups: 2,
        provider: 'musicbrainz',
        warnings: ['No MusicBrainz tags for Untagged: busy']
      };
    }
  });

  const result = await fetchSpotifyPlaylistEvidence({
    maxTracksPerPlaylist: 500,
    playlists: [{ id: 'one', name: 'One', enabled: true, weight: 1 }, { id: 'two', name: 'Two', enabled: true, weight: 2 }]
  }, deps);

  assert.equal(tagCalls.length, 1);
  assert.deepEqual(tagCalls[0].names, ['Major Act', 'Untagged', 'Minor Act'], 'most-played artists are looked up first');
  assert.equal(tagCalls[0].options.lastFmApiKey, null);
  assert.equal(tagCalls[0].options.maxLookups, 200);
  assert.deepEqual(tagCalls[0].options.cache, { loadedFrom: '/unused/artist-tags.json' });
  assert.equal(tagCalls[0].options.now, NOW);

  const [one, two] = result.evidence;
  assert.deepEqual(one.artists[1], {
    id: 'a2', name: 'Major Act', genres: ['house', 'french house'], trackCount: 5, sampleTracks: ['y'], providerGenres: ['house', 'french house']
  });
  assert.deepEqual(one.artists[0].genres, ['ambient']);
  assert.deepEqual(two.artists[1].genres, []);
  assert.deepEqual(result.warnings, ['Artist tags: No MusicBrainz tags for Untagged: busy']);
  assert.deepEqual(written, [{ path: '/unused/artist-tags.json', cache: { updated: true } }]);
  assert.equal(result.tagProvider, 'musicbrainz');
  assert.equal(result.tagLookups, 2);

  const snapshot = buildArtistSnapshot({ evidence: result.evidence, warnings: result.warnings }, NOW);
  assert.deepEqual(snapshot.artists.find((artist) => artist.spotifyArtistId === 'a2').genres, ['french house', 'house']);
  assert.equal(snapshot.artists.find((artist) => artist.spotifyArtistId === 'a2').trackCount, 9);
});

test('uses Last.fm with a larger budget when a key is configured', async () => {
  let options;
  const { deps } = playlistDeps({
    lastFmApiKey: 'key-fixture',
    getPlaylistArtists: async () => [{ id: 'a', name: 'A', genres: [], trackCount: 1, sampleTracks: [] }],
    resolveTags: async (names, received) => {
      options = received;
      return { tags: new Map(), cache: {}, lookups: 0, provider: 'lastfm', warnings: [] };
    }
  });
  const result = await fetchSpotifyPlaylistEvidence({ maxTracksPerPlaylist: 10, playlists: [{ id: 'p', name: 'P', enabled: true, weight: 1 }] }, deps);
  assert.equal(options.lastFmApiKey, 'key-fixture');
  assert.equal(options.maxLookups, 2000);
  assert.equal(result.tagProvider, 'lastfm');
});

test('a tag provider or tag cache failure never blocks playlist evidence', async () => {
  const artists = [{ id: 'a', name: 'A', genres: ['pop'], trackCount: 1, sampleTracks: [] }];
  const config = { maxTracksPerPlaylist: 10, playlists: [{ id: 'p', name: 'P', enabled: true, weight: 1 }] };

  const broken = playlistDeps({ getPlaylistArtists: async () => artists, resolveTags: async () => { throw new Error('offline'); } });
  const first = await fetchSpotifyPlaylistEvidence(config, broken.deps);
  assert.deepEqual(first.evidence[0].artists[0].genres, ['pop']);
  assert.deepEqual(first.warnings, ['Artist tags: external artist tags unavailable: offline']);

  const unwritable = playlistDeps({
    getPlaylistArtists: async () => artists,
    resolveTags: async () => ({ tags: new Map([['a', ['indie']]]), cache: {}, lookups: 1, provider: 'musicbrainz', warnings: [] }),
    writeCache: () => { throw Object.assign(new Error('read-only'), { code: 'EROFS' }); }
  });
  const second = await fetchSpotifyPlaylistEvidence(config, unwritable.deps);
  assert.deepEqual(second.evidence[0].artists[0].genres, ['pop', 'indie']);
  assert.match(second.warnings[0], /tag cache could not be saved \(EROFS\)/);
});

test('returns an actionable error when Spotify is not connected or a playlist is unreadable', async () => {
  const config = { maxTracksPerPlaylist: 250, playlists: [{ id: 'one', name: 'One', enabled: true, weight: 1 }] };
  const disconnected = playlistDeps({
    getPlaylistArtists: async () => { throw Object.assign(new Error('Spotify is not connected.'), { statusCode: 401 }); }
  });
  await assert.rejects(() => fetchSpotifyPlaylistEvidence(config, disconnected.deps), /npm run spotify:connect/);

  const denied = playlistDeps({
    getPlaylistArtists: async () => { throw Object.assign(new Error('Spotify denied access to this playlist.'), { statusCode: 403 }); }
  });
  await assert.rejects(() => fetchSpotifyPlaylistEvidence(config, denied.deps), /Spotify could not read “One” \(403\)/);
});

test('preflights user-top-read and continues with playlist-only evidence when the scope is missing', async () => {
  let refreshed = 0;
  let removed = 0;
  const result = await fetchSpotifyTopArtistEvidence({}, {
    getAuthStatus: () => ({ connected: true, missingScopes: ['user-top-read'] }),
    refresh: async () => { refreshed += 1; },
    removeCache: () => { removed += 1; }
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(refreshed, 0);
  assert.equal(removed, 1, 'stale affinity data is not kept without the scope');
  assert.match(result.warnings[0], /Reconnect Spotify/);
  assert.deepEqual(result.artists, []);
  assert.equal(result.windows.shortTerm.status, 'unavailable');

  const snapshot = buildArtistSnapshot({
    evidence: [{ playlist: { id: 'p', name: 'P', weight: 1 }, artists: [{ id: 'a', name: 'A', trackCount: 1 }] }],
    topArtists: result
  });
  assert.equal(snapshot.artistCount, 1);
  assert.equal(snapshot.topArtistCount, 0);
});

test('a failed or unavailable Top Artists refresh never throws', async () => {
  const connected = () => ({ connected: true, missingScopes: [] });
  const thrown = await fetchSpotifyTopArtistEvidence({}, {
    getAuthStatus: connected,
    refresh: async () => { throw new Error('disk full'); },
    removeCache: () => assert.fail('cache must not be removed')
  });
  assert.equal(thrown.status, 'unavailable');
  assert.match(thrown.warnings[0], /could not be refreshed\. disk full/);

  const windows = {
    shortTerm: { status: 'unavailable', warning: 'x', fetchedAt: null, expiresAt: null },
    mediumTerm: { status: 'unavailable', warning: 'x', fetchedAt: null, expiresAt: null },
    longTerm: { status: 'unavailable', warning: 'x', fetchedAt: null, expiresAt: null }
  };
  const unavailable = await fetchSpotifyTopArtistEvidence({}, {
    getAuthStatus: connected,
    refresh: async () => ({ status: 'unavailable', generatedAt: NOW.toISOString(), windows, artists: [{ artistId: 'leak' }], warnings: ['first', 'second'] }),
    removeCache: () => {}
  });
  assert.deepEqual(unavailable.warnings, ['first']);
  assert.deepEqual(unavailable.artists, []);
  assert.equal(unavailable.windows, windows);

  const disconnected = await fetchSpotifyTopArtistEvidence({}, {
    getAuthStatus: () => ({ connected: false, missingScopes: [...SPOTIFY_SCOPES] }),
    refresh: async () => assert.fail('no refresh without a sign-in'),
    removeCache: () => {}
  });
  assert.equal(disconnected.status, 'unavailable');
});

test('passes a usable Top Artists result through with a bounded limit', async () => {
  let received;
  const body = {
    status: 'partial',
    generatedAt: NOW.toISOString(),
    windows: { shortTerm: { status: 'fresh' }, mediumTerm: { status: 'cached' }, longTerm: { status: 'unavailable' } },
    artists: [{ artistId: 'a', artistName: 'A', shortTermRank: 1, mediumTermRank: null, longTermRank: null }],
    warnings: ['long_term failed']
  };
  const result = await fetchSpotifyTopArtistEvidence({ limit: 500 }, {
    getAuthStatus: () => ({ connected: true, missingScopes: [] }),
    refresh: async (options) => { received = options; return body; },
    removeCache: () => {}
  });
  assert.deepEqual(received, { limit: 50 });
  assert.deepEqual(result, body);
});

test('merges Top Artists by Spotify ID and keeps raw ranks in the local snapshot only', () => {
  const snapshot = buildArtistSnapshot({
    evidence: [{ playlist: { id: 'playlist', name: 'Selected', weight: 1 }, artists: [{ id: 'spotify-1', name: 'Playlist Artist', trackCount: 4 }] }],
    topArtists: {
      status: 'active',
      generatedAt: '2026-07-11T00:00:00.000Z',
      windows: {
        shortTerm: { status: 'fresh', fetchedAt: '2026-07-11T00:00:00.000Z', expiresAt: '2026-07-18T00:00:00.000Z' },
        mediumTerm: { status: 'fresh', fetchedAt: '2026-07-11T00:00:00.000Z', expiresAt: '2026-07-18T00:00:00.000Z' },
        longTerm: { status: 'unavailable', fetchedAt: null, expiresAt: null }
      },
      artists: [
        { artistId: 'spotify-1', artistName: 'Playlist Artist', shortTermRank: 2, mediumTermRank: 20, longTermRank: null },
        { artistId: 'spotify-top-only', artistName: 'Top Only', shortTermRank: 4, mediumTermRank: null, longTermRank: null }
      ],
      warnings: []
    }
  });
  assert.equal(snapshot.artistCount, 2);
  assert.equal(snapshot.topArtistCount, 2);
  assert.deepEqual(snapshot.artists.find((artist) => artist.spotifyArtistId === 'spotify-top-only').topEvidence, { shortTermRank: 4, mediumTermRank: null, longTermRank: null });
  assert.equal(snapshot.topItems.windows.shortTerm.status, 'fresh');
});

test('the whole native seed path runs against Spotify and MusicBrainz fixtures with no other service', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-seed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const nowMs = NOW.getTime();
  const tokenStore = createTokenStore(join(dir, 'spotify-token.json'));
  tokenStore.write({ accessToken: 'access-fixture', refreshToken: 'refresh-fixture', expiresAt: nowMs + 3600_000, scope: SPOTIFY_SCOPES.join(' ') }, NOW);
  const hosts = new Set();
  const fetchImpl = async (url) => {
    const target = new URL(String(url));
    hosts.add(target.host);
    const reply = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (target.host === 'musicbrainz.org') {
      return reply({ artists: [{ score: 100, name: 'Seed Artist', tags: [{ count: 3, name: 'House' }, { count: 9, name: 'Electronic' }] }] });
    }
    if (target.pathname === '/v1/playlists/playlist-1/items') {
      return reply({ next: null, items: [{ track: { id: 't1', name: 'Track', type: 'track', artists: [{ id: 'sp-1', name: 'Seed Artist' }] } }] });
    }
    if (target.pathname === '/v1/artists') return reply({ artists: [{ id: 'sp-1', genres: [] }] });
    if (target.pathname === '/v1/me/top/artists') {
      return target.searchParams.get('time_range') === 'long_term'
        ? new Response('{}', { status: 500 })
        : reply({ items: [{ id: 'sp-1', name: 'Seed Artist' }, { id: 'sp-2', name: 'Top Only' }] });
    }
    throw new Error(`Unexpected request in test: ${target.host}${target.pathname}`);
  };
  const spotify = { fetchImpl, tokenStore, now: () => nowMs };
  const tagCachePath = join(dir, 'artist-tags.json');
  const config = normalizeSpotifySeedConfig({
    playlistSyncBaseUrl: 'http://127.0.0.1:4317',
    playlists: [{ id: 'playlist-1', name: 'Selected' }]
  });
  assert.equal('playlistSyncBaseUrl' in config, false);

  const playlists = await fetchSpotifyPlaylistEvidence(config, {
    getPlaylistArtists: (playlistId, limit) => getSpotifyPlaylistArtists(playlistId, limit, spotify),
    resolveTags: (names, options) => import('../src/artistTags.js').then(({ resolveArtistTags }) => resolveArtistTags(names, { ...options, fetchImpl, sleep: async () => {} })),
    tagCachePath,
    lastFmApiKey: null,
    now: NOW
  });
  const topArtists = await fetchSpotifyTopArtistEvidence(config, {
    getAuthStatus: () => getSpotifyAuthStatus({ tokenStore, now: () => nowMs }),
    refresh: (options) => refreshTopArtists({ ...options, now: NOW, cachePath: join(dir, 'top-artists.json'), fetchWindow: (range, limit) => getSpotifyTopArtists(range, limit, spotify) }),
    removeCache: () => assert.fail('cache must not be removed')
  });
  const snapshot = buildArtistSnapshot({ evidence: playlists.evidence, warnings: playlists.warnings, topArtists }, NOW);

  assert.deepEqual([...hosts].sort(), ['api.spotify.com', 'musicbrainz.org']);
  assert.equal(snapshot.playlistCount, 1);
  assert.equal(snapshot.artistCount, 2);
  assert.equal(snapshot.topItems.status, 'partial');
  assert.equal(snapshot.topItems.windows.longTerm.status, 'unavailable');
  const seed = snapshot.artists.find((artist) => artist.spotifyArtistId === 'sp-1');
  assert.deepEqual(seed.genres, ['electronic', 'house']);
  assert.deepEqual(seed.topEvidence, { shortTermRank: 1, mediumTermRank: 1, longTermRank: null });
  assert.equal(snapshot.artists.find((artist) => artist.spotifyArtistId === 'sp-2').origin, 'top-items');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(tagCachePath, 'utf8'))), ['seed artist']);
});

test('the seed path no longer references Playlist Sync', () => {
  for (const file of ['../src/spotifyTaste.js', '../src/cli/spotify-seed.js', '../src/topArtists.js', '../src/artistTags.js', '../config/spotify-playlists.example.json']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /playlist[\s-]?sync|playlistSync|4317/i, file);
  }
});
