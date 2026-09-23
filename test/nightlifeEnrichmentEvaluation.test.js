import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { evaluateEnrichmentFixture } from '../src/nightlife/enrichmentEvaluation.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/nightlife/enrichment-gold.json', import.meta.url), 'utf8'));

test('source-grounded enrichment fixture covers 20–30 candidates and passes the safe contract', () => {
  const report = evaluateEnrichmentFixture(fixture);

  assert.equal(report.pass, true);
  assert.equal(report.candidateCount, 24);
  assert.deepEqual(report.sourceHealth.map(({ source, status }) => [source, status]), [
    ['framework', 'functioning'],
    ['insomniac', 'unavailable'],
    ['seatgeek', 'functioning'],
    ['ticketmaster', 'functioning']
  ]);
  assert.equal(report.metrics.usefulEnrichment.eligible, 12);
  assert.equal(report.metrics.usefulEnrichment.rate, 1);
  assert.equal(report.metrics.sourceSupport.rate, 1);
  assert.equal(report.metrics.unsupportedClaims, 0);
  assert.equal(report.metrics.overconfidentClaims, 0);
  assert.equal(report.metrics.rights.violations, 0);
  assert.equal(report.metrics.noOp.falseEnrichment, 0);
  assert.equal(report.metrics.noOp.missedEnrichment, 0);
  assert.equal(report.metrics.rankingParity.changed, 0);
  assert.equal(report.metrics.latency.missing, 0);
  assert.equal(report.metrics.spend.missing, 0);
  assert.equal(report.metrics.latency.budgetViolations, 0);
  assert.equal(report.metrics.spend.budgetViolations, 0);
  assert.equal(report.metrics.latency.samples, 24);
  assert.equal(report.metrics.spend.samples, 24);
});

test('fixture includes source-diverse evidence and keeps SeatGeek/Insomniac out of model input', () => {
  const report = evaluateEnrichmentFixture(fixture);
  const sourceHealth = new Map(report.sourceHealth.map((item) => [item.source, item]));

  assert.equal(sourceHealth.get('ticketmaster').candidateCount, 10);
  assert.equal(sourceHealth.get('framework').candidateCount, 9);
  assert.equal(sourceHealth.get('seatgeek').candidateCount, 6);
  assert.equal(sourceHealth.get('insomniac').candidateCount, 3);
  assert.equal(sourceHealth.get('seatgeek').modelEligibleCandidateCount, 0);
  assert.equal(sourceHealth.get('insomniac').modelEligibleCandidateCount, 0);
  assert.ok(report.cases.some((item) => item.sources.includes('ticketmaster') && item.sources.includes('seatgeek') && item.modelInputRefs.length > 0));
  assert.ok(report.cases.filter((item) => item.sources.includes('seatgeek') && item.sources.length === 1).every((item) => item.modelInputRefs.length === 0));
  assert.ok(report.cases.filter((item) => item.sources.includes('insomniac')).every((item) => item.modelInputRefs.length === 0));
});

test('evaluation catches unsupported, overconfident, restricted, filler, no-op, rank, latency, and spend regressions', () => {
  const adversarial = structuredClone(fixture);
  const grounded = adversarial.cases.find((item) => item.id === 'tm-dj-grounded');
  grounded.observed.claims[0] = {
    kind: 'experience',
    text: 'This looks fun.',
    evidenceRefs: ['tm:format-dj', 'tm:end-estimate'],
    confidence: 'verified'
  };
  grounded.observed.modelInputRefs.push('tm:end-estimate');
  grounded.observed.enrichedRank = 99;
  grounded.observed.latencyMs = 900;
  grounded.observed.spendUsd = 0.01;

  const sparse = adversarial.cases.find((item) => item.id === 'tm-sparse-title-only');
  sparse.observed.noop = false;
  sparse.observed.claims = [{
    kind: 'musicCharacter',
    text: 'The room has a distinctive sound.',
    evidenceRefs: ['tm:title-sparse', 'sg:title-only'],
    confidence: 'verified'
  }];
  sparse.observed.modelInputRefs = ['tm:title-sparse', 'sg:title-only'];

  const report = evaluateEnrichmentFixture(adversarial);
  assert.equal(report.pass, false);
  assert.ok(report.metrics.unsupportedClaims >= 1);
  assert.ok(report.metrics.overconfidentClaims >= 1);
  assert.ok(report.metrics.rights.violations >= 1);
  assert.ok(report.metrics.noOp.falseEnrichment >= 1);
  assert.ok(report.metrics.rankingParity.changed >= 1);
  assert.ok(report.metrics.latency.budgetViolations >= 1);
  assert.ok(report.metrics.spend.budgetViolations >= 1);
});

test('gateway or provider telemetry can be audited without changing the semantic quality metrics', () => {
  const report = evaluateEnrichmentFixture(fixture, { observationKey: 'observed' });
  assert.deepEqual(Object.keys(report.metrics).sort(), [
    'cardLimits',
    'latency',
    'noOp',
    'overconfidentClaims',
    'rankingParity',
    'rights',
    'sourceSupport',
    'spend',
    'unsupportedClaims',
    'usefulEnrichment'
  ].sort());
  assert.equal(report.observationKey, 'observed');
});

test('the quality gate fails if Insomniac is claimed as functioning before repair evidence exists', () => {
  const premature = structuredClone(fixture);
  premature.sources.insomniac.status = 'functioning';
  const report = evaluateEnrichmentFixture(premature);
  assert.equal(report.pass, false);
  assert.equal(report.sourceHealth.find((item) => item.source === 'insomniac').consistent, false);
});

test('jev source health follows the shared source contract', async () => {
  const { semanticSourceHealth } = await import('../src/nightlife/cardEnrichment.js');
  const row = (telemetryStatus, eligible, assessed) => semanticSourceHealth({
    telemetry: { status: telemetryStatus },
    modelEligibleCandidateCount: eligible,
    assessedCandidateCount: assessed,
    enrichedCandidateCount: 5
  });
  // A missing credential is configuration, not failure.
  assert.equal(row('not configured', 8, 0).status, 'not configured');
  // Candidates with nothing to ask are not a coverage gap.
  assert.equal(row('partial inference', 8, 8).status, 'active');
  assert.equal(row('no candidates', 0, 0).status, 'active');
  // Only eligible-but-unassessed candidates degrade the row.
  assert.equal(row('partial inference', 8, 3).status, 'partial');
  assert.equal(row('deterministic fallback', 8, 0).status, 'unavailable');
  assert.equal(row('partial inference', 8, 3).warningCount, 5);
});

test('an enrichment failure degrades to no enrichment instead of aborting the refresh', async () => {
  const { enrichSemanticEventCards, semanticSourceHealth } = await import('../src/nightlife/cardEnrichment.js');
  const explodingProvider = {
    async assessCandidates() {
      throw new Error('provider exploded at https://secret.example/path?token=abc');
    }
  };
  const events = [{
    id: 'ticketmaster:1',
    title: 'Some Show',
    startLocal: '2026-10-03T22:00:00',
    ranking: { utility: 60 },
    sourceOccurrences: []
  }];
  const result = await enrichSemanticEventCards(events, { provider: explodingProvider, now: new Date('2026-09-23T00:00:00Z') });
  assert.equal(result.failed, true);
  assert.equal(result.byId.size, 0);
  const health = semanticSourceHealth(result);
  assert.equal(health.status, 'unavailable');
  // The failure is reported, but never with a raw URL or credential in it.
  assert.ok(health.details.failure);
  assert.ok(!/secret\.example|token=abc/.test(health.details.failure), health.details.failure);
});
