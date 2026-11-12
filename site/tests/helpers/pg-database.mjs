import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteExecutor, createPostgresExecutor, setDatabaseForTests, SqlDatabase } from "../../db/index.ts";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// A real Postgres engine behind the same adapter class production uses
// (`SqlDatabase`), with the real migration applied, so persistence tests
// exercise the actual SQL, types and constraints. By default that engine is
// PGlite, in memory: no server, nothing to install, a fresh empty database per
// call.
//
// To run the same tests through postgres.js, the production driver, against a
// Postgres server: apply drizzle/*.sql to an empty database on this machine
// and set TASTE_ENGINE_TEST_DATABASE_URL to it. Every table is emptied before
// each test, so only localhost is accepted, and test files must then run one
// at a time (`node --test --test-concurrency=1 ...`).
export async function migratedDatabase() {
  const serverUrl = process.env.TASTE_ENGINE_TEST_DATABASE_URL;
  if (!serverUrl) return { db: recordingDatabase(await createPgliteExecutor()) };
  if (!["localhost", "127.0.0.1"].includes(new URL(serverUrl).hostname)) {
    throw new Error("TASTE_ENGINE_TEST_DATABASE_URL must point at localhost: the tests empty every table.");
  }
  const db = recordingDatabase(createPostgresExecutor(serverUrl));
  const tables = await db.prepare("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename").all();
  if (!tables.results.length) throw new Error("The test database has no tables. Apply drizzle/*.sql to it first.");
  await db.prepare(`TRUNCATE ${tables.results.map((row) => `"${row.tablename}"`).join(", ")}`).run();
  return { db };
}

// Runs `run` with a fresh migrated database installed as the application
// database, then removes and closes it.
export async function withDatabase(run) {
  const { db } = await migratedDatabase();
  setDatabaseForTests(db);
  try {
    return await run(db);
  } finally {
    setDatabaseForTests(null);
    await db.close();
  }
}

// A database whose every query fails, for the paths that must survive an
// outage. Installed like any other, so no test ever reaches a configured one.
export function unavailableDatabase() {
  const fail = async () => { throw new Error("database unavailable"); };
  return new SqlDatabase({ query: fail, transaction: fail, close: async () => {} });
}

export async function rows(db, sql, ...values) {
  return (await db.prepare(sql).bind(...values).all()).results;
}

export async function count(db, table, where = "TRUE", ...values) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...values).first()).n;
}

// ---------------------------------------------------------------------------
// Statement coverage. Every database the helper hands out notes which
// application call site prepared each statement and which statements the
// engine actually executed without error, so a test can prove that every
// `.prepare(` in the server code ran against Postgres.
// ---------------------------------------------------------------------------

const preparedAt = new Map(); // "server/profiles.ts:30" -> Set of statement texts
const executed = new Set(); // statement texts the engine completed

function recordingDatabase(executor) {
  const recording = (inner) => ({
    async query(text, params) {
      const outcome = await inner.query(text, params);
      executed.add(text);
      return outcome;
    },
    transaction: (run) => inner.transaction((scoped) => run(recording(scoped))),
    close: () => inner.close(),
  });
  const db = new SqlDatabase(recording(executor));
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const site = applicationCallSite(new Error().stack ?? "");
    if (site) preparedAt.set(site, (preparedAt.get(site) ?? new Set()).add(statement.text));
    return statement;
  };
  return db;
}

function applicationCallSite(stack) {
  for (const line of stack.split("\n")) {
    const match = line.match(/(file:\/\/[^\s)]+):(\d+):\d+\)?$/);
    if (!match) continue;
    const file = relative(siteRoot, fileURLToPath(match[1]));
    if (file.startsWith("server/") || file.startsWith("app/")) return `${file}:${match[2]}`;
  }
  return null;
}

// For each file: every `.prepare(` call site found in its source, and whether
// a statement prepared there was executed during this process.
export function statementCoverage(files) {
  return files.map((file) => {
    const source = readFileSync(resolve(siteRoot, file), "utf8");
    const sites = [...source.matchAll(/\.prepare\(/g)].map((match) => `${file}:${source.slice(0, match.index).split("\n").length}`);
    const missing = sites.filter((site) => ![...(preparedAt.get(site) ?? [])].some((text) => executed.has(text)));
    return { file, total: sites.length, covered: sites.length - missing.length, missing };
  });
}

// Every statement text the engine completed during this process.
export function executedStatements() {
  return [...executed];
}
