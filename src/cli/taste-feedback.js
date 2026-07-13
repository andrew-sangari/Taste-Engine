import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadBriefConfig } from '../briefConfig.js';
import {
  FEEDBACK_SIGNAL_TAGS,
  FEEDBACK_STATUSES,
  appendFeedbackRecord,
  buildFeedbackReport,
  deriveFeedbackState,
  loadFeedbackConfig,
  readFeedbackJournal,
  replayFeedbackRecords,
  simulateFeedback,
  snapshotFeedbackEvent,
  writeJsonAtomic
} from '../feedback.js';

const [command = 'help', ...args] = process.argv.slice(2);

try {
  const options = parseArgs(args);
  await runCommand(command, options);
} catch (error) {
  console.error(`Feedback command failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
}

async function runCommand(name, options) {
  switch (name) {
    case 'add':
      await addFeedback(options, { replace: Boolean(options.replace || options.action === 'replace') });
      return;
    case 'replace':
      await addFeedback(options, { replace: true });
      return;
    case 'list':
      await listFeedback(options);
      return;
    case 'revoke':
      await revokeFeedback(options);
      return;
    case 'validate':
      await validateFeedback(options);
      return;
    case 'rebuild':
      await rebuildFeedback(options);
      return;
    case 'simulate':
      await simulateFeedbackReport(options);
      return;
    case 'import':
      await importFromSite(options);
      return;
    case 'help':
      printHelp();
      return;
    default:
      throw new Error(`Unknown feedback command: ${name}. Use taste:feedback:add, list, revoke, validate, rebuild, simulate, or import.`);
  }
}

async function addFeedback(options, { replace = false } = {}) {
  const config = await loadConfig(options);
  const journalPath = resolve(options.journal ?? config.journalPath);
  const journal = await readFeedbackJournal(journalPath);
  assertCleanJournal(journal);
  const replay = replayFeedbackRecords(journal.records);
  if (replay.issues.length) throw new Error('Feedback journal has an invalid replacement or duplicate-event state; run taste:feedback:validate.');

  const activeForEvent = options.eventId
    ? replay.activeRecords.filter((record) => record.canonicalEventId === options.eventId)
    : [];
  if (!replace && activeForEvent.length) throw new Error('This event already has active feedback; use taste:feedback:replace with --supersedes-feedback-id.');
  if (replace && activeForEvent.length > 1) throw new Error('This event has multiple active feedback records and cannot be corrected automatically.');

  const target = replace
    ? replay.activeRecords.find((record) => record.feedbackId === options.supersedesFeedbackId)
      ?? (activeForEvent.length === 1 ? activeForEvent[0] : null)
    : null;
  if (replace && !target) throw new Error('Replacement requires an active record; pass --supersedes-feedback-id or use the event ID with one active record.');
  if (!options.status || !FEEDBACK_STATUSES.includes(options.status)) throw new Error('Add and replace require a supported --status.');

  const projection = await readProjectionIfPresent(options.projection ?? 'site/app/data/upcoming.json');
  const projectedEvent = options.eventId ? findProjectionEvent(projection, options.eventId) : null;
  const snapshot = projectedEvent
    ? snapshotFeedbackEvent(projectedEvent)
    : target
      ? snapshotFromRecord(target)
      : snapshotFromExplicitOptions(options);
  if (projectedEvent && hasExplicitSnapshotOverride(options)) throw new Error('The event is present in the projection; use --projection to record a different canonical snapshot.');
  if (!snapshot.canonicalEventId || !snapshot.eventDateLocal || !snapshot.eventTitleSnapshot) throw new Error('A historical event must include --event-id, --event-date-local, and --event-title.');
  if (options.eventId && snapshot.canonicalEventId !== options.eventId) throw new Error('The projection event ID does not match --event-id.');
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  const feedbackId = options.feedbackId ?? nextFeedbackId(journal.records, snapshot.canonicalEventId, recordedAt);
  const record = {
    feedbackId,
    action: replace ? 'replace' : 'record',
    ...(replace ? { supersedesFeedbackId: target.feedbackId } : {}),
    canonicalEventId: snapshot.canonicalEventId,
    eventDateLocal: snapshot.eventDateLocal,
    eventTitleSnapshot: snapshot.eventTitleSnapshot,
    status: options.status,
    rating: options.rating == null ? null : Number(options.rating),
    signalTags: parseList(options.signalTags),
    notes: options.notes ?? null,
    evidenceSnapshot: snapshot.evidenceSnapshot,
    recordedAt
  };
  printEventSummary(snapshot, replace ? `Replacing ${target.feedbackId}` : 'Recording feedback');
  if (replace) await requireConfirmation('Confirm replacement', options.yes);
  const saved = await appendFeedbackRecord(journalPath, record);
  console.log(`${replace ? 'Replaced' : 'Recorded'} ${saved.feedbackId} for ${saved.canonicalEventId}: ${saved.status}.`);
}

async function revokeFeedback(options) {
  const config = await loadConfig(options);
  const journalPath = resolve(options.journal ?? config.journalPath);
  const journal = await readFeedbackJournal(journalPath);
  assertCleanJournal(journal);
  const replay = replayFeedbackRecords(journal.records);
  if (replay.issues.length) throw new Error('Feedback journal has an invalid replacement or duplicate-event state; run taste:feedback:validate.');
  const target = replay.activeRecords.find((record) => record.feedbackId === options.feedbackId);
  if (!target) throw new Error('Only an active feedbackId can be revoked.');
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  const feedbackId = options.newFeedbackId ?? options.replacementFeedbackId ?? nextFeedbackId(journal.records, target.canonicalEventId, recordedAt, 'revoke');
  const record = {
    feedbackId,
    action: 'revoke',
    supersedesFeedbackId: target.feedbackId,
    canonicalEventId: target.canonicalEventId,
    eventDateLocal: target.eventDateLocal,
    eventTitleSnapshot: target.eventTitleSnapshot,
    status: target.status,
    rating: target.rating,
    signalTags: target.signalTags,
    notes: null,
    evidenceSnapshot: target.evidenceSnapshot,
    recordedAt
  };
  printEventSummary(record, `Revoking ${target.feedbackId}`);
  await requireConfirmation('Confirm revocation', options.yes);
  const saved = await appendFeedbackRecord(journalPath, record);
  console.log(`Revoked ${target.feedbackId} with audit record ${saved.feedbackId}.`);
}

async function listFeedback(options) {
  const config = await loadConfig(options);
  const journalPath = resolve(options.journal ?? config.journalPath);
  const journal = await readFeedbackJournal(journalPath);
  const replay = replayFeedbackRecords(journal.records);
  if (journal.issues.length || replay.issues.length) {
    console.log(`Ignored ${journal.issues.length + replay.issues.length} invalid journal condition(s); run taste:feedback:validate.`);
  }
  const records = options.includeRevoked ? replay.validRecords : replay.activeRecords;
  if (!records.length) {
    console.log('No active feedback records.');
    return;
  }
  for (const record of records) {
    const state = record.action === 'revoke' ? 'revocation' : record.action === 'replace' ? 'replacement' : 'active';
    console.log(`${record.feedbackId} | ${state} | ${record.status} | ${record.canonicalEventId} | ${record.eventDateLocal} | ${record.eventTitleSnapshot}`);
  }
}

async function validateFeedback(options) {
  const config = await loadConfig(options);
  const journalPath = resolve(options.journal ?? config.journalPath);
  const journal = await readFeedbackJournal(journalPath);
  const replay = replayFeedbackRecords(journal.records);
  const issues = [...journal.issues, ...replay.issues.map((issue) => ({ line: null, ...issue }))];
  console.log(`Feedback journal: ${journal.missing ? 'missing (valid empty input)' : 'read'}; ${journal.records.length} valid record(s); ${issues.length} issue(s).`);
  for (const issue of issues) {
    const location = issue.line == null ? 'replay' : `line ${issue.line}`;
    console.log(`- ${location}: ${issue.code} — ${issue.reason}`);
  }
  if (issues.length) {
    console.log('Recovery: preserve the journal as an audit copy, inspect the reported line/relationship, then use a valid replace or revoke record; rerun validation before rebuilding.');
    process.exitCode = 1;
  }
}

async function rebuildFeedback(options) {
  const config = await loadConfig(options);
  const journalPath = resolve(options.journal ?? config.journalPath);
  const statePath = resolve(options.output ?? config.statePath);
  const journal = await readFeedbackJournal(journalPath);
  const replay = replayFeedbackRecords(journal.records);
  const state = deriveFeedbackState(journal.records, { journalIssues: journal.issues, config });
  await writeJsonAtomic(statePath, state);
  console.log(`Rebuilt feedback state: ${state.activeFeedbackCount} active record(s), ${state.revokedCount} revocation(s), ${state.malformedCount} malformed/ignored condition(s).`);
  if (journal.issues.length || replay.issues.length) console.log('Invalid records were excluded from evidence; run taste:feedback:validate for recovery details.');
}

async function simulateFeedbackReport(options) {
  const config = await loadConfig(options);
  const journalPath = resolve(options.journal ?? config.journalPath);
  const reportPath = resolve(options.output ?? config.reportPath);
  const projectionPath = resolve(options.projection ?? 'site/app/data/upcoming.json');
  const journal = await readFeedbackJournal(journalPath);
  const projection = await readProjection(projectionPath);
  const state = deriveFeedbackState(journal.records, { journalIssues: journal.issues, config });
  const planAheadMinScore = options.planAheadMinScore == null
    ? await readPlanAheadMinScore(options.briefConfig ?? 'config/brief.json')
    : Number(options.planAheadMinScore);
  const simulation = simulateFeedback({
    projection,
    state,
    config,
    planAheadMinScore,
    now: projection.generatedAt
  });
  const report = buildFeedbackReport({ state, simulation, config });
  await writeJsonAtomic(reportPath, report);
  console.log(`Simulated ${report.shadowCandidateCount} candidate(s): ${report.shadowRankingDiffs.length} ranking diff(s), ${report.potentialOverviewChanges.length} Overview change(s), ${report.eligibleSignals.length} eligible signal(s).`);
}

async function importFromSite(options) {
  if (!options.file) throw new Error('Import requires --file pointing at a site feedback JSONL export.');
  const config = await loadConfig(options);
  const journalPath = resolve(options.journal ?? config.journalPath);
  const { importSiteFeedback } = await import('../siteFeedbackImport.js');
  const report = await importSiteFeedback({
    filePath: resolve(options.file),
    journalPath,
    ...(options.snapshotIndex ? { snapshotIndexPath: resolve(options.snapshotIndex) } : {})
  });
  console.log(`${report.inputCount} input / ${report.newCount} new / ${report.duplicateCount} identical duplicate(s) skipped.`);
  for (const warning of report.warnings) console.log(`- warning: ${warning}`);
  for (const error of report.errors) console.log(`- error: ${error}`);
  if (!report.appended && report.errors.length) {
    console.log('Import aborted; journal unchanged.');
    process.exitCode = 1;
  } else if (report.appended) {
    console.log(`Appended ${report.newCount} record(s) to ${journalPath}. Run taste:feedback:rebuild to refresh derived state.`);
  } else {
    console.log('Nothing to append; journal unchanged.');
  }
}

function parseArgs(args) {
  const options = {};
  const booleanFlags = new Set(['yes', 'include-revoked', 'replace']);
  const aliases = new Map([
    ['feedback-id', 'feedbackId'],
    ['new-feedback-id', 'newFeedbackId'],
    ['replacement-feedback-id', 'replacementFeedbackId'],
    ['supersedes-feedback-id', 'supersedesFeedbackId'],
    ['event-id', 'eventId'],
    ['event-date-local', 'eventDateLocal'],
    ['event-title', 'eventTitle'],
    ['canonical-artist-ids', 'canonicalArtistIds'],
    ['canonical-venue-id', 'canonicalVenueId'],
    ['promoter-or-series-ids', 'promoterOrSeriesIds'],
    ['event-shape', 'eventShape'],
    ['signal-tags', 'signalTags'],
    ['recorded-at', 'recordedAt'],
    ['plan-ahead-min-score', 'planAheadMinScore'],
    ['brief-config', 'briefConfig'],
    ['snapshot-index', 'snapshotIndex']
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const keyName = argument.slice(2);
    const key = aliases.get(keyName) ?? keyName;
    if (booleanFlags.has(keyName)) {
      options[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${keyName} requires a value`);
    if (['canonicalArtistIds', 'promoterOrSeriesIds', 'signalTags'].includes(key)) {
      options[key] = [...(options[key] ?? []), ...parseList(value)];
    } else if (key === 'rating' || key === 'planAheadMinScore') {
      options[key] = Number(value);
    } else {
      options[key] = value;
    }
    index += 1;
  }
  if (options.canonicalVenueId === '') options.canonicalVenueId = null;
  return options;
}

