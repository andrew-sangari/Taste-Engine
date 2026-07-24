import { getD1 } from "../db";

const MAX_FEEDBACK_STATE_BYTES = 1_500_000;
const MAX_PROJECTION_BYTES = 3_000_000;

export async function readFeedbackState(ownerEmail: string): Promise<unknown | null> {
  const row = await getD1()
    .prepare("SELECT state_json FROM feedback_state WHERE owner_email = ?1")
    .bind(ownerEmail)
    .first<{ state_json: string }>();
  if (!row?.state_json) return null;
  try {
    const state = JSON.parse(row.state_json) as Record<string, unknown>;
    const records = await readFeedbackRecords(ownerEmail);
    if (!records.length || !state || typeof state !== "object") return state;
    return {
      ...state,
      records: Object.fromEntries(records.map((record) => [String(record.feedbackId), { record, firstExportTriggeredAt: null, exportBatchId: null }])),
    };
  } catch {
    return null;
  }
}

export async function writeFeedbackState(ownerEmail: string, state: unknown): Promise<string> {
  assertFeedbackState(state);
  const stateJson = JSON.stringify(state);
  if (new TextEncoder().encode(stateJson).byteLength > MAX_FEEDBACK_STATE_BYTES) {
    throw new PersistenceInputError("Feedback state is too large.");
  }
  const updatedAt = new Date().toISOString();
  await writeFeedbackRecords(ownerEmail, feedbackRecordsFromState(state), updatedAt);
  await getD1()
    .prepare(`
      INSERT INTO feedback_state (owner_email, state_json, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(owner_email) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `)
    .bind(ownerEmail, stateJson, updatedAt)
    .run();
  return updatedAt;
}

export async function readFeedbackRecords(ownerEmail: string): Promise<Array<Record<string, unknown>>> {
  const result = await getD1().prepare(`
    SELECT record_json FROM feedback_records WHERE owner_email = ?1 ORDER BY recorded_at ASC, feedback_id ASC
  `).bind(ownerEmail).all<{ record_json: string }>();
  return (result.results ?? []).flatMap((row) => {
    try {
      const parsed = JSON.parse(row.record_json);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed as Record<string, unknown>] : [];
    } catch { return []; }
  });
}

export async function writeFeedbackRecords(ownerEmail: string, records: Array<Record<string, unknown>>, receivedAt = new Date().toISOString()): Promise<void> {
  if (!records.length) return;
  const projection = await readActiveProjection();
  const statements = records.map((record) => enrichFeedbackEvidence(record, projection))
    .filter((record) => safeText(record.feedbackId) && safeText(record.canonicalEventId) && safeText(record.eventDateLocal) && safeText(record.status) && safeText(record.recordedAt))
    .map((record) => getD1().prepare(`
      INSERT INTO feedback_records (owner_email, feedback_id, canonical_event_id, event_date_local, status, recorded_at, record_json, evidence_json, received_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(owner_email, feedback_id) DO NOTHING
    `).bind(
      ownerEmail,
      String(record.feedbackId),
      String(record.canonicalEventId),
      String(record.eventDateLocal),
      String(record.status),
      String(record.recordedAt),
      JSON.stringify(record),
      record.evidenceSnapshot ? JSON.stringify(record.evidenceSnapshot) : null,
      receivedAt,
    ));
  if (statements.length) await getD1().batch(statements);
}

