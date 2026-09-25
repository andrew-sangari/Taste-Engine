import { buildSemanticEventInsight, composeInsightClaims } from './cardInsight.js';
import { buildSemanticRequest } from './semanticInput.js';

/**
 * Does the revised card insight help a decision more than the deterministic
 * card, and is every claim it makes actually supported?
 *
 * Each candidate is composed twice:
 * - baseline: deterministic source extraction only (no Jev assessment, no
 *   preference signals) — what a card says with inference off;
 * - revised: the same, plus the Jev characterization and the local
 *   personal-relevance comparison.
 * Claims are attributed by basis, so deterministic extraction is never
 * credited as model value, and a personal claim is counted only when it names
 * both an event fact and an established preference signal.
 *
 * Used offline against the targeted cases in `test/fixtures/nightlife/` and
 * live by `npm run nightlife:cards` against the real projection.
 */

export const INSIGHT_EVALUATION_VERSION = 1;

// Statements that sound informative and are not: an absence read as a fact,
// a vertical restated, or generic enthusiasm.
const FILLER_PATTERNS = [
  /no additional entry restriction/i,
  /\bclassifies it as music\.?$/i,
  /published classification/i,
  /makes the event window concrete/i,
  /\b(?:looks|seems) (?:fun|great|interesting)\b/i,
  /something for everyone/i
];

