# Deployment and profile operations

## Deployed architecture

Taste Engine keeps the existing product boundary:

```text
Spotify + public event/movie/sports sources
  -> source adapters
  -> deterministic normalization and identity resolution
  -> Postgres taste and recommendation snapshots (Supabase)
  -> deterministic ranking (+ optional source-safe Ollama advisory copy)
  -> authenticated Next.js API on Vercel
  -> server-rendered UI
```

There are three runtime components:

1. `site/` is a stock Next.js App Router application deployed to Vercel. It owns authenticated Spotify PKCE, profile-scoped Postgres state, hosted refresh, feedback APIs and the UI. All SQL goes through `site/db/index.ts`; production connects with `DATABASE_URL` (Supabase's transaction pooler), tests and local development use in-process PGlite. Sign-in is Supabase Auth with an emailed one-time code; Supabase is never used as a data API.
2. Vercel Cron (`site/vercel.json`) calls `/api/cron/refresh` at 15:30 UTC every Monday and Thursday with `CRON_SECRET`. The Cloudflare Workflow Worker in `site/scheduler/` is kept, undeployed, as the fallback if a refresh outgrows the 300-second function limit; it would call `/api/admin/refresh` with `TASTE_REFRESH_SECRET`. Neither has retrieval, ranking or publication logic.
3. The repository-root Node pipeline is the local recovery/parity producer. It can create and validate a private preview. Local promotion and deployment remain separate actions.

The ChatGPT Sites + D1 deployment that preceded this is being retired by the owner. Its data does not move automatically: feedback is re-imported from the site's export and Spotify is reconnected once on the new host.

## Code, release, and data versions

These are independent:

- `site/package.json` is the application code version.
- A release identifier defaults to `<application version>+<first 12 Git SHA characters>`.
- `TASTE_ENGINE_RELEASE` may provide a human release label and `TASTE_ENGINE_COMMIT_SHA` may provide the full 40-character source SHA in a detached build environment.
- `SOURCE_DATE_EPOCH` is optional. When absent, `builtAt` is `null`; a wall-clock build time is never injected. Rebuilding the same commit therefore produces the same release metadata.
- Database schema version and projection schema version are reported separately. The current values are 4 and 5.
- Every published recommendation snapshot stores the code release and the projection schema version beside its payload hash. A new code release does not rewrite durable taste evidence, and refreshing taste data does not change the code version.
- An implicit build from a dirty checkout is labeled `.dirty`, reports `releasable=false`, degrades production health, and is rejected by publication routes. A detached builder can make an explicit source assertion with the full `TASTE_ENGINE_COMMIT_SHA`.

`GET /api/health` returns only non-secret release, configuration-readiness, and database-count metadata. Production is healthy only when the database query succeeds, the artifact is releasable, the runtime is explicitly `production`, the refresh secret is sufficiently long, every enabled profile has valid hosted configuration and appears in the trusted-email allowlist, the configured legacy email still matches the database-bound legacy owner, the Spotify client is configured, and the token-encryption key decodes to exactly 32 bytes.

## Reproducible clean-checkout verification

Use the Node version in `.node-version`. The production application has one lockfile, `site/package-lock.json`, and all direct build tools are declared in `site/package.json`.

From a clean checkout:

```sh
npm ci --prefix site
npm run verify:release
```

`verify:release` runs the root deterministic pipeline tests, site lint and type checking, the production Next.js build, server/render, database and hosted integration tests, and the build smoke check. The smoke check verifies that:

- the build is complete (`dist/BUILD_ID`);
- the Postgres migration exists;
- application identity and the release label are embedded;
- no code reads the retired `oai-authenticated-*` identity headers;
- obvious secret assignments are absent from the bundle, including the inference keys `TYPESAFE_AI_API_KEY` and `AI_GATEWAY_API_KEY`; and
- every web font is served as a packaged file under `dist/static/media/` that exists in the build.

The font check guards a silent failure: a font served from a build-machine path 404s and the site falls back to a system typeface with no error.

Screenshot baselines must be recorded from a build that passes this check. Baselines captured while the fonts were 404ing encode a fallback typeface and will fail against every correct build.

Run the browser suites sequentially because both use `site/dist`:

```sh
npm --prefix site run test:browser
npm --prefix site run test:browser:empty
```

`npm run build:release` is the code-only release build. It does not call Spotify or public sources and does not rewrite `data/` or the bundled projection. `npm run build:site` is intentionally different: it performs the local live-data refresh and then builds the site. Do not use `build:site` as a clean release reproducibility check.

## Release and deployment procedure

1. Start from a clean checkout of the intended, committed source and use the pinned Node version. A build from uncommitted source is labelled `.dirty`, reports `releasable=false`, and its refresh routes refuse to publish.
2. Run `npm ci --prefix site`, `npm run verify:release`, and both browser suites in sequence.
3. On a new Supabase project, apply the migration once while nothing is running against it:
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f site/drizzle/0000_initial_postgres.sql`
   Use the session pooler (port 5432) for this, not the transaction pooler the application uses (6543). Later schema changes are new numbered migrations applied the same way, before the code that needs them.
4. Supabase Auth:
   - Custom SMTP is required. Supabase's built-in mailer delivers only to members of the project's Supabase organization (two messages an hour), so a code to anyone else fails with "Email address not authorized". Any SMTP provider works; for a single owner, the owner's own mail account with an app-specific password is enough.
   - Supabase accepts email-template changes only once custom SMTP is on. Set the Magic Link and Confirm signup templates to show `{{ .Token }}` (the code the form asks for). They may also link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.
   - Keep signups off (`enable_signup = false`) and add each trusted person under Authentication → Users → Add user with auto-confirm. With signups on, anyone holding the public key could make the project send mail through your SMTP account. The application's allowlist still decides access.
   - The email OTP length is 6. The form accepts 6–10 digits.
   - Set the Site URL to the deployed origin and allow `https://<deployed-host>/auth/callback` as a redirect URL.
5. Set the Vercel project's environment variables (see "External configuration" below) for Production. Vercel supplies `VERCEL_GIT_COMMIT_SHA` to Git-connected builds; a CLI deployment from a clean checkout can set `TASTE_ENGINE_COMMIT_SHA` instead.
6. Deploy. Never change the project's visibility, deployment protection, domains or team as part of a release.
7. Check `/api/health` for the expected release and schema versions and `ready`. Sign in, connect Spotify in the Taste tab, select playlists, and run one refresh from the site. Confirm source health, then let the cron take over.

Rollback is redeploying the previous Vercel deployment. The schema is forward-only: a migration that removes or renames a column needs a release that tolerates both shapes first.

The fallback scheduler is deployed separately from `site/scheduler/` only if it is needed: run Wrangler's dry-run before its deploy, set its `TASTE_ENGINE_REFRESH_URL` to `https://<deployed-host>/api/admin/refresh`, store the same `TASTE_REFRESH_SECRET` in both places, and remove the cron from `vercel.json` so the two never run together.

## Minimum friend-profile model

This is a trusted-user system, not a generic tenancy platform:

- One signed-in email maps to one opaque Taste Engine profile ID.
- The profile ID is derived server-side from a SHA-256 hash of the normalized email of a Supabase session that Supabase has just verified (`getUser`, not the cookie's contents). No request header can name a user. Clients cannot select an arbitrary profile ID. If a trusted user changes email, the small-system recovery path is an explicit owner-reviewed data relink; the application does not guess that two emails are the same person.
- `TASTE_ALLOWED_PROFILE_EMAILS` is the trusted-user boundary. The sign-in form sends a code only to an allowed address and shows every other address the same screen; a Supabase account created some other way still cannot open a profile. An unset allowlist admits no one outside local development and tests. Removing an email blocks interactive access and scheduled refresh selection; set its database `enabled` field to `0` or disconnect it as the explicit durable deprovisioning action. There are no organizations, workspaces, roles, billing records, or tenant-admin UI.
- Spotify OAuth state contains the expected profile ID. The callback must be authenticated as the same profile before tokens are accepted.
- Spotify access and refresh tokens are encrypted at the application boundary with AES-256-GCM before database storage. Tokens are never returned by status APIs, embedded in HTML, or logged. Production has no plaintext fallback.
- Playlist selections, Top Artists windows, hosted taste snapshots, feedback state and records, recommendation misses, source runs, recommendation snapshots, refresh locks, previous-projection comparisons, and ranking inputs are all selected or written by `profile_id`.
- The active recommendation is unique per profile. A profile's previous projection and feedback adjustments can affect only that profile's next ranking.
- Browser planning state uses a versioned profile-specific storage key. Only the explicitly migrated original profile may import the old unscoped key.
- The signed-in UI resolves its profile on the server. The user sees that profile's projection or an empty connect/select/refresh onboarding state. There is no client-side profile switcher because a trusted friend is expected to use their own authenticated identity.
- The administrative projection endpoint requires an explicit target profile. The scheduler refresh endpoint processes enabled, Spotify-connected profiles serially, preserving the small-system resource model.

## Hosted private configuration

Version 2 of `TASTE_ENGINE_CONFIG_JSON` separates allowlisted shared operational/source settings from profile-specific taste and personal context. Personal keys under `shared` are rejected rather than inherited. The structure is:

```json
{
  "version": 2,
  "shared": {
    "brief": {
      "timezone": "America/Los_Angeles",
      "home": { "label": "Los Angeles", "lat": 0, "lon": 0 },
      "searchRadiusMiles": 60
    },
    "movies": {},
    "sports": { "maxPitcherStats": 48, "maxTicketPages": 3 },
    "personalContext": { "maxEnhancedEvents": 16, "maxEnhancedSports": 12 }
  },
  "profiles": {
    "profile_000000000000000000000000": {
      "brief": { "pinnedArtists": [], "excludedArtists": [], "maxTicketPriceUsd": 120 },
      "movies": { "priorityTheaters": [] },
      "sports": { "enabled": true, "teamId": 119, "teamName": "Los Angeles Dodgers" },
      "personalContext": { "background": [], "decisionPreferences": [] }
    }
  }
}
```

The example coordinates are placeholders, not usable location settings. Keep the real JSON in hosted settings. Shared keys are restricted to geographic/source limits, candidate caps, and advisory caps. Artist/venue exclusions, price thresholds, movie/theater preferences, sports interests, rivalries, background, and decision preferences belong in each profile. A version 2 configuration fails closed when an enabled profile has no entry. The pre-migration flat object remains accepted only for the bound legacy profile so rollout can discover its opaque ID without blocking the first request.

## First deployment on Vercel

1. Generate a 32-byte random key and store its base64/base64url value as `SPOTIFY_TOKEN_ENCRYPTION_KEY`. Do not rotate it blindly: stored tokens require the same key; if it is lost, reconnect Spotify.
2. Set `TASTE_ENGINE_ENV=production`, `TASTE_LEGACY_PROFILE_EMAIL` and `TASTE_ALLOWED_PROFILE_EMAILS` (the owner's address in both) before the first sign-in. The legacy role lets the owner's profile fall back to the bundled projection during an outage; the database binds it once.
3. Deploy, sign in as the owner, read the profile ID from runtime status or the `profiles` table, and write version 2 `TASTE_ENGINE_CONFIG_JSON` with an entry for it. Redeploy so the setting takes effect.
4. Connect Spotify, select playlists, run a refresh, and import earlier feedback from the old site's export if wanted.
5. Only then add friends to `TASTE_ALLOWED_PROFILE_EMAILS`, have each sign in once, add their profile ID to the configuration, and let them connect Spotify and refresh.

## External configuration

Repository changes cannot perform these provider-side actions:

- Vercel project with Root Directory `site`, and these Production variables: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`), `CRON_SECRET`, `TASTE_REFRESH_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_TOKEN_ENCRYPTION_KEY`, `TASTE_ENGINE_ENV`, `TASTE_LEGACY_PROFILE_EMAIL`, `TASTE_ALLOWED_PROFILE_EMAILS`, `TASTE_ENGINE_CONFIG_JSON`, and the source/Ollama keys of enabled adapters. An unversioned `TASTE_ENGINE_CONFIG_JSON` (`{brief, movies, sports, personalContext}`) serves only the legacy owner profile. Version 2 (`{version: 2, shared, profiles: {<profileId>: …}}`) is needed once a second person is added, because profile IDs exist only after each person's first sign-in. Functions run in `sfo1` (`vercel.json`), next to the Supabase project in `us-west-1`. Keep the two regions together.
- Supabase project, the migration applied, and the Auth URL and email-template settings in step 4 of the release procedure.
- Register exactly `https://<deployed-host>/api/spotify/callback` in the Spotify application. If the Spotify app is restricted to development users, add each friend there as well.
- Optionally set `TYPESAFE_AI_API_KEY` to enable card enrichment. It is advisory: without it every refresh still publishes and cards render unchanged. Pin `TYPESAFE_AI_MODEL=jev-1.13.0` if you want answers to stay stable across vendor releases.
- The Vercel AI Gateway route additionally needs a card on file for the Vercel team; until then it answers `customer_verification_required` and should stay unselected.

## Intentionally deferred

- Normalized candidate tables remain inside versioned taste/recommendation payloads. Splitting them into a general relational catalog is not required for isolation.
- Profile editing, invitations, role management, and an arbitrary profile switcher are omitted.
- Automatic token-encryption-key rotation is omitted. Reconnect is the small-system recovery procedure.
- A second hosted staging project is not assumed. Preview and production are explicit runtime labels, but a separate provider project should be added only when credentials and ownership are available.
- Parallel multi-profile refresh is omitted. Serial refresh is safer for the current source rate limits and small trusted-user count.
- Semantic assessments stay advisory. Letting them influence canonical fit, hassle, or published order is a separate activation with before/after evaluation and rollback, not part of this release.
