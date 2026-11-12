import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.ts";
import { DATABASE_SCHEMA_VERSION } from "../server/release.ts";
import { count, rows, withDatabase } from "./helpers/pg-database.mjs";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The schema the application depends on, written out by hand so a change to
// db/schema.ts or to the migration has to be made here on purpose as well.
const PRIMARY_KEYS = {
  feedback_history_responses: ["profile_id", "history_id"],
  feedback_plans: ["profile_id", "item_id"],
  feedback_records: ["owner_email", "feedback_id"],
  feedback_state: ["owner_email"],
  hosted_taste_snapshots: ["snapshot_id"],
  profile_settings: ["profile_id", "key"],
  profiles: ["profile_id"],
  recommendation_misses: ["miss_id"],
  recommendation_snapshots: ["snapshot_id"],
  refresh_locks: ["lock_name"],
  source_runs: ["run_id"],
  spotify_oauth_states: ["state"],
  spotify_playlist_selections: ["owner_email", "playlist_id"],
  spotify_tokens: ["owner_email"],
  spotify_top_artist_windows: ["owner_email", "window_key"],
};
const UNIQUE_INDEXES = {
  feedback_records_profile_feedback_idx: ["profile_id", "feedback_id"],
  feedback_state_profile_id_idx: ["profile_id"],
  profiles_identity_hash_idx: ["identity_hash"],
  profiles_legacy_owner_key_idx: ["legacy_owner_key"],
  recommendation_snapshots_profile_payload_idx: ["profile_id", "payload_hash"],
  spotify_playlist_selections_profile_playlist_idx: ["profile_id", "playlist_id"],
  spotify_tokens_profile_id_idx: ["profile_id"],
  spotify_top_artist_windows_profile_window_idx: ["profile_id", "window_key"],
};
const PLAIN_INDEXES = {
  feedback_records_profile_recorded_idx: ["profile_id", "recorded_at"],
  hosted_taste_snapshots_profile_active_idx: ["profile_id", "active", "generated_at"],
  profiles_owner_email_idx: ["owner_email"],
  recommendation_misses_profile_submitted_idx: ["profile_id", "submitted_at"],
  recommendation_snapshots_profile_active_idx: ["profile_id", "active", "created_at"],
};
// Millisecond timestamps do not fit a 32-bit Postgres integer.
const BIGINT_COLUMNS = ["refresh_locks.expires_at", "spotify_oauth_states.expires_at", "spotify_tokens.expires_at"];

const tables = Object.values(schema).map((table) => getTableConfig(table));

