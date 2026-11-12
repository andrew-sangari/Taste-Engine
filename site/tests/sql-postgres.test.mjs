import assert from "node:assert/strict";
import test, { after } from "node:test";
import { GET as healthRoute } from "../app/api/health/route.ts";
import { setDatabaseForTests } from "../db/index.ts";
import { applyFeedbackOps, readFeedbackSync } from "../server/feedback-sync.ts";
import { HostedRefreshConflictError, runHostedRefresh } from "../server/hosted-refresh.ts";
import { publishProjection, readActiveProjection, readFeedbackRecords, writeFeedbackRecords } from "../server/persistence.ts";
import { listConnectedProfiles, readProfile, resolveProfile } from "../server/profiles.ts";
import { classifyRecommendationMiss, createRecommendationMiss, sourceReviewCandidates } from "../server/recommendation-misses.ts";
import {
  completeSpotifyConnection,
  createSpotifyConnectUrl,
  disconnectSpotify,
  listSpotifyPlaylists,
  readPlaylistSelections,
  refreshSpotifyTopArtists,
  SpotifyHttpError,
  spotifyStatus,
  writePlaylistSelections,
} from "../server/spotify.ts";
import { isSealedSpotifyToken, openSpotifyToken, sealSpotifyToken } from "../server/token-crypto.ts";
import { count, executedStatements, rows, statementCoverage, unavailableDatabase, withDatabase } from "./helpers/pg-database.mjs";

// Every SQL statement the server issues, run against a real Postgres engine
// through the real server functions. Only the network (`fetch`) is stubbed;
// the database never is. The last test proves that no `.prepare(` call site
// in the server code was left unexecuted.

const A = { id: "profile_aaaaaaaaaaaaaaaaaaaaaaaa", email: "a@example.com", displayName: "A", legacyDefault: true };
const B = { id: "profile_bbbbbbbbbbbbbbbbbbbbbbbb", email: "b@example.com", displayName: "B", legacyDefault: false };
const SCOPES = "playlist-read-private playlist-read-collaborative user-top-read";
const DAY = 86_400_000;
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

const ENVIRONMENT = {
  TASTE_ENGINE_ENV: "test",
  SPOTIFY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
  SPOTIFY_CLIENT_ID: "synthetic-client",
  // Unset, whatever the developer's shell holds.
  DATABASE_URL: undefined,
  TASTE_ALLOWED_PROFILE_EMAILS: undefined,
  TASTE_LEGACY_PROFILE_EMAIL: undefined,
  TASTE_ALLOW_PLAINTEXT_SPOTIFY_TOKENS: undefined,
  TASTE_ENGINE_CONFIG_JSON: undefined,
  TASTE_ENGINE_COMMIT_SHA: undefined,
  TASTE_REFRESH_SECRET: undefined,
  LASTFM_API_KEY: undefined,
  SEATGEEK_CLIENT_ID: undefined,
  TICKETMASTER_API_KEY: undefined,
  EDMTRAIN_CLIENT_KEY: undefined,
  TMDB_ACCESS_TOKEN: undefined,
  TMDB_API_KEY: undefined,
  OLLAMA_API_KEY: undefined,
  OLLAMA_MODEL: undefined,
  TYPESAFE_AI_API_KEY: undefined,
  TYPESAFE_API_KEY: undefined,
  AI_GATEWAY_API_KEY: undefined,
  NIGHTLIFE_INFERENCE_PROVIDER: undefined,
};
const priorEnvironment = Object.fromEntries(Object.keys(ENVIRONMENT).map((key) => [key, process.env[key]]));
const priorFetch = globalThis.fetch;
setEnvironment(ENVIRONMENT);
// Any request a test did not stub is a bug in the test, never a real call.
globalThis.fetch = async (input) => { throw new Error(`Unexpected network request: ${requestUrl(input)}`); };
after(() => {
  setEnvironment(priorEnvironment);
  globalThis.fetch = priorFetch;
});

