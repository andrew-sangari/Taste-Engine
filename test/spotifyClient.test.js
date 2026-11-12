import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAuthorizationRequest,
  createTokenStore,
  DEFAULT_REDIRECT_URI,
  disconnectSpotify,
  exchangeAuthorizationCode,
  getSpotifyAuthStatus,
  getSpotifyPlaylistArtists,
  getSpotifyTopArtists,
  importPlaylistSyncToken,
  listSpotifyPlaylists,
  nextPagePath,
  playlistItemTrack,
  resolveSpotifyStateDir,
  SPOTIFY_SCOPES,
  spotifyApi,
  spotifyRedirectUri
} from '../src/spotifyClient.js';
import { runSpotifyConnect } from '../src/cli/spotify-connect.js';

const NOW_MS = Date.parse('2026-11-11T12:00:00.000Z');
const now = () => NOW_MS;
const ALL_SCOPES = SPOTIFY_SCOPES.join(' ');

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'taste-spotify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, tokenStore: createTokenStore(join(dir, 'spotify-token.json')) };
}

function connected(t, overrides = {}) {
  const space = workspace(t);
  space.tokenStore.write({
    accessToken: 'access-fixture',
    refreshToken: 'refresh-fixture',
    expiresAt: NOW_MS + 3600_000,
    scope: ALL_SCOPES,
    ...overrides
  }, new Date(NOW_MS));
  return space;
}

function json(body, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function router(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, init });
    for (const [prefix, handler] of routes) {
      if (href.startsWith(prefix)) return handler(href, init, calls.length);
    }
    throw new Error(`Unexpected request in test: ${href}`);
  };
  return { calls, fetchImpl };
}

test('requests read-only scopes only', () => {
  assert.deepEqual([...SPOTIFY_SCOPES], ['playlist-read-private', 'playlist-read-collaborative', 'user-top-read']);
  assert.ok(SPOTIFY_SCOPES.every((scope) => !scope.includes('modify')));
});

test('builds a PKCE authorization request', () => {
  const request = createAuthorizationRequest({ clientId: 'client-fixture', redirectUri: DEFAULT_REDIRECT_URI });
  const url = new URL(request.url);

  assert.equal(`${url.origin}${url.pathname}`, 'https://accounts.spotify.com/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-fixture');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:4317/auth/spotify/callback');
  assert.equal(url.searchParams.get('scope'), 'playlist-read-private playlist-read-collaborative user-top-read');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(request.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('state'), request.state);
  assert.match(request.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(createAuthorizationRequest({ clientId: 'client-fixture' }).state, request.state);
  assert.throws(() => createAuthorizationRequest({ clientId: '' }), /SPOTIFY_CLIENT_ID/);
});

test('redirect URI defaults to the registered loopback address and can be overridden', () => {
  assert.equal(spotifyRedirectUri({}), 'http://127.0.0.1:4317/auth/spotify/callback');
  assert.equal(spotifyRedirectUri({ SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:5000/cb' }), 'http://127.0.0.1:5000/cb');
});

test('exchanges the code, stores the token with mode 0600, and never returns token values', async (t) => {
  const { tokenStore } = workspace(t);
  const { calls, fetchImpl } = router([
    ['https://accounts.spotify.com/api/token', () => json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, scope: ALL_SCOPES })]
  ]);
  const status = await exchangeAuthorizationCode({
    code: 'code-fixture', verifier: 'verifier-fixture', clientId: 'client-fixture', redirectUri: DEFAULT_REDIRECT_URI, fetchImpl, tokenStore, now
  });

  const body = calls[0].init.body;
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'code-fixture');
  assert.equal(body.get('code_verifier'), 'verifier-fixture');
  assert.equal(body.get('client_id'), 'client-fixture');
  assert.equal(body.get('redirect_uri'), DEFAULT_REDIRECT_URI);
  assert.equal(body.get('client_secret'), null);
  assert.ok(calls[0].init.signal instanceof AbortSignal);

  assert.deepEqual(status, {
    connected: true,
    grantedScopes: [...SPOTIFY_SCOPES],
    missingScopes: [],
    tokenExpiresAt: new Date(NOW_MS + 3600_000).toISOString(),
    tokenUpdatedAt: new Date(NOW_MS).toISOString()
  });
  assert.doesNotMatch(JSON.stringify(status), /secret/);
  assert.equal(statSync(tokenStore.path).mode & 0o777, 0o600);
  assert.equal(tokenStore.read().refreshToken, 'refresh-secret');
});

test('auth status reports a missing sign-in and missing scopes without token values', (t) => {
  const { tokenStore } = workspace(t);
  assert.deepEqual(getSpotifyAuthStatus({ tokenStore, now }), {
    connected: false, grantedScopes: [], missingScopes: [...SPOTIFY_SCOPES], tokenExpiresAt: null, tokenUpdatedAt: null
  });

  tokenStore.write({ accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: NOW_MS - 1, scope: 'playlist-read-private playlist-read-collaborative' }, new Date(NOW_MS));
  const status = getSpotifyAuthStatus({ tokenStore, now });
  assert.equal(status.connected, true, 'an expired access token with a refresh token is still connected');
  assert.deepEqual(status.missingScopes, ['user-top-read']);
  assert.deepEqual(Object.keys(status), ['connected', 'grantedScopes', 'missingScopes', 'tokenExpiresAt', 'tokenUpdatedAt']);
  assert.doesNotMatch(JSON.stringify(status), /secret/);

  tokenStore.write({ accessToken: 'access-secret', refreshToken: null, expiresAt: NOW_MS - 1, scope: ALL_SCOPES }, new Date(NOW_MS));
  assert.equal(getSpotifyAuthStatus({ tokenStore, now }).connected, false);
});

test('spotifyApi sends the bearer token with a timeout signal and returns JSON', async (t) => {
  const { tokenStore } = connected(t);
  const { calls, fetchImpl } = router([['https://api.spotify.com/v1/me', () => json({ id: 'user' })]]);

  assert.deepEqual(await spotifyApi('/me', { fetchImpl, tokenStore, now }), { id: 'user' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, 'Bearer access-fixture');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.method, undefined, 'the client only issues GET requests');
});

test('spotifyApi errors carry statusCode', async (t) => {
  const { tokenStore } = connected(t);
  const denied = router([['https://api.spotify.com/v1/', () => json({ error: { status: 403, message: 'Forbidden' } }, 403)]]);
  await assert.rejects(
    () => spotifyApi('/playlists/abc/items', { fetchImpl: denied.fetchImpl, tokenStore, now }),
    (error) => error.statusCode === 403 && /denied access to this playlist/.test(error.message) && error.details.error.status === 403
  );

  const timeout = async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); };
  await assert.rejects(() => spotifyApi('/me', { fetchImpl: timeout, tokenStore, now }), (error) => error.statusCode === 504 && /15s/.test(error.message));

  const empty = workspace(t);
  await assert.rejects(
    () => spotifyApi('/me', { fetchImpl: async () => { throw new Error('no request expected'); }, tokenStore: empty.tokenStore, now }),
    (error) => error.statusCode === 401 && /npm run spotify:connect/.test(error.message)
  );
});

