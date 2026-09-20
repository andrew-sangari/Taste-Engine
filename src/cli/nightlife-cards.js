import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadEnv } from '../env.js';
import { sanitizeDiagnosticValue } from '../diagnostics.js';
import { describeNightlifeConfig, readNightlifeConfig } from '../nightlife/config.js';
import { createDecisionInferenceProvider } from '../nightlife/inference.js';
import { enrichSemanticEventCards } from '../nightlife/cardEnrichment.js';
import { buildEventEvidence, serializeEventEvidenceForModel } from '../eventEvidence.js';

/**
 * Live card-enrichment evaluation.
 *
 * The fixture harness (`npm run evaluation:nightlife`) scores a frozen gold set
 * offline. This runs the same enrichment over the real projection with the
 * configured provider and reports what actually changed: how many cards gained
 * a specific, source-linked claim, how many claims are verified rather than
 * inferred, and what the coverage, latency and spend really are.
 *
 * It reads the projection and writes a report. It changes no ranking, no
 * projection, and no publication state.
 */
loadEnv();

const options = parseArgs(process.argv.slice(2));
// The published projection deliberately omits source evidence, so evaluation
// reads the private artifact the export writes instead.
const evidencePath = resolve(options.evidence ?? 'data/nightlife/evidence-latest.json');
const config = readNightlifeConfig(process.env);
const described = describeNightlifeConfig(config);

