import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Taste Engine product surface", async () => {
  const response = await render();
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
  assert.match(html, /recommendationScore/);
  assert.match(html, /Decision points/);
  assert.match(html, /Friction/);
  assert.match(html, /sourceHealthList board/);
  assert.match(html, /methodSteps methodRail/);
  assert.match(html, /data-count=/);
  assert.match(html, /og\.png/);
  assert.match(html, /1200/);
  assert.match(html, /630/);
  assert.match(html, /spotify-top-artists|Spotify Top Artists/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});