// A claim may never assert the user's history or novelty: the profile holds no
// record of formats the user has or has not experienced.
const UNSUPPORTED_PERSONAL_PATTERNS = [
  /\bnew to you\b/i,
  /\bnever (?:seen|been)\b/i,
  /\bfirst time\b/i,
  /\byou(?:'ll| will) (?:love|enjoy)\b/i,
  /\byou (?:like|love|enjoy)\b/i
];

export function evaluateInsightCase(testCase) {
  const candidate = testCase.candidate;
  const before = JSON.stringify({ ranking: candidate.ranking ?? null, id: candidate.id });
  const preferences = testCase.preferences ?? { topTags: [] };

  // The baseline card has no semantic layer at all: no characterization, no
  // preference signals, not even the artist match the personal layer reads.
  const baseline = buildSemanticEventInsight({ ...candidate, matchedArtists: [] }, null, { preferences: null });
  const revised = buildSemanticEventInsight(candidate, testCase.assessment ?? null, { preferences });
  const internal = composeInsightClaims(candidate, testCase.assessment ?? null, { preferences });
  const rankingUnchanged = JSON.stringify({ ranking: candidate.ranking ?? null, id: candidate.id }) === before;

  const claims = publishedClaims(revised);
  const baselineTexts = new Set(publishedClaims(baseline).map((claim) => claim.text));
  const newClaims = claims.filter((claim) => !baselineTexts.has(claim.text));
  const modelDerived = claims.filter((claim) => claim.basis === 'model-characterization' || claim.eventBasis === 'model-characterization');
  const personal = claims.filter((claim) => claim.basis === 'calculated-match');

  const violations = [];
  for (const claim of claims) {
    const text = claim.text;
    if (FILLER_PATTERNS.some((pattern) => pattern.test(text))) violations.push({ kind: 'filler', text });
    if (UNSUPPORTED_PERSONAL_PATTERNS.some((pattern) => pattern.test(text))) violations.push({ kind: 'unsupported-personalization', text });
    const sourced = (claim.evidence ?? []).filter((entry) => entry.url);
    if (!sourced.length) violations.push({ kind: 'no-source-evidence', text });
    // A model characterization, or a match resting on one, is never verified.
    if (claim.status === 'verified' && (claim.basis === 'model-characterization' || claim.eventBasis === 'model-characterization')) {
      violations.push({ kind: 'overstated-certainty', text });
    }
    if (claim.basis === 'calculated-match') {
      const preference = (claim.evidence ?? []).some((entry) => /^Your taste profile/.test(entry.source));
      if (!preference || !sourced.length) violations.push({ kind: 'personal-claim-missing-half', text });
    }
  }
  const internalPersonal = internal.filter((claim) => claim.basis === 'calculated-match');
  for (const claim of internalPersonal) {
    if (!claim.preference?.signal || !(claim.facts ?? []).length) violations.push({ kind: 'personal-claim-missing-half', text: claim.text });
  }
  if (!rankingUnchanged) violations.push({ kind: 'ranking-mutated', text: String(candidate.id) });
  if (claims.length > 3) violations.push({ kind: 'card-limit', text: `${claims.length} claims` });

  // Profile independence: the model payload must be identical whether or not
  // the candidate carries preference signals.
  const withSignals = modelPayload(candidate);
  const withoutSignals = modelPayload({ ...candidate, matchedArtists: [] });
  if (withSignals !== withoutSignals) violations.push({ kind: 'preference-reached-model-input', text: String(candidate.id) });

  const gold = testCase.gold ?? null;
  const goldFailures = gold ? checkGold(gold, revised, claims, { personal, modelDerived }) : [];

  return {
    id: testCase.id ?? String(candidate.id),
    title: candidate.title ?? null,
    baselineSummary: baseline?.summary ?? null,
    revisedSummary: revised?.summary ?? null,
    claimCount: claims.length,
    newInformation: newClaims.length > 0,
    modelDerivedClaims: modelDerived.length,
    personalClaims: personal.length,
    documentedClaims: claims.filter((claim) => claim.basis === 'documented-attribute').length,
    uncertaintyClaims: claims.filter((claim) => claim.basis === 'uncertainty' || claim.basis === 'conflict').length,
    claims: claims.map(({ kind, text, status, basis, eventBasis }) => ({ kind, text, status, basis, ...(eventBasis ? { eventBasis } : {}) })),
    violations,
    goldFailures,
    pass: violations.length === 0 && goldFailures.length === 0
  };
}

export function evaluateInsightCases(cases = []) {
  const results = cases.map(evaluateInsightCase);
  const count = (predicate) => results.filter(predicate).length;
  const sum = (field) => results.reduce((total, item) => total + item[field], 0);
  return {
    evaluationVersion: INSIGHT_EVALUATION_VERSION,
    candidateCount: results.length,
    metrics: {
      cardsBaseline: count((item) => item.baselineSummary),
      cardsRevised: count((item) => item.revisedSummary),
      cardsWithNewInformation: count((item) => item.newInformation),
      cardsWithModelDerivedClaim: count((item) => item.modelDerivedClaims > 0),
      cardsWithPersonalClaim: count((item) => item.personalClaims > 0),
      claims: {
        documented: sum('documentedClaims'),
        modelDerived: sum('modelDerivedClaims'),
        personal: sum('personalClaims'),
        uncertainty: sum('uncertaintyClaims')
      },
      violations: results.reduce((total, item) => total + item.violations.length, 0),
      goldFailures: results.reduce((total, item) => total + item.goldFailures.length, 0)
    },
    cases: results,
    pass: results.every((item) => item.pass)
  };
}

function checkGold(gold, revised, claims, { personal, modelDerived }) {
  const failures = [];
  if (gold.enrich != null && Boolean(revised) !== gold.enrich) failures.push(gold.enrich ? 'expected enrichment, got none' : 'expected no enrichment');
  if (gold.personal != null && (personal.length > 0) !== gold.personal) failures.push(gold.personal ? 'expected a personal claim' : 'unexpected personal claim');
  if (gold.modelContributes != null && (modelDerived.length > 0) !== gold.modelContributes) {
    failures.push(gold.modelContributes ? 'expected a model-derived claim' : 'unexpected model-derived claim');
  }
  for (const { kind, pattern } of gold.mustMatch ?? []) {
    const claim = claims.find((item) => item.kind === kind);
    if (!claim || !new RegExp(pattern, 'i').test(claim.text)) failures.push(`expected ${kind} matching /${pattern}/`);
  }
  for (const pattern of gold.mustNotMatch ?? []) {
    const hit = claims.find((item) => new RegExp(pattern, 'i').test(item.text));
    if (hit) failures.push(`claim must not match /${pattern}/: ${hit.text}`);
  }
  return failures;
}

function publishedClaims(insight) {
  if (!insight) return [];
  return (insight.claimOrder ?? []).map((kind) => insight[kind] ? { kind, ...insight[kind] } : null).filter(Boolean);
}

function modelPayload(candidate) {
  try {
    return JSON.stringify(buildSemanticRequest([candidate]).payload);
  } catch (error) {
    return `error:${error.message}`;
  }
}
