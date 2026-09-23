# Deployment and profile operations

## Deployed architecture

Taste Engine keeps the existing product boundary:

```text
Spotify + public event/movie/sports sources
  -> source adapters
  -> deterministic normalization and identity resolution
  -> D1 taste and recommendation snapshots
  -> deterministic ranking (+ optional source-safe Ollama advisory copy)
  -> authenticated Sites API
  -> Sites-rendered UI
```

There are three runtime components:

1. `site/` is the production vinext Worker rendered by Sites. It owns authenticated Spotify PKCE, profile-scoped D1 state, hosted refresh, feedback APIs, and the static/server-rendered UI. The Sites project injects D1 as `DB`; no R2 binding is used.
2. `site/scheduler/` is a deliberately small Cloudflare Workflow Worker. At 15:30 UTC every Monday and Thursday it calls the protected refresh endpoint. It has no retrieval, ranking, or publication logic.
3. The repository-root Node pipeline is the local recovery/parity producer. It can create and validate a private preview. Local promotion and Sites publication remain separate actions.

The bundled `site/app/data/upcoming.json` is recovery data for the migrated original profile only. New profiles never inherit it and start with an empty onboarding view.

## Code, release, and data versions

These are independent:

- `site/package.json` is the application code version.
- A release identifier defaults to `<application version>+<first 12 Git SHA characters>`.
- `TASTE_ENGINE_RELEASE` may provide a human release label and `TASTE_ENGINE_COMMIT_SHA` may provide the full 40-character source SHA in a detached build environment.
- `SOURCE_DATE_EPOCH` is optional. When absent, `builtAt` is `null`; a wall-clock build time is never injected. Rebuilding the same commit therefore produces the same release metadata.
- D1 schema version and projection schema version are reported separately. The current values are 3 and 5.
- Every published recommendation snapshot stores the code release and the projection schema version beside its payload hash. A new code release does not rewrite durable taste evidence, and refreshing taste data does not change the code version.
- An implicit build from a dirty checkout is labeled `.dirty`, reports `releasable=false`, degrades production health, and is rejected by publication routes. A detached builder can make an explicit source assertion with the full `TASTE_ENGINE_COMMIT_SHA`.

`GET /api/health` returns only non-secret release, configuration-readiness, and D1-count metadata. Production is healthy only when the D1 query succeeds, the artifact is releasable, the runtime is explicitly `production`, the refresh secret is sufficiently long, every enabled profile has valid hosted configuration and appears in the trusted-email allowlist, the configured legacy email still matches the database-bound legacy owner, the Spotify client is configured, and the token-encryption key decodes to exactly 32 bytes.

## Reproducible clean-checkout verification

Use the Node version in `.node-version`. The production application has one lockfile, `site/package-lock.json`, and all direct build tools are declared in `site/package.json`.

From a clean checkout:

```sh
npm ci --prefix site
npm run verify:release
```

`verify:release` runs the root deterministic pipeline tests, site lint and type checking, the production vinext build, server/render and hosted integration tests, and the deployment-package smoke check. The smoke check verifies that:

- the Worker entry point exists;
- packaged Sites hosting metadata exactly matches the tracked declaration;
- every tracked D1 migration is included in the package;
- application identity is embedded; and
- obvious secret assignments are absent from the bundle.

Run the browser suites sequentially because both use `site/dist`:

```sh
npm --prefix site run test:browser
npm --prefix site run test:browser:empty
```

`npm run build:release` is the code-only release build. It does not call Spotify or public sources and does not rewrite `data/` or the bundled projection. `npm run build:site` is intentionally different: it performs the local live-data refresh and then builds the site. Do not use `build:site` as a clean release reproducibility check.

## Release and deployment procedure

1. Pause the external scheduler. Verify that the old global `hosted-refresh` lock is absent/expired and that no source run is still active before changing D1 or application code.
2. Back up D1 through the provider-supported export/backup path.
3. Start from a clean checkout of the intended commit and use the pinned Node version.
4. Run `npm ci --prefix site`, `npm run verify:release`, and both browser suites in sequence.
5. Set release inputs in the build environment when the source SHA cannot be read from Git. Do not put them in source files. Treat `releasable=false` as a hard stop.
6. Inspect the existing Sites access policy. Stop if it cannot be verified. A release must never change owner-only/shared/public visibility.
7. Build the site-rooted source commit from `site/`, using only a short-lived per-command Sites credential. Never persist a managed Sites remote or credential in local Git configuration.
8. With refreshes still quiesced, apply the packaged D1 migrations and deploy the same verified `site/dist` artifact. Save the resulting deployment version.
9. During the single-profile cutover, have the original owner sign in and call Spotify status once. This is deliberately mutating: it binds the legacy profile and lazily replaces plaintext tokens with ciphertext.
10. Check `/api/health` for the expected release/schema versions and `ready`, then load the signed-in root page and verify the original projection. Run one protected refresh and confirm the `jev-events` source-health row reads `not configured`, `active`, or `partial` as expected for the configured key. Only then resume the scheduler.

The pre-profile deployment is not a safe rollback target after step 9 or after any profile-scoped snapshot is written. Old code treats recommendations globally and cannot read encrypted tokens. After that boundary, recovery means deploying a forward, profile-aware repair. The destructive fallback is restoring the pre-migration D1 backup together with the old code, which discards all post-backup profile state. Keep the last known-good profile-aware release as the ordinary rollback baseline after cutover; never run pre-profile code against an active migrated database.

The scheduler is deployed separately from `site/scheduler/`. Always run Wrangler's dry-run before its deploy, and store the same `TASTE_REFRESH_SECRET` in both environments.

