# Taste Engine contributor guide

## Product objective

Build a private personal decision engine that ranks events by expected realized value, explains the ranking, exposes hassle and urgency separately, and learns from post-event feedback. A valid weekly result may be “do not waste your time this weekend.”

## Current working slice

Production is moving to Vercel + Supabase (owner decision, 2026-11-11); the earlier ChatGPT Sites + D1 deployment is being retired by the owner. The site is a stock Next.js app in `site/`. It reads active recommendation snapshots from Postgres (`DATABASE_URL`, Supabase's pooler) with the accepted bundled projection as a recovery fallback, stores signed-in feedback there, and owns hosted Spotify PKCE/token refresh, playlist reads, selection, and Top Artists cache. All SQL goes through the statement adapter in `site/db/index.ts`; tests and local development use in-process PGlite, so no database server is ever needed locally. Identity comes only from a Supabase Auth session verified on every request (`site/app/auth.ts`); no request header can name a user, and the email allowlist in `site/server/profiles.ts` decides access. Every table has row level security enabled with no policies, so Supabase's public REST API can read nothing. Ollama Cloud is the target optional advisory runtime. See `docs/hosted-runtime-migration.md`.

`npm run taste:seed` reads the playlists selected in `config/spotify-playlists.json` directly from Spotify through Taste Engine's own local client (`src/spotifyClient.js`; sign in once with `npm run spotify:connect`), preflights `user-top-read`, and writes replaceable playlist + current Top Artists evidence to `data/taste/artists.json`. Top Artists uses Spotify's short-, medium-, and long-term affinity windows; a missing scope or failed window never blocks playlist-only refresh.

The current snapshot is a technical proof from the selected source playlists and remains strongly K-pop-oriented. Do not assume it represents the complete event or film taste profile; preserve the playlist selector and make it easy to add electronic and other playlists.

`npm run site:refresh` expands the Spotify seed through Last.fm when available, retrieves Framework's public artist roster plus concerts independently from SeatGeek, Ticketmaster, Framework, and Insomniac, retrieves Dodgers home games from MLB and joins optional sports ticket observations, normalizes and deduplicates them, selects a constrained TMDB theatrical shortlist when configured, and writes the Sites projection. Any external source may be absent or unavailable without blocking the other sources or the site render. Always expose grouped source health so partial provider and local-inference coverage is legible.

## Commands

- `npm test` — run the local test suite
- `npm run spotify:connect` / `spotify:status` / `spotify:playlists` / `spotify:disconnect -- --confirm DISCONNECT` — Taste Engine's own local Spotify sign-in (read-only scopes); `spotify:import` is a one-time migration of an older sign-in
- `npm run taste:seed` — refresh Spotify-derived artist evidence; Spotify must be connected
- `npm run taste:feedback:review` — private report of what the local journal's feedback would move on the current projection
- `npm run taste:expand` — add constrained Last.fm similar-artist and top-tag candidates; falls back to direct Spotify artists when Last.fm is unavailable
- `npm run brief:weekend` — fetch a narrow SeatGeek weekend window and write deterministic brief outputs; requires `SEATGEEK_CLIENT_ID`
- `npm run site:export` — refresh the multi-source 180-day concert and movie projection consumed by the Sites surface
- `npm run site:refresh` — run taste expansion and the complete projection export
- `npm run build:site` — run Spotify/Last.fm refresh, source export, Ollama enhancement, and the Next.js build with compact phase timings
- `npm run taste:refresh` — build and validate an isolated private preview; when Spotify is not connected, keep the last valid Spotify snapshot and still refresh every other source; never publish
- `npm run taste:validate` — revalidate and seal the current private preview
- `npm run taste:preview` — serve the unchanged validated preview locally
- `npm run taste:promote -- --confirm PROMOTE` — explicitly replace local accepted artifacts after validation; never publish remotely
- `npm run taste:rollback -- --confirm ROLLBACK` — restore the last locally accepted projection and bundle
- `npm run debug:artist -- "Artist Name"` — trace one artist through SeatGeek performer resolution and regional events
- `npm run nightlife:probe` — send one synthetic candidate through the configured decision-inference route and report real latency, spend, and contract validity
- `npm run nightlife:cards` — measure evidence coverage, claim support, latency and spend for card enrichment against the real projection; changes no ranking or publication state
- `npm run evaluation:nightlife` — offline gold-set gate for card enrichment; needs no credentials or network

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

- Taste Engine owns read-only Spotify authentication and evidence on both paths: `site/server/spotify.ts` hosted, `src/spotifyClient.js` locally. There is no dependency on any other project or local service; production must not call localhost.
- Top Artists is replaceable cache state with a seven-day per-window expiry. Successful windows replace only themselves; failed windows may reuse valid cache, and expired windows contribute no ranking weight. Disconnect deletes tokens, playlist snapshots, Top Artists cache, and other Spotify-derived local snapshots immediately.
- Source playlists are intentionally user-editable. Add or replace selected playlists as taste shifts, then rerun `npm run taste:seed` before generating a new brief.
- Taste Engine owns preference evidence, event normalization, ranking, briefs, and feedback.
- SeatGeek is the preferred structured event source. Use its API through date-window geographic queries plus exact performer-ID queries; do not scrape or mirror it.
- Keep SeatGeek processing deterministic and do not supply SeatGeek API materials to an AI/ML model without written permission. When a SeatGeek occurrence is matched to Ticketmaster, local advisory passes may use only the normalized, source-agnostic feature vector for that merged occurrence; raw SeatGeek payload fields remain excluded.
- Ticketmaster is an optional structured concert source. Normalize it into the same candidate contract and deduplicate it against SeatGeek, Framework, and Insomniac.
- Framework and Insomniac are explicitly followed promoters. Import Framework's public event calendar and artist roster at low frequency, use the roster to expand deterministic SeatGeek/Ticketmaster artist lookups, preserve canonical links, allow matched events to enter ranking as promoter evidence, and fail gracefully if unavailable or protected by an access challenge.
- TMDB is an optional film candidate source, not a showtime or premium-format authority. Select a small editable-profile shortlist, then require separate theater/format confirmation before making a strong movie recommendation.
- Rams home games come from ESPN's public schedule and standings endpoints (`src/nfl.js`). They are undocumented, so the adapter is schema-tolerant and fails as an unavailable source rather than guessing; ESPN's embedded ticket block is never read. Ticket observations for Rams games come only from SeatGeek and Ticketmaster.
- Destination festivals (`src/destinationEvents.js`) are named events worth travelling for, found by exact watchlist name through the Ticketmaster and SeatGeek APIs regardless of the home radius, and ranked as a deliberate trip with an explicit travel label. The owner authorized one EDMTrain exception on 2026-11-11: a festival-flagged EDMTrain record whose name is exactly a watchlist name, inside the watch area, for an edition no ticketing API lists yet, is surfaced as an announced candidate (`destination.announcedBy: 'edmtrain'`) that links to EDMTrain, states no ticket facts, and gives way to the ticketing listing once one exists.
- Reviewed movie engagements (`config/movie-engagements.json`, private; `src/movieEngagements.js`) are the only way a film becomes actionable: each needs a theater, format, dates and a source URL, and expires. An unmatched film stays a watchlist item.
- Genre tags for discovered artists come from Last.fm when `LASTFM_API_KEY` is set and MusicBrainz otherwise (`src/artistTags.js`): one request per second, cached, exact-name matches only. Only public roster and promoter-calendar artist names are looked up.
- MLB Stats API is the authoritative Dodgers schedule source for the sports vertical. Cache and normalize schedule, standings, probable pitchers, and optional pitcher stats behind a schema-tolerant adapter. SeatGeek and Ticketmaster are ticket observations only; an unticketed MLB game remains a valid candidate with unknown urgency.
- Missing `TICKETMASTER_API_KEY`, `TMDB_ACCESS_TOKEN`, or `TMDB_API_KEY` must mark that source `not configured` and omit only that source. Runtime source errors must mark it `unavailable` or `partial`; they must not block publication of other valid sources.
- Scheduled native web discovery reads only the Spotify artist snapshot and public permitted sources. It writes a review queue, not the canonical database.
- Do not automate Vivid Seats, TickPick, Resident Advisor, or DICE without explicit permitted access. EDMTrain is explicitly authorized here only through its documented API, as lineup enrichment for confidently matched existing Music events and as the announcement source for an exact destination-watchlist festival that no ticketing API lists yet; it is not a discovery source for anything off that watchlist, must not be scraped, and must fail independently.
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

The optional Ollama stage runs only after deterministic ranking. Hosted production uses Ollama Cloud with sequential passes; the recovery path may use local Ollama. Per-event music and sports advisory passes receive opaque references plus sanitized non-Spotify features, or schedule-derived features from MLB for Dodgers games and ESPN for Rams games (owner-authorized 2026-11-11, with the league so a Rams game is never read as baseball); they cannot change canonical facts. Every candidate selected for the mixed Overview is explicitly prioritized in the advisory queue, even when it falls outside the general enhancement cap; fallback remains deterministic per item/pass. The editorial pass receives aggregate counts plus a small named shortlist only when source policy permits it. Spotify-derived playlist membership, artist payloads, ranks, affinities, seed strengths, labels, and explanation text are excluded by an allowlist serializer. A canonical artist, team or event name is allowed only when independently sourced from Ticketmaster, Framework, Insomniac, Last.fm, MLB, ESPN's schedule, TMDB, or another permitted provider. A candidate known only from an EDMTrain announcement is left out of every model pass. SeatGeek-only music candidates remain unnamed. A merged SeatGeek + Ticketmaster music occurrence may be named using only the Ticketmaster-normalized title/date/venue context; no SeatGeek payload, price, URL, or source ID is sent. Structured output validation, explicit rejection of unsupported scarcity/sellout/availability claims, mention-reference validation, and per-pass deterministic fallback are mandatory. Model output has no authority to add, remove, reorder, canonically score, or publish candidates. Never send SeatGeek-only API materials or Spotify Content to an AI/ML model without written permission.

Unavailable inference is normal and must render deterministic editorial copy. Hosted production uses `OLLAMA_BASE_URL=https://ollama.com/api`, a hosted `OLLAMA_API_KEY`, one configured `OLLAMA_MODEL`, and sequential passes. The local recovery path may still use a local daemon without changing the pipeline contract.

For music advisory passes, missing lineup, genre, or identity detail in the source-safe payload is uncertainty, not negative evidence, and must never by itself produce a `skip`. EDMTrain payloads and lineup provenance are not model input.

### Decision inference (System One / Jev)

A second, separate inference layer serves contextual nightlife discovery. It is a System One evaluation model, not a chat model: it answers typed Choice and Noul questions about one candidate and returns probabilities and confidence. It generates no text, so no model-written sentence ever describes an event; explanations are composed deterministically from typed answers and the fields actually sent. Low confidence becomes an explicit `unknown` rather than a weak rating.

Everything in the LLM boundary above applies unchanged. Never send SeatGeek-only API materials, Spotify Content or Spotify-derived preference evidence, EDMTrain payloads, personal-context notes, or credentials. `src/nightlife/semanticInput.js` enforces this with a field allowlist, a declared provenance for every emittable field, and a transmission guard run by both adapters; withheld evidence is named in `knownUnknowns` and never converted into a negative signal.

Provider selection is configuration. Direct TypeSafe serving is the verified default; the Vercel AI Gateway is an alternate inference route and not a hosting change. No module outside `src/nightlife/providers/` may branch on which provider is active.

Jev characterizes events only; it never receives who an event is for, not even the discovery tier. Personal relevance is compared locally afterwards in `src/nightlife/personalRelevance.js`, and a personal claim requires both an evidenced event attribute and an established preference signal (a direct artist match or a taste-profile tag). A discovery path is not a preference or proof of novelty, and a missing structured field is never stated as an absence.

This layer is advisory only and has no surface of its own. Enrichment appears inside the existing Music and Overview cards as at most a few source-linked claims, each marked verified, inferred, or not known; a candidate with nothing specific to add renders nothing. It must not change the canonical utility score, Fit, Friction, Urgency, Confidence, source facts, publication eligibility, or the learned taste profile. Schedule, travel, budget, and urgency are always recomputed deterministically. Evidence stays out of the published projection and is written to the gitignored `data/` directory for evaluation. There is no standalone nightlife route or form. See `docs/system-one-inference.md`.

## Automation contract

- Rules in this section that name Sites apply only while the ChatGPT Sites deployment still exists; they do not describe the Vercel deployment.
- `site/` is an ordinary tracked directory in the main Taste Engine repository, not a submodule or nested Git repository. Keep the personal GitHub SSH remote as the only persistent `origin`; never persist a Sites source credential or managed Sites remote in local Git configuration. Sites publication must derive a site-rooted source commit from the `site/` subtree, push it with a short-lived per-command Sites credential, and package the matching `site/` build.
- The production scheduler is Vercel Cron (`site/vercel.json`, Monday and Thursday) calling `/api/cron/refresh` with `CRON_SECRET`; the route holds no logic of its own and runs the same protected refresh as `/api/admin/refresh`. The Cloudflare Worker in `site/scheduler/` is kept, undeployed, as the fallback if a refresh ever outgrows the 300-second function limit. Either trigger contains no Taste Engine logic or source credentials beyond its secret.
- Deploy to Vercel only when the owner asks. Never change a Vercel project's visibility, deployment protection, domains or team, and never put a secret in source, `vercel.json` or a build log.
- Keep the guarded local Codex automation as a recovery and parity producer until every hosted adapter, validation gate, and two consecutive scheduled refreshes pass.
- Monday and Thursday morning runs should preflight `user-top-read`, reuse valid Top Artists windows or the last valid Spotify snapshot when Spotify is not connected, refresh Last.fm, Framework's artist roster, MLB, ticket observations, and structured sources independently, run tests, update the projection, and preview-validate before promoting through the site's existing Sites access policy. Source health is grouped in the site by Music, Sports, Movies, and Editorial; `spotify-top-artists` exposes only restrained window freshness and cache expiry, never authorization or token details.
- Native web discovery may confirm premium-format movie engagements at the configured priority theaters and may discover public artist/venue announcements. It writes a reviewable queue with URLs and uncertainty; it does not silently mutate canonical facts.
- Hosted production must continue while the desktop and computer are off. During cutover, recovery refreshes still require the project at its configured path. Ollama Cloud is optional; otherwise deterministic copy publishes.
- Local inference uses a large MLX model and may produce no terminal output for several minutes. Automation must allow the full configured timeout for each schema-constrained pass and a generous overall run window; quiet output alone is not a hang. Do not interrupt Ollama before its timeout. If an individual pass times out or fails validation, preserve its deterministic fallback and continue the run.
- Sites deployment automation must inspect and preserve the current access policy. It must not toggle share visibility, switch a site to “just me,” or make a private/public transition as part of a refresh. Use the owner-only deployment path when the current policy is verified owner-only; use the normal deployment path only when the existing shared/public policy and the automation's authorization permit it. If the policy cannot be verified, stop with an actionable deployment warning rather than changing access.

## Output direction

The canonical result is one synthesized ranking represented as JSON and Markdown. The site at `site/` renders the current 180-day projection with timing and hassle filters. The browser hides records whose local date has passed and updates that date boundary at runtime; a rebuild is still required for new source coverage. Preserve the editorial decision surface; do not turn it into a generic dashboard.

Read these before changing product scope:

- `docs/product-brief.md`
- `docs/source-strategy.md`
- `docs/output-and-automation.md`
- `docs/build-plan.md`
- `docs/system-one-inference.md`

## Completion standard

Keep the pipeline repeatable and explainable. Tests must pass. A source failure should preserve the previous valid state or stop with an actionable error; it must never silently publish an empty or corrupted brief.

All routine refresh work must use the guarded preview lifecycle. Never call local promotion from scheduled automation, never bypass validation manifests, and never treat local promotion as Sites publication. Run the full and empty browser suites sequentially; they share `site/dist`.

## Decision plans and evidence graph

Both are read-time, deterministic and advisory, authorized by the owner on 2026-11-11. Neither changes a score, an ordering, publication eligibility or the published projection, and neither uses a model.

- `src/decisionPlan.js` solves the live-ranked dates into combinations of nights: an exact search under hard limits (one thing per day, nights per week, optional budget, no back-to-back nights, trips on or off), with saved and held dates pinned and passed dates excluded. It returns up to three plans that differ only in objective, each with what it left out and the specific reason. An unknown price is never guessed: it counts as zero toward a budget and is reported as unpriced. "Nothing clears the bar" is a valid result.
- `src/evidenceGraph.js` turns the relationships already published on each row (who is on a bill, who the person plays, which promoter presents it, which room it is in, what they have rated) into a typed graph, and derives each night's independent routes back to the person, clusters of related upcoming nights, and the constellation layout. It reads published rows only and emits display names, coarse relation labels and counts; never Spotify ids, ranks, strengths or playlist names.
- The site runs both in the browser through the generated bundle, so they follow the feedback overlay live. The person's planning limits are a `profile_settings` row (`planning`), normalized by the solver before it is stored.
- A change to either module's math needs its policy version bumped and its tests updated; the solver's exactness test against brute force must keep passing.

## Feedback contract

Feedback never changes what is published. Both refresh pipelines publish canonical, feedback-free scores, and preview validation fails if a projection carries applied adjustments. A person's own reads and outcomes are laid over those scores at read time by `applyFeedbackOverlay` in `src/feedbackPolicy.js`, the single pure implementation that the browser and the server run through generated bundles. The owner authorized this on 2026-11-11 in place of the earlier activation gate: the overlay is on by default, shown on every moved card with its reason, summarized live in the Taste tab, and switched off there per profile.

- Signals are graded and shrink toward zero; logistics reasons only ever raise learned friction and never count against an artist, venue or scene.
- Keys are derived from fields a card already displays and are frozen into each record at capture.
- Records are append-only (`feedback_records`); the latest record for a night is its answer and `withdrawn` erases it. Plans, check-in responses and settings are stored per entity (`feedback_plans`, `feedback_history_responses`, `profile_settings`) and merged last-write-wins per item, never as one blob.
- The site syncs by sending what the server lacks and merging what comes back (`site/app/feedback-sync.ts`, `site/server/feedback-sync.ts`); a failed save must never drop a change.
- State-changing routes reject cross-site requests (`site/server/request-guard.ts`).
- A change to the policy's math needs its version bumped and its tests updated.
