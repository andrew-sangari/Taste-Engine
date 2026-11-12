# Taste Engine site

The private site for Taste Engine: a stock Next.js App Router application deployed to Vercel, with Postgres on Supabase and Supabase Auth for sign-in. The deterministic engine in `../src` is bundled into `server/deterministic-engine.js` (server) and `app/engine-client.js` (browser) before every build.

## Local development

```sh
npm install
npm run dev
```

No services are needed. With `DATABASE_URL` unset the site uses an in-process Postgres (PGlite) stored in `.pglite/`, and with Supabase unset it renders the bundled projection without sign-in. To exercise the signed-in API locally, set `TASTE_DEV_USER_EMAIL` in the repository's `.env`; a hosted environment never reads it.

## Runtime shape

- `app/` — pages, API routes and client components. `app/auth.ts` is the only source of identity.
- `server/` — hosted refresh, persistence, Spotify, feedback sync, Supabase session helper.
- `db/` — the Postgres statement adapter (`getDatabase()`), schema and executors.
- `drizzle/0000_initial_postgres.sql` — the one migration. Every table has row level security enabled and no policies.
- `proxy.ts` — refreshes the Supabase session cookie on navigation; it makes no access decision.
- `vercel.json` — the Monday and Thursday cron that calls `/api/cron/refresh`.
- `scheduler/` — the earlier Cloudflare Worker scheduler, kept undeployed as a fallback.

## Sign-in

A person enters their email; if it is on `TASTE_ALLOWED_PROFILE_EMAILS`, Supabase emails a one-time code (and a link), and entering the code starts a session. An address that is not allowed gets the same screen and no email. In Supabase, set the project's Site URL and redirect URL to the deployed origin (`/auth/callback`), and add `{{ .Token }}` to the Magic Link email template so the code is shown.

## Deploying

1. Create a Supabase project. Apply the migration once:
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f drizzle/0000_initial_postgres.sql`
2. Create a Vercel project with Root Directory `site`, and set the environment variables listed in `../docs/hosted-runtime-migration.md` (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CRON_SECRET`, `TASTE_ENGINE_ENV=production`, the allowlist, and the source keys).
3. Deploy from a committed tree. A build from uncommitted source labels itself `.dirty` and its refresh routes refuse to publish.
4. Sign in, connect Spotify in the Taste tab, pick playlists, then run a refresh.

## Commands

- `npm run dev` / `npm run build` / `npm run start`
- `npm test` — build, render tests, then every database and logic test against PGlite
- `npm run test:browser` and `npm run test:browser:empty` — run sequentially; they share `dist/`
- `npm run lint`, `npm run typecheck`, `npm run smoke:build`
- `npm run db:generate` — regenerate the migration from `db/schema.ts`
