import {
  digestValue,
  normalizeProjectionForComparison,
  sanitizeDiagnosticString,
  sanitizePublicUrl
} from './diagnostics.js';

const REQUIRED_FIELDS = [
  'schemaVersion', 'generatedAt', 'horizon', 'events', 'sports', 'movies',
  'sourceHealth', 'overview', 'overviewPlanAhead'
];

export function diffProjections(before, after, {
  maxAdded = null,
  maxRemoved = null,
  maxCountChange = null
} = {}) {
  const beforeNormalized = normalizeProjectionForComparison(before ?? {});
  const afterNormalized = normalizeProjectionForComparison(after ?? {});
  const beforeRecords = collectRecords(beforeNormalized);
  const afterRecords = collectRecords(afterNormalized);
  const beforeKeys = new Set(beforeRecords.keys());
  const afterKeys = new Set(afterRecords.keys());
  const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).map((key) => idRecord(afterRecords.get(key))).sort(recordComparator);
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key)).map((key) => idRecord(beforeRecords.get(key))).sort(recordComparator);

  const rankChanges = compareRanks(beforeNormalized, afterNormalized);
  const scoreChanges = compareFields(beforeRecords, afterRecords, scoreFor, ['score']);
  const advisoryChanges = compareFields(beforeRecords, afterRecords, advisoryFor, ['confidence', 'urgency', 'hassle']);
  const contentChanges = {
    title: compareTextFields(beforeRecords, afterRecords, (record) => record.item?.title),
    whyYou: compareTextFields(beforeRecords, afterRecords, (record) => record.item?.ranking?.whyYou ?? record.item?.whyYou)
  };

  const overview = {
    current: compareMembership(beforeNormalized.overview, afterNormalized.overview),
    planAhead: compareMembership(beforeNormalized.overviewPlanAhead, afterNormalized.overviewPlanAhead)
  };
  const sourceLinkChanges = compareSourceLinks(beforeRecords, afterRecords);
  const sourceHealthChanges = compareSourceHealth(beforeNormalized.sourceHealth, afterNormalized.sourceHealth);
  const visualContractChanges = compareVisuals(beforeRecords, afterRecords);
  const canonicalIdentity = compareCanonicalIdentity(beforeRecords, afterRecords);
  const unexpectedFields = compareFieldShapes(beforeNormalized, afterNormalized);
  const schema = {
    before: beforeNormalized.schemaVersion ?? null,
    after: afterNormalized.schemaVersion ?? null,
    changed: beforeNormalized.schemaVersion !== afterNormalized.schemaVersion,
    missingRequiredBefore: REQUIRED_FIELDS.filter((field) => !Object.hasOwn(beforeNormalized, field)),
    missingRequiredAfter: REQUIRED_FIELDS.filter((field) => !Object.hasOwn(afterNormalized, field))
  };
  const structuralIncompatibility = schema.changed
    || schema.missingRequiredBefore.length > 0
    || schema.missingRequiredAfter.length > 0
    || unexpectedFields.removed.length > 0;
  const counts = compareCounts(beforeNormalized, afterNormalized);
  const thresholds = evaluateThresholds(counts, added.length, removed.length, { maxAdded, maxRemoved, maxCountChange });

  return {
    diffVersion: 1,
    schema,
    candidates: { added, removed, counts },
    canonicalIdentity,
    rankChanges,
    scoreChanges,
    advisoryChanges,
    overview,
    contentChanges,
    sourceLinkChanges,
    sourceHealthChanges,
    visualContractChanges,
    unexpectedFields,
    thresholds,
    structurallyCompatible: !structuralIncompatibility,
    exitCode: structuralIncompatibility || thresholds.exceeded ? 2 : 0
  };
}

