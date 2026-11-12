import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const FEEDBACK_ACTIONS = ['record', 'revoke', 'replace'];
export const FEEDBACK_STATUSES = [
  'attended-worth-it',
  'attended-not-worth-it',
  'wanted-to-attend',
  'lost-interest',
  'did-not-attend-logistical',
  // Pre-event interest from triage, and an explicit undo. Both are read only
  // by the shared policy in feedbackPolicy.js.
  'interested',
  'withdrawn'
];
export const LEGACY_FEEDBACK_STATUSES = Object.freeze({
  'skipped-still-interested': 'wanted-to-attend',
  'skipped-no-longer-interested': 'lost-interest'
});
export const FEEDBACK_REASON_CODES = [
  'artist', 'lineup', 'production', 'crowd', 'venue', 'timing', 'hassle',
  'price', 'distance', 'availability', 'calendar', 'recovery', 'other', 'legacy-unknown'
];
export const FEEDBACK_SIGNAL_TAGS = [
  'artist',
  'venue',
  'production',
  'crowd',
  'timing',
  'hassle',
  'price',
  'lineup'
];

// Capture and storage only. How feedback changes ranking is the shared policy
// (feedbackPolicy.js); whether it may is the reviewed activation record
// (feedbackActivation.js). Neither is configurable here, so a config edit can
// never switch learning on.
const DEFAULT_FEEDBACK_CONFIG = {
  enabled: true,
  journalPath: 'data/taste/feedback.jsonl',
  statePath: 'data/taste/feedback-state.json',
  reportPath: 'data/taste/feedback-report.json'
};

export async function loadFeedbackConfig(path = 'config/feedback.json') {
  try {
    const input = JSON.parse(await readFile(path, 'utf8'));
    return normalizeFeedbackConfig(input);
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeFeedbackConfig({});
    if (error instanceof SyntaxError) throw new Error(`Could not read feedback config at ${path}: malformed JSON`);
    throw new Error(`Could not read feedback config at ${path}: ${error.message}`);
  }
}

export function normalizeFeedbackConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Feedback config must be an object');
  const value = input.feedback && typeof input.feedback === 'object' ? input.feedback : input;
  // Retired keys (applyToPublishedRanking, weights, thresholds, adjustments)
  // are accepted and ignored so an older config file still loads.
  return {
    enabled: booleanValue(value.enabled, DEFAULT_FEEDBACK_CONFIG.enabled, 'enabled'),
    journalPath: pathValue(value.journalPath ?? DEFAULT_FEEDBACK_CONFIG.journalPath, 'journalPath'),
    statePath: pathValue(value.statePath ?? DEFAULT_FEEDBACK_CONFIG.statePath, 'statePath'),
    reportPath: pathValue(value.reportPath ?? DEFAULT_FEEDBACK_CONFIG.reportPath, 'reportPath')
  };
}

export function validateFeedbackRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { valid: false, errors: ['record must be an object'] };
  if (!safeText(record.feedbackId, 200)) errors.push('feedbackId must be a non-empty safe string');
  if (!FEEDBACK_ACTIONS.includes(record.action)) errors.push('action is unsupported');
  if (record.action === 'record' && record.supersedesFeedbackId != null) errors.push('record action cannot supersede another record');
  if (['replace', 'revoke'].includes(record.action) && !safeText(record.supersedesFeedbackId, 200)) errors.push('replace and revoke actions require supersedesFeedbackId');
  if (!safeText(record.canonicalEventId, 300)) errors.push('canonicalEventId must be a non-empty safe string');
  if (!isLocalDate(record.eventDateLocal)) errors.push('eventDateLocal must be YYYY-MM-DD');
  if (!safeText(record.eventTitleSnapshot, 500)) errors.push('eventTitleSnapshot must be a non-empty safe string');
  if (!FEEDBACK_STATUSES.includes(record.status)) errors.push('status is unsupported');
  if (!Array.isArray(record.reasonCodes) || record.reasonCodes.some((reason) => !FEEDBACK_REASON_CODES.includes(reason)) || new Set(record.reasonCodes).size !== record.reasonCodes.length) {
    errors.push('reasonCodes must contain unique supported reasons');
  }
  if (['wanted-to-attend', 'lost-interest', 'did-not-attend-logistical'].includes(record.status) && !record.reasonCodes.length) {
    errors.push('this outcome requires one classified reason');
  }
  if (record.rating != null && (!Number.isInteger(record.rating) || record.rating < 1 || record.rating > 5)) errors.push('rating must be an integer from 1 to 5');
  if (!Array.isArray(record.signalTags) || record.signalTags.some((tag) => !FEEDBACK_SIGNAL_TAGS.includes(tag)) || new Set(record.signalTags).size !== record.signalTags.length) {
    errors.push('signalTags must contain unique supported tags');
  }
  if (record.notes != null && (typeof record.notes !== 'string' || record.notes.length > 4000)) errors.push('notes must be a private string of at most 4000 characters');
  if (record.feedbackSnapshotId != null && !safeText(record.feedbackSnapshotId, 200)) errors.push('feedbackSnapshotId must be null or a safe string');
  validateEvidenceSnapshot(record.evidenceSnapshot, errors);
  if (typeof record.recordedAt !== 'string' || !Number.isFinite(Date.parse(record.recordedAt))) errors.push('recordedAt must be a valid timestamp');
  return { valid: errors.length === 0, errors };
}