function enrichFeedbackEvidence(record: Record<string, unknown>, projection: unknown): Record<string, unknown> {
  if (record.evidenceSnapshot && typeof record.evidenceSnapshot === "object" && !Array.isArray(record.evidenceSnapshot)) return record;
  const input = projection && typeof projection === "object" && !Array.isArray(projection) ? projection as Record<string, unknown> : {};
  const candidates = [...array(input.events), ...array(input.sports)];
  const candidate = candidates.find((item) => {
    const value = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const snapshot = value.feedbackSnapshot && typeof value.feedbackSnapshot === "object" ? value.feedbackSnapshot as Record<string, unknown> : {};
    return String(snapshot.feedbackSnapshotId ?? "") === String(record.feedbackSnapshotId ?? "")
      || (String(value.id ?? "") === String(record.canonicalEventId ?? "") && String(value.startLocal ?? "").slice(0, 10) === String(record.eventDateLocal ?? ""));
  }) as Record<string, unknown> | undefined;
  if (!candidate) return record;
  const venue = candidate.venue && typeof candidate.venue === "object" ? candidate.venue as Record<string, unknown> : {};
  const series = candidate.series && typeof candidate.series === "object" ? candidate.series as Record<string, unknown> : {};
  const artists = array(candidate.matchedArtists).map((artist) => artist && typeof artist === "object" ? artist as Record<string, unknown> : {})
    .map((artist) => artist.spotifyArtistId ?? artist.canonicalArtistId).filter((id): id is string => typeof id === "string" && Boolean(id));
  return {
    ...record,
    evidenceSnapshot: {
      canonicalArtistIds: [...new Set(artists)].sort(),
      canonicalVenueId: typeof venue.sourceId === "string" ? venue.sourceId : null,
      promoterOrSeriesIds: typeof series.id === "string" ? [series.id] : [],
      eventShape: typeof candidate.eventType === "string" ? candidate.eventType : candidate.source === "mlb" ? "baseball" : null,
    },
  };
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

export async function readActiveProjection(): Promise<unknown | null> {
  const row = await getD1()
    .prepare(`
      SELECT payload_json
      FROM recommendation_snapshots
      WHERE active = 1
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .first<{ payload_json: string }>();
  if (!row?.payload_json) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

export async function publishProjection(payload: unknown): Promise<{
  snapshotId: string;
  payloadHash: string;
  generatedAt: string;
}> {
  assertProjection(payload);
  const payloadJson = JSON.stringify(payload);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_PROJECTION_BYTES) {
    throw new PersistenceInputError("Projection is too large.");
  }
  const generatedAt = String((payload as { generatedAt: string }).generatedAt);
  const payloadHash = await sha256Hex(payloadJson);
  const snapshotId = `projection-${payloadHash.slice(0, 24)}`;
  const createdAt = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare("UPDATE recommendation_snapshots SET active = 0 WHERE active = 1"),
    db.prepare(`
      INSERT INTO recommendation_snapshots
        (snapshot_id, generated_at, payload_json, payload_hash, created_at, active)
      VALUES (?1, ?2, ?3, ?4, ?5, 1)
      ON CONFLICT(snapshot_id) DO UPDATE SET
        generated_at = excluded.generated_at,
        payload_json = excluded.payload_json,
        payload_hash = excluded.payload_hash,
        created_at = excluded.created_at,
        active = 1
    `).bind(snapshotId, generatedAt, payloadJson, payloadHash, createdAt),
  ]);
  return { snapshotId, payloadHash, generatedAt };
}

export function hasRefreshAuthorization(request: Request): boolean {
  const configured = process.env.TASTE_REFRESH_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return configured.length >= 24 && constantTimeEqual(configured, supplied);
}

function assertFeedbackState(value: unknown): asserts value is { version: 2 | 3 } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PersistenceInputError("Feedback state must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== 2 && input.version !== 3) throw new PersistenceInputError("Unsupported feedback state version.");
  for (const key of ["planning", "historyResponses", "records", "exportBatches"]) {
    if (!input[key] || typeof input[key] !== "object" || Array.isArray(input[key])) {
      throw new PersistenceInputError(`Feedback state field ${key} must be an object.`);
    }
  }
}

function feedbackRecordsFromState(value: unknown): Array<Record<string, unknown>> {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const entries = state.records && typeof state.records === "object" && !Array.isArray(state.records)
    ? Object.values(state.records as Record<string, unknown>) : [];
  return entries.flatMap((entry) => {
    const wrapped = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const record = wrapped.record;
    return record && typeof record === "object" && !Array.isArray(record) ? [record as Record<string, unknown>] : [];
  });
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_000;
}

function assertProjection(value: unknown): asserts value is { generatedAt: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PersistenceInputError("Projection must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (!isIsoDate(input.generatedAt)) throw new PersistenceInputError("Projection generatedAt must be an ISO date.");
  if (!Array.isArray(input.events)) throw new PersistenceInputError("Projection events must be an array.");
  if (input.movies != null && !Array.isArray(input.movies)) throw new PersistenceInputError("Projection movies must be an array.");
  if (input.sports != null && !Array.isArray(input.sports)) throw new PersistenceInputError("Projection sports must be an array.");
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

export class PersistenceInputError extends Error {}
