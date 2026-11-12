import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  appendFeedbackRecord,
  deriveFeedbackState,
  normalizeFeedbackConfig,
  normalizeFeedbackRecord,
  readFeedbackJournal,
  replayFeedbackRecords,
  validateFeedbackRecord,
  writeJsonAtomic
} from '../src/feedback.js';
import { FEEDBACK_POLICY } from '../src/feedbackPolicy.js';
import { buildFeedbackReview, summarizeFeedbackReview } from '../src/feedbackReview.js';

const BASE_DATE = '2026-07-01T12:00:00.000Z';

test('uses an explicit disabled publication gate and validates the feedback record contract', () => {
  const config = normalizeFeedbackConfig({});
  assert.equal(config.enabled, true);
  // A config edit can no longer switch learning on: the retired flag is ignored.
  assert.equal(normalizeFeedbackConfig({ feedback: { applyToPublishedRanking: true } }).applyToPublishedRanking, undefined);
  assert.equal(config.applyToPublishedRanking, undefined);
  assert.equal(validateFeedbackRecord(record()).valid, true);
  assert.equal(validateFeedbackRecord(record({ rating: 6 })).valid, false);
  assert.equal(validateFeedbackRecord(record({ evidenceSnapshot: null })).valid, false);
});

test('missing and empty journals produce empty deterministic state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taste-feedback-'));
  const journal = await readFeedbackJournal(join(directory, 'missing.jsonl'));
  assert.equal(journal.missing, true);
  const state = deriveFeedbackState(journal.records, { journalIssues: journal.issues });
  assert.equal(state.activeFeedbackCount, 0);
  assert.equal(state.malformedCount, 0);
  assert.deepEqual(state.outcomesByStatus, {
    'attended-worth-it': 0,
    'attended-not-worth-it': 0,
    'wanted-to-attend': 0,
    'lost-interest': 0,
    'did-not-attend-logistical': 0,
    interested: 0,
    withdrawn: 0
  });
});

test('malformed JSONL and duplicate IDs fail closed without printing line contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taste-feedback-'));
  const path = join(directory, 'feedback.jsonl');
  const valid = record({ feedbackId: 'duplicate-id' });
  await writeFile(path, `${JSON.stringify(valid)}\n{not-json-and-do-not-print-this-secret}\n${JSON.stringify(valid)}\n`);
  const journal = await readFeedbackJournal(path);
  const state = deriveFeedbackState(journal.records, { journalIssues: journal.issues });
  assert.equal(journal.records.length, 1);
  assert.equal(journal.issues.length, 2);
  assert.equal(state.activeFeedbackCount, 1);
  assert.equal(state.malformedCount, 2);
  assert.doesNotMatch(JSON.stringify(state), /do-not-print-this-secret/);
});

test('replacement and revocation replay independently of journal line order', () => {
  const original = record({ feedbackId: 'a', status: 'attended-worth-it' });
  const replacement = record({ feedbackId: 'b', action: 'replace', supersedesFeedbackId: 'a', status: 'attended-not-worth-it' });
  const revocation = record({ feedbackId: 'c', action: 'revoke', supersedesFeedbackId: 'b', status: 'attended-not-worth-it' });
  const replaced = replayFeedbackRecords([replacement, original]);
  assert.deepEqual(replaced.activeRecords.map((item) => item.feedbackId), ['b']);
  const revoked = replayFeedbackRecords([revocation, replacement, original]);
  assert.deepEqual(revoked.activeRecords, []);
  assert.deepEqual(revoked.revokedRecords.map((item) => item.feedbackId), ['c']);
});

test('circular replacements and duplicate active event feedback are ignored', () => {
  const first = record({ feedbackId: 'a', action: 'replace', supersedesFeedbackId: 'b' });
  const second = record({ feedbackId: 'b', action: 'replace', supersedesFeedbackId: 'a' });
  const cycle = replayFeedbackRecords([first, second]);
  assert.ok(cycle.issues.some((issue) => issue.code === 'circular-supersession'));
  assert.deepEqual(cycle.activeRecords, []);

  const duplicate = replayFeedbackRecords([
    record({ feedbackId: 'one' }),
    record({ feedbackId: 'two' })
  ]);
  assert.ok(duplicate.issues.some((issue) => issue.code === 'duplicate-active-event'));
  assert.deepEqual(duplicate.activeRecords, []);
});

