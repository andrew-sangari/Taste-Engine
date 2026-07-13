import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { diffProjections } from './projectionDiff.js';

const REQUIRED_PROJECTION_FIELDS = ['schemaVersion', 'generatedAt', 'horizon', 'events', 'sports', 'movies', 'sourceHealth', 'overview', 'overviewPlanAhead'];
const COLLECTIONS = ['events', 'sports', 'movies'];
const PRIVATE_NAME = /(?:build-report|feedback-report|feedback-state|feedback-snapshots|feedback\.jsonl|personal-context|spotify-playlists|\.env)/i;

export const DEFAULT_WORKFLOW_PATHS = Object.freeze({
  workflowRoot: 'data/taste/workflow',
  acceptedProjection: 'site/app/data/upcoming.json',
  acceptedBundle: 'site/dist'
});

export function feedbackSimulationArgs(config) {
  if (config?.feedback?.applyToPublishedRanking === true) throw new Error('Published feedback application must remain disabled.');
  return config?.feedback?.enabled === true ? ['src/cli/taste-feedback.js', 'simulate'] : null;
}

export async function validatePreview({
  previewDir,
  acceptedDir = null,
  feedbackApplicationEnabled = false,
  thresholds = { maxAdded: 50, maxRemoved: 25, maxCountChange: 0.35 },
  browserSmokePassed = true
}) {
  const errors = [];
  const warnings = [];
  const projectionPath = join(previewDir, 'site', 'app', 'data', 'upcoming.json');
  let projection;
  try {
    projection = JSON.parse(await readFile(projectionPath, 'utf8'));
  } catch {
    errors.push(issue('schema-validation', 'The preview projection is missing or malformed.'));
  }

  if (projection) {
    const missing = REQUIRED_PROJECTION_FIELDS.filter((field) => !Object.hasOwn(projection, field));
    if (projection.schemaVersion !== 5 || missing.length) errors.push(issue('schema-validation', `Projection schema is invalid; missing ${missing.join(', ') || 'no fields'}.`));
    const ids = COLLECTIONS.flatMap((key) => (Array.isArray(projection[key]) ? projection[key] : []).map((item) => item?.id).filter(Boolean));
    if (new Set(ids).size !== ids.length) errors.push(issue('duplicate-published-id', 'Published candidate arrays contain duplicate IDs.'));
    if (!Array.isArray(projection.sourceHealth)) errors.push(issue('source-health-inconsistent', 'Source health must be an array.'));
    if (ids.length > 0 && !Array.isArray(projection.overview)) errors.push(issue('overview-invalid', 'Overview must be present when candidates exist.'));
  }

  const publicFiles = await listFiles(join(previewDir, 'site', 'dist'));
  if (!publicFiles.length) errors.push(issue('build-failure', 'Preview bundle is missing.'));
  if (!publicFiles.some((path) => path.endsWith('/client/index.html') || path.endsWith('/server/index.js'))) errors.push(issue('required-asset-missing', 'Preview has no client or server entry point.'));
  if (publicFiles.some((path) => PRIVATE_NAME.test(basename(path)))) errors.push(issue('private-artifact-public', 'A private artifact was copied into the public bundle.'));
  if (feedbackApplicationEnabled) errors.push(issue('feedback-application-active', 'Published feedback application must remain disabled.'));
  if (!browserSmokePassed) errors.push(issue('browser-smoke-failure', 'Browser smoke validation failed.'));

  for (const path of [projectionPath, ...publicFiles.filter((file) => /\.(?:js|json|html|css|md|txt)$/i.test(file))]) {
    const content = await safeRead(path);
    if (/^(?:<{7}|={7}|>{7})/m.test(content)) {
      errors.push(issue('merge-conflict-marker', `Unresolved merge marker in ${relative(previewDir, path)}.`));
      break;
    }
  }

  let diff = null;
  if (projection && acceptedDir) {
    try {
      const accepted = JSON.parse(await readFile(join(acceptedDir, 'site', 'app', 'data', 'upcoming.json'), 'utf8'));
      const beforeCount = COLLECTIONS.reduce((sum, key) => sum + (accepted[key]?.length ?? 0), 0);
      const afterCount = COLLECTIONS.reduce((sum, key) => sum + (projection[key]?.length ?? 0), 0);
      if (beforeCount > 0 && afterCount === 0) errors.push(issue('candidate-collapse', 'Candidates collapsed to zero from a previously non-empty projection.'));
      diff = diffProjections(accepted, projection, thresholds);
      if (!diff.structurallyCompatible) errors.push(issue('projection-structural-diff', 'Projection diff is structurally incompatible.'));
      if (diff.thresholds.exceeded) errors.push(issue('projection-collapse-threshold', `Projection thresholds exceeded: ${diff.thresholds.reasons.join(', ')}.`));
    } catch {
      errors.push(issue('projection-diff-failure', 'The material projection diff could not be generated.'));
    }
  }

  for (const health of projection?.sourceHealth ?? []) {
    if (['unavailable', 'not configured', 'partial'].includes(health?.status)) warnings.push(issue('optional-source-degraded', `${String(health.source ?? 'optional source')} is ${health.status}.`));
  }
  return { validationVersion: 1, ok: errors.length === 0, errors, warnings, diff };
}

