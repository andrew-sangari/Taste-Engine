# Taste Engine browser QA plan

Intended branch: `codex/taste-browser-qa`

The shared checkout was later moved by another concurrent task; the working
tree currently reports a different branch name. No branch switch was made
during QA so concurrent work would not be disrupted.

Status: planning pass completed before implementation. This document records
the existing execution path, the deterministic browser fixture, the objective
test matrix, and the limits on production changes.

## Current architecture and execution path

- The parent project owns retrieval and projection generation. Its
  `scripts/export-site-data.js` writes the display-safe projection to
  `site/app/data/upcoming.json`. The browser QA fixture will be synthetic and
  will not read `config/`, `data/`, `.env`, or live providers.
- The site build runs from `site/` with `npm run build`, which produces the
  local vinext/Next output consumed by the existing rendered-HTML test.
  `npm run build:site` in the parent project performs live-capable refresh work
  before invoking that site build and is not a browser-test prerequisite.
- `app/page.tsx` renders the masthead, projection hero, `VerticalShell`, and
  server-rendered Engine notes/source health. `VerticalShell` owns the client
  tab state, hash synchronization, current Los Angeles date boundary, and
  rendering of the active vertical.
- `app/overview-explorer.tsx`, `app/event-explorer.tsx`,
  `app/movie-explorer.tsx`, and `app/sports-explorer.tsx` own the four tab
  content models and their filters/disclosures.
- `app/filter-disclosure.tsx` provides the mobile filter disclosure.
  `app/recommendation-visual.tsx` renders declared image, texture, or no-visual
  metadata without choosing imagery in the browser.
- `app/globals.css` owns the responsive breakpoints. The relevant breakpoint
  contracts are `max-width: 820px` for compact layouts and `max-width: 520px`
  for the 2x2 tab grid and separated Overview utility/CTA row.
- Existing tests are `tests/rendered-html.test.mjs` (server-rendered contract)
  and `tests/date-aware.test.mjs` (Los Angeles date-boundary utilities). There
  is currently no browser runner, fixture projection, screenshot baseline, or
  accessibility checker in the site checkout.

## Exact files expected to change

Expected QA-only additions:

- `tests/browser-qa-plan.md` — this plan, matrix, baseline policy, and limits.
- `tests/fixtures/qa-projection.json` — frozen full-state projection with
  synthetic content only.
- `tests/fixtures/qa-empty-plan-ahead.json` — frozen empty-state projection
  for the Plan Ahead/Overview empty-state case.
- `tests/browser-qa.spec.mjs` — opt-in full-fixture browser tests, geometry assertions,
  keyboard/hash checks, and stable region screenshot checks.
- `tests/browser-qa-empty.spec.mjs` — empty-state browser checks.
- `tests/playwright.config.mjs` — local-only Playwright configuration,
  viewport/screenshot settings, and the opt-in local server.
- `tests/run-browser-qa.mjs` — opt-in fixture build and browser-runner
  lifecycle helper.
- `tests/snapshots/` — browser screenshot baselines for documented regions.
- `.gitignore` — ignore generated Playwright `test-results/` diagnostics.

Expected small integration/tooling changes, only if needed by the test runner:

- `app/data/projection.ts` and `app/page.tsx` — select the synthetic fixture
  only under an explicit QA environment value; the default production
  import/path remains unchanged.
- `package.json` and `package-lock.json` — add only the browser test command
  and the smallest test-only browser dependency if the current workspace does
  not already provide one.
- `app/globals.css` — only the smallest fixes demonstrated by browser geometry
  failures.

No ranking, retrieval, deduplication, source-health semantics, Ollama input,
projection export, or visual-selection code is expected to change.

## Existing utilities to reuse

- Reuse `VerticalShell`'s current tab/hash implementation and
  `date-aware.ts` behavior; do not duplicate date or tab logic in production.
- Reuse the existing semantic elements: native `button`, `select`,
  `details/summary`, `role="tablist"`, `role="tab"`, and `role="tabpanel"`.
