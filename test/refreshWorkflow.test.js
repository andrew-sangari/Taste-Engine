import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createValidationManifest,
  feedbackSimulationArgs,
  promoteValidatedPreview,
  rollbackPromotion,
  validatePreview
} from '../src/refreshWorkflow.js';

test('enabled feedback capture schedules a private shadow report without activating publication', () => {
  assert.deepEqual(feedbackSimulationArgs({ feedback: { enabled: true, applyToPublishedRanking: false } }), ['src/cli/taste-feedback.js', 'simulate']);
  assert.equal(feedbackSimulationArgs({ feedback: { enabled: false, applyToPublishedRanking: false } }), null);
  assert.throws(() => feedbackSimulationArgs({ feedback: { enabled: true, applyToPublishedRanking: true } }), /must remain disabled/);
});

function projection(overrides = {}) {
  const event = { id: 'event:1', title: 'Synthetic event', ranking: { utility: 60 } };
  return {
    schemaVersion: 5,
    generatedAt: '2026-07-12T12:00:00.000Z',
    horizon: { startDate: '2026-07-12', endDate: '2027-01-08' },
    events: [event], sports: [], movies: [],
    sourceHealth: [{ source: 'seatgeek', status: 'active', itemCount: 1, warningCount: 0 }],
    overview: [{ id: event.id }], overviewPlanAhead: [],
    ...overrides
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'taste-refresh-'));
  const preview = join(root, 'preview');
  const accepted = join(root, 'accepted');
  for (const dir of [preview, accepted]) {
    await mkdir(join(dir, 'site', 'app', 'data'), { recursive: true });
    await mkdir(join(dir, 'site', 'dist', 'client'), { recursive: true });
    await mkdir(join(dir, 'site', 'dist', 'server'), { recursive: true });
    await writeFile(join(dir, 'site', 'app', 'data', 'upcoming.json'), `${JSON.stringify(projection())}\n`);
    await writeFile(join(dir, 'site', 'dist', 'client', 'index.html'), '<main>Taste Engine</main>');
    await writeFile(join(dir, 'site', 'dist', 'server', 'index.js'), 'export default {};');
  }
  return { root, preview, accepted };
}

test('validation fails closed on duplicate IDs, private artifacts, active feedback, and collapse', async () => {
  const { preview, accepted } = await fixture();
  const duplicate = projection({ events: [{ id: 'same' }, { id: 'same' }], overview: [{ id: 'same' }] });
  await writeFile(join(preview, 'site', 'app', 'data', 'upcoming.json'), JSON.stringify(duplicate));
  await writeFile(join(preview, 'site', 'dist', 'client', 'feedback-report.json'), '{}');
  const result = await validatePreview({ previewDir: preview, acceptedDir: accepted, feedbackApplicationEnabled: true });
  assert.equal(result.ok, false);
  const codes = result.errors.map((item) => item.code);
  for (const code of ['duplicate-published-id', 'feedback-application-active', 'private-artifact-public']) assert.ok(codes.includes(code));

  await writeFile(join(preview, 'site', 'app', 'data', 'upcoming.json'), JSON.stringify(projection({ events: [], overview: [] })));
  const collapsed = await validatePreview({ previewDir: preview, acceptedDir: accepted });
  assert.ok(collapsed.errors.some((item) => item.code === 'candidate-collapse'));
});

test('validation manifest detects any preview change after validation', async () => {
  const { preview, accepted } = await fixture();
  const validation = await validatePreview({ previewDir: preview, acceptedDir: accepted });
  assert.equal(validation.ok, true);
  const manifest = await createValidationManifest({ previewDir: preview, validation });
  await writeFile(join(preview, 'site', 'dist', 'client', 'index.html'), '<main>changed</main>');
  await assert.rejects(
    promoteValidatedPreview({ previewDir: preview, acceptedDir: accepted, manifest, confirmation: 'PROMOTE' }),
    /changed after validation/
  );
});

test('promotion requires confirmation, preserves rollback, and rollback restores accepted bytes', async () => {
  const { root, preview, accepted } = await fixture();
  await writeFile(join(preview, 'site', 'app', 'data', 'upcoming.json'), `${JSON.stringify(projection({ events: [{ id: 'event:2', title: 'Synthetic event', ranking: { utility: 60 } }], overview: [{ id: 'event:2' }] }))}\n`);
  const validation = await validatePreview({ previewDir: preview, acceptedDir: accepted, thresholds: { maxCountChange: 1 } });
  assert.equal(validation.ok, true);
  const manifest = await createValidationManifest({ previewDir: preview, validation });
  await assert.rejects(promoteValidatedPreview({ previewDir: preview, acceptedDir: accepted, manifest }), /explicit confirmation/);
  const before = await readFile(join(accepted, 'site', 'app', 'data', 'upcoming.json'), 'utf8');
  const promotion = await promoteValidatedPreview({
    previewDir: preview,
    acceptedDir: accepted,
    rollbackRoot: join(root, 'rollback'),
    manifest,
    confirmation: 'PROMOTE'
  });
  assert.match(await readFile(join(accepted, 'site', 'app', 'data', 'upcoming.json'), 'utf8'), /event:2/);
  await rollbackPromotion({ acceptedDir: accepted, rollbackDir: promotion.rollbackDir, confirmation: 'ROLLBACK' });
  assert.equal(await readFile(join(accepted, 'site', 'app', 'data', 'upcoming.json'), 'utf8'), before);
});
