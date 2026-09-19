import assert from "node:assert/strict";
import test from "node:test";
import { openSpotifyToken, sealSpotifyToken } from "../server/token-crypto.ts";

test("Spotify token material is authenticated and encrypted before persistence", async () => {
  const previous = { ...process.env };
  process.env.TASTE_ENGINE_ENV = "production";
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64url");
  try {
    const sealed = await sealSpotifyToken("refresh-token-must-stay-secret");
    assert.match(sealed, /^enc:v1:/);
    assert.doesNotMatch(sealed, /refresh-token-must-stay-secret/);
    assert.equal(await openSpotifyToken(sealed), "refresh-token-must-stay-secret");
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64url");
    await assert.rejects(openSpotifyToken(sealed), /could not be decrypted/);
  } finally {
    process.env = previous;
  }
});

test("missing token encryption fails closed unless local plaintext is explicitly enabled", async () => {
  const previous = { ...process.env };
  delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  process.env.TASTE_ENGINE_ENV = "production";
  try {
    await assert.rejects(sealSpotifyToken("secret"), /not configured/);
    process.env.TASTE_ENGINE_ENV = "test";
    process.env.TASTE_ALLOW_PLAINTEXT_SPOTIFY_TOKENS = "1";
    assert.equal(await sealSpotifyToken("local-only"), "local-only");
  } finally {
    process.env = previous;
  }
});
