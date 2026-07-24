import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const feedbackState = sqliteTable("feedback_state", {
  ownerEmail: text("owner_email").primaryKey(),
  stateJson: text("state_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const recommendationSnapshots = sqliteTable("recommendation_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  generatedAt: text("generated_at").notNull(),
  payloadJson: text("payload_json").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: text("created_at").notNull(),
  active: integer("active").notNull().default(0),
}, (table) => [
  uniqueIndex("recommendation_snapshots_payload_hash_idx").on(table.payloadHash),
]);

export const sourceRuns = sqliteTable("source_runs", {
  runId: text("run_id").primaryKey(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  sourceHealthJson: text("source_health_json"),
  errorSummary: text("error_summary"),
});

export const refreshLocks = sqliteTable("refresh_locks", {
  lockName: text("lock_name").primaryKey(),
  runId: text("run_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const hostedTasteSnapshots = sqliteTable("hosted_taste_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  generatedAt: text("generated_at").notNull(),
  status: text("status").notNull(),
  payloadJson: text("payload_json").notNull(),
  active: integer("active").notNull().default(0),
});

export const spotifyOauthStates = sqliteTable("spotify_oauth_states", {
  state: text("state").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  verifier: text("verifier").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const spotifyTokens = sqliteTable("spotify_tokens", {
  ownerEmail: text("owner_email").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: integer("expires_at").notNull(),
  scopes: text("scopes").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const spotifyTopArtistWindows = sqliteTable("spotify_top_artist_windows", {
  ownerEmail: text("owner_email").notNull(),
  windowKey: text("window_key").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  itemsJson: text("items_json").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerEmail, table.windowKey] }),
]);

export const spotifyPlaylistSelections = sqliteTable("spotify_playlist_selections", {
  ownerEmail: text("owner_email").notNull(),
  playlistId: text("playlist_id").notNull(),
  playlistName: text("playlist_name").notNull(),
  weight: integer("weight").notNull().default(1),
  enabled: integer("enabled").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerEmail, table.playlistId] }),
]);