- Reuse `RecommendationVisual` data attributes for visual-kind and decorative
  accessibility checks.
- Reuse the existing `site/` build/start scripts and the rendered HTML test's
  local built-worker path where possible.
- Use browser DOM geometry and accessibility state as the primary assertions;
  use screenshots only for stable visual regions.

## Assumptions requiring verification

- A local browser executable is available for the opt-in browser run. The
  runner will accept an explicit `BROWSER_PATH` and discover the local Chrome
  fallback used by this workstation; CI will not launch a browser smoke run.
- A local vinext build can be served with no external network access after the
  site dependencies and generated local font assets are present.
- The fixture projection can exercise all required content states without
  including private source payloads or provider credentials.
- Existing component behavior is the baseline. A failing assertion is a
  demonstrated defect only after the selector and geometry check are verified
  against the frozen fixture at the stated viewport.
- Browser screenshots can be made stable by freezing `Date`, disabling motion,
  waiting for local fonts/assets, and masking no content except an explicitly
  documented dynamic value.

## Risks and likely regressions

- The active-tab implementation currently renders only one tabpanel. Tests
  must distinguish the required active-content exposure contract from the
  separate question of whether every `aria-controls` target must remain in the
  DOM; no ARIA structure will be changed without a failing contract test.
- The CSS intentionally clips page-level overflow. Assertions must inspect
  card/control geometry as well as document scroll width so clipping cannot
  hide a defect.
- Long unbroken venue/title tokens may overflow a card even when the document
  itself has no horizontal scrollbar.
- Native summary controls and mobile filter rows can fall below the 44px target
  even when their parent card remains visually aligned.
- The current sticky tab rail and hash scroll behavior may interact at narrow
  widths; checks must verify reachability and scroll position, not only the
  final active state.
- CSS background images do not expose image-load failure like an `<img>` tag.
  The fixture will cover valid local image metadata, a missing local image
  URL, texture, and no-visual rendering without asserting an unsupported load
  event.
- Browser font availability, OS text rasterization, and installed browser
  version can create pixel diffs. Screenshot policy therefore uses stable
  regions and a documented small threshold, with geometry/accessibility checks
  remaining authoritative.

## Deterministic fixture and test matrix

The full fixture will use a fixed `generatedAt` and synthetic display-safe
values. It will contain:

- five Overview cards and three Plan Ahead cards;
- Music cards with short, 100-character, festival-style/punctuation-heavy,
  many-artist, zero-artist, and unusually long-venue cases;
- image, texture, no-visual, and missing-local-image cases;
- Movies with one valid local TMDB-style image and one image-fallback case;
- Sports cards covering high-leverage, rivalry, night-game, default-texture,
  and no-ticket-price states;
- active, partial, unavailable, and not-configured source-health rows;
- absent optional model prose, long `whyYou` copy, duplicate source links, and
  safe example external links with nonempty hrefs;
- mobile utility labels with intentionally different lengths.

The empty-state fixture will retain the same deterministic shell but provide
an empty current Overview and an empty Plan Ahead list, with optional prose
absent and source health still populated.

| Area | Full fixture assertions | Empty/partial assertions |
| --- | --- | --- |
| Overview | five cards, rank order, long copy, image/texture/none, separate CTA row on narrow mobile | intentional empty current call and empty Plan Ahead copy |
| Music | short/long/festival titles, provider links, no-price state, disclosure, texture/image/none | filter produces a valid empty state |
| Movies | confirmed image and fallback, attribution, date controls, external details links | unavailable/not-configured state remains explanatory |
| Sports | high-leverage/rivalry/night/default textures, ticketed and unknown links, series disclosure | rivalry/ticket filters can produce empty state |
| Source Health | active, partial, unavailable disclosure rows and accessible state | warning text remains visible without becoming clickable |
| Optional prose | cards without local enhancement still render core facts/actions | no editorial/model prose does not collapse layout |

