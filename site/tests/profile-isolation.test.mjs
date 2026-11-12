import assert from "node:assert/strict";
import test from "node:test";
import { setDatabaseForTests } from "../db/index.ts";
import { readHostedPipelineConfig } from "../server/hosted-config.ts";
import {
  publishProjection,
  readActiveProjection,
} from "../server/persistence.ts";
import {
  completeSpotifyConnection,
  disconnectSpotify,
  spotifyStatus,
} from "../server/spotify.ts";
import { sealSpotifyToken } from "../server/token-crypto.ts";
import { profileIdForEmail, resolveProfile } from "../server/profiles.ts";
import { loadProjection } from "../app/data/projection.ts";
import { count, unavailableDatabase, withDatabase } from "./helpers/pg-database.mjs";

const PROFILE_A = { id: "profile_aaaaaaaaaaaaaaaaaaaaaaaa", email: "a@example.com", displayName: "A", legacyDefault: true };
const PROFILE_B = { id: "profile_bbbbbbbbbbbbbbbbbbbbbbbb", email: "b@example.com", displayName: "B", legacyDefault: false };
const TOKEN_KEY = Buffer.alloc(32, 7).toString("base64url");

test("server-derived profile identity is stable by normalized authenticated email", async () => {
  assert.equal(await profileIdForEmail(" Friend@Example.com "), await profileIdForEmail("friend@example.com"));
  assert.notEqual(await profileIdForEmail("friend-a@example.com"), await profileIdForEmail("friend-b@example.com"));
  assert.match(await profileIdForEmail("friend@example.com"), /^profile_[a-f0-9]{24}$/);
});

test("legacy profile ownership is bound once and cannot follow an environment change", async () => {
  const previousEnvironment = process.env.TASTE_ENGINE_ENV;
  const previousLegacyEmail = process.env.TASTE_LEGACY_PROFILE_EMAIL;
  const previousAllowed = process.env.TASTE_ALLOWED_PROFILE_EMAILS;
  process.env.TASTE_ENGINE_ENV = "test";
  process.env.TASTE_LEGACY_PROFILE_EMAIL = "a@example.com";
  delete process.env.TASTE_ALLOWED_PROFILE_EMAILS;
  try {
    await withDatabase(async (db) => {
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
      assert.equal(await count(db, "profiles", "legacy_owner_key = 'legacy-default'"), 1);
    });
  } finally {
    restoreEnv("TASTE_ENGINE_ENV", previousEnvironment);
    restoreEnv("TASTE_LEGACY_PROFILE_EMAIL", previousLegacyEmail);
    restoreEnv("TASTE_ALLOWED_PROFILE_EMAILS", previousAllowed);
  }
});

test("only the migrated legacy profile can use the bundled recovery projection", async () => {
  // The database is unreachable: every query fails.
  setDatabaseForTests(unavailableDatabase());
  try {
    assert.ok(await loadProjection({ id: PROFILE_A.id, allowBundledFallback: true }));
    assert.equal(await loadProjection({ id: PROFILE_B.id, allowBundledFallback: false }), null);
  } finally {
    setDatabaseForTests(null);
  }
});

test("a successful empty database read does not resurrect the legacy bundle after disconnect", async () => {
  await withDatabase(async () => {
    assert.equal(await loadProjection({ id: PROFILE_A.id, allowBundledFallback: true }), null);
  });
});

test("active projections and durable feedback remain isolated across two profiles", async () => {
  process.env.TASTE_ENGINE_ENV = "test";
  await withDatabase(async (db) => {
    await publishProjection(PROFILE_A.id, projection("A", "2026-08-01T00:00:00.000Z"));
    await publishProjection(PROFILE_B.id, projection("B", "2026-08-01T00:00:00.000Z"));
    await publishProjection(PROFILE_B.id, projection("B2", "2026-08-02T00:00:00.000Z"));

    assert.equal((await readActiveProjection(PROFILE_A.id)).events[0].id, "A");
    assert.equal((await readActiveProjection(PROFILE_B.id)).events[0].id, "B2");
    assert.equal(await count(db, "recommendation_snapshots", "profile_id = ?1 AND active = 1", PROFILE_A.id), 1);
    assert.equal(await count(db, "recommendation_snapshots", "profile_id = ?1 AND active = 1", PROFILE_B.id), 1);
    assert.equal((await loadProjection({ id: PROFILE_B.id, allowBundledFallback: false })).events[0].id, "B2");

    // Feedback isolation is covered in feedback-sync.test.mjs.
  });
});

test("Spotify status exposes no token material, callback state is profile-bound, and disconnect is scoped", async () => {
  process.env.TASTE_ENGINE_ENV = "test";
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = TOKEN_KEY;
  process.env.SPOTIFY_CLIENT_ID = "synthetic-client";
  await withDatabase(async (db) => {
    const now = new Date().toISOString();
    const token = db.prepare(`
      INSERT INTO spotify_tokens (owner_email, profile_id, access_token, refresh_token, expires_at, scopes, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 'playlist-read-private playlist-read-collaborative user-top-read', ?6)
    `);
    await db.batch([
      token.bind(PROFILE_A.email, PROFILE_A.id, await sealSpotifyToken("access-profile-a-secret"), await sealSpotifyToken("refresh-profile-a-secret"), Date.now() + 3_600_000, now),
      token.bind(PROFILE_B.email, PROFILE_B.id, await sealSpotifyToken("access-profile-b-secret"), null, Date.now() + 3_600_000, now),
      ...[PROFILE_A, PROFILE_B].flatMap((profile) => {
        const suffix = profile === PROFILE_A ? "a" : "b";
        return [
          db.prepare("INSERT INTO spotify_playlist_selections (owner_email, profile_id, playlist_id, playlist_name, weight, enabled, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 1, ?5)")
            .bind(profile.email, profile.id, `playlist-${suffix}`, profile.displayName, now),
          db.prepare("INSERT INTO spotify_oauth_states (state, owner_email, profile_id, verifier, expires_at) VALUES (?1, ?2, ?3, 'verifier', ?4)")
            .bind(`state-${suffix}`, profile.email, profile.id, Date.now() + 60_000),
          db.prepare("INSERT INTO hosted_taste_snapshots (snapshot_id, owner_email, profile_id, generated_at, status, payload_json, active) VALUES (?1, ?2, ?3, ?4, 'active', '{}', 1)")
            .bind(`taste-${suffix}`, profile.email, profile.id, now),
          db.prepare("INSERT INTO recommendation_snapshots (snapshot_id, profile_id, generated_at, payload_json, payload_hash, created_at, active) VALUES (?1, ?2, ?3, '{}', ?1, ?3, 1)")
            .bind(`projection-${suffix}`, profile.id, now),
        ];
      }),
    ]);

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
      assert.equal(await count(db, table, "profile_id = ?1", PROFILE_A.id), 0, `${table} should delete only profile A`);
      assert.equal(await count(db, table, "profile_id = ?1", PROFILE_B.id), 1, `${table} should preserve profile B`);
    }
  });
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


function restoreEnv(key, value) {
  if (value == null) delete process.env[key];
  else process.env[key] = value;
}