test("there is exactly one Postgres migration and it applies to an empty database", async () => {
  const files = (await readdir(resolve(siteRoot, "drizzle"))).filter((name) => name.endsWith(".sql"));
  assert.deepEqual(files, ["0000_initial_postgres.sql"]);
  const journal = JSON.parse(await readFile(resolve(siteRoot, "drizzle/meta/_journal.json"), "utf8"));
  assert.equal(journal.dialect, "postgresql");
  assert.deepEqual(journal.entries.map((entry) => entry.tag), ["0000_initial_postgres"]);
  assert.equal(DATABASE_SCHEMA_VERSION, 4, "the first Postgres schema is database schema version 4");

  // `withDatabase` applies the migration file to a new, empty database.
  await withDatabase(async (db) => {
    const created = await rows(db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    assert.deepEqual(created.map((row) => row.tablename), Object.keys(PRIMARY_KEYS));
    for (const table of Object.keys(PRIMARY_KEYS)) assert.equal(await count(db, `"${table}"`), 0);
  });
});

test("the migration creates exactly the columns db/schema.ts declares", async () => {
  assert.deepEqual(tables.map((table) => table.name).sort(), Object.keys(PRIMARY_KEYS));
  await withDatabase(async (db) => {
    const actual = await rows(db, `
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    const declared = tables
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((table) => table.columns.map((column) => ({
        table_name: table.name,
        column_name: column.name,
        data_type: column.getSQLType(),
        is_nullable: column.notNull ? "NO" : "YES",
        column_default: column.default === undefined ? null
          : typeof column.default === "number" ? String(column.default) : `'${column.default}'::text`,
      })));
    assert.deepEqual(actual, declared);

    // Flags and counts stay integers, timestamps and JSON stay text: the
    // server reads and writes them as numbers and strings.
    assert.deepEqual([...new Set(actual.map((column) => column.data_type))].sort(), ["bigint", "integer", "text"]);
    assert.deepEqual(
      actual.filter((column) => column.data_type === "bigint").map((column) => `${column.table_name}.${column.column_name}`),
      BIGINT_COLUMNS,
    );
  });
});

test("primary keys and indexes match the schema the server's upserts rely on", async () => {
  await withDatabase(async (db) => {
    const indexes = await rows(db, `
      SELECT t.relname AS table_name, i.relname AS index_name, x.indisprimary AS is_primary, x.indisunique AS is_unique,
             string_agg(a.attname, ',' ORDER BY k.position) AS columns
      FROM pg_index x
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, position) ON TRUE
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public'
      GROUP BY t.relname, i.relname, x.indisprimary, x.indisunique
      ORDER BY t.relname, i.relname
    `);
    const named = (filter) => Object.fromEntries(indexes.filter(filter).map((index) => [index.index_name, index.columns.split(",")]));
    assert.deepEqual(
      Object.fromEntries(indexes.filter((index) => index.is_primary).map((index) => [index.table_name, index.columns.split(",")])),
      PRIMARY_KEYS,
    );
    assert.deepEqual(named((index) => index.is_unique && !index.is_primary), UNIQUE_INDEXES);
    assert.deepEqual(named((index) => !index.is_unique), PLAIN_INDEXES);

    // db/schema.ts declares the same keys and indexes.
    for (const table of tables) {
      const single = table.columns.filter((column) => column.primary).map((column) => column.name);
      const composite = table.primaryKeys.flatMap((key) => key.columns.map((column) => column.name));
      assert.deepEqual(single.length ? single : composite, PRIMARY_KEYS[table.name], table.name);
      for (const index of table.indexes) {
        const expected = index.config.unique ? UNIQUE_INDEXES : PLAIN_INDEXES;
        assert.deepEqual(index.config.columns.map((column) => column.name), expected[index.config.name], index.config.name);
      }
    }
  });
});

test("uniqueness is enforced, and unclaimed legacy rows may share a NULL profile", async () => {
  await withDatabase(async (db) => {
    const profile = (id, hash, legacyKey) => db.prepare(`
      INSERT INTO profiles (profile_id, identity_hash, owner_email, display_name, legacy_owner_key, created_at, updated_at)
      VALUES (?1, ?2, 'a@example.com', 'A', ?3, 'now', 'now')
    `).bind(id, hash, legacyKey);
    await profile("profile_aaaaaaaaaaaaaaaaaaaaaaaa", "hash-a", "legacy-default").run();
    await assert.rejects(profile("profile_aaaaaaaaaaaaaaaaaaaaaaaa", "hash-b", null).run(), /profiles_pkey/);
    await assert.rejects(profile("profile_bbbbbbbbbbbbbbbbbbbbbbbb", "hash-a", null).run(), /profiles_identity_hash_idx/);
    // Only one profile can ever hold the legacy owner key.
    await assert.rejects(profile("profile_bbbbbbbbbbbbbbbbbbbbbbbb", "hash-b", "legacy-default").run(), /profiles_legacy_owner_key_idx/);
    await profile("profile_bbbbbbbbbbbbbbbbbbbbbbbb", "hash-b", null).run();
    await profile("profile_cccccccccccccccccccccccc", "hash-c", null).run();
    // Defaults come from the migration, not the application.
    assert.deepEqual(
      await db.prepare("SELECT enabled, legacy_default FROM profiles WHERE profile_id = ?1").bind("profile_cccccccccccccccccccccccc").first(),
      { enabled: 1, legacy_default: 0 },
    );

    const token = (email, profileId) => db.prepare(`
      INSERT INTO spotify_tokens (owner_email, profile_id, access_token, expires_at, scopes, updated_at)
      VALUES (?1, ?2, 'sealed', 0, '', 'now')
    `).bind(email, profileId);
    await token("one@example.com", null).run();
    await token("two@example.com", null).run();
    await token("three@example.com", "profile_aaaaaaaaaaaaaaaaaaaaaaaa").run();
    await assert.rejects(token("four@example.com", "profile_aaaaaaaaaaaaaaaaaaaaaaaa").run(), /spotify_tokens_profile_id_idx/);
    await assert.rejects(token("one@example.com", "profile_bbbbbbbbbbbbbbbbbbbbbbbb").run(), /spotify_tokens_pkey/);

    const setting = db.prepare("INSERT INTO profile_settings (profile_id, key, value_json, updated_at) VALUES (?1, ?2, 'true', 'now')");
    await setting.bind("profile_aaaaaaaaaaaaaaaaaaaaaaaa", "learning").run();
    await setting.bind("profile_bbbbbbbbbbbbbbbbbbbbbbbb", "learning").run();
    await assert.rejects(setting.bind("profile_aaaaaaaaaaaaaaaaaaaaaaaa", "learning").run(), /profile_settings_profile_id_key_pk/);
    await assert.rejects(
      db.prepare("INSERT INTO profile_settings (profile_id, key, value_json, updated_at) VALUES (?1, ?2, NULL, 'now')").bind("p", "k").run(),
      /null value in column "value_json"/,
    );
  });
});

test("row level security is on for every table, with no policy, so only the owner can read", async () => {
  for (const table of tables) assert.equal(table.enableRLS, true, `${table.name} must call .enableRLS() in db/schema.ts`);
  const role = "taste_engine_rls_probe";
  await withDatabase(async (db) => {
    const security = await rows(db, `
      SELECT c.relname AS table_name, c.relrowsecurity AS enabled
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);
    assert.deepEqual(security, Object.keys(PRIMARY_KEYS).map((table) => ({ table_name: table, enabled: true })));
    assert.equal(await count(db, "pg_policies", "schemaname = 'public'"), 0);

    // What Supabase's REST API does with the public anon key: another role,
    // granted every privilege on the table, still sees and writes nothing.
    await db.prepare(`
      INSERT INTO profiles (profile_id, identity_hash, owner_email, display_name, created_at, updated_at)
      VALUES ('profile_aaaaaaaaaaaaaaaaaaaaaaaa', 'hash', 'a@example.com', 'A', 'now', 'now')
    `).run();
    assert.equal(await count(db, "profiles"), 1, "the owner connection is unaffected");
    try {
      await db.prepare(`CREATE ROLE ${role} NOLOGIN`).run();
      await db.prepare(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${role}`).run();
      const [, visible] = await db.batch([
        db.prepare(`SET LOCAL ROLE ${role}`),
        db.prepare("SELECT COUNT(*) AS n FROM profiles"),
      ]);
      assert.equal(visible.results[0].n, 0);
      await assert.rejects(db.batch([
        db.prepare(`SET LOCAL ROLE ${role}`),
        db.prepare(`
          INSERT INTO profiles (profile_id, identity_hash, owner_email, display_name, created_at, updated_at)
          VALUES ('profile_bbbbbbbbbbbbbbbbbbbbbbbb', 'other', 'b@example.com', 'B', 'now', 'now')
        `),
      ]), /row-level security/);
    } finally {
      await db.prepare(`DROP OWNED BY ${role}`).run().catch(() => {});
      await db.prepare(`DROP ROLE IF EXISTS ${role}`).run();
    }
  });
});
