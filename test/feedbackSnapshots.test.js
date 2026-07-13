import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildFeedbackSnapshot,
  mergeSnapshotIndex,
  readSnapshotIndex,
  resolveSnapshot,
  serializePublicFeedbackSnapshot
} from '../src/feedbackSnapshots.js';

function musicEvent(overrides = {}) {
  return {
    id: 'seatgeek:123',
    title: 'Prospa',
    startLocal: '2026-08-01T20:00:00',
    venue: { name: 'Shrine Expo Hall', city: 'Los Angeles', sourceId: 'venue-9' },
    matchedArtists: [{ spotifyArtistId: 'SPOTIFY-SECRET', name: 'Prospa', primary: true }],
    eventType: 'concert',
    ...overrides
  };
}

test('public snapshot carries event identity only; evidence stays private', () => {
  const snapshot = buildFeedbackSnapshot(musicEvent(), 'music');
  assert.match(snapshot.feedbackSnapshotId, /^fs-[0-9a-f]{24}$/);
  assert.deepEqual(Object.keys(snapshot.public).sort(), ['canonicalEventId', 'eventDateLocal', 'eventTitleSnapshot', 'feedbackSnapshotId', 'vertical']);
  assert.doesNotMatch(JSON.stringify(snapshot.public), /SPOTIFY-SECRET|venue-9/);
  assert.deepEqual(snapshot.private.evidenceSnapshot.canonicalArtistIds, ['SPOTIFY-SECRET']);
  assert.equal(snapshot.private.evidenceSnapshot.canonicalVenueId, 'venue-9');
});

test('snapshot id is deterministic and changes when evidence changes', () => {
  const first = buildFeedbackSnapshot(musicEvent(), 'music');
  const second = buildFeedbackSnapshot(musicEvent(), 'music');
  assert.equal(first.feedbackSnapshotId, second.feedbackSnapshotId);
  const rescheduled = buildFeedbackSnapshot(musicEvent({ startLocal: '2026-08-02T20:00:00' }), 'music');
  assert.notEqual(first.feedbackSnapshotId, rescheduled.feedbackSnapshotId);
});

test('missing identity or unsupported vertical yields no snapshot', () => {
  assert.equal(buildFeedbackSnapshot(musicEvent({ startLocal: null }), 'music'), null);
  assert.equal(serializePublicFeedbackSnapshot({ feedbackSnapshotId: 'fs-1', canonicalEventId: 'x', eventDateLocal: '2026-08-01', eventTitleSnapshot: 't', vertical: 'movies' }), null);
});

test('index merge keeps old snapshots on reschedule, prunes stale, retains referenced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snapshots-'));
  const path = join(dir, 'feedback-snapshots.json');
  const journalPath = join(dir, 'feedback.jsonl');
  const now = new Date('2026-07-12T00:00:00Z');

  const original = buildFeedbackSnapshot(musicEvent(), 'music');
  await mergeSnapshotIndex([original], { path, journalPath, now });
  const rescheduled = buildFeedbackSnapshot(musicEvent({ startLocal: '2026-08-02T20:00:00' }), 'music');
  await mergeSnapshotIndex([rescheduled], { path, journalPath, now });
  let index = await readSnapshotIndex(path);
  assert.equal(Object.keys(index.snapshots).length, 2);

  // Stale unreferenced snapshot beyond retention gets pruned...
  const stale = buildFeedbackSnapshot(musicEvent({ id: 'seatgeek:old', startLocal: '2020-01-01T20:00:00' }), 'music');
  await mergeSnapshotIndex([stale], { path, journalPath, now });
  index = await readSnapshotIndex(path);
  assert.equal(index.snapshots[stale.feedbackSnapshotId], undefined);

  // ...unless a journal record references it.
  const referenced = buildFeedbackSnapshot(musicEvent({ id: 'seatgeek:kept', startLocal: '2020-02-02T20:00:00' }), 'music');
  const journalRecord = {
    feedbackId: 'site-x', action: 'record', canonicalEventId: 'seatgeek:kept', eventDateLocal: '2020-02-02',
    eventTitleSnapshot: 'Prospa', status: 'attended-worth-it', signalTags: [], notes: null,
    feedbackSnapshotId: referenced.feedbackSnapshotId,
    evidenceSnapshot: { canonicalArtistIds: [], canonicalVenueId: null, promoterOrSeriesIds: [], eventShape: null },
    recordedAt: '2026-07-01T00:00:00.000Z'
  };
  await writeFile(journalPath, `${JSON.stringify(journalRecord)}\n`);
  await mergeSnapshotIndex([referenced], { path, journalPath, now });
  index = await readSnapshotIndex(path);
  assert.ok(index.snapshots[referenced.feedbackSnapshotId]);
  assert.equal(await resolveSnapshot('missing-id', path), null);
  assert.equal((await resolveSnapshot(referenced.feedbackSnapshotId, path)).canonicalEventId, 'seatgeek:kept');
});

test('a corrupted index refuses to be overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snapshots-bad-'));
  const path = join(dir, 'feedback-snapshots.json');
  await writeFile(path, 'not json');
  await assert.rejects(() => mergeSnapshotIndex([], { path, journalPath: join(dir, 'feedback.jsonl') }), /refusing to overwrite/);
  assert.equal(await readFile(path, 'utf8'), 'not json');
});
