import { normalizeNightlifeContext } from './context.js';

/**
 * Which context changes invalidate which assessments.
 *
 * A criteria revision should re-evaluate only what the change actually touches.
 * Asking for "somewhere closer" does not make the model's read of the music any
 * less valid, and re-running everything would be slower, costlier, and would
 * quietly churn answers the user had already seen.
 */
const DIMENSION_IMPACT = {
  goal: 'all',
  preferredMusic: ['music_fit', 'context_fit'],
  energy: ['music_fit', 'context_fit'],
  lateNightIntent: ['late_night_fit', 'context_fit'],
  noveltyAppetite: ['novelty', 'context_fit'],
  party: ['friction_coordination', 'context_fit'],
  startArea: ['friction_travel', 'context_fit'],
  transport: ['friction_travel'],
  budgetUsd: 'deterministic',
  window: ['friction_timing', 'late_night_fit', 'context_fit'],
  maxCandidates: 'deterministic',
  shortlistSize: 'deterministic'
};

/**
 * Apply a revision to an existing context.
 *
 * @returns {{context: object, changed: string[], reassessAll: boolean, deterministicOnly: boolean}}
 */
export function reviseCriteria(previousContext, revision = {}, { now = new Date() } = {}) {
  const merged = normalizeNightlifeContext({
    goal: revision.goal ?? previousContext.goal,
    date: revision.date ?? previousContext.window?.date,
    earliestStart: revision.earliestStart ?? previousContext.window?.earliestStart,
    latestReturn: revision.latestReturn ?? previousContext.window?.latestReturn,
    startArea: revision.startArea ?? previousContext.startArea,
    transport: revision.transport ?? previousContext.transport,
    budgetUsd: revision.budgetUsd ?? previousContext.budgetUsd,
    party: revision.party ?? previousContext.party,
    preferredMusic: revision.preferredMusic ?? previousContext.preferredMusic,
    energy: revision.energy ?? previousContext.energy,
    lateNightIntent: revision.lateNightIntent ?? previousContext.lateNightIntent,
    noveltyAppetite: revision.noveltyAppetite ?? previousContext.noveltyAppetite,
    maxCandidates: revision.maxCandidates ?? previousContext.maxCandidates,
    shortlistSize: revision.shortlistSize ?? previousContext.shortlistSize
  }, { now });

  const changed = changedDimensions(previousContext, merged);
  const impacts = changed.map((dimension) => DIMENSION_IMPACT[dimension] ?? 'all');
  return {
    context: merged,
    changed,
    reassessAll: impacts.includes('all'),
    // A budget or shortlist-size change is answered entirely by deterministic
    // re-filtering; no candidate needs re-assessing at all.
    deterministicOnly: changed.length > 0 && impacts.every((impact) => impact === 'deterministic')
  };
}

/**
 * Which candidate refs need a fresh assessment after a revision.
 *
 * Refs that were never covered are always included, so a revision is also the
 * natural moment to retry candidates an earlier partial failure left behind.
 */
export function refsToReassess(previousResult, revisionOutcome) {
  const allRefs = Object.keys(previousResult?.refIndex ?? {});
  if (revisionOutcome.deterministicOnly) return new Set();
  if (revisionOutcome.reassessAll) return new Set(allRefs);

  const covered = new Set([
    ...(previousResult?.shortlist ?? []),
    ...(previousResult?.alternatives ?? [])
  ].filter((entry) => entry.inferenceCovered).map((entry) => entry.ref));

  // Only the candidates whose scoring actually depends on a changed dimension,
  // plus anything the last run could not assess.
  const impacted = new Set(allRefs.filter((ref) => !covered.has(ref)));
  for (const dimension of revisionOutcome.changed) {
    const impact = DIMENSION_IMPACT[dimension];
    if (!Array.isArray(impact)) continue;
    for (const ref of allRefs) impacted.add(ref);
  }
  return impacted;
}

function changedDimensions(previous, next) {
  const changed = [];
  for (const key of ['goal', 'transport', 'budgetUsd', 'party', 'energy', 'lateNightIntent', 'noveltyAppetite', 'maxCandidates', 'shortlistSize']) {
    if (JSON.stringify(previous?.[key] ?? null) !== JSON.stringify(next?.[key] ?? null)) changed.push(key);
  }
  if (JSON.stringify(previous?.preferredMusic ?? []) !== JSON.stringify(next.preferredMusic)) changed.push('preferredMusic');
  if (JSON.stringify(previous?.startArea ?? null) !== JSON.stringify(next.startArea)) changed.push('startArea');
  if (JSON.stringify(previous?.window ?? null) !== JSON.stringify(next.window)) changed.push('window');
  return changed;
}
