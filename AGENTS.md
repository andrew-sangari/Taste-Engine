# Taste Engine contributor guide

## Product objective

Build a private personal decision engine that ranks events by expected realized value, explains the ranking, exposes hassle and urgency separately, and learns from post-event feedback. A valid weekly result may be “do not waste your time this weekend.”

## Current working slice

`npm run taste:seed` reads the playlists selected in `config/spotify-playlists.json` through the local Playlist Sync service, preflights `user-top-read`, and writes replaceable playlist + current Top Artists evidence to `data/taste/artists.json`. Top Artists uses Spotify's short-, medium-, and long-term affinity windows; a missing scope or failed window never blocks playlist-only refresh.

The current snapshot is a technical proof from the selected Playlist Sync source playlists and remains strongly K-pop-oriented. Do not assume it represents the complete event or film taste profile; preserve the playlist selector and make it easy to add electronic and other playlists.

`npm run site:refresh` expands the Spotify seed through Last.fm when available, retrieves Framework's public artist roster plus concerts independently from SeatGeek, Ticketmaster, Framework, and Insomniac, retrieves Dodgers home games from MLB and joins optional sports ticket observations, normalizes and deduplicates them, selects a constrained TMDB theatrical shortlist when configured, and writes the Sites projection. Any external source may be absent or unavailable without blocking the other sources or the site render. Always expose grouped source health so partial provider and local-inference coverage is legible.

## Commands

- `npm test` — run the local test suite
- `npm run taste:seed` — refresh Spotify-derived artist evidence; Playlist Sync must be running and connected
- `npm run taste:expand` — add constrained Last.fm similar-artist and top-tag candidates; falls back to direct Spotify artists when Last.fm is unavailable
- `npm run brief:weekend` — fetch a narrow SeatGeek weekend window and write deterministic brief outputs; requires `SEATGEEK_CLIENT_ID`
- `npm run site:export` — refresh the multi-source 180-day concert and movie projection consumed by the Sites surface
- `npm run site:refresh` — run taste expansion and the complete projection export
- `npm run build:site` — run Spotify/Last.fm refresh, source export, Ollama enhancement, and the Next/vinext build with compact phase timings
- `npm run taste:refresh` — build and validate an isolated private preview; reuse the accepted projection when Playlist Sync is unavailable; never publish
- `npm run taste:validate` — revalidate and seal the current private preview
- `npm run taste:preview` — serve the unchanged validated preview locally
- `npm run taste:promote -- --confirm PROMOTE` — explicitly replace local accepted artifacts after validation; never publish remotely
- `npm run taste:rollback -- --confirm ROLLBACK` — restore the last locally accepted projection and bundle
- `npm run debug:artist -- "Artist Name"` — trace one artist through SeatGeek performer resolution and regional events

## Private local files

Do not commit or print the contents of:

- `config/spotify-playlists.json`
- `config/brief.json`
- `config/movies.json`
- `config/personal-context.json`
- `config/sports.json`
- `data/`
- `.env`

Summaries such as artist count and warning count are safe. Avoid dumping complete artist histories unless needed for the task.

## Architectural boundaries

