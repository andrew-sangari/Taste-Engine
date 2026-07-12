# Local feedback loop plan

## Current architecture and execution path

The root project is a Node.js ESM pipeline. The current path is:

`config/brief.json` + private taste snapshots -> source adapters -> normalized concert candidates -> cross-source deduplication -> `src/ranking.js` -> `scripts/export-site-data.js` -> display-safe `site/app/data/upcoming.json` -> the static Next/vinext Sites surface.

Music projection IDs are the existing source-prefixed candidate IDs (`seatgeek:<id>`, `ticketmaster:<id>`, `framework:<id>`, or `insomniac:<id>` after deduplication). Sports IDs are MLB game IDs (`mlb:<gamePk>`). The projection already exposes the canonical event ID, local date, title or teams, venue, matched Spotify IDs where available, event shape, series ID for sports, and deterministic ranking utility.

Music utility is `direct affinity (0..60) + pinned bonus (0..15) - hassle (0..20)`, so its usual range is approximately `-20..75`. Sports utility is interest (`35..100`) minus hassle (`0..20`), so its usual range is approximately `15..100`. Feedback will remain a small secondary adjustment and will not alter direct affinity, matching, deduplication, exclusions, urgency, hassle, Overview selection, or Plan Ahead selection in the default path.

There is no existing append-only journal or audit/replay utility. Existing private JSON writes are direct writes. The feedback subsystem will therefore own an atomic JSONL append, validation, graph replay, deterministic materialization, and private report path. The exporter and Ollama stages will not read feedback by default, so an absent journal produces the existing public projection byte-for-byte.

## Exact files expected to change

- `docs/feedback-plan.md` — this design, policy, commands, risks, and activation boundary.
- `config/feedback.json` — non-secret policy configuration with an explicit `enabled` and `applyToPublishedRanking` gate; the latter defaults to `false`.
- `src/feedback.js` — record schema validation, atomic journal I/O, replacement/revocation replay, deterministic derived state, shadow signal evaluation, projection snapshots, and report construction.
- `src/cli/taste-feedback.js` — local `add`, `list`, `revoke`, `replace`, `validate`, `rebuild`, and `simulate` commands with noninteractive arguments and confirmation gates.
- `package.json` — repository-consistent feedback command aliases.
- `test/feedback.test.js` — unit and adversarial coverage using temporary local files and synthetic projection fixtures only.
- `README.md` — concise local workflow and privacy/activation notes.

The implementation will not modify `src/ranking.js`, `src/overview.js`, `scripts/export-site-data.js`, `site/app/data/upcoming.json`, or any site component. `data/taste/feedback.jsonl`, `data/taste/feedback-state.json`, and `data/taste/feedback-report.json` are runtime-private outputs and will be created only by the local commands.

## Existing utilities to reuse

- Existing ESM/Node 20 CLI conventions in `src/cli/spotify-seed.js` and `src/cli/weekend-brief.js`.
- Existing JSON configuration error style in `src/briefConfig.js`.
- Existing `normalizeArtistName` helper for stable entity keys, without changing artist matching.
- Existing projection shape and `buildOverviewBuckets` for simulation-only Overview comparison.
- Existing `localEnhancement` and source provenance boundaries by treating the projection as the only simulation input; no feedback data will reach Ollama.
- Node `fs/promises`, `rename`, and a same-directory temporary file for atomic local writes.

## Journal and identity decisions

The authoritative store is `data/taste/feedback.jsonl`, one validated `TasteFeedbackRecord` per line. A record keeps the requested fields and adds no provider payload. `feedbackId` is caller-supplied for deterministic/noninteractive use; the CLI can generate a local ID only when the user omits one. The canonical event ID is the existing projection `id`; the system never invents a replacement event ID. The event title, local date, and evidence IDs are immutable snapshots from the projection or explicit historical command arguments.

`record` creates an active outcome. `replace` appends a new outcome that supersedes one active record. `revoke` appends a tombstone that supersedes one active record. Original lines are never edited or removed. Replay treats the journal as an ID graph rather than relying on line order, rejects duplicate IDs, unknown targets, branching supersession, and cycles, and marks invalid chains as non-evidence. Duplicate active feedback for one canonical event is invalid for scoring; a proper replacement chain is the only supported correction path.

The materialized state is always rebuilt from the journal and is never authoritative. It contains redacted active-record summaries, event outcome summaries, entity summaries for artists/venues/promoters-or-series/event shapes, consistency/mixed-evidence status, most recent event date, eligible/ineligible signal decisions, and safe invalid-record reasons. Notes are omitted from state, reports, diagnostics, and console output.

## Numeric shadow policy

The policy is explicit in `config/feedback.json` and is tied to the existing utility scale:

- attended worth-it and attended not-worth-it each contribute `1.0` evidence weight; either skipped status contributes `0.5`.
- ratings are validated as integers from `1..5` and retained privately, but are not scoring evidence in v1. This avoids inventing an unreviewed rating-to-utility conversion.
- artist effects require at least `2` independent event IDs and `2` attended outcomes; venue and promoter/series effects require `3` independent event IDs and `3` attended outcomes; event-shape effects require `4` independent event IDs and `4` attended outcomes.
- a direction must reach at least `75%` of effective evidence and the category-specific margin before it is eligible. Mixed evidence therefore remains neutral unless the documented confidence rule is satisfied.
- proposed category effects are `+/-4` artist, `+/-2` venue, `+/-2` promoter/series, and `+/-1` event shape. The total per-event adjustment is capped at `+/-8`, materially below the direct taste affinity ceiling of `60` and unable to override hard exclusions.
- skipped evidence can corroborate a direction but cannot satisfy an attended-outcome threshold by itself. No recency decay is used until separately reviewed.

