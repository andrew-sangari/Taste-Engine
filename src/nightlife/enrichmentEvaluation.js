/**
 * Offline evaluation for the source-grounded card-enrichment contract.
 *
 * The fixture consumed here is intentionally separate from the live source
 * pipeline. It lets us compare a proposed card enhancement against a small,
 * source-diverse gold set without sending source material or personal data to
 * a provider. A production adapter can emit the same observation shape for a
 * shadow run later.
 */

export const ENRICHMENT_EVALUATION_VERSION = 1;

const SOURCE_STATUSES = new Set(['configured', 'functioning', 'partial', 'blocked', 'not configured', 'unavailable']);
const CLAIM_CONFIDENCE = new Set(['verified', 'inferred', 'unknown']);
const ALLOWED_ASSERTION_KINDS = new Set(['published-fact', 'descriptive-copy', 'derived-estimate']);
const GENERIC_CLAIM_PATTERNS = [
  /^(?:this|it) (?:looks|seems) (?:fun|good|interesting)\.?$/i,
  /^a great (?:event|night|option)\.?$/i,
  /^something for everyone\.?$/i,
  /^fixture advisory only\.?$/i
];

/**
 * Evaluate one immutable synthetic/gold fixture.
 *
 * `observationKey` is useful for running a safe observation and then an
 * adversarial shadow observation against the same cases. No network calls are
 * made and no private repository state is read.
 */
export function evaluateEnrichmentFixture(fixture, { observationKey = 'observed' } = {}) {
  validateFixture(fixture);
  const evidence = fixture.evidence ?? {};
  const cases = fixture.cases.map((item) => evaluateCase(item, evidence, { observationKey }));
  const metrics = summarize(cases, fixture);
  const sourceHealth = summarizeSourceHealth(fixture.sources, cases);
  const report = {
    evaluationVersion: ENRICHMENT_EVALUATION_VERSION,
    fixtureVersion: fixture.fixtureVersion ?? null,
    observationKey,
    candidateCount: cases.length,
    sourceHealth,
    metrics,
    cases,
  };
  report.pass = isPassing(report);
  return report;
}

function evaluateCase(item, evidence, { observationKey }) {
  const gold = item.gold ?? {};
  const observation = item[observationKey] ?? {};
  const refs = Array.isArray(observation.modelInputRefs) ? observation.modelInputRefs : [];
  const claims = Array.isArray(observation.claims) ? observation.claims : [];
  const caseEvidenceRefs = new Set(item.evidenceRefs ?? []);
  const claimResults = claims.map((claim) => evaluateClaim(claim, gold, evidence, caseEvidenceRefs));
  const rightsViolations = refs.flatMap((ref) => {
    const fact = evidence[ref];
    if (!caseEvidenceRefs.has(ref)) return [{ ref, reason: 'evidence-not-declared-for-candidate' }];
    return fact && modelInputAllowed(fact) ? [] : [{ ref, reason: fact ? 'model-input-not-permitted' : 'unknown-evidence-ref' }];
  });
  const actualNoOp = Boolean(observation.noop) && claims.length === 0;
  const expectedNoOp = gold.shouldEnrich !== true;
  const noOpCorrect = expectedNoOp ? actualNoOp : !actualNoOp;
  const expectedKinds = new Set(gold.expectedClaimKinds ?? []);
  const useful = gold.shouldEnrich === true
    && expectedKinds.size > 0
    && [...expectedKinds].every((kind) => claimResults.some((claim) => claim.kind === kind && claim.supported && !claim.generic));
  const rankingParity = Number.isFinite(observation.canonicalRank)
    && Number.isFinite(observation.enrichedRank)
    && observation.canonicalRank === observation.enrichedRank;
  const latencyMs = finiteNonNegative(observation.latencyMs);
  const spendUsd = finiteNonNegative(observation.spendUsd);
  const maxClaims = Number.isFinite(gold.maxClaims) ? gold.maxClaims : 3;
  return {
    id: item.id,
    sources: [...(item.sources ?? [])],
    expectedEnrichment: gold.shouldEnrich === true,
    expectedClaimKinds: [...expectedKinds],
    actualNoOp,
    noOpCorrect,
    useful,
    claims: claimResults,
    claimCount: claims.length,
    maxClaims,
    cardLimitViolation: claims.length > maxClaims,
    modelInputRefs: [...refs],
    rightsViolations,
    rankingParity,
    latencyMs,
    spendUsd,
  };
}

