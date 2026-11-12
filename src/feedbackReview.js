import { applyFeedbackOverlay, deriveFeedbackSignals, describeLearning, FEEDBACK_POLICY } from './feedbackPolicy.js';
import { buildOverviewBuckets } from './overview.js';

// What the person's feedback is changing right now: which dates move, by how
// much and why, and whether the shortlist differs from the canonical one.
// Computed with the same overlay the site applies, so the summary on the
// Taste tab is a description of what is on screen, not a prediction. Pure;
// notes never appear.
export function buildFeedbackReview({ projection = {}, records = [], now = new Date(), currentMinScore = 28, planAheadMinScore = 55, policy = FEEDBACK_POLICY } = {}) {
  const signals = deriveFeedbackSignals(records, { now, policy });
  const baseline = {
    events: (projection.events ?? []).map(withoutAppliedLearning),
    sports: (projection.sports ?? []).map(withoutAppliedLearning)
  };
  const music = applyFeedbackOverlay(baseline.events, 'music', signals, { policy });
  const sports = applyFeedbackOverlay(baseline.sports, 'sports', signals, { policy });
  const movements = [
    ...movementsFor(baseline.events, music.rows, 'music'),
    ...movementsFor(baseline.sports, sports.rows, 'sports')
  ].sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta) || a.id.localeCompare(b.id));
  const options = { now, currentDays: 14, currentMinScore, planAheadMinScore, horizonDays: projection.horizon?.days ?? null };
  const before = buildOverviewBuckets(baseline.events, baseline.sports, options);
  const after = buildOverviewBuckets(music.rows, sports.rows, options);
  const shortlist = {
    current: membershipChange(before.current, after.current),
    planAhead: membershipChange(before.planAhead, after.planAhead)
  };
  const learned = describeLearning(signals, { limit: 50 });
  const review = {
    schemaVersion: 2,
    policyVersion: policy.version,
    generatedAt: new Date(now).toISOString(),
    projectionGeneratedAt: projection.generatedAt ?? null,
    countedOutcomeCount: signals.countedRecords,
    learned,
    candidateCount: baseline.events.length + baseline.sports.length,
    adjustedCandidateCount: movements.length,
    largestAdjustment: movements[0]?.scoreDelta ?? 0,
    maxTotalAdjustment: policy.maxTotalAdjustment,
    movements,
    shortlist,
    shortlistChanged: Boolean(shortlist.current.added.length || shortlist.current.removed.length || shortlist.planAhead.added.length || shortlist.planAhead.removed.length)
  };
  return { ...review, digest: digestOf({ policyVersion: review.policyVersion, learned, movements: movements.map(({ id, scoreDelta }) => [id, scoreDelta]) }) };
}

export function summarizeFeedbackReview(review) {
  const lines = [
    `Policy v${review.policyVersion} · ${review.countedOutcomeCount} read(s) and outcome(s) counted · ${review.learned.length} learned signal(s).`,
    `${review.adjustedCandidateCount} of ${review.candidateCount} candidate(s) would move; largest ${signed(review.largestAdjustment)} (cap ±${review.maxTotalAdjustment}).`
  ];
  for (const row of review.learned.slice(0, 8)) {
    lines.push(`  ${row.kind === 'friction' ? 'friction' : 'taste   '} ${row.direction === 'up' ? '▲' : '▼'} ${row.label} (${row.category}, ${row.outcomes} night${row.outcomes === 1 ? '' : 's'}) ${signed(row.delta)}`);
  }
  for (const move of review.movements.slice(0, 8)) {
    lines.push(`  ${signed(move.scoreDelta).padStart(6)}  ${move.title} — ${move.reasons.map((reason) => reason.label).join(', ')}`);
  }
  const { current, planAhead } = review.shortlist;
  lines.push(review.shortlistChanged
    ? `Shortlist would change: +${[...current.added, ...planAhead.added].join(', ') || 'none'} / −${[...current.removed, ...planAhead.removed].join(', ') || 'none'}.`
    : 'Shortlist membership would not change.');
  lines.push(`Review digest: ${review.digest}`);
  return lines;
}

// A projection published with learning applied already carries the delta;
// the review always starts from the unadjusted score.
function withoutAppliedLearning(item) {
  const adjustment = item?.ranking?.feedbackAdjustment;
  if (!item?.ranking) return item;
  const { feedbackAdjustment: _adjustment, ...ranking } = item.ranking;
  if (!adjustment?.applied) return { ...item, ranking };
  const { baseUtility, ...rest } = ranking;
  return { ...item, ranking: { ...rest, utility: baseUtility ?? round(Number(ranking.utility ?? 0) - Number(adjustment.scoreDelta ?? 0)) } };
}

function movementsFor(before, after, vertical) {
  const rank = (items) => new Map([...items]
    .sort((a, b) => b.ranking.utility - a.ranking.utility || String(a.id).localeCompare(String(b.id)))
    .map((item, index) => [item.id, index + 1]));
  const beforeRank = rank(before.filter((item) => item?.ranking));
  const afterRank = rank(after.filter((item) => item?.ranking));
  return after.flatMap((item) => {
    const adjustment = item?.ranking?.feedbackAdjustment;
    if (!adjustment?.scoreDelta) return [];
    return [{
      id: String(item.id),
      vertical,
      title: String(item.title ?? `${item.awayTeam?.name ?? 'Away'} at ${item.homeTeam?.name ?? 'Home'}`),
      scoreDelta: adjustment.scoreDelta,
      scoreBefore: round(item.ranking.utility - adjustment.scoreDelta),
      scoreAfter: item.ranking.utility,
      rankBefore: beforeRank.get(item.id) ?? null,
      rankAfter: afterRank.get(item.id) ?? null,
      reasons: adjustment.reasons ?? []
    }];
  });
}

function membershipChange(before, after) {
  const beforeIds = new Set(before.map((item) => String(item.id)));
  const afterIds = new Set(after.map((item) => String(item.id)));
  return {
    added: [...afterIds].filter((id) => !beforeIds.has(id)).sort(),
    removed: [...beforeIds].filter((id) => !afterIds.has(id)).sort()
  };
}

// Small deterministic digest (FNV-1a over stable JSON); not a security
// primitive, only an identity for "what was reviewed".
function digestOf(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fr${hash.toString(16).padStart(8, '0')}-${text.length.toString(36)}`;
}

function signed(value) {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Number(value) || 0).toFixed(1)}`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