export function formatProjectionDiff(diff) {
  const lines = [
    'Taste Engine projection diff',
    `Schema: ${diff.schema.before ?? 'missing'} → ${diff.schema.after ?? 'missing'}${diff.schema.changed ? ' (incompatible)' : ''}`,
    `Candidates: +${diff.candidates.added.length} / -${diff.candidates.removed.length}`,
    `Rank changes: ${diff.rankChanges.length}; score changes: ${diff.scoreChanges.length}; advisory changes: ${diff.advisoryChanges.length}`,
    `Overview current: ${membershipSummary(diff.overview.current)}; Plan Ahead: ${membershipSummary(diff.overview.planAhead)}`,
    `Title changes: ${diff.contentChanges.title.length}; whyYou changes: ${diff.contentChanges.whyYou.length}`,
    `Source-link changes: ${diff.sourceLinkChanges.length}; source-health changes: ${diff.sourceHealthChanges.length}`,
    `Visual-contract changes: ${diff.visualContractChanges.length}`,
    `Canonical merges: ${diff.canonicalIdentity.merges.length}; splits: ${diff.canonicalIdentity.splits.length}`,
    `Unexpected fields: +${diff.unexpectedFields.added.length} / -${diff.unexpectedFields.removed.length}`,
    diff.thresholds.exceeded ? `Thresholds: exceeded (${diff.thresholds.reasons.join(', ')})` : 'Thresholds: within configured limits',
    diff.structurallyCompatible ? 'Compatibility: compatible' : 'Compatibility: structurally incompatible'
  ];
  if (diff.candidates.added.length) lines.push(`Added: ${diff.candidates.added.map(formatId).join(', ')}`);
  if (diff.candidates.removed.length) lines.push(`Removed: ${diff.candidates.removed.map(formatId).join(', ')}`);
  if (diff.rankChanges.length) lines.push(`Rank movement: ${diff.rankChanges.map((item) => `${formatId(item)} ${item.beforeRank}→${item.afterRank}`).join(', ')}`);
  return `${lines.join('\n')}\n`;
}

function collectRecords(projection) {
  const records = new Map();
  for (const collection of ['events', 'sports', 'movies']) {
    for (const [index, item] of (projection[collection] ?? []).entries()) {
      if (!item?.id) continue;
      records.set(`${collection}:${item.id}`, { collection, vertical: collection, id: String(item.id), rank: index + 1, item });
    }
  }
  return records;
}

function compareRanks(before, after) {
  const changes = [];
  for (const collection of ['events', 'sports', 'movies']) {
    const beforeRank = new Map((before[collection] ?? []).map((item, index) => [String(item?.id), index + 1]));
    const afterRank = new Map((after[collection] ?? []).map((item, index) => [String(item?.id), index + 1]));
    for (const id of [...beforeRank.keys()].filter((key) => afterRank.has(key)).sort()) {
      if (beforeRank.get(id) !== afterRank.get(id)) changes.push({ vertical: collection, id: safeId(id), beforeRank: beforeRank.get(id), afterRank: afterRank.get(id) });
    }
  }
  return changes.sort(recordComparator);
}

function compareFields(beforeRecords, afterRecords, getter, fields) {
  const changes = [];
  for (const key of [...beforeRecords.keys()].filter((recordKey) => afterRecords.has(recordKey)).sort()) {
    const before = getter(beforeRecords.get(key));
    const after = getter(afterRecords.get(key));
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const record = beforeRecords.get(key);
    changes.push({ vertical: record.vertical, id: safeId(record.id), before, after, fields });
  }
  return changes.sort(recordComparator);
}

function compareTextFields(beforeRecords, afterRecords, getter) {
  const changes = [];
  for (const key of [...beforeRecords.keys()].filter((recordKey) => afterRecords.has(recordKey)).sort()) {
    const before = getter(beforeRecords.get(key));
    const after = getter(afterRecords.get(key));
    if (before === after) continue;
    const record = beforeRecords.get(key);
    changes.push({
      vertical: record.vertical,
      id: safeId(record.id),
      before: safeTextSummary(before),
      after: safeTextSummary(after)
    });
  }
  return changes.sort(recordComparator);
}

function compareSourceLinks(beforeRecords, afterRecords) {
  const changes = [];
  for (const key of [...beforeRecords.keys()].filter((recordKey) => afterRecords.has(recordKey)).sort()) {
    const before = sourceLinks(beforeRecords.get(key).item);
    const after = sourceLinks(afterRecords.get(key).item);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const record = beforeRecords.get(key);
    changes.push({ vertical: record.vertical, id: safeId(record.id), before, after });
  }
  return changes.sort(recordComparator);
}

