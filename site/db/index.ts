import postgres from "postgres";
import { deploymentEnvironment } from "../server/release.ts";

// The site's only path to its Postgres database.
//
// Every query in `server/` is hand-written SQL behind a small statement API:
// `prepare(sql).bind(...values)` then `first()`, `all()` or `run()`, plus
// `batch()` for several statements that must succeed or fail together. That
// API is implemented once here, over an executor with two implementations:
// postgres.js for a real server (Supabase in production) and PGlite, an
// in-process Postgres, for tests and local development. Both run the same
// engine, so SQL proven in tests is the SQL that runs in production.

export type SqlValue = string | number | null;

export type QueryOutcome = {
  rows: Array<Record<string, unknown>>;
  /** Rows changed by INSERT, UPDATE, DELETE or MERGE; 0 for anything else. */
  affectedRows: number;
};

export interface SqlExecutor {
  query(text: string, params: SqlValue[]): Promise<QueryOutcome>;
  /** Runs `run` in one transaction: committed if it resolves, rolled back if it throws. */
  transaction<T>(run: (scoped: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type StatementResult<T = Record<string, unknown>> = {
  results: T[];
  meta: { changes: number };
};

export class DatabaseBindError extends Error {}

export class SqlStatement {
  readonly text: string;
  private readonly executor: SqlExecutor;
  private readonly parameterCount: number;
  private readonly values: SqlValue[];

  /** Created by `SqlDatabase.prepare`; `sql` is already in Postgres form. */
  constructor(executor: SqlExecutor, sql: TranslatedSql, values: SqlValue[] = []) {
    this.executor = executor;
    this.text = sql.text;
    this.parameterCount = sql.parameterCount;
    this.values = values;
  }

  /** Returns a new statement carrying these values; the receiver is unchanged. */
  bind(...values: unknown[]): SqlStatement {
    return new SqlStatement(this.executor, { text: this.text, parameterCount: this.parameterCount }, values.map(bindValue));
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const { rows } = await this.execute(this.executor);
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<StatementResult<T>> {
    return this.result<T>(this.executor);
  }

  async run<T = Record<string, unknown>>(): Promise<StatementResult<T>> {
    return this.result<T>(this.executor);
  }

  /** Used by `SqlDatabase.batch` to run this statement inside its transaction. */
  async result<T = Record<string, unknown>>(executor: SqlExecutor): Promise<StatementResult<T>> {
    const { rows, affectedRows } = await this.execute(executor);
    return { results: rows as T[], meta: { changes: affectedRows } };
  }

  private execute(executor: SqlExecutor): Promise<QueryOutcome> {
    if (this.values.length !== this.parameterCount) {
      throw new DatabaseBindError(
        `Statement expects ${this.parameterCount} bound value(s) but received ${this.values.length}: ${this.text.trim().slice(0, 80)}`,
      );
    }
    return executor.query(this.text, this.values);
  }
}

export class SqlDatabase {
  private readonly executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.executor = executor;
  }

  prepare(sql: string): SqlStatement {
    return new SqlStatement(this.executor, translatePlaceholders(sql));
  }

  /**
   * Runs every statement in order inside ONE transaction and returns their
   * results in the same order. If any statement fails, none of them apply.
   */
  async batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<Array<StatementResult<T>>> {
    if (!statements.length) return [];
    return this.executor.transaction(async (scoped) => {
      const results: Array<StatementResult<T>> = [];
      for (const statement of statements) results.push(await statement.result<T>(scoped));
      return results;
    });
  }

  close(): Promise<void> {
    return this.executor.close();
  }
}

type TranslatedSql = { text: string; parameterCount: number };

/**
 * Rewrites `?1`, `?2` (which may repeat) and bare `?` placeholders as
 * Postgres `$1`, `$2`. A bare `?` takes the number after the highest one
 * assigned so far. Quoted strings, quoted identifiers and comments are left
 * alone. Every number from 1 to the highest must be used, because Postgres
 * cannot infer a type for a parameter the statement never mentions.
 */
export function translatePlaceholders(sql: string): TranslatedSql {
  let text = "";
  let highest = 0;
  const used = new Set<number>();
  let index = 0;
  const copyUntil = (end: number) => { text += sql.slice(index, end); index = end; };
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "'" || char === '"') {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === char) {
          if (sql[end + 1] === char) { end += 2; continue; }
          break;
        }
        end += 1;
      }
      copyUntil(Math.min(sql.length, end + 1));
    } else if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", index);
      copyUntil(end === -1 ? sql.length : end);
    } else if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      copyUntil(end === -1 ? sql.length : end + 2);
    } else if (char === "?") {
      let end = index + 1;
      while (end < sql.length && sql[end] >= "0" && sql[end] <= "9") end += 1;
      const number = end > index + 1 ? Number(sql.slice(index + 1, end)) : highest + 1;
      if (number < 1) throw new DatabaseBindError("Placeholder numbers start at ?1.");
      highest = Math.max(highest, number);
      used.add(number);
      text += `$${number}`;
      index = end;
    } else {
      text += char;
      index += 1;
    }
  }
  for (let number = 1; number <= highest; number += 1) {
    if (!used.has(number)) {
      throw new DatabaseBindError(`Placeholder ?${number} is never used; Postgres needs every bound value to appear in the statement.`);
    }
  }
  return { text, parameterCount: highest };
}

