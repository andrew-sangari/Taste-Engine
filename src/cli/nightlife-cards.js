import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadEnv } from '../env.js';
import { sanitizeDiagnosticValue } from '../diagnostics.js';
import { describeNightlifeConfig, readNightlifeConfig } from '../nightlife/config.js';
import { createDecisionInferenceProvider } from '../nightlife/inference.js';
import { enrichSemanticEventCards } from '../nightlife/cardEnrichment.js';
import { evaluateInsightCase } from '../nightlife/insightEvaluation.js';
import { preferenceSignalsFor } from '../nightlife/personalRelevance.js';
import { buildEventEvidence, serializeEventEvidenceForModel } from '../eventEvidence.js';

/**
 * Live card-enrichment evaluation.
 *
 * The offline gate (`npm run evaluation:nightlife`) scores targeted cases. This
 * runs the same enrichment over the real projection with the configured
 * provider and asks whether it helped: which cards now say something the
 * deterministic card did not, whether that came from source extraction, from
 * Jev's characterization, or from a personal match, and — when little changes —
 * which half of the evidence ran out.
 *
 * It reads the private evidence artifact and writes a report. It changes no
 * ranking, no projection, and no publication state.
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
  const preferences = artifact.preferences ?? { topTags: [] };

  console.log(`Route      ${described.provider}${described.configured ? '' : ' (not configured)'}`);
  console.log(`Model      ${described.model ?? '—'}`);
  console.log(`Candidates ${events.length} in the projection\n`);

  const now = options.now ? new Date(options.now) : new Date();
  // Default to every candidate, not only the refresh shortlist: the question is
  // what the evidence can support, and spend is a fraction of a cent.
  const maxCandidates = Number(options.max ?? events.length);
  const provider = createDecisionInferenceProvider({ ...config, maxCandidates: Math.min(80, maxCandidates) });
  const started = Date.now();
  const enrichment = await enrichSemanticEventCards(events, { provider, now, maxCandidates, preferences });
  const wallMs = Date.now() - started;

  const comparisons = events.map((event) => ({
    event,
    result: evaluateInsightCase({ candidate: event, assessment: enrichment.assessmentById.get(String(event.id)) ?? null, preferences })
  }));
  const report = {
    generatedAt: new Date(now).toISOString(),
    route: described,
    evidenceGeneratedAt: artifact.generatedAt ?? null,
    candidateCount: events.length,
    evidence: coverageByField(events),
    bottleneck: bottleneck(events, enrichment.assessmentById, preferences),
    comparison: summarizeComparisons(comparisons),
    enrichment: {
      enrichedCardCount: enrichment.enrichedCandidateCount,
      modelEligibleCandidateCount: enrichment.modelEligibleCandidateCount,
      assessedCandidateCount: enrichment.assessedCandidateCount,
      selectedCandidateCount: enrichment.selectedCandidateCount,
      contributions: enrichment.contributions,
      // A card with no specific claim renders nothing. That is a legitimate
      // outcome and is counted, not hidden.
      noEnrichmentCount: events.length - enrichment.enrichedCandidateCount
    },
    telemetry: enrichment.telemetry,
    wallMs
  };

  printSummary(report);
  const outputPath = resolve(options.output ?? `data/nightlife/cards-${report.generatedAt.slice(0, 10)}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(sanitizeDiagnosticValue({
    ...report,
    samples: comparisons
      .filter(({ result }) => result.newInformation || result.violations.length)
      .map(({ event, result }) => ({ id: event.id, title: event.title, sources: event.sources, ...result }))
  }), null, 2)}\n`);
  console.log(`\nWrote the traceable before/after comparison to ${outputPath}.`);
  console.log('No ranking, projection, or publication state was changed.');
  if (report.comparison.violations) process.exitCode = 1;
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
    const evidence = buildEventEvidence(event);
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

/**
 * Where the personal-relevance funnel narrows. A personal claim needs an
 * established preference on one side and a descriptive, characterizable event
 * attribute on the other; this counts each half and their intersection.
 */
