import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseMetadata } from "../build/release-metadata.mjs";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(siteRoot, "dist");

await assertFile(resolve(distRoot, "server/index.js"));
assert.deepEqual(
  JSON.parse(await readFile(resolve(distRoot, ".openai/hosting.json"), "utf8")),
  JSON.parse(await readFile(resolve(siteRoot, ".openai/hosting.json"), "utf8")),
  "packaged hosting metadata must match the validated source",
);

const sourceMigrations = await migrationFiles(resolve(siteRoot, "drizzle"));
const packagedMigrations = await migrationFiles(resolve(distRoot, ".openai/drizzle"));
assert.deepEqual(packagedMigrations, sourceMigrations, "every D1 migration must be packaged");

const serverBundle = await readFile(resolve(distRoot, "server/index.js"), "utf8");
const clientBundle = await readableBundleText(resolve(distRoot, "client"));
const expectedRelease = resolveReleaseMetadata();
assert.match(serverBundle, /taste-engine-site/, "the application identity must be present in the release bundle");
assert.ok(serverBundle.includes(expectedRelease.release), "the bundle must contain the release label for the source tree that produced it");
if (expectedRelease.sourceState === "dirty") {
  assert.match(expectedRelease.release, /\.dirty$/, "dirty source trees must never masquerade as clean releases");
  assert.equal(expectedRelease.releasable, false);
}
for (const forbidden of ["SPOTIFY_TOKEN_ENCRYPTION_KEY=", "TASTE_REFRESH_SECRET=", "OLLAMA_API_KEY="]) {
  assert.doesNotMatch(serverBundle, new RegExp(forbidden), `the release bundle must not contain ${forbidden}`);
}
for (const serverOnlyName of ["SPOTIFY_TOKEN_ENCRYPTION_KEY", "TASTE_REFRESH_SECRET", "refresh_token", "access_token"]) {
  assert.equal(clientBundle.includes(serverOnlyName), false, `client assets must not contain server-only identifier ${serverOnlyName}`);
}

const sqlMigrationCount = sourceMigrations.filter((path) => path.endsWith(".sql")).length;
console.log(`Deployment smoke passed: ${sqlMigrationCount} SQL migrations and a complete Worker bundle.`);

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
