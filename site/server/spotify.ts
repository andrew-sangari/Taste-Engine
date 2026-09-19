import { getD1 } from "../db/index.ts";
import type { ProfileScope } from "./profiles";
import {
  isSealedSpotifyToken,
  openSpotifyToken,
  sealSpotifyToken,
  TokenEncryptionError,
} from "./token-crypto.ts";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOP_ARTIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCOPES = ["playlist-read-private", "playlist-read-collaborative", "user-top-read"];
const TOP_WINDOWS = [
  { key: "shortTerm", apiRange: "short_term" },
  { key: "mediumTerm", apiRange: "medium_term" },
  { key: "longTerm", apiRange: "long_term" },
] as const;

type SpotifyToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string;
};

type SpotifyTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

type SpotifyArtistRef = { id?: string; name?: string };
type SpotifyArtist = SpotifyArtistRef & { genres?: string[] };
type SpotifyTrack = { id?: string; name?: string; type?: string; artists?: SpotifyArtistRef[] };
type SpotifyPage<T> = { items?: T[]; next?: string | null };
type SpotifyPlaylist = {
  id?: string;
  name?: string;
  owner?: { display_name?: string };
  public?: boolean | null;
  collaborative?: boolean;
  tracks?: { total?: number };
};
type SpotifyPlaylistItem = { track?: SpotifyTrack; item?: SpotifyTrack };
type PlaylistArtistSummary = {
  id: string;
  name: string;
  genres: string[];
  trackCount: number;
  sampleTracks: string[];
};
type TopArtistItem = { artistId: string; artistName: string; rank: number };
type TopArtistWindow = {
  status: "fresh" | "cached" | "unavailable";
  warning: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  items: TopArtistItem[];
};
type CombinedTopArtist = {
  artistId: string;
  artistName: string;
  shortTermRank: number | null;
  mediumTermRank: number | null;
  longTermRank: number | null;
  [key: string]: string | number | null;
};