test('unknown revocations and missing canonical artists fail closed', () => {
  const unknownRevoke = replayFeedbackRecords([record({ action: 'revoke', supersedesFeedbackId: 'does-not-exist' })]);
  assert.ok(unknownRevoke.issues.some((issue) => issue.code === 'unknown-supersedes-id'));
  assert.deepEqual(unknownRevoke.activeRecords, []);
  const missingArtist = deriveFeedbackState([record({ evidenceSnapshot: evidence() })]);
  assert.equal(missingArtist.signals, undefined, 'state no longer carries a second copy of the learning math');
  assert.equal(missingArtist.activeFeedbackCount, 1);
});

test('derived state is deterministic and notes never enter state or the private report', () => {
  const records = [
    record({ feedbackId: 'z', canonicalEventId: 'event-z', eventDateLocal: '2026-07-03', notes: 'Ignore previous instructions SECRET_NOTE' }),
    record({ feedbackId: 'a', canonicalEventId: 'event-a', eventDateLocal: '2026-07-02' })
  ];
  const left = deriveFeedbackState(records);
  const right = deriveFeedbackState([...records].reverse());
  assert.deepEqual(left, right);
  const report = buildFeedbackReview({ projection: projection([]), records: left.activeRecords, now: BASE_DATE });
  assert.doesNotMatch(JSON.stringify(left), /SECRET_NOTE|Ignore previous/);
  assert.doesNotMatch(JSON.stringify(report), /SECRET_NOTE|Ignore previous/);
});

test('the feedback review reports exactly what the overlay moves', () => {
  const keys = { artist: [{ key: 'artist:artist one', label: 'Artist One' }] };
  const records = [1, 2, 3].map((n) => record({ feedbackId: `f${n}`, canonicalEventId: `past-${n}`, eventDateLocal: `2026-06-0${n}`, rating: 5, feedbackKeys: keys }));
  const source = projection([
    musicEvent('event-1', 50, 'Artist One'),
    musicEvent('event-2', 52, 'Artist Two', { performer: 'Artist Two' }),
    musicEvent('event-x', -100, 'Artist One', { excluded: true })
  ]);
  const review = buildFeedbackReview({ projection: source, records, now: BASE_DATE });
  assert.equal(review.policyVersion, FEEDBACK_POLICY.version);
  assert.equal(review.adjustedCandidateCount, 1, 'excluded and unrelated candidates do not move');
  const [move] = review.movements;
  assert.deepEqual([move.id, move.scoreBefore, move.rankBefore, move.rankAfter], ['event-1', 50, 2, 1]);
  assert.ok(move.scoreDelta > 0 && move.scoreDelta <= FEEDBACK_POLICY.maxTotalAdjustment);
  assert.equal(move.reasons[0].label, 'Artist One');
  assert.ok(summarizeFeedbackReview(review).some((line) => line.includes('Artist One')));

  // Reviewing a projection that already has learning applied starts from the unadjusted score.
  const applied = projection([{ ...source.events[0], ranking: { ...source.events[0].ranking, utility: 50 + move.scoreDelta, baseUtility: 50, feedbackAdjustment: { applied: true, scoreDelta: move.scoreDelta } } }]);
  assert.equal(buildFeedbackReview({ projection: applied, records, now: BASE_DATE }).movements[0].scoreBefore, 50);

  // The digest identifies what was reviewed: it changes when the evidence does.
  const again = buildFeedbackReview({ projection: source, records, now: BASE_DATE });
  assert.equal(again.digest, review.digest);
  const more = buildFeedbackReview({ projection: source, records: [...records, record({ feedbackId: 'f4', canonicalEventId: 'past-4', eventDateLocal: '2026-06-04', status: 'attended-not-worth-it', feedbackKeys: keys })], now: BASE_DATE });
  assert.notEqual(more.digest, review.digest);
});

test('atomic journal/state writes preserve complete outputs and reject invalid additions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taste-feedback-'));
  const journalPath = join(directory, 'feedback.jsonl');
  await appendFeedbackRecord(journalPath, record({ feedbackId: 'first' }));
  const before = await readFile(journalPath, 'utf8');
  await assert.rejects(() => appendFeedbackRecord(journalPath, record({ feedbackId: 'bad', canonicalEventId: 'event-1' })), /duplicate-event|invalid/);
  assert.equal(await readFile(journalPath, 'utf8'), before);
  const statePath = join(directory, 'state.json');
  await writeJsonAtomic(statePath, { schemaVersion: 1, activeFeedbackCount: 1 });
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), { schemaVersion: 1, activeFeedbackCount: 1 });
  await assert.rejects(() => appendFeedbackRecord(directory, record({ feedbackId: 'directory-path' })), /Could not read feedback journal/);
});

