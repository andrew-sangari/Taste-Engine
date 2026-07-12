import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildOverviewBuckets } from './overview.js';
import { normalizeArtistName } from './ranking.js';

export const FEEDBACK_ACTIONS = ['record', 'revoke', 'replace'];
export const FEEDBACK_STATUSES = [
  'attended-worth-it',
  'attended-not-worth-it',
  'skipped-still-interested',
  'skipped-no-longer-interested'
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
export const FEEDBACK_SIGNAL_CATEGORIES = ['artist', 'venue', 'promoterOrSeries', 'eventShape'];

const DEFAULT_FEEDBACK_CONFIG = {
  enabled: true,
  applyToPublishedRanking: false,
  policyVersion: 1,
  journalPath: 'data/taste/feedback.jsonl',
  statePath: 'data/taste/feedback-state.json',
  reportPath: 'data/taste/feedback-report.json',
  weights: {
    'attended-worth-it': 1,
    'attended-not-worth-it': 1,
    'skipped-still-interested': 0.5,
    'skipped-no-longer-interested': 0.5
  },
  adjustments: {
    artist: 4,
    venue: 2,
    promoterOrSeries: 2,
    eventShape: 1
  },
  maxTotalAdjustment: 8,
  thresholds: {
    artist: {
      minIndependentEvents: 2,
      minAttendedEvents: 2,
      minEffectiveWeight: 2,
      minDominantFraction: 0.75,
      minMargin: 1.5
    },
    venue: {
      minIndependentEvents: 3,
      minAttendedEvents: 3,
      minEffectiveWeight: 3,
      minDominantFraction: 0.75,
      minMargin: 2
    },
    promoterOrSeries: {
      minIndependentEvents: 3,
      minAttendedEvents: 3,
      minEffectiveWeight: 3,
      minDominantFraction: 0.75,
      minMargin: 2
    },
    eventShape: {
      minIndependentEvents: 4,
      minAttendedEvents: 4,
      minEffectiveWeight: 4,
      minDominantFraction: 0.75,
      minMargin: 3
    }
  }
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
  const config = {
    enabled: booleanValue(value.enabled, DEFAULT_FEEDBACK_CONFIG.enabled, 'enabled'),
    applyToPublishedRanking: booleanValue(value.applyToPublishedRanking, DEFAULT_FEEDBACK_CONFIG.applyToPublishedRanking, 'applyToPublishedRanking'),
    policyVersion: positiveInteger(value.policyVersion ?? DEFAULT_FEEDBACK_CONFIG.policyVersion, 'policyVersion'),
    journalPath: pathValue(value.journalPath ?? DEFAULT_FEEDBACK_CONFIG.journalPath, 'journalPath'),
    statePath: pathValue(value.statePath ?? DEFAULT_FEEDBACK_CONFIG.statePath, 'statePath'),
    reportPath: pathValue(value.reportPath ?? DEFAULT_FEEDBACK_CONFIG.reportPath, 'reportPath'),
    weights: {},
    adjustments: {},
    maxTotalAdjustment: positiveNumber(value.maxTotalAdjustment ?? DEFAULT_FEEDBACK_CONFIG.maxTotalAdjustment, 'maxTotalAdjustment'),
    thresholds: {}
  };

  const weights = value.weights && typeof value.weights === 'object' ? value.weights : {};
  for (const status of FEEDBACK_STATUSES) {
    config.weights[status] = positiveNumber(weights[status] ?? DEFAULT_FEEDBACK_CONFIG.weights[status], `weights.${status}`);
  }

  const adjustments = value.adjustments && typeof value.adjustments === 'object' ? value.adjustments : {};
  for (const category of FEEDBACK_SIGNAL_CATEGORIES) {
    config.adjustments[category] = positiveNumber(adjustments[category] ?? DEFAULT_FEEDBACK_CONFIG.adjustments[category], `adjustments.${category}`);
  }

  const thresholds = value.thresholds && typeof value.thresholds === 'object' ? value.thresholds : {};
  for (const category of FEEDBACK_SIGNAL_CATEGORIES) {
    const defaults = DEFAULT_FEEDBACK_CONFIG.thresholds[category];
    const threshold = thresholds[category] && typeof thresholds[category] === 'object' ? thresholds[category] : {};
    const normalized = {
      minIndependentEvents: positiveInteger(threshold.minIndependentEvents ?? defaults.minIndependentEvents, `${category}.minIndependentEvents`),
      minAttendedEvents: positiveInteger(threshold.minAttendedEvents ?? defaults.minAttendedEvents, `${category}.minAttendedEvents`),
      minEffectiveWeight: positiveNumber(threshold.minEffectiveWeight ?? defaults.minEffectiveWeight, `${category}.minEffectiveWeight`),
      minDominantFraction: fractionValue(threshold.minDominantFraction ?? defaults.minDominantFraction, `${category}.minDominantFraction`),
      minMargin: positiveNumber(threshold.minMargin ?? defaults.minMargin, `${category}.minMargin`)
    };
    if (normalized.minAttendedEvents > normalized.minIndependentEvents) {
      throw new Error(`${category}.minAttendedEvents cannot exceed minIndependentEvents`);
    }
    config.thresholds[category] = normalized;
  }
  return config;
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
  if (record.rating != null && (!Number.isInteger(record.rating) || record.rating < 1 || record.rating > 5)) errors.push('rating must be an integer from 1 to 5');
  if (!Array.isArray(record.signalTags) || record.signalTags.some((tag) => !FEEDBACK_SIGNAL_TAGS.includes(tag)) || new Set(record.signalTags).size !== record.signalTags.length) {
    errors.push('signalTags must contain unique supported tags');
  }
  if (record.notes != null && (typeof record.notes !== 'string' || record.notes.length > 4000)) errors.push('notes must be a private string of at most 4000 characters');
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
    status: input?.status,
    rating: input?.rating == null ? null : Number(input.rating),
    signalTags: Array.isArray(input?.signalTags) ? [...input.signalTags] : input?.signalTags,
    notes: input?.notes == null ? null : input.notes,
    evidenceSnapshot: rawEvidenceSnapshot && typeof rawEvidenceSnapshot === 'object' && !Array.isArray(rawEvidenceSnapshot)
      ? normalizeEvidenceSnapshot(rawEvidenceSnapshot)
      : rawEvidenceSnapshot,
    recordedAt: input?.recordedAt
  };
  if (typeof record.feedbackId === 'string') record.feedbackId = record.feedbackId.trim();
  if (typeof record.supersedesFeedbackId === 'string') record.supersedesFeedbackId = record.supersedesFeedbackId.trim();
  if (typeof record.canonicalEventId === 'string') record.canonicalEventId = record.canonicalEventId.trim();
  if (typeof record.eventDateLocal === 'string') record.eventDateLocal = record.eventDateLocal.trim();
  if (typeof record.eventTitleSnapshot === 'string') record.eventTitleSnapshot = record.eventTitleSnapshot.trim();
  if (typeof record.recordedAt === 'string' && Number.isFinite(Date.parse(record.recordedAt))) record.recordedAt = new Date(record.recordedAt).toISOString();
  if (Array.isArray(record.signalTags)) record.signalTags = sortByKnownOrder(record.signalTags, FEEDBACK_SIGNAL_TAGS);
  if (record.evidenceSnapshot && typeof record.evidenceSnapshot === 'object') {
    record.evidenceSnapshot.canonicalArtistIds = sortStrings(record.evidenceSnapshot.canonicalArtistIds);
    record.evidenceSnapshot.promoterOrSeriesIds = sortStrings(record.evidenceSnapshot.promoterOrSeriesIds);
  }
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

export function deriveFeedbackState(records = [], { journalIssues = [], config = normalizeFeedbackConfig({}) } = {}) {
  const normalizedConfig = normalizeFeedbackConfig(config);
  const replay = replayFeedbackRecords(records);
  const activeRecords = replay.activeRecords;
  const eventOutcomes = summarizeEvents(activeRecords);
  const signalBuckets = Object.fromEntries(FEEDBACK_SIGNAL_CATEGORIES.map((category) => [category, new Map()]));
  for (const record of activeRecords) {
    for (const evidence of evidenceEntries(record)) {
      const bucket = signalBuckets[evidence.category];
      const existing = bucket.get(evidence.id) ?? [];
      existing.push(record);
      bucket.set(evidence.id, existing);
    }
  }
  const signals = Object.fromEntries(FEEDBACK_SIGNAL_CATEGORIES.map((category) => [category, [...signalBuckets[category].entries()]
    .map(([id, signalRecords]) => summarizeSignal(category, id, signalRecords, normalizedConfig))
    .sort((left, right) => left.id.localeCompare(right.id))]));
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
  const allSignals = FEEDBACK_SIGNAL_CATEGORIES.flatMap((category) => signals[category]);
  return {
    schemaVersion: 1,
    policyVersion: normalizedConfig.policyVersion,
    validRecordCount: replay.validRecords.length,
    activeFeedbackCount: activeRecords.length,
    revokedCount: replay.revokedRecords.length,
    malformedCount: journalIssues.length + replay.issues.length,
    outcomesByStatus,
    activeRecords: activeRecords.map(redactRecord),
    eventOutcomes,
    signals,
    signalSummary: {
      eligibleCount: allSignals.filter((signal) => signal.eligible).length,
      ineligibleCount: allSignals.filter((signal) => !signal.eligible).length
    },
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

export function simulateFeedback({ projection = {}, state, config = normalizeFeedbackConfig({}), now = null, planAheadMinScore = 55 } = {}) {
  const normalizedConfig = normalizeFeedbackConfig(config);
  const candidates = projectionCandidates(projection);
  const signalIndex = buildSignalIndex(normalizedConfig.enabled ? state?.signals ?? {} : {});
  const activeRecords = normalizedConfig.enabled ? state?.activeRecords ?? [] : [];
  const evaluations = candidates.map((candidate) => evaluateCandidate(candidate, signalIndex, activeRecords, normalizedConfig));
  const ranks = assignRanks(evaluations);
  const overview = simulateOverview(projection, evaluations, { now, planAheadMinScore });
  const candidateIds = new Set(candidates.map((candidate) => candidate.id).filter(Boolean));
  const unmatchedActiveFeedbackIds = activeRecords
    .filter((record) => !candidateIds.has(record.canonicalEventId))
    .map((record) => record.feedbackId)
    .sort();
  const shadowRankingDiffs = evaluations
    .filter((evaluation) => evaluation.proposedAdjustment !== 0 || evaluation.rankChanged)
    .map(toShadowDiff)
    .sort((left, right) => left.canonicalEventId.localeCompare(right.canonicalEventId));
  const titleSnapshotMismatches = evaluations.flatMap((evaluation) => evaluation.snapshotMismatchFeedbackIds.map((feedbackId) => ({
    feedbackId,
    canonicalEventId: evaluation.canonicalEventId
  }))).sort((left, right) => `${left.canonicalEventId}|${left.feedbackId}`.localeCompare(`${right.canonicalEventId}|${right.feedbackId}`));
  const capped = evaluations.filter((evaluation) => evaluation.capApplied);
  return {
    candidateCount: candidates.length,
    evaluableCandidateCount: evaluations.filter((evaluation) => evaluation.baselineScore != null).length,
    evaluations,
    shadowRankingDiffs,
    overview,
    capUsage: {
      capAppliedCount: capped.length,
      cappedMagnitude: round(capped.reduce((sum, evaluation) => sum + Math.abs(evaluation.proposedAdjustment), 0)),
      maxTotalAdjustment: normalizedConfig.maxTotalAdjustment
    },
    unmatchedActiveFeedbackIds,
    titleSnapshotMismatches
  };
}

export function buildFeedbackReport({ state, simulation, config = normalizeFeedbackConfig({}) } = {}) {
  const normalizedConfig = normalizeFeedbackConfig(config);
  const allSignals = FEEDBACK_SIGNAL_CATEGORIES.flatMap((category) => (state?.signals?.[category] ?? []).map((signal) => ({ ...signal, category })));
  return {
    schemaVersion: 1,
    policyVersion: normalizedConfig.policyVersion,
    feedback: {
      enabled: normalizedConfig.enabled,
      applyToPublishedRanking: normalizedConfig.applyToPublishedRanking,
      publicationApplication: 'not wired in this branch'
    },
    validRecordCount: state?.validRecordCount ?? 0,
    activeFeedbackCount: state?.activeFeedbackCount ?? 0,
    revokedCount: state?.revokedCount ?? 0,
    malformedCount: state?.malformedCount ?? 0,
    outcomesByStatus: state?.outcomesByStatus ?? Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, 0])),
    eligibleSignals: allSignals.filter((signal) => signal.eligible),
    ineligibleSignals: allSignals.filter((signal) => !signal.eligible),
    shadowCandidateCount: simulation?.candidateCount ?? 0,
    shadowRankingDiffs: simulation?.shadowRankingDiffs ?? [],
    shadowEvaluations: simulation?.evaluations ?? [],
    potentialOverviewChanges: simulation?.overview?.potentialChanges ?? [],
    overview: simulation?.overview ?? emptyOverviewSimulation(),
    capUsage: simulation?.capUsage ?? { capAppliedCount: 0, cappedMagnitude: 0, maxTotalAdjustment: normalizedConfig.maxTotalAdjustment },
    titleSnapshotMismatches: simulation?.titleSnapshotMismatches ?? [],
    unmatchedActiveFeedbackIds: simulation?.unmatchedActiveFeedbackIds ?? [],
    recordsIgnored: state?.ignored ?? []
  };
}

