import { createHash } from 'node:crypto';

const SENSITIVE_KEY = /(?:authorization|access.?token|api.?key|client.?id|cookie|credential|password|secret|token|private.?key|session)/i;
const OMITTED_KEY = /(?:raw|payload|request|response|body|headers|private|personal(?:.?note|.?context)|complete.?url)/i;
const TIMESTAMP_KEYS = new Set([
  'generatedAt', 'retrievedAt', 'observedAt', 'fetchedAt', 'expiresAt',
  'createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'lastSuccessfulRefresh',
  'cacheExpiry', 'lastUsableFreshness'
]);
const UNORDERED_ARRAY_KEYS = new Set([
  'sourceHealth', 'sourceLinks', 'sourceOccurrences', 'sources', 'warnings',
  'genres', 'tags', 'reasons', 'ticketObservations', 'decisionPreferences',
  'background'
]);
const UNSUPPORTED_CLAIMS = /\b(?:sell[ -]?out|scarcity|limited availability|access loss|loss of access|will disappear|tickets? (?:disappear|vanish)|become unavailable)\b/i;

export function createBuildReport({ now = new Date(), timezone = 'America/Los_Angeles', horizon = null } = {}) {
  return {
    reportVersion: 1,
    generatedAt: new Date(now).toISOString(),
    timezone,
    horizon,
    sources: {},
    resolution: {
      artists: {
        exactMatches: 0,
        aliasOrProviderMatches: 0,
        unresolved: 0
      },
      events: {
        confidentMerges: 0,
        ambiguousMatches: 0,
        rejectedNearMatches: 0,
        venueAliasUse: 0
      }
    },
    ranking: {
      directFitCount: 0,
      adjacentFitCount: 0,
      scoreDistribution: {},
      exclusionReasons: {},
      thresholdCounts: {},
      currentWindowEligibleCount: 0,
      planAheadEligibleCount: 0,
      overviewIds: [],
      planAheadIds: [],
      candidateTraces: {}
    },
    modelPasses: {
      callsAttempted: 0,
      callsCompleted: 0,
      timeouts: 0,
      malformedOutputs: 0,
      fallbackCount: 0,
      inputFieldManifest: [],
      restrictedProvenanceExcluded: true,
      passes: {}
    },
    timing: {
      stages: {},
      totalMs: null
    },
    redaction: {
      applied: true,
      omittedFields: [],
      sanitizedUrls: 0,
      sanitizedErrors: 0
    }
  };
}

export function recordBuildSource(report, source, details = {}) {
  if (!report || !source) return;
  report.sources[source] = {
    fetched: Boolean(details.fetched),
    cached: Boolean(details.cached),
    normalized: nonNegativeInteger(details.normalized),
    rejected: nonNegativeInteger(details.rejected),
    deduplicated: nonNegativeInteger(details.deduplicated),
    warningCount: nonNegativeInteger(details.warningCount),
    failureStatus: details.failureStatus ?? null,
    lastUsableFreshness: details.lastUsableFreshness ?? null,
    timingMs: finiteNonNegative(details.timingMs),
    status: details.status ?? null
  };
}

export function recordBuildStage(report, label, elapsedMs) {
  if (!report || !label) return;
  report.timing ??= { stages: {}, totalMs: null };
  report.timing.stages[label] = finiteNonNegative(elapsedMs);
}

export function finalizeBuildReport(report) {
  const sanitized = sanitizeDiagnosticValue(report, { normalizeTimestamps: false });
  if (sanitized && typeof sanitized === 'object') {
    sanitized.redaction ??= {};
    sanitized.redaction.applied = true;
  }
  return sanitized;
}

export function sanitizeDiagnosticValue(value, context = {}) {
  const path = context.path ?? [];
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeDiagnosticString(value, context);
  if (Array.isArray(value)) {
    const mapped = value.map((item, index) => sanitizeDiagnosticValue(item, { ...context, path: [...path, String(index)] }));
    return context.sortArray ? sortStable(mapped) : mapped;
  }
  if (typeof value !== 'object') return String(value);

  const output = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    if (OMITTED_KEY.test(key)) {
      output[key] = '[OMITTED BY DIAGNOSTICS POLICY]';
      continue;
    }
    const child = value[key];
    const childContext = {
      ...context,
      path: [...path, key],
      sortArray: UNORDERED_ARRAY_KEYS.has(key)
    };
    if (TIMESTAMP_KEYS.has(key) && context.normalizeTimestamps) {
      output[key] = typeof child === 'string' && child ? '[TIMESTAMP]' : child;
    } else if (/url$/i.test(key) || key === 'url') {
      output[key] = sanitizePublicUrl(child);
    } else {
      output[key] = sanitizeDiagnosticValue(child, childContext);
    }
  }
  return output;
}

