import { digestValue } from '../diagnostics.js';

/**
 * A candidate's revision. Any change to the facts an assessment was made
 * against — time, status, which providers back it, where it is — invalidates
 * the cached decision.
 */
export function candidateRevision(candidate) {
  return digestValue({
    startLocal: candidate.startLocal ?? null,
    timeTbd: Boolean(candidate.timeTbd),
    status: candidate.status ?? null,
    venue: candidate.venue?.name ?? null,
    sources: [...new Set((candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.source))].sort(),
    sourceEventIds: (candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.sourceEventId ?? null).sort()
  });
}

/**
 * The cache key binds a decision to everything that could change it: the
 * candidate revision, the exact policy-safe input, the decision schema and
 * prompt versions, the provider route, and the user's request context.
 */
export function assessmentCacheKey({
  candidateRevision: revision,
  input,
  context,
  schemaVersion,
  promptVersion,
  provider,
  model
}) {
  return digestValue({ revision, input, context, schemaVersion, promptVersion, provider, model });
}

export function createAssessmentCache({ maxEntries = 500 } = {}) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return null;
      const value = entries.get(key);
      // Simple LRU: re-inserting moves the key to the end of the iteration order.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    },
    invalidate(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    }
  };
}
