import assert from "node:assert/strict";
import test from "node:test";
import { applyFeedbackOps, readFeedbackSync } from "../server/feedback-sync.ts";
import { invalidateSpotifyAuthorization } from "../server/spotify.ts";
import { crossSiteRejection } from "../server/cross-site.ts";
import { emptyStore, planConstraints, recordInterest, setLearning, setPlanConstraints, setPlanningIntent, withdrawFeedback } from "../app/feedback-store.ts";
import { mergeRemote, normalizeRemote, pendingOps } from "../app/feedback-sync.ts";
import { count, withDatabase } from "./helpers/pg-database.mjs";

const A = { id: "profile_aaaaaaaaaaaaaaaaaaaaaaaa", email: "a@example.com", displayName: "A", legacyDefault: false };
const B = { id: "profile_bbbbbbbbbbbbbbbbbbbbbbbb", email: "b@example.com", displayName: "B", legacyDefault: false };
const T = (minute) => `2026-11-11T18:${String(minute).padStart(2, "0")}:00.000Z`;

const record = (id, overrides = {}) => ({
  feedbackId: id, feedbackSnapshotId: `fs-${id}`, canonicalEventId: `event-${id}`, eventDateLocal: "2026-11-21",
  eventTitleSnapshot: "Synthetic Night", status: "interested", reasonCodes: [], rating: 5, signalTags: [], notes: null,
  feedbackKeys: { artist: [{ key: "artist:synthetic", label: "Synthetic" }] }, recordedAt: T(0), ...overrides,
});
const plan = (itemId, updatedAt, saved = true) => ({
  itemId, saved, held: false, updatedAt, createdAt: T(0), presentInProjection: true, lastReconciledAt: null,
  capturedSnapshot: { itemId, title: "Synthetic Night", dateLocal: "2026-11-21", vertical: "music", locationLabel: null },
  currentSnapshot: { itemId, title: "Synthetic Night", dateLocal: "2026-11-21", vertical: "music", locationLabel: null },
  capturedFeedbackSnapshot: null, currentFeedbackSnapshot: null,
});

test("each kind of operation is stored per entity, idempotently, and scoped to its profile", async () => {
  await withDatabase(async (db) => {
    const ops = [
      { type: "record", record: record("r1") },
      { type: "plan", item: plan("event-1", T(1)) },
      { type: "response", response: { historyId: "rh-1", state: "resolved", feedbackId: "r1", respondedAt: T(2) } },
      { type: "setting", key: "learning", value: false, updatedAt: T(3) },
    ];
    assert.deepEqual(await applyFeedbackOps(A, ops), { applied: 4, rejected: 0 });
    // Sending the same operations again changes nothing.
    await applyFeedbackOps(A, ops);
    const state = await readFeedbackSync(A);
    assert.deepEqual(state.records.map((item) => item.feedbackId), ["r1"]);
    assert.deepEqual(state.records[0].feedbackKeys, { artist: [{ key: "artist:synthetic", label: "Synthetic" }] });
    assert.equal(state.plans.length, 1);
    assert.equal(state.responses[0].state, "resolved");
    assert.deepEqual(state.settings.learning, { value: false, updatedAt: T(3) });
    assert.equal(await count(db, "feedback_records"), 1);

    const other = await readFeedbackSync(B);
    assert.deepEqual([other.records.length, other.plans.length, other.responses.length, Object.keys(other.settings).length], [0, 0, 0, 0]);
  });
});

test("a late older edit never undoes a newer one, and an answer is never downgraded to a skip", async () => {
  await withDatabase(async () => {
    await applyFeedbackOps(A, [{ type: "plan", item: plan("event-1", T(10), true) }]);
    await applyFeedbackOps(A, [{ type: "plan", item: plan("event-1", T(5), false) }]);
    assert.equal((await readFeedbackSync(A)).plans[0].saved, true);
    await applyFeedbackOps(A, [{ type: "plan", item: plan("event-1", T(11), false) }]);
    assert.equal((await readFeedbackSync(A)).plans[0].saved, false, "a removal is a newer write and syncs like any other");

    await applyFeedbackOps(A, [{ type: "response", response: { historyId: "rh-1", state: "resolved", feedbackId: "r1", respondedAt: T(1) } }]);
    await applyFeedbackOps(A, [{ type: "response", response: { historyId: "rh-1", state: "dismissed", feedbackId: null, respondedAt: T(9) } }]);
    assert.equal((await readFeedbackSync(A)).responses[0].state, "resolved");

    await applyFeedbackOps(A, [{ type: "setting", key: "learning", value: true, updatedAt: T(8) }]);
    await applyFeedbackOps(A, [{ type: "setting", key: "learning", value: false, updatedAt: T(4) }]);
    assert.equal((await readFeedbackSync(A)).settings.learning.value, true);
  });
});

