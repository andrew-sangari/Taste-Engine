# Integration hardening report

## Repository and baseline

The workspace root has no `.git` metadata. The nested `site/.git` repository contains the three feature branch names, but all refs point to commit `50bee3e`; browser-QA files and shared site changes are uncommitted. Root evaluation and feedback files have no inspectable branch history. Reviews therefore use actual files, plans, tests, and runtime behavior. No merge commit was fabricated.

Baseline accepted projection SHA-256: `6bcc045e2366f949a05e2ca27fa46eaa1e0f80906c4ac2c5eb4a0436f2453376`.

- Candidates: 117 music, 32 sports, 20 movies.
- Overview: `mlb:823925`, `seatgeek:18107535`, `seatgeek:18310930`, `framework:5988`, `seatgeek:18318710`.
- Plan Ahead: `seatgeek:18301906`, `seatgeek:18030671`, `seatgeek:18205866`.
- Root tests before integration: 95 passed in 0.84 seconds.
- Site render/date tests before integration: 4 passed; vinext build phases totaled about 0.6 seconds.
- Full `npm run build:site`: stopped after 0.28 seconds because Playlist Sync was unavailable; accepted projection bytes remained unchanged.

## Agent A — evaluation and diagnostics

- Scope/files: offline fixture evaluation, projection diff, private build report, recursive redaction, candidate explain tooling, fixtures, tests, and documentation.
- Behavior/schema: private and offline-only additions; no public schema change.
- Dependencies: none.
- Tests: frozen-clock deterministic pipeline, model fallbacks, mutation detection, recursive redaction, and structural diffing.
- Invariants: no live API test, restricted prompt payload, public diagnostic copy, ranking activation, or unexplained golden update found.
- Decision: safe as present.

## Agent B — browser QA

- Scope/files: Playwright config/runner, full and empty specs, synthetic fixtures, stable-region screenshots, package dependency/scripts, fixture selector, and documented small CSS/page fixes.
- Behavior/schema: test fixture selection only; no source or public schema change and no redesign.
- Dependency: `@playwright/test` as a site dev dependency.
- Tests: network-independent fixed-clock accessibility, geometry, keyboard, hash, reduced-motion, text-scale, and stable-region screenshot checks.
- Invariants: no full-page screenshot suite, source expansion, copy rewrite, or baseline auto-update found.
- Decision: safe as present. Full and empty suites must run sequentially because both build `site/dist`.

## Agent C — feedback loop

- Scope/files: append-only private journal, replacement/revocation replay, materialized state, shadow simulation, CLI, config, tests, and documentation.
- Behavior/schema: private `data/` artifacts only; published application defaults false and the exporter does not consume feedback.
- Dependencies: none.
- Tests: malformed journals, graph replay, deterministic bytes, atomic writes, thresholds/caps, redacted CLI, hard exclusions, and disabled application.
- Invariants: notes remain out of state, reports, output, and prompts; malformed feedback fails closed.
- Decision: safe as present. Feedback scoring is not ready for activation without a separate review.

## Order, conflicts, and modifications

The audit followed A, B, C, then workflow hardening. Git merges were impossible because branch refs contain no feature commits. Shared infrastructure was reused: diagnostic hashing/redaction, projection diffing, feedback atomic-write conventions, and the existing browser runner.

One execution conflict was found: parallel browser suites race on `site/dist`. Acceptance uses sequential commands. No screenshot baseline changed. Hardening added private isolated preview workspaces, validation manifests, local confirmation-gated promotion, and rollback without changing ranking or site components.

## Final verification

- Root tests after integration: 98 passed in 0.81 seconds.
- Deterministic evaluation: two identical runs, normalized SHA-256 `fc12b24af3b6aa184f24ec67307cd43145f4bc23de7a27ed066d03234667d371`.
- Browser QA: 13 full-fixture tests passed at five viewports; 3 empty-state tests passed at three viewports.
- Cached refresh: produced a validated private preview without changing accepted output.
- Public projection diff: zero additions, removals, rank, score, advisory, content, source, or visual changes; schema 5 remained compatible.
- Accepted projection hash: unchanged.
- Promotion without confirmation: refused.
- Feedback application: disabled.
- Private diagnostics: workflow reports contain only mode, validation state, preview hash, warning codes, and browser-smoke state. Public validation rejects private diagnostic and feedback filenames.

## Remaining risks

- Root branch provenance cannot be reconstructed without root Git history or branch patches.
- Browser QA needs localhost permission and compatible screenshot rendering.
- Remote Sites publication remains a separate manual operation under the existing access policy.
- Feedback remains sparse and shadow-only; activation requires a separate review.

No Edmtrain or other new source work was introduced.

## Live integration follow-up

After Playlist Sync became available, the guarded live refresh completed in 142.6 seconds entirely inside the private preview workspace: Spotify/Last.fm took 30.7 seconds, ticket sources 23.4 seconds, MLB/TMDB 1.6 seconds, normalization 0.6 seconds, Ollama 83.5 seconds, and the site build 2.5 seconds. It exported 95 concerts, 32 sports games, and 20 movies from 2,050 normalized concert occurrences.

The accepted projection remained unchanged. The live preview diff removed 22 music candidates, moved 61 surviving music rows as a consequence, changed eight scores, three explanations, two retained provider-link sets, and three source-health summaries. It added no candidates, changed no public fields, and preserved the exact Overview and Plan Ahead membership/order. The change stayed within the configured thresholds. Ticketmaster remained partial with 30 warnings, Insomniac was unavailable with one warning, and Spotify Top Artists was partial because one affinity window used cache.

Manual browser review found the Overview, shortlist, Plan Ahead, source-health sections, and vertical navigation rendered correctly with no console warnings or errors. The private feedback shadow report covered 147 candidates and produced zero ranking differences, zero Overview changes, and zero eligible signals. A missing refresh hook for that configured shadow report was fixed with a failing-before policy test; the root suite now passes 99 tests. The live preview was resealed after the report was generated. No promotion or publication occurred.