test('an expiring token is refreshed and a rotated refresh token is stored', async (t) => {
  const { tokenStore } = connected(t, { expiresAt: NOW_MS + 30_000 });
  const { calls, fetchImpl } = router([
    ['https://accounts.spotify.com/api/token', () => json({ access_token: 'access-next', refresh_token: 'refresh-rotated', expires_in: 3600, scope: ALL_SCOPES })],
    ['https://api.spotify.com/v1/me', () => json({ id: 'user' })]
  ]);
  await spotifyApi('/me', { fetchImpl, tokenStore, clientId: 'client-fixture', now });

  assert.equal(calls[0].init.body.get('grant_type'), 'refresh_token');
  assert.equal(calls[0].init.body.get('refresh_token'), 'refresh-fixture');
  assert.equal(calls[0].init.body.get('client_id'), 'client-fixture');
  assert.equal(calls[1].init.headers.authorization, 'Bearer access-next');
  const stored = tokenStore.read();
  assert.equal(stored.refreshToken, 'refresh-rotated');
  assert.equal(stored.expiresAt, NOW_MS + 3600_000);
  assert.equal(statSync(tokenStore.path).mode & 0o777, 0o600);
});

test('a refresh that omits the refresh token and scope keeps the existing ones', async (t) => {
  const { tokenStore } = connected(t, { expiresAt: NOW_MS - 1 });
  const { fetchImpl } = router([
    ['https://accounts.spotify.com/api/token', () => json({ access_token: 'access-next', expires_in: 3600 })],
    ['https://api.spotify.com/v1/me', () => json({ id: 'user' })]
  ]);
  await spotifyApi('/me', { fetchImpl, tokenStore, clientId: 'client-fixture', now });

  const stored = tokenStore.read();
  assert.equal(stored.accessToken, 'access-next');
  assert.equal(stored.refreshToken, 'refresh-fixture');
  assert.equal(stored.scope, ALL_SCOPES);
});

