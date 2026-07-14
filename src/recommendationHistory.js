import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { digestValue } from './diagnostics.js';

export const RECOMMENDATION_HISTORY_PATH = 'data/taste/recommendation-history.json';
export const DEFAULT_HISTORY_RETENTION_DAYS = 90;
export const DEFAULT_SHORTLIST_LIMIT = 5;

const SURFACE_ORDER = Object.freeze(['overview', 'plan-ahead', 'shortlist']);

export function buildRecommendationHistory({
  projection,
  previous = null,
  now = new Date(),
  retentionDays = DEFAULT_HISTORY_RETENTION_DAYS,
  shortlistLimit = DEFAULT_SHORTLIST_LIMIT
}) {
  const nowIso = new Date(now).toISOString();
  const state = normalizeHistoryState(previous ?? projection?.recentHistory, nowIso);
  const surfaced = collectSurfacedItems(projection, shortlistLimit);

  for (const candidate of surfaced) {
    const existing = state.items[candidate.historyId];
    state.items[candidate.historyId] = existing
      ? {
        ...existing,
        title: candidate.title,
        locationLabel: candidate.locationLabel,
        feedbackSnapshotId: candidate.feedbackSnapshotId ?? existing.feedbackSnapshotId ?? null,
        lastShownAt: nowIso,
        surfaces: orderedSurfaces([...existing.surfaces, ...candidate.surfaces]),
        bestRank: bestRank(existing.bestRank, candidate.bestRank)
      }
      : { ...candidate, firstShownAt: nowIso, lastShownAt: nowIso };
  }

  const cutoff = localDateKey(new Date(new Date(now).getTime() - retentionDays * 86_400_000));
  for (const [historyId, item] of Object.entries(state.items)) {
    if (!isHistoryItem(item) || item.dateLocal < cutoff) delete state.items[historyId];
  }
  state.updatedAt = nowIso;
  return state;
}

export function serializeRecentHistory(state) {
  return Object.values(state?.items ?? {})
    .filter(isHistoryItem)
    .map((item) => ({
      historyId: item.historyId,
      canonicalEventId: item.canonicalEventId,
      feedbackSnapshotId: item.feedbackSnapshotId ?? null,
      vertical: item.vertical,
      title: item.title,
      dateLocal: item.dateLocal,
      locationLabel: item.locationLabel ?? null,
      firstShownAt: item.firstShownAt,
      lastShownAt: item.lastShownAt,
      surfaces: orderedSurfaces(item.surfaces),
      bestRank: Number.isInteger(item.bestRank) ? item.bestRank : null
    }))
    .sort((left, right) => right.dateLocal.localeCompare(left.dateLocal)
      || surfacePriority(left.surfaces) - surfacePriority(right.surfaces)
      || (left.bestRank ?? Number.MAX_SAFE_INTEGER) - (right.bestRank ?? Number.MAX_SAFE_INTEGER)
      || left.historyId.localeCompare(right.historyId));
}

export async function readRecommendationHistory(path = RECOMMENDATION_HISTORY_PATH) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || parsed.version !== 1 || typeof parsed.items !== 'object' || Array.isArray(parsed.items)) {
      throw new Error('unsupported shape');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, updatedAt: null, items: {} };
    throw new Error(`Could not read recommendation history: ${error.message}`);
  }
}

export async function updateProjectionHistory({
  projection,
  historyPath = RECOMMENDATION_HISTORY_PATH,
  now = new Date(),
  retentionDays = DEFAULT_HISTORY_RETENTION_DAYS,
  shortlistLimit = DEFAULT_SHORTLIST_LIMIT
}) {
  const privateHistory = await readRecommendationHistory(historyPath);
  const previous = Object.keys(privateHistory.items).length ? privateHistory : projection?.recentHistory;
  const history = buildRecommendationHistory({ projection, previous, now, retentionDays, shortlistLimit });
  await writeAtomicJson(historyPath, history);
  projection.recentHistory = serializeRecentHistory(history);
  return { projection, history };
}

