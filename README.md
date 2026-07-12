# Taste Engine

A personal decision engine for things worth leaving the house for.

It gathers events and releases from many sources, ranks them against revealed preferences and real-world constraints, and produces a short weekend brief. Afterward, a lightweight feedback check teaches it what was actually worth the money, time, and travel.

## The product loop

1. **Gather** candidates from structured event APIs, direct venue calendars, scheduled web discovery, artist watchlists, and film-release sources.
2. **Normalize** them into one event format and merge duplicates.
3. **Filter** hard no's before ranking.
4. **Rank** expected personal value while showing hassle, confidence, and ticket urgency separately.
5. **Brief** the top five—or explicitly recommend doing nothing.
6. **Learn** from saves, purchases, attendance, skips, and a 20-second post-event review.

## Current stage

The repository starts with the product brief and an execution plan. The first milestone is not a fully automated app. It is four useful weekly briefs that establish what “good” feels like and generate the first preference data.

- [Product brief](docs/product-brief.md)
- [Build plan](docs/build-plan.md)
- [Source strategy](docs/source-strategy.md)
- [Output and automation](docs/output-and-automation.md)
- [Starter preference profile](config/preferences.example.yaml)

## First working slice

Taste Engine can now create its canonical artist seed by reading selected playlists through the sibling `Playlist Sync` service.

1. Start Playlist Sync and connect Spotify there.
2. Copy `config/spotify-playlists.example.json` to `config/spotify-playlists.json`.
3. Add the playlists that represent your taste.
4. Run `npm run taste:seed` in this project.

The command writes the replaceable snapshot expected by event matching and scheduled discovery to `data/taste/artists.json`. It also preflights Playlist Sync's `user-top-read` scope and merges current Spotify Top Artists affinity from short-, medium-, and long-term windows when available. If the scope is missing, the command records one warning and continues with playlist-only evidence.

### Keep the taste seed current

`config/spotify-playlists.json` is intentionally editable and private. Add or replace playlists there as your taste shifts—especially electronic, club, IMAX-score, or other playlists that the current K-pop-heavy seed misses—then rerun `npm run taste:seed`.

### Generate Brief 001

1. Request a SeatGeek developer client ID, copy `.env.example` to `.env`, and set `SEATGEEK_CLIENT_ID` there.
2. Review `config/brief.json` for home base, search radius, ticket budget, pins, and exclusions.
3. Run `npm run brief:weekend`.

The command writes a deterministic JSON and Markdown weekend brief under `data/briefs/`. It never uses a model call or scrapes ticket marketplaces.

### Local post-event feedback

Feedback is local and append-only. The canonical journal is `data/taste/feedback.jsonl`; notes stay private and are never copied to the Sites projection or sent to Ollama.

```bash
npm run taste:feedback:add -- --event-id EVENT_ID --status attended-worth-it
npm run taste:feedback:list
npm run taste:feedback:validate
npm run taste:feedback:rebuild
npm run taste:feedback:simulate
```

Use `--event-title` and `--event-date-local` for a historical event that is no longer in the current projection. Replacements and revocations require `--yes` in noninteractive use and append an audit record; they never rewrite the original line. `config/feedback.json` enables capture and simulation but keeps `applyToPublishedRanking` set to `false`, so feedback remains shadow-only until a separately reviewed activation change.

## Upcoming decision site

The Sites surface projects concerts and a second movie vertical across the next 180 days:

- https://taste-engine-la.andrewsangari.chatgpt.site

Run `npm run site:refresh` to expand the current Spotify seed through Last.fm and rebuild the display-safe projection in `site/app/data/upcoming.json`. It uses the `LASTFM_API_KEY` already configured in the sibling Playlist Sync project as a fallback, or the same variable in this project's `.env`. The site is date-aware at render time: past-dated music, sports, movie, Overview, and Plan Ahead records fall away in the browser without requiring a rebuild. A rebuild is still needed to retrieve new source records or refreshed rankings.

For the complete refresh plus site build, run `npm run build:site`. It prints compact timings for Spotify/Last.fm, ticket sources, MLB/TMDB, normalization, Ollama enhancement, projection export, the Next/vinext build, and the total run.

Concert retrieval now merges and deduplicates:

- a fully paged LA-area geographic sweep split into 14-day windows, which prevents a dense early calendar from crowding later events out of the 180-day horizon;
- exact SeatGeek performer resolution followed by performer-ID event queries, which catches billing-name differences and support appearances.
- optional Ticketmaster Discovery API results;
- Framework's public artist roster, used as an exact promoter watchlist to expand SeatGeek performer and Ticketmaster attraction lookups;
- all upcoming events from Framework's public structured calendar and the followed Insomniac Los Angeles calendar, treated as explicitly followed promoters and allowed to fail independently;
- Dodgers home games from MLB Stats API, with standings, probable-pitcher, and optional ticket-source enrichment.

