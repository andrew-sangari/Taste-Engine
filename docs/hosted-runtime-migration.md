# Hosted runtime migration

## Decision

Taste Engine production is moving from “local pipeline plus hosted projection” to a private hosted application:

```text
External scheduler
  -> protected Sites refresh route
  -> source adapters + deterministic normalization/ranking
  -> optional sequential Ollama Cloud advisory passes
  -> D1 recommendation snapshot
  -> Sites UI + D1 feedback
```

The workload is small. Data volume and deterministic scoring do not justify a production dependency on the desktop. The hosted application now owns the complete refresh; the only external component is a scheduler that invokes its protected route.

## Canonical state

D1 is the production serving store for:

- active and historical recommendation snapshots
- source-run status and grouped source health
- Spotify tokens, selected playlists, and seven-day Top Artists windows
- saved/held planning state and post-event outcomes
- profiles and profile ownership for all hosted state
- later, if useful: normalized candidate/occurrence tables and sync checkpoints

The bundled `site/app/data/upcoming.json` remains a validated bootstrap and disaster-recovery snapshot for the explicitly migrated original profile. The site reads that profile's active D1 recommendation snapshot first. New friend profiles never fall back to the bundle and begin empty.

Browser storage is a compatibility fallback, not the hosted source of truth. Signed-in feedback is loaded from and written to D1. Existing device state is uploaded when the signed-in D1 record is empty.

## Spotify

Taste Engine now owns the hosted read-only Spotify path copied from Playlist Sync’s proven implementation:

- authorization-code flow with PKCE
- refresh-token rotation
- private and collaborative playlist reads
- playlist artist summaries
- short-, medium-, and long-term Top Artists windows
- seven-day per-window cache reuse
- explicit profile-scoped disconnect deletion of tokens and derived Spotify snapshots
- application-layer AES-256-GCM encryption for access and refresh tokens

Playlist Sync remains a local development and recovery tool. Production does not call a localhost Playlist Sync URL.

The Spotify app must allow this exact redirect:

```text
https://<deployed-taste-engine-host>/api/spotify/callback
```

## Ollama Cloud

Hosted advisory passes use:

- `OLLAMA_BASE_URL=https://ollama.com/api`
- bearer authentication with `OLLAMA_API_KEY`
- one configured `OLLAMA_MODEL`
- sequential execution
- the existing source-safe serializers, structured schemas, mention validation, and unsupported-claim rejection
- deterministic per-pass fallback

Ollama Cloud never becomes the ranker or source of canonical facts. Spotify-derived content and SeatGeek-only API materials remain excluded exactly as they are in the local pipeline.

## Card enrichment (System One / Jev)

The hosted refresh runs the same bounded card-enrichment pass as the local export: after deterministic ranking, up to 24 candidates — Overview picks first — are characterized from permitted Ticketmaster and Framework evidence, and Music and Overview cards gain source-linked "About this night" claims. See `docs/system-one-inference.md`.

- Route: direct TypeSafe serving, `POST https://api.typesafe.ai/v1/systemone`, bearer `TYPESAFE_AI_API_KEY`. Selected automatically when that key is present.
- Cost and time: one request per model-eligible candidate, about $0.00004 and 200ms each, at concurrency 4 under a 60-second deadline. On current coverage roughly 8 of 24 candidates are eligible, so a pass adds under ten outbound requests.
- Retries: 429 and 529 are retried with backoff, at most three attempts; 401 and 422 are not.
- Failure: advisory only. A missing key, a failed call, or even a source-policy guard refusing to serialize a candidate degrades that run to "no enrichment" and never blocks publication. `jev-events` source health reads `not configured`, `active`, `partial`, or `unavailable` accordingly.
- Privacy: raw assessments and provider probabilities are never published; the projection carries only the composed display claims.

## Hosted secrets