export function collectSurfacedItems(projection, shortlistLimit = DEFAULT_SHORTLIST_LIMIT) {
  const collected = new Map();
  const add = (item, vertical, surface, rank) => {
    const candidate = toHistoryCandidate(item, vertical, surface, rank);
    if (!candidate) return;
    const existing = collected.get(candidate.historyId);
    collected.set(candidate.historyId, existing
      ? { ...existing, surfaces: orderedSurfaces([...existing.surfaces, surface]), bestRank: bestRank(existing.bestRank, rank), feedbackSnapshotId: candidate.feedbackSnapshotId ?? existing.feedbackSnapshotId }
      : candidate);
  };

  (projection?.overview ?? []).forEach((item, index) => add(item, item?.vertical, 'overview', index + 1));
  (projection?.overviewPlanAhead ?? []).forEach((item, index) => add(item, item?.vertical, 'plan-ahead', index + 1));
  for (const [key, vertical] of [['events', 'music'], ['sports', 'sports'], ['movies', 'movies']]) {
    (projection?.[key] ?? []).slice(0, shortlistLimit).forEach((item, index) => add(item, vertical, 'shortlist', index + 1));
  }
  return [...collected.values()];
}

function toHistoryCandidate(item, vertical, surface, rank) {
  if (!item || !['music', 'sports', 'movies'].includes(vertical)) return null;
  const dateLocal = String(item.startLocal ?? item.releaseDate ?? '').slice(0, 10);
  const canonicalEventId = String(item.feedbackSnapshot?.canonicalEventId ?? item.id ?? '');
  const title = String(item.title ?? item.name ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLocal) || !canonicalEventId || !title) return null;
  const historyId = `rh-${digestValue({ vertical, canonicalEventId, dateLocal }).slice(0, 24)}`;
  return {
    historyId,
    canonicalEventId,
    feedbackSnapshotId: ['music', 'sports'].includes(vertical) ? item.feedbackSnapshot?.feedbackSnapshotId ?? null : null,
    vertical,
    title,
    dateLocal,
    locationLabel: locationLabel(item.venue),
    firstShownAt: '',
    lastShownAt: '',
    surfaces: [surface],
    bestRank: rank
  };
}

function normalizeHistoryState(input, nowIso) {
  if (Array.isArray(input)) {
    return { version: 1, updatedAt: nowIso, items: Object.fromEntries(input.filter(isHistoryItem).map((item) => [item.historyId, { ...item }])) };
  }
  if (input?.version === 1 && input.items && typeof input.items === 'object') {
    return { version: 1, updatedAt: input.updatedAt ?? null, items: { ...input.items } };
  }
  return { version: 1, updatedAt: nowIso, items: {} };
}

function isHistoryItem(item) {
  return Boolean(item && typeof item.historyId === 'string' && typeof item.canonicalEventId === 'string'
    && ['music', 'sports', 'movies'].includes(item.vertical) && /^\d{4}-\d{2}-\d{2}$/.test(String(item.dateLocal))
    && typeof item.title === 'string' && Array.isArray(item.surfaces));
}

function orderedSurfaces(values) {
  const unique = new Set(values.filter((value) => SURFACE_ORDER.includes(value)));
  return SURFACE_ORDER.filter((value) => unique.has(value));
}

function bestRank(left, right) {
  const ranks = [left, right].filter((value) => Number.isInteger(value) && value > 0);
  return ranks.length ? Math.min(...ranks) : null;
}

function surfacePriority(surfaces) {
  const indexes = (surfaces ?? []).map((surface) => SURFACE_ORDER.indexOf(surface)).filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : SURFACE_ORDER.length;
}

function locationLabel(venue) {
  if (!venue) return null;
  return [venue.name, venue.city].filter(Boolean).join(' · ') || null;
}

function localDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function writeAtomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}