async function loadConfig(options) {
  return loadFeedbackConfig(resolve(options.config ?? 'config/feedback.json'));
}

async function readProjection(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Projection not found at ${path}; pass --projection or provide historical event snapshots explicitly.`);
    if (error instanceof SyntaxError) throw new Error('Projection is malformed JSON; no feedback was written.');
    throw new Error(`Could not read projection: ${error.message}`);
  }
}

async function readProjectionIfPresent(path) {
  try {
    return await readProjection(resolve(path));
  } catch (error) {
    if (error.message.startsWith('Projection not found')) return {};
    throw error;
  }
}

function findProjectionEvent(projection, eventId) {
  for (const collection of [projection.events, projection.sports, projection.movies]) {
    const match = Array.isArray(collection) ? collection.find((event) => event?.id === eventId) : null;
    if (match) return match;
  }
  return null;
}

function snapshotFromRecord(record) {
  return {
    canonicalEventId: record.canonicalEventId,
    eventDateLocal: record.eventDateLocal,
    eventTitleSnapshot: record.eventTitleSnapshot,
    evidenceSnapshot: record.evidenceSnapshot
  };
}

function snapshotFromExplicitOptions(options) {
  return {
    canonicalEventId: options.eventId,
    eventDateLocal: options.eventDateLocal,
    eventTitleSnapshot: options.eventTitle,
    evidenceSnapshot: {
      canonicalArtistIds: options.canonicalArtistIds ?? [],
      canonicalVenueId: options.canonicalVenueId ?? null,
      promoterOrSeriesIds: options.promoterOrSeriesIds ?? [],
      eventShape: options.eventShape ?? null
    }
  };
}

function hasExplicitSnapshotOverride(options) {
  return Boolean(options.eventTitle || options.eventDateLocal || options.canonicalArtistIds?.length || options.canonicalVenueId || options.promoterOrSeriesIds?.length || options.eventShape);
}

function printEventSummary(snapshot, action) {
  console.log(`${action}: ${snapshot.eventTitleSnapshot} | ${snapshot.eventDateLocal} | ${snapshot.canonicalEventId}`);
}

async function requireConfirmation(label, alreadyConfirmed) {
  if (alreadyConfirmed) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(`${label} requires confirmation; rerun with --yes in noninteractive use.`);
  const readline = await import('node:readline/promises');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${label}? Type yes to continue: `);
    if (answer.trim().toLowerCase() !== 'yes') throw new Error(`${label} cancelled; no journal change was made.`);
  } finally {
    prompt.close();
  }
}