export function applyFeedbackAdjustmentsToCandidates(candidates, simulation, config = normalizeFeedbackConfig({})) {
  const normalizedConfig = normalizeFeedbackConfig(config);
  if (!normalizedConfig.enabled || !normalizedConfig.applyToPublishedRanking) return candidates;
  const evaluations = new Map((simulation?.evaluations ?? []).map((evaluation) => [evaluation.canonicalEventId, evaluation]));
  return candidates.map((candidate) => {
    const evaluation = evaluations.get(candidate.id);
    if (!evaluation?.thresholdMet || evaluation.blockedByHardExclusion || evaluation.proposedAdjustment === 0 || !candidate.ranking || !Number.isFinite(evaluation.proposedFinalScore)) return candidate;
    return {
      ...candidate,
      ranking: {
        ...candidate.ranking,
        utility: evaluation.proposedFinalScore
      }
    };
  });
}

async function writeAtomicText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
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

function evidenceEntries(record) {
  const snapshot = record.evidenceSnapshot;
  const entries = [];
  for (const id of snapshot.canonicalArtistIds) entries.push({ category: 'artist', id });
  if (snapshot.canonicalVenueId) entries.push({ category: 'venue', id: snapshot.canonicalVenueId });
  for (const id of snapshot.promoterOrSeriesIds) entries.push({ category: 'promoterOrSeries', id });
  const eventShape = normalizeEventShape(snapshot.eventShape);
  if (eventShape) entries.push({ category: 'eventShape', id: eventShape });
  return entries;
}