function bottleneck(events, assessments, preferences) {
  const DISTINCT = new Set(['dance_floor', 'festival_multi_stage', 'seated_listening']);
  const counts = {
    withDirectArtist: 0,
    withDescriptiveModelFacts: 0,
    withBoth: 0,
    assessed: 0,
    withDistinctCharacterization: 0,
    withDirectArtistAndDistinctCharacterization: 0,
    tasteProfileTags: (preferences?.topTags ?? []).length
  };
  for (const event of events) {
    const direct = preferenceSignalsFor(event, preferences).directArtists.length > 0;
    const facts = serializeEventEvidenceForModel(buildEventEvidence(event)).publishedFacts ?? {};
    const descriptive = ['classification', 'format', 'namedLineup'].some((field) => facts[field] != null);
    const assessment = assessments.get(String(event.id));
    const distinct = Boolean(assessment && DISTINCT.has(assessment.experienceCharacter) && assessment.certainty?.experienceCharacter !== 'low');
    if (direct) counts.withDirectArtist += 1;
    if (descriptive) counts.withDescriptiveModelFacts += 1;
    if (direct && descriptive) counts.withBoth += 1;
    if (assessment) counts.assessed += 1;
    if (distinct) counts.withDistinctCharacterization += 1;
    if (direct && distinct) counts.withDirectArtistAndDistinctCharacterization += 1;
  }
  return counts;
}

function summarizeComparisons(comparisons) {
  const results = comparisons.map(({ result }) => result);
  const count = (predicate) => results.filter(predicate).length;
  const sum = (field) => results.reduce((total, item) => total + item[field], 0);
  return {
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
    violationKinds: [...new Set(results.flatMap((item) => item.violations.map((violation) => violation.kind)))]
  };
}

function printSummary(report) {
  const { evidence, bottleneck: funnel, comparison, enrichment, telemetry } = report;
  console.log('Evidence coverage');
  console.log(`  candidates with any permitted evidence   ${evidence.withAnyEvidence}/${report.candidateCount}`);
  console.log(`  candidates with model-transmittable data ${evidence.withAnyModelInput}/${report.candidateCount}`);
  for (const [field, count] of Object.entries(evidence.present)) {
    if (!count && !evidence.modelEligible[field]) continue;
    console.log(`    ${field.padEnd(15)} present ${String(count).padStart(3)}  model-eligible ${String(evidence.modelEligible[field]).padStart(3)}`);
  }

  console.log('\nPersonal-relevance funnel');
  console.log(`  direct artist match                        ${funnel.withDirectArtist}`);
  console.log(`  descriptive model facts (genre/format/lineup) ${funnel.withDescriptiveModelFacts}`);
  console.log(`  both                                       ${funnel.withBoth}`);
  console.log(`  assessed by Jev                            ${funnel.assessed}`);
  console.log(`  distinct experience characterized          ${funnel.withDistinctCharacterization}`);
  console.log(`  direct artist + distinct experience        ${funnel.withDirectArtistAndDistinctCharacterization}`);
  console.log(`  taste-profile tags available               ${funnel.tasteProfileTags}`);

  console.log('\nBaseline (source extraction only) vs revised');
  console.log(`  cards with an insight          ${comparison.cardsBaseline} → ${comparison.cardsRevised}`);
  console.log(`  cards with new information     ${comparison.cardsWithNewInformation}`);
  console.log(`  cards with a model-derived claim ${comparison.cardsWithModelDerivedClaim}`);
  console.log(`  cards with a personal claim    ${comparison.cardsWithPersonalClaim}`);
  console.log(`  claims: documented ${comparison.claims.documented} · model-derived ${comparison.claims.modelDerived} · personal ${comparison.claims.personal} · uncertainty/conflict ${comparison.claims.uncertainty}`);
  console.log(`  grounding violations           ${comparison.violations}${comparison.violationKinds.length ? ` (${comparison.violationKinds.join(', ')})` : ''}`);

  console.log('\nInference');
  console.log(`  model-eligible candidates     ${enrichment.modelEligibleCandidateCount}`);
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
