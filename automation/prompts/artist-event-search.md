# Scheduled Taste Engine refresh and discovery

Work in `/Users/and14626/Documents/Taste Engine`. Follow `AGENTS.md` and never print private configuration or source snapshots.

## Deterministic refresh

1. Preflight Playlist Sync at `/api/status`. If `spotifyAuth.missingScopes` includes `user-top-read`, emit one actionable warning (“Reconnect Spotify in Playlist Sync to enable Top Artists”) and continue immediately; do not wait for interactive reauthorization. If Playlist Sync is already reachable at its configured local URL and the scope is present, run `npm run taste:seed` so the three Top Artists windows can refresh. If it is unavailable, reuse the existing `data/taste/artists.json`; do not fail the run solely because Playlist Sync is stopped. A missing Top Artists lane must fall back to playlist-only evidence without changing candidate retrieval or publication.
2. Run `npm run site:refresh`. Last.fm, SeatGeek, Ticketmaster, TMDB, Framework, Insomniac, MLB, sports ticket joins, and the optional local Ollama editorial/advisory passes are independent. Missing keys, stopped local services, access challenges, or source failures should be reflected in source health and must not block valid data from the other sources. The editorial stage may add only validated brief copy and mention references from its source-allowlisted input; it cannot mutate candidates or rankings.
   - Allow substantial time for local inference. `gemma4:26b-mlx` may remain quiet while completing separate personal-fit, recommendation, urgency, hassle, and editorial passes.
   - Do not classify quiet terminal output as a hang and do not interrupt an Ollama pass before `OLLAMA_TIMEOUT_MS` has elapsed. Budget at least 20 minutes for the complete scheduled task.
   - A timed-out or invalid individual pass falls back deterministically; continue validation and publication with the remaining successful passes.
3. Run `npm test`, then run the site test in `site/`.
4. If validation passes, build a local/preview package, run the acceptance checks, inspect the current Sites access policy, and promote only the accepted version using that existing policy. Use the owner-only deployment path when the current caller is verified as the sole allowed viewer. If the existing site is shared/public and this automation is authorized to publish under that policy, use the normal deployment path. Never change share visibility, switch to “just me,” switch back to public, or use an access-policy mutation as a deployment workaround. If the policy cannot be verified, stop with one actionable warning. Never publish an empty/corrupted projection caused by an internal processing error.

## Native web discovery

Read the current Spotify-derived artist snapshot from `data/taste/artists.json` and the discovery state from `data/discovery/state.json`. If either is missing, stop with a concise actionable error and do not invent an artist list.

Search the web for newly announced or materially changed live events involving the specified artists:

- primary geography: Los Angeles, California
- extended geography: Southern California only when the artist is pinned or has high seed strength
- horizon: today through 180 days from today
- top 30 artists: search on every run
- next 90 artists: search the next rotating group of 30, then update the rotation checkpoint
- pinned artists: always search

Prefer evidence in this order:

1. official artist or tour page
2. official venue or promoter page
3. primary ticketing page
4. reputable event listing or announcement with a direct source link

Do not ingest or summarize SeatGeek API payloads; the deterministic SeatGeek connector handles that source separately. Do not scrape Vivid Seats, TickPick, Edmtrain, Resident Advisor, or DICE. A normal public page discovered through web search may be cited as an outbound source only when access and use are permitted.

For each candidate, record:

- artist names exactly as billed
- normalized artist match and match confidence
- event title
- local date/time and timezone
- venue and city
- announcement or on-sale date when available
- source URLs
- discovery timestamp
- status: confirmed, likely, ambiguous, changed, or canceled
- a one-line explanation of what is new

Write candidates to a dated JSON file under `data/discovery/queue/` and a concise Markdown run report under `briefs/discovery/`. Do not modify the canonical event database. Deduplicate within the run by artist, venue, and local date. Preserve conflicting facts for review instead of choosing silently.

Report only new events, meaningful changes, and ambiguous cases needing review. If nothing meaningful changed, update the successful-run timestamp and emit a no-change result.

## Premium-format movie discovery

Read the refined TMDB candidates from `site/app/data/upcoming.json` and the editable theater list from `config/movies.json`. For each current movie candidate, search public permitted sources for confirmed premium-format engagements at the configured priority theaters, prioritizing:

1. official theater or exhibitor listing
2. official studio or film page
3. official IMAX, Dolby, or venue announcement
4. reputable listing with a direct supporting URL

Look specifically for IMAX, IMAX 70mm, 70mm, Dolby Cinema, restored/repertory presentations, one-week engagements, rereleases, and director retrospectives. Record theater, format, date/time when confirmed, source URLs, discovery timestamp, confidence, and likely run scarcity. Do not infer a format from TMDB metadata or a generic theatrical date.

Write movie confirmations and ambiguous cases to a dated JSON file under `data/discovery/movies/` and include a concise section in the discovery run report. This is a review queue; do not silently promote a movie to a confirmed premium recommendation without source evidence.
