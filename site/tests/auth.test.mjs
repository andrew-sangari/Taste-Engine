import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnPath } from "../app/return-path.ts";
import { cronAuthorized } from "../server/cron-auth.ts";
import { isAllowedProfileEmail } from "../server/profiles.ts";

function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return Promise.resolve().then(run).finally(restore);
}

test("only same-site relative paths are followed after sign-in", () => {
  assert.equal(safeReturnPath("/#taste"), "/#taste");
  assert.equal(safeReturnPath("/?tab=music"), "/?tab=music");
  for (const hostile of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, 7, "/auth/callback?code=x"]) {
    assert.equal(safeReturnPath(hostile), "/", String(hostile));
  }
});

test("the email allowlist fails closed on a hosted environment and is exact when configured", async () => {
  await withEnv({ TASTE_ENGINE_ENV: "production", TASTE_ALLOWED_PROFILE_EMAILS: null }, () => {
    assert.equal(isAllowedProfileEmail("anyone@example.com"), false);
  });
  await withEnv({ TASTE_ENGINE_ENV: "production", TASTE_ALLOWED_PROFILE_EMAILS: "Owner@Example.com, second@example.com" }, () => {
    assert.equal(isAllowedProfileEmail("owner@example.com"), true);
    assert.equal(isAllowedProfileEmail(" OWNER@example.com "), true);
    assert.equal(isAllowedProfileEmail("owner@example.com.evil.test"), false);
    assert.equal(isAllowedProfileEmail("third@example.com"), false);
  });
  await withEnv({ TASTE_ENGINE_ENV: "local", TASTE_ALLOWED_PROFILE_EMAILS: null }, () => {
    assert.equal(isAllowedProfileEmail("dev@example.com"), true);
  });
});

test("the cron route accepts only Vercel's own bearer secret", async () => {
  const allowed = (authorization) => cronAuthorized(new Request("https://taste.example/api/cron/refresh", { headers: authorization ? { authorization } : {} }));
  const secret = "c".repeat(40);
  await withEnv({ CRON_SECRET: secret, TASTE_REFRESH_SECRET: "r".repeat(40) }, () => {
    assert.equal(allowed(`Bearer ${secret}`), true);
    assert.equal(allowed(null), false);
    assert.equal(allowed("Bearer wrong"), false);
    assert.equal(allowed(`Bearer ${"r".repeat(40)}`), false, "the refresh secret is not the cron secret");
  });
  // An unset or short secret can never authorize, even when the caller sends the same value.
  await withEnv({ CRON_SECRET: null }, () => assert.equal(allowed("Bearer "), false));
  await withEnv({ CRON_SECRET: "short" }, () => assert.equal(allowed("Bearer short"), false));
});