Set these in the Sites project’s hosted environment settings; never commit them:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_TOKEN_ENCRYPTION_KEY` — a base64/base64url-encoded 32-byte key
- `TASTE_ENGINE_ENV=production`
- `TASTE_LEGACY_PROFILE_EMAIL` — the original profile only, during and after migration
- `TASTE_ALLOWED_PROFILE_EMAILS` — canonical emails for the small trusted-user set
- `TASTE_REFRESH_SECRET` — at least 24 random characters
- `OLLAMA_API_KEY`
- `OLLAMA_MODEL`
- optional `OLLAMA_BASE_URL` (defaults to `https://ollama.com/api`)
- optional `OLLAMA_TIMEOUT_MS` (defaults to 180000)
- optional `TYPESAFE_AI_API_KEY` — enables card enrichment; without it cards render unchanged
- optional `TYPESAFE_AI_MODEL` (defaults to `jev-latest`; pin `jev-1.13.0` once confidence thresholds are tuned, since the alias moves on release)
- optional `AI_GATEWAY_API_KEY` with `NIGHTLIFE_INFERENCE_PROVIDER=gateway` — alternate route, not yet usable: the Vercel team needs a card on file before the Gateway serves requests
- optional bounds `NIGHTLIFE_MAX_CANDIDATES`, `NIGHTLIFE_CONCURRENCY`, `NIGHTLIFE_DEADLINE_MS`, `NIGHTLIFE_MAX_COST_USD`
- source keys used by enabled adapters: `LASTFM_API_KEY`, `SEATGEEK_CLIENT_ID`, `TICKETMASTER_API_KEY`, `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY`, and `EDMTRAIN_CLIENT_KEY`
- `TASTE_ENGINE_CONFIG_JSON` — version 2 allowlisted shared operational settings plus private per-profile brief, movie, sports, and personal-context configuration

Both administrative routes use `Authorization: Bearer <TASTE_REFRESH_SECRET>`:

- `POST /api/admin/projection` uploads an already validated projection for an explicit `profileId`. It remains a migration and recovery path.
- `POST /api/admin/refresh` runs the complete pipeline for an explicit `profileId`, or serially for all enabled connected profiles when omitted: Spotify evidence, Last.fm expansion, Framework/Insomniac calendars, SeatGeek and Ticketmaster discovery, EDMTrain matched-lineup enrichment, MLB and ticket observations, TMDB selection, deterministic normalization/deduplication/ranking, source-safe Ollama Cloud advisory passes, validation, and atomic profile-scoped D1 publication.
- `POST /api/runtime/refresh` runs the same pipeline for the signed-in owner without exposing the administrative secret.

An incomplete or invalid run never replaces the active projection. The hosted taste snapshot and recommendation projection become active together in one D1 batch.

Before the hosted route can refresh taste evidence, connect Spotify from the deployed site’s Taste tab and select at least one playlist. `SPOTIFY_CLIENT_ID` identifies the app but does not authorize access to a Spotify account.

## Operating checks

1. ChatGPT-signed-in feedback survives devices without an export/import step.
2. Hosted Spotify connection, playlist selection, token refresh, and all three Top Artists windows pass.
3. Every source adapter runs independently and emits the grouped source-health contract.
4. Deterministic output matches the local golden fixtures and the advisory safety suite passes.
5. A protected refresh completes within the request-duration limit.
6. An external scheduler calls the endpoint on Monday and Thursday without containing product logic.
7. Two hosted refreshes complete without local repair before the local recovery producer is retired.
8. With `TYPESAFE_AI_API_KEY` set, a hosted refresh reports `jev-events` as `active` or `partial` and some Music cards carry an **About this night** disclosure; with it unset, the refresh still publishes and the row reads `not configured`.

The guarded local refresh remains a disaster-recovery producer. It may upload a validated snapshot through the protected projection route, but local promotion and Sites publication remain separate operations.

See [Deployment and profile operations](deployment-and-profiles.md) for the clean-checkout release procedure, version contract, minimum profile boundary, and ordered migration/external actions.
