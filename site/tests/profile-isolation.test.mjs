import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeD1 } from "../db/index.ts";
import { readHostedPipelineConfig } from "../server/hosted-config.ts";
import {
  publishProjection,
  readActiveProjection,
  readFeedbackState,
  writeFeedbackState,
} from "../server/persistence.ts";
import {
  completeSpotifyConnection,
  disconnectSpotify,
  spotifyStatus,
} from "../server/spotify.ts";
import { sealSpotifyToken } from "../server/token-crypto.ts";
import { profileIdForEmail, resolveProfile } from "../server/profiles.ts";
import { loadProjection } from "../app/data/projection.ts";

const PROFILE_A = { id: "profile_aaaaaaaaaaaaaaaaaaaaaaaa", email: "a@example.com", displayName: "A", legacyDefault: true };
const PROFILE_B = { id: "profile_bbbbbbbbbbbbbbbbbbbbbbbb", email: "b@example.com", displayName: "B", legacyDefault: false };
const TOKEN_KEY = Buffer.alloc(32, 7).toString("base64url");

test("server-derived profile identity is stable by normalized authenticated email", async () => {
  assert.equal(await profileIdForEmail(" Friend@Example.com "), await profileIdForEmail("friend@example.com"));
  assert.notEqual(await profileIdForEmail("friend-a@example.com"), await profileIdForEmail("friend-b@example.com"));
  assert.match(await profileIdForEmail("friend@example.com"), /^profile_[a-f0-9]{24}$/);
});

test("legacy profile ownership is bound once and cannot follow an environment change", async () => {
  const db = new MemoryD1();
  setRuntimeD1(db);
  const previousEnvironment = process.env.TASTE_ENGINE_ENV;
  const previousLegacyEmail = process.env.TASTE_LEGACY_PROFILE_EMAIL;
  const previousAllowed = process.env.TASTE_ALLOWED_PROFILE_EMAILS;
  process.env.TASTE_ENGINE_ENV = "test";
  process.env.TASTE_LEGACY_PROFILE_EMAIL = "a@example.com";
  delete process.env.TASTE_ALLOWED_PROFILE_EMAILS;
  try {
    const owner = await resolveProfile({ email: "A@example.com", displayName: "A", fullName: null });
    assert.equal(owner.legacyDefault, true);
    process.env.TASTE_LEGACY_PROFILE_EMAIL = "b@example.com";
    await assert.rejects(
      resolveProfile({ email: "b@example.com", displayName: "B", fullName: null }),
      /already bound to a different authenticated account/,
    );
    delete process.env.TASTE_LEGACY_PROFILE_EMAIL;
    const persistedOwner = await resolveProfile({ email: "a@example.com", displayName: "A", fullName: null });
    assert.equal(persistedOwner.legacyDefault, true);
    assert.equal(db.tables.profiles.filter((profile) => profile.legacy_owner_key === "legacy-default").length, 1);
  } finally {
    setRuntimeD1(null);
    restoreEnv("TASTE_ENGINE_ENV", previousEnvironment);
    restoreEnv("TASTE_LEGACY_PROFILE_EMAIL", previousLegacyEmail);
    restoreEnv("TASTE_ALLOWED_PROFILE_EMAILS", previousAllowed);
  }
});

test("only the migrated legacy profile can use the bundled recovery projection", async () => {
  setRuntimeD1(null);
  assert.ok(await loadProjection({ id: PROFILE_A.id, allowBundledFallback: true }));
  assert.equal(await loadProjection({ id: PROFILE_B.id, allowBundledFallback: false }), null);
});

test("a successful empty D1 read does not resurrect the legacy bundle after disconnect", async () => {
  setRuntimeD1(new MemoryD1());
  try {
    assert.equal(await loadProjection({ id: PROFILE_A.id, allowBundledFallback: true }), null);
  } finally {
    setRuntimeD1(null);
  }
});

