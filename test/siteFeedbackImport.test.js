import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFeedbackJournal } from '../src/feedback.js';
import { importSiteFeedback } from '../src/siteFeedbackImport.js';

const SNAPSHOT_ID = 'fs-abcdef0123456789abcdef01';

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'taste-engine-site',
    feedbackId: 'site-11111111-1111-4111-8111-111111111111',
    feedbackSnapshotId: SNAPSHOT_ID,
    canonicalEventId: 'seatgeek:123',
    eventDateLocal: '2026-07-01',
    eventTitleSnapshot: 'Prospa',
    status: 'attended-worth-it',
    rating: null,
    signalTags: [],
    notes: null,
    recordedAt: '2026-07-13T01:00:00.000Z',
    ...overrides
  };
}

async function setup({ withSnapshot = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'site-import-'));
  const journalPath = join(dir, 'feedback.jsonl');
  const snapshotIndexPath = join(dir, 'feedback-snapshots.json');
  if (withSnapshot) {
    await writeFile(snapshotIndexPath, JSON.stringify({
      version: 1,
      snapshots: {
        [SNAPSHOT_ID]: {
          canonicalEventId: 'seatgeek:123',
          eventDateLocal: '2026-07-01',
          eventTitleSnapshot: 'Prospa',
          evidenceSnapshot: { canonicalArtistIds: ['artist-1'], canonicalVenueId: 'venue-9', promoterOrSeriesIds: [], eventShape: 'concert' },
          createdAt: '2026-06-01T00:00:00.000Z',
          lastSeenAt: '2026-07-12T00:00:00.000Z'
        }
      }
    }));
  }
  return { dir, journalPath, snapshotIndexPath };
}

async function writeInbox(dir, envelopes) {
  const path = join(dir, 'feedback-inbox.jsonl');
  await writeFile(path, envelopes.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n') + '\n');
  return path;
}

test('imports site envelopes with rehydrated evidence and idempotent re-import', async () => {
  const { dir, journalPath, snapshotIndexPath } = await setup();
  const filePath = await writeInbox(dir, [envelope()]);
  const report = await importSiteFeedback({ filePath, journalPath, snapshotIndexPath });
  assert.deepEqual({ appended: report.appended, newCount: report.newCount, errors: report.errors }, { appended: true, newCount: 1, errors: [] });

  const journal = await readFeedbackJournal(journalPath);
  assert.equal(journal.records.length, 1);
  const record = journal.records[0];
  assert.equal(record.action, 'record');
  assert.equal(record.feedbackSnapshotId, SNAPSHOT_ID);
  assert.deepEqual(record.evidenceSnapshot.canonicalArtistIds, ['artist-1']);
  assert.equal(record.notes, null);

  const again = await importSiteFeedback({ filePath, journalPath, snapshotIndexPath });
  assert.deepEqual(
    { appended: again.appended, newCount: again.newCount, duplicateCount: again.duplicateCount, errors: again.errors },
    { appended: false, newCount: 0, duplicateCount: 1, errors: [] }
  );
  assert.equal((await readFeedbackJournal(journalPath)).records.length, 1);
});

test('conflicting duplicates abort the whole import and leave the journal unchanged', async () => {
  const { dir, journalPath, snapshotIndexPath } = await setup();
  await importSiteFeedback({ filePath: await writeInbox(dir, [envelope()]), journalPath, snapshotIndexPath });
  const before = await readFile(journalPath, 'utf8');

  const conflicting = envelope({ status: 'attended-not-worth-it' });
  const alsoNew = envelope({ feedbackId: 'site-22222222-2222-4222-8222-222222222222', recordedAt: '2026-07-13T02:00:00.000Z' });
  const report = await importSiteFeedback({ filePath: await writeInbox(dir, [conflicting, alsoNew]), journalPath, snapshotIndexPath });
  assert.equal(report.appended, false);
  assert.match(report.errors[0], /conflicting duplicate .* already in the journal/);
  assert.equal(await readFile(journalPath, 'utf8'), before);

  const inFileConflict = await importSiteFeedback({
    filePath: await writeInbox(dir, [alsoNew, { ...alsoNew, status: 'skipped-still-interested' }]),
    journalPath,
    snapshotIndexPath
  });
  assert.equal(inFileConflict.appended, false);
  assert.match(inFileConflict.errors[0], /within the file/);
});

test('rejects forbidden keys before any normalization', async () => {
  const { dir, journalPath, snapshotIndexPath } = await setup();
  const report = await importSiteFeedback({
    filePath: await writeInbox(dir, [{
      ...envelope(),
      evidenceSnapshot: { canonicalArtistIds: ['FABRICATED'], canonicalVenueId: null, promoterOrSeriesIds: [], eventShape: null }
    }]),
    journalPath,
    snapshotIndexPath
  });
  assert.equal(report.appended, false);
  assert.match(report.errors[0], /forbidden key: evidenceSnapshot/);
  assert.equal((await readFeedbackJournal(journalPath)).records.length, 0);
});

test('envelope identity must agree with the indexed snapshot', async () => {
  const { dir, journalPath, snapshotIndexPath } = await setup();
  const report = await importSiteFeedback({
    filePath: await writeInbox(dir, [envelope({ eventTitleSnapshot: 'Tampered Title' })]),
    journalPath,
    snapshotIndexPath
  });
  assert.equal(report.appended, false);
  assert.match(report.errors[0], /does not match snapshot/);
});

test('a rehydration miss imports with empty evidence and an explicit warning', async () => {
  const { dir, journalPath, snapshotIndexPath } = await setup({ withSnapshot: false });
  const report = await importSiteFeedback({ filePath: await writeInbox(dir, [envelope()]), journalPath, snapshotIndexPath });
  assert.equal(report.appended, true);
  assert.match(report.warnings.join(' '), /not found; imported with empty evidence/);
  const record = (await readFeedbackJournal(journalPath)).records[0];
  assert.deepEqual(record.evidenceSnapshot, { canonicalArtistIds: [], canonicalVenueId: null, promoterOrSeriesIds: [], eventShape: null });
});

test('one invalid record aborts everything with line-numbered errors', async () => {
  const { dir, journalPath, snapshotIndexPath } = await setup();
  const report = await importSiteFeedback({
    filePath: await writeInbox(dir, [
      envelope(),
      'not json at all',
      envelope({ feedbackId: 'site-33333333-3333-4333-8333-333333333333', status: 'invented-status' })
    ]),
    journalPath,
    snapshotIndexPath
  });
  assert.equal(report.appended, false);
  assert.match(report.errors[0], /line 2: malformed JSON/);
  assert.match(report.errors[1], /line 3: .*status is unsupported/);
  assert.equal((await readFeedbackJournal(journalPath)).records.length, 0);
});

test('defensive bounds reject binary and oversized input', async () => {
  const { dir, journalPath, snapshotIndexPath } = await setup();
  const binaryPath = join(dir, 'binary.jsonl');
  await writeFile(binaryPath, 'abc\u0000def\n');
  const binary = await importSiteFeedback({ filePath: binaryPath, journalPath, snapshotIndexPath });
  assert.match(binary.errors[0], /binary data/);

  const tooMany = await importSiteFeedback({
    filePath: await writeInbox(dir, Array.from({ length: 3 }, (_, index) => envelope({ feedbackId: `site-${index}` }))),
    journalPath,
    snapshotIndexPath,
    limits: { maxFileBytes: 1024 * 1024, maxRecords: 2, maxLineLength: 10_000 }
  });
  assert.match(tooMany.errors[0], /exceeds 2 records/);
});