Required viewports:

- 1440 x 1000 — desktop
- 1024 x 768 — compact desktop/tablet landscape
- 768 x 1024 — tablet portrait
- 390 x 844 — primary mobile
- 320 x 700 — narrow mobile stress

At least one repeated run will use increased text/zoom or equivalent long-copy
stress. The test will record the chosen mechanism because browser zoom APIs
vary by runner.

## Interaction and geometry assertions

The browser suite will verify all four tabs, one selected tab, the active
tabpanel relationship, roving `tabindex`, ArrowLeft/ArrowRight/Home/End,
native Enter/Space activation, hash restore, reload restore, and back/forward
state. It will also cover Source Health, Music lineup/occurrence and local-take
disclosures, filter disclosures, visible focus, non-nested interactive
elements, external link href/target/rel contracts, and non-clickable empty or
unavailable states.

At every required viewport, the suite will assert:

- no document horizontal overflow and no card/control child escapes its card;
- no clipped interactive control or title/venue/why-you content;
- signal values remain internally unbroken and separators do not lead or trail
  a wrapped line;
- mobile CTA and disclosure hit areas are at least 44 x 44 CSS pixels;
- active tabs remain reachable and sticky-tab scroll padding does not conceal
  the focused target;
- visual layers have `pointer-events: none` and do not intercept clicks;
- decorative visuals are hidden from the accessibility tree;
- informative image visuals have an accessible alternative;
- reduced-motion rendering remains complete.

The <=520px assertion explicitly checks that Overview signals occupy a row
above a separate CTA row, rather than relying on a screenshot impression.

## Screenshot strategy and baseline policy

Screenshots will use the browser runner only, never print-to-PDF. The suite
will capture stable regions for the masthead/hero, tab rail, Overview intro,
featured card, supporting-card grid, Plan Ahead, representative Music/Movie/
Sports cards, Source Health, mobile utility row, and one expanded disclosure.

Before capture, the runner will:

1. use the frozen fixture and fixed browser clock;
2. abort requests whose origin is not the local fixture server;
3. wait for local fonts and same-origin assets;
4. disable animations/transitions and honor reduced motion;
5. avoid masking content except a documented clock/date value if freezing is
   not sufficient.

Baseline verification is the normal `npm run test:browser` command. Baselines
are updated only with the explicit `npm run test:browser -- --grep stable
--update-snapshots` command (and the corresponding `test:browser:empty` command
when an empty-state baseline is added). A baseline update must record the
reason in the test plan or handoff; a diff caused only by a browser/OS
rasterization change is not an automatic approval.

## Fix policy

No production CSS/JS change is allowed until a deterministic browser assertion
fails against the fixture. Each fix must be the smallest reasonable change,
must pass the same assertion afterward, and must not change the visual
direction, content selection, ranking, or source authority. Fixture-only or
test-harness changes do not require a production defect claim.

## Verification results and handoff

Verified on July 12, 2026 with the frozen synthetic projection:

- `npm run test:browser` — 13 full-fixture tests passed across all five
  required viewports; interaction, hash/history, target sizes, geometry,
  accessibility contracts, disclosure open/close behavior, increased-text
  stress, reduced motion, local-only routing, and screenshot baselines passed.
- `npm run test:browser:empty` — 3 empty-state tests passed at 1440, 390, and
  320px.
- `npm test` in `site/` — existing rendered HTML and date-aware tests passed.
- Root `npm test` — 95 tests passed.
- `npm run build` in `site/` — passed from the current projection.
- Root `npm run build:site` was attempted but could not reach the required
  local Playlist Sync service at `127.0.0.1:4317`; no live service or
  credentials were started for QA. This remains an external prerequisite,
  not a browser-test failure.

Objective defects found and fixed:

1. At 1024px and 320px, Sports game rows retained desktop minimum grid tracks;
   game signal content extended outside its card. The smallest fix made the
   tracks flexible and allowed matchup/signal grid items to shrink.
