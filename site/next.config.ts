import { realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { resolveReleaseMetadata } from "./build/release-metadata.mjs";

const release = resolveReleaseMetadata();
const siteRoot = dirname(fileURLToPath(import.meta.url));

// A guarded preview is a copy of the tree whose `node_modules` is a link back
// to the real install. The bundler refuses links that leave its root, so the
// root is widened to the nearest folder that contains both.
function bundlerRoot(): string {
  let modules: string;
  try {
    modules = dirname(realpathSync(join(siteRoot, "node_modules")));
  } catch {
    return siteRoot;
  }
  const here = siteRoot.split(sep);
  const there = modules.split(sep);
  let shared = 0;
  while (shared < here.length && shared < there.length && here[shared] === there[shared]) shared += 1;
  return here.slice(0, shared).join(sep) || sep;
}

const nextConfig: NextConfig = {
  // The guarded refresh lifecycle and the test suites read the build from
  // `site/dist`.
  distDir: "dist",
  turbopack: { root: bundlerRoot() },
  outputFileTracingRoot: bundlerRoot(),
  // Release identity is fixed when the bundle is built, never read from the
  // runtime environment, so a deployment cannot relabel itself. Next inserts
  // each value as a string literal (it quotes them itself), so values are
  // passed raw and `server/release.ts` decodes the boolean and the empty
  // build time.
  compiler: {
    define: {
      __TASTE_ENGINE_RELEASE__: String(release.release ?? ""),
      __TASTE_ENGINE_COMMIT_SHA__: String(release.commitSha ?? ""),
      __TASTE_ENGINE_BUILT_AT__: String(release.builtAt ?? ""),
      __TASTE_ENGINE_APPLICATION_VERSION__: String(release.applicationVersion ?? ""),
      __TASTE_ENGINE_SOURCE_STATE__: String(release.sourceState ?? ""),
      __TASTE_ENGINE_RELEASABLE__: release.releasable === true ? "true" : "false",
    },
  },
  // PGlite (local development and tests only) ships WebAssembly and must not
  // be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
