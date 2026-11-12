import { bigint, index, integer, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

// Storage conventions, kept from the SQLite schema so the server code reads and
// writes exactly what it always did: flags and counts are `integer` (0/1, not
// boolean), timestamps are ISO-8601 `text`, and JSON is stored as `text`.
// The one type that differs is `expires_at` on the three tables that hold
// `Date.now()` milliseconds: SQLite integers are 64-bit, Postgres `integer` is
// 32-bit, so those columns are `bigint` (read back as JS numbers).
const epochMilliseconds = (name: string) => bigint(name, { mode: "number" });

// Every table calls `.enableRLS()` and defines no policy. Supabase serves the
// `public` schema through its REST API to anyone holding the public anon key;
// with row level security on and no policies that API can read and write
// nothing. The server connects directly as the table owner, which RLS does not
// restrict, so application queries are unaffected. A new table must do the same
// (tests/migration.test.mjs fails if one does not).

export const profiles = pgTable("profiles", {
  profileId: text("profile_id").primaryKey(),
  identityHash: text("identity_hash").notNull(),
  ownerEmail: text("owner_email").notNull(),
  displayName: text("display_name").notNull(),
  enabled: integer("enabled").notNull().default(1),
  legacyDefault: integer("legacy_default").notNull().default(0),
  legacyOwnerKey: text("legacy_owner_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("profiles_identity_hash_idx").on(table.identityHash),
  uniqueIndex("profiles_legacy_owner_key_idx").on(table.legacyOwnerKey),
  index("profiles_owner_email_idx").on(table.ownerEmail),
]).enableRLS();

export const feedbackState = pgTable("feedback_state", {
  ownerEmail: text("owner_email").primaryKey(),
  profileId: text("profile_id"),
  stateJson: text("state_json").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("feedback_state_profile_id_idx").on(table.profileId),
]).enableRLS();

// Feedback is append-only so ranking can replay an inspectable outcome trail
// without depending on a browser-shaped state blob.
export const feedbackRecords = pgTable("feedback_records", {
  ownerEmail: text("owner_email").notNull(),
  profileId: text("profile_id"),
  feedbackId: text("feedback_id").notNull(),
  canonicalEventId: text("canonical_event_id").notNull(),
  eventDateLocal: text("event_date_local").notNull(),
  status: text("status").notNull(),
  recordedAt: text("recorded_at").notNull(),
  recordJson: text("record_json").notNull(),
  evidenceJson: text("evidence_json"),
  receivedAt: text("received_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerEmail, table.feedbackId] }),
  uniqueIndex("feedback_records_profile_feedback_idx").on(table.profileId, table.feedbackId),
  index("feedback_records_profile_recorded_idx").on(table.profileId, table.recordedAt),
]).enableRLS();

// Planning intent (save / hold), one row per item. Last write wins per item,
// decided by the client's own `updated_at`, so two devices editing different
// items never overwrite each other.
export const feedbackPlans = pgTable("feedback_plans", {
  profileId: text("profile_id").notNull(),
  itemId: text("item_id").notNull(),
  saved: integer("saved").notNull().default(0),
  held: integer("held").notNull().default(0),
  itemJson: text("item_json").notNull(),
  updatedAt: text("updated_at").notNull(),
  receivedAt: text("received_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.profileId, table.itemId] }),
]).enableRLS();

// How a past recommendation's check-in was resolved (answered or skipped).
export const feedbackHistoryResponses = pgTable("feedback_history_responses", {
  profileId: text("profile_id").notNull(),
  historyId: text("history_id").notNull(),
  state: text("state").notNull(),
  feedbackId: text("feedback_id"),
  respondedAt: text("responded_at").notNull(),
  receivedAt: text("received_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.profileId, table.historyId] }),
]).enableRLS();

// Small per-profile preferences, such as whether feedback adjusts the ranking.
export const profileSettings = pgTable("profile_settings", {
  profileId: text("profile_id").notNull(),
  key: text("key").notNull(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.profileId, table.key] }),
]).enableRLS();

export const recommendationMisses = pgTable("recommendation_misses", {
  missId: text("miss_id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  profileId: text("profile_id"),
  eventUrl: text("event_url"),
  eventDetails: text("event_details"),
  submittedAt: text("submitted_at").notNull(),
  resolutionStage: text("resolution_stage").notNull().default("untriaged"),
  resolutionNote: text("resolution_note"),
  resolvedAt: text("resolved_at"),
}, (table) => [
  index("recommendation_misses_profile_submitted_idx").on(table.profileId, table.submittedAt),
]).enableRLS();

export const recommendationSnapshots = pgTable("recommendation_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  profileId: text("profile_id"),
  generatedAt: text("generated_at").notNull(),
  payloadJson: text("payload_json").notNull(),
  payloadHash: text("payload_hash").notNull(),
  codeVersion: text("code_version").notNull().default("legacy"),
  dataSchemaVersion: integer("data_schema_version").notNull().default(5),
  createdAt: text("created_at").notNull(),
  active: integer("active").notNull().default(0),
}, (table) => [
  uniqueIndex("recommendation_snapshots_profile_payload_idx").on(table.profileId, table.payloadHash),
  index("recommendation_snapshots_profile_active_idx").on(table.profileId, table.active, table.createdAt),
]).enableRLS();

export const sourceRuns = pgTable("source_runs", {
  runId: text("run_id").primaryKey(),
  profileId: text("profile_id"),
  codeVersion: text("code_version").notNull().default("legacy"),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  sourceHealthJson: text("source_health_json"),
  errorSummary: text("error_summary"),
}).enableRLS();

export const refreshLocks = pgTable("refresh_locks", {
  lockName: text("lock_name").primaryKey(),
  runId: text("run_id").notNull(),
  expiresAt: epochMilliseconds("expires_at").notNull(),
}).enableRLS();

export const hostedTasteSnapshots = pgTable("hosted_taste_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  profileId: text("profile_id"),
  codeVersion: text("code_version").notNull().default("legacy"),
  generatedAt: text("generated_at").notNull(),
  status: text("status").notNull(),
  payloadJson: text("payload_json").notNull(),
  active: integer("active").notNull().default(0),
}, (table) => [
  index("hosted_taste_snapshots_profile_active_idx").on(table.profileId, table.active, table.generatedAt),
]).enableRLS();

export const spotifyOauthStates = pgTable("spotify_oauth_states", {
  state: text("state").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  profileId: text("profile_id"),
  verifier: text("verifier").notNull(),
  expiresAt: epochMilliseconds("expires_at").notNull(),
}).enableRLS();

export const spotifyTokens = pgTable("spotify_tokens", {
  ownerEmail: text("owner_email").primaryKey(),
  profileId: text("profile_id"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: epochMilliseconds("expires_at").notNull(),
  scopes: text("scopes").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("spotify_tokens_profile_id_idx").on(table.profileId),
]).enableRLS();

export const spotifyTopArtistWindows = pgTable("spotify_top_artist_windows", {
  ownerEmail: text("owner_email").notNull(),
  profileId: text("profile_id"),
  windowKey: text("window_key").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  itemsJson: text("items_json").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerEmail, table.windowKey] }),
  uniqueIndex("spotify_top_artist_windows_profile_window_idx").on(table.profileId, table.windowKey),
]).enableRLS();

export const spotifyPlaylistSelections = pgTable("spotify_playlist_selections", {
  ownerEmail: text("owner_email").notNull(),
  profileId: text("profile_id"),
  playlistId: text("playlist_id").notNull(),
  playlistName: text("playlist_name").notNull(),
  weight: integer("weight").notNull().default(1),
  enabled: integer("enabled").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerEmail, table.playlistId] }),
  uniqueIndex("spotify_playlist_selections_profile_playlist_idx").on(table.profileId, table.playlistId),
]).enableRLS();
