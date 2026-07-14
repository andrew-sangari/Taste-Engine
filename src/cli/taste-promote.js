import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashTree } from '../refreshWorkflow.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const workflowRoot = join(root, 'data/taste/workflow');
const previewDir = join(workflowRoot, 'previews/latest');
const manifestPath = join(workflowRoot, 'latest-validation.json');
const args = process.argv.slice(2);

try {
  if (args.includes('--rollback')) await rollback();
  else await promote();
} catch (error) {
  console.error(`Taste promotion failed: ${String(error?.message ?? error).replace(/https?:\/\/\S+/g, '[URL REDACTED]').slice(0, 500)}`);
  process.exitCode = 1;
}

async function promote() {
  if (valueAfter('--confirm') !== 'PROMOTE') throw new Error('explicit confirmation required: --confirm PROMOTE');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest?.validation?.ok) throw new Error('validated preview required');
  if (await hashTree(previewDir) !== manifest.contentSha256) throw new Error('preview changed after validation; run taste:validate');
  const rollbackDir = join(workflowRoot, 'rollback/latest');
  await rm(rollbackDir, { recursive: true, force: true });
  await copyAcceptedArtifacts(root, rollbackDir);
  await swapAccepted(previewDir, root);
  await writeFile(join(workflowRoot, 'promotion-metadata.json'), `${JSON.stringify({
    metadataVersion: 1,
    projectionHash: manifest.contentSha256,
    rollbackPath: 'data/taste/workflow/rollback/latest'
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Promoted validated projection ${manifest.contentSha256.slice(0, 16)} locally.`);
  console.log('No remote publication was performed.');
}

async function rollback() {
  if (valueAfter('--confirm') !== 'ROLLBACK') throw new Error('explicit confirmation required: --confirm ROLLBACK');
  await swapAccepted(join(workflowRoot, 'rollback/latest'), root);
  console.log('Restored the previous accepted projection and bundle. No remote publication was performed.');
}

async function swapAccepted(sourceRoot, targetRoot) {
  const artifactPaths = [
    'site/app/data/upcoming.json',
    'site/dist',
    'data/taste/recommendation-history.json',
    'data/taste/feedback-snapshots.json'
  ];
  const artifacts = [];
  for (const relativePath of artifactPaths) {
    const source = join(sourceRoot, relativePath);
    const target = join(targetRoot, relativePath);
    const staging = `${target}.staging-${process.pid}`;
    const previous = `${target}.previous-${process.pid}`;
    await mkdir(dirname(target), { recursive: true });
    const sourceExists = await exists(source);
    if (sourceExists) await cp(source, staging, { recursive: true });
    artifacts.push({ target, staging, previous, sourceExists, moved: false, installed: false });
  }
  if (!artifacts.find((item) => item.target.endsWith('upcoming.json'))?.sourceExists
    || !artifacts.find((item) => item.target.endsWith('site/dist'))?.sourceExists) {
    throw new Error('projection and bundle are required for an accepted-artifact swap');
  }
  try {
    for (const artifact of artifacts) {
      if (await exists(artifact.target)) {
        await rename(artifact.target, artifact.previous);
        artifact.moved = true;
      }
    }
    for (const artifact of artifacts) {
      if (!artifact.sourceExists) continue;
      await rename(artifact.staging, artifact.target);
      artifact.installed = true;
    }
    for (const artifact of artifacts) await rm(artifact.previous, { recursive: true, force: true });
  } catch (error) {
    for (const artifact of [...artifacts].reverse()) {
      await rm(artifact.staging, { recursive: true, force: true });
      if (artifact.installed) await rm(artifact.target, { recursive: true, force: true });
      if (artifact.moved) await rename(artifact.previous, artifact.target);
    }
    throw error;
  }
}

async function copyAcceptedArtifacts(sourceRoot, targetRoot) {
  for (const relativePath of ['site/app/data/upcoming.json', 'site/dist', 'data/taste/recommendation-history.json', 'data/taste/feedback-snapshots.json']) {
    const source = join(sourceRoot, relativePath);
    if (!await exists(source)) continue;
    const target = join(targetRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
}

async function exists(path) { return stat(path).then(() => true).catch(() => false); }

function valueAfter(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; }
