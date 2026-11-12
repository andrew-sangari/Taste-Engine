import { getDatabase, type SqlStatement } from "../db/index.ts";
import { normalizePlanConstraints } from "../app/engine-client.js";
import { writeFeedbackRecords, readFeedbackRecords } from "./persistence.ts";
import type { ProfileScope } from "./profiles";

// The feedback backend. Every action on the site is one small, durable
// operation, stored per entity:
//   - a feedback record  → appended to feedback_records (never rewritten);
//   - a save / hold      → one feedback_plans row, last write wins per item;
//   - a check-in outcome → one feedback_history_responses row;
//   - a preference       → one profile_settings row.
// A device sends the operations it has that the server lacks and receives the
// merged state back, so nothing is lost when a save fails and two devices
// never overwrite each other's unrelated changes. Ranking is not touched here:
// the site lays these records over the published scores at read time.

const STATUSES = ["attended-worth-it", "attended-not-worth-it", "wanted-to-attend", "lost-interest", "did-not-attend-logistical", "interested", "withdrawn"];
const REASONS = ["artist", "lineup", "production", "crowd", "venue", "timing", "hassle", "price", "distance", "availability", "calendar", "recovery", "other", "legacy-unknown"];
const SIGNAL_TAGS = ["artist", "venue", "production", "crowd", "timing", "hassle", "price", "lineup"];
const SETTING_KEYS = ["learning", "planning"];
const MAX_OPS = 250;
const MAX_ITEM_JSON = 6_000;

export class FeedbackSyncInputError extends Error {}

export type FeedbackSyncState = {
  records: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  responses: Array<{ historyId: string; state: string; feedbackId: string | null; respondedAt: string }>;
  settings: Record<string, { value: unknown; updatedAt: string }>;
  serverTime: string;
};

export async function readFeedbackSync(profile: ProfileScope): Promise<FeedbackSyncState> {
  await importLegacyState(profile);
  const db = getDatabase();
  const [plans, responses, settings, records] = await Promise.all([
    db.prepare("SELECT item_json FROM feedback_plans WHERE profile_id = ?1 ORDER BY item_id COLLATE \"C\"").bind(profile.id).all<{ item_json: string }>(),
    db.prepare("SELECT history_id, state, feedback_id, responded_at FROM feedback_history_responses WHERE profile_id = ?1 ORDER BY history_id COLLATE \"C\"")
      .bind(profile.id).all<{ history_id: string; state: string; feedback_id: string | null; responded_at: string }>(),
    db.prepare("SELECT key, value_json, updated_at FROM profile_settings WHERE profile_id = ?1").bind(profile.id)
      .all<{ key: string; value_json: string; updated_at: string }>(),
    readFeedbackRecords(profile),
  ]);
  return {
    records,
    plans: (plans.results ?? []).flatMap((row) => { const item = parseObject(row.item_json); return item ? [item] : []; }),
    responses: (responses.results ?? []).map((row) => ({ historyId: row.history_id, state: row.state, feedbackId: row.feedback_id, respondedAt: row.responded_at })),
    settings: Object.fromEntries((settings.results ?? []).flatMap((row) => {
      try { return [[row.key, { value: JSON.parse(row.value_json), updatedAt: row.updated_at }]]; } catch { return []; }
    })),
    serverTime: new Date().toISOString(),
  };
}

