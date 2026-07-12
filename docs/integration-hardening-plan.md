# Integration hardening plan

## Current architecture and execution path

Taste Engine is a Node.js ESM pipeline at the workspace root. Live refresh currently runs through `scripts/build-site.js`: Spotify seed via Playlist Sync, Last.fm expansion, independent structured-source export in `scripts/export-site-data.js`, optional local Ollama enhancement inside the export path, then the nested Next/vinext build in `site/`. The accepted display projection is `site/app/data/upcoming.json`; `site/dist/` is the built bundle. No root `.git` repository is present in this checkout. The nested `site/.git` repository has Agent A, B, and C branch refs, but all refs point to the same pre-feature commit and the browser-QA work is present as uncommitted files. Root Agent A and C files are likewise present without inspectable branch history. Integration must therefore audit the filesystem implementation and test evidence, not fabricate branch diffs or perform pretend merges.

Agent A currently supplies offline fixture evaluation, projection diffing, private diagnostics, and explain tooling. Agent B supplies synthetic network-independent browser fixtures plus opt-in Playwright tests. Agent C supplies an append-only private feedback journal, deterministic replay, and shadow simulation with published application disabled. The new workflow will wrap existing pipeline commands without changing retrieval, matching, deduplication, ranking, Overview, Plan Ahead, source authority, or public schema.

The intended hardening path is:

`taste:refresh -> isolated preview workspace -> deterministic refresh/build -> private reports and projection diff -> taste:validate -> sealed validation manifest -> taste:preview -> explicit taste:promote -> atomic accepted-artifact swap`

Remote Sites publication remains outside these commands and must continue through the existing access-policy-preserving product surface.

## Exact files expected to change

Initial expected files are:

- `docs/integration-hardening-plan.md` — this required pre-implementation plan and audit record.
- `package.json` — add refresh, validate, preview, promote, and rollback commands.
- `src/refreshWorkflow.js` — pure workflow configuration, manifest hashing, guardrails, validation, promotion, and rollback primitives.
- `src/cli/taste-refresh.js` — isolated refresh orchestration and preview creation.
- `src/cli/taste-validate.js` — explicit validation entry point.
- `src/cli/taste-preview.js` — local validated-preview server entry point.
- `src/cli/taste-promote.js` — confirmation-gated local promotion and rollback entry point.
- `test/refreshWorkflow.test.js` — offline adversarial tests for guardrails, stale previews, atomic promotion, interruption, and rollback.
- `README.md` — daily operator commands and private/public boundary.
- `docs/output-and-automation.md` — authoritative refresh, preview, promotion, rollback, optional-source, and scheduling contract.
- `docs/evaluation-and-diagnostics.md` — integrated validation and private report usage.
- `docs/feedback-plan.md` — clarify the disabled published-application boundary in the integrated workflow if audit finds ambiguity.
- `AGENTS.md` — require future agents and automation to use the guarded workflow without enabling implicit promotion.
- `.gitignore` — ignore private preview, validation, promotion, and rollback runtime artifacts if new paths are introduced.

Existing Agent A-C files may receive minimal fixes only when an adversarial test demonstrates an invariant violation. `site/app/data/upcoming.json`, screenshot baselines, golden fixture outputs, production components, and production CSS are not expected to change.

## Existing utilities to reuse

- `src/diagnostics.js` for stable JSON, hashes, recursive redaction, normalized projection comparison, and private build reports.
- `src/projectionDiff.js` for material projection diffs and configurable change thresholds.
- `src/evaluation.js` and `scripts/evaluate-fixtures.js` for frozen offline deterministic evaluation.
- `src/feedback.js` for private atomic writes and feedback shadow reports; feedback remains disconnected from published ranking.
- `scripts/build-site.js` and `scripts/export-site-data.js` as the existing refresh/build execution path, invoked only inside an isolated preview workspace.
- `site/tests/run-browser-qa.mjs` and its synthetic fixtures for opt-in local browser smoke validation.
- Node `fs/promises` same-filesystem rename operations for atomic artifact replacement.
- Existing package-script and ESM CLI conventions; no new runtime dependency is planned.

## Assumptions requiring verification

- `site/app/data/upcoming.json` and `site/dist/` are the complete accepted local artifacts that promotion must replace or preserve.
- The export/build scripts can be redirected to an isolated workspace with a small environment/path seam; if not, a minimal seam is required before refresh can be safe.
- Structural validation can use the current public projection schema without introducing a new schema package.
- Browser QA can target the isolated preview bundle without copying private root artifacts into `site/`.
- Missing optional credentials already fail soft in exporters; required configuration can be identified without printing values.
- The existing public projection is a valid accepted baseline despite the absent root Git history.
- Atomic directory rename is supported when preview, accepted, and rollback artifacts live on the same filesystem.
- The nested Sites repository does not provide an approved terminal publication command; promotion is local accepted-artifact replacement only.

