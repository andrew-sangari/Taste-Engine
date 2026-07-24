import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  confirmHistoryFeedback,
  dismissHistory,
  emptyStore,
  loadStore,
  markBatchDownloadTriggered,
  prepareExportBatch,
  recentRecommendationQueue,
  reconcileWithProjection,
  recordNotForMe,
  saveStore,
  serializeBatch,
  setPlanningIntent,
  unexportedRecords,
  upcomingPlanning,
} from "../app/feedback-store.ts";

const NOW = "2026-07-13T18:00:00.000Z";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    dump: () => Object.fromEntries(map),
  };
}

function musicInput(id = "event:1", dateLocal = "2026-08-01") {
  return {
    planningSnapshot: { itemId: id, title: "Prospa", dateLocal, vertical: "music", locationLabel: "Shrine · LA" },
    feedbackSnapshot: {
      feedbackSnapshotId: `fs-${id}-${dateLocal}`,
      canonicalEventId: id,
      eventDateLocal: dateLocal,
      eventTitleSnapshot: "Prospa",
      vertical: "music",
    },
  };
}

function history(id = "event:1", dateLocal = "2026-07-01", surfaces = ["shortlist"]) {
  return {
    historyId: `rh-${id}-${dateLocal}`,
    canonicalEventId: id,
    feedbackSnapshotId: `fs-${id}-${dateLocal}`,
    vertical: "music",
    title: "Prospa",
    dateLocal,
    locationLabel: "Shrine · LA",
    firstShownAt: "2026-06-01T00:00:00.000Z",
    lastShownAt: "2026-06-10T00:00:00.000Z",
    surfaces,
    bestRank: 2,
  };
}

test("persists version 2 and fails soft on corruption", () => {
  const storage = fakeStorage();
  const store = setPlanningIntent(emptyStore(), musicInput(), "saved", true, NOW);
  assert.ok(saveStore(storage, store));
  assert.equal(loadStore(storage).planning["event:1"].saved, true);
  assert.deepEqual(loadStore(fakeStorage({ [STORAGE_KEY]: "{corrupted" })), emptyStore());
  assert.deepEqual(loadStore(null), emptyStore());
});

test("migrates saved v1 planning and records while dropping unresolved legacy skips", () => {
  const saved = musicInput("event:saved");
  const skipped = musicInput("event:skipped");
  const legacy = {
    version: 1,
    planning: {
      "event:saved": { itemId: "event:saved", state: "saved", capturedSnapshot: saved.planningSnapshot, currentSnapshot: saved.planningSnapshot, capturedFeedbackSnapshot: saved.feedbackSnapshot, currentFeedbackSnapshot: saved.feedbackSnapshot, presentInProjection: true, resolvedFeedbackId: null, createdAt: NOW, updatedAt: NOW },
      "event:skipped": { itemId: "event:skipped", state: "skipped", capturedSnapshot: skipped.planningSnapshot, currentSnapshot: skipped.planningSnapshot, capturedFeedbackSnapshot: skipped.feedbackSnapshot, currentFeedbackSnapshot: skipped.feedbackSnapshot, presentInProjection: true, resolvedFeedbackId: null, createdAt: NOW, updatedAt: NOW },
    },
    records: { kept: { record: { feedbackId: "kept" } } },
    exportBatches: { batch: { exportBatchId: "batch" } },
  };
  const migrated = loadStore(fakeStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(legacy) }));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.planning["event:saved"].saved, true);
  assert.equal(migrated.planning["event:saved"].held, false);
  assert.equal(migrated.planning["event:skipped"], undefined);
  assert.ok(migrated.records.kept);
  assert.ok(migrated.exportBatches.batch);
});