export function sanitizeDiagnosticString(value, context = {}) {
  let output = String(value ?? '');
  if (!output) return output;
  output = output
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:access[_-]?token|api[_-]?key|client[_-]?id|secret|password|token))=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s)]+/gi, (url) => sanitizePublicUrl(url));
  if (UNSUPPORTED_CLAIMS.test(output) && context.kind === 'model-error') return 'unsupported scarcity claim';
  return output.slice(0, 500);
}

export function sanitizeErrorMessage(error) {
  return sanitizeDiagnosticString(error?.message ?? String(error ?? ''), { kind: 'model-error' });
}

export function sanitizePublicUrl(value) {
  if (value == null || value === '') return value == null ? null : '';
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[URL REDACTED]';
  }
}

export function sanitizePromptContext(personalContext = {}) {
  return {
    background: safePromptStrings(personalContext.background),
    decisionPreferences: safePromptStrings(personalContext.decisionPreferences)
  };
}

export function promptFieldManifest(value) {
  const fields = new Set();
  collectFieldPaths(value, [], fields);
  return [...fields].sort((left, right) => left.localeCompare(right));
}

export function containsUnsupportedModelClaim(value) {
  if (typeof value === 'string') return UNSUPPORTED_CLAIMS.test(value);
  if (Array.isArray(value)) return value.some(containsUnsupportedModelClaim);
  if (value && typeof value === 'object') return Object.values(value).some(containsUnsupportedModelClaim);
  return false;
}

export function normalizeProjectionForComparison(value, path = []) {
  if (Array.isArray(value)) {
    const key = path.at(-1);
    const normalized = value.map((item, index) => normalizeProjectionForComparison(item, [...path, String(index)]));
    return UNORDERED_ARRAY_KEYS.has(key) ? sortStable(normalized) : normalized;
  }
  if (value == null || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    output[key] = TIMESTAMP_KEYS.has(key)
      ? (typeof value[key] === 'string' && value[key] ? '[TIMESTAMP]' : value[key])
      : normalizeProjectionForComparison(value[key], [...path, key]);
  }
  return output;
}

export function stableJson(value, space = 2) {
  return `${JSON.stringify(normalizeProjectionForComparison(value), null, space)}\n`;
}

export function digestValue(value) {
  return createHash('sha256').update(JSON.stringify(normalizeProjectionForComparison(value))).digest('hex');
}

export function buildCandidateTrace(candidate, {
  vertical = 'music',
  currentOverviewIds = [],
  planAheadIds = [],
  model = null
} = {}) {
  const ranking = candidate?.ranking ?? {};
  return sanitizeDiagnosticValue({
    id: candidate?.id ?? null,
    vertical,
    sourceOccurrences: (candidate?.sourceOccurrences ?? []).map((occurrence) => ({
      source: occurrence.source ?? null,
      date: String(occurrence.startLocal ?? candidate?.startLocal ?? '').slice(0, 10) || null,
      venuePresent: Boolean(occurrence.venue?.name ?? candidate?.venue?.name),
      publicUrl: occurrence.sourceUrl ?? null
    })),
    identity: {
      matchedArtists: (candidate?.matchedArtists ?? []).map((artist) => ({
        name: artist.name ?? null,
        origin: artist.origin ?? 'source',
        matchMethod: artist.matchMethod ?? 'unknown',
        primary: artist.primary === true
      })),
      unresolvedPerformers: (candidate?.performers ?? [])
        .filter((performer) => !(candidate?.matchedArtists ?? []).some((artist) => artist.name === performer.name))
        .map((performer) => ({ name: performer.name ?? null }))
    },
    tasteEvidence: {
      playlistAffinity: ranking.playlistAffinity ?? null,
      topItemsAffinity: ranking.topItemsAffinity ?? null,
      corroborationBonus: ranking.corroborationBonus ?? null,
      directAffinity: ranking.directAffinity ?? null
    },
    hassle: {
      score: ranking.hassleScore ?? null,
      reasons: ranking.hassleReasons ?? [],
      urgency: ranking.urgency ?? null
    },
    ranking: {
      artistFit: ranking.artistFit ?? null,
      pinnedBonus: ranking.pinnedBonus ?? null,
      utility: ranking.utility ?? null,
      confidence: ranking.confidence ?? null,
      excluded: ranking.excluded === true,
      whyYou: ranking.whyYou ?? null
    },
    eligibility: {
      currentOverview: currentOverviewIds.includes(candidate?.id),
      planAhead: planAheadIds.includes(candidate?.id)
    },
    model: model ? sanitizeDiagnosticValue(model) : null
  });
}

function safePromptStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').map((item) => String(item).slice(0, 500))
    : [];
}

function collectFieldPaths(value, path, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldPaths(item, [...path, '[]'], output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const next = [...path, key];
    output.add(next.join('.'));
    collectFieldPaths(value[key], next, output);
  }
}

function sortStable(items) {
  return [...items].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}
