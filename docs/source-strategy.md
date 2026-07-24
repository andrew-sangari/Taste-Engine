# Source strategy

## Recommended first stack

### 1. Spotify playlists — taste seed

The hosted Sites runtime now owns the production read-only Spotify path, ported from the sibling `Playlist Sync` project:

- Spotify authorization-code flow with PKCE
- token storage and refresh
- playlist enumeration
- paginated playlist-track retrieval
- artist IDs and names
- playlist artist summaries with track counts and sample tracks
- Last.fm artist tags

Playlist Sync remains the local parity and recovery implementation during cutover. Production stores tokens, selected playlists, and replaceable Top Artists windows in D1 and must not depend on its localhost endpoints.

### Spotify evidence rules

An artist appearing repeatedly is useful evidence, but raw track count is biased by long playlists, compilations, and prolific artists. Start with:

`seed strength = 3 * playlist diversity + log(1 + track count)`

Then apply these safeguards:

- only use playlists the user explicitly selects
- distinguish user-owned, collaborative, and editorial playlists
- cap the contribution from any one playlist
- retain sample tracks so the reason is inspectable
- allow mute and correction per artist
- treat Last.fm tags as descriptive metadata, not personal preference by themselves

Later, playlist-item timestamps can add a recency term, and optional Spotify scopes can add liked tracks or followed artists. Playlist seeding is sufficient for the first brief.

### 2. SeatGeek API — preferred event and ticket source

Use SeatGeek's documented API as the primary structured connector. The current connector combines:

- a paged LA-area geographic sweep split into small date windows
- exact performer resolution using linked Spotify IDs first and normalized names second
- performer-ID event lookups for direct and Last.fm-expanded artists
- performer and venue identifiers for normalization
- current listing summaries and canonical SeatGeek links

The paths merge by SeatGeek event ID. Location is applied after performer-directed retrieval, ticket inventory is not required for inclusion, and support performers remain eligible. `npm run debug:artist -- "Artist Name"` provides the acceptance path for a known missing concert. The Framework roster is an additional exact-name watchlist for deterministic performer resolution; it never becomes a fuzzy artist match.

Use an approved developer application and follow SeatGeek's API terms. Do not scrape the website. The current API terms also restrict systematic downloading and storage, so retain only the minimum identifiers, normalized facts, source link, and timestamp needed by the personal brief unless the developer agreement explicitly permits broader caching. The terms also prohibit making SeatGeek materials available to AI or machine-learning applications or models. Keep the SeatGeek path deterministic—rules, matching, and templates—and do not send its payloads to an LLM or train on them without written permission. Personal preference outcomes should be stored and learned from independently from source content.

### 3. Framework artist roster — followed promoter watchlist

Framework's public `/artists/` page is a roster, not an event feed. Import its canonical artist links and names at low frequency, retain the normalized roster privately, and use it to expand exact SeatGeek performer-ID and Ticketmaster attraction lookups. Roster membership contributes promoter evidence to ranking; it does not override Spotify/Last.fm preference strength. If the page is unavailable or its markup changes, mark `framework-artists` unavailable and continue with the existing event and taste sources.

### 4. 19hz LA — electronic gap-filler feed

The LA page is unusually useful as a gap filler: one server-rendered table currently exposes date/time, event and venue, genre tags, price, age restriction, promoter, original links, and a canonical date. It also covers the smaller electronic events broad ticketing APIs often miss.

Before making this a scheduled connector:

- ask the maintainer for permission for a private personal importer
- fetch at most once daily with a clear user agent
- cache the raw page and parse locally
- preserve and display the original event link
- never republish or expose a competing public event feed
- stop automatically if the page adds access restrictions or a terms conflict

The parser should target the table structure, not use broad regular expressions. Store a parser fixture so HTML changes cause a test failure rather than silently corrupting events.

### 5. Ticketmaster Discovery API — fallback structured coverage

Use for mainstream concerts, larger venues, stable event/venue identifiers, status, images, and official purchase links. It is a complement to 19hz rather than the primary electronic source.

### 6. Insomniac Los Angeles — followed promoter calendar