export async function applyFeedbackOps(profile: ProfileScope, input: unknown): Promise<{ applied: number; rejected: number }> {
  if (!Array.isArray(input)) throw new FeedbackSyncInputError("ops must be an array.");
  if (input.length > MAX_OPS) throw new FeedbackSyncInputError(`At most ${MAX_OPS} operations per request.`);
  const receivedAt = new Date().toISOString();
  const db = getDatabase();
  const records: Array<Record<string, unknown>> = [];
  const statements: SqlStatement[] = [];
  let rejected = 0;
  for (const raw of input) {
    const op = object(raw);
    if (op.type === "record") {
      const record = cleanRecord(op.record);
      if (record) records.push(record); else rejected += 1;
    } else if (op.type === "plan") {
      const item = cleanPlan(op.item);
      if (!item) { rejected += 1; continue; }
      // Last write wins per item, judged by the device's own timestamp, so a
      // late-arriving older edit can never undo a newer one.
      statements.push(db.prepare(`
        INSERT INTO feedback_plans (profile_id, item_id, saved, held, item_json, updated_at, received_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(profile_id, item_id) DO UPDATE SET
          saved = excluded.saved, held = excluded.held, item_json = excluded.item_json,
          updated_at = excluded.updated_at, received_at = excluded.received_at
        WHERE excluded.updated_at >= feedback_plans.updated_at
      `).bind(profile.id, item.itemId, item.saved ? 1 : 0, item.held ? 1 : 0, JSON.stringify(item), item.updatedAt, receivedAt));
    } else if (op.type === "response") {
      const response = cleanResponse(op.response);
      if (!response) { rejected += 1; continue; }
      // An answered check-in is never downgraded back to a skip.
      statements.push(db.prepare(`
        INSERT INTO feedback_history_responses (profile_id, history_id, state, feedback_id, responded_at, received_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(profile_id, history_id) DO UPDATE SET
          state = excluded.state, feedback_id = excluded.feedback_id,
          responded_at = excluded.responded_at, received_at = excluded.received_at
        WHERE excluded.state = 'resolved' OR feedback_history_responses.state <> 'resolved'
      `).bind(profile.id, response.historyId, response.state, response.feedbackId, response.respondedAt, receivedAt));
    } else if (op.type === "setting") {
      const key = String(op.key ?? "");
      const updatedAt = isoTimestamp(op.updatedAt);
      // `learning` is a switch; `planning` holds the person's plan limits and is
      // stored only after the shared solver has normalized it, so nothing
      // unexpected is ever persisted or handed back to another device.
      const value = key === "learning"
        ? (typeof op.value === "boolean" ? op.value : undefined)
        : key === "planning" && op.value && typeof op.value === "object" && !Array.isArray(op.value)
          ? normalizePlanConstraints(op.value)
          : undefined;
      if (!SETTING_KEYS.includes(key) || !updatedAt || value === undefined) { rejected += 1; continue; }
      statements.push(db.prepare(`
        INSERT INTO profile_settings (profile_id, key, value_json, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(profile_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
        WHERE excluded.updated_at >= profile_settings.updated_at
      `).bind(profile.id, key, JSON.stringify(value), updatedAt));
    } else {
      rejected += 1;
    }
  }
  if (records.length) await writeFeedbackRecords(profile, records, receivedAt);
  if (statements.length) await db.batch(statements);
  return { applied: records.length + statements.length, rejected };
}

// One-time carry-over from the old whole-state blob. Records were already
// fanned out to feedback_records; plans and check-in responses lived only in
// the blob. Runs only while the new tables are empty for this profile.
async function importLegacyState(profile: ProfileScope): Promise<void> {
  const db = getDatabase();
  const existing = await db.prepare(`
    SELECT (SELECT COUNT(*) FROM feedback_plans WHERE profile_id = ?1)
         + (SELECT COUNT(*) FROM feedback_history_responses WHERE profile_id = ?1) AS total
  `).bind(profile.id).first<{ total: number }>();
  if (Number(existing?.total ?? 0) > 0) return;
  let legacy: Record<string, unknown> | null = null;
  try {
    const row = await db.prepare("SELECT state_json FROM feedback_state WHERE profile_id = ?1").bind(profile.id).first<{ state_json: string }>();
    legacy = row?.state_json ? parseObject(row.state_json) : null;
  } catch {
    return;
  }
  if (!legacy) return;
  const ops = [
    ...Object.values(object(legacy.planning)).map((item) => ({ type: "plan", item })),
    ...Object.values(object(legacy.historyResponses)).map((response) => ({ type: "response", response })),
    ...Object.values(object(legacy.records)).map((entry) => ({ type: "record", record: object(entry).record })),
  ];
  if (ops.length) await applyFeedbackOps(profile, ops.slice(0, MAX_OPS));
}