function compareSourceHealth(before = [], after = []) {
  const beforeMap = new Map((before ?? []).map((item) => [String(item?.source), item]));
  const afterMap = new Map((after ?? []).map((item) => [String(item?.source), item]));
  const changes = [];
  for (const source of [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()) {
    const left = beforeMap.get(source) ?? null;
    const right = afterMap.get(source) ?? null;
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    const fields = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])]
      .filter((field) => JSON.stringify(left?.[field]) !== JSON.stringify(right?.[field]))
      .sort();
    changes.push({ source: safeId(source), fields, before: healthSummary(left), after: healthSummary(right) });
  }
  return changes;
}

function compareVisuals(beforeRecords, afterRecords) {
  const changes = [];
  for (const key of [...beforeRecords.keys()].filter((recordKey) => afterRecords.has(recordKey)).sort()) {
    const before = visualSummary(beforeRecords.get(key).item?.visual);
    const after = visualSummary(afterRecords.get(key).item?.visual);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const record = beforeRecords.get(key);
    changes.push({ vertical: record.vertical, id: safeId(record.id), before, after });
  }
  return changes.sort(recordComparator);
}

function compareCanonicalIdentity(beforeRecords, afterRecords) {
  const beforeIndex = occurrenceIndex(beforeRecords);
  const afterIndex = occurrenceIndex(afterRecords);
  const merges = [];
  for (const [afterId, record] of afterRecords) {
    const related = new Set();
    for (const token of occurrenceTokens(record.item)) {
      for (const beforeId of beforeIndex.get(token) ?? []) {
        if (beforeId !== afterId) related.add(beforeId);
      }
    }
    if (related.size >= 2) merges.push({ after: safeId(record.id), before: [...related].map(safeId).sort() });
  }
  const splits = [];
  for (const [beforeId, record] of beforeRecords) {
    const related = new Set();
    for (const token of occurrenceTokens(record.item)) {
      for (const afterId of afterIndex.get(token) ?? []) {
        if (afterId !== beforeId) related.add(afterId);
      }
    }
    if (related.size >= 2) splits.push({ before: safeId(record.id), after: [...related].map(safeId).sort() });
  }
  return { merges: merges.sort((left, right) => left.after.localeCompare(right.after)), splits: splits.sort((left, right) => left.before.localeCompare(right.before)) };
}

function occurrenceIndex(records) {
  const index = new Map();
  for (const [recordKey, record] of records) {
    for (const token of occurrenceTokens(record.item)) {
      const ids = index.get(token) ?? new Set();
      ids.add(recordKey);
      index.set(token, ids);
    }
  }
  return index;
}

function occurrenceTokens(item = {}) {
  const tokens = [];
  for (const occurrence of item.sourceOccurrences ?? []) {
    if (occurrence.source && occurrence.sourceEventId) tokens.push(`${occurrence.source}|${occurrence.sourceEventId}`);
  }
  for (const link of item.sourceLinks ?? []) {
    if (link.source && link.url) tokens.push(`${link.source}|${sanitizePublicUrl(link.url)}`);
  }
  if (item.source && item.sourceEventId) tokens.push(`${item.source}|${item.sourceEventId}`);
  return [...new Set(tokens)].sort();
}

function compareMembership(before = [], after = []) {
  const beforeIds = (before ?? []).map((item) => String(item?.id)).filter(Boolean);
  const afterIds = (after ?? []).map((item) => String(item?.id)).filter(Boolean);
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const orderChanges = beforeIds
    .filter((id) => afterSet.has(id) && beforeIds.indexOf(id) !== afterIds.indexOf(id))
    .map((id) => ({ id: safeId(id), beforeRank: beforeIds.indexOf(id) + 1, afterRank: afterIds.indexOf(id) + 1 }))
    .sort(recordComparator);
  return {
    before: beforeIds.map(safeId),
    after: afterIds.map(safeId),
    added: afterIds.filter((id) => !beforeSet.has(id)).map(safeId).sort(),
    removed: beforeIds.filter((id) => !afterSet.has(id)).map(safeId).sort(),
    orderChanges
  };
}

