declare const __TASTE_ENGINE_RELEASE__: string | undefined;
declare const __TASTE_ENGINE_COMMIT_SHA__: string | undefined;
declare const __TASTE_ENGINE_BUILT_AT__: string | null | undefined;
declare const __TASTE_ENGINE_APPLICATION_VERSION__: string | undefined;
declare const __TASTE_ENGINE_SOURCE_STATE__: string | undefined;
declare const __TASTE_ENGINE_RELEASABLE__: boolean | undefined;

export const DATABASE_SCHEMA_VERSION = 3;
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
  if (key === "release") return typeof __TASTE_ENGINE_RELEASE__ === "undefined" ? null : __TASTE_ENGINE_RELEASE__;
  if (key === "commitSha") return typeof __TASTE_ENGINE_COMMIT_SHA__ === "undefined" ? null : __TASTE_ENGINE_COMMIT_SHA__;
  if (key === "applicationVersion") return typeof __TASTE_ENGINE_APPLICATION_VERSION__ === "undefined" ? null : __TASTE_ENGINE_APPLICATION_VERSION__;
  if (key === "sourceState") return typeof __TASTE_ENGINE_SOURCE_STATE__ === "undefined" ? null : __TASTE_ENGINE_SOURCE_STATE__;
  return typeof __TASTE_ENGINE_BUILT_AT__ === "undefined" ? null : __TASTE_ENGINE_BUILT_AT__;
}

function compileBoolean(key: "releasable"): boolean | null {
  if (key === "releasable") return typeof __TASTE_ENGINE_RELEASABLE__ === "undefined" ? null : __TASTE_ENGINE_RELEASABLE__;
  return null;
}

function declaredSourceState(): "declared" | "unknown" {
  return /^[a-f0-9]{40}$/i.test(String(process.env.TASTE_ENGINE_COMMIT_SHA ?? "").trim()) ? "declared" : "unknown";
}