test('a revoked refresh token is reported as a lost sign-in', async (t) => {
  const { tokenStore } = connected(t, { expiresAt: NOW_MS - 1 });
  const { fetchImpl } = router([
    ['https://accounts.spotify.com/api/token', () => json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400)]
  ]);
  await assert.rejects(
    () => spotifyApi('/me', { fetchImpl, tokenStore, clientId: 'client-fixture', now }),
    (error) => error.statusCode === 401 && /npm run spotify:connect/.test(error.message)
  );
  assert.equal(tokenStore.read().refreshToken, 'refresh-fixture', 'a failed refresh never overwrites the stored token');
});

test('playlist artists follow pagination, skip episodes, and summarize like Playlist Sync did', async (t) => {
  const { tokenStore } = connected(t);
  const { calls, fetchImpl } = router([
    ['https://api.spotify.com/v1/playlists/list%20one/items?limit=50&fields=', () => json({
      next: 'https://api.spotify.com/v1/playlists/list%20one/items?offset=50&limit=50',
      items: [
        { track: { id: 't1', name: 'Song A', type: 'track', artists: [{ id: 'a1', name: 'Zed' }, { id: 'a2', name: 'Amy' }] } },
        { item: { id: 't2', name: 'Song B', type: 'track', artists: [{ id: 'a1', name: 'Zed' }] } },
        { track: { id: 'e1', name: 'Podcast', type: 'episode', artists: [{ id: 'a9', name: 'Host' }] } },
        { track: null }
      ]
    })],
    ['https://api.spotify.com/v1/playlists/list%20one/items?offset=50', () => json({
      next: null,
      items: [
        { track: { id: 't3', name: 'Song C', type: 'track', artists: [{ id: 'a1', name: 'Zed' }, { id: null, name: 'Local' }] } },
        { track: { id: 't4', name: 'Song D', type: 'track', artists: [{ id: 'a1', name: 'Zed' }, { id: 'a3', name: 'Bea' }] } }
      ]
    })],
    ['https://api.spotify.com/v1/artists?ids=a1,a2,a3', () => json({ artists: [{ id: 'a1', genres: ['house'] }, { id: 'a2', genres: [] }, null] })]
  ]);

  const artists = await getSpotifyPlaylistArtists('list one', 250, { fetchImpl, tokenStore, now });

  assert.deepEqual(artists, [
    { id: 'a1', name: 'Zed', genres: ['house'], trackCount: 4, sampleTracks: ['Song A', 'Song B', 'Song C'] },
    { id: 'a2', name: 'Amy', genres: [], trackCount: 1, sampleTracks: ['Song A'] },
    { id: 'a3', name: 'Bea', genres: [], trackCount: 1, sampleTracks: ['Song D'] }
  ]);
  assert.equal(calls.length, 3);
  assert.match(calls[0].href, /fields=next,items\(item\(id,uri,name,duration_ms,type,artists\(id,name\),album\(name\)\),track\(/);
});

test('playlist artists respect the track limit and fall back to single artist lookups', async (t) => {
  const { tokenStore } = connected(t);
  const { calls, fetchImpl } = router([
    ['https://api.spotify.com/v1/playlists/p/items', () => json({
      next: 'https://api.spotify.com/v1/playlists/p/items?offset=50&limit=50',
      items: [
        { track: { id: 't1', name: 'One', type: 'track', artists: [{ id: 'a1', name: 'First' }] } },
        { track: { id: 't2', name: 'Two', type: 'track', artists: [{ id: 'a2', name: 'Second' }] } },
        { track: { id: 't3', name: 'Three', type: 'track', artists: [{ id: 'a3', name: 'Third' }] } }
      ]
    })],
    ['https://api.spotify.com/v1/artists?ids=', () => json({ error: { status: 403 } }, 403)],
    ['https://api.spotify.com/v1/artists/a1', () => json({ id: 'a1', genres: ['techno'] })],
    ['https://api.spotify.com/v1/artists/a2', () => json({ error: { status: 404 } }, 404)]
  ]);

  const artists = await getSpotifyPlaylistArtists('p', 2, { fetchImpl, tokenStore, now });
  assert.deepEqual(artists.map((artist) => [artist.name, artist.genres]), [['First', ['techno']], ['Second', []]]);
  assert.equal(calls.filter((call) => call.href.includes('/items')).length, 1, 'no second page once the limit is reached');
});

test('lists the signed-in user\'s playlists with ids', async (t) => {
  const { tokenStore } = connected(t);
  const { fetchImpl } = router([
    ['https://api.spotify.com/v1/me/playlists?limit=50', () => json({
      next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50',
      items: [
        { id: 'p1', name: 'First', owner: { display_name: 'Owner' }, public: false, tracks: { total: 12 } },
        { id: 'p2', name: 'Second', owner: { display_name: 'Owner' }, public: true, tracks: { total: 3 } }
      ]
    })],
    ['https://api.spotify.com/v1/me/playlists?offset=50', () => json({ next: null, items: [{ id: 'p3', name: 'Third', owner: {}, public: null, tracks: { total: 0 } }] })]
  ]);

  const all = await listSpotifyPlaylists(50, { fetchImpl, tokenStore, now });
  assert.deepEqual(all[0], { id: 'p1', name: 'First', owner: 'Owner', public: false, tracks: 12 });
  assert.deepEqual(all.map((playlist) => playlist.id), ['p1', 'p2', 'p3']);
  assert.equal((await listSpotifyPlaylists(1, { fetchImpl, tokenStore, now })).length, 1);
});

test('top artists validates the window and bounds the limit', async (t) => {
  const { tokenStore } = connected(t);
  const { calls, fetchImpl } = router([['https://api.spotify.com/v1/me/top/artists', () => json({ items: [{ id: 'a', name: 'A' }] })]]);

  assert.deepEqual(await getSpotifyTopArtists('short_term', 500, { fetchImpl, tokenStore, now }), { items: [{ id: 'a', name: 'A' }] });
  assert.equal(calls[0].href, 'https://api.spotify.com/v1/me/top/artists?time_range=short_term&limit=50');
  await assert.rejects(() => getSpotifyTopArtists('all_time', 50, { fetchImpl, tokenStore, now }), (error) => error.statusCode === 400);
});

test('pagination and playlist item helpers match the Spotify response forms', () => {
  assert.equal(nextPagePath('https://api.spotify.com/v1/me/playlists?offset=50&limit=50'), '/me/playlists?offset=50&limit=50');
  assert.equal(nextPagePath(null), null);
  assert.deepEqual(playlistItemTrack({ track: { id: 't' } }), { id: 't' });
  assert.deepEqual(playlistItemTrack({ item: { id: 'i' } }), { id: 'i' });
  assert.equal(playlistItemTrack(null), null);
});

test('disconnect deletes the token and every Spotify-derived snapshot, including preview copies', (t) => {
  const { dir, tokenStore } = connected(t);
  const derived = ['artists.json', 'expanded-artists.json', 'seatgeek-performers.json', 'top-artists.json', 'artist-tags.json'];
  const kept = ['framework-artists.json', 'recommendation-history.json'];
  const previewData = join(dir, 'workflow', 'previews', 'latest', 'data', 'taste');
  mkdirSync(previewData, { recursive: true });
  for (const name of [...derived, ...kept]) writeFileSync(join(dir, name), '{}');
  for (const name of [...derived, 'spotify-token.json', ...kept]) writeFileSync(join(previewData, name), '{}');

  const result = disconnectSpotify({ dataDir: dir, tokenStore });

  assert.equal(result.tokenRemoved, true);
  assert.equal(existsSync(tokenStore.path), false);
  for (const name of derived) {
    assert.equal(existsSync(join(dir, name)), false, `${name} should be deleted`);
    assert.equal(existsSync(join(previewData, name)), false, `preview ${name} should be deleted`);
  }
  assert.equal(existsSync(join(previewData, 'spotify-token.json')), false);
  for (const name of kept) {
    assert.equal(existsSync(join(dir, name)), true);
    assert.equal(existsSync(join(previewData, name)), true);
  }
  assert.equal(result.removed.length, 11);
  assert.equal(getSpotifyAuthStatus({ tokenStore, now }).connected, false);
  assert.equal(disconnectSpotify({ dataDir: dir, tokenStore }).tokenRemoved, false, 'disconnecting twice is harmless');
});

test('state lives in the canonical data directory even when run from a refresh preview copy', () => {
  assert.equal(resolveSpotifyStateDir({ moduleRoot: '/work/Taste Engine', env: {} }), '/work/Taste Engine/data/taste');
  assert.equal(
    resolveSpotifyStateDir({ moduleRoot: '/work/Taste Engine/data/taste/workflow/previews/latest', env: {} }),
    '/work/Taste Engine/data/taste'
  );
  assert.equal(resolveSpotifyStateDir({ moduleRoot: '/work/Taste Engine', env: { TASTE_SPOTIFY_STATE_DIR: '/elsewhere/state' } }), '/elsewhere/state');
});

test('imports only the spotify entry of a Playlist Sync token file', (t) => {
  const { dir, tokenStore } = workspace(t);
  const from = join(dir, 'tokens.json');
  writeFileSync(from, JSON.stringify({
    spotify: {
      accessToken: 'imported-access-secret',
      refreshToken: 'imported-refresh-secret',
      expiresAt: NOW_MS + 1000,
      scope: `${ALL_SCOPES} playlist-modify-private`,
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    other: { accessToken: 'other-service-secret' }
  }));

  const status = importPlaylistSyncToken(from, { tokenStore, now });

  assert.equal(status.connected, true);
  assert.deepEqual(status.missingScopes, []);
  assert.ok(status.grantedScopes.includes('playlist-modify-private'));
  assert.doesNotMatch(JSON.stringify(status), /secret/);
  const stored = readFileSync(tokenStore.path, 'utf8');
  assert.doesNotMatch(stored, /other-service-secret/);
  assert.deepEqual(Object.keys(JSON.parse(stored)), ['version', 'accessToken', 'refreshToken', 'expiresAt', 'scope', 'updatedAt']);
  assert.equal(tokenStore.read().refreshToken, 'imported-refresh-secret');
  assert.equal(statSync(tokenStore.path).mode & 0o777, 0o600);
  assert.match(readFileSync(from, 'utf8'), /imported-refresh-secret/, 'the source file is left untouched');
});

test('import fails clearly without a path, a file, or a spotify sign-in', (t) => {
  const { dir, tokenStore } = workspace(t);
  assert.throws(() => importPlaylistSyncToken('', { tokenStore }), /--from/);
  assert.throws(() => importPlaylistSyncToken(join(dir, 'missing.json'), { tokenStore }), /Could not read a token file/);
  const empty = join(dir, 'empty.json');
  writeFileSync(empty, JSON.stringify({ spotify: { accessToken: 'only-access' } }));
  assert.throws(() => importPlaylistSyncToken(empty, { tokenStore }), /no usable `spotify` sign-in/);
  assert.equal(existsSync(tokenStore.path), false);
});

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('connect validates state, exchanges the code over loopback, and stores the token', async (t) => {
  const { tokenStore } = workspace(t);
  const port = await freePort();
  const redirectUri = `http://127.0.0.1:${port}/auth/spotify/callback`;
  const { calls, fetchImpl } = router([
    ['https://accounts.spotify.com/api/token', () => json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, scope: ALL_SCOPES })]
  ]);
  const lines = [];
  let authorizationUrl;
  const ready = new Promise((resolve) => { authorizationUrl = resolve; });

  const pending = runSpotifyConnect({
    clientId: 'client-fixture', redirectUri, tokenStore, fetchImpl, timeoutMs: 10_000,
    log: (line) => lines.push(line),
    openUrl: (url) => authorizationUrl(url)
  });
  const url = new URL(await ready);
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);

  const wrongState = await fetch(`${redirectUri}?code=abc&state=wrong`);
  assert.equal(wrongState.status, 400);
  await wrongState.text();
  assert.equal(calls.length, 0, 'a mismatched state never reaches the token endpoint');

  const callback = await fetch(`${redirectUri}?code=code-fixture&state=${encodeURIComponent(url.searchParams.get('state'))}`);
  assert.equal(callback.status, 200);
  assert.match(await callback.text(), /connected to Spotify\. You can close this tab\./);

  const status = await pending;
  assert.equal(status.connected, true);
  assert.equal(calls[0].init.body.get('code'), 'code-fixture');
  assert.equal(tokenStore.read().accessToken, 'access-secret');
  assert.doesNotMatch(lines.join('\n'), /secret/);
});

test('connect fails clearly when the port is in use or the sign-in times out', async (t) => {
  const { tokenStore } = workspace(t);
  const holder = createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  t.after(() => holder.close());
  const busyPort = holder.address().port;

  await assert.rejects(
    () => runSpotifyConnect({ clientId: 'client-fixture', redirectUri: `http://127.0.0.1:${busyPort}/auth/spotify/callback`, tokenStore, open: false, log: () => {} }),
    new RegExp(`Something else is listening on ${busyPort} — stop Playlist Sync`)
  );

  const port = await freePort();
  await assert.rejects(
    () => runSpotifyConnect({ clientId: 'client-fixture', redirectUri: `http://127.0.0.1:${port}/auth/spotify/callback`, tokenStore, open: false, timeoutMs: 20, log: () => {} }),
    /No Spotify authorization arrived.*npm run spotify:connect/
  );
  await assert.rejects(
    () => runSpotifyConnect({ clientId: 'client-fixture', redirectUri: 'https://example.com/callback', tokenStore, open: false, log: () => {} }),
    /loopback/
  );
  assert.equal(existsSync(tokenStore.path), false);
});