// Columns hold text and integers only, so that is all a statement may bind.
// `undefined` is stored as NULL and booleans as 1/0, matching the 0/1 flag
// columns; anything else is a programming error rather than something to let
// each driver serialize in its own way.
function bindValue(value: unknown, position: number): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  throw new DatabaseBindError(`Bound value ${position + 1} must be a string, a finite number, a boolean, null or undefined.`);
}

// Postgres reports COUNT(*) and `bigint` columns as 64-bit integers, which
// drivers hand back as strings or BigInt. Everything stored here (row counts,
// millisecond timestamps) fits a JS number, and the server code does
// arithmetic on these values, so both executors read them as numbers.
const INT8_OID = 20;
const parseInt8 = (value: string) => Number(value);

const ROW_CHANGING_COMMANDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);

// ---------------------------------------------------------------------------
// postgres.js: a real Postgres server.
// ---------------------------------------------------------------------------

type PostgresClient = {
  unsafe(text: string, params: SqlValue[]): PromiseLike<ArrayLike<Record<string, unknown>> & { count: number | null; command: string | null }>;
};

/**
 * Settings are chosen for Vercel functions talking to Supabase's connection
 * pooler in transaction mode:
 *  - `prepare: false`: the pooler hands each transaction to a different server
 *    connection, so named prepared statements cannot be relied on;
 *  - a small pool with a short idle timeout, because every warm function
 *    instance holds its own pool;
 *  - TLS is required for every host except this machine.
 */
export function createPostgresExecutor(databaseUrl: string): SqlExecutor {
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    fetch_types: false,
    onnotice: () => {},
    connection: { application_name: "taste-engine-site" },
    types: {
      bigint: { to: INT8_OID, from: [INT8_OID], serialize: (value: number) => String(value), parse: parseInt8 },
    },
    ...(isLocalHost(databaseUrl) ? {} : { ssl: "require" as const }),
  });
  const executorFor = (client: PostgresClient, inTransaction: boolean): SqlExecutor => ({
    async query(text, params) {
      const result = await client.unsafe(text, params);
      return {
        rows: Array.from(result),
        affectedRows: ROW_CHANGING_COMMANDS.has(String(result.command ?? "").toUpperCase()) ? Number(result.count ?? 0) : 0,
      };
    },
    transaction<T>(run: (scoped: SqlExecutor) => Promise<T>): Promise<T> {
      if (inTransaction) return run(this);
      return sql.begin((transaction) => run(executorFor(transaction as unknown as PostgresClient, true))) as Promise<T>;
    },
    async close() {
      if (!inTransaction) await sql.end({ timeout: 5 });
    },
  });
  return executorFor(sql as unknown as PostgresClient, false);
}

