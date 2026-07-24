import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let runtimeD1: D1Database | null = null;

export function setRuntimeD1(db: D1Database | null | undefined): void {
  runtimeD1 = db ?? null;
}

export function getDb() {
  const d1 = getD1();
  return drizzle(d1, { schema });
}

export function getD1(): D1Database {
  if (!runtimeD1) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return runtimeD1;
}