try {
  let artifact;
  try {
    artifact = JSON.parse(await readFile(evidencePath, 'utf8'));
  } catch {
    throw new Error(`No evidence artifact at ${evidencePath}. Run npm run site:export first.`);
  }
  const events = artifact.candidates ?? [];
  if (!events.length) throw new Error(`No candidates in ${evidencePath}. Run npm run site:export first.`);

  console.log(`Route      ${described.provider}${described.configured ? '' : ' (not configured)'}`);
  console.log(`Model      ${described.model ?? '—'}`);
  console.log(`Candidates ${events.length} in the projection\n`);

  const now = options.now ? new Date(options.now) : new Date();
  const maxCandidates = Number(options.max ?? 24);
  const provider = createDecisionInferenceProvider(config);
  const started = Date.now();
  const enrichment = await enrichSemanticEventCards(events, { provider, now, maxCandidates });
  const wallMs = Date.now() - started;

  const fieldCoverage = coverageByField(events);
  const claims = collectClaims(events, enrichment.byId);
  const report = {
    generatedAt: new Date(now).toISOString(),
    route: described,
    evidenceGeneratedAt: artifact.generatedAt ?? null,
    candidateCount: events.length,
    evidence: fieldCoverage,
    enrichment: {
      enrichedCardCount: enrichment.enrichedCandidateCount,
      modelEligibleCandidateCount: enrichment.modelEligibleCandidateCount,
      assessedCandidateCount: enrichment.assessedCandidateCount,
      selectedCandidateCount: enrichment.selectedCandidateCount,
      // A card with no specific claim renders nothing. That is a legitimate
      // outcome and is counted, not hidden.
      noEnrichmentCount: events.length - enrichment.enrichedCandidateCount
    },
    claims,
    telemetry: enrichment.telemetry,
    wallMs
  };

  printSummary(report);
  const outputPath = resolve(options.output ?? `data/nightlife/cards-${report.generatedAt.slice(0, 10)}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(sanitizeDiagnosticValue({
    ...report,
    samples: sampleCards(events, enrichment.byId, 8)
  }), null, 2)}\n`);
  console.log(`\nWrote the traceable comparison to ${outputPath}.`);
  console.log('No ranking, projection, or publication state was changed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

/**
 * How much of each evidence field the permitted sources actually supply, and
 * how much of it may be transmitted. Field presence and model-input rights are
 * deliberately counted separately.
 */
function coverageByField(events) {
  const fields = ['title', 'description', 'classification', 'namedLineup', 'format', 'doorTime', 'startTime', 'endTime', 'venueInfo', 'agePolicy'];
  const present = Object.fromEntries(fields.map((field) => [field, 0]));
  const modelEligible = Object.fromEntries(fields.map((field) => [field, 0]));
  let withAnyEvidence = 0;
  let withAnyModelInput = 0;

  for (const event of events) {
    const evidence = event.eventEvidence ?? buildEventEvidence(event);
    const facts = evidence?.permittedFacts ?? {};
    const transmittable = serializeEventEvidenceForModel(evidence)?.publishedFacts ?? {};
    if (Object.values(facts).some(Boolean)) withAnyEvidence += 1;
    if (Object.keys(transmittable).length) withAnyModelInput += 1;
    for (const field of fields) {
      if (facts[field]) present[field] += 1;
      if (transmittable[field] != null) modelEligible[field] += 1;
    }
  }
  return { withAnyEvidence, withAnyModelInput, present, modelEligible };
}

function collectClaims(events, byId) {
  const kinds = ['whatToExpect', 'worthPlanning', 'worthChecking'];
  let total = 0;
  let withSourceLink = 0;
  const byStatus = { verified: 0, inferred: 0, 'not known': 0 };
  const byKind = Object.fromEntries(kinds.map((kind) => [kind, 0]));

  for (const event of events) {
    const insight = byId.get(String(event.id));
    if (!insight) continue;
    for (const kind of kinds) {
      const claim = insight[kind];
      if (!claim?.text) continue;
      total += 1;
      byKind[kind] += 1;
      if (byStatus[claim.status] != null) byStatus[claim.status] += 1;
      if ((claim.evidence ?? []).some((entry) => entry.url)) withSourceLink += 1;
    }
  }
  return { total, withSourceLink, byStatus, byKind };
}

function sampleCards(events, byId, limit) {
  const output = [];
  for (const event of events) {
    const insight = byId.get(String(event.id));
    if (!insight) continue;
    output.push({ id: event.id, title: event.title, sources: event.sources, insight });
    if (output.length >= limit) break;
  }
  return output;
}

function printSummary(report) {
  const { evidence, enrichment, claims, telemetry } = report;
  console.log('Evidence coverage');
  console.log(`  candidates with any permitted evidence   ${evidence.withAnyEvidence}/${report.candidateCount}`);
  console.log(`  candidates with model-transmittable data ${evidence.withAnyModelInput}/${report.candidateCount}`);
  for (const [field, count] of Object.entries(evidence.present)) {
    if (!count && !evidence.modelEligible[field]) continue;
    console.log(`    ${field.padEnd(15)} present ${String(count).padStart(3)}  model-eligible ${String(evidence.modelEligible[field]).padStart(3)}`);
  }

  console.log('\nEnrichment');
  console.log(`  cards with a specific claim   ${enrichment.enrichedCardCount}/${report.candidateCount}`);
  console.log(`  cards rendering nothing new   ${enrichment.noEnrichmentCount}`);
  console.log(`  model-eligible candidates     ${enrichment.modelEligibleCandidateCount}`);
  console.log(`  assessed by the model         ${enrichment.assessedCandidateCount}`);

  console.log('\nClaims');
  console.log(`  total ${claims.total}, with a source link ${claims.withSourceLink}`);
  console.log(`  verified ${claims.byStatus.verified} · inferred ${claims.byStatus.inferred} · not known ${claims.byStatus['not known']}`);
  console.log(`  ${Object.entries(claims.byKind).map(([kind, count]) => `${kind} ${count}`).join(' · ')}`);

  console.log('\nInference');
  console.log(`  status        ${telemetry.status}`);
  console.log(`  coverage      ${telemetry.coverage.covered}/${telemetry.coverage.requested}`);
  if (telemetry.latencyMsMedian != null) console.log(`  latency       ${telemetry.latencyMsMedian}ms median, ${telemetry.latencyMsMax}ms worst`);
  if (telemetry.costUsd != null) console.log(`  spend         $${telemetry.costUsd.toFixed(6)} total, $${(telemetry.costPerAssessedCandidateUsd ?? 0).toFixed(8)} per assessed candidate`);
  if (telemetry.validationFailures) console.log(`  validation    ${telemetry.validationFailures} rejected`);
  if (telemetry.errors?.length) console.log(`  errors        ${telemetry.errors.length}`);
  console.log(`  wall clock    ${report.wallMs}ms`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    options[key] = inline ?? argv[++index];
  }
  return options;
}
