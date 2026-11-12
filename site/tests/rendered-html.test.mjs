import assert from "node:assert/strict";
import test from "node:test";

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Serves the production build (`npm run build` writes it to `dist/`) in a
// child process with exactly the environment under test, fetches the page,
// and stops the server. A database is never configured: the page must render
// from the bundled projection or fail closed.
async function render(environment, requestHeaders = {}, path = "/") {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  for (const name of ["TASTE_ENGINE_ENV", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "TASTE_DEV_USER_EMAIL"]) delete env[name];
  if (environment) env.TASTE_ENGINE_ENV = environment;
  const server = spawn(process.execPath, [resolve(siteRoot, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: siteRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (server.exitCode != null) throw new Error(`next start exited early:\n${output}`);
      try {
        return await fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: "text/html", ...requestHeaders } }).then(async (response) => new Response(await response.text(), { status: response.status, headers: response.headers }));
      } catch {
        if (Date.now() > deadline) throw new Error(`next start did not answer within 30s:\n${output}`);
        await new Promise((done) => setTimeout(done, 150));
      }
    }
  } finally {
    server.kill("SIGTERM");
  }
}

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

test("server-renders the Taste Engine product surface", async () => {
  {
    const response = await render("test");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

    const html = await response.text();
    assert.match(html, /<title>Taste Engine — Upcoming<\/title>/i);
    assert.match(html, /One taste engine/);
    assert.match(html, /Overview/);
    assert.match(html, /Sports/);
    assert.match(html, /sourceHealthGroup/);
    assert.match(html, /Ollama overview queue/);
    assert.match(html, /Current call/);
    assert.match(html, /How it thinks/);
    assert.match(html, /View(?: <!-- -->)? ?in(?: <!-- -->)? ?(?:Music|Sports)/);
    assert.match(html, /aria-controls="panel-movies"/);
    assert.match(html, /Source health/);
    assert.match(html, /Engine notes/);
    assert.match(html, /Taste health/);
    assert.match(html, /TMDB API but is not endorsed or certified by TMDB/);
    assert.match(html, /tmdb-logo\.svg/);
    assert.match(html, /rel="icon" href="\/favicon-32\.png"/);
    assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /recommendationVisual/);
    assert.match(html, /ghostRank/);
    // The four decision factors render on the card, not behind a disclosure.
    assert.match(html, /decisionScore/);
    assert.match(html, /decisionFactors/);
    assert.doesNotMatch(html, /Decision points/);
    assert.match(html, /Friction/);
    assert.match(html, /sourceHealthList board/);
    assert.match(html, /methodSteps methodRail/);
    assert.match(html, /data-count=/);
    assert.match(html, /og\.png/);
    assert.match(html, /1200/);
    assert.match(html, /630/);
    assert.match(html, /spotify-top-artists|Spotify Top Artists/);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
  }
});

test("an unspecified hosted environment fails closed instead of rendering bundled profile data", async () => {
  const response = await render(null);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Sign in to select your taste profile/);
  assert.match(html, /name="email"/);
  assert.doesNotMatch(html, /One taste engine|ranked candidates|Ollama overview queue/);
  assert.doesNotMatch(html, /ChatGPT/);
});

test("the built release identity keeps its real types", async () => {
  // Next defines every compile-time value as a string literal. Decoded wrongly,
  // a dirty build reads `releasable: "false"`, which is truthy, and its
  // refresh routes would publish.
  const response = await render("production", { accept: "application/json" }, "/api/health");
  const { release, configuration } = await response.json();
  assert.equal(typeof release.releasable, "boolean");
  assert.equal(typeof configuration.sourceRelease, "boolean");
  for (const key of ["release", "commitSha", "applicationVersion", "sourceState"]) {
    assert.equal(typeof release[key], "string", key);
    assert.doesNotMatch(release[key], /^["']/, `${key} must not carry its own quotes`);
  }
  assert.ok(release.builtAt === null || !Number.isNaN(Date.parse(release.builtAt)), "builtAt is null or a timestamp");
  assert.equal(release.releasable, release.sourceState === "declared" || release.sourceState === "clean");
  if (release.sourceState === "dirty") assert.match(release.release, /\.dirty$/);
});

test("a request header cannot name a signed-in user", async () => {
  // The previous host injected identity headers. Nothing may trust them now.
  const response = await render("production", { "oai-authenticated-user-email": "someone@example.com", "x-forwarded-email": "someone@example.com" });
  const html = await response.text();
  assert.match(html, /Sign in to select your taste profile/);
  assert.doesNotMatch(html, /One taste engine|someone@example\.com/);
});
