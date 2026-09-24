import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateEnrichmentFixture } from '../src/nightlife/enrichmentEvaluation.js';
import { evaluateInsightCases } from '../src/nightlife/insightEvaluation.js';
import { buildInsightCases } from '../test/fixtures/nightlife/insight-cases.js';

const fixturePath = valueAfter('--fixture') ?? resolve('test/fixtures/nightlife/enrichment-gold.json');
const observationKey = valueAfter('--observation') ?? 'observed';
const json = process.argv.includes('--json');

try {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const report = evaluateEnrichmentFixture(fixture, { observationKey });
  // The composed-insight cases run the real composer, personal-relevance
  // comparison and serializers over adversarial candidates, and attribute each
  // claim to source extraction, Jev characterization, or a personal match.
  const insight = evaluateInsightCases(buildInsightCases());
  if (json) {
    console.log(JSON.stringify({ contract: report, insight }, null, 2));
  } else {
    printSummary(report, fixturePath);
    printInsightSummary(insight);
  }
  if (!report.pass || !insight.pass) process.exitCode = 1;
} catch (error) {
  console.error(`Nightlife enrichment evaluation failed: ${String(error?.message ?? error).replace(/https?:\/\/\S+/g, '[URL REDACTED]')}`);
  process.exitCode = 1;
}

function printSummary(report, path) {
  const { metrics } = report;
  console.log(`Nightlife enrichment evaluation (${path})`);
  console.log(`  cases: ${report.candidateCount}; pass: ${report.pass ? 'yes' : 'no'}`);
  console.log(`  useful enrichment: ${metrics.usefulEnrichment.useful}/${metrics.usefulEnrichment.eligible} (${metrics.usefulEnrichment.rate ?? 'n/a'})`);
  console.log(`  source-supported claims: ${metrics.sourceSupport.supported}/${metrics.sourceSupport.claims} (${metrics.sourceSupport.rate ?? 'n/a'})`);
  console.log(`  unsupported/overconfident claims: ${metrics.unsupportedClaims}/${metrics.overconfidentClaims}`);
  console.log(`  rights violations: ${metrics.rights.violations}; no-op errors: ${metrics.noOp.falseEnrichment + metrics.noOp.missedEnrichment}`);
  console.log(`  ranking parity: ${metrics.rankingParity.unchanged}/${metrics.rankingParity.compared}; latency p95: ${metrics.latency.p95 ?? 'n/a'}ms; spend total: $${metrics.spend.total ?? 'n/a'}`);
}

function printInsightSummary(report) {
  const { metrics } = report;
  console.log(`\nComposed card insight (${report.candidateCount} targeted cases); pass: ${report.pass ? 'yes' : 'no'}`);
  console.log(`  cards with an insight: baseline ${metrics.cardsBaseline}, revised ${metrics.cardsRevised}; with information the baseline lacked: ${metrics.cardsWithNewInformation}`);
  console.log(`  claims by basis: documented ${metrics.claims.documented} · model-derived ${metrics.claims.modelDerived} · personal match ${metrics.claims.personal} · uncertainty/conflict ${metrics.claims.uncertainty}`);
  console.log(`  cards with a model-derived claim: ${metrics.cardsWithModelDerivedClaim}; with a personal claim: ${metrics.cardsWithPersonalClaim}`);
  console.log(`  grounding violations: ${metrics.violations}; gold failures: ${metrics.goldFailures}`);
  for (const item of report.cases.filter((entry) => !entry.pass)) {
    console.log(`  ✗ ${item.id}: ${[...item.goldFailures, ...item.violations.map((violation) => violation.kind)].join('; ')}`);
  }
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}