function cleanRecord(value: unknown): Record<string, unknown> | null {
  const input = object(value);
  const feedbackId = text(input.feedbackId, 200);
  const canonicalEventId = text(input.canonicalEventId, 300);
  const eventDateLocal = text(input.eventDateLocal, 10);
  const status = String(input.status ?? "");
  const recordedAt = isoTimestamp(input.recordedAt);
  if (!feedbackId || !canonicalEventId || !eventDateLocal || !/^\d{4}-\d{2}-\d{2}$/.test(eventDateLocal) || !STATUSES.includes(status) || !recordedAt) return null;
  const rating = Number.isInteger(input.rating) && (input.rating as number) >= 1 && (input.rating as number) <= 5 ? input.rating : null;
  const feedbackKeys = cleanKeys(input.feedbackKeys);
  return {
    schemaVersion: 1,
    source: "taste-engine-site",
    feedbackId,
    feedbackSnapshotId: text(input.feedbackSnapshotId, 200) ?? `fs-${canonicalEventId}`,
    canonicalEventId,
    eventDateLocal,
    eventTitleSnapshot: text(input.eventTitleSnapshot, 500) ?? canonicalEventId,
    status,
    reasonCodes: unique(input.reasonCodes).filter((reason) => REASONS.includes(reason)),
    rating,
    signalTags: unique(input.signalTags).filter((tag) => SIGNAL_TAGS.includes(tag)),
    notes: null,
    ...(feedbackKeys ? { feedbackKeys } : {}),
    recordedAt,
  };
}

function cleanPlan(value: unknown): (Record<string, unknown> & { itemId: string; saved: boolean; held: boolean; updatedAt: string }) | null {
  const input = object(value);
  const itemId = text(input.itemId, 300);
  const updatedAt = isoTimestamp(input.updatedAt);
  if (!itemId || !updatedAt) return null;
  const item = { ...input, itemId, saved: input.saved === true, held: input.held === true, updatedAt };
  return JSON.stringify(item).length <= MAX_ITEM_JSON ? item : null;
}

function cleanResponse(value: unknown): { historyId: string; state: string; feedbackId: string | null; respondedAt: string } | null {
  const input = object(value);
  const historyId = text(input.historyId, 300);
  const respondedAt = isoTimestamp(input.respondedAt);
  const state = String(input.state ?? "");
  if (!historyId || !respondedAt || !["dismissed", "resolved"].includes(state)) return null;
  return { historyId, state, feedbackId: text(input.feedbackId, 200), respondedAt };
}

function cleanKeys(value: unknown): Record<string, Array<{ key: string; label: string }>> | null {
  const input = object(value);
  const keys: Record<string, Array<{ key: string; label: string }>> = {};
  for (const [category, entries] of Object.entries(input).slice(0, 8)) {
    if (!/^[a-z]{3,12}$/.test(category) || !Array.isArray(entries)) continue;
    const list = entries.slice(0, 16).map(object)
      .filter((entry) => typeof entry.key === "string" && entry.key.startsWith(`${category}:`) && entry.key.length <= 200)
      .map((entry) => ({ key: String(entry.key), label: String(entry.label ?? "").slice(0, 120) }));
    if (list.length) keys[category] = list;
  }
  return Object.keys(keys).length ? keys : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function parseObject(json: string): Record<string, unknown> | null {
  try { const value = JSON.parse(json); return value && typeof value === "object" && !Array.isArray(value) ? value : null; } catch { return null; }
}
function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}
function unique(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(String))] : [];
}
function isoTimestamp(value: unknown): string | null {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