function evaluateClaim(claim, gold, evidence, caseEvidenceRefs) {
  const kind = String(claim?.kind ?? '');
  const text = String(claim?.text ?? '').trim();
  const refs = Array.isArray(claim?.evidenceRefs) ? claim.evidenceRefs : [];
  const confidence = String(claim?.confidence ?? 'unknown');
  const allowedKinds = new Set(gold.allowedClaimKinds ?? gold.expectedClaimKinds ?? []);
  const facts = refs.map((ref) => evidence[ref] ?? null);
  const missingRefs = refs.filter((ref, index) => !facts[index]);
  const unscopedRefs = refs.filter((ref) => !caseEvidenceRefs.has(ref));
  const rightsViolations = facts.flatMap((fact, index) => {
    if (!fact) return [];
    const violations = [];
    if (!fact.permission?.display) violations.push({ ref: refs[index], reason: 'display-not-permitted' });
    if (!fact.permission?.modelInput) violations.push({ ref: refs[index], reason: 'model-input-not-permitted' });
    return violations;
  });
  const unknownFacts = facts.filter((fact) => fact && fact.confidence === 'unknown');
  const invalidAssertionKinds = facts.filter((fact) => fact && !ALLOWED_ASSERTION_KINDS.has(fact.assertionKind));
  const generic = GENERIC_CLAIM_PATTERNS.some((pattern) => pattern.test(text)) || text.length < 8;
  const confidenceValid = CLAIM_CONFIDENCE.has(confidence) && confidence !== 'unknown';
  const supported = Boolean(
    kind
      && allowedKinds.has(kind)
      && text
      && !generic
      && refs.length
      && !missingRefs.length
      && !unscopedRefs.length
      && !rightsViolations.length
      && !unknownFacts.length
      && !invalidAssertionKinds.length
      && confidenceValid
  );
  const overconfident = confidence === 'verified' && facts.some((fact) => fact && fact.confidence !== 'verified');
  return {
    kind,
    text,
    confidence,
    evidenceRefs: refs,
    supported,
    generic,
    unexpectedKind: !allowedKinds.has(kind),
    missingRefs,
    unscopedRefs,
    rightsViolations,
    overconfident,
  };
}

function summarize(cases, fixture) {
  const claims = cases.flatMap((item) => item.claims);
  const expectedEnrichment = cases.filter((item) => item.expectedEnrichment).length;
  const usefulCount = cases.filter((item) => item.useful).length;
  const noOpExpected = cases.filter((item) => !item.expectedEnrichment).length;
  const noOpCorrect = cases.filter((item) => item.noOpCorrect).length;
  const unsupported = claims.filter((claim) => !claim.supported).length;
  const sourceSupportDenominator = claims.length;
  const supported = claims.filter((claim) => claim.supported).length;
  const overconfident = claims.filter((claim) => claim.overconfident).length;
  const rightsViolations = cases.reduce((count, item) => count + item.rightsViolations.length, 0)
    + claims.reduce((count, claim) => count + claim.rightsViolations.length, 0);
  const rankingChanged = cases.filter((item) => !item.rankingParity).length;
  const cardLimitViolations = cases.filter((item) => item.cardLimitViolation).length;
  const latency = summarizeNumbers(cases.map((item) => item.latencyMs).filter((value) => value != null));
  const spend = summarizeNumbers(cases.map((item) => item.spendUsd).filter((value) => value != null));
  const missingLatency = cases.filter((item) => item.latencyMs == null).length;
  const missingSpend = cases.filter((item) => item.spendUsd == null).length;
  const maxLatencyMs = Number(fixture.evaluation?.budgets?.maxLatencyMs);
  const maxSpendUsd = Number(fixture.evaluation?.budgets?.maxSpendUsd);
  return {
    usefulEnrichment: {
      eligible: expectedEnrichment,
      useful: usefulCount,
      missed: expectedEnrichment - usefulCount,
      rate: ratio(usefulCount, expectedEnrichment),
    },
    sourceSupport: {
      claims: sourceSupportDenominator,
      supported,
      unsupported,
      rate: ratio(supported, sourceSupportDenominator),
    },
    unsupportedClaims: unsupported,
    overconfidentClaims: overconfident,
    rights: {
      violations: rightsViolations,
      modelInputRefs: cases.reduce((count, item) => count + item.modelInputRefs.length, 0),
    },
    noOp: {
      expected: noOpExpected,
      correct: noOpCorrect,
      falseEnrichment: cases.filter((item) => !item.expectedEnrichment && !item.noOpCorrect).length,
      missedEnrichment: cases.filter((item) => item.expectedEnrichment && !item.noOpCorrect).length,
      rate: ratio(noOpCorrect, cases.length),
    },
    rankingParity: {
      compared: cases.length,
      unchanged: cases.length - rankingChanged,
      changed: rankingChanged,
      rate: ratio(cases.length - rankingChanged, cases.length),
    },
    cardLimits: {
      violations: cardLimitViolations,
    },
    latency: {
      ...latency,
      missing: missingLatency,
      budgetViolations: Number.isFinite(maxLatencyMs) ? cases.filter((item) => item.latencyMs != null && item.latencyMs > maxLatencyMs).length : 0,
    },
    spend: {
      ...spend,
      missing: missingSpend,
      budgetViolations: Number.isFinite(maxSpendUsd) ? cases.filter((item) => item.spendUsd != null && item.spendUsd > maxSpendUsd).length : 0,
    },
  };
}