- Playlist Sync owns Spotify authentication for the first slice. Taste Engine calls its documented local endpoints, including `/api/status` and `/api/spotify/top-artists`. Reconnect Spotify once after the `user-top-read` scope is added; scheduled runs do not wait for interactive authorization.
- Top Artists is replaceable cache state with a seven-day per-window expiry. Successful windows replace only themselves; failed windows may reuse valid cache, and expired windows contribute no ranking weight. Disconnect deletes tokens, playlist snapshots, Top Artists cache, and other Spotify-derived local snapshots immediately.
- Source playlists are intentionally user-editable. Add or replace selected playlists as taste shifts, then rerun `npm run taste:seed` before generating a new brief.
- Taste Engine owns preference evidence, event normalization, ranking, briefs, and feedback.
- SeatGeek is the preferred structured event source. Use its API through date-window geographic queries plus exact performer-ID queries; do not scrape or mirror it.
- Keep SeatGeek processing deterministic and do not supply SeatGeek API materials to an AI/ML model without written permission. When a SeatGeek occurrence is matched to Ticketmaster, local advisory passes may use only the normalized, source-agnostic feature vector for that merged occurrence; raw SeatGeek payload fields remain excluded.
- Ticketmaster is an optional structured concert source. Normalize it into the same candidate contract and deduplicate it against SeatGeek, Framework, and Insomniac.
- Framework and Insomniac are explicitly followed promoters. Import Framework's public event calendar and artist roster at low frequency, use the roster to expand deterministic SeatGeek/Ticketmaster artist lookups, preserve canonical links, allow matched events to enter ranking as promoter evidence, and fail gracefully if unavailable or protected by an access challenge.
- TMDB is an optional film candidate source, not a showtime or premium-format authority. Select a small editable-profile shortlist, then require separate theater/format confirmation before making a strong movie recommendation.
- MLB Stats API is the authoritative Dodgers schedule source for the sports vertical. Cache and normalize schedule, standings, probable pitchers, and optional pitcher stats behind a schema-tolerant adapter. SeatGeek and Ticketmaster are ticket observations only; an unticketed MLB game remains a valid candidate with unknown urgency.
- Missing `TICKETMASTER_API_KEY`, `TMDB_ACCESS_TOKEN`, or `TMDB_API_KEY` must mark that source `not configured` and omit only that source. Runtime source errors must mark it `unavailable` or `partial`; they must not block publication of other valid sources.
- Scheduled native web discovery reads only the Spotify artist snapshot and public permitted sources. It writes a review queue, not the canonical database.
- Do not automate Vivid Seats, TickPick, Resident Advisor, or DICE without explicit permitted access. EDMTrain is explicitly authorized here only through its documented API as lineup enrichment for confidently matched existing Music events; it is not a discovery source, must not be scraped, and must fail independently.
- Preserve source URLs, retrieval timestamps, uncertainty, and conflicts.
- Export `RecommendationVisual` metadata with schema version 5. Music and Sports use deterministic texture variants; TMDB images are allowlisted and attributed. The export layer chooses the visual, while the site only renders the declared object. Never publish SeatGeek-only imagery.

## Retrieval and ranking contract

1. Retrieve each external source independently and retain its source URL and retrieval time.
2. Normalize all concert sources before ranking.
3. Deduplicate cross-source occurrences by date/time, venue, and performer/title evidence while retaining every source occurrence. The display layer collapses one real occurrence to one date row and exposes each retained provider link on that row.
4. Match performers by SeatGeek performer ID, linked Spotify ID, or exact normalized name. Never silently fuzzy-match short names. Framework roster expansion must use exact provider performer/attraction matches.
5. Preserve discovery tiers: direct playlist, Last.fm similar, Last.fm tag, and explicitly followed promoter/roster.
6. Treat movie format, theater, urgency, hassle, and presentation quality as distinct fields. A TMDB theatrical date alone does not confirm IMAX, 70mm, Dolby, or a worthwhile local engagement.
7. A missing source is valid output when source health makes it explicit.

## LLM boundary

The deterministic pipeline owns retrieval, normalization, deduplication, identity resolution, ranking inputs, scoring, source health, and publication eligibility. Do not make Codex or an LLM an implicit runtime dependency.