function nextFeedbackId(records, eventId, recordedAt, suffix = 'record') {
  const base = `feedback:${eventId}:${suffix}:${recordedAt}`;
  const used = new Set(records.map((record) => record.feedbackId));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}:${index}`)) index += 1;
  return `${base}:${index}`;
}

function parseList(value) {
  if (Array.isArray(value)) return value.flatMap(parseList);
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

async function readPlanAheadMinScore(path) {
  try {
    const config = await loadBriefConfig(resolve(path));
    return config.overviewPlanAheadMinScore;
  } catch {
    return 55;
  }
}

function assertCleanJournal(journal) {
  if (journal.issues.length) throw new Error('Feedback journal is invalid; run taste:feedback:validate before changing it.');
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\r?\n/g, ' ').slice(0, 500);
}

function printHelp() {
  console.log('Local feedback commands:');
  console.log('  add --event-id ID --status STATUS [--projection PATH] [--yes]');
  console.log('  replace --event-id ID --status STATUS --yes [--supersedes-feedback-id ID]');
  console.log('  list [--include-revoked]');
  console.log('  revoke --feedback-id ID --yes');
  console.log('  validate');
  console.log('  rebuild');
  console.log('  simulate [--projection PATH]');
  console.log('  import --file PATH [--snapshot-index PATH]');
  console.log(`  statuses: ${FEEDBACK_STATUSES.join(', ')}`);
  console.log(`  tags: ${FEEDBACK_SIGNAL_TAGS.join(', ')}`);
}
