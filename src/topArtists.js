// Spotify Top Artists as replaceable cache state. Each affinity window expires
// seven days after it was fetched; a failed window may reuse a still-valid
// cached one, and an expired window contributes nothing.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSpotifyTopArtists, purgeSpotifyDerivedData, resolveSpotifyStateDir } from './spotifyClient.js';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const TOP_ARTIST_WINDOWS = Object.freeze([
  { key: 'shortTerm', apiRange: 'short_term', weight: 0.40 },
  { key: 'mediumTerm', apiRange: 'medium_term', weight: 0.35 },
  { key: 'longTerm', apiRange: 'long_term', weight: 0.25 }
]);

export function defaultTopArtistsCachePath() {
  return join(resolveSpotifyStateDir(), 'top-artists.json');
}

export async function refreshTopArtists({
  limit = 50,
  now = new Date(),
  cachePath = defaultTopArtistsCachePath(),
  dataDir = dirname(cachePath),
  fetchWindow = getSpotifyTopArtists,
  purge = purgeSpotifyDerivedData,
  ttlMs = DEFAULT_TTL_MS
} = {}) {
  const currentTime = new Date(now);
  const previous = readTopArtistsCache(cachePath);
  const windows = {};
  let authenticationFailure = null;

  for (const definition of TOP_ARTIST_WINDOWS) {
    try {
      const body = await fetchWindow(definition.apiRange, limit);
      windows[definition.key] = freshWindow(body, currentTime, ttlMs, limit);
    } catch (error) {
      if (isAuthenticationFailure(error)) authenticationFailure ??= error;
      const cached = reusableWindow(previous?.windows?.[definition.key], currentTime);
      windows[definition.key] = cached
        ? { ...cached, status: 'cached', warning: error.message }
        : unavailableWindow(error.message);
    }
  }

  if (authenticationFailure) {
    purge({ dataDir, extraPaths: [cachePath] });
    return unavailableResponse(currentTime, `Spotify authorization is missing or expired. Run \`npm run spotify:connect\` to refresh Top Artists. ${authenticationFailure.message}`);
  }

  const response = buildTopArtistsResponse(windows, currentTime);
  if (response.status === 'unavailable') {
    purgeExpiredCache(cachePath, previous, currentTime);
  } else {
    writeTopArtistsCache(cachePath, { version: 1, generatedAt: currentTime.toISOString(), windows });
  }
  return response;
}

export function buildTopArtistsResponse(windows, generatedAt = new Date()) {
  const usable = TOP_ARTIST_WINDOWS.filter(({ key }) => ['fresh', 'cached'].includes(windows[key]?.status));
  const unavailable = TOP_ARTIST_WINDOWS.filter(({ key }) => windows[key]?.status === 'unavailable');
  const status = usable.length === 0
    ? 'unavailable'
    : unavailable.length || usable.some(({ key }) => windows[key].status === 'cached') ? 'partial' : 'active';
  const artistMap = new Map();

  for (const definition of TOP_ARTIST_WINDOWS) {
    const window = windows[definition.key];
    if (!['fresh', 'cached'].includes(window?.status)) continue;
    for (const item of window.items ?? []) {
      const artistId = String(item.artistId ?? item.id ?? '').trim();
      const artistName = String(item.artistName ?? item.name ?? '').trim();
      if (!artistId || !artistName) continue;
      const current = artistMap.get(artistId) ?? {
        artistId,
        artistName,
        shortTermRank: null,
        mediumTermRank: null,
        longTermRank: null
      };
      current[`${definition.key}Rank`] = Number(item.rank);
      artistMap.set(artistId, current);
    }
  }

  return {
    status,
    generatedAt: new Date(generatedAt).toISOString(),
    windows: toPublicWindows(windows),
    artists: [...artistMap.values()].sort((left, right) => left.artistName.localeCompare(right.artistName)),
    warnings: TOP_ARTIST_WINDOWS.map(({ key }) => windows[key]?.warning).filter(Boolean)
  };
}

export function readTopArtistsCache(cachePath = defaultTopArtistsCachePath()) {
  try {
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

// Freshness only (no artists, no ranks): safe for status output and source health.
export function readTopArtistsWindowHealth({ cachePath = defaultTopArtistsCachePath(), now = new Date() } = {}) {
  const cache = readTopArtistsCache(cachePath);
  const currentTime = new Date(now);
  return Object.fromEntries(TOP_ARTIST_WINDOWS.map(({ key }) => {
    const window = cache?.windows?.[key];
    const hasItems = Array.isArray(window?.items) && window.items.length > 0;
    const status = !window?.expiresAt || !hasItems
      ? 'unavailable'
      : new Date(window.expiresAt).getTime() <= currentTime.getTime() ? 'expired' : 'cached';
    return [key, {
      status,
      fetchedAt: status === 'unavailable' ? null : window.fetchedAt ?? null,
      expiresAt: status === 'unavailable' ? null : window.expiresAt
    }];
  }));
}

export function removeTopArtistsCache(cachePath = defaultTopArtistsCachePath()) {
  removeIfPresent(cachePath);
}

function freshWindow(body, now, ttlMs, limit) {
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const items = (body?.items ?? [])
    .slice(0, Math.min(50, Math.max(1, Number(limit) || 50)))
    .map((artist, index) => ({
      artistId: String(artist.id ?? '').trim(),
      artistName: String(artist.name ?? '').trim(),
      rank: index + 1
    }))
    .filter((artist) => artist.artistId && artist.artistName);
  return { status: 'fresh', warning: null, fetchedAt, expiresAt, items };
}

function reusableWindow(window, now) {
  if (!window?.expiresAt || !(new Date(window.expiresAt).getTime() > now.getTime())) return null;
  if (!Array.isArray(window.items) || window.items.length === 0) return null;
  return { status: 'cached', warning: null, fetchedAt: window.fetchedAt ?? null, expiresAt: window.expiresAt, items: window.items };
}

function unavailableWindow(warning) {
  return { status: 'unavailable', warning: String(warning), fetchedAt: null, expiresAt: null, items: [] };
}

function unavailableResponse(generatedAt, warning) {
  return {
    status: 'unavailable',
    generatedAt: generatedAt.toISOString(),
    windows: toPublicWindows(Object.fromEntries(TOP_ARTIST_WINDOWS.map(({ key }) => [key, unavailableWindow(warning)]))),
    artists: [],
    warnings: [warning]
  };
}

function toPublicWindows(windows) {
  return Object.fromEntries(TOP_ARTIST_WINDOWS.map(({ key }) => [key, {
    status: windows[key]?.status ?? 'unavailable',
    warning: windows[key]?.warning ?? null,
    fetchedAt: windows[key]?.fetchedAt ?? null,
    expiresAt: windows[key]?.expiresAt ?? null
  }]));
}

function writeTopArtistsCache(cachePath, value) {
  mkdirSync(dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, cachePath);
}

function purgeExpiredCache(cachePath, previous, now) {
  const hasReusable = TOP_ARTIST_WINDOWS.some(({ key }) => reusableWindow(previous?.windows?.[key], now));
  if (!hasReusable) removeIfPresent(cachePath);
}

function removeIfPresent(path) {
  try {
    if (existsSync(path)) rmSync(path, { force: true });
  } catch {
    // The cache is replaceable; a failed removal is retried on the next run.
  }
}

function isAuthenticationFailure(error) {
  return [401, 403].includes(Number(error?.statusCode));
}