export function normalizeFeedbackRecord(input) {
  const rawEvidenceSnapshot = input?.evidenceSnapshot;
  const record = {
    feedbackId: input?.feedbackId,
    action: input?.action,
    supersedesFeedbackId: input?.supersedesFeedbackId,
    canonicalEventId: input?.canonicalEventId,
    eventDateLocal: input?.eventDateLocal,
    eventTitleSnapshot: input?.eventTitleSnapshot,
    status: LEGACY_FEEDBACK_STATUSES[input?.status] ?? input?.status,
    rating: input?.rating == null ? null : Number(input.rating),
    signalTags: Array.isArray(input?.signalTags) ? [...input.signalTags] : input?.signalTags,
    reasonCodes: Array.isArray(input?.reasonCodes) ? [...input.reasonCodes] : legacyReasons(input),
    notes: input?.notes == null ? null : input.notes,
    evidenceSnapshot: rawEvidenceSnapshot && typeof rawEvidenceSnapshot === 'object' && !Array.isArray(rawEvidenceSnapshot)
      ? normalizeEvidenceSnapshot(rawEvidenceSnapshot)
      : rawEvidenceSnapshot,
    feedbackSnapshotId: input?.feedbackSnapshotId == null ? undefined : input.feedbackSnapshotId,
    recordedAt: input?.recordedAt
  };
  const feedbackKeys = normalizeFeedbackKeys(input?.feedbackKeys);
  if (feedbackKeys) record.feedbackKeys = feedbackKeys;
  if (typeof record.feedbackId === 'string') record.feedbackId = record.feedbackId.trim();
  if (typeof record.supersedesFeedbackId === 'string') record.supersedesFeedbackId = record.supersedesFeedbackId.trim();
  if (typeof record.canonicalEventId === 'string') record.canonicalEventId = record.canonicalEventId.trim();
  if (typeof record.eventDateLocal === 'string') record.eventDateLocal = record.eventDateLocal.trim();
  if (typeof record.eventTitleSnapshot === 'string') record.eventTitleSnapshot = record.eventTitleSnapshot.trim();
  if (typeof record.recordedAt === 'string' && Number.isFinite(Date.parse(record.recordedAt))) record.recordedAt = new Date(record.recordedAt).toISOString();
  if (Array.isArray(record.signalTags)) record.signalTags = sortByKnownOrder(record.signalTags, FEEDBACK_SIGNAL_TAGS);
  if (Array.isArray(record.reasonCodes)) record.reasonCodes = sortByKnownOrder(record.reasonCodes, FEEDBACK_REASON_CODES);
  if (record.evidenceSnapshot && typeof record.evidenceSnapshot === 'object') {
    record.evidenceSnapshot.canonicalArtistIds = sortStrings(record.evidenceSnapshot.canonicalArtistIds);
    record.evidenceSnapshot.promoterOrSeriesIds = sortStrings(record.evidenceSnapshot.promoterOrSeriesIds);
  }
  if (typeof record.feedbackSnapshotId === 'string') record.feedbackSnapshotId = record.feedbackSnapshotId.trim();
  if (record.feedbackSnapshotId == null) delete record.feedbackSnapshotId;
  if (record.supersedesFeedbackId == null) delete record.supersedesFeedbackId;
  return record;
}