test("malformed operations are rejected one by one without blocking the valid ones", async () => {
  await withDatabase(async () => {
    const result = await applyFeedbackOps(A, [
      { type: "record", record: record("ok") },
      { type: "record", record: record("bad-status", { status: "hacked" }) },
      { type: "record", record: { feedbackId: "no-date" } },
      { type: "plan", item: { itemId: "x" } },
      { type: "setting", key: "admin", value: true, updatedAt: T(1) },
      { type: "nonsense" },
    ]);
    assert.deepEqual(result, { applied: 1, rejected: 5 });
    await assert.rejects(applyFeedbackOps(A, { not: "an array" }), /array/);
    const stored = (await readFeedbackSync(A)).records[0];
    assert.equal(stored.notes, null, "free text never reaches the server record");
  });
});

test("the old whole-state blob is carried over once, without losing plans or check-ins", async () => {
  await withDatabase(async (db) => {
    await db.prepare("INSERT INTO feedback_state (owner_email, profile_id, state_json, updated_at) VALUES (?1, ?2, ?3, ?4)").bind(A.email, A.id, JSON.stringify({
      version: 3,
      planning: { "event-legacy": plan("event-legacy", T(1)) },
      historyResponses: { "rh-legacy": { historyId: "rh-legacy", state: "dismissed", feedbackId: null, respondedAt: T(2) } },
      records: { "site-old": { record: record("site-old", { status: "attended-worth-it" }) } },
      exportBatches: {},
    }), T(3)).run();
    const state = await readFeedbackSync(A);
    assert.deepEqual(state.plans.map((item) => item.itemId), ["event-legacy"]);
    assert.deepEqual(state.responses.map((item) => item.historyId), ["rh-legacy"]);
    assert.deepEqual(state.records.map((item) => item.feedbackId), ["site-old"]);
  });
});

test("two devices converge, and a failed save loses nothing", async () => {
  await withDatabase(async () => {
    const snapshot = { feedbackSnapshotId: "fs-1", canonicalEventId: "event-1", eventDateLocal: "2026-11-21", eventTitleSnapshot: "Synthetic Night", vertical: "music", feedbackKeys: { artist: [{ key: "artist:synthetic", label: "Synthetic" }] } };
    const input = (id) => ({ planningSnapshot: { itemId: id, title: "Synthetic Night", dateLocal: "2026-11-21", vertical: "music", locationLabel: null }, feedbackSnapshot: null });
    // Device one: a triage read and a save, made while offline.
    let phone = recordInterest(emptyStore(), snapshot, "in", { now: T(1), uuid: "phone-1" });
    phone = setPlanningIntent(phone, input("event-1"), "saved", true, T(1));
    // Device two: a different save and the learning switch.
    let laptop = setPlanningIntent(emptyStore(), input("event-2"), "held", true, T(2));
    laptop = setLearning(laptop, false, T(2));

    const sync = async (store) => {
      const remote = normalizeRemote(await readFeedbackSync(A));
      const ops = pendingOps(store, remote);
      if (ops.length) await applyFeedbackOps(A, JSON.parse(JSON.stringify(ops)));
      return mergeRemote(store, normalizeRemote(await readFeedbackSync(A)));
    };

    // The phone's first attempt fails: its changes are simply still pending.
    const empty = normalizeRemote(await readFeedbackSync(A));
    assert.equal(pendingOps(phone, empty).length, 2);
    phone = await sync(phone);
    laptop = await sync(laptop);
    phone = await sync(phone);

    for (const device of [phone, laptop]) {
      assert.deepEqual(Object.keys(device.planning).sort(), ["event-1", "event-2"]);
      assert.deepEqual(Object.keys(device.records), ["site-phone-1"]);
      assert.equal(device.settings.learning.value, false);
    }
    assert.equal(pendingOps(phone, normalizeRemote(await readFeedbackSync(A))).length, 0);

    // An undo on one device reaches the other as an appended withdrawal.
    laptop = await sync(withdrawFeedback(laptop, snapshot, { now: T(5), uuid: "laptop-undo" }));
    phone = await sync(phone);
    assert.equal(phone.records["site-laptop-undo"].record.status, "withdrawn");
    // Merging state that brings nothing new returns the same object.
    assert.equal(mergeRemote(phone, normalizeRemote(await readFeedbackSync(A))), phone);
  });
});