2. At compact widths, Overview utility signals could retain nowrap content
   wider than a narrow card. The smallest fix enables bounded wrapping and
   suppresses decorative separators only where they could otherwise begin a
   wrapped line; the <=520px CTA remains its own row.
3. The first all-tab geometry pass treated descendants of closed `<details>`
   disclosures as visible because their child rects were still nonzero. The
   browser visibility predicate now excludes closed disclosure descendants;
   no production change was needed for this false positive.
4. The adversarial long unbroken Music venue token increased internal card
   scroll width and could be clipped. `eventPlace` now permits anywhere
   wrapping, with no change to content or ranking.
5. At 320px, the existing date-filter strip left its third button partially
   outside the viewport. A narrow-only reduction in button padding and gap
   keeps all date filters reachable without changing the filter behavior.

No ranking, selection, source, provenance, or visual-direction changes were
made. The screenshot baseline set was created intentionally for the requested
masthead/hero, tab rail, Overview intro/featured/supporting cards, Plan Ahead,
Music, Movie, Sports, Source Health, mobile utility, and expanded disclosure
regions. The final browser verification passed without requiring a baseline
update.

Known limitations:

- Browser QA is explicitly opt-in and requires a local Chrome/Chromium
  executable plus permission to bind the local fixture server; it is not part
  of CI or root `npm test`.
- Pixel baselines are workstation/browser-specific within the documented 1%
  diff tolerance; geometry and accessibility assertions are authoritative.
- The complete parent `npm run build:site` still requires the separately
  running Playlist Sync service; browser QA intentionally does not start or
  authenticate that service.
- The empty Plan Ahead fixture is a separate browser command because the site
  projection is selected at build time.
- The current product has no visible lineup list component, so the fixture
  carries zero/many lineup shapes while disclosure coverage targets the
  existing occurrence/local-take/series disclosure surfaces.
- `npm run build:site` could not complete in this environment because the
  required local Playlist Sync service was not running at its configured local
  boundary; no credentials or synthetic source data were used to bypass that
  dependency.

## Implementation sequence

1. Add this plan and the synthetic projection fixtures.
2. Add the smallest explicit QA fixture selector/build lifecycle and verify the
   site still uses `upcoming.json` by default.
3. Add the browser runner with local-only routing, fixed time, required
   viewports, interaction/accessibility/geometry assertions, and no live API
   dependency.
4. Run the suite before production fixes and record objective failures.
5. Fix only demonstrated UI defects, one assertion at a time; rerun the
   focused test and then the full matrix.
6. Generate or verify stable region baselines and document any intentional
   baseline delta.
7. Run existing site tests, root tests, and the complete site build. Inspect
   the final diff for private files, secrets, source expansion, ranking drift,
   and accidental publish/deploy behavior.

## Explicit non-goals

- No new data source, including Edmtrain.
- No broader event discovery or recommendation universe.
- No ranking, matching, deduplication, Overview, Plan Ahead, or
  source-authority redesign.
- No site redesign, component-library introduction, or broad CSS cleanup.
- No changes to Spotify, SeatGeek, provenance, or Ollama firewalls.
- No raw provider payloads, private notes, credentials, or authenticated URLs
  in fixtures, tests, screenshots, or diagnostics.
- No live credentials or external API access in tests.
- No automatic publish, promote, or share-policy change.
- No silent golden/baseline updates.

## Stop conditions

Stop and report instead of guessing if:

- the deterministic fixture cannot be built or served locally without reading
  private inputs;
- the browser executable or test dependency requires a network/install step
  that cannot be completed safely;
- a failure appears to require a content/ranking/source change rather than a
  browser-contract fix;
- a screenshot diff cannot be separated from environment rasterization;
- a production fix would alter selection, provenance, source health, or the
  visual direction;
- root tests or the complete site build fail for an unrelated pre-existing
  reason after the QA changes.