test("active projections and durable feedback remain isolated across two profiles", async () => {
  const db = new MemoryD1();
  setRuntimeD1(db);
  process.env.TASTE_ENGINE_ENV = "test";

  await publishProjection(PROFILE_A.id, projection("A", "2026-08-01T00:00:00.000Z"));
  await publishProjection(PROFILE_B.id, projection("B", "2026-08-01T00:00:00.000Z"));
  await publishProjection(PROFILE_B.id, projection("B2", "2026-08-02T00:00:00.000Z"));

  assert.equal((await readActiveProjection(PROFILE_A.id)).events[0].id, "A");
  assert.equal((await readActiveProjection(PROFILE_B.id)).events[0].id, "B2");
  assert.equal(db.tables.recommendation_snapshots.filter((row) => row.profile_id === PROFILE_A.id && row.active === 1).length, 1);
  assert.equal(db.tables.recommendation_snapshots.filter((row) => row.profile_id === PROFILE_B.id && row.active === 1).length, 1);

  await writeFeedbackState(PROFILE_A, feedbackState("A-plan"));
  await writeFeedbackState(PROFILE_B, feedbackState("B-plan"));
  assert.ok((await readFeedbackState(PROFILE_A)).planning["A-plan"]);
  assert.equal((await readFeedbackState(PROFILE_A)).planning["B-plan"], undefined);
  assert.ok((await readFeedbackState(PROFILE_B)).planning["B-plan"]);
});

test("Spotify status exposes no token material, callback state is profile-bound, and disconnect is scoped", async () => {
  const db = new MemoryD1();
  setRuntimeD1(db);
  process.env.TASTE_ENGINE_ENV = "test";
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = TOKEN_KEY;
  process.env.SPOTIFY_CLIENT_ID = "synthetic-client";
  const accessA = await sealSpotifyToken("access-profile-a-secret");
  const refreshA = await sealSpotifyToken("refresh-profile-a-secret");
  const accessB = await sealSpotifyToken("access-profile-b-secret");
  db.tables.spotify_tokens.push(
    tokenRow(PROFILE_A, accessA, refreshA),
    tokenRow(PROFILE_B, accessB, null),
  );
  db.tables.spotify_playlist_selections.push(
    { profile_id: PROFILE_A.id, playlist_id: "playlist-a", playlist_name: "A", weight: 1, enabled: 1, updated_at: "now" },
    { profile_id: PROFILE_B.id, playlist_id: "playlist-b", playlist_name: "B", weight: 1, enabled: 1, updated_at: "now" },
  );
  db.tables.spotify_oauth_states.push(
    { state: "state-a", profile_id: PROFILE_A.id, owner_email: PROFILE_A.email, verifier: "verifier", expires_at: Date.now() + 60_000 },
    { state: "state-b", profile_id: PROFILE_B.id, owner_email: PROFILE_B.email, verifier: "verifier", expires_at: Date.now() + 60_000 },
  );
  db.tables.hosted_taste_snapshots.push({ profile_id: PROFILE_A.id }, { profile_id: PROFILE_B.id });
  db.tables.recommendation_snapshots.push({ profile_id: PROFILE_A.id, active: 1 }, { profile_id: PROFILE_B.id, active: 1 });

  const status = await spotifyStatus(PROFILE_A);
  const serialized = JSON.stringify(status);
  assert.equal(status.connected, true);
  assert.equal(status.selectedPlaylistCount, 1);
  assert.doesNotMatch(serialized, /access-profile-a-secret|refresh-profile-a-secret|enc:v1/);

  await assert.rejects(
    completeSpotifyConnection(new URL("https://taste.example/api/spotify/callback?code=code&state=state-a"), PROFILE_B.id),
    /different Taste Engine profile/,
  );

  await disconnectSpotify(PROFILE_A);
  for (const table of ["spotify_tokens", "spotify_playlist_selections", "spotify_oauth_states", "hosted_taste_snapshots", "recommendation_snapshots"]) {
    assert.equal(db.tables[table].some((row) => row.profile_id === PROFILE_A.id), false, `${table} should delete only profile A`);
    assert.equal(db.tables[table].some((row) => row.profile_id === PROFILE_B.id), true, `${table} should preserve profile B`);
  }
});

