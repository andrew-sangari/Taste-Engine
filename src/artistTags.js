// Artist genre tags from a public provider. PURE module: no `node:` imports,
// no file access, so it can be bundled into a Worker. Persistence lives in
// artistTagsCache.js.
//
// With a Last.fm key it uses artist.gettoptags. Without one it falls back to
// MusicBrainz, which needs no key but allows one request per second.
import { normalizeArtistName } from './ranking.js';

const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
const MUSICBRAINZ_API_URL = 'https://musicbrainz.org/ws/2/artist/';
const MUSICBRAINZ_MIN_INTERVAL_MS = 1100;
const MUSICBRAINZ_MIN_SCORE = 95;
const MAX_TAGS = 20;
const MAX_CONSECUTIVE_FAILURES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MUSICBRAINZ_USER_AGENT = 'TasteEngine/0.1 (private personal event importer)';

// Cache and result key. Names that normalize to nothing (non-Latin scripts,
// or a name the normalizer strips entirely) keep a lower-cased literal key.
export function artistTagKey(name) {
  return normalizeArtistName(name) || String(name ?? '').trim().toLowerCase();
}

export async function resolveArtistTags(names, {
  lastFmApiKey = null,
  cache = {},
  now = new Date(),
  fetchImpl = fetch,
  maxLookups = 200,
  ttlDays = 60,
  sleep = defaultSleep,
  timeoutMs = 15_000
} = {}) {
  const provider = lastFmApiKey ? 'lastfm' : 'musicbrainz';
  const providerLabel = lastFmApiKey ? 'Last.fm' : 'MusicBrainz';
  const currentTime = new Date(now);
  const ttlMs = ttlDays * DAY_MS;
  const nextCache = { ...(cache && typeof cache === 'object' ? cache : {}) };
  const tags = new Map();
  const warnings = [];
  const pending = [];
  const seen = new Set();

  for (const rawName of names ?? []) {
    const name = String(rawName ?? '').trim();
    const key = artistTagKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = nextCache[key];
    if (isFresh(entry, currentTime, ttlMs)) tags.set(key, cleanTags(entry.tags));
    else pending.push({ name, key });
  }

  const request = { fetchImpl, timeoutMs, sleep, lastFmApiKey };
  let lookups = 0;
  let consecutiveFailures = 0;
  let deferred = 0;
  let abandoned = 0;

  for (const { name, key } of pending) {
    const stale = Array.isArray(nextCache[key]?.tags) ? cleanTags(nextCache[key].tags) : null;
    if (lookups >= maxLookups) {
      deferred += 1;
      if (stale) tags.set(key, stale);
      continue;
    }
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      abandoned += 1;
      if (stale) tags.set(key, stale);
      continue;
    }
    lookups += 1;
    try {
      const found = lastFmApiKey ? await lastFmTopTags(name, request) : await musicBrainzTags(name, request);
      nextCache[key] = { tags: found, provider, fetchedAt: currentTime.toISOString() };
      tags.set(key, found);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (stale) tags.set(key, stale);
      warnings.push(`No ${providerLabel} tags for ${name}: ${error?.message ?? 'lookup failed'}`);
    }
  }

  if (abandoned > 0) {
    warnings.push(`${providerLabel} tag lookups stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures; ${abandoned} artist(s) left unresolved this run.`);
  }
  if (deferred > 0) {
    warnings.push(`${deferred} artist(s) were not looked up this run (budget of ${maxLookups} ${providerLabel} lookups); they resolve on later runs.`);
  }

  return { tags, cache: nextCache, lookups, provider, warnings };
}

async function lastFmTopTags(artistName, { fetchImpl, timeoutMs, lastFmApiKey }) {
  const url = new URL(LASTFM_API_URL);
  url.searchParams.set('method', 'artist.gettoptags');
  url.searchParams.set('artist', artistName);
  url.searchParams.set('api_key', lastFmApiKey);
  url.searchParams.set('format', 'json');

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await safeJson(response);
  // Error 6 is Last.fm's "artist not found": a definitive empty answer.
  if (Number(body?.error) === 6) return [];
  if (!response.ok || !body || body.error) {
    throw new Error(body?.message ? String(body.message) : `Last.fm tag lookup failed (${response.status})`);
  }

  const raw = Array.isArray(body?.toptags?.tag)
    ? body.toptags.tag
    : body?.toptags?.tag ? [body.toptags.tag] : [];
  return cleanTags(raw.map((tag) => tag?.name));
}

// Response shape verified against the live service:
// { created, count, offset, artists: [{ id, score: <number 0-100>, name,
//   aliases?: [{ name, ... }], tags?: [{ count: <number>, name }] }] }.
// `aliases` and `tags` are omitted when empty, tags arrive unsorted, and a
// busy server answers 503 with { error: "..." }.
async function musicBrainzTags(artistName, { fetchImpl, timeoutMs, sleep }) {
  const url = new URL(MUSICBRAINZ_API_URL);
  url.searchParams.set('query', `artist:"${artistName.replace(/[\\"]/g, '\\$&')}"`);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '3');

  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // One request per second is MusicBrainz's limit. Waiting before every
    // request, the first included, holds across successive calls as well.
    await sleep(MUSICBRAINZ_MIN_INTERVAL_MS);
    response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': MUSICBRAINZ_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status !== 503 && response.status !== 429) break;
  }
  const body = await safeJson(response);
  if (!response.ok || !Array.isArray(body?.artists)) {
    throw new Error(typeof body?.error === 'string' ? body.error : `MusicBrainz lookup failed (${response.status})`);
  }

  const wanted = artistTagKey(artistName);
  const matches = body.artists.filter((artist) => (
    Number(artist?.score) >= MUSICBRAINZ_MIN_SCORE
    && [artist?.name, ...(Array.isArray(artist?.aliases) ? artist.aliases.map((alias) => alias?.name) : [])]
      .some((candidate) => candidate && artistTagKey(candidate) === wanted)
  ));
  // An ambiguous name is not guessed: no confident single match means no tags.
  if (matches.length !== 1) return [];

  const ranked = (Array.isArray(matches[0].tags) ? matches[0].tags : [])
    .filter((tag) => typeof tag?.name === 'string' && Number(tag.count) > 0)
    .sort((left, right) => Number(right.count) - Number(left.count) || left.name.localeCompare(right.name));
  return cleanTags(ranked.map((tag) => tag.name));
}

function isFresh(entry, now, ttlMs) {
  if (!entry || !Array.isArray(entry.tags)) return false;
  const fetchedAt = Date.parse(entry.fetchedAt);
  return Number.isFinite(fetchedAt) && now.getTime() - fetchedAt < ttlMs;
}

function cleanTags(values) {
  const result = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const tag = value.trim().toLowerCase();
    if (tag && !result.includes(tag)) result.push(tag);
    if (result.length >= MAX_TAGS) break;
  }
  return result;
}

function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function safeJson(response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