function summarizeSignal(category, id, records, config) {
  const positiveStatuses = new Set(['attended-worth-it', 'skipped-still-interested']);
  const attendedStatuses = new Set(['attended-worth-it', 'attended-not-worth-it']);
  let positiveWeight = 0;
  let negativeWeight = 0;
  const eventIds = new Set();
  const attendedEventIds = new Set();
  const statusCounts = Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, 0]));
  for (const record of records) {
    eventIds.add(record.canonicalEventId);
    statusCounts[record.status] += 1;
    if (positiveStatuses.has(record.status)) positiveWeight += config.weights[record.status];
    else negativeWeight += config.weights[record.status];
    if (attendedStatuses.has(record.status)) attendedEventIds.add(record.canonicalEventId);
  }
  const totalWeight = positiveWeight + negativeWeight;
  const direction = positiveWeight === negativeWeight ? 'neutral' : positiveWeight > negativeWeight ? 'positive' : 'negative';
  const dominantWeight = Math.max(positiveWeight, negativeWeight);
  const dominantFraction = totalWeight ? dominantWeight / totalWeight : 0;
  const margin = Math.abs(positiveWeight - negativeWeight);
  const threshold = config.thresholds[category];
  const checks = [
    [eventIds.size >= threshold.minIndependentEvents, 'insufficient independent event outcomes'],
    [attendedEventIds.size >= threshold.minAttendedEvents, 'insufficient attended outcomes'],
    [totalWeight >= threshold.minEffectiveWeight, 'insufficient effective evidence weight'],
    [dominantFraction >= threshold.minDominantFraction, 'mixed evidence is below the confidence fraction'],
    [margin >= threshold.minMargin, 'evidence margin is below the confidence threshold'],
    [direction !== 'neutral', 'positive and negative evidence are balanced']
  ];
  const failedCheck = checks.find(([passed]) => !passed);
  const eligible = !failedCheck;
  return {
    category,
    id,
    eventIds: [...eventIds].sort(),
    feedbackIds: records.map((record) => record.feedbackId).sort(),
    statusCounts,
    totalOutcomes: records.length,
    attendedOutcomes: attendedEventIds.size,
    positiveWeight: round(positiveWeight),
    negativeWeight: round(negativeWeight),
    totalWeight: round(totalWeight),
    direction,
    dominantFraction: round(dominantFraction),
    margin: round(margin),
    mixedEvidence: positiveWeight > 0 && negativeWeight > 0,
    mostRecentOutcomeDate: latest(records.map((record) => record.eventDateLocal)),
    mostRecentRecordedAt: latest(records.map((record) => record.recordedAt)),
    eligible,
    adjustment: eligible ? round((direction === 'positive' ? 1 : -1) * config.adjustments[category]) : 0,
    eligibilityReason: eligible ? 'threshold met' : failedCheck[1]
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
    const positive = eventRecords.filter((record) => ['attended-worth-it', 'skipped-still-interested'].includes(record.status)).length;
    const negative = eventRecords.length - positive;
    const first = eventRecords[0];
    return {
      canonicalEventId,
      feedbackIds: eventRecords.map((record) => record.feedbackId).sort(),
      eventDateLocal: first.eventDateLocal,
      eventTitleSnapshot: first.eventTitleSnapshot,
      evidenceSnapshot: first.evidenceSnapshot,
      statuses,
      mixedEvidence: positive > 0 && negative > 0,
      mostRecentOutcomeDate: latest(eventRecords.map((record) => record.eventDateLocal)),
      mostRecentRecordedAt: latest(eventRecords.map((record) => record.recordedAt))
    };
  }).sort((left, right) => left.canonicalEventId.localeCompare(right.canonicalEventId));
}

