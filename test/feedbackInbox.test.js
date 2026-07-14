import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadInboxSettings, processFeedbackInbox } from '../src/feedbackInbox.js';

const NOW = '2026-07-13T18:00:00.000Z';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'taste-inbox-'));
  const inbox = join(root, 'inbox');
  await mkdir(join(root, 'config'), { recursive: true });
  await mkdir(join(root, 'data/taste'), { recursive: true });
  await mkdir(inbox, { recursive: true });
  await writeFile(join(root, 'config/feedback.json'), JSON.stringify({
    autoImport: { enabled: false },
    feedback: { enabled: true, applyToPublishedRanking: false }
  }));
  await writeFile(join(root, 'data/taste/feedback-snapshots.json'), JSON.stringify({
    version: 1,
    snapshots: {
      'fs-1': {
        canonicalEventId: 'event:1', eventDateLocal: '2026-07-01', eventTitleSnapshot: 'Event one',
        evidenceSnapshot: { canonicalArtistIds: ['artist:1'], canonicalVenueId: null, promoterOrSeriesIds: [], eventShape: null }
      }
    }
  }));
  return { root, inbox };
}

function envelope(status = 'attended-worth-it') {
  return {
    schemaVersion: 1, source: 'taste-engine-site', feedbackId: 'site-1', feedbackSnapshotId: 'fs-1',
    canonicalEventId: 'event:1', eventDateLocal: '2026-07-01', eventTitleSnapshot: 'Event one', status,
    rating: null, signalTags: [], notes: null, recordedAt: NOW
  };
}

test('imports once, rebuilds derived state, archives, and content-deduplicates later copies', async () => {
  const { root, inbox } = await fixture();
  const content = `${JSON.stringify(envelope())}\n`;
  await writeFile(join(inbox, 'feedback-inbox-2026-07-13.jsonl'), content);
  const first = await processFeedbackInbox({ root, args: ['--import-feedback'], env: { TASTE_FEEDBACK_INBOX: inbox }, now: new Date(NOW) });
  assert.equal(first.newCount, 1);
  assert.equal(first.archivedCount, 1);
  assert.equal((await readFile(join(root, 'data/taste/feedback.jsonl'), 'utf8')).trim().split('\n').length, 1);
  assert.equal(JSON.parse(await readFile(join(root, 'data/taste/feedback-state.json'), 'utf8')).activeFeedbackCount, 1);

  await writeFile(join(inbox, 'feedback-inbox-copy.jsonl'), content);
  const second = await processFeedbackInbox({ root, args: ['--import-feedback'], env: { TASTE_FEEDBACK_INBOX: inbox }, now: new Date(NOW) });
  assert.equal(second.newCount, 0);
  assert.equal(second.archivedCount, 1);
  assert.equal((await readFile(join(root, 'data/taste/feedback.jsonl'), 'utf8')).trim().split('\n').length, 1);
});

test('leaves malformed and conflicting files untouched with stable warnings', async () => {
  const { root, inbox } = await fixture();
  await writeFile(join(inbox, 'feedback-inbox-valid.jsonl'), `${JSON.stringify(envelope())}\n`);
  await processFeedbackInbox({ root, args: ['--import-feedback'], env: { TASTE_FEEDBACK_INBOX: inbox }, now: new Date(NOW) });
  const conflict = join(inbox, 'feedback-inbox-conflict.jsonl');
  const malformed = join(inbox, 'feedback-inbox-malformed.jsonl');
  await writeFile(conflict, `${JSON.stringify(envelope('attended-not-worth-it'))}\n`);
  await writeFile(malformed, '{nope\n');
  const report = await processFeedbackInbox({ root, args: ['--import-feedback'], env: { TASTE_FEEDBACK_INBOX: inbox }, now: new Date(NOW) });
  assert.deepEqual(report.warningCodes, ['feedback-inbox-invalid']);
  assert.ok(await stat(conflict));
  assert.ok(await stat(malformed));
});

test('flag precedence suppresses configured import and environment overrides the inbox path', async () => {
  const { root, inbox } = await fixture();
  await writeFile(join(root, 'config/feedback.local.json'), JSON.stringify({ autoImport: { enabled: true } }));
  const settings = await loadInboxSettings(root, { TASTE_FEEDBACK_INBOX: inbox });
  assert.equal(settings.enabled, true);
  assert.equal(settings.inboxPath, inbox);
  const report = await processFeedbackInbox({ root, args: ['--no-import-feedback'], env: { TASTE_FEEDBACK_INBOX: inbox } });
  assert.equal(report.enabled, false);
});
