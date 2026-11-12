import { getDatabase } from "../db/index.ts";
import type { ProfileScope } from "./profiles";
import { releaseMetadata } from "./release.ts";

// Postgres would store more, but a projection is read whole on every page
// load: keep the published row under 2 MB, the size the pipeline is validated for.
const MAX_PROJECTION_BYTES = 1_900_000;

export async function readFeedbackRecords(profile: ProfileScope): Promise<Array<Record<string, unknown>>> {
  const result = await getDatabase().prepare(`
    SELECT record_json FROM feedback_records WHERE profile_id = ?1 ORDER BY recorded_at COLLATE "C" ASC, feedback_id COLLATE "C" ASC
  `).bind(profile.id).all<{ record_json: string }>();
  return (result.results ?? []).flatMap((row) => {
    try {
      const parsed = JSON.parse(row.record_json);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed as Record<string, unknown>] : [];
    } catch { return []; }
  });
}

export async function writeFeedbackRecords(profile: ProfileScope, records: Array<Record<string, unknown>>, receivedAt = new Date().toISOString()): Promise<void> {
  if (!records.length) return;
  const projection = await readActiveProjection(profile.id);
  const statements = records.map((record) => enrichFeedbackEvidence(record, projection))
    .filter((record) => safeText(record.feedbackId) && safeText(record.canonicalEventId) && safeText(record.eventDateLocal) && safeText(record.status) && safeText(record.recordedAt))
    .map((record) => getDatabase().prepare(`
      INSERT INTO feedback_records (owner_email, profile_id, feedback_id, canonical_event_id, event_date_local, status, recorded_at, record_json, evidence_json, received_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      ON CONFLICT(profile_id, feedback_id) DO NOTHING
    `).bind(
      profile.email,
      profile.id,
      String(record.feedbackId),
      String(record.canonicalEventId),
      String(record.eventDateLocal),
      String(record.status),
      String(record.recordedAt),
      JSON.stringify(record),
      record.evidenceSnapshot ? JSON.stringify(record.evidenceSnapshot) : null,
      receivedAt,
    ));
  if (statements.length) await getDatabase().batch(statements);
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
  // Keys the client could not freeze itself (an older client, an import).
  if (!record.feedbackKeys && candidate.feedbackKeys && typeof candidate.feedbackKeys === "object") {
    record = { ...record, feedbackKeys: candidate.feedbackKeys };
  }
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
      eventShape: typeof candidate.eventType === "string" ? candidate.eventType : candidate.league === "nfl" ? "football" : candidate.source === "mlb" ? "baseball" : null,
    },
  };
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

export async function readActiveProjection(profileId: string): Promise<unknown | null> {
  const row = await getDatabase()
    .prepare(`
      SELECT payload_json
      FROM recommendation_snapshots
      WHERE profile_id = ?1 AND active = 1
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(profileId)
    .first<{ payload_json: string }>();
  if (!row?.payload_json) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

export async function publishProjection(profileId: string, payload: unknown): Promise<{
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
  const snapshotId = `${profileId}-projection-${payloadHash.slice(0, 24)}`;
  const createdAt = new Date().toISOString();
  const codeVersion = releaseMetadata().release;
  const dataSchemaVersion = Number((payload as { schemaVersion?: unknown }).schemaVersion ?? 5);
  const db = getDatabase();
  await db.batch([
    db.prepare("UPDATE recommendation_snapshots SET active = 0 WHERE profile_id = ?1 AND active = 1").bind(profileId),
    db.prepare(`
      INSERT INTO recommendation_snapshots
        (snapshot_id, profile_id, generated_at, payload_json, payload_hash, code_version, data_schema_version, created_at, active)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
      ON CONFLICT(snapshot_id) DO UPDATE SET
        generated_at = excluded.generated_at,
        payload_json = excluded.payload_json,
        payload_hash = excluded.payload_hash,
        code_version = excluded.code_version,
        data_schema_version = excluded.data_schema_version,
        created_at = excluded.created_at,
        active = 1
    `).bind(snapshotId, profileId, generatedAt, payloadJson, payloadHash, codeVersion, dataSchemaVersion, createdAt),
  ]);
  return { snapshotId, payloadHash, generatedAt };
}

export function hasRefreshAuthorization(request: Request): boolean {
  const configured = process.env.TASTE_REFRESH_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return configured.length >= 24 && constantTimeEqual(configured, supplied);
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