function isLocalHost(databaseUrl: string): boolean {
  try {
    const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PGlite: Postgres compiled to WebAssembly, running inside this process. No
// server, no network. Used by tests (in memory) and by local development
// (persisted under `site/.pglite/`).
// ---------------------------------------------------------------------------

type PgliteResults = { rows: Array<Record<string, unknown>>; affectedRows?: number };
type PgliteQueryOptions = { parsers: Record<number, (value: string) => unknown> };
type PgliteSession = {
  query(text: string, params: SqlValue[], options: PgliteQueryOptions): Promise<PgliteResults>;
  exec(sql: string): Promise<unknown>;
};
type PgliteInstance = PgliteSession & {
  transaction<T>(run: (transaction: PgliteSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

const PGLITE_QUERY_OPTIONS: PgliteQueryOptions = { parsers: { [INT8_OID]: parseInt8 } };

function pgliteExecutor(pglite: PgliteInstance): SqlExecutor {
  const executorFor = (session: PgliteSession, inTransaction: boolean): SqlExecutor => ({
    async query(text, params) {
      const result = await session.query(text, params, PGLITE_QUERY_OPTIONS);
      return { rows: result.rows, affectedRows: Number(result.affectedRows ?? 0) };
    },
    transaction<T>(run: (scoped: SqlExecutor) => Promise<T>): Promise<T> {
      if (inTransaction) return run(this);
      return pglite.transaction((transaction) => run(executorFor(transaction, true)));
    },
    async close() {
      if (!inTransaction) await pglite.close();
    },
  });
  return executorFor(pglite, false);
}

/**
 * Opens a PGlite database with every migration in `site/drizzle/` applied.
 * Without `dataDir` the database lives in memory and disappears on `close()`.
 * With `dataDir` it persists there; migrations already applied are skipped.
 */
export async function createPgliteDatabase(options: { dataDir?: string } = {}): Promise<SqlDatabase> {
  return new SqlDatabase(await createPgliteExecutor(options));
}

/** The executor behind `createPgliteDatabase`, for callers that wrap it (tests record queries). */
export async function createPgliteExecutor(options: { dataDir?: string } = {}): Promise<SqlExecutor> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = await PGlite.create(options.dataDir) as unknown as PgliteInstance;
  try {
    await applyMigrations(pglite);
  } catch (error) {
    await pglite.close();
    throw error;
  }
  return pgliteExecutor(pglite);
}

// Bookkeeping for PGlite databases only, kept outside `public` so the
// application schema is exactly what the migrations define. A Supabase
// database is migrated deliberately with psql, never from application code.
async function applyMigrations(pglite: PgliteInstance): Promise<void> {
  const { readFile, readdir } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const directory = resolve(await siteRoot(), "drizzle");
  const migrations = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  if (!migrations.length) throw new Error(`No migrations found in ${directory}.`);
  await pglite.exec(`
    CREATE SCHEMA IF NOT EXISTS taste_engine_local;
    CREATE TABLE IF NOT EXISTS taste_engine_local.applied_migrations (name text PRIMARY KEY, applied_at text NOT NULL);
  `);
  const applied = await pglite.query("SELECT name FROM taste_engine_local.applied_migrations", [], PGLITE_QUERY_OPTIONS);
  const done = new Set(applied.rows.map((row) => String(row.name)));
  for (const name of migrations) {
    if (done.has(name)) continue;
    const sql = await readFile(resolve(directory, name), "utf8");
    await pglite.transaction(async (transaction) => {
      await transaction.exec(sql);
      await transaction.query(
        "INSERT INTO taste_engine_local.applied_migrations (name, applied_at) VALUES ($1, $2)",
        [name, new Date().toISOString()],
        PGLITE_QUERY_OPTIONS,
      );
    });
  }
}

// `site/`, found from this file or, when bundled, from the working directory.
async function siteRoot(): Promise<string> {
  const { existsSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const candidates: string[] = [];
  try { candidates.push(resolve(dirname(fileURLToPath(import.meta.url)), "..")); } catch { /* bundled: no file URL */ }
  candidates.push(process.cwd());
  const root = candidates.find((candidate) => existsSync(resolve(candidate, "drizzle")));
  if (!root) throw new Error("Could not locate the site's `drizzle/` migrations directory for the local database.");
  return root;
}

// ---------------------------------------------------------------------------
// The database the application uses.
// ---------------------------------------------------------------------------

type DatabaseState = { injected: SqlDatabase | null; shared: SqlDatabase | null };

// On `globalThis` so a development server that reloads this module keeps one
// connection pool, and one PGlite instance per data directory.
const state: DatabaseState = ((globalThis as { __tasteEngineDatabase?: DatabaseState }).__tasteEngineDatabase ??= {
  injected: null,
  shared: null,
});

/**
 * The application database: Postgres at `DATABASE_URL` when it is set,
 * otherwise a local PGlite database in development and tests. Creating it
 * opens no connection; that happens on the first query.
 */
export function getDatabase(): SqlDatabase {
  if (state.injected) return state.injected;
  state.shared ??= openConfiguredDatabase();
  return state.shared;
}

/** Tests inject their own database here; `null` restores the configured one. */
export function setDatabaseForTests(database: SqlDatabase | null): void {
  state.injected = database;
}

function openConfiguredDatabase(): SqlDatabase {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return new SqlDatabase(createPostgresExecutor(databaseUrl));
  if (!localDatabaseAllowed()) {
    throw new Error(
      "DATABASE_URL is not set. Set it to the Supabase connection pooler URL (transaction mode) for this deployment.",
    );
  }
  return new SqlDatabase(lazyExecutor(async () => {
    const { resolve } = await import("node:path");
    return createPgliteExecutor({ dataDir: resolve(await siteRoot(), ".pglite") });
  }));
}

// Without DATABASE_URL a local database is only ever a development or test
// convenience. A deployment that declares itself preview or production, or
// that runs a production build without declaring anything, must fail loudly.
function localDatabaseAllowed(): boolean {
  if (["local", "test"].includes(deploymentEnvironment())) return true;
  return process.env.TASTE_ENGINE_ENV === undefined && process.env.NODE_ENV !== "production";
}

// `getDatabase()` is synchronous, while opening PGlite and migrating it is
// not: defer that work to the first query, and retry it if it failed.
function lazyExecutor(open: () => Promise<SqlExecutor>): SqlExecutor {
  let opening: Promise<SqlExecutor> | null = null;
  const ready = () => (opening ??= open().catch((error) => { opening = null; throw error; }));
  return {
    async query(text, params) { return (await ready()).query(text, params); },
    async transaction(run) { return (await ready()).transaction(run); },
    async close() {
      if (!opening) return;
      const executor = await opening;
      opening = null;
      await executor.close();
    },
  };
}
