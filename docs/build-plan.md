# Build plan

## Recommendation

Start with a local-first decision pipeline that emits Markdown briefs. Reuse the working Node/Spotify foundation from the sibling `Playlist Sync` project. Add a small feedback form only after the brief format works. Do not build the full application shell first.

The order is:

`Spotify taste seed + structured events + scheduled web discovery -> first brief -> private site + feedback -> learned ranking`

## Phase 0 — build the thin vertical slice (2–3 days)

1. Extract the Spotify auth, token refresh, playlist enumeration, playlist-track, playlist-artist, and Last.fm tag modules from `Playlist Sync` into this project.
2. Let the user choose which playlists represent current taste. Do not silently treat every followed or editorial playlist as preference evidence.
3. Convert selected playlists into artist seed evidence using playlist diversity, logarithmic track count, and sample tracks.
4. Query SeatGeek for the target weekend and seeded artists, retaining only source-permitted data. Add an approved 19hz snapshot as an electronic gap filler.
5. Match event lineup names to Spotify artists with an alias table and explicit confidence.
6. Generate Brief 001 with scores, reasons, hassle, urgency, and rejected examples.
7. Mark every “obvious miss” and rewrite the relevant preference or rule.

**Exit:** one command refreshes taste seeds and candidates and produces a brief useful enough to act on. Its rankings can be explained from recorded evidence.

## Phase 1 — build the spine (3–5 days)

Implement:

- SQLite as the local source of truth
- tables for candidates, occurrences, entities, sources, interactions, reviews, and preference evidence
- a canonical event schema with provenance
- URL/manual entry import
- duplicate detection using normalized title, venue, date/time, and participant overlap
- Markdown brief generation

Keep raw source payloads only where the source license permits it. Otherwise keep the source ID/link, retrieval timestamp, normalized minimum fields, and a parser fixture made from synthetic data.

**Exit:** the manually assembled fixture produces the same Brief 001 deterministically.

## Phase 2 — add sources in value order (about 1 week)

Add one adapter at a time and measure incremental useful coverage:

1. SeatGeek's documented API, using narrow weekend and seeded-artist queries
2. an approved 19hz LA import for electronic coverage gaps
3. five high-value venue/promoter calendars
4. movie-release metadata
5. theater/showtime or premium-format confirmation

Do not add a source merely because it has many events. Retain it only if it adds candidates that survive the filters or improves data quality on existing candidates.

**Exit:** at least 80% of candidates in a useful weekly brief arrive without manual re-entry, with duplicates merged.

## Phase 3 — close the feedback loop (2–4 days)

Add interactions with different evidentiary weights:

- impression: nearly zero signal
- open: weak positive
- save/watch: moderate positive
- purchase: strong intent, not outcome
- attend: strong behavioral signal
- worth-it review: strongest outcome signal
- dismissed with reason: explicit negative or constraint signal
- could-not-attend: constraint evidence only

Send the post-event check the next morning, not immediately after the event. Update preference evidence only after storing the raw interaction.

**Exit:** a review changes the next generated brief in a visible, explainable way.

## Phase 4 — automate the weekly rhythm (2–3 days)

Suggested cadence:

- Monday and Thursday mornings: run native web discovery against the current Spotify-derived artist set
- daily: refresh structured availability/price observations without sending licensed ticket-platform payloads to an AI model
- Wednesday evening: generate a draft weekend brief
- Thursday morning: refresh urgency and publish the final brief to Sites
- morning after an attended event: request feedback
- monthly: show what the engine thinks it learned and allow corrections

Automation should create drafts and alerts, not buy tickets or message other people.

Use a local project scheduled task so the run can read the current artist snapshot and project files. The computer must be on and the desktop app running. The web-search step writes a reviewable candidate queue; it does not write directly into the canonical event database.

**Exit:** two consecutive briefs run with no manual data repair, and each discovered event retains its supporting URLs.

## Phase 5 — learn the ranker (after enough evidence)

Begin with hand-tuned weights. Move to a learned model only after there is enough personal data:

- train on attended + worth-it outcomes
- use saves/purchases as weaker auxiliary labels
- treat availability-caused skips as censored, not negative
- include context features such as weekday, companion, price, travel time, venue, format, and novelty
- use time-aware validation so future behavior is never used to predict the past
- retain an exploration slot to prevent the profile from becoming a taste prison

A small interpretable model is preferable to a complex model with sparse personal labels.

## Technical shape

For the personal prototype:

- Node.js 20+ for ingestion, normalization, scoring, and brief generation, matching the reusable Spotify project
- SQLite for local persistence
- JSON for machine-managed source configuration and YAML for the editable profile and rules
- Markdown for versioned weekly briefs
- a tiny local web form or message workflow for feedback
- scheduled Codex tasks only after the scripts are deterministic and idempotent

Each ingestion run should be safe to repeat. Each brief should record the candidate snapshot, scoring version, and evidence used so a ranking can be reconstructed later.

## First backlog

### Now

- [x] Connect to the reusable Spotify artist endpoint in `Playlist Sync`
- [x] Add selected-playlist configuration and taste-seed generation
- [ ] Add a source snapshot importer for LA electronic events
- [x] Generate Brief 001 from Spotify-to-lineup matches
- [x] Add paged geographic and performer-directed SeatGeek retrieval
- [x] Add constrained Last.fm similar-artist and dominant-tag expansion
- [x] Render the ranked 180-day projection on a Sites surface (with access controlled by the existing Sites policy)
- [ ] Fill in the constraints and negatives in `config/preferences.yaml`
- [ ] Choose the home location and travel-time assumptions
- [ ] Add five past “worth it” and five past “not worth it” events
- [ ] Review Brief 001 and label obvious misses

### Next

- [ ] Define the canonical candidate schema
- [ ] Create the SQLite migrations
- [ ] Build manual URL/CSV import
- [ ] Implement deduplication
- [ ] Implement rule-based scoring and reason generation
- [ ] Generate Brief 001 from stored data

### Later

- [ ] Add source adapters one by one
- [ ] Add feedback capture and reminders
- [ ] Add price/availability observations
- [ ] Schedule brief generation
- [ ] Train and evaluate the first personal model

## Decisions to make after Brief 001

The first brief should answer these through use rather than speculation:

- Is the unit of recommendation an event, a specific performance/showtime, or both?
- Should travel friction use distance or estimated door-to-door time?
- Is price a hard threshold, a value curve, or context-dependent?
- How much novelty belongs in the top five?
- Which reasons feel insightful versus creepy or tautological?
- Where should the brief and feedback prompt live day to day?