test("profiles: created, resolved again, read, and legacy rows claimed once by one owner", async () => {
  await withDatabase(async (db) => {
    process.env.TASTE_LEGACY_PROFILE_EMAIL = "owner@example.com";
    try {
      // Rows written before profiles existed: owned by email, no profile yet.
      const sealed = await sealSpotifyToken("legacy-access-token");
      const legacy = (email) => [
        db.prepare("INSERT INTO feedback_state (owner_email, state_json, updated_at) VALUES (?1, '{}', ?2)").bind(email, iso()),
        db.prepare(`
          INSERT INTO feedback_records (owner_email, feedback_id, canonical_event_id, event_date_local, status, recorded_at, record_json, received_at)
          VALUES (?1, 'legacy-record', 'event', '2026-11-21', 'interested', ?2, '{}', ?2)
        `).bind(email, iso()),
        db.prepare("INSERT INTO recommendation_misses (miss_id, owner_email, event_details, submitted_at) VALUES (?1, ?2, 'legacy', ?3)").bind(`miss-${email}`, email, iso()),
        db.prepare("INSERT INTO hosted_taste_snapshots (snapshot_id, owner_email, generated_at, status, payload_json) VALUES (?1, ?2, ?3, 'active', '{}')").bind(`taste-${email}`, email, iso()),
        db.prepare("INSERT INTO spotify_oauth_states (state, owner_email, verifier, expires_at) VALUES (?1, ?2, 'verifier', ?3)").bind(`state-${email}`, email, Date.now() + 60_000),
        db.prepare("INSERT INTO spotify_tokens (owner_email, access_token, expires_at, scopes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(email, sealed, Date.now() + 3_600_000, SCOPES, iso()),
        db.prepare("INSERT INTO spotify_top_artist_windows (owner_email, window_key, fetched_at, expires_at, items_json) VALUES (?1, 'shortTerm', ?2, ?3, '[]')").bind(email, iso(), iso(DAY)),
        db.prepare("INSERT INTO spotify_playlist_selections (owner_email, playlist_id, playlist_name, updated_at) VALUES (?1, 'p1', 'One', ?2)").bind(email, iso()),
      ];
      // Stored with capitals: the claim compares lower(owner_email).
      await db.batch([
        ...legacy("Owner@Example.com"),
        ...legacy("friend@example.com"),
        ...legacy("stranger@example.com"),
        db.prepare("INSERT INTO recommendation_snapshots (snapshot_id, generated_at, payload_json, payload_hash, created_at, active) VALUES ('legacy-projection', ?1, '{}', 'legacy-hash', ?1, 1)").bind(iso()),
        db.prepare("INSERT INTO source_runs (run_id, status, started_at) VALUES ('legacy-run', 'completed', ?1)").bind(iso()),
      ]);
      const ownerScoped = ["feedback_state", "feedback_records", "recommendation_misses", "hosted_taste_snapshots", "spotify_oauth_states", "spotify_tokens", "spotify_top_artist_windows", "spotify_playlist_selections"];
      const claimedBy = async (profileId) => Promise.all(ownerScoped.map((table) => count(db, table, "profile_id = ?1", profileId)));

      // An ordinary profile claims only the rows stored under its own email.
      const friend = await resolveProfile({ email: " Friend@Example.com ", displayName: "Friend", fullName: null });
      assert.match(friend.id, /^profile_[a-f0-9]{24}$/);
      assert.deepEqual({ email: friend.email, displayName: friend.displayName, legacyDefault: friend.legacyDefault }, { email: "friend@example.com", displayName: "Friend", legacyDefault: false });
      assert.deepEqual(await claimedBy(friend.id), [1, 1, 1, 1, 1, 1, 1, 1]);
      assert.equal(await count(db, "recommendation_snapshots", "profile_id IS NULL"), 1, "shared legacy rows are not an ordinary profile's to claim");

      // The legacy owner also claims the rows that never had an owner at all.
      const owner = await resolveProfile({ email: "owner@example.com", displayName: "Owner", fullName: null });
      assert.equal(owner.legacyDefault, true);
      assert.deepEqual(await claimedBy(owner.id), [1, 1, 1, 1, 1, 1, 1, 1]);
      assert.equal(await count(db, "recommendation_snapshots", "profile_id = ?1", owner.id), 1);
      assert.equal(await count(db, "source_runs", "profile_id = ?1", owner.id), 1);
      for (const table of ownerScoped) assert.equal(await count(db, table, "profile_id IS NULL"), 1, `${table}: a stranger's rows stay unclaimed`);

      // Resolving again updates the existing row instead of adding one.
      const created = await db.prepare("SELECT created_at FROM profiles WHERE profile_id = ?1").bind(friend.id).first();
      const renamed = await resolveProfile({ email: "friend@example.com", displayName: "Friend Renamed", fullName: null });
      assert.equal(renamed.id, friend.id);
      assert.equal(renamed.displayName, "Friend Renamed");
      assert.equal(await count(db, "profiles"), 2);
      assert.deepEqual(
        await db.prepare("SELECT created_at, enabled, legacy_default, legacy_owner_key FROM profiles WHERE profile_id = ?1").bind(friend.id).first(),
        { created_at: created.created_at, enabled: 1, legacy_default: 0, legacy_owner_key: null },
      );
      const again = await resolveProfile({ email: "owner@example.com", displayName: "Owner", fullName: null });
      assert.deepEqual(again, owner);

      // The legacy binding cannot move to another account, whatever the environment says.
      process.env.TASTE_LEGACY_PROFILE_EMAIL = "friend@example.com";
      await assert.rejects(
        resolveProfile({ email: "friend@example.com", displayName: "Friend", fullName: null }),
        /already bound to a different authenticated account/,
      );
      delete process.env.TASTE_LEGACY_PROFILE_EMAIL;
      assert.equal((await resolveProfile({ email: "owner@example.com", displayName: "Owner", fullName: null })).legacyDefault, true);
      assert.equal(await count(db, "profiles", "legacy_owner_key = 'legacy-default'"), 1);

      // Both now hold a claimed Spotify token, so both are connected profiles.
      assert.deepEqual((await listConnectedProfiles()).map((profile) => profile.email).sort(), ["friend@example.com", "owner@example.com"]);
      assert.deepEqual(await readProfile(owner.id), { ...owner, displayName: "Owner" });
      await db.prepare("UPDATE profiles SET enabled = 0 WHERE profile_id = ?1").bind(friend.id).run();
      assert.equal(await readProfile(friend.id), null, "a disabled profile does not resolve");
      assert.deepEqual((await listConnectedProfiles()).map((profile) => profile.email), ["owner@example.com"]);
      assert.equal(await readProfile("profile_ffffffffffffffffffffffff"), null);
    } finally {
      delete process.env.TASTE_LEGACY_PROFILE_EMAIL;
    }
  });
});

test("spotify: connect, token storage and refresh, playlist selections, top-artist cache, disconnect", async () => {
  await withDatabase(async (db) => {
    let tokenRequests = 0;
    let topArtists = "ok";
    await withFetch((url) => {
      if (url.hostname === "accounts.spotify.com" && url.pathname === "/api/token") {
        tokenRequests += 1;
        return json({ access_token: `access-secret-${tokenRequests}`, refresh_token: tokenRequests === 1 ? "refresh-secret" : undefined, expires_in: 3600, scope: SCOPES });
      }
      if (url.hostname === "api.spotify.com" && url.pathname === "/v1/me/playlists") {
        return json({ items: [{ id: "pl-1", name: "Synthetic", owner: { display_name: "A" }, public: false, collaborative: false, tracks: { total: 3 } }], next: null });
      }
      if (url.hostname === "api.spotify.com" && url.pathname === "/v1/me/top/artists") {
        if (topArtists === "expired") return new Response("", { status: 401 });
        if (topArtists === "down" || (topArtists === "long-term-down" && url.searchParams.get("time_range") === "long_term")) return new Response("", { status: 500 });
        return json({ items: [{ id: `artist-${url.searchParams.get("time_range")}`, name: "Synthetic Artist" }, { id: "", name: "dropped" }] });
      }
      return null;
    }, async () => {
      // --- Connect: one batch clears expired states and stores the new one.
      await db.batch([
        db.prepare("INSERT INTO spotify_oauth_states (state, owner_email, profile_id, verifier, expires_at) VALUES ('expired', ?1, ?2, 'v', ?3)").bind(A.email, A.id, Date.now() - 1),
        db.prepare("INSERT INTO spotify_oauth_states (state, owner_email, profile_id, verifier, expires_at) VALUES ('state-b', ?1, ?2, 'v', ?3)").bind(B.email, B.id, Date.now() + 60_000),
      ]);
      const connectUrl = new URL(await createSpotifyConnectUrl(A, "https://taste.example/"));
      const state = connectUrl.searchParams.get("state");
      assert.equal(connectUrl.searchParams.get("redirect_uri"), "https://taste.example/api/spotify/callback");
      const states = await rows(db, "SELECT state, profile_id, expires_at FROM spotify_oauth_states ORDER BY profile_id");
      assert.deepEqual(states.map((row) => row.state), [state, "state-b"]);
      assert.equal(typeof states[0].expires_at, "number");
      assert.ok(states[0].expires_at > Date.now() + 9 * 60_000, "a millisecond timestamp survives the round trip");

      // --- Callback: the state is bound to the profile that started it.
      const callback = new URL(`https://taste.example/api/spotify/callback?code=code&state=${state}`);
      await assert.rejects(completeSpotifyConnection(callback, B.id), /different Taste Engine profile/);
      await assert.rejects(completeSpotifyConnection(new URL("https://taste.example/api/spotify/callback?code=code&state=expired"), A.id), /expired/);
      await completeSpotifyConnection(callback, A.id);
      assert.equal(await count(db, "spotify_oauth_states", "profile_id = ?1", A.id), 0, "a used state is deleted");
      const stored = await db.prepare("SELECT owner_email, access_token, refresh_token, expires_at, scopes FROM spotify_tokens WHERE profile_id = ?1").bind(A.id).first();
      assert.equal(stored.owner_email, A.email);
      assert.equal(isSealedSpotifyToken(stored.access_token) && isSealedSpotifyToken(stored.refresh_token), true);
      assert.equal(await openSpotifyToken(stored.access_token), "access-secret-1");
      assert.ok(stored.expires_at > Date.now() + 3_000_000);

      const status = await spotifyStatus(A);
      assert.deepEqual(
        { connected: status.connected, missingScopes: status.missingScopes, selected: status.selectedPlaylistCount, shortTerm: status.topArtistWindows.shortTerm.status },
        { connected: true, missingScopes: [], selected: 0, shortTerm: "unavailable" },
      );
      assert.doesNotMatch(JSON.stringify(status), /access-secret|refresh-secret|enc:v1/);
      assert.equal((await spotifyStatus(B)).connected, false);

      // --- An expired access token is refreshed and saved over the same row.
      await db.prepare("UPDATE spotify_tokens SET expires_at = ?1 WHERE profile_id = ?2").bind(Date.now() - 1, A.id).run();
      assert.deepEqual((await listSpotifyPlaylists(A)).map((playlist) => playlist.id), ["pl-1"]);
      assert.equal(tokenRequests, 2);
      const refreshed = await db.prepare("SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE profile_id = ?1").bind(A.id).first();
      assert.equal(await openSpotifyToken(refreshed.access_token), "access-secret-2");
      assert.equal(await openSpotifyToken(refreshed.refresh_token), "refresh-secret", "a refresh that returns no new refresh token keeps the old one");
      assert.ok(refreshed.expires_at > Date.now());
      assert.equal(await count(db, "spotify_tokens"), 1);

      // A token stored before encryption is sealed the first time it is read.
      await db.prepare("UPDATE spotify_tokens SET access_token = 'plaintext-access', refresh_token = NULL WHERE profile_id = ?1").bind(A.id).run();
      assert.equal((await spotifyStatus(A)).connected, true);
      const resealed = await db.prepare("SELECT access_token, refresh_token FROM spotify_tokens WHERE profile_id = ?1").bind(A.id).first();
      assert.equal(await openSpotifyToken(resealed.access_token), "plaintext-access");
      assert.deepEqual([isSealedSpotifyToken(resealed.access_token), resealed.refresh_token], [true, null]);

      // --- Playlist selections: replaced as a whole, listed by name without
      // regard to case and then by id in byte order, as SQLite listed them.
      await writePlaylistSelections(B, [{ id: "b-only", name: "B's", weight: 2 }]);
      await writePlaylistSelections(A, [{ id: "old", name: "Replaced" }]);
      const selections = await writePlaylistSelections(A, [
        { id: "z", name: "beta", weight: 3 },
        { id: "pA", name: "alpha", enabled: false },
        { id: "Pb", name: "Alpha", weight: 99 },
        { id: "Pb", name: "Duplicate id is dropped" },
      ]);
      assert.deepEqual(
        selections.map(({ id, name, weight, enabled }) => ({ id, name, weight, enabled })),
        [
          { id: "Pb", name: "Alpha", weight: 10, enabled: true },
          { id: "pA", name: "alpha", weight: 1, enabled: false },
          { id: "z", name: "beta", weight: 3, enabled: true },
        ],
      );
      assert.deepEqual(selections, await readPlaylistSelections(A));
      assert.deepEqual((await readPlaylistSelections(B)).map((item) => item.id), ["b-only"]);
      assert.equal((await spotifyStatus(A)).selectedPlaylistCount, 2);
      // The delete and the inserts are one transaction. An unclaimed legacy row
      // under the same email makes an insert fail on the primary key; the
      // delete before it must roll back, leaving the selections as they were.
      await db.prepare("INSERT INTO spotify_playlist_selections (owner_email, playlist_id, playlist_name, updated_at) VALUES (?1, 'unclaimed', 'Legacy', ?2)").bind(A.email, iso()).run();
      await assert.rejects(writePlaylistSelections(A, [{ id: "new", name: "New" }, { id: "unclaimed", name: "Collides" }]), /spotify_playlist_selections_owner_email_playlist_id_pk/);
      assert.deepEqual((await readPlaylistSelections(A)).map((item) => item.id), ["Pb", "pA", "z"]);
      await db.prepare("DELETE FROM spotify_playlist_selections WHERE profile_id IS NULL").run();

      // --- Top Artists: each window is cached and replaced only by itself.
      const fresh = await refreshSpotifyTopArtists(A);
      assert.equal(fresh.status, "active");
      assert.deepEqual(fresh.artists.map((artist) => artist.artistId).sort(), ["artist-long_term", "artist-medium_term", "artist-short_term"]);
      assert.equal(await count(db, "spotify_top_artist_windows", "profile_id = ?1", A.id), 3);
      await refreshSpotifyTopArtists(A);
      assert.equal(await count(db, "spotify_top_artist_windows", "profile_id = ?1", A.id), 3, "a second refresh updates the same three rows");

      topArtists = "long-term-down";
      const partial = await refreshSpotifyTopArtists(A);
      assert.deepEqual([partial.status, partial.windows.longTerm.status, partial.windows.shortTerm.status], ["partial", "cached", "fresh"]);
      assert.equal((await spotifyStatus(A)).topArtistWindows.longTerm.status, "cached");
      // An expired cache contributes nothing.
      await db.prepare("UPDATE spotify_top_artist_windows SET expires_at = ?1 WHERE profile_id = ?2 AND window_key = 'longTerm'").bind(iso(-1000), A.id).run();
      assert.equal((await refreshSpotifyTopArtists(A)).windows.longTerm.status, "unavailable");

      // --- An expired authorization drops the token and the cache, nothing else.
      topArtists = "expired";
      await assert.rejects(refreshSpotifyTopArtists(A), (error) => error instanceof SpotifyHttpError && error.status === 401);
      assert.deepEqual(
        [await count(db, "spotify_tokens", "profile_id = ?1", A.id), await count(db, "spotify_top_artist_windows", "profile_id = ?1", A.id), await count(db, "spotify_playlist_selections", "profile_id = ?1", A.id)],
        [0, 0, 3],
      );

      // --- Disconnect deletes everything Spotify-derived for that profile only.
      for (const profile of [A, B]) {
        await db.batch([
          db.prepare("INSERT INTO spotify_tokens (owner_email, profile_id, access_token, expires_at, scopes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(profile.email, profile.id, await sealSpotifyToken("t"), Date.now() + 3_600_000, SCOPES, iso()),
          db.prepare("INSERT INTO spotify_top_artist_windows (owner_email, profile_id, window_key, fetched_at, expires_at, items_json) VALUES (?1, ?2, 'shortTerm', ?3, ?4, '[]')").bind(profile.email, profile.id, iso(), iso(DAY)),
          db.prepare("INSERT INTO spotify_oauth_states (state, owner_email, profile_id, verifier, expires_at) VALUES (?1, ?2, ?3, 'v', ?4)").bind(`pending-${profile.id}`, profile.email, profile.id, Date.now() + 60_000),
          db.prepare("INSERT INTO hosted_taste_snapshots (snapshot_id, owner_email, profile_id, generated_at, status, payload_json, active) VALUES (?1, ?2, ?3, ?4, 'active', '{}', 1)").bind(`taste-${profile.id}`, profile.email, profile.id, iso()),
        ]);
        await publishProjection(profile.id, projection(profile.displayName, iso()));
      }
      await disconnectSpotify(A);
      for (const table of ["spotify_tokens", "spotify_top_artist_windows", "spotify_playlist_selections", "spotify_oauth_states", "hosted_taste_snapshots", "recommendation_snapshots"]) {
        assert.equal(await count(db, table, "profile_id = ?1", A.id), 0, `${table} should hold nothing for the disconnected profile`);
        assert.ok(await count(db, table, "profile_id = ?1", B.id) >= 1, `${table} should keep the other profile's rows`);
      }
    });
  });
});

test("persistence: one active projection per profile, and append-only feedback records with evidence", async () => {
  await withDatabase(async (db) => {
    assert.equal(await readActiveProjection(A.id), null);
    const first = projection("first", "2026-11-01T00:00:00.000Z");
    const published = await publishProjection(A.id, first);
    assert.match(published.snapshotId, new RegExp(`^${A.id}-projection-[a-f0-9]{24}$`));
    await publishProjection(B.id, projection("b", "2026-11-01T00:00:00.000Z"));
    await publishProjection(A.id, projection("second", "2026-11-02T00:00:00.000Z"));
    assert.equal((await readActiveProjection(A.id)).events[0].id, "second");
    assert.equal((await readActiveProjection(B.id)).events[0].id, "b");
    assert.deepEqual(
      await rows(db, "SELECT profile_id, COUNT(*) AS total, SUM(active) AS active FROM recommendation_snapshots GROUP BY profile_id ORDER BY profile_id"),
      [{ profile_id: A.id, total: 2, active: 1 }, { profile_id: B.id, total: 1, active: 1 }],
    );
    // Publishing identical content again reactivates its row instead of adding one.
    assert.equal((await publishProjection(A.id, first)).snapshotId, published.snapshotId);
    assert.equal((await readActiveProjection(A.id)).events[0].id, "first");
    assert.equal(await count(db, "recommendation_snapshots", "profile_id = ?1", A.id), 2);
    const row = await db.prepare("SELECT data_schema_version, code_version, active FROM recommendation_snapshots WHERE snapshot_id = ?1").bind(published.snapshotId).first();
    assert.deepEqual({ data_schema_version: row.data_schema_version, active: row.active }, { data_schema_version: 5, active: 1 });
    await assert.rejects(publishProjection(A.id, { generatedAt: "not a date", events: [] }), /ISO date/);

    // Feedback records: appended once, enriched from the active projection,
    // and read back oldest first with ties broken by id in byte order.
    const record = (feedbackId, recordedAt, extra = {}) => ({
      feedbackId, canonicalEventId: "first", eventDateLocal: "2026-11-21", status: "interested", recordedAt, ...extra,
    });
    await writeFeedbackRecords(A, [
      record("b", "2026-11-11T00:00:01.000Z"),
      record("B", "2026-11-11T00:00:01.000Z"),
      record("a", "2026-11-11T00:00:01.000Z"),
      record("z-earliest", "2026-11-11T00:00:00.000Z"),
    ]);
    await writeFeedbackRecords(A, [record("b", "2026-11-11T00:00:09.000Z", { status: "withdrawn" })]);
    await writeFeedbackRecords(A, [{ feedbackId: "incomplete" }]);
    await writeFeedbackRecords(B, [record("b", "2026-11-11T00:00:01.000Z")]);
    const stored = await readFeedbackRecords(A);
    assert.deepEqual(stored.map((item) => item.feedbackId), ["z-earliest", "B", "a", "b"]);
    assert.equal(stored[3].status, "interested", "a record is never rewritten");
    assert.deepEqual(stored[0].evidenceSnapshot, { canonicalArtistIds: ["artist-1"], canonicalVenueId: "venue-1", promoterOrSeriesIds: [], eventShape: "concert" });
    assert.equal(await count(db, "feedback_records", "profile_id = ?1 AND evidence_json IS NOT NULL", A.id), 4);
    assert.equal((await readFeedbackRecords(B)).length, 1);
  });
});

test("recommendation misses: submitted, classified by their owner only, and grouped for source review", async () => {
  await withDatabase(async (db) => {
    const misses = [];
    for (const path of ["one", "two", "three"]) misses.push(await createRecommendationMiss(A, { eventUrl: `https://tickets.example/${path}` }));
    const other = await createRecommendationMiss(A, { eventDetails: "A warehouse night with no link" });
    const foreign = await createRecommendationMiss(B, { eventUrl: "https://tickets.example/b" });
    await assert.rejects(createRecommendationMiss(A, {}), /event URL or a short description/);
    assert.deepEqual(
      await db.prepare("SELECT owner_email, profile_id, event_url, event_details, resolution_stage, resolved_at FROM recommendation_misses WHERE miss_id = ?1").bind(other.missId).first(),
      { owner_email: A.email, profile_id: A.id, event_url: null, event_details: "A warehouse night with no link", resolution_stage: "untriaged", resolved_at: null },
    );

    assert.deepEqual(await sourceReviewCandidates(A), [], "untriaged misses are not review candidates");
    for (const miss of misses) await classifyRecommendationMiss(A, { missId: miss.missId, classification: "retrieval", resolutionNote: "not retrieved" });
    const [candidate, ...rest] = await sourceReviewCandidates(A);
    assert.deepEqual(rest, []);
    assert.deepEqual({ host: candidate.host, count: candidate.count, urls: [...candidate.supportingUrls].sort() }, {
      host: "tickets.example", count: 3, urls: ["https://tickets.example/one", "https://tickets.example/three", "https://tickets.example/two"],
    });
    assert.deepEqual(await sourceReviewCandidates(A, new Date(Date.now() + 91 * DAY)), [], "only the last 90 days count");
    assert.deepEqual(await sourceReviewCandidates(B), []);

    // An update that matches no row for this owner changes nothing and says so.
    await assert.rejects(classifyRecommendationMiss(A, { missId: foreign.missId, classification: "resolved" }), /not found for this owner/);
    await assert.rejects(classifyRecommendationMiss(A, { missId: "miss-absent", classification: "resolved" }), /not found for this owner/);
    const resolved = await classifyRecommendationMiss(A, { missId: other.missId, classification: "resolved" });
    assert.ok(Date.parse(resolved.resolvedAt));
    assert.equal(await count(db, "recommendation_misses", "resolution_stage = 'untriaged'"), 1, "the other profile's miss was not touched");
  });
});

test("feedback sync: every operation kind, last-write-wins guards, and the one-time legacy carry-over", async () => {
  await withDatabase(async (db) => {
    const T = (minute) => `2026-11-11T18:${String(minute).padStart(2, "0")}:00.000Z`;
    const record = (id) => ({ feedbackId: id, canonicalEventId: `event-${id}`, eventDateLocal: "2026-11-21", status: "interested", recordedAt: T(0) });
    const plan = (itemId, updatedAt, saved = true) => ({ itemId, saved, held: !saved, updatedAt });

    // A profile with only the old whole-state blob: carried over on first read.
    await db.prepare("INSERT INTO feedback_state (owner_email, profile_id, state_json, updated_at) VALUES (?1, ?2, ?3, ?4)").bind(B.email, B.id, JSON.stringify({
      planning: { "legacy-item": plan("legacy-item", T(1)) },
      historyResponses: { "legacy-history": { historyId: "legacy-history", state: "dismissed", feedbackId: null, respondedAt: T(2) } },
      records: { old: { record: record("legacy-record") } },
    }), T(3)).run();
    const carried = await readFeedbackSync(B);
    assert.deepEqual(
      [carried.plans.map((item) => item.itemId), carried.responses.map((item) => item.historyId), carried.records.map((item) => item.feedbackId)],
      [["legacy-item"], ["legacy-history"], ["legacy-record"]],
    );

    assert.deepEqual(await applyFeedbackOps(A, [
      { type: "record", record: record("r1") },
      { type: "plan", item: plan("b", T(5)) },
      { type: "plan", item: plan("B", T(5)) },
      { type: "plan", item: plan("a", T(5), false) },
      { type: "response", response: { historyId: "h2", state: "resolved", feedbackId: "r1", respondedAt: T(6) } },
      { type: "response", response: { historyId: "H1", state: "dismissed", feedbackId: null, respondedAt: T(6) } },
      { type: "setting", key: "learning", value: false, updatedAt: T(7) },
    ]), { applied: 7, rejected: 0 });
    // Older writes arrive late and lose; an answer is not downgraded to a skip.
    await applyFeedbackOps(A, [
      { type: "plan", item: plan("a", T(4), true) },
      { type: "response", response: { historyId: "h2", state: "dismissed", feedbackId: null, respondedAt: T(9) } },
      { type: "setting", key: "learning", value: true, updatedAt: T(1) },
    ]);
    // Newer writes win.
    await applyFeedbackOps(A, [{ type: "plan", item: plan("b", T(8), false) }, { type: "response", response: { historyId: "H1", state: "resolved", feedbackId: "r1", respondedAt: T(9) } }]);

    const state = await readFeedbackSync(A);
    assert.deepEqual(state.plans.map((item) => [item.itemId, item.saved]), [["B", true], ["a", false], ["b", false]]);
    assert.deepEqual(state.responses.map((item) => [item.historyId, item.state]), [["H1", "resolved"], ["h2", "resolved"]]);
    assert.deepEqual(state.settings, { learning: { value: false, updatedAt: T(7) } });
    assert.deepEqual(state.records.map((item) => item.feedbackId), ["r1"]);
    assert.deepEqual(
      await db.prepare("SELECT saved, held FROM feedback_plans WHERE profile_id = ?1 AND item_id = 'a'").bind(A.id).first(),
      { saved: 0, held: 1 },
    );
    assert.equal(await count(db, "feedback_plans", "profile_id = ?1", B.id), 1, "the other profile's state is untouched");
  });
});

test("hosted refresh: lock, conflict, blocked and failed runs, publication and retention", async () => {
  await withDatabase(async (db) => {
    const lockName = `hosted-refresh:${A.id}`;
    const run = (runId) => db.prepare("SELECT status, completed_at, source_health_json, error_summary, code_version FROM source_runs WHERE run_id = ?1").bind(runId).first();
    await db.prepare("INSERT INTO spotify_tokens (owner_email, profile_id, access_token, refresh_token, expires_at, scopes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(A.email, A.id, await sealSpotifyToken("access"), await sealSpotifyToken("refresh"), Date.now() + 3_600_000, SCOPES, iso()).run();

    // --- Blocked: nothing selected. The run is recorded and the lock released.
    const blocked = await runHostedRefresh(A);
    assert.deepEqual([blocked.status, blocked.projectionPublished], ["blocked", false]);
    const blockedRun = await run(blocked.runId);
    assert.deepEqual([blockedRun.status, blockedRun.error_summary], ["blocked", "Select at least one Spotify playlist from the Taste tab."]);
    assert.equal(JSON.parse(blockedRun.source_health_json).length, 3);
    assert.ok(Date.parse(blockedRun.completed_at));
    assert.equal(await count(db, "refresh_locks"), 0);

    // --- Conflict: a live lock held by another run refuses this one and survives it.
    await db.prepare("INSERT INTO refresh_locks (lock_name, run_id, expires_at) VALUES (?1, 'other-run', ?2)").bind(lockName, Date.now() + 60_000).run();
    await assert.rejects(runHostedRefresh(A), HostedRefreshConflictError);
    assert.deepEqual(await rows(db, "SELECT run_id FROM refresh_locks"), [{ run_id: "other-run" }]);
    assert.equal(await count(db, "source_runs"), 1, "a refused run starts nothing");
    await runHostedRefresh(B); // another profile's lock is independent
    // An expired lock is taken over.
    await db.prepare("UPDATE refresh_locks SET expires_at = ?1 WHERE lock_name = ?2").bind(Date.now() - 1, lockName).run();
    assert.equal((await runHostedRefresh(A)).status, "blocked");
    assert.equal(await count(db, "refresh_locks"), 0);

    await writePlaylistSelections(A, [{ id: "playlist-1", name: "Synthetic", weight: 2 }]);
    const spotify = (url) => {
      if (url.hostname !== "api.spotify.com") return null;
      if (url.pathname === "/v1/playlists/playlist-1/items") {
        return json({ items: [{ track: { id: "track-1", name: "Synthetic Track", type: "track", artists: [{ id: "spotify-1", name: "Test Artist" }] } }], next: null });
      }
      if (url.pathname === "/v1/artists") return json({ artists: [{ id: "spotify-1", name: "Test Artist", genres: ["house"] }] });
      if (url.pathname === "/v1/me/top/artists") return json({ items: [{ id: "spotify-1", name: "Test Artist" }] });
      return null;
    };

    // --- Failed: an error after the run started is recorded, then rethrown.
    process.env.TASTE_ENGINE_CONFIG_JSON = "{ not json";
    await withFetch(spotify, async () => {
      await assert.rejects(runHostedRefresh(A));
    });
    const failed = await db.prepare("SELECT status, error_summary, completed_at FROM source_runs WHERE profile_id = ?1 ORDER BY started_at DESC LIMIT 1").bind(A.id).first();
    assert.deepEqual([failed.status, failed.error_summary], ["failed", "Hosted refresh unavailable."]);
    assert.ok(Date.parse(failed.completed_at));
    assert.equal(await count(db, "refresh_locks"), 0, "a failed run releases its lock");
    assert.equal(await count(db, "recommendation_snapshots"), 0);

    // --- Published. History older than the retention window is pruned for
    // this profile only: 5 snapshots of each kind and 60 runs are kept.
    const old = (index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
    for (const profile of [A, B]) {
      await db.batch(Array.from({ length: 7 }, (_, index) => [
        db.prepare("INSERT INTO recommendation_snapshots (snapshot_id, profile_id, generated_at, payload_json, payload_hash, created_at, active) VALUES (?1, ?2, ?3, '{}', ?1, ?3, ?4)")
          .bind(`${profile.id}-old-${index}`, profile.id, old(index), index === 6 ? 1 : 0),
        db.prepare("INSERT INTO hosted_taste_snapshots (snapshot_id, owner_email, profile_id, generated_at, status, payload_json, active) VALUES (?1, ?2, ?3, ?4, 'active', '{}', ?5)")
          .bind(`${profile.id}-taste-${index}`, profile.email, profile.id, old(index), index === 6 ? 1 : 0),
      ]).flat());
      await db.batch(Array.from({ length: 70 }, (_, index) => db
        .prepare("INSERT INTO source_runs (run_id, profile_id, status, started_at) VALUES (?1, ?2, 'completed', ?3)")
        .bind(`${profile.id}-run-${index}`, profile.id, old(index))));
    }
    const runsBefore = await count(db, "source_runs", "profile_id = ?1", A.id);
    const soon = (days) => new Date(Date.now() + days * DAY);
    const localDate = (date) => date.toISOString().slice(0, 10);
    setEnvironment({
      TASTE_ENGINE_CONFIG_JSON: JSON.stringify({
        brief: {
          home: { label: "Los Angeles", lat: 34.0522, lon: -118.2437 }, upcomingHorizonDays: 30, maxSeatGeekPages: 1, seatGeekWindowDays: 30,
          seatGeekPerformerArtistLimit: 1, frameworkArtistLimit: 1, ticketmasterArtistQueryLimit: 1, lastFmSeedArtistLimit: 1, lastFmSimilarPerArtist: 1,
          lastFmTopTagCount: 1, lastFmArtistsPerTag: 1, pinnedArtists: [], excludedArtists: [], excludedVenues: [],
        },
        movies: {
          maxCandidates: 1, minimumPopularity: 1, highPopularityOverride: 1, preferredGenreIds: [878], excludedGenreIds: [], preferredDirectors: [],
          preferredCinematographers: [], preferredCast: [], preferredCompanies: [], preferredKeywords: [], priorityTheaters: [],
        },
        sports: { teamId: 119, teamName: "Los Angeles Dodgers", homeVenueIds: [22], maxPitcherStats: 1, maxTicketPages: 1, rivalries: {} },
        personalContext: { background: [], decisionPreferences: [], maxEnhancedEvents: 1, maxEnhancedSports: 1 },
      }),
      LASTFM_API_KEY: "lastfm",
      SEATGEEK_CLIENT_ID: "seatgeek",
      TICKETMASTER_API_KEY: "ticketmaster",
    });
    let summary;
    await withFetch((url) => {
      const spotifyResponse = spotify(url);
      if (spotifyResponse) return spotifyResponse;
      if (url.hostname === "ws.audioscrobbler.com") {
        return json(url.searchParams.get("method") === "artist.getsimilar"
          ? { similarartists: { artist: [{ name: "Adjacent Artist", match: "0.8" }] } }
          : { topartists: { artist: [{ name: "Test Artist", "@attr": { rank: "1" } }] } });
      }
      if (url.hostname === "thisisframework.com" && url.pathname === "/artists/") return new Response("<html></html>");
      if (url.hostname === "thisisframework.com") return json({ events: [], total_pages: 1 });
      if (url.hostname === "www.insomniac.com") return new Response("<html></html>");
      if (url.hostname === "api.seatgeek.com" && url.pathname.endsWith("/performers")) return json({ performers: [{ id: 9, name: "Test Artist", has_upcoming_events: true }] });
      if (url.hostname === "api.seatgeek.com" && url.searchParams.get("taxonomies.name")) return json({ events: [], meta: { total: 0 } });
      if (url.hostname === "api.seatgeek.com") {
        const start = soon(14);
        return json({ events: [{
          id: 1, title: "Test Artist Live", type: "concert", datetime_local: `${localDate(start)}T20:00:00`, datetime_utc: `${localDate(soon(15))}T03:00:00Z`,
          url: "https://example.com/seatgeek", venue: { id: 10, name: "The Venue", city: "Los Angeles", state: "CA", location: { lat: 34.05, lon: -118.24 } },
          performers: [{ id: 9, name: "Test Artist", primary: true }], stats: { listing_count: 20, lowest_price: 40 },
        }], meta: { total: 1 } });
      }
      if (url.hostname === "app.ticketmaster.com" && url.searchParams.get("classificationName") === "Sports") return json({ _embedded: { events: [] }, page: { totalPages: 0 } });
      if (url.hostname === "app.ticketmaster.com") {
        return json({ _embedded: { events: [{
          id: "tm-1", name: "Test Artist Live", url: "https://example.com/ticketmaster",
          dates: { start: { localDate: localDate(soon(14)), localTime: "20:00:00" }, status: { code: "onsale" } },
          _embedded: {
            venues: [{ id: "v", name: "The Venue", city: { name: "Los Angeles" }, state: { stateCode: "CA" }, location: { latitude: "34.05", longitude: "-118.24" } }],
            attractions: [{ id: "a", name: "Test Artist" }],
          },
        }] }, page: { totalPages: 1 } });
      }
      // Every other source is simply down; a refresh must publish regardless.
      return new Response("", { status: 503 });
    }, async () => {
      summary = await runHostedRefresh(A);
    });

    assert.deepEqual(summary.publicationBlockers, []);
    assert.equal(summary.projectionPublished, true);
    assert.ok(["completed", "partial"].includes(summary.status));
    assert.equal(summary.directArtistCount, 1);
    const finished = await run(summary.runId);
    assert.deepEqual([finished.status, finished.error_summary], [summary.status, null]);
    assert.ok(JSON.parse(finished.source_health_json).some((source) => source.source === "spotify-playlists" && source.status === "active"));
    assert.equal(await count(db, "refresh_locks"), 0);

    const active = await readActiveProjection(A.id);
    assert.equal(active.schemaVersion, 5);
    assert.equal(active.events.length, 1, "the stubbed concert is ranked and published");
    assert.deepEqual(
      await rows(db, "SELECT snapshot_id FROM recommendation_snapshots WHERE profile_id = ?1 AND active = 1", A.id),
      [{ snapshot_id: (await rows(db, "SELECT snapshot_id FROM recommendation_snapshots WHERE profile_id = ?1 ORDER BY created_at DESC LIMIT 1", A.id))[0].snapshot_id }],
    );
    const taste = await rows(db, "SELECT snapshot_id, status, payload_json FROM hosted_taste_snapshots WHERE profile_id = ?1 AND active = 1", A.id);
    assert.deepEqual(taste.map((row) => row.snapshot_id), [summary.tasteSnapshotId]);
    const tastePayload = JSON.parse(taste[0].payload_json);
    assert.match(tastePayload.ownerRef, /^[a-f0-9]{20}$/);
    assert.ok(Array.isArray(tastePayload.sourceHealth) && tastePayload.sourceHealth.length > 0);

    // Retention: the new row plus the four newest old ones; 60 runs including this one.
    assert.deepEqual(
      (await rows(db, "SELECT snapshot_id FROM recommendation_snapshots WHERE profile_id = ?1 AND active = 0 ORDER BY created_at", A.id)).map((row) => row.snapshot_id),
      [3, 4, 5, 6].map((index) => `${A.id}-old-${index}`),
    );
    assert.deepEqual(
      (await rows(db, "SELECT snapshot_id FROM hosted_taste_snapshots WHERE profile_id = ?1 AND active = 0 ORDER BY generated_at", A.id)).map((row) => row.snapshot_id),
      [3, 4, 5, 6].map((index) => `${A.id}-taste-${index}`),
    );
    assert.ok(runsBefore > 60);
    assert.equal(await count(db, "source_runs", "profile_id = ?1", A.id), 60);
    assert.equal(await count(db, "source_runs", "profile_id = ?1 AND run_id = ?2", A.id, summary.runId), 1);
    assert.deepEqual(
      [await count(db, "recommendation_snapshots", "profile_id = ?1", B.id), await count(db, "hosted_taste_snapshots", "profile_id = ?1", B.id), await count(db, "source_runs", "profile_id = ?1", B.id)],
      [7, 7, 71],
      "another profile's history is not pruned",
    );

    // A second refresh replaces the active rows; there is still exactly one of each.
    await withFetch((url) => spotify(url) ?? new Response("", { status: 503 }), async () => {
      const second = await runHostedRefresh(A);
      // With every candidate source down the previous projection is preserved.
      assert.equal(second.projectionPublished, false);
      assert.match(second.publicationBlockers.join(" "), /previous projection was preserved/);
    });
    assert.equal(await count(db, "recommendation_snapshots", "profile_id = ?1 AND active = 1", A.id), 1);
    assert.equal((await readActiveProjection(A.id)).events.length, 1);
  });
});

test("health: reports profiles and active projections from the database, and degrades when it is unreachable", async () => {
  await withDatabase(async (db) => {
    const empty = await (await healthRoute()).json();
    assert.deepEqual(empty.database, { ready: true, profileCount: 0, activeProjectionCount: 0 });
    assert.equal(empty.release.databaseSchemaVersion, 4);

    const profile = db.prepare(`
      INSERT INTO profiles (profile_id, identity_hash, owner_email, display_name, enabled, legacy_default, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)
    `);
    await db.batch([
      profile.bind(A.id, "hash-a", A.email, "A", 1, iso()),
      profile.bind(B.id, "hash-b", B.email, "B", 1, iso()),
      profile.bind("profile_cccccccccccccccccccccccc", "hash-c", "c@example.com", "C", 0, iso()),
    ]);
    await publishProjection(A.id, projection("a1", iso()));
    await publishProjection(A.id, projection("a2", iso()));
    await publishProjection(B.id, projection("b1", iso()));
    const response = await healthRoute();
    const body = await response.json();
    assert.deepEqual(body.database, { ready: true, profileCount: 2, activeProjectionCount: 2 });
    assert.strictEqual(body.database.activeProjectionCount, 2);
    assert.equal(response.status, 503, "a test environment is never production-ready");
  });
  setDatabaseForTests(unavailableDatabase());
  try {
    assert.deepEqual((await (await healthRoute()).json()).database, { ready: false, profileCount: null, activeProjectionCount: null });
  } finally {
    setDatabaseForTests(null);
  }
});

test("every SQL statement in the server code was executed against Postgres", () => {
  const coverage = statementCoverage([
    "server/profiles.ts",
    "server/hosted-refresh.ts",
    "server/spotify.ts",
    "server/recommendation-misses.ts",
    "server/feedback-sync.ts",
    "server/persistence.ts",
    "app/api/health/route.ts",
  ]);
  assert.deepEqual(coverage.flatMap((file) => file.missing), [], "statements that never ran");
  assert.deepEqual(
    Object.fromEntries(coverage.map((file) => [file.file, `${file.covered}/${file.total}`])),
    {
      "server/profiles.ts": "7/7",
      "server/hosted-refresh.ts": "12/12",
      "server/spotify.ts": "19/19",
      "server/recommendation-misses.ts": "3/3",
      "server/feedback-sync.ts": "8/8",
      "server/persistence.ts": "5/5",
      "app/api/health/route.ts": "2/2",
    },
  );
  assert.equal(coverage.reduce((total, file) => total + file.total, 0), 56);

  // Two call sites build more than one statement; each form must have run.
  const executed = executedStatements();
  const ran = (pattern) => executed.filter((text) => pattern.test(text.replace(/\s+/g, " "))).length;
  assert.equal(ran(/INSERT INTO profiles .* VALUES \(\$1, \$2, \$3, \$4, 1, 1, \$5, \$6, \$6\)/), 1, "legacy profile upsert");
  assert.equal(ran(/INSERT INTO profiles .* VALUES \(\$1, \$2, \$3, \$4, 1, 0, NULL, \$5, \$5\)/), 1, "ordinary profile upsert");
  assert.equal(ran(/UPDATE \w+ SET profile_id = \$1 WHERE profile_id IS NULL AND lower\(owner_email\) = \$2/), 8, "legacy claim, one per owner-scoped table");
});

function projection(id, generatedAt) {
  return {
    schemaVersion: 5,
    generatedAt,
    events: [{
      id,
      startLocal: "2026-11-21T20:00:00",
      eventType: "concert",
      venue: { sourceId: "venue-1" },
      matchedArtists: [{ spotifyArtistId: "artist-1" }],
    }],
    movies: [],
    sports: [],
  };
}

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function requestUrl(input) {
  return new URL(input instanceof Request ? input.url : String(input));
}

// Runs `run` with `fetch` answered by `respond(url)`. A request it returns
// nothing for fails the test rather than reaching the network.
async function withFetch(respond, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    const response = await respond(url);
    if (!response) throw new Error(`Unexpected network request: ${url.origin}${url.pathname}`);
    return response;
  };
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function setEnvironment(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
