import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashTree } from '../refreshWorkflow.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const previewDir = resolve(root, 'data/taste/workflow/previews/latest');
try {
  const manifest = JSON.parse(await readFile(resolve(root, 'data/taste/workflow/latest-validation.json'), 'utf8'));
  if (await hashTree(previewDir) !== manifest.contentSha256) throw new Error('validated preview is stale; run taste:validate');
  console.log(`Serving validated projection ${manifest.contentSha256.slice(0, 16)} at http://127.0.0.1:4173`);
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'start', '--', '--hostname', '127.0.0.1', '--port', '4173'], { cwd: resolve(previewDir, 'site'), stdio: 'inherit' });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(`Taste preview failed: ${String(error?.message ?? error).slice(0, 500)}`);
  process.exitCode = 1;
}
