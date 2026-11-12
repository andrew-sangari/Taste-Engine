import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPgliteDatabase,
  DatabaseBindError,
  getDatabase,
  setDatabaseForTests,
  translatePlaceholders,
} from "../db/index.ts";
import { count, rows, withDatabase } from "./helpers/pg-database.mjs";

const PROFILE = "profile_aaaaaaaaaaaaaaaaaaaaaaaa";

const setting = (db, key, value, updatedAt = "2026-11-11T00:00:00.000Z") => db
  .prepare("INSERT INTO profile_settings (profile_id, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)")
  .bind(PROFILE, key, value, updatedAt);

test("numbered, repeated and bare placeholders become Postgres parameters", () => {
  assert.deepEqual(translatePlaceholders("SELECT ?1, ?2"), { text: "SELECT $1, $2", parameterCount: 2 });
  assert.deepEqual(
    translatePlaceholders("VALUES (?1, ?2, ?2) WHERE a = ?1 LIMIT ?3"),
    { text: "VALUES ($1, $2, $2) WHERE a = $1 LIMIT $3", parameterCount: 3 },
  );
  assert.deepEqual(translatePlaceholders("VALUES (?, ?, ?)"), { text: "VALUES ($1, $2, $3)", parameterCount: 3 });
  assert.deepEqual(translatePlaceholders("VALUES (?2, ?, ?1)"), { text: "VALUES ($2, $3, $1)", parameterCount: 3 });
  assert.deepEqual(translatePlaceholders("VALUES (?10, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").parameterCount, 10);
  assert.deepEqual(translatePlaceholders("SELECT 1"), { text: "SELECT 1", parameterCount: 0 });
});

test("question marks inside strings, quoted identifiers and comments are not placeholders", () => {
  const sql = `SELECT 'why?', 'it''s ?1', "odd?name" -- really?\n FROM t /* ?2 */ WHERE a = ?1`;
  assert.deepEqual(translatePlaceholders(sql), {
    text: `SELECT 'why?', 'it''s ?1', "odd?name" -- really?\n FROM t /* ?2 */ WHERE a = $1`,
    parameterCount: 1,
  });
});

test("a statement that skips a placeholder number is refused before it reaches Postgres", () => {
  // Postgres cannot infer a type for a parameter the statement never mentions.
  assert.throws(() => translatePlaceholders("SELECT ?1, ?3"), DatabaseBindError);
  assert.throws(() => translatePlaceholders("SELECT ?0"), DatabaseBindError);
});

test("first returns one row or null, all returns every row, and a reused placeholder binds once", async () => {
  await withDatabase(async (db) => {
    // `?1` appears twice: one bound value fills both columns.
    await db.prepare("INSERT INTO profile_settings (profile_id, key, value_json, updated_at) VALUES (?2, ?1, ?1, ?3)")
      .bind("same", PROFILE, "2026-11-11T00:00:00.000Z").run();
    await setting(db, "second", "2").run();

    const first = await db.prepare("SELECT key, value_json FROM profile_settings WHERE profile_id = ?1 AND key = ?2").bind(PROFILE, "same").first();
    assert.deepEqual(first, { key: "same", value_json: "same" });
    assert.equal(await db.prepare("SELECT key FROM profile_settings WHERE key = ?1").bind("absent").first(), null);

    const all = await db.prepare("SELECT key FROM profile_settings WHERE profile_id = ?1 ORDER BY key").bind(PROFILE).all();
    assert.deepEqual(all.results, [{ key: "same" }, { key: "second" }]);
    assert.deepEqual(all.meta, { changes: 0 }, "a read changes nothing");
    assert.deepEqual((await db.prepare("SELECT key FROM profile_settings WHERE key = ?1").bind("absent").all()).results, []);
  });
});

test("run reports how many rows a write changed", async () => {
  await withDatabase(async (db) => {
    assert.equal((await setting(db, "a", "1").run()).meta.changes, 1);
    assert.equal((await setting(db, "b", "1").run()).meta.changes, 1);
    assert.equal((await db.prepare("UPDATE profile_settings SET value_json = ?1 WHERE profile_id = ?2").bind("2", PROFILE).run()).meta.changes, 2);
    assert.equal((await db.prepare("UPDATE profile_settings SET value_json = ?1 WHERE key = ?2").bind("3", "absent").run()).meta.changes, 0);

    // An upsert whose guard rejects the update changes nothing: this is what
    // the refresh lock and last-write-wins feedback rely on.
    const guarded = (updatedAt) => db.prepare(`
      INSERT INTO profile_settings (profile_id, key, value_json, updated_at) VALUES (?1, 'a', 'new', ?2)
      ON CONFLICT(profile_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      WHERE excluded.updated_at >= profile_settings.updated_at
    `).bind(PROFILE, updatedAt).run();
    assert.equal((await guarded("2020-01-01T00:00:00.000Z")).meta.changes, 0);
    assert.equal((await guarded("2030-01-01T00:00:00.000Z")).meta.changes, 1);

    assert.equal((await db.prepare("DELETE FROM profile_settings WHERE profile_id = ?1").bind(PROFILE).run()).meta.changes, 2);
  });
});