test("an expired Spotify authorization drops the token, not the person's selections or projection", async () => {
  await withDatabase(async (db) => {
    await db.batch([
      db.prepare("INSERT INTO spotify_tokens (owner_email, profile_id, access_token, refresh_token, expires_at, scopes, updated_at) VALUES ('a@example.com', ?1, 'x', 'y', 0, '', 'now')").bind(A.id),
      db.prepare("INSERT INTO spotify_playlist_selections (owner_email, profile_id, playlist_id, playlist_name, weight, enabled, updated_at) VALUES ('a@example.com', ?1, 'p1', 'One', 1, 1, 'now')").bind(A.id),
      db.prepare("INSERT INTO recommendation_snapshots (snapshot_id, profile_id, generated_at, payload_json, payload_hash, created_at, active) VALUES ('s1', ?1, 'now', '{}', 'h', 'now', 1)").bind(A.id),
    ]);
    await invalidateSpotifyAuthorization(A);
    assert.deepEqual(
      [await count(db, "spotify_tokens"), await count(db, "spotify_playlist_selections"), await count(db, "recommendation_snapshots")],
      [0, 1, 1],
    );
  });
});

test("cross-site writes are refused; same-origin and non-browser requests pass", () => {
  const request = (headers) => new Request("https://taste.example/api/feedback/sync", { method: "POST", headers });
  assert.equal(crossSiteRejection(request({ "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(crossSiteRejection(request({ "sec-fetch-site": "same-site" })).status, 403);
  assert.equal(crossSiteRejection(request({ origin: "https://evil.example" })).status, 403);
  assert.equal(crossSiteRejection(request({ "sec-fetch-site": "same-origin" })), null);
  assert.equal(crossSiteRejection(request({ origin: "https://taste.example" })), null);
  assert.equal(crossSiteRejection(request({})), null);
});

test("planning limits sync per profile, are normalized by the solver, and reject anything that is not an object", async () => {
  await withDatabase(async () => {
    const limits = { windowDays: 60, nightsPerWeek: 3, budgetUsd: 400, avoidBackToBack: false, includeTrips: true };
    let laptop = setPlanConstraints(emptyStore(), limits, T(3));
    const remote = normalizeRemote(await readFeedbackSync(A));
    const ops = pendingOps(laptop, remote);
    assert.deepEqual(ops, [{ type: "setting", key: "planning", value: limits, updatedAt: T(3) }]);

    // Hostile and malformed values: stored only after normalization, or refused.
    const result = await applyFeedbackOps(A, [
      ...JSON.parse(JSON.stringify(ops)),
      { type: "setting", key: "planning", value: "2 nights", updatedAt: T(4) },
      { type: "setting", key: "planning", value: [1, 2], updatedAt: T(4) },
    ]);
    assert.deepEqual(result, { applied: 1, rejected: 2 });
    await applyFeedbackOps(A, [{ type: "setting", key: "planning", value: { windowDays: 9999, nightsPerWeek: -4, budgetUsd: "lots", extra: "<script>" }, updatedAt: T(6) }]);
    const stored = (await readFeedbackSync(A)).settings.planning.value;
    assert.deepEqual(Object.keys(stored).sort(), ["avoidBackToBack", "budgetUsd", "includeTrips", "nightsPerWeek", "windowDays"]);
    assert.ok([14, 30, 60, 90].includes(stored.windowDays));
    assert.ok(stored.nightsPerWeek >= 1 && stored.nightsPerWeek <= 7);
    assert.equal(stored.budgetUsd, null);

    // A second device receives the newer limits; an older local edit does not win.
    const phone = mergeRemote(setPlanConstraints(emptyStore(), limits, T(1)), normalizeRemote(await readFeedbackSync(A)));
    assert.deepEqual(planConstraints(phone), stored);
    laptop = mergeRemote(laptop, normalizeRemote(await readFeedbackSync(A)));
    assert.equal(pendingOps(laptop, normalizeRemote(await readFeedbackSync(A))).length, 0);
    // Another profile sees none of it.
    assert.equal((await readFeedbackSync(B)).settings.planning, undefined);
  });
});
