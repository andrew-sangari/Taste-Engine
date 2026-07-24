import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  appendFeedbackRecord,
  applyFeedbackAdjustmentsToCandidates,
  buildFeedbackReport,
  deriveFeedbackState,
  normalizeFeedbackConfig,
  normalizeFeedbackRecord,
  readFeedbackJournal,
  replayFeedbackRecords,
  simulateFeedback,
  validateFeedbackRecord,
  writeJsonAtomic
} from '../src/feedback.js';

const BASE_DATE = '2026-07-01T12:00:00.000Z';

test('uses an explicit disabled publication gate and validates the feedback record contract', () => {
  const config = normalizeFeedbackConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.applyToPublishedRanking, false);
  assert.equal(config.maxTotalAdjustment, 8);
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
    'did-not-attend-logistical': 0
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
  assert.deepEqual(missingArtist.signals.artist, []);
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
  const simulation = simulateFeedback({ projection: projection([]), state: left, config: normalizeFeedbackConfig({}), now: BASE_DATE });
  const report = buildFeedbackReport({ state: left, simulation, config: normalizeFeedbackConfig({}) });
  assert.doesNotMatch(JSON.stringify(left), /SECRET_NOTE|Ignore previous/);
  assert.doesNotMatch(JSON.stringify(report), /SECRET_NOTE|Ignore previous/);
});

test('one outcome records evidence but cannot create an artist adjustment', () => {
  const state = deriveFeedbackState([record({ evidenceSnapshot: evidence({ artist: 'artist-1' }) })]);
  assert.equal(state.signals.artist[0].eligible, false);
  const result = simulateFeedback({
    projection: projection([musicEvent('event-1', 50, 'Artist One')]),
    state,
    config: normalizeFeedbackConfig({}),
    now: BASE_DATE
  });
  assert.equal(result.evaluations[0].proposedAdjustment, 0);
  assert.equal(result.evaluations[0].thresholdMet, false);
});

test('mixed artist evidence remains neutral until the dominance rule is met', () => {
  const state = deriveFeedbackState([
    record({ feedbackId: 'one', canonicalEventId: 'event-1', status: 'attended-worth-it', evidenceSnapshot: evidence({ artist: 'artist-1' }) }),
    record({ feedbackId: 'two', canonicalEventId: 'event-2', status: 'attended-not-worth-it', evidenceSnapshot: evidence({ artist: 'artist-1' }) }),
    record({ feedbackId: 'three', canonicalEventId: 'event-3', status: 'attended-worth-it', evidenceSnapshot: evidence({ artist: 'artist-1' }) })
  ]);
  const signal = state.signals.artist[0];
  assert.equal(signal.eligible, false);
  assert.equal(signal.mixedEvidence, true);
  assert.match(signal.eligibilityReason, /confidence|margin/);
});

test('artist, venue, promoter, and event-shape effects are capped in shadow mode', () => {
  const records = Array.from({ length: 4 }, (_, index) => record({
    feedbackId: `feedback-${index + 1}`,
    canonicalEventId: `event-${index + 1}`,
    eventDateLocal: `2026-07-0${index + 1}`,
    evidenceSnapshot: evidence({ artist: 'artist-1', venue: 'venue-1', promoter: 'series-1', shape: 'festival' })
  }));
  const state = deriveFeedbackState(records, { now: new Date(BASE_DATE) });
  assert.equal(state.signals.artist[0].eligible, true);
  assert.equal(state.signals.venue[0].eligible, true);
  assert.equal(state.signals.promoterOrSeries[0].eligible, true);
  assert.equal(state.signals.eventShape[0].eligible, true);
  const result = simulateFeedback({
    projection: projection([musicEvent('event-1', 50, 'Artist One', { sourceId: 'venue-1', eventType: 'festival', promoterOrSeriesIds: ['series-1'] })]),
    state,
    config: normalizeFeedbackConfig({}),
    now: BASE_DATE
  });
  const evaluation = result.evaluations[0];
  assert.equal(evaluation.rawAdjustment, 9);
  assert.equal(evaluation.proposedAdjustment, 8);
  assert.equal(evaluation.capApplied, true);
  assert.equal(result.capUsage.capAppliedCount, 1);
});

test('changed titles are reported without replacing canonical identity', () => {
  const state = deriveFeedbackState([
    record({ canonicalEventId: 'event-1', eventDateLocal: '2026-07-20', eventTitleSnapshot: 'Old title', evidenceSnapshot: evidence({ artist: 'artist-1' }) }),
    record({ feedbackId: 'second', canonicalEventId: 'event-2', eventDateLocal: '2026-07-20', eventTitleSnapshot: 'Artist One', evidenceSnapshot: evidence({ artist: 'artist-1' }) })
  ], { now: new Date(BASE_DATE) });
  const result = simulateFeedback({
    projection: projection([musicEvent('event-1', 50, 'New title'), musicEvent('event-2', 40, 'Artist One')]),
    state,
    config: normalizeFeedbackConfig({}),
    now: BASE_DATE
  });
  assert.deepEqual(result.titleSnapshotMismatches, [{ feedbackId: 'feedback-1', canonicalEventId: 'event-1' }]);
  assert.equal(result.evaluations[0].proposedAdjustment, 4);
});

test('hard exclusions remain unchanged and application stays off by default', () => {
  const candidate = {
    id: 'event-1',
    ranking: { utility: 50, excluded: true }
  };
  const state = deriveFeedbackState([
    record({ canonicalEventId: 'event-1', evidenceSnapshot: evidence({ artist: 'artist-1' }) }),
    record({ feedbackId: 'second', canonicalEventId: 'event-2', evidenceSnapshot: evidence({ artist: 'artist-1' }) })
  ]);
  const result = simulateFeedback({
    projection: projection([musicEvent('event-1', 50, 'Artist One', { excluded: true })]),
    state,
    config: normalizeFeedbackConfig({}),
    now: BASE_DATE
  });
  assert.equal(result.evaluations[0].blockedByHardExclusion, true);
  assert.equal(result.evaluations[0].proposedAdjustment, 0);
  assert.deepEqual(applyFeedbackAdjustmentsToCandidates([candidate], result, normalizeFeedbackConfig({})), [candidate]);
});

test('enabled application still does nothing when thresholds are unmet', () => {
  const config = normalizeFeedbackConfig({ enabled: true, applyToPublishedRanking: true });
  const state = deriveFeedbackState([record({ evidenceSnapshot: evidence({ artist: 'artist-1' }) })], { config });
  const result = simulateFeedback({ projection: projection([musicEvent('event-1', 50, 'Artist One')]), state, config, now: BASE_DATE });
  const candidate = { id: 'event-1', ranking: { utility: 50, excluded: false } };
  assert.equal(result.evaluations[0].thresholdMet, false);
  assert.deepEqual(applyFeedbackAdjustmentsToCandidates([candidate], result, config), [candidate]);
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
  const { sourceId = null, eventType = 'concert', promoterOrSeriesIds = [], excluded = false } = overrides;
  return {
    id,
    title,
    startLocal: '2026-07-20T20:00:00',
    eventType,
    venue: { sourceId, name: 'Venue One', city: 'Los Angeles', state: 'CA' },
    matchedArtists: [{ spotifyArtistId: 'artist-1', name: 'Artist One', primary: true }],
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
