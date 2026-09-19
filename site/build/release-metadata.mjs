import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(siteRoot, "..");

export function resolveReleaseMetadata({ env = process.env, cwd = repositoryRoot, source = undefined } = {}) {
  const packageVersion = JSON.parse(readFileSync(resolve(siteRoot, "package.json"), "utf8")).version;
  const declaredCommit = normalizedCommit(env.TASTE_ENGINE_COMMIT_SHA);
  const git = declaredCommit ? null : (source === undefined ? gitSource(cwd) : source);
  const commitSha = declaredCommit ?? git?.commitSha ?? "unknown";
  const sourceState = declaredCommit ? "declared" : git ? (git.dirty ? "dirty" : "clean") : "unknown";
  const releasable = sourceState === "declared" || sourceState === "clean";
  const requestedRelease = normalizedRelease(env.TASTE_ENGINE_RELEASE);
  const baseRelease = requestedRelease
    ?? (commitSha === "unknown" ? `${packageVersion}+unknown` : `${packageVersion}+${commitSha.slice(0, 12)}`);
  const release = sourceState === "dirty" && !baseRelease.endsWith(".dirty")
    ? `${baseRelease}.dirty`
    : baseRelease;
  const sourceDateEpoch = normalizedEpoch(env.SOURCE_DATE_EPOCH);
  return Object.freeze({
    release,
    commitSha,
    builtAt: sourceDateEpoch == null ? null : new Date(sourceDateEpoch * 1000).toISOString(),
    application: "taste-engine-site",
    applicationVersion: String(packageVersion),
    databaseSchemaVersion: 3,
    projectionSchemaVersion: 5,
    sourceState,
    releasable,
  });
}

function normalizedCommit(value) {
  const output = String(value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{40}$/.test(output) ? output : null;
}

function normalizedRelease(value) {
  const output = String(value ?? "").trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(output) ? output : null;
}

function normalizedEpoch(value) {
  const output = Number(value);
  return Number.isSafeInteger(output) && output >= 0 ? output : null;
}

function gitSource(cwd) {
  try {
    const commitSha = normalizedCommit(execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }));
    if (!commitSha) return null;
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { commitSha, dirty: Boolean(status.trim()) };
  } catch {
    return null;
  }
}
