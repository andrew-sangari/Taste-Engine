import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digestValue, normalizeProjectionForComparison, stableJson } from '../src/diagnostics.js';
import { evaluateFixture } from '../src/evaluation.js';

const args = process.argv.slice(2);
const fixturePath = valueAfter('--fixture') ?? resolve('test/fixtures/evaluation/corpus.json');
const outputPath = valueAfter('--output');
const modelMode = valueAfter('--model') ?? 'absent';
const jsonOnly = args.includes('--json');

try {
  process.env.TZ = 'America/Los_Angeles';
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const result = await evaluateFixture(fixture, { modelMode, timezone: 'America/Los_Angeles' });
  const normalized = normalizeProjectionForComparison(result.projection);
  if (outputPath) {
    const destination = resolve(outputPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, stableJson(normalized));
  }
  const summary = {
    fixture: fixturePath,
    modelMode,
    normalizedProjectionSha256: digestValue(result.projection),
    counts: {
      events: result.projection.events.length,
      sports: result.projection.sports.length,
      movies: result.projection.movies.length
    },
    overview: result.projection.overview.map((item) => item.id),
    planAhead: result.projection.overviewPlanAhead.map((item) => item.id),
    output: outputPath ?? null
  };
  if (jsonOnly) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Fixture evaluation (${modelMode})`);
    console.log(`Normalized projection: ${summary.normalizedProjectionSha256}`);
    console.log(`Candidates: ${summary.counts.events} music, ${summary.counts.sports} sports, ${summary.counts.movies} movies`);
    console.log(`Overview: ${summary.overview.join(', ') || 'empty'}`);
    console.log(`Plan Ahead: ${summary.planAhead.join(', ') || 'quiet'}`);
    if (outputPath) console.log(`Normalized projection written to ${outputPath}`);
  }
} catch (error) {
  console.error(`Fixture evaluation failed: ${String(error?.message ?? error).replace(/https?:\/\/\S+/g, '[URL REDACTED]')}`);
  process.exitCode = 1;
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