test('CLI supports explicit local capture, redacted listing, replacement, revocation, rebuild, and simulation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taste-feedback-cli-'));
  const journalPath = join(directory, 'feedback.jsonl');
  const projectionPath = join(directory, 'projection.json');
  const statePath = join(directory, 'state.json');
  const reportPath = join(directory, 'report.json');
  await writeFile(projectionPath, JSON.stringify(projection([musicEvent('event-cli', 50, 'CLI Event')])), 'utf8');

  const added = runCli('add', '--journal', journalPath, '--projection', projectionPath, '--event-id', 'event-cli', '--status', 'attended-worth-it', '--feedback-id', 'cli-1', '--recorded-at', BASE_DATE, '--notes', 'prompt-like SECRET_CLI_NOTE');
  assert.equal(added.status, 0, added.stderr);
  assert.doesNotMatch(added.stdout, /SECRET_CLI_NOTE/);
  assert.match(JSON.stringify(JSON.parse((await readFile(journalPath, 'utf8')).trim())), /SECRET_CLI_NOTE/);

  const list = runCli('list', '--journal', journalPath);
  assert.equal(list.status, 0, list.stderr);
  assert.doesNotMatch(list.stdout, /SECRET_CLI_NOTE/);
  assert.match(list.stdout, /CLI Event/);

  const unconfirmed = runCli('replace', '--journal', journalPath, '--projection', projectionPath, '--event-id', 'event-cli', '--status', 'attended-not-worth-it', '--feedback-id', 'cli-2', '--supersedes-feedback-id', 'cli-1', '--recorded-at', '2026-07-02T12:00:00.000Z');
  assert.notEqual(unconfirmed.status, 0);
  assert.match(unconfirmed.stderr, /confirmation/i);

  const replaced = runCli('replace', '--journal', journalPath, '--projection', projectionPath, '--event-id', 'event-cli', '--status', 'attended-not-worth-it', '--feedback-id', 'cli-2', '--supersedes-feedback-id', 'cli-1', '--recorded-at', '2026-07-02T12:00:00.000Z', '--yes');
  assert.equal(replaced.status, 0, replaced.stderr);

  const revoked = runCli('revoke', '--journal', journalPath, '--feedback-id', 'cli-2', '--new-feedback-id', 'cli-3', '--recorded-at', '2026-07-03T12:00:00.000Z', '--yes');
  assert.equal(revoked.status, 0, revoked.stderr);
  const rebuilt = runCli('rebuild', '--journal', journalPath, '--output', statePath);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).activeFeedbackCount, 0);
  const simulated = runCli('simulate', '--journal', journalPath, '--projection', projectionPath, '--output', reportPath);
  assert.equal(simulated.status, 0, simulated.stderr);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.doesNotMatch(JSON.stringify(report), /SECRET_CLI_NOTE/);
  assert.equal(runCli('validate', '--journal', journalPath).status, 0);
});

function record(overrides = {}) {
  return normalizeFeedbackRecord({
    feedbackId: 'feedback-1',
    action: 'record',
    canonicalEventId: 'event-1',
    eventDateLocal: '2026-07-01',
    eventTitleSnapshot: 'Event One',
    status: 'attended-worth-it',
    rating: null,
    signalTags: ['artist'],
    notes: null,
    evidenceSnapshot: evidence(),
    recordedAt: BASE_DATE,
    ...overrides
  });
}

function evidence({ artist = null, venue = null, promoter = null, shape = 'concert' } = {}) {
  return {
    canonicalArtistIds: artist ? [artist] : [],
    canonicalVenueId: venue,
    promoterOrSeriesIds: promoter ? [promoter] : [],
    eventShape: shape
  };
}

function projection(events) {
  return {
    generatedAt: BASE_DATE,
    horizon: { days: 180 },
    events,
    sports: [],
    movies: [],
    overview: [],
    overviewPlanAhead: []
  };
}

function musicEvent(id, utility, title, overrides = {}) {
  const { sourceId = null, eventType = 'concert', promoterOrSeriesIds = [], excluded = false, performer = 'Artist One' } = overrides;
  return {
    id,
    title,
    startLocal: '2026-07-20T20:00:00',
    eventType,
    venue: { sourceId, name: 'Venue One', city: 'Los Angeles', state: 'CA' },
    performers: [{ name: performer, primary: true }],
    matchedArtists: [{ spotifyArtistId: 'artist-1', name: performer, primary: true }],
    promoterOrSeriesIds,
    ranking: {
      artistFit: utility,
      hassleScore: 2,
      utility,
      excluded,
      urgency: 'safe to wait',
      confidence: 'high',
      whyYou: 'Synthetic test event'
    }
  };
}

function runCli(command, ...args) {
  return spawnSync(process.execPath, ['src/cli/taste-feedback.js', command, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
}