function projectionCandidates(projection) {
  const pools = [
    ['music', Array.isArray(projection.events) ? projection.events : []],
    ['sports', Array.isArray(projection.sports) ? projection.sports : []],
    ['movies', Array.isArray(projection.movies) ? projection.movies : []]
  ];
  const seen = new Set();
  const candidates = [];
  for (const [vertical, items] of pools) {
    for (const item of items) {
      const id = firstText(item?.canonicalEventId, item?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const snapshot = snapshotFeedbackEvent(item, { allowMissing: true });
      const baselineScore = baselineScoreFor(item);
      candidates.push({
        vertical,
        id,
        item,
        snapshot,
        baselineScore,
        startLocal: firstText(item?.startLocal, item?.releaseDate),
        snapshotError: snapshot.missing.length ? snapshot.missing : null
      });
    }
  }
  return candidates;
}

function evaluateCandidate(candidate, signalIndex, activeRecords, config) {
  const snapshot = candidate.snapshot;
  const categoryIds = {
    artist: snapshot.evidenceSnapshot.canonicalArtistIds,
    venue: snapshot.evidenceSnapshot.canonicalVenueId ? [snapshot.evidenceSnapshot.canonicalVenueId] : [],
    promoterOrSeries: snapshot.evidenceSnapshot.promoterOrSeriesIds,
    eventShape: normalizeEventShape(snapshot.evidenceSnapshot.eventShape) ? [normalizeEventShape(snapshot.evidenceSnapshot.eventShape)] : []
  };
  const categoryEffects = [];
  for (const category of FEEDBACK_SIGNAL_CATEGORIES) {
    const signal = chooseStrongestSignal(categoryIds[category], category, signalIndex);
    if (!signal) continue;
    categoryEffects.push({
      category,
      entityId: signal.id,
      adjustment: signal.adjustment,
      eligible: signal.eligible,
      mixedEvidence: signal.mixedEvidence,
      eligibilityReason: signal.eligibilityReason,
      supportingActiveFeedbackIds: signal.feedbackIds
    });
  }
  const thresholdMet = categoryEffects.some((effect) => effect.eligible && effect.adjustment !== 0);
  const rawAdjustment = thresholdMet ? categoryEffects.filter((effect) => effect.eligible).reduce((sum, effect) => sum + effect.adjustment, 0) : 0;
  const blockedByHardExclusion = Boolean(candidate.item?.ranking?.excluded);
  const unclampedAdjustment = blockedByHardExclusion ? 0 : rawAdjustment;
  const proposedAdjustment = clamp(unclampedAdjustment, -config.maxTotalAdjustment, config.maxTotalAdjustment);
  const baselineScore = Number.isFinite(candidate.baselineScore) ? round(candidate.baselineScore) : null;
  const proposedFinalScore = baselineScore == null ? null : round(baselineScore + proposedAdjustment);
  const snapshotMismatchFeedbackIds = activeRecords
    .filter((record) => record.canonicalEventId === candidate.id && (
      record.eventTitleSnapshot !== snapshot.eventTitleSnapshot || record.eventDateLocal !== snapshot.eventDateLocal
    ))
    .map((record) => record.feedbackId)
    .sort();
  const categories = categoryEffects.filter((effect) => effect.eligible && effect.adjustment !== 0).map((effect) => effect.category);
  return {
    vertical: candidate.vertical,
    canonicalEventId: candidate.id,
    baselineScore,
    proposedAdjustment,
    proposedFinalScore,
    rawAdjustment,
    capApplied: proposedAdjustment !== unclampedAdjustment,
    thresholdMet,
    blockedByHardExclusion,
    evidenceCategory: categories.length === 0 ? 'none' : categories.length === 1 ? categories[0] : 'multiple',
    evidenceCategories: categories,
    supportingActiveFeedbackIds: [...new Set(categoryEffects.filter((effect) => effect.eligible).flatMap((effect) => effect.supportingActiveFeedbackIds))].sort(),
    categoryEffects,
    snapshotMismatchFeedbackIds,
    snapshotError: candidate.snapshotError,
    baselineRank: null,
    proposedRank: null,
    rankChanged: false
  };
}

function assignRanks(evaluations) {
  const groups = new Map();
  for (const evaluation of evaluations) {
    if (evaluation.baselineScore == null) continue;
    const group = groups.get(evaluation.vertical) ?? [];
    group.push(evaluation);
    groups.set(evaluation.vertical, group);
  }
  for (const group of groups.values()) {
    const baselineOrder = [...group].sort(scoreComparator((evaluation) => evaluation.baselineScore));
    baselineOrder.forEach((evaluation, index) => { evaluation.baselineRank = index + 1; });
    const proposedOrder = [...group].sort((left, right) => {
      const scoreDelta = (right.proposedFinalScore ?? right.baselineScore) - (left.proposedFinalScore ?? left.baselineScore);
      return scoreDelta || left.baselineRank - right.baselineRank;
    });
    proposedOrder.forEach((evaluation, index) => {
      evaluation.proposedRank = index + 1;
      evaluation.rankChanged = evaluation.proposedRank !== evaluation.baselineRank;
    });
  }
  return evaluations;
}

function simulateOverview(projection, evaluations, { now = null, planAheadMinScore = 55 } = {}) {
  const current = Array.isArray(projection.overview) ? projection.overview : [];
  const currentPlanAhead = Array.isArray(projection.overviewPlanAhead) ? projection.overviewPlanAhead : [];
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.canonicalEventId, evaluation]));
  const applyScore = (item) => {
    const evaluation = evaluationById.get(item.id);
    if (!evaluation || evaluation.proposedFinalScore == null || !item.ranking) return item;
    return { ...item, ranking: { ...item.ranking, utility: evaluation.proposedFinalScore } };
  };
  const proposedBuckets = buildOverviewBuckets(
    (projection.events ?? []).map(applyScore),
    (projection.sports ?? []).map(applyScore),
    {
      now: validDate(now) ? new Date(now) : validDate(projection.generatedAt) ? new Date(projection.generatedAt) : new Date(0),
      currentDays: 14,
      planAheadMinScore,
      horizonDays: Number.isFinite(projection.horizon?.days) ? projection.horizon.days : null
    }
  );
  const currentMembership = membershipMap(current, currentPlanAhead);
  const proposedMembership = membershipMap(proposedBuckets.current, proposedBuckets.planAhead);
  const ids = [...new Set([...currentMembership.keys(), ...proposedMembership.keys()])].sort();
  const potentialChanges = ids
    .map((id) => ({ id, from: currentMembership.get(id) ?? null, to: proposedMembership.get(id) ?? null }))
    .filter((change) => change.from !== change.to);
  return {
    currentIds: current.map((item) => item.id).filter(Boolean),
    currentPlanAheadIds: currentPlanAhead.map((item) => item.id).filter(Boolean),
    proposedIds: proposedBuckets.current.map((item) => item.id).filter(Boolean),
    proposedPlanAheadIds: proposedBuckets.planAhead.map((item) => item.id).filter(Boolean),
    potentialChanges
  };
}

