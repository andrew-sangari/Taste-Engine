# Taste Engine site — V2 visual plan

Status: proposal, mockup-first. Design truth is `design/v2/taste-engine-v2.html` (open in a browser).
Deployment boundary: Andrew / Codex own build + deploy. Nothing in `site/` was modified; all changes below are described for Codex to apply.
Baseline: the July 11 handoff ("nocturnal editorial, not terminal dashboard") is applied through Phase 3 and is NOT re-litigated here. V2 layers on top of it.

## Purpose

Make the deployed surface feel slicker without changing information architecture, ranking logic, or copy systems. Four layers, each independently shippable:

1. **L1 — Per-vertical card light** (replaces the single generic teal blur)
2. **L2 — Motion & micro-interaction** (reveal choreography, hover bloom, count-up)
3. **L3 — Data-as-texture** (hassle dials, urgency LEDs, source-health board)
4. **L4 — Serif editorial accent** (Instrument Serif italic, used sparingly)

## Non-goals

- No changes to ranking, data contracts, copy generation, or section order.
- No new pages, routes, or client state.
- No photography / external imagery (keeps the private, no-rights-issues stance).
- No re-theming: tokens in `globals.css :root` stay as-is; V2 only adds `--font-serif`.

## Current-state constraints (verified)

- `site/app/recommendation-visual.tsx` already emits `data-variant` and `data-kind` on `.recommendationVisual` — L1 is pure CSS + assets, no component API change.
- `--orange: #d5a36f` already exists as a token; use it for the warm accents (do not add a new amber token).
- Geist + Geist Mono load via `next/font` in `site/app/layout.tsx`; add Instrument Serif the same way.
- Existing sticky `.verticalTabs` and pulse-dot idioms are kept; V2 only refines them.
- `test/visuals.test.js` exists — expect snapshot/DOM assertions to need updating for L3 markup.

## Assets (already generated, in `design/v2/assets/`)

| File | Purpose | Destination |
|---|---|---|
| `visual-music.svg` | spectral EQ-bar light field, mint bloom | `site/public/` |
| `visual-sports.svg` | stadium light cones + field arc, night sky | `site/public/` |
| `visual-movies.svg` | projector beam + dust, warm lamp (uses `--orange` family) | `site/public/` |
| `og-v2.png` | 1200×630 OG image matching the nocturnal brand (current `og.png` is still the old cream/acid-yellow brand — visibly out of sync) | replace `site/public/og.png`; update any hardcoded `og:image:width/height` meta to 1200/630 |

All three SVGs: 800×500 viewBox, `preserveAspectRatio="xMidYMid slice"`, fade to `#030504` on the left edge so text sits on solid ground. They are also embedded inline in the mockup (identical geometry) if diffing is needed.

## File-by-file changes

### 1. `site/app/layout.tsx`
```tsx
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
const instrumentSerif = Instrument_Serif({ variable: "--font-serif", weight: "400", style: ["normal", "italic"], subsets: ["latin"] });
// add instrumentSerif.variable to the body className list
```

### 2. `site/app/globals.css` — additions only (blocks below are final CSS, lifted from the mockup)

**L1 — card art variants.** Target the existing attribute:
```css
.recommendationVisual[data-kind="texture"] { background-size: cover; background-position: center; opacity: .8; filter: saturate(.9); transition: opacity .45s ease, filter .45s ease; }
.recommendationVisual[data-variant="music"]  { background-image: url("/visual-music.svg"); }
.recommendationVisual[data-variant="sports"] { background-image: url("/visual-sports.svg"); }
.recommendationVisual[data-variant="movies"] { background-image: url("/visual-movies.svg"); }
.overviewCard:hover .recommendationVisual, .eventCard:hover .recommendationVisual { opacity: 1; filter: saturate(1.15) brightness(1.12); }
```
Fallback: any other/missing variant keeps the current teal wash (no regression path).

**L2 — motion.** Copy the `.rv` block, `@keyframes pulse`, and the `prefers-reduced-motion` guard from the mockup verbatim. Also:
- card hover: `transform: translateY(-3px)`, border → `rgba(98,223,195,.4)`, shadow `0 18px 44px rgba(0,0,0,.45)` (mockup `.rankCard:hover`);
- tabs: add `backdrop-filter: blur(14px)` + translucent `rgba(11,14,12,.86)` background, `top: 10px`.