export async function readFeedbackJournal(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { missing: true, raw: '', records: [], issues: [], recordLines: new Map(), lineCount: 0 };
    throw new Error(`Could not read feedback journal at ${path}: ${error.message}`);
  }

  const records = [];
  const issues = [];
  const recordLines = new Map();
  const seenIds = new Set();
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      issues.push({ line: index + 1, code: 'malformed-json', reason: 'malformed JSON line' });
      continue;
    }
    const record = normalizeFeedbackRecord(parsed);
    const validation = validateFeedbackRecord(record);
    if (!validation.valid) {
      issues.push({ line: index + 1, code: 'invalid-record', reason: validation.errors.join('; ') });
      continue;
    }
    if (seenIds.has(record.feedbackId)) {
      issues.push({ line: index + 1, code: 'duplicate-feedback-id', reason: 'duplicate feedbackId' });
      continue;
    }
    seenIds.add(record.feedbackId);
    records.push(record);
    recordLines.set(record.feedbackId, index + 1);
  }
  return { missing: false, raw, records, issues, recordLines, lineCount: lines.length - (lines.at(-1) === '' ? 1 : 0) };
}

export async function appendFeedbackRecord(path, input) {
  const record = normalizeFeedbackRecord(input);
  const validation = validateFeedbackRecord(record);
  if (!validation.valid) throw new Error(`Feedback record rejected: ${validation.errors.join('; ')}`);
  const journal = await readFeedbackJournal(path);
  if (journal.issues.length) throw new Error('Feedback journal is invalid; run taste:feedback:validate before adding another record.');
  if (journal.records.some((existing) => existing.feedbackId === record.feedbackId)) throw new Error('feedbackId already exists; choose a new feedbackId.');
  const replay = replayFeedbackRecords([...journal.records, record]);
  if (replay.issues.length) throw new Error('Feedback change would create an invalid replacement or duplicate-event state; use replace/revoke with an active record and validate the journal.');
  const prefix = journal.raw && !journal.raw.endsWith('\n') ? `${journal.raw}\n` : journal.raw;
  await writeAtomicText(path, `${prefix}${JSON.stringify(record)}\n`);
  return record;
}

