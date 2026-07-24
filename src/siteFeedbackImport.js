import { readFile, stat } from 'node:fs/promises';
import {
  FEEDBACK_REASON_CODES,
  FEEDBACK_STATUSES,
  LEGACY_FEEDBACK_STATUSES,
  appendFeedbackRecords,
  readFeedbackJournal
} from './feedback.js';
import { FEEDBACK_SNAPSHOT_INDEX_PATH, readSnapshotIndex } from './feedbackSnapshots.js';

export const IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxRecords: 500,
  maxLineLength: 10_000
});

// The exact keys a browser import envelope may carry. Anything else — most
// importantly evidenceSnapshot — is rejected before any normalizer runs:
// browser records are untrusted input and may never supply evidence entities.
const ENVELOPE_KEYS = Object.freeze([
  'schemaVersion', 'source', 'feedbackId', 'feedbackSnapshotId', 'canonicalEventId',
  'eventDateLocal', 'eventTitleSnapshot', 'status', 'reasonCodes', 'rating', 'signalTags', 'notes', 'recordedAt'
]);
// reasonCodes did not exist in v1/v2 browser exports. Keep it optional at
// the envelope boundary so history can round-trip, then mark legacy reasons
// history-only when normalizing the durable record.
const REQUIRED_ENVELOPE_KEYS = ENVELOPE_KEYS.filter((key) => !['rating', 'reasonCodes'].includes(key));

export function validateImportEnvelope(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['envelope must be an object'];
  for (const key of Object.keys(raw)) {
    if (!ENVELOPE_KEYS.includes(key)) errors.push(`forbidden key: ${key}`);
  }
  for (const key of REQUIRED_ENVELOPE_KEYS) {
    if (!(key in raw)) errors.push(`missing key: ${key}`);
  }
  if (errors.length) return errors;
  if (raw.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (raw.source !== 'taste-engine-site') errors.push('source must be taste-engine-site');
  for (const key of ['feedbackId', 'feedbackSnapshotId', 'canonicalEventId', 'eventTitleSnapshot']) {
    if (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key].length > 300) errors.push(`${key} must be a non-empty string`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.eventDateLocal))) errors.push('eventDateLocal must be YYYY-MM-DD');
  if (!FEEDBACK_STATUSES.includes(raw.status) && !Object.hasOwn(LEGACY_FEEDBACK_STATUSES, String(raw.status))) errors.push('status is unsupported');
  if (raw.reasonCodes != null && (!Array.isArray(raw.reasonCodes) || raw.reasonCodes.some((reason) => !FEEDBACK_REASON_CODES.includes(reason)) || new Set(raw.reasonCodes).size !== raw.reasonCodes.length)) {
    errors.push('reasonCodes must contain unique supported reasons');
  }
  if (raw.rating != null && (!Number.isInteger(raw.rating) || raw.rating < 1 || raw.rating > 5)) errors.push('rating must be null or an integer from 1 to 5');
  if (!Array.isArray(raw.signalTags)) errors.push('signalTags must be an array');
  if (raw.notes !== null) errors.push('notes must be null in site exports');
  if (typeof raw.recordedAt !== 'string' || !Number.isFinite(Date.parse(raw.recordedAt))) errors.push('recordedAt must be a valid timestamp');
  return errors;
}

// The user-authored identity of an envelope. Duplicate equality is judged on
// this — never on rehydrated evidence, so private snapshot-index evolution
// cannot change whether two exports represent the same user action.
export function envelopeIdentity(envelope) {
  return JSON.stringify({
    feedbackId: envelope.feedbackId,
    feedbackSnapshotId: envelope.feedbackSnapshotId ?? null,
    canonicalEventId: envelope.canonicalEventId,
    eventDateLocal: envelope.eventDateLocal,
    eventTitleSnapshot: envelope.eventTitleSnapshot,
    status: envelope.status,
    reasonCodes: envelope.reasonCodes ?? [],
    rating: envelope.rating ?? null,
    signalTags: [...(envelope.signalTags ?? [])].sort(),
    recordedAt: new Date(envelope.recordedAt).toISOString()
  });
}