test("version 2 hosted configuration selects profile-specific ranking inputs and fails closed for missing profiles", () => {
  const previous = process.env.TASTE_ENGINE_CONFIG_JSON;
  process.env.TASTE_ENGINE_CONFIG_JSON = JSON.stringify({
    version: 2,
    shared: {
      brief: { timezone: "America/Los_Angeles", home: { label: "LA", lat: 34.05, lon: -118.24 }, searchRadiusMiles: 50 },
      movies: { maxCandidates: 10 },
      sports: { maxPitcherStats: 24, maxTicketPages: 2 },
      personalContext: { maxEnhancedEvents: 8, maxEnhancedSports: 4 },
    },
    profiles: {
      [PROFILE_A.id]: { brief: { pinnedArtists: ["Artist A"] }, sports: { enabled: true, teamId: 119, teamName: "Dodgers" }, personalContext: { background: ["A context"] } },
      [PROFILE_B.id]: { brief: { pinnedArtists: ["Artist B"] }, sports: { enabled: true, teamId: 119, teamName: "Dodgers" }, personalContext: { background: ["B context"] } },
    },
  });
  try {
    assert.deepEqual(readHostedPipelineConfig(PROFILE_A).brief.pinnedArtists, ["Artist A"]);
    assert.deepEqual(readHostedPipelineConfig(PROFILE_B).brief.pinnedArtists, ["Artist B"]);
    assert.deepEqual(readHostedPipelineConfig(PROFILE_B).personalContext.background, ["B context"]);
    assert.throws(
      () => readHostedPipelineConfig({ ...PROFILE_B, id: "profile_cccccccccccccccccccccccc" }),
      /missing profile/,
    );
  } finally {
    if (previous == null) delete process.env.TASTE_ENGINE_CONFIG_JSON;
    else process.env.TASTE_ENGINE_CONFIG_JSON = previous;
  }
});

test("version 2 hosted configuration rejects personal taste in shared settings", () => {
  const previous = process.env.TASTE_ENGINE_CONFIG_JSON;
  process.env.TASTE_ENGINE_CONFIG_JSON = JSON.stringify({
    version: 2,
    shared: {
      brief: {
        home: { label: "LA", lat: 34.05, lon: -118.24 },
        pinnedArtists: ["Must not leak"],
      },
    },
    profiles: {
      [PROFILE_A.id]: { brief: {} },
      [PROFILE_B.id]: { brief: {} },
    },
  });
  try {
    assert.throws(() => readHostedPipelineConfig(PROFILE_B), /shared\.brief\.pinnedArtists must be configured inside each profile/);
  } finally {
    if (previous == null) delete process.env.TASTE_ENGINE_CONFIG_JSON;
    else process.env.TASTE_ENGINE_CONFIG_JSON = previous;
  }
});

test("flat hosted configuration remains compatible only with the original single profile", () => {
  const previous = process.env.TASTE_ENGINE_CONFIG_JSON;
  process.env.TASTE_ENGINE_CONFIG_JSON = JSON.stringify({
    brief: { home: { label: "LA", lat: 34.05, lon: -118.24 }, pinnedArtists: ["Legacy Artist"] },
    movies: {},
    sports: {},
    personalContext: {},
  });
  try {
    assert.deepEqual(readHostedPipelineConfig(PROFILE_A).brief.pinnedArtists, ["Legacy Artist"]);
    assert.throws(() => readHostedPipelineConfig(PROFILE_B), /explicit entry/);
  } finally {
    if (previous == null) delete process.env.TASTE_ENGINE_CONFIG_JSON;
    else process.env.TASTE_ENGINE_CONFIG_JSON = previous;
  }
});

function projection(id, generatedAt) {
  return { schemaVersion: 5, generatedAt, events: [{ id }], movies: [], sports: [] };
}

function feedbackState(id) {
  return { version: 3, planning: { [id]: { itemId: id } }, historyResponses: {}, records: {}, exportBatches: {} };
}

function tokenRow(profile, accessToken, refreshToken) {
  return {
    owner_email: profile.email,
    profile_id: profile.id,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Date.now() + 3_600_000,
    scopes: "playlist-read-private playlist-read-collaborative user-top-read",
    updated_at: new Date().toISOString(),
  };
}

class MemoryD1 {
  tables = {
    profiles: [],
    feedback_state: [],
    feedback_records: [],
    recommendation_snapshots: [],
    spotify_tokens: [],
    spotify_top_artist_windows: [],
    spotify_playlist_selections: [],
    spotify_oauth_states: [],
    hosted_taste_snapshots: [],
  };

  prepare(sql) { return new MemoryStatement(this, sql); }
  async batch(statements) {
    const output = [];
    for (const statement of statements) output.push(await statement.run());
    return output;
  }
}

