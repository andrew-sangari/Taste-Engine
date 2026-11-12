import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseMetadata } from "../build/release-metadata.mjs";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(siteRoot, "dist");

// The site is a Next.js build written to `dist/` and deployed to Vercel, which
// builds it again from source. This checks the properties of that build that
// must hold before any deployment.
await assertFile(resolve(distRoot, "BUILD_ID"));
const sourceMigrations = await migrationFiles(resolve(siteRoot, "drizzle"));
assert.ok(sourceMigrations.some((path) => path.endsWith(".sql")), "the Postgres migration must exist");

const serverBundle = await readableBundleText(resolve(distRoot, "server"));
const clientBundle = await readableBundleText(resolve(distRoot, "static"));
const expectedRelease = resolveReleaseMetadata();
assert.match(serverBundle, /taste-engine-site/, "the application identity must be present in the release bundle");
assert.ok(serverBundle.includes(expectedRelease.release), "the bundle must contain the release label for the source tree that produced it");
if (expectedRelease.sourceState === "dirty") {
  assert.match(expectedRelease.release, /\.dirty$/, "dirty source trees must never masquerade as clean releases");
  assert.equal(expectedRelease.releasable, false);
}
for (const forbidden of ["SPOTIFY_TOKEN_ENCRYPTION_KEY=", "TASTE_REFRESH_SECRET=", "CRON_SECRET=", "DATABASE_URL=", "OLLAMA_API_KEY=", "TYPESAFE_AI_API_KEY=", "AI_GATEWAY_API_KEY="]) {
  assert.doesNotMatch(serverBundle, new RegExp(forbidden), `the release bundle must not contain ${forbidden}`);
}
for (const serverOnlyName of ["SPOTIFY_TOKEN_ENCRYPTION_KEY", "TASTE_REFRESH_SECRET", "CRON_SECRET", "DATABASE_URL", "TYPESAFE_AI_API_KEY", "AI_GATEWAY_API_KEY", "refresh_token", "access_token"]) {
  assert.equal(clientBundle.includes(serverOnlyName), false, `client assets must not contain server-only identifier ${serverOnlyName}`);
}
// The previous host's identity headers must not be read anywhere.
assert.equal(serverBundle.includes("oai-authenticated-user-email"), false, "no code may trust the retired identity headers");

// Fonts are downloaded at build time and must ship as packaged assets, never
// as a path on the build machine.
const fontUrls = [...clientBundle.matchAll(/url\(\s*['"]?([^'")]+?\.woff2)['"]?\s*\)/g)].map((match) => match[1]);
assert.ok(fontUrls.length > 0, "the release bundle must declare its web fonts");
for (const url of new Set(fontUrls)) {
  const packaged = url.match(/(?:^|\/)(media\/[^/]+\.woff2)$/)?.[1];
  assert.ok(packaged, `font URL must be a packaged asset, not a build-machine path: ${url}`);
  await assertFile(resolve(distRoot, "static", packaged));
}

const sqlMigrationCount = sourceMigrations.filter((path) => path.endsWith(".sql")).length;
console.log(`Deployment smoke passed: ${sqlMigrationCount} SQL migration(s), ${new Set(fontUrls).size} packaged fonts, and a complete Next.js build.`);

async function assertFile(path) {
  const details = await stat(path);
  assert.equal(details.isFile(), true, `${path} must be a file`);
}

async function migrationFiles(root) {
  const paths = [];
  await walk(root, "", paths);
  return paths.sort();
}

async function walk(root, relative, output) {
  for (const entry of await readdir(resolve(root, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, next, output);
    else if (entry.isFile()) output.push(next);
  }
}

async function readableBundleText(root) {
  const paths = [];
  await walk(root, "", paths);
  const readable = paths.filter((path) => /\.(?:css|html|js|json|txt)$/.test(path));
  return (await Promise.all(readable.map((path) => readFile(resolve(root, path), "utf8")))).join("\n");
}
