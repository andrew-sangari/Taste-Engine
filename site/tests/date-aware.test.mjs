import assert from "node:assert/strict";
import test from "node:test";
import {
  currentLocalDateKey,
  isCurrentOrFuture,
  isDateAwareRefreshNeeded,
  localDateKey,
  projectionDateKey,
} from "../app/date-aware.ts";

test("uses the Los Angeles calendar boundary", () => {
  assert.equal(localDateKey("2026-07-12T06:59:59.000Z"), "2026-07-11");
  assert.equal(localDateKey("2026-07-12T07:00:00.000Z"), "2026-07-12");
  assert.equal(currentLocalDateKey("2026-07-12T18:00:00.000Z"), "2026-07-12");
});

test("keeps unknown dates and removes past-dated records", () => {
  assert.equal(projectionDateKey("2026-07-11T20:00:00-07:00"), "2026-07-11");
  assert.equal(projectionDateKey(null), null);
  assert.equal(isCurrentOrFuture("2026-07-11T20:00:00-07:00", "2026-07-12"), false);
  assert.equal(isCurrentOrFuture("2026-07-12T20:00:00-07:00", "2026-07-12"), true);
  assert.equal(isCurrentOrFuture(null, "2026-07-12"), true);
});

test("flags a stale projection without requiring a rebuild", () => {
  assert.equal(isDateAwareRefreshNeeded("2026-07-11T18:00:00.000Z", "2026-07-12"), true);
  assert.equal(isDateAwareRefreshNeeded("2026-07-12T18:00:00.000Z", "2026-07-12"), false);
});