These values are deliberately conservative: two consistent attended artist outcomes can move a score by at most four points, while the maximum combined feedback effect is eight points against a direct-affinity component that can reach sixty points. Every proposed adjustment reports its category, thresholds, supporting feedback IDs, direction, raw effect, cap status, and final effect.

## Shadow output and activation boundary

`taste:feedback:simulate` reads the current local projection and the journal, never fetches a provider, and writes only the private report. For each existing candidate it reports the event ID, baseline score, proposed adjustment, proposed final score, category/evidence, supporting active feedback IDs, threshold result, cap status, rank delta, and potential current/Plan Ahead Overview membership change. It cannot add candidates.

The default configuration is:

```json
{
  "feedback": {
    "enabled": true,
    "applyToPublishedRanking": false
  }
}
```

`enabled` permits local capture and simulation. `applyToPublishedRanking` is an explicit future activation gate and remains `false`. This branch does not wire self-modifying feedback into the exporter; setting a file value must never silently alter the published ranking. Any future activation would require a separate reviewed change, a public explanation field that contains no private notes, migration/golden-output review, and tests proving hard exclusions and all source/model firewalls remain intact.

## Assumptions requiring verification

- Existing source-prefixed IDs remain the canonical identity for their provider occurrence. A provider ID change is treated as a new event, not silently merged with an old feedback record.
- A title change with the same canonical ID is reported as a snapshot mismatch but does not change identity; the stored snapshot remains unchanged.
- `venue.sourceId`, explicit `canonicalVenueId`, and `series.id` are canonical IDs only when present. Names alone do not create venue or promoter/series evidence.
- Linked Spotify artist IDs are the only artist IDs currently available in the display-safe projection. Missing IDs produce no artist-generalized signal, but may still permit a valid venue/shape signal.
- Movies can be captured as events for audit, but the v1 shadow evaluator only applies categories supported by their snapshot evidence; it never creates a new movie discovery or format claim.

## Risks and likely regressions

- stale or changed provider IDs could make a historical event unresolvable; the journal remains intact and the report marks the candidate as unmatched rather than guessing.
- duplicate submissions or malformed replacement graphs could create false confidence; replay will fail closed for the affected event/chain.
- mixed outcomes could overgeneralize; minimum independent-event, attended-count, dominance, and margin gates prevent small or contradictory samples from scoring.
- venue renames and ambiguous provider venue IDs could cause false venue effects; name-only fallback is forbidden.
- private notes may contain prompt-like instructions or secrets; notes are never emitted by list/report/state/projection and no model path reads the journal.
- interrupted writes could truncate a JSONL record; atomic temp-file rename preserves the last valid journal, while validation reports and isolates any manually corrupted line.
- changing the active configuration without review could activate behavior; the exporter does not consume the gate in this branch, and the config explicitly states the disabled application boundary.

## Test strategy

`test/feedback.test.js` will use synthetic records and temporary directories. It will cover schema/range validation, missing/empty journals, malformed JSONL, duplicate IDs, duplicate active event feedback, unknown revocations, linear replacements, circular/branching chains, random journal order, changed titles, missing evidence IDs, extreme ratings, prompt-like/secret notes, atomic write behavior, read-only/error paths, deterministic rebuild bytes, disabled application, thresholds not met, hard exclusions, and maximum-cap enforcement.

The tests will also assert that notes are absent from derived state/reports, no candidate is added, no Ollama request is made, a missing journal yields no proposed changes, default `applyToPublishedRanking=false` leaves a candidate snapshot unchanged, and existing Overview/Plan Ahead membership is only compared in the private simulation. Existing root tests remain unchanged. The site build will run from the existing projection after implementation; no external credentials or live APIs are used.

## Implementation sequence

1. Add this documented policy and the explicit disabled-by-default configuration.
2. Implement pure validation, graph replay, deterministic entity summaries, and atomic journal/state/report writes.
3. Implement projection snapshot extraction and the conservative shadow evaluator, including rank and Overview diffs.
4. Add CLI command aliases, explicit argument parsing, event display, confirmation for replace/revoke, and redacted diagnostics/recovery instructions.
5. Add adversarial tests, run the root suite, compare the public projection before/after, and run the complete local site build.
6. Update the README with capture, validation, rebuild, simulation, and future activation guidance.

## Explicit non-goals

- no hosted backend, login, cloud database, remote write API, browser form, or scheduled network job;
- no Ollama/model call, note interpretation, provider retrieval, discovery lane, candidate creation, identity-resolution change, or public feedback field;
- no automatic ranking activation, public promotion, Sites deployment, or access-policy change;
- no social/friend rating system, generalized blacklist, hidden learning, destructive journal rewrite, or silent golden-output update;
- no redesign of the site or changes to ranking, matching, deduplication, Overview, Plan Ahead, source authority, or provider firewalls.

## Stop conditions

Stop and report instead of editing further if the canonical projection ID cannot be identified, if safe private storage cannot be separated from the Sites export, if atomic journal replacement cannot be guaranteed, if an implementation would require raw provider payloads or Ollama input, if a test needs live credentials, or if the default path changes the public projection. Do not automatically publish or promote any build.
