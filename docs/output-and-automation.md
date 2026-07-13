# Output and automation

## Product decision

The product is one synthesized weekly brief. Sites is the durable, interactive presentation layer for that brief—not a separate analytics dashboard.

Keep three representations of the same result:

1. **Canonical JSON** for the pipeline and site publishing.
2. **Markdown snapshot** for auditability, portability, and version history.
3. **Sites view** for daily use, saving, ticket links, and feedback. Its access policy is managed separately from the build and is preserved by automation.

The site should never require reading a report and then consulting a dashboard to decide what to do.

## The weekly brief

The first mobile viewport should answer the decision immediately:

- **Verdict:** go out, maybe, or don't waste your time this weekend.
- **Top five:** ordered across music, film, and other event types.
- **Why you:** one or two pieces of specific evidence.
- **Hassle:** door-to-door time, schedule, price, venue friction, and uncertainty.
- **Ticket urgency:** buy now, watch, safe to wait, or likely unavailable.
- **Confidence:** confirmed, likely, or exploratory.
- **Wildcard:** at most one, with a legible bridge from known taste.

Below that:

- a compact watchlist for later dates or pending ticket drops
- “why not” examples behind an expandable section
- last refreshed time and source links
- the archive of prior weekly briefs

## Sites shape

Build a mobile-first site with three routes:

- `/` — current synthesized brief
- `/event/:id` — recommendation evidence, logistics, source links, and feedback
- `/archive` — prior briefs and outcomes

Use ChatGPT sign-in and an explicit server-side allowlist because this contains personal taste and behavioral feedback. Use D1 for durable structured state:

- published briefs
- recommendation snapshots
- saved/dismissed/attended state
- worth-it reviews and reason codes
- sync checkpoints

R2 is unnecessary for the first version. Browser storage may remember visual preferences, but it must not be the source of truth for feedback.

## Local-to-site sync

The local project remains responsible for credentials, ingestion, matching, and ranking. The site is responsible for presentation and feedback.

At publication time:

1. the local pipeline generates canonical JSON and Markdown
2. a protected sync endpoint receives the display-safe brief snapshot
3. Sites writes the brief to D1
4. the site displays it to the signed-in user
5. feedback is stored in D1
6. the next local scheduled run pulls new feedback through a protected export endpoint before ranking

Use a separate sync secret for machine-to-site calls. Browser writes require the signed-in user and server-side authorization. Do not place Spotify or ticket-source credentials in the browser.

## Scheduled native web discovery

Use a local desktop scheduled task, not a web-only ChatGPT task. Local scheduled tasks can read this project and the latest Spotify-derived artist snapshot; web-only tasks cannot access a folder on the computer. The refresh preflights Playlist Sync: if `user-top-read` is missing, emit one reconnect warning and continue immediately with playlist-only evidence; never wait for interactive authorization.

Recommended cadence:

- **Monday 7:30 AM PT:** broad announcement scan for the next 180 days
- **Thursday 7:30 AM PT:** late additions plus final-weekend confirmation

Search strategy:

- scan the top 30 artists on every run
- rotate through the next 90 artists in groups of 30
- always include manually pinned artists regardless of Spotify weight
- search Los Angeles first, then configurable Southern California exceptions
- prefer artist, venue, promoter, and primary ticket pages
- require supporting URLs and record discovery time
- mark ambiguous dates, artist-name collisions, or weak sources for review

Movie discovery uses the refined TMDB shortlist plus `config/movies.json`. Search only the configured priority theaters and official premium-format sources for IMAX, IMAX 70mm, 70mm, Dolby Cinema, rereleases, restored classics, repertory screenings, retrospectives, and short engagements. TMDB release metadata creates candidates; it never confirms a local format or theater.

Structured sources fail independently. A missing Ticketmaster or TMDB key marks that source `not configured`; runtime failures mark it `unavailable` or `partial`. The valid remaining sources still render and publish with source health visible.

The repeatable local build command is `npm run build:site`. It refreshes Spotify/Last.fm, exports independent sources, runs local Ollama, builds the Sites bundle, and prints one timing line per phase plus the total so a slow local inference pass is legible without noisy per-request logs.

## Date-aware rendering and deployment access

The published projection is intentionally static data plus a client-side date boundary. The site uses the current Los Angeles calendar date—not the projection's original `generatedAt`—to hide past music events, sports games, movie releases, Overview items, and Plan Ahead items. The boundary updates while the page remains open, so events age out without a source rebuild. Unknown dates remain visible because they cannot be proven to be past. New events, changed rankings, ticket observations, and editorial copy still require the normal local refresh.

Site automation must preserve the site's existing access policy. It must not switch share visibility to “just me,” publish to all, or switch back as a deployment workaround. Before deployment, inspect the current policy and use the owner-only deployment path only when the current caller is verified as the sole allowed viewer. If the existing policy is shared or public and the automation is explicitly authorized to publish under that policy, use the normal deployment path. If access cannot be verified, stop and report the policy issue; never mutate access settings automatically.

