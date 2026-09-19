import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeD1 } from "../db/index.ts";
import { GET } from "../app/api/health/route.ts";

const TOKEN_KEY = Buffer.alloc(32, 11).toString("base64url");
const PROFILE_A = "profile_aaaaaaaaaaaaaaaaaaaaaaaa";
const PROFILE_B = "profile_bbbbbbbbbbbbbbbbbbbbbbbb";

test("production health reports deterministic release metadata without exposing secrets", async () => {
  const previous = snapshotEnvironment([
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_TOKEN_ENCRYPTION_KEY",
    "TASTE_ENGINE_CONFIG_JSON",
    "TASTE_ALLOWED_PROFILE_EMAILS",
    "TASTE_ENGINE_COMMIT_SHA",
    "TASTE_ENGINE_ENV",
    "TASTE_ENGINE_RELEASE",
    "TASTE_LEGACY_PROFILE_EMAIL",
    "TASTE_REFRESH_SECRET",
  ]);
  process.env.SPOTIFY_CLIENT_ID = "health-test-client";
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = TOKEN_KEY;
  process.env.TASTE_ENGINE_CONFIG_JSON = JSON.stringify({
    version: 2,
    shared: { brief: { home: { label: "LA", lat: 34.05, lon: -118.24 } } },
    profiles: {
      [PROFILE_A]: { brief: { pinnedArtists: [] } },
      [PROFILE_B]: { brief: { pinnedArtists: [] } },
    },
  });
  process.env.TASTE_ALLOWED_PROFILE_EMAILS = "a@example.com,b@example.com";
  process.env.TASTE_ENGINE_COMMIT_SHA = "a".repeat(40);
  process.env.TASTE_ENGINE_ENV = "production";
  process.env.TASTE_ENGINE_RELEASE = "health-test-release";
  process.env.TASTE_LEGACY_PROFILE_EMAIL = "a@example.com";
  process.env.TASTE_REFRESH_SECRET = "health-test-refresh-secret-value";
  setRuntimeD1({
    prepare(sql) {
      return {
        async all() {
          assert.match(sql, /FROM profiles/);
          return { results: [
            { profile_id: PROFILE_A, owner_email: "a@example.com", display_name: "A", legacy_default: 1 },
            { profile_id: PROFILE_B, owner_email: "b@example.com", display_name: "B", legacy_default: 0 },
          ] };
        },
        async first() {
          return { active_projection_count: 2 };
        },
      };
    },
  });

  try {
    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);
    assert.equal(response.status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.release.application, "taste-engine-site");
    assert.equal(body.release.databaseSchemaVersion, 3);
    assert.deepEqual(body.database, { ready: true, profileCount: 2, activeProjectionCount: 2 });
    assert.equal(body.configuration.spotifyTokenEncryption, "configured");
    assert.equal(body.configuration.profileConfig, true);
    assert.equal(body.configuration.trustedProfiles, true);
    assert.equal(body.configuration.legacyProfile, true);
    assert.equal(body.configuration.sourceRelease, true);
    assert.doesNotMatch(serialized, /health-test-client|health-test-refresh-secret-value|eyJ|enc:v1/);
  } finally {
    setRuntimeD1(null);
    restoreEnvironment(previous);
  }
});

test("health rejects malformed profile configuration and invalid encryption keys", async () => {
  const previous = snapshotEnvironment([
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_TOKEN_ENCRYPTION_KEY",
    "TASTE_ALLOWED_PROFILE_EMAILS",
    "TASTE_ENGINE_COMMIT_SHA",
    "TASTE_ENGINE_CONFIG_JSON",
    "TASTE_ENGINE_ENV",
    "TASTE_LEGACY_PROFILE_EMAIL",
    "TASTE_REFRESH_SECRET",
  ]);
  process.env.SPOTIFY_CLIENT_ID = "client";
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = "not-a-32-byte-key";
  process.env.TASTE_ALLOWED_PROFILE_EMAILS = "a@example.com";
  process.env.TASTE_ENGINE_COMMIT_SHA = "b".repeat(40);
  process.env.TASTE_ENGINE_CONFIG_JSON = JSON.stringify({
    version: 2,
    shared: { brief: { home: { label: "LA", lat: 34, lon: -118 }, pinnedArtists: ["leak"] } },
    profiles: { [PROFILE_A]: { brief: {} } },
  });
  process.env.TASTE_ENGINE_ENV = "production";
  process.env.TASTE_LEGACY_PROFILE_EMAIL = "a@example.com";
  process.env.TASTE_REFRESH_SECRET = "long-enough-refresh-secret";
  setRuntimeD1({
    prepare(sql) {
      return {
        async all() {
          assert.match(sql, /FROM profiles/);
          return { results: [{ profile_id: PROFILE_A, owner_email: "a@example.com", display_name: "A", legacy_default: 1 }] };
        },
        async first() { return { active_projection_count: 1 }; },
      };
    },
  });
  try {
    const response = await GET();
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.configuration.profileConfig, false);
    assert.equal(body.configuration.spotifyTokenEncryption, "invalid");
  } finally {
    setRuntimeD1(null);
    restoreEnvironment(previous);
  }
});

test("health fails closed when the database or required production configuration is absent", async () => {
  const previous = snapshotEnvironment([
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_TOKEN_ENCRYPTION_KEY",
    "TASTE_ENGINE_CONFIG_JSON",
    "TASTE_ALLOWED_PROFILE_EMAILS",
    "TASTE_ENGINE_COMMIT_SHA",
    "TASTE_ENGINE_ENV",
    "TASTE_LEGACY_PROFILE_EMAIL",
    "TASTE_REFRESH_SECRET",
  ]);
  for (const key of previous.keys()) delete process.env[key];
  setRuntimeD1(null);

  try {
    const response = await GET();
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, "degraded");
    assert.equal(body.database.ready, false);
    assert.equal(body.configuration.spotifyTokenEncryption, "required");
  } finally {
    restoreEnvironment(previous);
  }
});

function snapshotEnvironment(keys) {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(values) {
  for (const [key, value] of values) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}
