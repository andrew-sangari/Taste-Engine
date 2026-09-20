import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateEnrichmentFixture } from '../src/nightlife/enrichmentEvaluation.js';

const fixturePath = valueAfter('--fixture') ?? resolve('test/fixtures/nightlife/enrichment-gold.json');
const observationKey = valueAfter('--observation') ?? 'observed';
const json = process.argv.includes('--json');

try {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const report = evaluateEnrichmentFixture(fixture, { observationKey });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report, fixturePath);
  }
  if (!report.pass) process.exitCode = 1;
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

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}
