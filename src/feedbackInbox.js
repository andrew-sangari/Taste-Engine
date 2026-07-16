import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { deriveFeedbackState, loadFeedbackConfig, readFeedbackJournal, writeJsonAtomic } from './feedback.js';
import { importSiteFeedback } from './siteFeedbackImport.js';

export const FEEDBACK_INBOX_PATTERN = /^feedback-inbox-.*\.jsonl$/;

export async function processFeedbackInbox({
  root = process.cwd(),
  args = [],
  env = process.env,
  now = new Date()
} = {}) {
  const report = {
    enabled: false,
    scannedCount: 0,
    processedCount: 0,
    newCount: 0,
    duplicateCount: 0,
    archivedCount: 0,
    warningCodes: []
  };
  const settings = await loadInboxSettings(root, env);
  const forced = args.includes('--import-feedback');
  const suppressed = args.includes('--no-import-feedback');
  report.enabled = !suppressed && (forced || settings.enabled);
  if (!report.enabled) return report;

  const inboxPath = resolve(settings.inboxPath);
  const entries = await readdir(inboxPath, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    report.warningCodes.push('feedback-inbox-unavailable');
    return [];
  });
  const files = entries.filter((entry) => entry.isFile() && FEEDBACK_INBOX_PATTERN.test(entry.name))
    .map((entry) => join(inboxPath, entry.name)).sort();
  report.scannedCount = files.length;

  const ledger = await readLedger(settings.ledgerPath);
  const feedbackConfig = await loadFeedbackConfig(join(root, 'config/feedback.json'));
  const journalPath = resolve(root, feedbackConfig.journalPath);
  const snapshotIndexPath = resolve(root, 'data/taste/feedback-snapshots.json');

  for (const filePath of files) {
    const hash = await hashFile(filePath).catch(() => null);
    if (!hash) {
      report.warningCodes.push('feedback-inbox-read-failed');
      continue;
    }
    if (!ledger.processed[hash]) {
      const imported = await importSiteFeedback({ filePath, journalPath, snapshotIndexPath });
      if (imported.errors.length) {
        report.warningCodes.push('feedback-inbox-invalid');
        continue;
      }
      ledger.processed[hash] = {
        processedAt: new Date(now).toISOString(),
        sourceName: basename(filePath),
        archived: false
      };
      await writeLedger(settings.ledgerPath, ledger);
      report.processedCount += 1;
      report.newCount += imported.newCount;
      report.duplicateCount += imported.duplicateCount;
    } else {
      report.duplicateCount += 1;
    }

    const archived = await archiveFile(filePath, settings.archivePath, hash);
    if (archived) {
      ledger.processed[hash].archived = true;
      ledger.processed[hash].archivedAt = new Date(now).toISOString();
      await writeLedger(settings.ledgerPath, ledger);
      report.archivedCount += 1;
    } else {
      report.warningCodes.push('feedback-inbox-archive-failed');
    }
  }

  if (report.newCount > 0) {
    const journal = await readFeedbackJournal(journalPath);
    const state = deriveFeedbackState(journal.records, { journalIssues: journal.issues, config: feedbackConfig });
    await writeJsonAtomic(resolve(root, feedbackConfig.statePath), state);
  }
  report.warningCodes = [...new Set(report.warningCodes)];
  return report;
}

export async function loadInboxSettings(root, env = process.env) {
  const shared = await readOptionalJson(join(root, 'config/feedback.json'));
  const local = await readOptionalJson(join(root, 'config/feedback.local.json'));
  const base = shared?.autoImport && typeof shared.autoImport === 'object' ? shared.autoImport : {};
  const override = local?.autoImport && typeof local.autoImport === 'object' ? local.autoImport : {};
  const value = { ...base, ...override };
  const stateRoot = resolve(root, value.stateRoot ?? 'data/taste/feedback-inbox');
  return {
    enabled: value.enabled === true,
    inboxPath: env.TASTE_FEEDBACK_INBOX || value.inboxPath || join(homedir(), 'Downloads'),
    ledgerPath: join(stateRoot, 'processed.json'),
    archivePath: join(stateRoot, 'archive')
  };
}

async function readLedger(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value?.version === 1 && value.processed && typeof value.processed === 'object') return value;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('Feedback inbox ledger is invalid.');
  }
  return { version: 1, processed: {} };
}

async function writeLedger(path, ledger) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function archiveFile(source, archiveRoot, hash) {
  try {
    await mkdir(archiveRoot, { recursive: true });
    const target = join(archiveRoot, `${hash.slice(0, 12)}-${basename(source)}`);
    const exists = await stat(target).then(() => true).catch(() => false);
    if (exists) {
      await rm(source);
      return true;
    }
    try {
      await rename(source, target);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      await cp(source, target);
      await rm(source);
    }
    return true;
  } catch {
    return false;
  }
}

async function hashFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}