function compareCounts(before, after) {
  return Object.fromEntries(['events', 'sports', 'movies'].map((collection) => {
    const left = before[collection]?.length ?? 0;
    const right = after[collection]?.length ?? 0;
    return [collection, { before: left, after: right, delta: right - left }];
  }));
}

function evaluateThresholds(counts, added, removed, { maxAdded, maxRemoved, maxCountChange }) {
  const reasons = [];
  if (maxAdded != null && added > maxAdded) reasons.push(`added>${maxAdded}`);
  if (maxRemoved != null && removed > maxRemoved) reasons.push(`removed>${maxRemoved}`);
  if (maxCountChange != null) {
    for (const [collection, count] of Object.entries(counts)) {
      const ratio = Math.abs(count.delta) / Math.max(1, count.before);
      if (ratio > maxCountChange) reasons.push(`${collection}>${maxCountChange}`);
    }
  }
  return { maxAdded, maxRemoved, maxCountChange, exceeded: reasons.length > 0, reasons };
}

function compareFieldShapes(before, after) {
  const left = collectFieldShape(before);
  const right = collectFieldShape(after);
  return {
    added: [...right].filter((path) => !left.has(path)).sort(),
    removed: [...left].filter((path) => !right.has(path)).sort()
  };
}

function collectFieldShape(value, path = [], output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldShape(item, [...path, '[]'], output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const key of Object.keys(value).sort()) {
    const next = [...path, key];
    output.add(next.join('.'));
    collectFieldShape(value[key], next, output);
  }
  return output;
}

function scoreFor(record) {
  const item = record.item ?? {};
  return item.ranking?.utility ?? item.tasteScore ?? item.candidateScore ?? item.score ?? null;
}

function advisoryFor(record) {
  const item = record.item ?? {};
  return {
    confidence: item.ranking?.confidence ?? null,
    urgency: item.ranking?.urgency ?? item.urgency ?? null,
    hassle: item.ranking?.hassleScore ?? item.hassle ?? null
  };
}

function sourceLinks(item = {}) {
  return (item.sourceLinks ?? []).map((link) => ({ source: safeId(link.source), url: sanitizePublicUrl(link.url) }))
    .sort((left, right) => `${left.source}|${left.url}`.localeCompare(`${right.source}|${right.url}`));
}

function visualSummary(visual) {
  if (!visual || typeof visual !== 'object') return null;
  return {
    kind: visual.kind ?? null,
    variant: visual.variant ?? null,
    attribution: visual.attribution ?? null,
    url: sanitizePublicUrl(visual.url)
  };
}

function healthSummary(value) {
  if (!value) return null;
  return {
    status: value.status ?? null,
    itemCount: value.itemCount ?? null,
    warningCount: value.warningCount ?? null,
    details: value.details ? Object.fromEntries(Object.keys(value.details).sort().map((key) => [key, value.details[key] == null ? null : '[PRESENT]'])) : undefined
  };
}

function safeTextSummary(value) {
  const text = sanitizeDiagnosticString(value ?? '');
  return { digest: digestValue(text), length: text.length, preview: text.slice(0, 160) };
}

function idRecord(record) {
  return { vertical: record.vertical, id: safeId(record.id) };
}

function safeId(value) {
  return sanitizeDiagnosticString(String(value ?? '')).slice(0, 160);
}

function recordComparator(left, right) {
  return `${left.vertical ?? ''}|${left.id ?? left.source ?? left.after ?? left.before ?? ''}`.localeCompare(`${right.vertical ?? ''}|${right.id ?? right.source ?? right.after ?? right.before ?? ''}`);
}

function formatId(item) {
  return `${item.vertical}:${item.id}`;
}

function membershipSummary(value) {
  return `+${value.added.length}/-${value.removed.length}, ${value.orderChanges.length} order change${value.orderChanges.length === 1 ? '' : 's'}`;
}