**L3 — data-as-texture.** Copy from mockup: `.hassle`, `.hassleTicks` (+`.warm` at score ≥ 6), `.urgency` (+`.watch` pulse), `.ghostRank`, and the source board set (`.board`, `.boardGroup*`, `.srcRow`, `.led` / `.led.partial` / `.led.down`, `.srcCount`, `.srcBar`, `.srcNote`). Mockup uses `--amber`; substitute `var(--orange)`.

**L4 — serif accent.** Copy `.kicker`, `.verdict strong`, `.planAheadHead h3`, `footer .sig`. Rule of use: serif italic appears ONLY in (a) section kickers, (b) the skip-call verdict lead-in, (c) "Plan ahead" heading, (d) footer signature. Never in body copy, card titles, or data labels.

### 3. `site/app/overview-explorer.tsx` (and `event-explorer.tsx` card footer)
- Ghost numeral: `<span className="ghostRank" aria-hidden>{rank}</span>` as first child of the card (card needs `position: relative; overflow: clip` — already true for overviewCard).
- Hassle dial (server-rendered, no client JS):
```tsx
<span className="hassle">Hassle
  <span className="hassleTicks" data-warm={score >= 6 || undefined} aria-label={`Hassle ${score} of 10`}>
    {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < score ? "on" : undefined} />)}
  </span>
</span>
```
  Edge case: `hassleScore == null` → render the current text form, no ticks.
- Urgency chip: `watch` → `.urgency.watch` (pulsing mint dot); `safe to wait` → plain `.urgency`.

### 4. Source health section component
Restructure each source line into the 5-column `srcRow` grid (LED · name · count · bar · note). Bar width: `Math.round(100 * Math.min(1, Math.log10(1 + items) / Math.log10(1 + maxItemsInGroup)))` — log scale so SeatGeek's 1,560 doesn't flatten everything else. Status → LED class: `active`→default, `partial`→`.partial`, `unavailable`→`.down`. Mobile (< 900px): hide bar + note columns (CSS already handles).

### 5. Motion wiring (small client component)
`site/app/reveal.tsx` (`"use client"`): one `IntersectionObserver` adding `.on`; parent `data-stagger` sets `--rv-delay = i * 70ms` per child; count-up for `[data-count]` (900ms, cubic ease-out, skipped under reduced motion). Mockup `<script>` block is the reference implementation — port as-is. Apply `.rv` to: section eyebrows, intro headings/asides, cards, board, method steps.

### 6. Method rail
Wrap the existing 4 steps in `.methodRail` / `.methodStep` / `.methodNode` (mockup markup). Nodes light (mint ring + glow) when scrolled into view via the same observer.

## Edge cases

- **Reduced motion:** every animation is gated behind `prefers-reduced-motion` (already in the mockup CSS/JS). Verify count-up renders final numbers immediately.
- **No-JS / SSR first paint:** `.rv` starts at `opacity: 0` — add a `html:not(.js) .rv { opacity: 1 }` escape hatch or set the class from the observer component only after mount (mockup relies on JS running; the app should not).
- **Safari:** `-webkit-backdrop-filter` needed on tabs; `-webkit-text-stroke` for ghost numerals is Safari-safe.
- **Empty states:** "No later date currently clears the planning bar" panels get no art and no ghost rank — style unchanged.
- **Editorial/none variants:** fall through to current wash (see L1 fallback).

## Tests / verification

1. `npm test` — expect `visuals.test.js` and any overview snapshot updates for ghost-rank span + hassle ticks markup.
2. Playwright viewport check at 1680×973: first ranked card fully visible in first viewport (regression guard from the July 11 handoff, must not regress).
3. Axe/manual: hassle ticks have `aria-label`; ghost numerals `aria-hidden`; LEDs paired with text status in `.srcNote`.
4. Lighthouse: SVG assets are < 4 KB each; no CLS from reveal (transform/opacity only).

## Acceptance criteria

- [ ] Music / sports / movies cards show distinct light fields; hover brightens art and lifts card.
- [ ] Hassle renders as a 10-tick dial everywhere a score exists; warm coloring at ≥ 6.
- [ ] Source health reads as a status board: LED + count + log bar + mono note per source.
- [ ] Sections reveal on scroll with 70ms stagger; hero stats count up once; all motion off under reduced-motion.
- [ ] Serif italic appears in exactly the four sanctioned spots.
- [ ] OG image replaced; link previews match the nocturnal brand.
- [ ] No changes to ranking output, copy, or section order.

## Suggested sequencing for Codex

L1 + OG asset swap (pure CSS/assets, zero risk) → L3 markup (touches components + tests) → L2 motion component → L4 serif. Each layer is a clean commit; stop at any point and the site is still coherent.
