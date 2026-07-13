import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { digestValue } from './diagnostics.js';
import { readFeedbackJournal, snapshotFeedbackEvent } from './feedback.js';

export const FEEDBACK_SNAPSHOT_INDEX_PATH = 'data/taste/feedback-snapshots.json';
export const DEFAULT_SNAPSHOT_RETENTION_DAYS = 365;

// The public projection carries event identity plus an opaque snapshot id.
// The evidence entities behind that id (artist/venue/promoter identifiers,
// which are provider-native) stay in the private index and are rehydrated at
// import time; the browser can never supply or fabricate them.
export function buildFeedbackSnapshot(event, vertical) {
  const snapshot = snapshotFeedbackEvent(event, { allowMissing: true });
  if (snapshot.missing.length) return null;
  const feedbackSnapshotId = `fs-${digestValue({
    canonicalEventId: snapshot.canonicalEventId,
    eventDateLocal: snapshot.eventDateLocal,
    eventTitleSnapshot: snapshot.eventTitleSnapshot,
    evidenceSnapshot: snapshot.evidenceSnapshot
  }).slice(0, 24)}`;
  return {
    feedbackSnapshotId,
    public: serializePublicFeedbackSnapshot({
      feedbackSnapshotId,
      canonicalEventId: snapshot.canonicalEventId,
      eventDateLocal: snapshot.eventDateLocal,
      eventTitleSnapshot: snapshot.eventTitleSnapshot,
      vertical
    }),
    private: {
      canonicalEventId: snapshot.canonicalEventId,
      eventDateLocal: snapshot.eventDateLocal,
      eventTitleSnapshot: snapshot.eventTitleSnapshot,
      evidenceSnapshot: snapshot.evidenceSnapshot
    }
  };
}

// Explicit allowlist; never spread the source event. Only Taste-Engine-owned
// or already-public identifiers may appear here.
export function serializePublicFeedbackSnapshot({ feedbackSnapshotId, canonicalEventId, eventDateLocal, eventTitleSnapshot, vertical }) {
  if (!feedbackSnapshotId || !canonicalEventId || !eventDateLocal || !eventTitleSnapshot) return null;
  if (!['music', 'sports'].includes(vertical)) return null;
  return { feedbackSnapshotId, canonicalEventId, eventDateLocal, eventTitleSnapshot, vertical };
}

export async function readSnapshotIndex(path = FEEDBACK_SNAPSHOT_INDEX_PATH) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, snapshots: {} };
    throw new Error(`Could not read feedback snapshot index at ${path}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Feedback snapshot index at ${path} is not valid JSON; refusing to overwrite it.`);
  }
  if (!parsed || parsed.version !== 1 || typeof parsed.snapshots !== 'object' || Array.isArray(parsed.snapshots)) {
    throw new Error(`Feedback snapshot index at ${path} has an unsupported shape; refusing to overwrite it.`);
  }
  return parsed;
}

export async function mergeSnapshotIndex(entries, {
  path = FEEDBACK_SNAPSHOT_INDEX_PATH,
  journalPath = 'data/taste/feedback.jsonl',
  retentionDays = DEFAULT_SNAPSHOT_RETENTION_DAYS,
  now = new Date()
} = {}) {
  const index = await readSnapshotIndex(path);
  const nowIso = new Date(now).toISOString();
  for (const entry of entries) {
    if (!entry?.feedbackSnapshotId) continue;
    const existing = index.snapshots[entry.feedbackSnapshotId];
    index.snapshots[entry.feedbackSnapshotId] = existing
      ? { ...existing, lastSeenAt: nowIso }
      : { ...entry.private, createdAt: nowIso, lastSeenAt: nowIso };
  }
  const referenced = await referencedSnapshotIds(journalPath);
  const cutoff = new Date(now).getTime() - retentionDays * 86_400_000;
  for (const [id, snapshot] of Object.entries(index.snapshots)) {
    if (referenced.has(id)) continue;
    // Retention is anchored to the event date: once an unreferenced event is
    // further past than the retention window, no amount of re-seeing it in an
    // export keeps its snapshot alive.
    const eventTime = Date.parse(`${snapshot.eventDateLocal}T23:59:59`);
    const anchor = Number.isFinite(eventTime) ? eventTime : Date.parse(snapshot.lastSeenAt);
    if (Number.isFinite(anchor) && anchor < cutoff) delete index.snapshots[id];
  }
  await writeAtomicJson(path, index);
  return index;
}

export async function resolveSnapshot(feedbackSnapshotId, path = FEEDBACK_SNAPSHOT_INDEX_PATH) {
  const index = await readSnapshotIndex(path);
  return index.snapshots[String(feedbackSnapshotId ?? '')] ?? null;
}

async function referencedSnapshotIds(journalPath) {
  const ids = new Set();
  try {
    const journal = await readFeedbackJournal(journalPath);
    for (const record of journal.records) {
      if (typeof record.feedbackSnapshotId === 'string') ids.add(record.feedbackSnapshotId);
    }
  } catch {
    // A broken journal must not cause snapshot pruning to widen; keep everything.
    return { has: () => true };
  }
  return ids;
}

async function writeAtomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}