// Batch variant of appendFeedbackRecord: every record is validated and the
// combined replay is checked BEFORE anything is written, then all records
// land in one atomic write. Either the whole batch appends or nothing does.
export async function appendFeedbackRecords(path, inputs) {
  const records = inputs.map((input) => {
    const record = normalizeFeedbackRecord(input);
    const validation = validateFeedbackRecord(record);
    if (!validation.valid) throw new Error(`Feedback record rejected: ${validation.errors.join('; ')}`);
    return record;
  });
  const journal = await readFeedbackJournal(path);
  if (journal.issues.length) throw new Error('Feedback journal is invalid; run taste:feedback:validate before adding records.');
  const seen = new Set(journal.records.map((existing) => existing.feedbackId));
  for (const record of records) {
    if (seen.has(record.feedbackId)) throw new Error(`feedbackId already exists: ${record.feedbackId}`);
    seen.add(record.feedbackId);
  }
  const replay = replayFeedbackRecords([...journal.records, ...records]);
  if (replay.issues.length) throw new Error('Feedback batch would create an invalid replacement or duplicate-event state; nothing was written.');
  const prefix = journal.raw && !journal.raw.endsWith('\n') ? `${journal.raw}\n` : journal.raw;
  await writeAtomicText(path, `${prefix}${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  return records;
}

export async function writeJsonAtomic(path, value) {
  await writeAtomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function replayFeedbackRecords(records = []) {
  const validRecords = [];
  const issues = [];
  const byId = new Map();
  const invalidFeedbackIds = new Set();

  for (const input of records) {
    const record = normalizeFeedbackRecord(input);
    const validation = validateFeedbackRecord(record);
    if (!validation.valid) {
      issues.push({ code: 'invalid-record', reason: validation.errors.join('; '), feedbackIds: safeFeedbackIds([record.feedbackId]) });
      if (safeText(record.feedbackId, 200)) invalidFeedbackIds.add(record.feedbackId);
      continue;
    }
    if (byId.has(record.feedbackId)) {
      issues.push({ code: 'duplicate-feedback-id', reason: 'duplicate feedbackId', feedbackIds: [record.feedbackId] });
      invalidFeedbackIds.add(record.feedbackId);
      continue;
    }
    byId.set(record.feedbackId, record);
    validRecords.push(record);
  }

  const children = new Map();
  for (const record of validRecords) {
    if (record.action === 'record') continue;
    const targetId = record.supersedesFeedbackId;
    const target = byId.get(targetId);
    if (!target) {
      issues.push({ code: 'unknown-supersedes-id', reason: 'supersedesFeedbackId does not identify a journal record', feedbackIds: [record.feedbackId] });
      invalidFeedbackIds.add(record.feedbackId);
      continue;
    }
    const next = children.get(targetId) ?? [];
    next.push(record.feedbackId);
    children.set(targetId, next);
    if (target.action === 'revoke') {
      issues.push({ code: 'supersedes-revocation', reason: 'a revocation cannot be replaced', feedbackIds: [record.feedbackId, target.feedbackId].sort() });
      invalidFeedbackIds.add(record.feedbackId);
    }
  }

  for (const [targetId, childIds] of children) {
    if (childIds.length <= 1) continue;
    const ids = [targetId, ...childIds].sort();
    issues.push({ code: 'branching-supersession', reason: 'one feedback record has multiple corrections', feedbackIds: ids });
    markDescendants(targetId, children, invalidFeedbackIds);
    invalidFeedbackIds.add(targetId);
  }

  const visitState = new Map();
  const stack = [];
  for (const record of validRecords) visit(record.feedbackId);

  function visit(id) {
    const state = visitState.get(id) ?? 0;
    if (state === 2) return;
    if (state === 1) {
      const start = stack.indexOf(id);
      const cycleIds = (start >= 0 ? stack.slice(start) : [id]).sort();
      issues.push({ code: 'circular-supersession', reason: 'replacement graph contains a cycle', feedbackIds: cycleIds });
      for (const cycleId of cycleIds) invalidFeedbackIds.add(cycleId);
      return;
    }
    visitState.set(id, 1);
    stack.push(id);
    const targetId = byId.get(id)?.supersedesFeedbackId;
    if (targetId && byId.has(targetId)) visit(targetId);
    stack.pop();
    visitState.set(id, 2);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const record of validRecords) {
      if (invalidFeedbackIds.has(record.feedbackId)) continue;
      const targetId = record.supersedesFeedbackId;
      if (targetId && invalidFeedbackIds.has(targetId)) {
        invalidFeedbackIds.add(record.feedbackId);
        changed = true;
      }
      const childIds = children.get(record.feedbackId) ?? [];
      if (childIds.some((childId) => invalidFeedbackIds.has(childId))) {
        invalidFeedbackIds.add(record.feedbackId);
        changed = true;
      }
    }
  }

  let activeRecords = validRecords.filter((record) => {
    if (invalidFeedbackIds.has(record.feedbackId)) return false;
    if (record.action === 'revoke') return false;
    return !(children.get(record.feedbackId) ?? []).length;
  });
  const activeByEvent = new Map();
  for (const record of activeRecords) {
    const next = activeByEvent.get(record.canonicalEventId) ?? [];
    next.push(record);
    activeByEvent.set(record.canonicalEventId, next);
  }
  const invalidEventIds = new Set();
  for (const [eventId, eventRecords] of activeByEvent) {
    if (eventRecords.length <= 1) continue;
    const feedbackIds = eventRecords.map((record) => record.feedbackId).sort();
    issues.push({ code: 'duplicate-active-event', reason: 'one canonical event has multiple active feedback outcomes', canonicalEventId: eventId, feedbackIds });
    invalidEventIds.add(eventId);
    for (const record of eventRecords) invalidFeedbackIds.add(record.feedbackId);
  }
  activeRecords = activeRecords.filter((record) => !invalidEventIds.has(record.canonicalEventId));

  const revokedRecords = validRecords.filter((record) => record.action === 'revoke' && !invalidFeedbackIds.has(record.feedbackId));
  const ignoredFeedbackIds = [...invalidFeedbackIds].sort();
  return {
    activeRecords: sortRecords(activeRecords),
    revokedRecords: sortRecords(revokedRecords),
    validRecords: sortRecords(validRecords),
    invalidFeedbackIds: ignoredFeedbackIds,
    invalidEventIds: [...invalidEventIds].sort(),
    issues: dedupeReplayIssues(issues)
  };
}

export function deriveFeedbackState(records = [], { journalIssues = [] } = {}) {
  const replay = replayFeedbackRecords(records);
  const activeRecords = replay.activeRecords;
  const ignored = [
    ...journalIssues.map((issue) => ({ source: 'journal', line: issue.line, code: issue.code, reason: issue.reason })),
    ...replay.issues.map((issue) => ({
      source: 'replay',
      code: issue.code,
      reason: issue.reason,
      ...(issue.canonicalEventId ? { canonicalEventId: issue.canonicalEventId } : {}),
      ...(issue.feedbackIds?.length ? { feedbackIds: issue.feedbackIds } : {})
    }))
  ].sort(ignoreComparator);
  const outcomesByStatus = Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, 0]));
  for (const record of activeRecords) outcomesByStatus[record.status] += 1;
  return {
    schemaVersion: 2,
    validRecordCount: replay.validRecords.length,
    activeFeedbackCount: activeRecords.length,
    revokedCount: replay.revokedRecords.length,
    malformedCount: journalIssues.length + replay.issues.length,
    outcomesByStatus,
    activeRecords: activeRecords.map(redactRecord),
    eventOutcomes: summarizeEvents(activeRecords),
    ignored,
    ignoredFeedbackIds: replay.invalidFeedbackIds,
    ignoredEventIds: replay.invalidEventIds
  };
}

export function snapshotFeedbackEvent(event, { allowMissing = false } = {}) {
  const canonicalEventId = firstText(event?.canonicalEventId, event?.id);
  const eventDateLocal = firstText(event?.eventDateLocal, event?.startLocal?.slice?.(0, 10), event?.releaseDate);
  const eventTitleSnapshot = firstText(event?.eventTitleSnapshot, event?.title, sportsTitle(event), event?.originalTitle);
  const evidenceSnapshot = event?.evidenceSnapshot && typeof event.evidenceSnapshot === 'object'
    ? normalizeEvidenceSnapshot(event.evidenceSnapshot)
    : normalizeEvidenceSnapshot({
      canonicalArtistIds: (event?.matchedArtists ?? []).map((artist) => firstText(artist?.canonicalArtistId, artist?.spotifyArtistId, artist?.id)).filter(Boolean),
      canonicalVenueId: firstText(event?.venue?.canonicalVenueId, event?.venue?.sourceId, event?.venue?.id),
      promoterOrSeriesIds: [
        ...(Array.isArray(event?.promoterOrSeriesIds) ? event.promoterOrSeriesIds : []),
        ...(Array.isArray(event?.promoterIds) ? event.promoterIds : []),
        firstText(event?.series?.id)
      ].filter(Boolean),
      eventShape: firstText(event?.eventShape, event?.eventType, event?.type, event?.releaseDate ? 'movie' : null, event?.series || event?.homeTeam || event?.awayTeam ? 'baseball' : null)
    });
  const missing = [];
  if (!safeText(canonicalEventId, 300)) missing.push('canonicalEventId');
  if (!isLocalDate(eventDateLocal)) missing.push('eventDateLocal');
  if (!safeText(eventTitleSnapshot, 500)) missing.push('eventTitleSnapshot');
  if (missing.length && !allowMissing) throw new Error(`Event snapshot is missing ${missing.join(', ')}`);
  return {
    canonicalEventId: canonicalEventId ?? null,
    eventDateLocal: eventDateLocal ?? null,
    eventTitleSnapshot: eventTitleSnapshot ?? null,
    evidenceSnapshot,
    missing
  };
}




async function writeAtomicText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
}

// Display-derived keys frozen at capture time (see feedbackPolicy.js).
function normalizeFeedbackKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = {};
  for (const [category, entries] of Object.entries(value).slice(0, 8)) {
    if (!/^[a-z]{3,12}$/.test(category) || !Array.isArray(entries)) continue;
    const list = entries.slice(0, 16)
      .filter((entry) => entry && typeof entry.key === 'string' && entry.key.startsWith(`${category}:`) && entry.key.length <= 200)
      .map((entry) => ({ key: entry.key, label: String(entry.label ?? '').slice(0, 120) }));
    if (list.length) keys[category] = list;
  }
  return Object.keys(keys).length ? keys : null;
}

function validateEvidenceSnapshot(value, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('evidenceSnapshot must be an object');
    return;
  }
  if (!stringArray(value.canonicalArtistIds, 40)) errors.push('evidenceSnapshot.canonicalArtistIds must be an array of safe strings');
  if (value.canonicalVenueId != null && !safeText(value.canonicalVenueId, 200)) errors.push('evidenceSnapshot.canonicalVenueId must be null or a safe string');
  if (!stringArray(value.promoterOrSeriesIds, 40)) errors.push('evidenceSnapshot.promoterOrSeriesIds must be an array of safe strings');
  if (value.eventShape != null && !safeText(value.eventShape, 80)) errors.push('evidenceSnapshot.eventShape must be null or a safe string');
}

function normalizeEvidenceSnapshot(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    canonicalArtistIds: sortStrings(Array.isArray(input.canonicalArtistIds) ? input.canonicalArtistIds : []),
    canonicalVenueId: input.canonicalVenueId == null ? null : input.canonicalVenueId,
    promoterOrSeriesIds: sortStrings(Array.isArray(input.promoterOrSeriesIds) ? input.promoterOrSeriesIds : []),
    eventShape: input.eventShape == null ? null : String(input.eventShape).trim() || null
  };
}



function summarizeEvents(records) {
  const byEvent = new Map();
  for (const record of records) {
    const existing = byEvent.get(record.canonicalEventId) ?? [];
    existing.push(record);
    byEvent.set(record.canonicalEventId, existing);
  }
  return [...byEvent.entries()].map(([canonicalEventId, eventRecords]) => {
    const statuses = Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, 0]));
    for (const record of eventRecords) statuses[record.status] += 1;
    const first = eventRecords[0];
    return {
      canonicalEventId,
      feedbackIds: eventRecords.map((record) => record.feedbackId).sort(),
      eventDateLocal: first.eventDateLocal,
      eventTitleSnapshot: first.eventTitleSnapshot,
      evidenceSnapshot: first.evidenceSnapshot,
      statuses,
      mostRecentOutcomeDate: eventRecords.map((record) => record.eventDateLocal).sort().at(-1) ?? null,
      mostRecentRecordedAt: eventRecords.map((record) => record.recordedAt).sort().at(-1) ?? null
    };
  }).sort((left, right) => left.canonicalEventId.localeCompare(right.canonicalEventId));
}











function redactRecord(record) {
  const { notes: _notes, ...safe } = record;
  return safe;
}

function legacyReasons(input) {
  return Object.hasOwn(LEGACY_FEEDBACK_STATUSES, String(input?.status ?? '')) ? ['legacy-unknown'] : [];
}




function sortRecords(records) {
  return [...records].sort((left, right) => left.feedbackId.localeCompare(right.feedbackId));
}

function dedupeReplayIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.canonicalEventId ?? ''}|${(issue.feedbackIds ?? []).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => `${left.code}|${left.canonicalEventId ?? ''}|${(left.feedbackIds ?? []).join(',')}`.localeCompare(`${right.code}|${right.canonicalEventId ?? ''}|${(right.feedbackIds ?? []).join(',')}`));
}

function markDescendants(id, children, invalidIds) {
  for (const childId of children.get(id) ?? []) {
    if (invalidIds.has(childId)) continue;
    invalidIds.add(childId);
    markDescendants(childId, children, invalidIds);
  }
}

function ignoreComparator(left, right) {
  return `${left.source}|${left.line ?? 0}|${left.code}|${left.canonicalEventId ?? ''}|${(left.feedbackIds ?? []).join(',')}`
    .localeCompare(`${right.source}|${right.line ?? 0}|${right.code}|${right.canonicalEventId ?? ''}|${(right.feedbackIds ?? []).join(',')}`);
}



function sportsTitle(event) {
  if (!event?.awayTeam && !event?.homeTeam) return null;
  const away = event.awayTeam?.shortName ?? event.awayTeam?.name;
  const home = event.homeTeam?.shortName ?? event.homeTeam?.name;
  return away && home ? `${away} at ${home}` : null;
}

function firstText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? null;
}


function sortStrings(values) {
  return Array.isArray(values) && values.every((value) => typeof value === 'string') ? [...new Set(values.map((value) => value.trim()))].filter(Boolean).sort() : values;
}

function sortByKnownOrder(values, order) {
  const rank = new Map(order.map((value, index) => [value, index]));
  return [...values].sort((left, right) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER));
}

function stringArray(value, maxLength) {
  return Array.isArray(value) && value.length <= maxLength && value.every((item) => safeText(item, 300));
}

function safeText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function isLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === value;
}

function validDate(value) {
  return value != null && Number.isFinite(new Date(value).getTime());
}




function booleanValue(value, fallback, name) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
  return value;
}

function pathValue(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${name} must be a safe path`);
  return value.trim();
}