class MemoryStatement {
  values = [];
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim().toLowerCase(); }
  bind(...values) { this.values = values; return this; }

  async first() {
    if (this.sql.includes("from profiles") && this.sql.includes("legacy_owner_key")) {
      return this.db.tables.profiles.find((row) => row.legacy_owner_key === this.values[0]) ?? null;
    }
    if (this.sql.includes("from profiles") && this.sql.includes("where profile_id = ?1")) {
      return this.db.tables.profiles.find((row) => row.profile_id === this.values[0]) ?? null;
    }
    if (this.sql.includes("from recommendation_snapshots")) {
      return this.db.tables.recommendation_snapshots
        .filter((row) => row.profile_id === this.values[0] && row.active === 1)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
    }
    if (this.sql.includes("from feedback_state")) {
      return this.db.tables.feedback_state.find((row) => row.profile_id === this.values[0]) ?? null;
    }
    if (this.sql.includes("from spotify_tokens")) {
      return this.db.tables.spotify_tokens.find((row) => row.profile_id === this.values[0]) ?? null;
    }
    if (this.sql.includes("from spotify_top_artist_windows")) {
      return this.db.tables.spotify_top_artist_windows.find((row) => row.profile_id === this.values[0] && row.window_key === this.values[1]) ?? null;
    }
    if (this.sql.includes("from spotify_oauth_states")) {
      return this.db.tables.spotify_oauth_states.find((row) => row.state === this.values[0]) ?? null;
    }
    return null;
  }

  async all() {
    if (this.sql.includes("from feedback_records")) {
      return { results: this.db.tables.feedback_records.filter((row) => row.profile_id === this.values[0]), meta: { changes: 0 } };
    }
    if (this.sql.includes("from spotify_playlist_selections")) {
      return { results: this.db.tables.spotify_playlist_selections.filter((row) => row.profile_id === this.values[0]), meta: { changes: 0 } };
    }
    return { results: [], meta: { changes: 0 } };
  }

  async run() {
    if (this.sql.startsWith("insert into profiles")) {
      const legacy = this.sql.includes("values (?1, ?2, ?3, ?4, 1, 1");
      const [profile_id, identity_hash, owner_email, display_name] = this.values;
      const now = this.values.at(-1);
      const existing = this.db.tables.profiles.find((row) => row.profile_id === profile_id);
      if (existing) {
        existing.owner_email = owner_email;
        existing.display_name = display_name;
        existing.updated_at = now;
        if (legacy) {
          existing.legacy_default = 1;
          existing.legacy_owner_key = "legacy-default";
        }
      } else {
        this.db.tables.profiles.push({
          profile_id,
          identity_hash,
          owner_email,
          display_name,
          enabled: 1,
          legacy_default: legacy ? 1 : 0,
          legacy_owner_key: legacy ? "legacy-default" : null,
          created_at: now,
          updated_at: now,
        });
      }
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("update recommendation_snapshots set active = 0")) {
      let changes = 0;
      for (const row of this.db.tables.recommendation_snapshots) {
        if (row.profile_id === this.values[0] && row.active === 1) { row.active = 0; changes += 1; }
      }
      return { meta: { changes } };
    }
    if (this.sql.startsWith("insert into recommendation_snapshots")) {
      const [snapshot_id, profile_id, generated_at, payload_json, payload_hash, code_version, data_schema_version, created_at] = this.values;
      const row = { snapshot_id, profile_id, generated_at, payload_json, payload_hash, code_version, data_schema_version, created_at, active: 1 };
      const index = this.db.tables.recommendation_snapshots.findIndex((item) => item.snapshot_id === snapshot_id);
      if (index >= 0) this.db.tables.recommendation_snapshots[index] = row;
      else this.db.tables.recommendation_snapshots.push(row);
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("insert into feedback_state")) {
      const [owner_email, profile_id, state_json, updated_at] = this.values;
      const row = { owner_email, profile_id, state_json, updated_at };
      const index = this.db.tables.feedback_state.findIndex((item) => item.profile_id === profile_id);
      if (index >= 0) this.db.tables.feedback_state[index] = row;
      else this.db.tables.feedback_state.push(row);
      return { meta: { changes: 1 } };
    }
    const deletion = this.sql.match(/^delete from ([a-z_]+) where profile_id = \?1/);
    if (deletion) {
      const table = deletion[1];
      const before = this.db.tables[table].length;
      this.db.tables[table] = this.db.tables[table].filter((row) => row.profile_id !== this.values[0]);
      return { meta: { changes: before - this.db.tables[table].length } };
    }
    return { meta: { changes: 0 } };
  }
}

function restoreEnv(key, value) {
  if (value == null) delete process.env[key];
  else process.env[key] = value;
}
