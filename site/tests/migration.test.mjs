import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setRuntimeD1 } from "../db/index.ts";
import { resolveProfile } from "../server/profiles.ts";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("all D1 migrations preserve legacy rows and bind them to one immutable owner", async () => {
  const database = new DatabaseSync(":memory:");
  const migrations = (await readdir(resolve(siteRoot, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  assert.deepEqual(migrations.map((name) => name.slice(0, 4)), ["0000", "0001", "0002", "0003"]);
  for (const name of migrations.slice(0, 3)) database.exec(await migrationSql(name));

  database.exec(`
    INSERT INTO feedback_state (owner_email, state_json, updated_at)
    VALUES ('owner@example.com', '{}', '2026-08-30T00:00:00.000Z');
    INSERT INTO spotify_tokens (owner_email, access_token, refresh_token, expires_at, scopes, updated_at)
    VALUES ('owner@example.com', 'legacy-token', NULL, 0, '', '2026-08-30T00:00:00.000Z');
    INSERT INTO spotify_tokens (owner_email, access_token, refresh_token, expires_at, scopes, updated_at)
    VALUES ('other@example.com', 'other-token', NULL, 0, '', '2026-08-30T00:00:00.000Z');
    INSERT INTO recommendation_snapshots
      (snapshot_id, generated_at, payload_json, payload_hash, created_at, active)
    VALUES ('legacy-projection', '2026-08-30T00:00:00.000Z', '{}', 'legacy-hash', '2026-08-30T00:00:00.000Z', 1);
    INSERT INTO source_runs (run_id, status, started_at)
    VALUES ('legacy-run', 'completed', '2026-08-30T00:00:00.000Z');
  `);
  database.exec(await migrationSql(migrations[3]));

  const priorEnvironment = process.env.TASTE_ENGINE_ENV;
  const priorLegacyEmail = process.env.TASTE_LEGACY_PROFILE_EMAIL;
  const priorAllowed = process.env.TASTE_ALLOWED_PROFILE_EMAILS;
  process.env.TASTE_ENGINE_ENV = "test";
  process.env.TASTE_LEGACY_PROFILE_EMAIL = "owner@example.com";
  delete process.env.TASTE_ALLOWED_PROFILE_EMAILS;
  setRuntimeD1(new SqliteD1(database));
  try {
    const owner = await resolveProfile({ email: "owner@example.com", displayName: "Owner", fullName: null });
    assert.equal(owner.legacyDefault, true);
    assert.equal(database.prepare("SELECT profile_id FROM feedback_state").get().profile_id, owner.id);
    assert.equal(database.prepare("SELECT profile_id FROM spotify_tokens WHERE owner_email = 'owner@example.com'").get().profile_id, owner.id);
    assert.equal(database.prepare("SELECT profile_id FROM spotify_tokens WHERE owner_email = 'other@example.com'").get().profile_id, null);
    assert.equal(database.prepare("SELECT profile_id FROM recommendation_snapshots").get().profile_id, owner.id);
    assert.equal(database.prepare("SELECT profile_id FROM source_runs").get().profile_id, owner.id);

    process.env.TASTE_LEGACY_PROFILE_EMAIL = "other@example.com";
    await assert.rejects(
      resolveProfile({ email: "other@example.com", displayName: "Other", fullName: null }),
      /already bound to a different authenticated account/,
    );
    assert.throws(() => database.exec(`
      INSERT INTO profiles
        (profile_id, identity_hash, owner_email, display_name, enabled, legacy_default, legacy_owner_key, created_at, updated_at)
      VALUES ('profile_ffffffffffffffffffffffff', 'other-hash', 'other@example.com', 'Other', 1, 1, 'legacy-default', 'now', 'now');
    `), /UNIQUE constraint failed/);
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    setRuntimeD1(null);
    restoreEnv("TASTE_ENGINE_ENV", priorEnvironment);
    restoreEnv("TASTE_LEGACY_PROFILE_EMAIL", priorLegacyEmail);
    restoreEnv("TASTE_ALLOWED_PROFILE_EMAILS", priorAllowed);
    database.close();
  }
});

async function migrationSql(name) {
  return (await readFile(resolve(siteRoot, "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

class SqliteD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new SqliteStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class SqliteStatement {
  values = [];
  constructor(database, sql) {
    // D1 uses numbered positional placeholders (`?1`, `?2`). Node 22's
    // experimental SQLite API treats those as named parameters, while newer
    // Node versions accept positional arguments. These migration queries use
    // placeholders in bind order, so normalize them and expand repeated or
    // out-of-order references for both runtimes.
    this.parameterOrder = [...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1]) - 1);
    this.statement = database.prepare(sql.replace(/\?\d+/g, "?"));
  }
  bind(...values) { this.values = values; return this; }
  parameters() { return this.parameterOrder.length ? this.parameterOrder.map((index) => this.values[index]) : this.values; }
  async first() { return this.statement.get(...this.parameters()) ?? null; }
  async all() { return { results: this.statement.all(...this.parameters()), meta: { changes: 0 } }; }
  async run() {
    const result = this.statement.run(...this.parameters());
    return { meta: { changes: Number(result.changes) } };
  }
}

function restoreEnv(key, value) {
  if (value == null) delete process.env[key];
  else process.env[key] = value;
}
