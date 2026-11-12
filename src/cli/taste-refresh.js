import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValidationManifest, feedbackSimulationArgs, validatePreview, writeValidationManifest } from '../refreshWorkflow.js';
import { processFeedbackInbox } from '../feedbackInbox.js';
import { getSpotifyAuthStatus } from '../spotifyClient.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const workflowRoot = resolve(root, 'data/taste/workflow');
const previewDir = join(workflowRoot, 'previews/latest');
const manifestPath = join(workflowRoot, 'latest-validation.json');
const reportPath = join(workflowRoot, 'latest-refresh-report.json');
const args = new Set(process.argv.slice(2));

try {
  const inbox = await processFeedbackInbox({ root, args: process.argv.slice(2) });
  if (inbox.enabled) {
    console.log(`Feedback inbox: ${inbox.scannedCount} file(s), ${inbox.newCount} new record(s), ${inbox.archivedCount} archived.`);
    if (inbox.warningCodes.length) console.log(`Feedback inbox warnings: ${inbox.warningCodes.join(', ')}.`);
  }
  await rm(previewDir, { recursive: true, force: true });
  await mkdir(previewDir, { recursive: true });
  await copyWorkspace(previewDir);

  // Three ways to refresh, best first. Spotify is Taste Engine's own
  // connection now (npm run spotify:connect); nothing else has to be running.
  //   live-isolated      Spotify connected: reseed taste, then every source.
  //   live-sources       Not connected, but a seed exists: keep the last valid
  //                      Spotify snapshot and still refresh every other source.
  //   cached-projection  Asked for, or nothing to seed from: rebuild the last
  //                      accepted projection unchanged.
  const spotify = preflightSpotify();
  const seedExists = await readFile(join(root, 'data/taste/artists.json'), 'utf8').then(() => true, () => false);
  const mode = args.has('--cached-only') ? 'cached-projection'
    : spotify.connected ? 'live-isolated'
      : seedExists ? 'live-sources' : 'cached-projection';
  const warnings = [];
  if (mode === 'live-isolated') {
    await run(process.execPath, ['scripts/build-site.js'], previewDir);
  } else if (mode === 'live-sources') {
    warnings.push(`${spotify.warning} Reused the last valid Spotify snapshot and refreshed every other source.`);
    await run(process.execPath, ['scripts/build-site.js', '--skip-seed'], previewDir);
  } else {
    warnings.push(args.has('--cached-only') ? 'Cached-only refresh requested; reused the last accepted projection.' : `${spotify.warning} No taste seed exists yet; reused the last accepted projection.`);
    await run(process.execPath, ['scripts/update-recommendation-history.js'], previewDir);
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
    rebaseline: args.has('--rebaseline'),
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
    warningCodes: [...validation.warnings.map((item) => item.code), ...warnings.map(() => mode === 'live-sources' ? 'spotify-snapshot-reuse' : 'cache-reuse')],
    rebaseline: args.has('--rebaseline'),
    browserSmoke: args.has('--browser') ? 'passed' : 'not requested'
  });
  console.log(`Validated preview ready: ${previewDir}`);
  console.log(`Projection: ${manifest.contentSha256.slice(0, 16)} (${mode})`);
  if (warnings.length) console.log(`Warning: ${warnings.join(' ')}`);
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
      // The preview never needs the credential: Spotify state always resolves
      // to the canonical data directory (see resolveSpotifyStateDir).
      if (tasteEntry.name === 'workflow' || tasteEntry.name === 'spotify-token.json') continue;
      await cp(join(source, tasteEntry.name), join(target, tasteEntry.name), { recursive: true, force: true });
    }
  }
}

function preflightSpotify() {
  const status = getSpotifyAuthStatus();
  if (!status.connected) {
    return { connected: false, warning: 'Spotify is not connected (run `npm run spotify:connect`).' };
  }
  if (status.missingScopes.includes('user-top-read')) {
    console.log('Spotify preflight: connected; user-top-read is missing, so Top Artists will fall back without blocking playlist evidence.');
  } else {
    console.log('Spotify preflight: connected.');
  }
  return { connected: true, warning: null };
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