export async function importSiteFeedback({
  filePath,
  journalPath,
  snapshotIndexPath = FEEDBACK_SNAPSHOT_INDEX_PATH,
  limits = IMPORT_LIMITS
}) {
  const report = {
    inputCount: 0,
    newCount: 0,
    duplicateCount: 0,
    appended: false,
    errors: [],
    warnings: []
  };
  const fail = (reason) => {
    report.errors.push(reason);
    return report;
  };

  const info = await stat(filePath).catch(() => null);
  if (!info) return fail(`import file not found: ${filePath}`);
  if (info.size > limits.maxFileBytes) return fail(`import file exceeds ${limits.maxFileBytes} bytes`);
  const content = await readFile(filePath, 'utf8');
  if (content.includes('\u0000')) return fail('import file contains binary data');

  const lines = content.split('\n').map((line, index) => ({ line: index + 1, text: line.replace(/\r$/, '') }))
    .filter(({ text }) => text.trim());
  if (lines.length > limits.maxRecords) return fail(`import file exceeds ${limits.maxRecords} records`);
  report.inputCount = lines.length;
  if (!lines.length) return fail('import file contains no records');

  // Phase 1: parse and validate every envelope before touching anything.
  const envelopes = [];
  for (const { line, text } of lines) {
    if (text.length > limits.maxLineLength) {
      report.errors.push(`line ${line}: exceeds maximum line length`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      report.errors.push(`line ${line}: malformed JSON`);
      continue;
    }
    const problems = validateImportEnvelope(parsed);
    if (problems.length) {
      report.errors.push(`line ${line}: ${problems.join('; ')}`);
      continue;
    }
    envelopes.push({ line, envelope: parsed });
  }
  if (report.errors.length) return abort(report);

  // Phase 2: duplicates within the file and against the journal.
  // Identical duplicates skip; same feedbackId with different content is a
  // conflict that aborts the whole import.
  const journal = await readFeedbackJournal(journalPath);
  if (journal.issues.length) return abort(fail('feedback journal is invalid; run taste:feedback:validate first'));
  const journalIdentity = new Map(journal.records.map((record) => [record.feedbackId, envelopeIdentity({
    feedbackId: record.feedbackId,
    feedbackSnapshotId: record.feedbackSnapshotId ?? null,
    canonicalEventId: record.canonicalEventId,
    eventDateLocal: record.eventDateLocal,
    eventTitleSnapshot: record.eventTitleSnapshot,
    status: record.status,
    rating: record.rating,
    signalTags: record.signalTags,
    recordedAt: record.recordedAt
  })]));
  const seenInFile = new Map();
  const fresh = [];
  for (const { line, envelope } of envelopes) {
    const identity = envelopeIdentity(envelope);
    const inFile = seenInFile.get(envelope.feedbackId);
    if (inFile != null) {
      if (inFile === identity) {
        report.duplicateCount += 1;
        continue;
      }
      report.errors.push(`line ${line}: conflicting duplicate of ${envelope.feedbackId} within the file`);
      continue;
    }
    seenInFile.set(envelope.feedbackId, identity);
    const existing = journalIdentity.get(envelope.feedbackId);
    if (existing != null) {
      if (existing === identity) {
        report.duplicateCount += 1;
        continue;
      }
      report.errors.push(`line ${line}: conflicting duplicate of ${envelope.feedbackId} already in the journal`);
      continue;
    }
    fresh.push({ line, envelope });
  }
  if (report.errors.length) return abort(report);
  if (!fresh.length) return report; // everything was an identical duplicate

  // Phase 3: rehydrate authoritative evidence from the private index. The
  // envelope's event identity must agree with the indexed snapshot; a
  // rehydration miss produces an empty, non-generalizing evidence snapshot
  // with an explicit warning — never silent success.
  const index = await readSnapshotIndex(snapshotIndexPath).catch((error) => {
    report.warnings.push(`snapshot index unavailable (${error.message.slice(0, 120)}); evidence will be empty`);
    return { version: 1, snapshots: {} };
  });
  const records = [];
  for (const { line, envelope } of fresh) {
    const snapshot = index.snapshots[envelope.feedbackSnapshotId] ?? null;
    if (snapshot) {
      const agrees = snapshot.canonicalEventId === envelope.canonicalEventId
        && snapshot.eventDateLocal === envelope.eventDateLocal
        && snapshot.eventTitleSnapshot === envelope.eventTitleSnapshot;
      if (!agrees) {
        report.errors.push(`line ${line}: envelope identity does not match snapshot ${envelope.feedbackSnapshotId}`);
        continue;
      }
    } else {
      report.warnings.push(`line ${line}: snapshot ${envelope.feedbackSnapshotId} not found; imported with empty evidence`);
    }
    records.push({
      feedbackId: envelope.feedbackId,
      action: 'record',
      canonicalEventId: envelope.canonicalEventId,
      eventDateLocal: envelope.eventDateLocal,
      eventTitleSnapshot: envelope.eventTitleSnapshot,
      status: envelope.status,
      reasonCodes: envelope.reasonCodes ?? [],
      rating: envelope.rating ?? null,
      signalTags: envelope.signalTags,
      notes: null,
      feedbackSnapshotId: envelope.feedbackSnapshotId,
      evidenceSnapshot: snapshot?.evidenceSnapshot ?? { canonicalArtistIds: [], canonicalVenueId: null, promoterOrSeriesIds: [], eventShape: null },
      recordedAt: envelope.recordedAt
    });
  }
  if (report.errors.length) return abort(report);

  // Phase 4: one atomic batch append (or nothing).
  try {
    await appendFeedbackRecords(journalPath, records);
  } catch (error) {
    return abort(fail(error.message));
  }
  report.newCount = records.length;
  report.appended = true;
  return report;
}

function abort(report) {
  report.appended = false;
  report.newCount = 0;
  return report;
}
