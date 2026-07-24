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
    return JSON.parse(row.state_json);
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

function assertFeedbackState(value: unknown): asserts value is { version: 2 } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PersistenceInputError("Feedback state must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== 2) throw new PersistenceInputError("Unsupported feedback state version.");
  for (const key of ["planning", "historyResponses", "records", "exportBatches"]) {
    if (!input[key] || typeof input[key] !== "object" || Array.isArray(input[key])) {
      throw new PersistenceInputError(`Feedback state field ${key} must be an object.`);
    }
  }
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
