declare const __TASTE_ENGINE_RELEASE__: string | undefined;
declare const __TASTE_ENGINE_COMMIT_SHA__: string | undefined;
declare const __TASTE_ENGINE_BUILT_AT__: string | undefined;
declare const __TASTE_ENGINE_APPLICATION_VERSION__: string | undefined;
declare const __TASTE_ENGINE_SOURCE_STATE__: string | undefined;
// "true" or "false": Next defines every compile-time value as a string.
declare const __TASTE_ENGINE_RELEASABLE__: string | undefined;

// 4 is the first Postgres schema (drizzle/0000_initial_postgres.sql); 1-3 were
// the retired SQLite/D1 schema.
export const DATABASE_SCHEMA_VERSION = 4;
export const PROJECTION_SCHEMA_VERSION = 5;

export type ReleaseMetadata = {
  application: "taste-engine-site";
  applicationVersion: string;
  release: string;
  commitSha: string;
  builtAt: string | null;
  databaseSchemaVersion: number;
  projectionSchemaVersion: number;
  environment: string;
  sourceState: string;
  releasable: boolean;
};

export function releaseMetadata(): ReleaseMetadata {
  return {
    application: "taste-engine-site",
    applicationVersion: compileValue("applicationVersion") ?? "0.1.0",
    release: compileValue("release") ?? process.env.TASTE_ENGINE_RELEASE ?? "development",
    commitSha: compileValue("commitSha") ?? process.env.TASTE_ENGINE_COMMIT_SHA ?? "unknown",
    builtAt: compileValue("builtAt"),
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    projectionSchemaVersion: PROJECTION_SCHEMA_VERSION,
    environment: deploymentEnvironment(),
    sourceState: compileValue("sourceState") ?? declaredSourceState(),
    releasable: compileBoolean("releasable") ?? declaredSourceState() === "declared",
  };
}

export function deploymentEnvironment(): string {
  const value = String(process.env.TASTE_ENGINE_ENV ?? "unknown").trim().toLowerCase();
  return ["local", "test", "preview", "production"].includes(value) ? value : "unknown";
}

export function releasePublicationReady(): boolean {
  return deploymentEnvironment() !== "production" || releaseMetadata().releasable;
}

function compileValue(key: "release" | "commitSha" | "builtAt" | "applicationVersion" | "sourceState"): string | null {
  if (key === "release") return defined(typeof __TASTE_ENGINE_RELEASE__ === "undefined" ? undefined : __TASTE_ENGINE_RELEASE__);
  if (key === "commitSha") return defined(typeof __TASTE_ENGINE_COMMIT_SHA__ === "undefined" ? undefined : __TASTE_ENGINE_COMMIT_SHA__);
  if (key === "applicationVersion") return defined(typeof __TASTE_ENGINE_APPLICATION_VERSION__ === "undefined" ? undefined : __TASTE_ENGINE_APPLICATION_VERSION__);
  if (key === "sourceState") return defined(typeof __TASTE_ENGINE_SOURCE_STATE__ === "undefined" ? undefined : __TASTE_ENGINE_SOURCE_STATE__);
  return defined(typeof __TASTE_ENGINE_BUILT_AT__ === "undefined" ? undefined : __TASTE_ENGINE_BUILT_AT__);
}

// Only the exact strings count: anything else (a missing define, or a quoted
// value from a misconfigured build) is unknown, never a truthy string.
function compileBoolean(key: "releasable"): boolean | null {
  if (key !== "releasable") return null;
  const value = typeof __TASTE_ENGINE_RELEASABLE__ === "undefined" ? undefined : __TASTE_ENGINE_RELEASABLE__;
  if (value === "true") return true;
  if (value === "false") return false;
  return typeof value === "undefined" ? null : false;
}

function defined(value: string | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function declaredSourceState(): "declared" | "unknown" {
  return /^[a-f0-9]{40}$/i.test(String(process.env.TASTE_ENGINE_COMMIT_SHA ?? "").trim()) ? "declared" : "unknown";
}
