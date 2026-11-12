import { defineConfig } from "drizzle-kit";

// Generates Postgres DDL from db/schema.ts. Generation is offline; the SQL is
// applied to Supabase with `psql "$DATABASE_URL" -f drizzle/<file>.sql`.
export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
});