function summarizeSourceHealth(sources = {}, cases) {
  const caseCounts = new Map();
  for (const item of cases) {
    for (const source of item.sources) caseCounts.set(source, (caseCounts.get(source) ?? 0) + 1);
  }
  return Object.entries(sources).sort(([left], [right]) => left.localeCompare(right)).map(([source, health]) => ({
    source,
    status: health.status,
    candidateCount: caseCounts.get(source) ?? 0,
    declaredCandidateCount: Number(health.candidateCount ?? 0),
    modelEligibleCandidateCount: Number(health.modelEligibleCandidateCount ?? 0),
    coverage: { ...(health.coverage ?? {}) },
    consistent: SOURCE_STATUSES.has(health.status)
      && Number(health.candidateCount ?? 0) === (caseCounts.get(source) ?? 0)
      && (source !== 'insomniac' || !['functioning', 'configured'].includes(health.status))
  }));
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw new Error('Enrichment fixture must be an object.');
  if (!Array.isArray(fixture.cases) || fixture.cases.length < 20 || fixture.cases.length > 30) {
    throw new Error('Enrichment fixture must contain 20–30 cases.');
  }
  const ids = new Set();
  for (const item of fixture.cases) {
    if (!item?.id || ids.has(item.id)) throw new Error(`Duplicate or missing enrichment fixture case id: ${item?.id ?? 'unknown'}.`);
    ids.add(item.id);
    if (!Array.isArray(item.sources) || !item.sources.length) throw new Error(`Case ${item.id} must declare at least one source.`);
    if (!item.gold || typeof item.gold !== 'object') throw new Error(`Case ${item.id} is missing gold labels.`);
    if (!item.observed || typeof item.observed !== 'object') throw new Error(`Case ${item.id} is missing an observed output.`);
    for (const ref of item.evidenceRefs ?? []) {
      if (!fixture.evidence?.[ref]) throw new Error(`Case ${item.id} references missing evidence ${ref}.`);
    }
  }
  for (const [ref, fact] of Object.entries(fixture.evidence ?? {})) {
    if (!fact.provider || !fact.sourceUrl || !fact.retrievedAt) throw new Error(`Evidence ${ref} is missing provenance.`);
    if (!fact.permission || typeof fact.permission.modelInput !== 'boolean' || typeof fact.permission.display !== 'boolean') {
      throw new Error(`Evidence ${ref} is missing field-level permissions.`);
    }
    if (!ALLOWED_ASSERTION_KINDS.has(fact.assertionKind)) throw new Error(`Evidence ${ref} has an invalid assertion kind.`);
  }
  for (const [source, health] of Object.entries(fixture.sources ?? {})) {
    if (!SOURCE_STATUSES.has(health.status)) throw new Error(`Source ${source} has an invalid health status.`);
  }
}

function isPassing(report) {
  const sourceHealthPass = Object.values(report.sourceHealth).every((health) => health.consistent);
  const { metrics } = report;
  return sourceHealthPass
    && metrics.usefulEnrichment.missed === 0
    && metrics.sourceSupport.unsupported === 0
    && metrics.overconfidentClaims === 0
    && metrics.rights.violations === 0
    && metrics.noOp.falseEnrichment === 0
    && metrics.noOp.missedEnrichment === 0
    && metrics.rankingParity.changed === 0
    && metrics.cardLimits.violations === 0
    && metrics.latency.missing === 0
    && metrics.spend.missing === 0
    && metrics.latency.budgetViolations === 0
    && metrics.spend.budgetViolations === 0;
}

function modelInputAllowed(fact) {
  return Boolean(fact.permission?.modelInput) && fact.provider !== 'seatgeek' && fact.provider !== 'insomniac';
}

function summarizeNumbers(values) {
  if (!values.length) return { samples: 0, total: 0, average: null, min: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    total: round(sorted.reduce((sum, value) => sum + value, 0)),
    average: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    min: round(sorted[0]),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)),
  };
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(3)) : null;
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}
