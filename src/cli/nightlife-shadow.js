import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadEnv } from '../env.js';
import { describeNightlifeConfig, nightlifeInferenceConfigured, readNightlifeConfig } from '../nightlife/config.js';
import { createDecisionInferenceProvider } from '../nightlife/inference.js';
import { normalizeNightlifeContext } from '../nightlife/context.js';
import { discoverNightlife } from '../nightlife/discovery.js';
import { sanitizeDiagnosticValue } from '../diagnostics.js';

/**
 * Shadow evaluation.
 *
 * Runs each scenario twice against the same candidates — once deterministic,
 * once with inference — and reports what actually differed. Nothing here
 * publishes, promotes, or changes a canonical ranking; the point is to decide
 * whether inference earns its place before it influences anything.
 */
loadEnv();

const options = parseArgs(process.argv.slice(2));
const projectionPath = resolve(options.projection ?? 'site/app/data/upcoming.json');
const config = readNightlifeConfig(process.env);
const described = describeNightlifeConfig(config);

// Scenarios cover the cases issue #2 names: a good event among noise, unknown
// late-night hours, a costly itinerary, a restricted-source-only candidate,
// a preference revision, and a night where staying home is correct.
const SCENARIOS = [
  {
    id: 'late-electronic-downtown',
    goal: 'Something loud and electronic downtown that can still be going after 2am',
    startArea: 'Downtown / Arts District',
    transport: 'rideshare',
    lateNightIntent: 'out very late',
    energy: 'high',
    preferredMusic: ['house', 'techno'],
    noveltyAppetite: 'exploratory'
  },
  {
    id: 'westside-low-friction-date',
    goal: 'A date night on the Westside, nothing that turns into a cross-town slog',
    startArea: 'Westside',
    transport: 'drive',
    party: 'date',
    lateNightIntent: 'home early',
    energy: 'medium',
    noveltyAppetite: 'familiar',
    budgetUsd: 80
  }
];

try {
  const projection = JSON.parse(await readFile(projectionPath, 'utf8'));
  const events = projection.events ?? [];
  if (!events.length) throw new Error(`No events in ${projectionPath}. Run npm run site:export first.`);

  console.log(`Route      ${described.provider}${described.configured ? '' : ' (not configured)'}`);
  console.log(`Model      ${described.model ?? '—'}`);
  console.log(`Candidates ${events.length} in the projection\n`);
  if (!nightlifeInferenceConfigured(config)) {
    console.log('Inference is not configured, so this run reports the deterministic baseline only.\n');
  }

  const now = options.now ? new Date(options.now) : new Date();
  const date = options.date ?? nextSaturday(now);
  const deterministic = createDecisionInferenceProvider({ provider: 'disabled' });
  const inferred = createDecisionInferenceProvider(config);
  const scenarios = [];

  for (const scenario of SCENARIOS) {
    const context = normalizeNightlifeContext({
      ...scenario,
      date,
      earliestStart: scenario.earliestStart ?? '19:00',
      latestReturn: scenario.latestReturn ?? '03:00'
    }, { now });

    const baseline = await discoverNightlife({ events, context, provider: deterministic, now });
    const withInference = await discoverNightlife({ events, context, provider: inferred, now, refreshCache: true });
    const comparison = compare(baseline, withInference);
    scenarios.push({ id: scenario.id, goal: scenario.goal, date, considered: withInference.considered, baseline: summarize(baseline), inference: summarize(withInference), comparison });
    report(scenario, comparison, withInference);
  }

  const outputPath = resolve(options.output ?? `data/nightlife/shadow-${date}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(sanitizeDiagnosticValue({
    generatedAt: new Date(now).toISOString(),
    route: described,
    projectionGeneratedAt: projection.generatedAt ?? null,
    candidateCount: events.length,
    scenarios
  }), null, 2)}\n`);
  console.log(`Wrote the traceable comparison to ${outputPath}.`);
  console.log('No ranking, projection, or publication state was changed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function compare(baseline, inference) {
  const baselineIds = baseline.shortlist.map((entry) => entry.id);
  const inferenceIds = inference.shortlist.map((entry) => entry.id);
  const baselineSet = new Set(baselineIds);
  const inferenceSet = new Set(inferenceIds);
  const surfaced = inference.shortlist.filter((entry) => !baselineSet.has(entry.id));
  return {
    baselineShortlist: baselineIds,
    inferenceShortlist: inferenceIds,
    // A candidate inference promoted into the shortlist that determinism alone
    // would not have surfaced. This is the number that justifies the feature.
    newlySurfaced: surfaced.map((entry) => ({
      id: entry.id,
      score: entry.score,
      deterministicUtility: entry.deterministicUtility,
      contextFit: entry.assessment?.contextFit ?? null,
      certainty: entry.assessment?.certainty?.contextFit ?? null,
      reason: entry.assessment?.reason ?? null
    })),
    dropped: baseline.shortlist.filter((entry) => !inferenceSet.has(entry.id)).map((entry) => ({
      id: entry.id,
      deterministicUtility: entry.deterministicUtility
    })),
    orderChanged: baselineIds.join('|') !== inferenceIds.join('|'),
    stayHomeChanged: baseline.stayHome !== inference.stayHome
  };
}

function summarize(result) {
  return {
    stayHome: result.stayHome,
    stayHomeReason: result.stayHomeReason,
    shortlistSize: result.shortlist.length,
    excludedCount: result.excluded.length,
    planStops: result.plan?.stops?.length ?? 0,
    planConfirmed: result.plan?.confirmed ?? false,
    inference: result.inference,
    shortlist: result.shortlist.map((entry) => ({
      id: entry.id,
      restrictedSource: entry.restrictedSource,
      score: entry.score,
      deterministicUtility: entry.deterministicUtility,
      inferenceCovered: entry.inferenceCovered,
      assessment: entry.assessment,
      unknowns: entry.unknowns
    }))
  };
}

function report(scenario, comparison, result) {
  const { inference } = result;
  console.log(`— ${scenario.id}`);
  console.log(`  "${scenario.goal}"`);
  console.log(`  candidates      ${result.considered.inWindowCount} in window, ${result.considered.permittedEvidenceCount} with permitted evidence`);
  console.log(`  coverage        ${inference.coverage.covered}/${inference.coverage.requested} assessed${inference.coverage.uncovered.length ? ` (${inference.coverage.uncovered.length} fell back)` : ''}`);
  console.log(`  status          ${inference.status}`);
  if (inference.latencyMsMedian != null) console.log(`  latency         ${inference.latencyMsMedian}ms median, ${result.telemetry.latencyMsMax}ms worst, ${inference.totalMs}ms wall`);
  if (inference.costUsd != null) console.log(`  spend           $${inference.costUsd.toFixed(6)} total, $${inference.costPerAssessedCandidateUsd?.toFixed(8)} per candidate`);
  if (inference.validationFailures) console.log(`  validation      ${inference.validationFailures} rejected`);
  if (inference.errorCount) console.log(`  errors          ${inference.errorCount}`);
  console.log(`  shortlist       ${comparison.inferenceShortlist.length} (${comparison.orderChanged ? 'reordered' : 'unchanged'} vs deterministic)`);
  console.log(`  newly surfaced  ${comparison.newlySurfaced.length}`);
  for (const entry of comparison.newlySurfaced) {
    console.log(`     ${entry.id} — ${entry.contextFit}/${entry.certainty}, ${entry.deterministicUtility} → ${entry.score}`);
  }
  if (comparison.stayHomeChanged) console.log('  stay-home verdict differs from the deterministic baseline');
  console.log('');
}

function nextSaturday(now) {
  const date = new Date(now);
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
