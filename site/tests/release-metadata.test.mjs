import assert from "node:assert/strict";
import test from "node:test";
import { resolveReleaseMetadata } from "../build/release-metadata.mjs";

test("release metadata is byte-stable for fixed inputs and contains no wall-clock timestamp", () => {
  const env = {
    TASTE_ENGINE_RELEASE: "2026.08.30-rc.1",
    TASTE_ENGINE_COMMIT_SHA: "a".repeat(40),
    SOURCE_DATE_EPOCH: "1788076800",
  };
  const first = resolveReleaseMetadata({ env });
  const second = resolveReleaseMetadata({ env });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.release, "2026.08.30-rc.1");
  assert.equal(first.commitSha, "a".repeat(40));
  assert.equal(first.builtAt, "2026-08-30T08:00:00.000Z");
  assert.equal(first.databaseSchemaVersion, 3);
  assert.equal(first.projectionSchemaVersion, 5);
  assert.equal(first.sourceState, "declared");
  assert.equal(first.releasable, true);
});

test("invalid release overrides fall back deterministically to package version plus commit", () => {
  const metadata = resolveReleaseMetadata({
    env: { TASTE_ENGINE_RELEASE: "contains spaces", TASTE_ENGINE_COMMIT_SHA: "b".repeat(40) },
  });
  assert.equal(metadata.release, `0.1.0+${"b".repeat(12)}`);
  assert.equal(metadata.builtAt, null);
  assert.equal(metadata.sourceState, "declared");
  assert.equal(metadata.releasable, true);
});

test("implicit builds from a dirty checkout are visibly non-releasable", () => {
  const metadata = resolveReleaseMetadata({
    env: {},
    source: { commitSha: "c".repeat(40), dirty: true },
  });
  assert.equal(metadata.sourceState, "dirty");
  assert.equal(metadata.releasable, false);
  assert.match(metadata.release, /\.dirty$/);
  const labeled = resolveReleaseMetadata({
    env: { TASTE_ENGINE_RELEASE: "candidate" },
    source: { commitSha: "c".repeat(40), dirty: true },
  });
  assert.equal(labeled.release, "candidate.dirty");
});