function buildSignalIndex(signals) {
  const index = new Map();
  for (const category of FEEDBACK_SIGNAL_CATEGORIES) {
    for (const signal of signals[category] ?? []) index.set(`${category}:${signal.id}`, signal);
  }
  return index;
}

function chooseStrongestSignal(ids, category, index) {
  return ids
    .map((id) => index.get(`${category}:${id}`))
    .filter((signal) => signal?.eligible)
    .sort((left, right) => Math.abs(right.adjustment) - Math.abs(left.adjustment) || left.id.localeCompare(right.id))[0] ?? null;
}

function toShadowDiff(evaluation) {
  return {
    canonicalEventId: evaluation.canonicalEventId,
    vertical: evaluation.vertical,
    baselineScore: evaluation.baselineScore,
    proposedAdjustment: evaluation.proposedAdjustment,
    proposedFinalScore: evaluation.proposedFinalScore,
    evidenceCategory: evaluation.evidenceCategory,
    evidenceCategories: evaluation.evidenceCategories,
    supportingActiveFeedbackIds: evaluation.supportingActiveFeedbackIds,
    thresholdMet: evaluation.thresholdMet,
    capApplied: evaluation.capApplied,
    blockedByHardExclusion: evaluation.blockedByHardExclusion,
    baselineRank: evaluation.baselineRank,
    proposedRank: evaluation.proposedRank,
    rankChanged: evaluation.rankChanged
  };
}