test("batch is one transaction: a failing statement rolls back the ones before it", async () => {
  await withDatabase(async (db) => {
    await setting(db, "kept", "before").run();
    await assert.rejects(db.batch([
      setting(db, "first", "1"),
      db.prepare("UPDATE profile_settings SET value_json = 'changed' WHERE key = 'kept'"),
      setting(db, "first", "duplicate primary key"),
      setting(db, "never-reached", "1"),
    ]));
    assert.deepEqual(await rows(db, "SELECT key, value_json FROM profile_settings ORDER BY key"), [{ key: "kept", value_json: "before" }]);

    // The failure leaves the database usable, and a clean batch commits all of
    // its statements and returns their results in order.
    const results = await db.batch([
      setting(db, "x", "1"),
      setting(db, "y", "1"),
      db.prepare("UPDATE profile_settings SET value_json = '2' WHERE key IN ('x', 'y', 'kept')"),
      db.prepare("SELECT key FROM profile_settings ORDER BY key"),
      db.prepare("DELETE FROM profile_settings WHERE key = ?1").bind("absent"),
    ]);
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 3, 0, 0]);
    assert.deepEqual(results[3].results, [{ key: "kept" }, { key: "x" }, { key: "y" }]);
    assert.equal(await count(db, "profile_settings"), 3);
    assert.deepEqual(await db.batch([]), []);
  });
});

test("COUNT(*) and bigint columns come back as JavaScript numbers", async () => {
  await withDatabase(async (db) => {
    const expiresAt = Date.now() + 45 * 60 * 1000; // far beyond a 32-bit integer
    await db.prepare("INSERT INTO refresh_locks (lock_name, run_id, expires_at) VALUES (?1, ?2, ?3)").bind("lock", "run", expiresAt).run();
    await setting(db, "a", "1").run();

    const counted = await db.prepare("SELECT COUNT(*) AS n FROM profile_settings").first();
    assert.strictEqual(counted.n, 1);
    const summed = await db.prepare(`
      SELECT (SELECT COUNT(*) FROM profile_settings WHERE profile_id = ?1)
           + (SELECT COUNT(*) FROM refresh_locks WHERE lock_name <> ?1) AS total
    `).bind(PROFILE).first();
    assert.strictEqual(summed.total, 2);
    assert.strictEqual(summed.total + 1, 3, "arithmetic, not string concatenation");

    const lock = await db.prepare("SELECT expires_at FROM refresh_locks WHERE lock_name = ?1").bind("lock").first();
    assert.strictEqual(lock.expires_at, expiresAt);
    assert.equal((await rows(db, "SELECT lock_name FROM refresh_locks WHERE expires_at < ?1", expiresAt + 1)).length, 1);
    assert.equal((await rows(db, "SELECT lock_name FROM refresh_locks WHERE expires_at < ?1", expiresAt)).length, 0);
  });
});

test("null and undefined bind as NULL, booleans as 1 and 0, and anything else is refused", async () => {
  await withDatabase(async (db) => {
    const miss = (id, url, details) => db.prepare(`
      INSERT INTO recommendation_misses (miss_id, owner_email, profile_id, event_url, event_details, submitted_at)
      VALUES (?1, 'a@example.com', ?2, ?3, ?4, '2026-11-11T00:00:00.000Z')
    `).bind(id, PROFILE, url, details);
    await miss("null", null, "details").run();
    await miss("undefined", undefined, "details").run();
    assert.deepEqual(
      await rows(db, "SELECT miss_id FROM recommendation_misses WHERE event_url IS NULL ORDER BY miss_id"),
      [{ miss_id: "null" }, { miss_id: "undefined" }],
    );
    assert.strictEqual((await db.prepare("SELECT event_url FROM recommendation_misses WHERE miss_id = ?1").bind("null").first()).event_url, null);

    const plan = (id, saved, held) => db.prepare(`
      INSERT INTO feedback_plans (profile_id, item_id, saved, held, item_json, updated_at, received_at)
      VALUES (?1, ?2, ?3, ?4, '{}', 'now', 'now')
    `).bind(PROFILE, id, saved, held);
    await plan("flags", true, false).run();
    assert.deepEqual(await db.prepare("SELECT saved, held FROM feedback_plans WHERE item_id = ?1").bind("flags").first(), { saved: 1, held: 0 });

    assert.throws(() => plan("object", { nested: true }, 0), DatabaseBindError);
    assert.throws(() => plan("nan", Number.NaN, 0), DatabaseBindError);
    assert.throws(() => plan("date", new Date(), 0), DatabaseBindError);
  });
});

