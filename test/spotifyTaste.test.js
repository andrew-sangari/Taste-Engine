import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtistSnapshot, fetchSpotifyPlaylistEvidence, fetchSpotifyTopArtistEvidence } from '../src/spotifyTaste.js';

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
  assert.equal(snapshot.artists[0].playlistDiversity, 3);
  assert.equal(snapshot.artists[0].trackCount, 6);
  assert.equal(snapshot.artists[0].seedStrength, 11.1972);
  assert.deepEqual(snapshot.artists[0].genres, ['house', 'tech house']);
  assert.deepEqual(snapshot.artists[0].sampleTracks, ['A', 'B']);
  assert.deepEqual(snapshot.warnings, ['example warning']);
});

test('fetches only enabled playlists with encoded query values', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url.toString());
    return new Response(JSON.stringify({ artists: [{ id: 'a', name: 'A', trackCount: 1 }], warnings: [] }));
  };

  const result = await fetchSpotifyPlaylistEvidence({
    playlistSyncBaseUrl: 'http://127.0.0.1:4317',
    maxTracksPerPlaylist: 250,
    playlists: [
      { id: 'id with spaces', name: 'Enabled', enabled: true, weight: 1 },
      { id: 'off', name: 'Disabled', enabled: false, weight: 1 }
    ]
  }, fetchImpl);

  assert.equal(result.evidence.length, 1);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /playlistId=id\+with\+spaces/);
  assert.match(seen[0], /limit=250/);
});

test('returns an actionable error when Playlist Sync is unavailable', async () => {
  await assert.rejects(
    () => fetchSpotifyPlaylistEvidence({
      playlistSyncBaseUrl: 'http://127.0.0.1:4317',
      maxTracksPerPlaylist: 250,
      playlists: [{ id: 'one', name: 'One', enabled: true, weight: 1 }]
    }, async () => { throw new Error('connection refused'); }),
    /Start it and connect Spotify first/
  );
});

test('preflights user-top-read and continues with playlist-only evidence when the scope is missing', async () => {
  const seen = [];
  const result = await fetchSpotifyTopArtistEvidence({ playlistSyncBaseUrl: 'http://127.0.0.1:4317' }, async (url) => {
    seen.push(url.pathname);
    return new Response(JSON.stringify({ spotifyAuth: { missingScopes: ['user-top-read'] } }));
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(seen.length, 1);
  assert.match(result.warnings[0], /Reconnect Spotify/);
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