function membershipMap(current, planAhead) {
  const map = new Map();
  for (const item of current) if (item?.id) map.set(item.id, 'current');
  for (const item of planAhead) if (item?.id && !map.has(item.id)) map.set(item.id, 'plan-ahead');
  return map;
}

function baselineScoreFor(item) {
  const value = item?.ranking?.utility ?? item?.tasteScore ?? item?.candidateScore;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function scoreComparator(getScore) {
  return (left, right) => {
    const delta = getScore(right) - getScore(left);
    if (delta) return delta;
    return String(left.canonicalEventId).localeCompare(String(right.canonicalEventId));
  };
}

function redactRecord(record) {
  const { notes: _notes, ...safe } = record;
  return safe;
}

function safeFeedbackIds(ids) {
  return ids.filter((id) => safeText(id, 200));
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

function normalizeEventShape(value) {
  const normalized = normalizeArtistName(value);
  return normalized || null;
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

function latest(values) {
  return values.filter(Boolean).sort((left, right) => String(right).localeCompare(String(left)))[0] ?? null;
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

function emptyOverviewSimulation() {
  return { currentIds: [], currentPlanAheadIds: [], proposedIds: [], proposedPlanAheadIds: [], potentialChanges: [] };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
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

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be greater than zero`);
  return number;
}

function positiveInteger(value, name) {
  const number = positiveNumber(value, name);
  if (!Number.isInteger(number)) throw new Error(`${name} must be an integer`);
  return number;
}

function fractionValue(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1) throw new Error(`${name} must be greater than zero and at most one`);
  return number;
}