test("a statement run with the wrong number of values fails clearly, and bind never mutates", async () => {
  await withDatabase(async (db) => {
    const insert = db.prepare("INSERT INTO profile_settings (profile_id, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)");
    await assert.rejects(async () => insert.bind(PROFILE, "too-few").run(), DatabaseBindError);
    await assert.rejects(async () => insert.run(), DatabaseBindError);
    await assert.rejects(async () => db.prepare("SELECT 1 AS one").bind("extra").first(), DatabaseBindError);

    // One prepared statement can be bound many times; each binding is its own.
    const one = insert.bind(PROFILE, "one", "1", "now");
    const two = insert.bind(PROFILE, "two", "2", "now");
    await db.batch([one, two]);
    assert.deepEqual(await rows(db, "SELECT key, value_json FROM profile_settings ORDER BY key"), [
      { key: "one", value_json: "1" },
      { key: "two", value_json: "2" },
    ]);
    assert.deepEqual(await db.prepare("SELECT 1 AS one").first(), { one: 1 });
  });
});

test("concurrent statements and a batch started alongside them all complete", async () => {
  await withDatabase(async (db) => {
    await Promise.all([
      ...Array.from({ length: 8 }, (_, index) => setting(db, `single-${index}`, "1").run()),
      db.batch(Array.from({ length: 4 }, (_, index) => setting(db, `batched-${index}`, "1"))),
    ]);
    const [singles, batched] = await Promise.all([
      count(db, "profile_settings", "key LIKE ?1", "single-%"),
      count(db, "profile_settings", "key LIKE ?1", "batched-%"),
    ]);
    assert.deepEqual([singles, batched], [8, 4]);
  });
});

test("a database error surfaces to the caller instead of being swallowed", async () => {
  await withDatabase(async (db) => {
    await assert.rejects(db.prepare("SELECT * FROM no_such_table").all(), /no_such_table/);
    await setting(db, "a", "1").run();
    await assert.rejects(setting(db, "a", "again").run(), /duplicate key|unique/i);
  });
});

test("a persisted local database keeps its data and applies each migration only once", { skip: Boolean(process.env.TASTE_ENGINE_TEST_DATABASE_URL) }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "taste-engine-pglite-"));
  try {
    const first = await createPgliteDatabase({ dataDir });
    await setting(first, "kept", "1").run();
    await first.close();

    // Reopening would fail with "relation already exists" if the migration ran again.
    const second = await createPgliteDatabase({ dataDir });
    assert.deepEqual(await rows(second, "SELECT key FROM profile_settings"), [{ key: "kept" }]);
    assert.deepEqual(
      await rows(second, "SELECT name FROM taste_engine_local.applied_migrations ORDER BY name"),
      [{ name: "0000_initial_postgres.sql" }],
    );
    await second.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("without DATABASE_URL a deployment fails with an error that names it; tests use the injected database", async () => {
  const saved = Object.fromEntries(["DATABASE_URL", "TASTE_ENGINE_ENV", "NODE_ENV"].map((key) => [key, process.env[key]]));
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    delete process.env.DATABASE_URL;
    setDatabaseForTests(null);
    for (const [environment, nodeEnv] of [["production", "production"], ["preview", "development"], [undefined, "production"], ["typo", "development"]]) {
      if (environment === undefined) delete process.env.TASTE_ENGINE_ENV;
      else process.env.TASTE_ENGINE_ENV = environment;
      process.env.NODE_ENV = nodeEnv;
      assert.throws(() => getDatabase(), /DATABASE_URL/, `${environment ?? "undeclared"} / ${nodeEnv}`);
    }
  } finally {
    restore();
  }
  await withDatabase(async (db) => {
    assert.equal(getDatabase(), db);
  });
});
