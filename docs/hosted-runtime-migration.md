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
- later: normalized candidates, occurrences, profiles, and sync checkpoints

The bundled `site/app/data/upcoming.json` remains a validated bootstrap and disaster-recovery snapshot during migration. The site reads an active D1 recommendation snapshot first and falls back to that bundle only when the database is empty or unavailable.

Browser storage is a compatibility fallback, not the hosted source of truth. Signed-in feedback is loaded from and written to D1. Existing device state is uploaded when the signed-in D1 record is empty.

## Spotify

Taste Engine now owns the hosted read-only Spotify path copied from Playlist Sync’s proven implementation:

- authorization-code flow with PKCE
- refresh-token rotation
- private and collaborative playlist reads
- playlist artist summaries
- short-, medium-, and long-term Top Artists windows
- seven-day per-window cache reuse
- explicit disconnect deletion

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

## Hosted secrets

Set these in the Sites project’s hosted environment settings; never commit them:

- `SPOTIFY_CLIENT_ID`
- `TASTE_REFRESH_SECRET` — at least 24 random characters
- `OLLAMA_API_KEY`
- `OLLAMA_MODEL`
- optional `OLLAMA_BASE_URL` (defaults to `https://ollama.com/api`)
- optional `OLLAMA_TIMEOUT_MS` (defaults to 180000)
- source keys used by enabled adapters: `LASTFM_API_KEY`, `SEATGEEK_CLIENT_ID`, `TICKETMASTER_API_KEY`, `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY`, and `EDMTRAIN_CLIENT_KEY`
- `TASTE_ENGINE_CONFIG_JSON` — the private brief, movie, sports, and personal-context configuration serialized as one JSON object

Both administrative routes use `Authorization: Bearer <TASTE_REFRESH_SECRET>`:

- `POST /api/admin/projection` uploads an already validated projection. It remains a migration and recovery path.
- `POST /api/admin/refresh` runs the complete pipeline: Spotify evidence, Last.fm expansion, Framework/Insomniac calendars, SeatGeek and Ticketmaster discovery, EDMTrain matched-lineup enrichment, MLB and ticket observations, TMDB selection, deterministic normalization/deduplication/ranking, source-safe Ollama Cloud advisory passes, validation, and atomic D1 publication.
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

The guarded local refresh remains a disaster-recovery producer. It may upload a validated snapshot through the protected projection route, but local promotion and Sites publication remain separate operations.
