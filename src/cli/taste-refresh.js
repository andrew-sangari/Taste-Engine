import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValidationManifest, feedbackSimulationArgs, validatePreview, writeValidationManifest } from '../refreshWorkflow.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const workflowRoot = resolve(root, 'data/taste/workflow');
const previewDir = join(workflowRoot, 'previews/latest');
const manifestPath = join(workflowRoot, 'latest-validation.json');
const reportPath = join(workflowRoot, 'latest-refresh-report.json');
const args = new Set(process.argv.slice(2));

try {
  await rm(previewDir, { recursive: true, force: true });
  await mkdir(previewDir, { recursive: true });
  await copyWorkspace(previewDir);

  const playlistSyncAvailable = await preflightPlaylistSync();
  const mode = playlistSyncAvailable && !args.has('--cached-only') ? 'live-isolated' : 'cached-projection';
  const warnings = [];
  if (mode === 'live-isolated') {
    await run(process.execPath, ['scripts/build-site.js'], previewDir);
  } else {
    warnings.push('Playlist Sync unavailable or cached-only requested; reused the last accepted projection.');
    await run(npm(), ['run', 'build'], join(previewDir, 'site'));
  }

  const feedback = JSON.parse(await readFile(join(root, 'config/feedback.json'), 'utf8'));
  const simulationArgs = feedbackSimulationArgs(feedback);
  if (simulationArgs) await run(process.execPath, simulationArgs, previewDir);

  let browserSmokePassed = true;
  if (args.has('--browser')) {
    try { await run(npm(), ['run', 'test:browser'], join(previewDir, 'site')); }
    catch { browserSmokePassed = false; }
  }
  const validation = await validatePreview({
    previewDir,
    acceptedDir: root,
    feedbackApplicationEnabled: feedback?.feedback?.applyToPublishedRanking === true,
    browserSmokePassed
  });
  if (!validation.ok) throw new Error(`Preview validation failed: ${validation.errors.map((item) => item.code).join(', ')}`);
  const manifest = await createValidationManifest({ previewDir, validation });
  await writeValidationManifest(manifestPath, manifest);
  await writePrivateJson(reportPath, {
    reportVersion: 1,
    mode,
    validated: true,
    previewHash: manifest.contentSha256,
    warningCodes: [...validation.warnings.map((item) => item.code), ...warnings.map(() => 'cache-reuse')],
    browserSmoke: args.has('--browser') ? 'passed' : 'not requested'
  });
  console.log(`Validated preview ready: ${previewDir}`);
  console.log(`Projection: ${manifest.contentSha256.slice(0, 16)} (${mode})`);
  if (warnings.length) console.log('Warning: Playlist Sync was unavailable; accepted cached projection was used.');
} catch (error) {
  console.error(`Taste refresh failed: ${safeMessage(error)}`);
  process.exitCode = 1;
}

async function copyWorkspace(destination) {
  for (const name of ['src', 'scripts', 'config', 'site', 'package.json', '.env']) {
    const source = join(root, name);
    await cp(source, join(destination, name), {
      recursive: true,
      force: true,
      filter: (path) => !/(?:^|\/)(?:node_modules|dist|\.next|\.vinext|\.git|\.wrangler|test-results)(?:\/|$)/.test(path)
    }).catch((error) => {
      if (name !== '.env' || error?.code !== 'ENOENT') throw error;
    });
  }
  await copyPrivateData(destination);
  await symlink(join(root, 'site/node_modules'), join(destination, 'site/node_modules'), 'dir');
}

async function copyPrivateData(destination) {
  const dataRoot = join(root, 'data');
  const entries = await readdir(dataRoot, { withFileTypes: true }).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error));
  for (const entry of entries) {
    const source = join(dataRoot, entry.name);
    const target = join(destination, 'data', entry.name);
    if (entry.name !== 'taste') {
      await cp(source, target, { recursive: true, force: true });
      continue;
    }
    await mkdir(target, { recursive: true });
    const tasteEntries = await readdir(source, { withFileTypes: true });
    for (const tasteEntry of tasteEntries) {
      if (tasteEntry.name === 'workflow') continue;
      await cp(join(source, tasteEntry.name), join(target, tasteEntry.name), { recursive: true, force: true });
    }
  }
}

async function preflightPlaylistSync() {
  try {
    const response = await fetch('http://127.0.0.1:4317/api/status', { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch { return false; }
}

function run(command, childArgs, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, childArgs, { cwd, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`)));
  });
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function npm() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }
function safeMessage(error) { return String(error?.message ?? error).replace(/https?:\/\/\S+/g, '[URL REDACTED]').slice(0, 500); }