The optional local Ollama stage runs only after deterministic ranking. Per-event music and sports advisory passes receive opaque references plus sanitized non-Spotify or MLB-derived features; they cannot change canonical facts. Every candidate selected for the mixed Overview is explicitly prioritized in the local advisory queue, even when it falls outside the general enhancement cap; fallback remains deterministic per item/pass. The editorial pass receives aggregate counts plus a small named shortlist only when source policy permits it. Spotify-derived playlist membership, artist payloads, ranks, affinities, seed strengths, labels, and explanation text are excluded by an allowlist serializer. A canonical artist name is allowed only when independently sourced from Ticketmaster, Framework, Insomniac, Last.fm, MLB, TMDB, or another permitted provider. SeatGeek-only music candidates remain unnamed. A merged SeatGeek + Ticketmaster music occurrence may be named using only the Ticketmaster-normalized title/date/venue context; no SeatGeek payload, price, URL, or source ID is sent. Structured output validation, explicit rejection of unsupported scarcity/sellout/availability claims, mention-reference validation, and per-pass deterministic fallback are mandatory. Model output has no authority to add, remove, reorder, canonically score, or publish candidates. Never send SeatGeek-only API materials or Spotify Content to an AI/ML model without written permission.

Unavailable local inference is normal and must render deterministic editorial copy. `OLLAMA_BASE_URL` defaults to `http://127.0.0.1:11434`, `OLLAMA_MODEL` defaults to `gemma4:26b-mlx`, and `OLLAMA_TIMEOUT_MS` defaults to three minutes. These may be overridden without changing the pipeline contract.

For music advisory passes, missing lineup, genre, or identity detail in the source-safe payload is uncertainty, not negative evidence, and must never by itself produce a `skip`. EDMTrain payloads and lineup provenance are not model input.

## Automation contract

- Use a local Codex automation because the run needs project files and private environment variables.
- Monday and Thursday morning runs should preflight `user-top-read`, reuse valid Top Artists windows or the last valid Spotify snapshot when Playlist Sync is unavailable, refresh Last.fm, Framework's artist roster, MLB, ticket observations, and structured sources independently, run tests, update the projection, and preview-validate before promoting through the site's existing Sites access policy. Source health is grouped in the site by Music, Sports, Movies, and Editorial; `spotify-top-artists` exposes only restrained window freshness and cache expiry, never authorization or token details.
- Native web discovery may confirm premium-format movie engagements at the configured priority theaters and may discover public artist/venue announcements. It writes a reviewable queue with URLs and uncertainty; it does not silently mutate canonical facts.
- The desktop app and computer must be running, the project must remain at its configured path, and required services or keys must be available for their source to participate. Ollama must be running locally for enhanced editorial copy; otherwise deterministic copy publishes.
- Local inference uses a large MLX model and may produce no terminal output for several minutes. Automation must allow the full configured timeout for each schema-constrained pass and a generous overall run window; quiet output alone is not a hang. Do not interrupt Ollama before its timeout. If an individual pass times out or fails validation, preserve its deterministic fallback and continue the run.
- Sites deployment automation must inspect and preserve the current access policy. It must not toggle share visibility, switch a site to “just me,” or make a private/public transition as part of a refresh. Use the owner-only deployment path when the current policy is verified owner-only; use the normal deployment path only when the existing shared/public policy and the automation's authorization permit it. If the policy cannot be verified, stop with an actionable deployment warning rather than changing access.

## Output direction

The canonical result is one synthesized ranking represented as JSON and Markdown. The Sites surface at `site/` renders the current 180-day projection with timing and hassle filters. The browser hides records whose local date has passed and updates that date boundary at runtime; a rebuild is still required for new source coverage. Preserve the editorial decision surface; do not turn it into a generic dashboard.

Read these before changing product scope:

- `docs/product-brief.md`
- `docs/source-strategy.md`
- `docs/output-and-automation.md`
- `docs/build-plan.md`

## Completion standard

Keep the pipeline repeatable and explainable. Tests must pass. A source failure should preserve the previous valid state or stop with an actionable error; it must never silently publish an empty or corrupted brief.

All routine refresh work must use the guarded preview lifecycle. Never call local promotion from scheduled automation, never bypass validation manifests, and never treat local promotion as Sites publication. Run the full and empty browser suites sequentially; they share `site/dist`. Feedback application must remain disabled unless a separate activation review explicitly authorizes the ranking and public-explanation change.
