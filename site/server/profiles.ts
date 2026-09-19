import type { ChatGPTUser } from "../app/chatgpt-auth";
import { getD1 } from "../db/index.ts";
import { deploymentEnvironment } from "./release.ts";

const LEGACY_OWNER_KEY = "legacy-default";

export type ProfileScope = {
  id: string;
  email: string;
  displayName: string;
  legacyDefault: boolean;
};

export async function profileScopeForUser(user: ChatGPTUser): Promise<ProfileScope> {
  const email = canonicalEmail(user.email);
  assertAllowedProfileEmail(email);
  return {
    id: await profileIdForEmail(email),
    email,
    displayName: user.displayName.trim() || email,
    legacyDefault: canonicalEmail(process.env.TASTE_LEGACY_PROFILE_EMAIL ?? "") === email,
  };
}

export async function resolveProfile(user: ChatGPTUser): Promise<ProfileScope> {
  const candidate = await profileScopeForUser(user);
  const identityHash = await sha256Hex(candidate.email);
  const db = getD1();
  if (candidate.legacyDefault) {
    const existingLegacyOwner = await db.prepare(`
      SELECT profile_id
      FROM profiles
      WHERE legacy_owner_key = ?1
    `).bind(LEGACY_OWNER_KEY).first<{ profile_id: string }>();
    if (existingLegacyOwner && existingLegacyOwner.profile_id !== candidate.id) {
      throw new ProfileAccessError("The legacy profile is already bound to a different authenticated account.");
    }
  }
  const now = new Date().toISOString();
  await db.prepare(candidate.legacyDefault ? `
    INSERT INTO profiles
      (profile_id, identity_hash, owner_email, display_name, enabled, legacy_default, legacy_owner_key, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, 1, 1, ?5, ?6, ?6)
    ON CONFLICT(profile_id) DO UPDATE SET
      owner_email = excluded.owner_email,
      display_name = excluded.display_name,
      legacy_default = 1,
      legacy_owner_key = excluded.legacy_owner_key,
      updated_at = excluded.updated_at
  ` : `
    INSERT INTO profiles
      (profile_id, identity_hash, owner_email, display_name, enabled, legacy_default, legacy_owner_key, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, 1, 0, NULL, ?5, ?5)
    ON CONFLICT(profile_id) DO UPDATE SET
      owner_email = excluded.owner_email,
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
  `).bind(
    candidate.id,
    identityHash,
    candidate.email,
    candidate.displayName,
    ...(candidate.legacyDefault ? [LEGACY_OWNER_KEY] : []),
    now,
  ).run();
  const profile = await readProfile(candidate.id);
  if (!profile) throw new ProfileAccessError("This Taste Engine profile is disabled.");
  await claimLegacyRows(profile);
  return profile;
}

export async function profileIdForEmail(email: string): Promise<string> {
  const identityHash = await sha256Hex(canonicalEmail(email));
  return `profile_${identityHash.slice(0, 24)}`;
}

export async function readProfile(profileId: string): Promise<ProfileScope | null> {
  assertProfileId(profileId);
  const row = await getD1().prepare(`
    SELECT profile_id, owner_email, display_name, legacy_default, enabled
    FROM profiles
    WHERE profile_id = ?1
  `).bind(profileId).first<{
    profile_id: string;
    owner_email: string;
    display_name: string;
    legacy_default: number;
    enabled: number;
  }>();
  if (!row || !row.enabled) return null;
  return {
    id: row.profile_id,
    email: canonicalEmail(row.owner_email),
    displayName: row.display_name,
    legacyDefault: Boolean(row.legacy_default),
  };
}

export async function listConnectedProfiles(): Promise<ProfileScope[]> {
  const result = await getD1().prepare(`
    SELECT p.profile_id, p.owner_email, p.display_name, p.legacy_default
    FROM profiles p
    INNER JOIN spotify_tokens t ON t.profile_id = p.profile_id
    WHERE p.enabled = 1
    ORDER BY p.profile_id
  `).all<{
    profile_id: string;
    owner_email: string;
    display_name: string;
    legacy_default: number;
  }>();
  return (result.results ?? []).map((row) => ({
    id: row.profile_id,
    email: canonicalEmail(row.owner_email),
    displayName: row.display_name,
    legacyDefault: Boolean(row.legacy_default),
  })).filter((profile) => allowedProfileEmail(profile.email));
}

export function assertProfileId(value: string): void {
  if (!/^profile_[a-f0-9]{24}$/.test(value)) throw new ProfileAccessError("Invalid profile identity.");
}

async function claimLegacyRows(profile: ProfileScope): Promise<void> {
  const db = getD1();
  const ownerScopedTables = [
    "feedback_state",
    "feedback_records",
    "recommendation_misses",
    "hosted_taste_snapshots",
    "spotify_oauth_states",
    "spotify_tokens",
    "spotify_top_artist_windows",
    "spotify_playlist_selections",
  ];
  const statements = ownerScopedTables.map((table) => db.prepare(`
    UPDATE ${table}
    SET profile_id = ?1
    WHERE profile_id IS NULL AND lower(owner_email) = ?2
  `).bind(profile.id, profile.email));
  if (profile.legacyDefault) {
    statements.push(
      db.prepare("UPDATE recommendation_snapshots SET profile_id = ?1 WHERE profile_id IS NULL").bind(profile.id),
      db.prepare("UPDATE source_runs SET profile_id = ?1 WHERE profile_id IS NULL").bind(profile.id),
    );
  }
  await db.batch(statements);
}

function canonicalEmail(value: string): string {
  return value.trim().toLowerCase();
}

function assertAllowedProfileEmail(email: string): void {
  if (!allowedProfileEmail(email)) throw new ProfileAccessError("This account is not allowed to use Taste Engine.");
}

function allowedProfileEmail(email: string): boolean {
  const configured = String(process.env.TASTE_ALLOWED_PROFILE_EMAILS ?? "")
    .split(",")
    .map(canonicalEmail)
    .filter(Boolean);
  if (!configured.length) {
    if (deploymentEnvironment() === "production") {
      return false;
    }
    return true;
  }
  return configured.includes(canonicalEmail(email));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class ProfileAccessError extends Error {}