test("save and hold are independent intents and reconciliation preserves captured snapshots", () => {
  let store = setPlanningIntent(emptyStore(), musicInput(), "saved", true, NOW);
  store = setPlanningIntent(store, musicInput(), "held", true, NOW);
  assert.equal(store.planning["event:1"].saved, true);
  assert.equal(store.planning["event:1"].held, true);
  store = reconcileWithProjection(store, [musicInput("event:1", "2026-08-02")], NOW);
  assert.equal(store.planning["event:1"].capturedSnapshot.dateLocal, "2026-08-01");
  assert.equal(store.planning["event:1"].currentSnapshot.dateLocal, "2026-08-02");
  store = setPlanningIntent(store, musicInput("event:1", "2026-08-02"), "saved", false, NOW);
  assert.equal(store.planning["event:1"].held, true);
  assert.deepEqual(upcomingPlanning(store, "2026-07-13").map((item) => item.itemId), ["event:1"]);
});

test("history queue works without prior save and follows planning and surface priority", () => {
  const overview = history("event:overview", "2026-07-02", ["overview"]);
  const planned = history("event:planned", "2026-07-01", ["shortlist"]);
  const planAhead = history("event:later", "2026-07-03", ["plan-ahead"]);
  let store = setPlanningIntent(emptyStore(), musicInput("event:planned", "2026-07-01"), "saved", true, NOW);
  const queue = recentRecommendationQueue(store, [overview, planned, planAhead], "2026-07-13");
  assert.deepEqual(queue.map((entry) => entry.history.canonicalEventId), ["event:planned", "event:overview", "event:later"]);
  assert.equal(queue[1].eligible, true);
});

test("didn't go dismisses locally without creating taste evidence", () => {
  const item = history();
  const store = dismissHistory(emptyStore(), item.historyId, NOW);
  assert.equal(Object.keys(store.records).length, 0);
  assert.equal(store.historyResponses[item.historyId].state, "dismissed");
  assert.deepEqual(recentRecommendationQueue(store, [item], "2026-07-13"), []);
});

test("attendance and explicit Not for me map to existing journal states and reject duplicates", () => {
  const item = history();
  let attended = confirmHistoryFeedback(emptyStore(), item, "attended-worth-it", { now: NOW, uuid: "attended" });
  assert.equal(attended.records["site-attended"].record.status, "attended-worth-it");
  assert.equal(attended.historyResponses[item.historyId].state, "resolved");
  attended = confirmHistoryFeedback(attended, item, "attended-not-worth-it", { now: NOW, uuid: "duplicate" });
  assert.equal(attended.records["site-duplicate"], undefined);

  const snapshot = musicInput("event:negative", "2026-08-01").feedbackSnapshot;
  let negative = recordNotForMe(emptyStore(), snapshot, { now: NOW, uuid: "negative" });
  assert.equal(negative.records["site-negative"].record.status, "skipped-no-longer-interested");
  negative = recordNotForMe(negative, snapshot, { now: NOW, uuid: "again" });
  assert.equal(negative.records["site-again"], undefined);
});

test("movies remain visible history but are not feedback eligible", () => {
  const item = { ...history("movie:1"), vertical: "movies", feedbackSnapshotId: null };
  const queue = recentRecommendationQueue(emptyStore(), [item], "2026-07-13");
  assert.equal(queue[0].eligible, false);
  const unchanged = confirmHistoryFeedback(emptyStore(), item, "attended-worth-it", { now: NOW, uuid: "no" });
  assert.equal(Object.keys(unchanged.records).length, 0);
});

test("export batches remain deterministic and truthful about triggered downloads", () => {
  let store = confirmHistoryFeedback(emptyStore(), history("event:1", "2026-07-01"), "attended-worth-it", { now: "2026-07-13T02:00:00.000Z", uuid: "b" });
  store = confirmHistoryFeedback(store, history("event:2", "2026-07-02"), "attended-not-worth-it", { now: "2026-07-13T01:00:00.000Z", uuid: "a" });
  const first = prepareExportBatch(store, { now: NOW, uuid: "batch1" });
  assert.deepEqual(first.batch.feedbackIds, ["site-a", "site-b"]);
  assert.equal(unexportedRecords(first.store).length, 2);
  store = markBatchDownloadTriggered(first.store, first.batch.exportBatchId, NOW);
  assert.equal(unexportedRecords(store).length, 0);
  assert.equal(serializeBatch(store, store.exportBatches[first.batch.exportBatchId]), first.jsonl);
});