TMDB is a candidate source rather than a recommendation authority. Its output is constrained by `config/movies.json`: preferred genres, people, companies, keywords, exclusions, minimum popularity, and a hard candidate cap. Each shortlisted film retains cast/crew, genre, keyword, company, runtime, and US release-type metadata. It remains “format verification pending” until scheduled discovery confirms a meaningful engagement at a configured priority theater.

Resolved performer identities are cached privately. Retrieval diagnostics are written under `data/taste/`, and `npm run debug:artist -- "Artist Name"` traces one known artist from the Spotify seed through SeatGeek resolution and regional events. The site now has Overview, Music, Movies, and Sports tabs; the overview mixes music and Dodgers opportunities while movie candidates remain in their own vertical. Named editorial recommendations are source-gated, including the Ticketmaster-only context allowed for a SeatGeek + Ticketmaster merge.

### Optional keys

Add these to `.env` when ready:

```text
TICKETMASTER_API_KEY=
TMDB_ACCESS_TOKEN=
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:26b-mlx
```

`TMDB_API_KEY` is also supported instead of a TMDB access token. Missing or failed sources are omitted independently and shown in the site's source-health section; they do not block the rest of the refresh.

Local Ollama enables the optional post-ranking editorial brief without a hosted model endpoint. The editorial request contains aggregate counts plus a provenance-allowlisted named shortlist: Spotify-derived playlist membership, ranks, affinities, labels, and explanation text are excluded, while independently sourced artist names remain eligible. SeatGeek-only candidates stay unnamed, while merged SeatGeek + Ticketmaster candidates use only Ticketmaster-normalized context. Per-event music and sports advisory passes use sanitized features. Unsupported scarcity, sellout, availability, or access-loss claims are rejected. Structured-output failure immediately falls back to deterministic copy, and the model cannot change ranking or publication. The default model is `gemma4:26b-mlx`.

The next upcoming candidates may also receive four separate local advisory passes: personal fit, recommendation, urgency, and hassle. They use the private context in `config/personal-context.json` and opaque sanitized feature vectors. SeatGeek candidates are excluded from the urgency and hassle model passes; their deterministic values remain authoritative. Each pass can fail or return partial coverage independently.

The event explorer supports date-window and event-type filters, personal-fit/date/urgency/hassle sorting, urgent-only and low-hassle views, a source-health jump link, and UI-only collation of repeat appearances by the same primary artist. The mixed Overview explicitly queues its selected music and sports candidates ahead of the general Ollama advisory cap. Source health is grouped by Music, Sports, Movies, and Editorial. Festivals remain separate occurrences except when cross-source listings represent the same dated festival event.

### Automation requirements

### Guarded refresh and local promotion

Use the guarded workflow for routine operation:

```bash
npm run taste:refresh
npm run taste:validate
npm run taste:preview
npm run taste:promote -- --confirm PROMOTE
npm run taste:rollback -- --confirm ROLLBACK
```

`taste:refresh` builds in `data/taste/workflow/previews/latest`, validates the projection and bundle, writes a private manifest, and never changes accepted output. If Playlist Sync is unavailable it reuses the accepted projection, rebuilds it in isolation, and reports cache reuse. Add `--browser` to require the opt-in Playwright smoke suite during refresh. `taste:preview` serves only an unchanged validated preview and prints its content hash.

When local feedback capture is enabled, refresh also generates the private shadow report inside the preview workspace. Published feedback application must remain disabled; validation fails if it is active.

Promotion is local only: it displays no secrets, requires the literal confirmation, rejects a stale or invalid preview, preserves the prior accepted projection and bundle, and never publishes to Sites. Remote publishing remains a separate manual action under the site's existing restricted access policy. Run the full and empty browser suites sequentially because both build `site/dist`.

The local Codex automation runs Monday and Thursday mornings. The Mac must be awake, the Codex desktop app must be running, and this project must remain at its current path. Ollama must be running for locally enhanced editorial copy; if it is stopped, deterministic copy is published. Playlist Sync is optional during an automated run: the preflight never waits for reauthorization, and when it is stopped or missing `user-top-read`, valid playlist-only evidence is reused. Add the optional API keys above for Ticketmaster and movie candidates to participate, and edit `config/movies.json` when you want to change priority theaters or film-taste signals. The projection is schema version 5 with declared vertical-specific visuals; validate a preview before promoting through the site's existing access policy.
