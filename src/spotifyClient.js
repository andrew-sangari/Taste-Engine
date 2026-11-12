// Taste Engine's own local Spotify client. Read-only: it requests only the
// scopes below and issues only GET requests against the Web API. It replaces
// the former dependency on the sibling Playlist Sync service.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;
const MODULE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));

export const SPOTIFY_SCOPES = Object.freeze(['playlist-read-private', 'playlist-read-collaborative', 'user-top-read']);
export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:4317/auth/spotify/callback';
export const SPOTIFY_TOKEN_FILENAME = 'spotify-token.json';
// Every local file whose contents derive from the signed-in Spotify account.
// The tag cache is keyed by playlist artist names, so it is included.
export const SPOTIFY_DERIVED_FILENAMES = Object.freeze([
  'artists.json',
  'expanded-artists.json',
  'seatgeek-performers.json',
  'top-artists.json',
  'artist-tags.json'
]);

export class SpotifyError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = 'SpotifyError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

// The guarded refresh runs a copy of this source tree from
// data/taste/workflow/previews/<name>. The token (whose refresh token rotates),
// the Top Artists cache and the tag cache must stay in the one canonical
// data/taste directory, otherwise every rotation would be discarded with the
// preview. TASTE_SPOTIFY_STATE_DIR overrides the location outright.
export function resolveSpotifyStateDir({ moduleRoot = MODULE_ROOT, env = process.env } = {}) {
  if (env.TASTE_SPOTIFY_STATE_DIR) return resolve(env.TASTE_SPOTIFY_STATE_DIR);
  const preview = /^(.*)[\\/]data[\\/]taste[\\/]workflow[\\/]previews[\\/][^\\/]+$/.exec(resolve(moduleRoot));
  return join(preview ? preview[1] : resolve(moduleRoot), 'data', 'taste');
}

export function defaultTokenPath() {
  return join(resolveSpotifyStateDir(), SPOTIFY_TOKEN_FILENAME);
}

export function spotifyRedirectUri(env = process.env) {
  return String(env.SPOTIFY_REDIRECT_URI || DEFAULT_REDIRECT_URI).trim();
}

export function createTokenStore(path = defaultTokenPath()) {
  return {
    path,
    read() {
      try {
        const value = JSON.parse(readFileSync(path, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
      } catch {
        return null;
      }
    },
    write(token, now = new Date()) {
      const record = {
        version: 1,
        accessToken: String(token.accessToken ?? ''),
        refreshToken: token.refreshToken ? String(token.refreshToken) : null,
        expiresAt: Number(token.expiresAt) || 0,
        scope: String(token.scope ?? ''),
        updatedAt: new Date(now).toISOString()
      };
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, path);
      return record;
    },
    clear() {
      rmSync(path, { force: true });
    }
  };
}

export function createAuthorizationRequest({ clientId, redirectUri = spotifyRedirectUri() } = {}) {
  if (!clientId) throw new SpotifyError(400, 'Set SPOTIFY_CLIENT_ID in .env first.');
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  return { url: url.toString(), verifier, state };
}

// Exchanges the authorization code, stores the token and returns the auth
// status. Token values are never returned.
export async function exchangeAuthorizationCode({
  code,
  verifier,
  clientId = process.env.SPOTIFY_CLIENT_ID,
  redirectUri = spotifyRedirectUri(),
  fetchImpl = fetch,
  tokenStore = createTokenStore(),
  now = Date.now
} = {}) {
  if (!clientId) throw new SpotifyError(400, 'Set SPOTIFY_CLIENT_ID in .env first.');
  if (!code || !verifier) throw new SpotifyError(400, 'Spotify callback did not include a code.');
  const response = await tokenRequest(new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  }), fetchImpl);
  tokenStore.write(normalizeTokenResponse(response, now()), new Date(now()));
  return getSpotifyAuthStatus({ tokenStore, now });
}

export function getSpotifyAuthStatus({ tokenStore = createTokenStore(), now = Date.now } = {}) {
  const token = tokenStore.read();
  const granted = new Set(String(token?.scope ?? '').split(/\s+/).filter(Boolean));
  const expiresAt = Number(token?.expiresAt);
  const usable = Boolean(token?.accessToken) && (Boolean(token?.refreshToken) || expiresAt > now());
  return {
    connected: usable,
    grantedScopes: [...granted],
    missingScopes: SPOTIFY_SCOPES.filter((scope) => !granted.has(scope)),
    tokenExpiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? new Date(expiresAt).toISOString() : null,
    tokenUpdatedAt: token?.updatedAt ?? null
  };
}