export async function createValidationManifest({ previewDir, validation }) {
  if (!validation?.ok) throw new Error('Cannot seal an invalid preview.');
  return {
    manifestVersion: 1,
    previewDir: resolve(previewDir),
    contentSha256: await hashTree(previewDir),
    validation
  };
}

export async function writeValidationManifest(path, manifest) {
  await atomicWrite(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function promoteValidatedPreview({
  previewDir,
  acceptedDir,
  rollbackRoot = join(dirname(resolve(acceptedDir)), 'rollback'),
  manifest,
  confirmation
}) {
  if (confirmation !== 'PROMOTE') throw new Error('Promotion requires explicit confirmation: PROMOTE.');
  if (!manifest?.validation?.ok) throw new Error('Promotion requires a validated preview.');
  const currentHash = await hashTree(previewDir);
  if (currentHash !== manifest.contentSha256) throw new Error('Preview changed after validation; validate it again.');
  const accepted = resolve(acceptedDir);
  const rollbackDir = join(resolve(rollbackRoot), `accepted-${manifest.contentSha256.slice(0, 12)}`);
  await rm(rollbackDir, { recursive: true, force: true });
  await mkdir(dirname(rollbackDir), { recursive: true });
  await cp(accepted, rollbackDir, { recursive: true });
  await replaceDirectory(previewDir, accepted);
  return { rollbackDir, contentSha256: manifest.contentSha256 };
}

export async function rollbackPromotion({ acceptedDir, rollbackDir, confirmation }) {
  if (confirmation !== 'ROLLBACK') throw new Error('Rollback requires explicit confirmation: ROLLBACK.');
  await stat(rollbackDir);
  await replaceDirectory(rollbackDir, acceptedDir);
}

export async function hashTree(root) {
  const hash = createHash('sha256');
  for (const path of await listFiles(root)) {
    hash.update(relative(root, path));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function replaceDirectory(source, destination) {
  const target = resolve(destination);
  const staging = `${target}.staging-${process.pid}`;
  const previous = `${target}.previous-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await rm(previous, { recursive: true, force: true });
  await cp(source, staging, { recursive: true });
  let movedPrevious = false;
  try {
    await rename(target, previous);
    movedPrevious = true;
    await rename(staging, target);
    await rm(previous, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (movedPrevious) {
      await rm(target, { recursive: true, force: true });
      await rename(previous, target);
    }
    throw error;
  }
}

async function listFiles(root) {
  const output = [];
  async function visit(path) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) output.push(child);
    }
  }
  await visit(resolve(root));
  return output;
}

async function atomicWrite(path, content) {
  const target = resolve(path);
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
}

async function safeRead(path) {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}

function issue(code, message) {
  return { code, message };
}
