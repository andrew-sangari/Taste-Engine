import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { updateProjectionHistory } from '../src/recommendationHistory.js';

const projectionPath = resolve(process.argv[2] ?? 'site/app/data/upcoming.json');
const projection = JSON.parse(await readFile(projectionPath, 'utf8'));
await updateProjectionHistory({ projection, now: new Date(projection.generatedAt ?? Date.now()) });
await writeFile(projectionPath, `${JSON.stringify(projection, null, 2)}\n`);
console.log(`Recommendation history ready: ${projection.recentHistory.length} recent item(s).`);