## Risks and likely regressions

- Existing live build scripts write directly to the accepted projection; invoking them unisolated could violate the core safety requirement.
- Copying the workspace for isolation could accidentally include `.env`, `data/`, diagnostics, feedback, or provider caches in a public bundle; copy allowlists and post-build exclusion checks must fail closed.
- Hashing only the projection while omitting the bundle could permit a stale or altered preview to promote; the manifest must cover every promoted file.
- Cross-platform rename behavior and interrupted swaps could leave staging directories; recovery must preserve either the old or new complete accepted artifact.
- Browser screenshots may vary by browser rasterization; structural/geometry smoke failures are hard failures, while baseline changes are never automatic.
- Current Agent A-C work lacks trustworthy branch provenance, so intended-versus-actual branch attribution will remain partly inferential and explicitly documented.
- A full live `build:site` may depend on Playlist Sync, credentials, provider state, and long Ollama timeouts. Baseline capture must preserve accepted bytes and report unavailable prerequisites without weakening tests.

## Test strategy

First capture hashes, Overview/Plan Ahead IDs, package scripts, build timing, root tests, site render tests, and the existing build result while preserving/restoring accepted artifacts. Audit Agent A-C independently against their plans and source/tests. Then add failing tests before every behavior-changing workflow fix.

Offline tests will cover missing required configuration, optional-source warnings, malformed projections, candidate collapse, duplicate IDs/spikes, empty Overview contradictions, source-health inconsistency, forbidden prompt fields, private artifact leakage, missing routes/assets, merge markers, unavailable/malformed Ollama fallback metadata, feedback activation, uncreatable diffs, stale validation, post-validation mutation, browser failure propagation, interrupted build/promotion, atomic rollback, and deterministic manifests. Tests use temporary directories, synthetic fixtures, fixed clocks, and injected command runners; none use credentials or network APIs.

Acceptance runs include root tests, site render/date tests, deterministic evaluation twice with matching normalized hashes, browser QA at its declared viewports when the local browser is available, feedback-disabled equivalence, refresh/validate preview creation without publication, stale/invalid promotion refusal, tested rollback, and the complete site build. Intentional golden, screenshot, or public projection deltas require an explicit explanation and are otherwise rejected.

## Implementation sequence

1. Capture the non-clean baseline and record the missing-root-Git limitation.
2. Audit Agent A, then Agent B, then Agent C from actual files, plans, tests, dependencies, and behavior; reject or minimally fix unsafe behavior before proceeding.
3. Run the existing suites and deterministic evaluation gates after each audited feature area in the required A-B-C order.
4. Add failing offline workflow tests for isolation, validation manifests, stale-preview detection, atomic promotion, interruption, and rollback.
5. Implement the smallest shared workflow module and CLI wrappers, reusing diagnostics, diff, feedback, and browser utilities.
6. Run adversarial tests and complete acceptance checks; inspect public projection bytes and private artifact exclusion.
7. Update authoritative documentation and `AGENTS.md` only after behavior is green.
8. Perform a final manual preview review locally; do not publish or promote remotely.

## Explicit non-goals

- No new source, including Edmtrain or 19hz, and no broader discovery universe.
- No ranking, matching, deduplication, Overview, Plan Ahead, urgency, hassle, or authority change.
- No public schema or projection change except separately approved optional fields; none are planned.
- No site redesign, copy rewrite, screenshot-baseline refresh, or broad refactor.
- No feedback application to published scoring and no feedback or diagnostics in Sites output or prompts.
- No weakening of Spotify, SeatGeek, provenance, or Ollama firewalls.
- No live API in tests, secret diagnostics, automatic promotion, remote publication, or access-policy mutation.
- No repository-wide abstraction cleanup; duplication is consolidated only where required for workflow safety.

## Stop conditions

Stop and report before proceeding if accepted output cannot be isolated from refresh writes, private artifacts cannot be proven absent from the public bundle, a required guardrail would need raw restricted payload inspection, tests require live credentials, promotion cannot be made atomic on the configured filesystem, public projection equivalence cannot be established, feedback is found active in the publish path, branch provenance is required for a decision that filesystem evidence cannot support, or completing the task would require remote publication or an access-policy change.