Do not make an LLM or Codex an implicit dependency of ingestion or ranking. The optional local Ollama stage runs after deterministic ranking and uses structured output. The editorial pass emphasizes the next 7–14 days and receives aggregate counts plus a small source-allowlisted named shortlist. Spotify-derived playlist membership, artist payloads, ranks, affinities, seed strengths, labels, and explanation text are excluded by a provenance-aware allowlist serializer; independently sourced non-Spotify artist names remain eligible. SeatGeek-only music candidates remain unnamed; a merged SeatGeek + Ticketmaster occurrence may use only Ticketmaster-normalized title/date/venue context. Separate per-event passes use opaque references and sanitized personal-taste or MLB-derived features. No pass receives prices, URLs, source IDs, raw SeatGeek payloads, or third-party payload fields. Every pass validates output, rejects unsupported scarcity/sellout/availability claims, validates mention references, preserves provenance, falls back independently, and cannot mutate canonical candidates.

The sports vertical uses MLB Stats API as the canonical Dodgers schedule and standings source. SeatGeek and Ticketmaster are optional ticket observations joined by teams, local date, and venue; missing ticket coverage leaves the game visible with unknown urgency. Sports source failures are independent and visible in source health.

Framework and Insomniac are followed promoter calendars. Framework also supplies a low-frequency public artist roster; exact roster names expand deterministic SeatGeek performer and Ticketmaster attraction lookups and contribute promoter evidence without overriding direct taste signals. All of these sources are deduplicated into the same candidate contract, may be absent when unavailable or protected by an access challenge, and remain visible in grouped source health and the separate provider filter. Overview candidates are explicitly queued for the local Ollama advisory pass ahead of the general per-event cap; deterministic ranking remains authoritative.

The native search is a discovery adapter, not the ranker. It creates candidates; the deterministic pipeline deduplicates and scores them later.

Do not supply SeatGeek API payloads to the native search or another model. SeatGeek remains a separate deterministic connector under its API terms. Do not scrape Vivid Seats, TickPick, or EDMTrain. When `EDMTRAIN_CLIENT_KEY` is configured, the documented EDMTrain API may enrich an existing Music occurrence only under the adapter's explicit confident-match rules. Unmatched results are audit-only, source failure is non-blocking, and raw EDMTrain fields never enter Ollama.

## Guarded local refresh lifecycle

`npm run taste:refresh` operates in a private isolated workspace under `data/taste/workflow/`. It preflights Playlist Sync, runs the existing source/model/build path in isolation when available, or reuses the last accepted projection when it is unavailable. Optional source degradation and model fallback are warnings. The command validates and seals the preview but never changes accepted output or publishes remotely.

When `config/feedback.json` enables capture, refresh runs the private shadow simulation after projection generation. The resulting report remains inside the preview's private `data/` tree and cannot enter Sites output. Published feedback application remains a hard validation failure.

`npm run taste:validate` checks schema compatibility, unique published IDs, candidate-collapse thresholds, Overview structure, source health, required bundle entry points, merge markers, feedback application state, private-artifact exclusion, and the material projection diff. Defaults are 50 additions, 25 removals, and 35 percent per-vertical count change; these are intentionally non-permissive and may be overridden only in reviewed code or explicit command configuration. A previously non-empty projection becoming empty is always a hard failure.

`npm run taste:preview` serves only the sealed local preview and refuses a preview whose content hash changed after validation. It does not modify accepted output.

`npm run taste:promote -- --confirm PROMOTE` performs a local accepted-artifact swap only. It rechecks the complete preview content hash, preserves the previous projection and bundle under `data/taste/workflow/rollback/latest`, and recovers the old complete artifacts if a swap is interrupted. `npm run taste:rollback -- --confirm ROLLBACK` restores that preserved pair. Neither command publishes to Sites or changes sharing policy.

Scheduled automation may run refresh and validation and prepare a preview. It must not call promotion. Browser QA is opt-in (`npm run taste:refresh -- --browser`) and disabled in ordinary CI; the full and empty fixture suites must run sequentially because each builds the same `site/dist` directory. Screenshot baselines change only after an explained, manually inspected production delta.

## Noise control

The scheduled task should report only:

- genuinely new events
- meaningful date, venue, lineup, cancellation, or ticket-status changes
- uncertainty that needs a quick human decision

If nothing meaningful changed, record a successful no-change run without producing a notification-heavy pseudo-brief.

## Build order

1. Define canonical brief JSON.
2. Generate Brief 001 locally in Markdown.
3. Test the web-discovery prompt manually against a small artist set.
4. Build and validate the Sites view locally, create a preview deployment, run acceptance checks, then promote the accepted version through the existing Sites access policy.
5. Add D1 feedback and protected sync.
6. Schedule the tested local discovery and publication workflow.
7. Review the first four runs before reducing human review.