The public Los Angeles events page is a useful electronic-music and festival precision source. Import it at low frequency, preserve the Insomniac event URL and retrieval time, and normalize it into the same concert contract before matching and deduplication. Prefer JSON-LD or explicit structured event attributes when available; do not bypass Cloudflare or other access controls. If the page returns a challenge or an unrecognized shape, mark Insomniac unavailable and render the rest of the projection normally.

### 7. Direct venue/promoter pages — precision patches

Add only after Brief 001 reveals a recurring coverage hole. Prefer RSS, iCal, JSON-LD, or official APIs before HTML parsing. A direct adapter is justified when that venue repeatedly produces high-ranked events missed elsewhere.

### 8. MLB Stats API — Dodgers schedule authority

For the first sports vertical, MLB defines the canonical Dodgers home game. Retrieve schedule, standings, series metadata, probable pitchers, and optional current-season pitcher stats through an isolated adapter, cache normalized results, and tolerate missing enrichment. Do not treat SeatGeek or Ticketmaster titles as the game identity; join their ticket observations by teams, local date, and venue. A game with no commercial match remains a valid schedule candidate with unknown ticket urgency.

### Optional paid fallback: JamBase

JamBase exposes a documented, normalized concert API covering events, artists, venues, and geographic search. Evaluate its trial only if 19hz plus Ticketmaster and SeatGeek leave meaningful non-electronic coverage gaps; it is unnecessary for the first slice.

PredictHQ also has an events API, but it is aimed more at commercial demand intelligence and subscription-bounded coverage than personal music discovery. It is a lower-priority fit here.

## Sources not to automate initially

### TickPick

Do not scrape it. Its current user agreement prohibits systematic retrieval, automated use, and scraping/crawling. It can remain a manually opened purchase-comparison link.

### Vivid Seats

Do not scrape it. Its current terms prohibit crawling, scraping, or harvesting marketplace data. Vivid Seats advertises an affiliate program with deep links, and company materials describe event feeds for distribution partners, but no public self-serve event API was found. Keep it as a manually opened price-comparison link unless Vivid Seats approves the project for a partner feed with explicit data rights.

### EDMTrain

Use only the documented API with the locally configured client key; never scrape it. The authorized scope is enrichment-only: same-date canonical events may receive ordered lineup, B2B grouping, age, and source-link metadata only after a confident venue/title/artist match. EDMTrain never creates a candidate, receives a ranking bonus merely for being present, or supplies model input. Ambiguous and unmatched records remain in a private audit artifact, and API failure leaves the rest of the projection intact.

### Eventbrite

Its documented API is useful for events belonging to known organizations or venues, but it is not the best general city-discovery source. Add selected organizers only when they fill demonstrated gaps.

### Resident Advisor and DICE

Treat these as original event links discovered through permitted feeds or manual submissions unless an official integration becomes available. Do not build the MVP around reverse-engineered private endpoints.

## Connector contract

Every source should return the same envelope in memory. Persist only the fields and duration permitted by that source's terms:

```text
source_event_id
source_name
source_url
retrieved_at
raw_snapshot_id
title
start/end/timezone
venue name/address/coordinates
lineup names
tags
price and age text
availability/status
field-level confidence
```

Normalization and deduplication happen after ingestion. A source adapter should never decide whether an event fits the user's taste.

## Artist matching

Event feeds rarely carry Spotify artist IDs, so matching needs its own auditable layer:

1. normalize case, punctuation, accents, and common billing suffixes
2. split lineups carefully while preserving `b2b`, live-set, and support context
3. exact-match known names and aliases first
4. send ambiguous matches to a small review queue
5. store confirmed aliases permanently

Never fuzzy-match a short artist name automatically. A wrong identity match creates a very confident but nonsensical recommendation.

## First implementation slice

1. `spotify:seed` writes a JSON snapshot of selected playlist artists.
2. `events:fetch --source seatgeek` queries the target weekend and seeded artists without mirroring the catalog.
3. `events:fetch --source 19hz-la` stores an approved low-frequency snapshot and parsed gap-fill candidates.
4. `events:match` links lineup names to Spotify seeds and emits a review queue.
5. `brief:generate --weekend` produces Markdown with matched artist evidence, genre adjacency, hassle placeholders, confidence, and negative filtering.
6. The reviewed Brief 001 becomes the golden test for future scoring changes.
