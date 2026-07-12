import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  await mkdir(join(rollbackDir, 'site/app/data'), { recursive: true });
  await cp(join(root, 'site/app/data/upcoming.json'), join(rollbackDir, 'site/app/data/upcoming.json'));
  await cp(join(root, 'site/dist'), join(rollbackDir, 'site/dist'), { recursive: true });
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
  const projection = join(targetRoot, 'site/app/data/upcoming.json');
  const bundle = join(targetRoot, 'site/dist');
  const stagedProjection = `${projection}.staging-${process.pid}`;
  const stagedBundle = `${bundle}.staging-${process.pid}`;
  const oldProjection = `${projection}.previous-${process.pid}`;
  const oldBundle = `${bundle}.previous-${process.pid}`;
  await cp(join(sourceRoot, 'site/app/data/upcoming.json'), stagedProjection);
  await cp(join(sourceRoot, 'site/dist'), stagedBundle, { recursive: true });
  let projectionMoved = false;
  let bundleMoved = false;
  try {
    await rename(projection, oldProjection); projectionMoved = true;
    await rename(bundle, oldBundle); bundleMoved = true;
    await rename(stagedProjection, projection);
    await rename(stagedBundle, bundle);
    await rm(oldProjection, { force: true });
    await rm(oldBundle, { recursive: true, force: true });
  } catch (error) {
    await rm(stagedProjection, { force: true });
    await rm(stagedBundle, { recursive: true, force: true });
    if (projectionMoved) { await rm(projection, { force: true }); await rename(oldProjection, projection); }
    if (bundleMoved) { await rm(bundle, { recursive: true, force: true }); await rename(oldBundle, bundle); }
    throw error;
  }
}

function valueAfter(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; }
