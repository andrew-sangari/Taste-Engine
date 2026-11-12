import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValidationManifest, validatePreview, writeValidationManifest } from '../refreshWorkflow.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const previewDir = resolve(root, 'data/taste/workflow/previews/latest');
const manifestPath = resolve(root, 'data/taste/workflow/latest-validation.json');

try {
  const validation = await validatePreview({ previewDir, acceptedDir: root, rebaseline: process.argv.includes('--rebaseline') });
  if (!validation.ok) throw new Error(validation.errors.map((item) => item.code).join(', '));
  await writeValidationManifest(manifestPath, await createValidationManifest({ previewDir, validation }));
  console.log(`Preview validated: ${previewDir}`);
} catch (error) {
  console.error(`Taste validation failed: ${String(error?.message ?? error).slice(0, 500)}`);
  process.exitCode = 1;
}