## Minimum friend-profile model

This is a trusted-user system, not a generic tenancy platform:

- One authenticated ChatGPT email maps to one opaque Taste Engine profile ID.
- The profile ID is derived server-side from a SHA-256 hash of the normalized authenticated email that Sites injects. Clients cannot select an arbitrary profile ID. If a trusted user changes email, the small-system recovery path is an explicit owner-reviewed data relink; the application does not guess that two emails are the same person.
- Sites access policy is the outer trusted-user boundary, and `TASTE_ALLOWED_PROFILE_EMAILS` is the small server-side allowlist. Removing an email blocks interactive access and scheduled refresh selection; set its database `enabled` field to `0` or disconnect it as the explicit durable deprovisioning action. There are no organizations, workspaces, roles, billing records, or tenant-admin UI.
- Spotify OAuth state contains the expected profile ID. The callback must be authenticated as the same profile before tokens are accepted.
- Spotify access and refresh tokens are encrypted at the application boundary with AES-256-GCM before D1 storage. Tokens are never returned by status APIs, embedded in HTML, or logged. Production has no plaintext fallback.
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

## Single-profile migration

Perform these actions in order:

1. Pause the scheduler, verify the old global refresh lock is absent/expired, verify no source run is active, and back up D1.
2. Set `TASTE_ENGINE_ENV=production` in the Sites environment.
3. Set `TASTE_LEGACY_PROFILE_EMAIL` to the existing owner's canonical signed-in email and include it in `TASTE_ALLOWED_PROFILE_EMAILS`. Do this before any friend signs in. The database binds this legacy role once; later environment changes cannot reassign it.
4. Generate a 32-byte random key and store its base64/base64url value as `SPOTIFY_TOKEN_ENCRYPTION_KEY`. Do not rotate it blindly: existing encrypted tokens require the old key. If the key is lost or intentionally replaced, disconnect/reconnect each Spotify profile.
5. Keep the existing flat `TASTE_ENGINE_CONFIG_JSON` for the migration request, deploy migration 0003 and the profile-aware application, then have the original owner sign in. That request creates the opaque profile and claims matching legacy rows.
6. Call Spotify status once for the owner. This deliberately re-encrypts a legacy plaintext token when present and crosses the no-old-code rollback boundary.
7. Read the owner's opaque profile ID from authenticated runtime status or the `profiles` table. Convert the hosted configuration to version 2 with an entry for that ID.
8. Confirm `/api/health` is `ready`, the original profile retains its projection and feedback, and a synthetic/new profile receives no original projection. The automated isolation suite verifies that disconnect produces onboarding rather than resurrecting the bundle; do not disconnect the real owner merely as a smoke test. Resume the scheduler only after these checks.
9. Only then add intended friends to both the Sites access policy and `TASTE_ALLOWED_PROFILE_EMAILS`. Have each friend sign in once, add their generated profile ID to version 2 configuration, then let them connect Spotify, select playlists, and request their first refresh.

Rows not matching the configured legacy email are not claimed. Global legacy recommendation and source-run rows are claimed only by the database-bound legacy profile. The migration deliberately does not invent ownership for ambiguous data. Do not change `TASTE_LEGACY_PROFILE_EMAIL` after binding; a conflict fails closed and requires an owner-reviewed database repair.

## External configuration still required

Repository changes cannot perform these provider-side actions:

- Keep the Sites D1 binding named `DB`, apply migration 0003 while refreshes are paused, and preserve the current access policy while adding only intended friends.
- Register exactly `https://<deployed-host>/api/spotify/callback` in the Spotify application. If the Spotify app is restricted to development/test users, add each friend there as well.
- Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_TOKEN_ENCRYPTION_KEY`, `TASTE_REFRESH_SECRET`, `TASTE_ENGINE_ENV`, `TASTE_LEGACY_PROFILE_EMAIL`, `TASTE_ALLOWED_PROFILE_EMAILS`, and version 2 `TASTE_ENGINE_CONFIG_JSON` in Sites hosted settings. Set source/Ollama keys only for enabled adapters.
- Optionally set `TYPESAFE_AI_API_KEY` to enable card enrichment. It is advisory: without it every refresh still publishes and cards render unchanged. Pin `TYPESAFE_AI_MODEL=jev-1.13.0` if you want answers to stay stable across vendor releases.
- The Vercel AI Gateway route additionally needs a card on file for the Vercel team; until then it answers `customer_verification_required` and should stay unselected.
- Store the same refresh secret in the scheduler Worker and deploy the revised Monday/Thursday schedule.
- Verify and preserve the deployed Sites access policy. Authentication establishes identity; the access policy decides which trusted people may enter the application.

No new database provider, object store, Kubernetes layer, generalized platform, or tenant administration service is required.

## Intentionally deferred

- Normalized candidate tables remain inside versioned taste/recommendation payloads. Splitting them into a general relational catalog is not required for isolation.
- Profile editing, invitations, role management, and an arbitrary profile switcher are omitted.
- Automatic token-encryption-key rotation is omitted. Reconnect is the small-system recovery procedure.
- A second hosted staging project is not assumed. Preview and production are explicit runtime labels, but a separate provider project should be added only when credentials and ownership are available.
- Parallel multi-profile refresh is omitted. Serial refresh is safer for the current source rate limits and small trusted-user count.
- Semantic assessments stay advisory. Letting them influence canonical fit, hassle, or published order is a separate activation with before/after evaluation and rollback, not part of this release.
- Insomniac discovery stays disabled until its extractor is repaired and validated with captured permitted fixtures.