export async function createSpotifyConnectUrl(profile: ProfileScope, origin: string): Promise<string> {
  const clientId = spotifyClientId();
  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomBase64Url(24);
  const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
  await getD1().batch([
    getD1().prepare("DELETE FROM spotify_oauth_states WHERE expires_at < ?1").bind(Date.now()),
    getD1().prepare(`
      INSERT INTO spotify_oauth_states (state, owner_email, profile_id, verifier, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(state, profile.email, profile.id, verifier, expiresAt),
  ]);
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", spotifyRedirectUri(origin));
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeSpotifyConnection(callbackUrl: URL, expectedProfileId: string): Promise<void> {
  const error = callbackUrl.searchParams.get("error");
  if (error) throw new SpotifyInputError(`Spotify authorization failed: ${error}`);
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  if (!code || !state) throw new SpotifyInputError("Spotify callback is missing code or state.");
  const row = await getD1()
    .prepare("SELECT owner_email, profile_id, verifier, expires_at FROM spotify_oauth_states WHERE state = ?1")
    .bind(state)
    .first<{ owner_email: string; profile_id: string | null; verifier: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) throw new SpotifyInputError("Spotify connection expired. Start again.");
  if (!row.profile_id || row.profile_id !== expectedProfileId) {
    throw new SpotifyInputError("Spotify connection belongs to a different Taste Engine profile.");
  }
  const token = await tokenRequest(new URLSearchParams({
    client_id: spotifyClientId(),
    grant_type: "authorization_code",
    code,
    redirect_uri: spotifyRedirectUri(callbackUrl.origin),
    code_verifier: row.verifier,
  }));
  await saveToken({
    id: row.profile_id,
    email: row.owner_email,
    displayName: row.owner_email,
    legacyDefault: false,
  }, normalizeToken(token));
  await getD1().prepare("DELETE FROM spotify_oauth_states WHERE state = ?1").bind(state).run();
}

export async function spotifyStatus(profile: ProfileScope) {
  const token = await readToken(profile);
  const granted = new Set(String(token?.scopes ?? "").split(/\s+/).filter(Boolean));
  const selections = await readPlaylistSelections(profile);
  return {
    configured: Boolean(process.env.SPOTIFY_CLIENT_ID),
    connected: Boolean(token?.accessToken),
    missingScopes: SCOPES.filter((scope) => !granted.has(scope)),
    selectedPlaylistCount: selections.filter((item) => item.enabled).length,
    topArtistWindows: await cachedWindowHealth(profile),
  };
}

export async function disconnectSpotify(profile: ProfileScope): Promise<void> {
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM spotify_tokens WHERE profile_id = ?1").bind(profile.id),
    db.prepare("DELETE FROM spotify_top_artist_windows WHERE profile_id = ?1").bind(profile.id),
    db.prepare("DELETE FROM spotify_playlist_selections WHERE profile_id = ?1").bind(profile.id),
    db.prepare("DELETE FROM spotify_oauth_states WHERE profile_id = ?1").bind(profile.id),
    db.prepare("DELETE FROM hosted_taste_snapshots WHERE profile_id = ?1").bind(profile.id),
    db.prepare("DELETE FROM recommendation_snapshots WHERE profile_id = ?1").bind(profile.id),
  ]);
}

export async function listSpotifyPlaylists(profile: ProfileScope, limit = 200) {
  const playlists: Array<Record<string, unknown>> = [];
  let path: string | null = "/me/playlists?limit=50";
  while (path && playlists.length < Math.min(200, Math.max(1, limit))) {
    const page = await spotifyApi<SpotifyPage<SpotifyPlaylist>>(profile, path);
    for (const item of page.items ?? []) {
      playlists.push({
        id: item.id,
        name: item.name,
        owner: item.owner?.display_name ?? null,
        public: item.public ?? null,
        collaborative: Boolean(item.collaborative),
        tracks: item.tracks?.total ?? 0,
      });
      if (playlists.length >= limit) break;
    }
    path = nextPagePath(page.next);
  }
  return playlists;
}

export async function getSpotifyPlaylistArtists(profile: ProfileScope, playlistId: string, limit = 250) {
  const tracks: SpotifyTrack[] = [];
  let path: string | null = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&fields=next,items(item(id,uri,name,type,artists(id,name),album(name)),track(id,uri,name,type,artists(id,name),album(name)))`;
  const boundedLimit = Math.min(500, Math.max(1, limit));
  while (path && tracks.length < boundedLimit) {
    const page = await spotifyApi<SpotifyPage<SpotifyPlaylistItem>>(profile, path);
    for (const item of page.items ?? []) {
      const track = item?.track ?? item?.item;
      if (track?.id && track.type !== "episode") tracks.push(track);
      if (tracks.length >= boundedLimit) break;
    }
    path = nextPagePath(page.next);
  }
  const artistIds = [...new Set(tracks.flatMap((track) => (track.artists ?? []).map((artist) => artist.id).filter((id): id is string => Boolean(id))))];
  const artistDetails = new Map<string, SpotifyArtist>();
  for (let index = 0; index < artistIds.length; index += 50) {
    const ids = artistIds.slice(index, index + 50);
    const response = await spotifyApi<{ artists?: SpotifyArtist[] }>(profile, `/artists?ids=${ids.map(encodeURIComponent).join(",")}`);
    for (const artist of response.artists ?? []) if (artist?.id) artistDetails.set(artist.id, artist);
  }
  const summaries = new Map<string, PlaylistArtistSummary>();
  for (const track of tracks) {
    for (const artist of track.artists ?? []) {
      if (!artist.id) continue;
      const current = summaries.get(artist.id) ?? {
        id: artist.id,
        name: artist.name ?? "Unknown artist",
        genres: artistDetails.get(artist.id)?.genres ?? [],
        trackCount: 0,
        sampleTracks: [],
      };
      current.trackCount += 1;
      if (current.sampleTracks.length < 3 && track.name) current.sampleTracks.push(track.name);
      summaries.set(artist.id, current);
    }
  }
  return [...summaries.values()].sort((left, right) => right.trackCount - left.trackCount || left.name.localeCompare(right.name));
}

export async function refreshSpotifyTopArtists(profile: ProfileScope, limit = 50) {
  const now = new Date();
  const windows: Record<string, TopArtistWindow> = {};
  let authenticationFailure = false;
  for (const definition of TOP_WINDOWS) {
    try {
      const response = await spotifyApi<{ items?: SpotifyArtist[] }>(profile, `/me/top/artists?time_range=${definition.apiRange}&limit=${Math.min(50, Math.max(1, limit))}`);
      const fetchedAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + TOP_ARTIST_TTL_MS).toISOString();
      const items = (response.items ?? []).map((artist, index) => ({
        artistId: String(artist.id ?? ""),
        artistName: String(artist.name ?? ""),
        rank: index + 1,
      })).filter((artist) => artist.artistId && artist.artistName);
      await getD1().prepare(`
        INSERT INTO spotify_top_artist_windows (owner_email, profile_id, window_key, fetched_at, expires_at, items_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(profile_id, window_key) DO UPDATE SET
          owner_email = excluded.owner_email,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at,
          items_json = excluded.items_json
      `).bind(profile.email, profile.id, definition.key, fetchedAt, expiresAt, JSON.stringify(items)).run();
      windows[definition.key] = { status: "fresh", warning: null, fetchedAt, expiresAt, items };
    } catch (error) {
      if (error instanceof SpotifyHttpError && error.status === 401) authenticationFailure = true;
      const cached = await readCachedWindow(profile, definition.key, now);
      windows[definition.key] = cached
        ? { ...cached, status: "cached", warning: error instanceof Error ? error.message : "Spotify request failed." }
        : { status: "unavailable", warning: error instanceof Error ? error.message : "Spotify request failed.", fetchedAt: null, expiresAt: null, items: [] };
    }
  }
  if (authenticationFailure) {
    await disconnectSpotify(profile);
    throw new SpotifyHttpError(401, "Spotify authorization is missing or expired. Reconnect Spotify.");
  }
  return buildTopArtistResponse(windows, now);
}

export async function readPlaylistSelections(profile: ProfileScope) {
  const result = await getD1().prepare(`
    SELECT playlist_id, playlist_name, weight, enabled, updated_at
    FROM spotify_playlist_selections
    WHERE profile_id = ?1
    ORDER BY playlist_name COLLATE NOCASE, playlist_id
  `).bind(profile.id).all<{
    playlist_id: string;
    playlist_name: string;
    weight: number;
    enabled: number;
    updated_at: string;
  }>();
  return (result.results ?? []).map((row) => ({
    id: row.playlist_id,
    name: row.playlist_name,
    weight: row.weight,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
  }));
}

export async function writePlaylistSelections(profile: ProfileScope, selections: unknown) {
  if (!Array.isArray(selections) || selections.length > 100) throw new SpotifyInputError("Playlists must be an array of at most 100 items.");
  const normalized = selections.map((item) => {
    if (!item || typeof item !== "object") throw new SpotifyInputError("Each playlist must be an object.");
    const input = item as Record<string, unknown>;
    const id = String(input.id ?? "").trim();
    const name = String(input.name ?? "").trim();
    const weight = Math.min(10, Math.max(1, Math.round(Number(input.weight ?? 1))));
    if (!id || !name || name.length > 200) throw new SpotifyInputError("Each playlist needs a valid id and name.");
    return { id, name, weight, enabled: input.enabled !== false };
  });
  const db = getD1();
  const now = new Date().toISOString();
  await db.prepare("DELETE FROM spotify_playlist_selections WHERE profile_id = ?1").bind(profile.id).run();
  if (normalized.length) {
    await db.batch(normalized.map((item) => db.prepare(`
      INSERT INTO spotify_playlist_selections
        (owner_email, profile_id, playlist_id, playlist_name, weight, enabled, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind(profile.email, profile.id, item.id, item.name, item.weight, item.enabled ? 1 : 0, now)));
  }
  return readPlaylistSelections(profile);
}

async function spotifyApi<T>(profile: ProfileScope, path: string): Promise<T> {
  const token = await getAccessToken(profile);
  const response = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  if (!response.ok) throw new SpotifyHttpError(response.status, `Spotify API request failed: ${path}`);
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

async function getAccessToken(profile: ProfileScope): Promise<string> {
  const token = await readToken(profile);
  if (!token) throw new SpotifyHttpError(401, "Spotify is not connected.");
  if (Date.now() < token.expiresAt - 60_000) return token.accessToken;
  if (!token.refreshToken) throw new SpotifyHttpError(401, "Spotify token expired without a refresh token.");
  const refreshed = await tokenRequest(new URLSearchParams({
    client_id: spotifyClientId(),
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  }));
  const next = normalizeToken({ ...refreshed, refresh_token: refreshed.refresh_token ?? token.refreshToken });
  await saveToken(profile, next);
  return next.accessToken;
}

async function readToken(profile: ProfileScope): Promise<SpotifyToken | null> {
  const row = await getD1().prepare(`
    SELECT access_token, refresh_token, expires_at, scopes
    FROM spotify_tokens
    WHERE profile_id = ?1
  `).bind(profile.id).first<{
    access_token: string;
    refresh_token: string | null;
    expires_at: number;
    scopes: string;
  }>();
  if (!row) return null;
  const token = {
    accessToken: await openSpotifyToken(row.access_token),
    refreshToken: row.refresh_token ? await openSpotifyToken(row.refresh_token) : null,
    expiresAt: row.expires_at,
    scopes: row.scopes,
  };
  if (!isSealedSpotifyToken(row.access_token) || (row.refresh_token && !isSealedSpotifyToken(row.refresh_token))) {
    await saveToken(profile, token);
  }
  return token;
}

async function saveToken(profile: ProfileScope, token: SpotifyToken): Promise<void> {
  let accessToken: string;
  let refreshToken: string | null;
  try {
    accessToken = await sealSpotifyToken(token.accessToken);
    refreshToken = token.refreshToken ? await sealSpotifyToken(token.refreshToken) : null;
  } catch (error) {
    if (error instanceof TokenEncryptionError) throw new SpotifyInputError(error.message);
    throw error;
  }
  await getD1().prepare(`
    INSERT INTO spotify_tokens
      (owner_email, profile_id, access_token, refresh_token, expires_at, scopes, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(profile_id) DO UPDATE SET
      owner_email = excluded.owner_email,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scopes = excluded.scopes,
      updated_at = excluded.updated_at
  `).bind(profile.email, profile.id, accessToken, refreshToken, token.expiresAt, token.scopes, new Date().toISOString()).run();
}

async function tokenRequest(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new SpotifyHttpError(response.status, "Spotify token request failed.");
  return response.json() as Promise<SpotifyTokenResponse>;
}

function normalizeToken(input: SpotifyTokenResponse): SpotifyToken {
  return {
    accessToken: String(input.access_token ?? ""),
    refreshToken: input.refresh_token ? String(input.refresh_token) : null,
    expiresAt: Date.now() + Number(input.expires_in ?? 3600) * 1000,
    scopes: String(input.scope ?? ""),
  };
}

async function readCachedWindow(profile: ProfileScope, windowKey: string, now: Date) {
  const row = await getD1().prepare(`
    SELECT fetched_at, expires_at, items_json
    FROM spotify_top_artist_windows
    WHERE profile_id = ?1 AND window_key = ?2
  `).bind(profile.id, windowKey).first<{ fetched_at: string; expires_at: string; items_json: string }>();
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
  try {
    const items = JSON.parse(row.items_json) as unknown;
    return Array.isArray(items) && items.length
      ? { fetchedAt: row.fetched_at, expiresAt: row.expires_at, items: items as TopArtistItem[] }
      : null;
  } catch {
    return null;
  }
}

async function cachedWindowHealth(profile: ProfileScope) {
  const result: Record<string, { status: string; fetchedAt: string | null; expiresAt: string | null }> = {};
  for (const definition of TOP_WINDOWS) {
    const cached = await readCachedWindow(profile, definition.key, new Date());
    result[definition.key] = cached
      ? { status: "cached", fetchedAt: cached.fetchedAt, expiresAt: cached.expiresAt }
      : { status: "unavailable", fetchedAt: null, expiresAt: null };
  }
  return result;
}

function buildTopArtistResponse(windows: Record<string, TopArtistWindow>, generatedAt: Date) {
  const artists = new Map<string, CombinedTopArtist>();
  for (const definition of TOP_WINDOWS) {
    for (const item of windows[definition.key]?.items ?? []) {
      const current = artists.get(item.artistId) ?? {
        artistId: item.artistId,
        artistName: item.artistName,
        shortTermRank: null,
        mediumTermRank: null,
        longTermRank: null,
      };
      current[`${definition.key}Rank`] = item.rank;
      artists.set(item.artistId, current);
    }
  }
  const statuses = TOP_WINDOWS.map((definition) => windows[definition.key]?.status);
  const status = statuses.every((value) => value === "fresh") ? "active"
    : statuses.some((value) => value === "fresh" || value === "cached") ? "partial"
      : "unavailable";
  return {
    status,
    generatedAt: generatedAt.toISOString(),
    windows: Object.fromEntries(TOP_WINDOWS.map(({ key }) => [key, {
      status: windows[key]?.status ?? "unavailable",
      warning: windows[key]?.warning ?? null,
      fetchedAt: windows[key]?.fetchedAt ?? null,
      expiresAt: windows[key]?.expiresAt ?? null,
    }])),
    artists: [...artists.values()].sort((left, right) => left.artistName.localeCompare(right.artistName)),
    warnings: TOP_WINDOWS.map(({ key }) => windows[key]?.warning).filter(Boolean),
  };
}

function spotifyClientId(): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) throw new SpotifyInputError("Spotify is not configured.");
  return clientId;
}

function spotifyRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/spotify/callback`;
}

function nextPagePath(nextUrl: string | null | undefined): string | null {
  if (!nextUrl) return null;
  const url = new URL(nextUrl);
  return `${url.pathname.replace(/^\/v1(?=\/)/, "")}${url.search}`;
}

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export class SpotifyInputError extends Error {}
export class SpotifyHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
