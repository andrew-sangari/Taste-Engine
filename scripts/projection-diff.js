import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sanitizeDiagnosticString } from '../src/diagnostics.js';
import { diffProjections, formatProjectionDiff } from '../src/projectionDiff.js';

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const beforePath = positional[0];
const afterPath = positional[1];

if (!beforePath || !afterPath) {
  console.error('Usage: npm run projection:diff -- before.json after.json [--json] [--json-out path] [--max-added N] [--max-removed N] [--max-count-change RATIO]');
  process.exitCode = 2;
} else {
  try {
    const before = JSON.parse(await readFile(resolve(beforePath), 'utf8'));
    const after = JSON.parse(await readFile(resolve(afterPath), 'utf8'));
    const diff = diffProjections(before, after, {
      maxAdded: numberAfter('--max-added'),
      maxRemoved: numberAfter('--max-removed'),
      maxCountChange: numberAfter('--max-count-change')
    });
    const json = `${JSON.stringify(diff, null, 2)}\n`;
    const jsonOut = valueAfter('--json-out');
    if (jsonOut) await writeFile(resolve(jsonOut), json);
    if (args.includes('--json')) {
      process.stdout.write(json);
    } else {
      process.stdout.write(formatProjectionDiff(diff));
      process.stdout.write('\n--- machine-readable JSON ---\n');
      process.stdout.write(json);
    }
    process.exitCode = diff.exitCode;
  } catch (error) {
    console.error(`Projection diff failed: ${sanitizeDiagnosticString(error?.message ?? error)}`);
    process.exitCode = 1;
  }
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function numberAfter(flag) {
  const value = valueAfter(flag);
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
