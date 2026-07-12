import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sanitizeDiagnosticString } from '../src/diagnostics.js';

const args = process.argv.slice(2);
const eventId = valueAfter('--event-id');
const reportPath = resolve(valueAfter('--report') ?? 'data/taste/build-report.json');

if (!eventId) {
  console.error('Usage: npm run taste:explain -- --event-id <canonical-id> [--report data/taste/build-report.json]');
  process.exitCode = 2;
} else {
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const trace = report.ranking?.candidateTraces?.[eventId];
    if (!trace) {
      console.error(`No private evaluation trace was found for ${sanitizeDiagnosticString(eventId)}.`);
      process.exitCode = 1;
    } else {
      printTrace(trace);
    }
  } catch (error) {
    console.error(`Taste explanation failed: ${sanitizeDiagnosticString(error?.message ?? error)}`);
    process.exitCode = 1;
  }
}

function printTrace(trace) {
  console.log(`Taste Engine explanation: ${safe(trace.id)}`);
  console.log(`Vertical: ${safe(trace.vertical)}`);
  console.log(`Sources: ${(trace.sourceOccurrences ?? []).map((item) => safe(item.source)).filter(Boolean).join(', ') || 'unknown'}`);
  console.log(`Source occurrences: ${(trace.sourceOccurrences ?? []).map((item) => `${safe(item.source)} on ${safe(item.date || 'unknown date')} (venue ${item.venuePresent ? 'present' : 'unknown'})`).join('; ') || 'none'}`);
  console.log(`Matched artists: ${(trace.identity?.matchedArtists ?? []).map((item) => `${safe(item.name)} (${safe(item.origin)}, ${safe(item.matchMethod)})`).join('; ') || 'none'}`);
  console.log(`Unresolved performers: ${(trace.identity?.unresolvedPerformers ?? []).map((item) => safe(item.name)).join(', ') || 'none'}`);
  console.log(`Taste evidence: playlist ${trace.tasteEvidence?.playlistAffinity ?? 'unknown'}, Top Artists ${trace.tasteEvidence?.topItemsAffinity ?? 'unknown'}, corroboration ${trace.tasteEvidence?.corroborationBonus ?? 'unknown'}`);
  console.log(`Hassle: ${trace.hassle?.score ?? 'unknown'} — ${(trace.hassle?.reasons ?? []).join('; ') || 'no summarized reasons'}`);
  console.log(`Urgency: ${trace.hassle?.urgency ?? 'unknown'}`);
  console.log(`Ranking: utility ${trace.ranking?.utility ?? 'unknown'}, confidence ${trace.ranking?.confidence ?? 'unknown'}, excluded ${trace.ranking?.excluded ? 'yes' : 'no'}`);
  console.log(`Why you: ${safe(trace.ranking?.whyYou ?? 'No deterministic explanation recorded.')}`);
  console.log(`Overview: ${trace.eligibility?.currentOverview ? 'eligible/current' : 'not current'}`);
  console.log(`Plan Ahead: ${trace.eligibility?.planAhead ? 'eligible' : 'not eligible'}`);
  console.log(`Model: ${trace.model?.mode ?? 'unknown'}; enhanced ${trace.model?.enhanced ? 'yes' : 'no'}`);
}

function safe(value) {
  return sanitizeDiagnosticString(value ?? '').slice(0, 240);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