export async function spotifyApi(path, {
  fetchImpl = fetch,
  tokenStore = createTokenStore(),
  clientId = process.env.SPOTIFY_CLIENT_ID,
  now = Date.now
} = {}) {
  const accessToken = await getAccessToken({ fetchImpl, tokenStore, clientId, now });
  const response = await timedFetch(fetchImpl, `${API_URL}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }
  }, `Spotify API request failed: ${path}`);
  if (!response.ok) {
    throw new SpotifyError(response.status, spotifyErrorMessage(path, response.status), await safeJson(response));
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function getSpotifyTopArtists(timeRange, limit = 50, deps = {}) {
  if (!['short_term', 'medium_term', 'long_term'].includes(timeRange)) {
    throw new SpotifyError(400, `Unsupported Spotify top-artists time range: ${timeRange}`);
  }
  const boundedLimit = Math.min(50, Math.max(1, Number(limit) || 50));
  return spotifyApi(`/me/top/artists?time_range=${encodeURIComponent(timeRange)}&limit=${boundedLimit}`, deps);
}

export async function getSpotifyPlaylistTracks(playlistId, limit = 100, deps = {}) {
  const tracks = [];
  let path = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&fields=next,items(item(id,uri,name,duration_ms,type,artists(id,name),album(name)),track(id,uri,name,duration_ms,type,artists(id,name),album(name)))`;

  while (path && tracks.length < limit) {
    const page = await spotifyApi(path, deps);
    for (const item of page?.items ?? []) {
      const track = playlistItemTrack(item);
      if (track?.id && track.type !== 'episode') tracks.push(track);
      if (tracks.length >= limit) break;
    }
    path = nextPagePath(page?.next);
  }

  return tracks;
}

export async function getSpotifyArtists(artistIds, deps = {}) {
  const uniqueIds = [...new Set(artistIds.filter(Boolean))];
  const artists = new Map();

  for (const ids of chunks(uniqueIds, 50)) {
    try {
      const response = await spotifyApi(`/artists?ids=${ids.map(encodeURIComponent).join(',')}`, deps);
      for (const artist of response?.artists ?? []) {
        if (artist?.id) artists.set(artist.id, artist);
      }
    } catch (batchError) {
      // A lost sign-in will not recover one artist at a time.
      if (Number(batchError?.statusCode) === 401) throw batchError;
      for (const id of ids) {
        try {
          const artist = await spotifyApi(`/artists/${encodeURIComponent(id)}`, deps);
          if (artist?.id) artists.set(artist.id, artist);
        } catch {
          artists.set(id, { id, genres: [] });
        }
      }
    }
  }

  return artists;
}

export async function getSpotifyPlaylistArtists(playlistId, limit = 250, deps = {}) {
  const tracks = await getSpotifyPlaylistTracks(playlistId, limit, deps);
  const artistIds = tracks.flatMap((track) => track.artists?.map((artist) => artist.id) ?? []);
  const spotifyArtists = await getSpotifyArtists(artistIds, deps);
  const artists = new Map();

  for (const track of tracks) {
    for (const artist of track.artists ?? []) {
      if (!artist.id) continue;
      if (!artists.has(artist.id)) {
        artists.set(artist.id, {
          id: artist.id,
          name: artist.name,
          genres: spotifyArtists.get(artist.id)?.genres ?? [],
          trackCount: 0,
          sampleTracks: []
        });
      }
      const summary = artists.get(artist.id);
      summary.trackCount += 1;
      if (summary.sampleTracks.length < 3) summary.sampleTracks.push(track.name);
    }
  }

  return [...artists.values()].sort((a, b) => b.trackCount - a.trackCount || String(a.name).localeCompare(String(b.name)));
}

export async function listSpotifyPlaylists(limit = 50, deps = {}) {
  const playlists = [];
  let path = '/me/playlists?limit=50';

  while (path && playlists.length < limit) {
    const page = await spotifyApi(path, deps);
    for (const item of page?.items ?? []) {
      playlists.push({
        id: item.id,
        name: item.name,
        owner: item.owner?.display_name,
        public: item.public,
        tracks: item.tracks?.total ?? item.items?.total
      });
      if (playlists.length >= limit) break;
    }
    path = nextPagePath(page?.next);
  }

  return playlists;
}

// Removes the replaceable Spotify-derived snapshots, including copies left in
// guarded-refresh preview workspaces. Returns the paths actually removed.
export function purgeSpotifyDerivedData({ dataDir = resolveSpotifyStateDir(), extraPaths = [] } = {}) {
  const removed = [];
  const remove = (path) => {
    try {
      if (existsSync(path)) {
        rmSync(path, { force: true });
        removed.push(path);
      }
    } catch {
      // Best effort: one unreadable optional cache must not stop the purge.
    }
  };
  for (const filename of SPOTIFY_DERIVED_FILENAMES) remove(join(dataDir, filename));
  for (const path of extraPaths) if (path) remove(path);
  for (const previewDataDir of previewDataDirs(dataDir)) {
    for (const filename of [...SPOTIFY_DERIVED_FILENAMES, SPOTIFY_TOKEN_FILENAME]) remove(join(previewDataDir, filename));
  }
  return removed;
}

// Disconnect deletes the token and every Spotify-derived local snapshot
// immediately. It does not call Spotify.
export function disconnectSpotify({ dataDir = resolveSpotifyStateDir(), tokenStore = null } = {}) {
  const store = tokenStore ?? createTokenStore(join(dataDir, SPOTIFY_TOKEN_FILENAME));
  const hadToken = existsSync(store.path);
  store.clear();
  const removed = purgeSpotifyDerivedData({ dataDir });
  return { tokenRemoved: hadToken, removed };
}

// One-time migration: copies only the `spotify` entry of a Playlist Sync
// tokens file into Taste Engine's token store. Returns the auth status only.
export function importPlaylistSyncToken(fromPath, { tokenStore = createTokenStore(), now = Date.now } = {}) {
  if (!fromPath) throw new Error('--from <path to Playlist Sync data/tokens.json> is required.');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(fromPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read a token file at the --from path (${error.code ?? 'invalid JSON'}).`);
  }
  const entry = parsed?.spotify;
  if (!entry || typeof entry !== 'object' || !entry.accessToken || !entry.refreshToken) {
    throw new Error('The --from file has no usable `spotify` sign-in (access and refresh token). Run `npm run spotify:connect` instead.');
  }
  tokenStore.write({
    accessToken: entry.accessToken,
    refreshToken: entry.refreshToken,
    expiresAt: entry.expiresAt,
    scope: entry.scope
  }, new Date(now()));
  return getSpotifyAuthStatus({ tokenStore, now });
}

export function nextPagePath(nextUrl) {
  if (!nextUrl) return null;
  const url = new URL(nextUrl);
  return `${url.pathname.replace(/^\/v1(?=\/)/, '')}${url.search}`;
}

export function playlistItemTrack(playlistItem) {
  return playlistItem?.track ?? playlistItem?.item ?? null;
}

async function getAccessToken({ fetchImpl, tokenStore, clientId, now }) {
  const token = tokenStore.read();
  if (!token?.accessToken) {
    throw new SpotifyError(401, 'Spotify is not connected. Run `npm run spotify:connect`.');
  }
  if (now() < Number(token.expiresAt) - 60_000) return token.accessToken;
  if (!token.refreshToken) {
    throw new SpotifyError(401, 'Spotify token expired and has no refresh token. Run `npm run spotify:connect`.');
  }
  if (!clientId) throw new SpotifyError(400, 'Set SPOTIFY_CLIENT_ID in .env first.');

  let refreshed;
  try {
    refreshed = await tokenRequest(new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken
    }), fetchImpl);
  } catch (error) {
    if (error?.details?.error === 'invalid_grant') {
      throw new SpotifyError(401, 'Spotify sign-in is no longer valid. Run `npm run spotify:connect`.', error.details);
    }
    throw error;
  }
  // Spotify may rotate the refresh token or omit it; keep whichever is current.
  const next = normalizeTokenResponse({
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? token.refreshToken,
    scope: refreshed.scope ?? token.scope
  }, now());
  tokenStore.write(next, new Date(now()));
  return next.accessToken;
}

async function tokenRequest(body, fetchImpl) {
  const response = await timedFetch(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  }, 'Spotify token request failed');
  if (!response.ok) {
    throw new SpotifyError(response.status, 'Spotify token request failed', await safeJson(response));
  }
  return response.json();
}

async function timedFetch(fetchImpl, url, init, failureMessage) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new SpotifyError(
      timedOut ? 504 : 502,
      `${failureMessage} (${timedOut ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s` : error?.cause?.code || error?.message || 'network error'})`
    );
  }
}

function normalizeTokenResponse(response, nowMs) {
  if (!response?.access_token) throw new SpotifyError(502, 'Spotify token response did not include an access token.');
  return {
    accessToken: String(response.access_token),
    refreshToken: response.refresh_token ? String(response.refresh_token) : null,
    expiresAt: nowMs + (Number(response.expires_in) || 3600) * 1000,
    scope: String(response.scope ?? '')
  };
}

function spotifyErrorMessage(path, status) {
  if (status === 403 && path.includes('/playlists/')) {
    return `Spotify denied access to this playlist. This usually means the connected user cannot read it, the app is in development mode and the user is not allowlisted, or the playlist is restricted by Spotify. Path: ${path}`;
  }
  return `Spotify API request failed: ${path}`;
}

function previewDataDirs(dataDir) {
  const previews = join(dataDir, 'workflow', 'previews');
  try {
    return readdirSync(previews, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(previews, entry.name, 'data', 'taste'));
  } catch {
    return [];
  }
}

function base64Url(buffer) {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function safeJson(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return null;
  }
}
