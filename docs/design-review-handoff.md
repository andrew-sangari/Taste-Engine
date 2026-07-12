# Taste Engine design review and implementation handoff

Status: design direction approved; Phase 1–3 implementation applied. Durable feedback persistence remains a Phase 4 follow-up pending private durable storage/auth.
Reviewed: July 11, 2026  
Live surface: `https://taste-engine-la.andrewsangari.chatgpt.site`  
Reference: the supplied “One taste engine. Several ways out.” rendering

## Executive decision

The reference rendering is the correct north star. It is quiet, editorial, specific, and confident. The deployed site has strong data architecture and useful controls, but it currently presents the engine more like an operational catalog than a trusted personal brief.

The redesign should make one structural change above all others:

> Overview becomes a time-bounded decision surface. It answers what is worth doing now, then separates longer-lead planning from the current call.

Do not simply restyle the existing 180-day grids. Change the hierarchy so the engine makes a decision before it exposes the catalog.

## Art-direction correction: why the vibe is still off

The deployed site and the concept share ingredients—black, teal, Geist, mono labels, large type—but they do not yet share a mood.

The deployed site currently feels like:

- a green-tinted data lab
- a brutalist product launch page
- an operational status console
- a catalog with editorial copy layered on top

The concept feels like:

- a nocturnal cultural program
- a private editor's short list
- a calm, high-confidence recommendation
- a cinematic object with data available on demand

The target phrase for implementation is:

> **Nocturnal editorial, not terminal dashboard.**

### Measured visual gap at 1680×973

| Element | Live site | Concept direction | Decision |
|---|---:|---:|---|
| First recommendation begins | ~2041px down-page | ~660px | Recommendation must appear in the first viewport. |
| Opening display size | 156px / weight 590 | roughly 80–90px / regular | Reduce scale and weight; restore calm leading. |
| Opening line-height | 0.77 | roughly 0.96–1.0 | Never compress display type this aggressively. |
| Opening hero height | 660px plus 603px editorial block | one compact projection header | Remove the marketing/stat preamble. |
| Stat rail | 420px wide, full hero height | absent | Move counts to a utility line. |
| First recommendation card | 407px high before catalog detail | ~260px high | Use a concise feature with progressive detail. |
| Featured visual | procedural treatment on ~24% of card | photographic/atmospheric treatment on ~42% | Give the visual real compositional weight. |
| Card signals | multiple pills, metrics, advisory, footer | rank, type, reason, image | Reveal secondary signals only after the first read. |

### Tone and color temperature

Current surfaces lean visibly forest-green: `#060907`, `#0a0f0c`, and `#0d1511`. Across large fields this reads as “themed software.” The concept reads as neutral black, with teal appearing as emitted light.

Change the balance:

- Make 85–90% of the visible page neutral black/charcoal.
- Use green in active navigation, selected recommendation titles, thin rules, and image light—not as the base hue of every panel.
- Remove the broad green radial page wash.
- Use a barely visible neutral grain at page level if texture is needed.
- Let teal bloom inside imagery and active states; do not tint every container.
- Keep amber rare and semantic.

Recommended canvas stack:

```css
body {
  background: #030504;
  color: #dedfdb;
}

.surface { background: rgba(8, 10, 9, 0.92); }
.surface-raised { background: #0b0e0c; }
.hairline { border-color: rgba(218, 224, 220, 0.16); }
```

### Typography mood

The current 156px, weight-590, line-height-.77 opening headline is assertive and promotional. The reference headline is large but not loud: regular weight, open counters, slower line breaks, and visible air between lines.

Rules:

- No display weight above 480.
- Use optical regular weight for major headlines.
- Keep display line-height between `.92` and `1.0`.
- Use sentence case everywhere except mono metadata.
- Avoid making every card title a giant display headline; scale reflects rank.
- Do not use mono text as paragraph copy.
- Increase tracking on eyebrows, but give them more space above and below.

### Surface language

The current page uses many green surfaces, rounded containers, chip borders, and inset treatments. This makes every section look interactive and equally important.

The concept uses fewer objects:

- one tab frame
- one recommendation frame
- one active glow
- large areas of uncontained black

Rules:

- Do not wrap section intros in panels.
- Do not put a filled background behind every control group.
- Use borders to define major objects only.
- Reduce Overview radius from 18px to 10–12px.
- Remove drop shadows from standard cards.
- Reserve pills for category, call, and one exceptional state.
- Render provider, confidence, and secondary metrics as plain mono text separated by middots.

### Image language

The concept image is not decoration; it provides depth, place, and emotional temperature. The current generated stripe/noise effect reads as a CSS approximation because it occupies too little space and has no relationship to the event.

Every featured visual should follow this treatment:

- dark, cinematic, low-saturation source
- one dominant light direction
- teal may be introduced through the mask/grade, not by recoloring the whole image
- black mask fades into copy over 20–30% of the image width
- no full-bright posters in the Overview
- no logos as hero imagery
- no collages
- no random AI art that implies a real venue or performer

Fallback textures should be vertical-specific:

- Music: light beams, architecture, crowd atmosphere, stage haze.
- Movies: projection light, screen geometry, film grain, or permitted backdrop crop.
- Sports: stadium light, field geometry, night-game atmosphere, or a restrained score graphic.

### Density rhythm

The concept alternates large quiet fields with one dense object. The current site stacks a dense hero, dense stats, dense editorial block, dense intro, dense tabs, and dense cards.

Use this rhythm:

`quiet intro → clear navigation → short verdict → one strong feature → compact supporting list → optional detail`

After any dense card or control rail, add at least 48px of uncontained breathing room before another framed surface.

## Exact first-screen composition

At 1680×973, the page should approximate this vertical sequence:

- 40–56px: projection eyebrow
- 82–230px: two-column projection headline and supporting copy
- 294–374px: tab rail
- 430–610px: Overview verdict intro
- 660–920px: rank-01 feature card

The recommendation must be visible in the first screen without scrolling. The masthead may sit above this only if its height remains 64px or less.

At 390×844:

- compact masthead: 64px
- projection hero: 250–290px
- 2×2 tab grid: 112–128px
- verdict intro: 180–220px
- first card begins before 700px

Do not place stats between the masthead and the decision on either viewport.

## Cross-vertical visual grammar

Each tab should look different in subject matter while using the same visual syntax:

1. top-left mono index or date
2. one calm display title
3. one why-you sentence
4. one visual field touching a card edge
5. one primary call
6. secondary facts in a restrained utility row

### Overview mood

An editor's front page. The visual is broad and atmospheric. Rank and call are clear. Internal scores are hidden.

### Music mood

A late-night program guide. Use wider crops, venue light, and artist/event atmosphere. Feature cards may be horizontal; compact cards should retain more black than image. Avoid festival-poster clutter.

### Movies mood

A repertory/cinema program. Use poster or backdrop imagery more literally, but grade it into the global charcoal palette. Format confirmation is the bright signal. Use a slightly more spacious title block and less chip density.

### Sports mood

A selective night-game scorecard. Use strong date/opponent typography, thin field-like rules, and one stadium-light visual. Do not introduce Dodgers blue as a second design system. Rivalry or urgency may use amber sparingly.

## Visual anti-patterns to remove

- Oversized promotional hero type.
- A dedicated full-height stats rail.
- Green-tinted panels everywhere.
- More than three pills visible on a collapsed card.
- Metric bars on Overview.
- Blue browser-default focus outlines after pointer clicks.
- Multiple bordered containers touching with no breathing space.
- Text-only featured cards pretending a CSS texture is event imagery.
- Uniform 100-point movie scores presented as certainty.
- Full 180-day inventory in the default visual path.

## What the reference establishes

Treat these as the governing visual rules:

1. Near-black canvas with restrained teal as a signal, not decoration.
2. Large sans-serif editorial headlines paired with small mono labels.
3. Wide page gutters and generous vertical pauses.
4. A single framed tab rail with a softly illuminated active state.
5. One clear statement per section, with supporting copy in a separate column.
6. Recommendation cards behave like editorial features: title, date, place, one reason, one visual.
7. Imagery is atmospheric and useful for orientation; it does not become a colorful poster wall.
8. Borders are hairlines. Corners are modest. Shadows and gradients are nearly invisible.
9. The interface communicates confidence through reduction, not through showing every internal metric at once.

## Review of the deployed experience

### What is already strong

- The dark palette, teal accent, Geist/mono pairing, and two-column section intros are directionally aligned with the reference.
- Overview, Music, Movies, and Sports already have distinct information models rather than being the same card with different labels.
- Source health is explicit and grouped by vertical.
- Cross-provider links and occurrence grouping preserve provenance.
- Empty states support the product thesis that “nothing clears the bar” is valid.
- Filters work and the interface has no page-level horizontal overflow at tested desktop and mobile widths.
- Mobile cards reflow to one column and controls wrap without creating document overflow.

### Where the current experience misses the rubric

#### 1. The opening hierarchy is duplicated

`app/page.tsx:49-110` presents a large marketing hero, three operational stats, a large editorial block, and then a second hero titled “One taste engine. Several ways out.” The reference has one opening argument. A private personal product does not need both a marketing landing page and a decision surface.

Decision:

- Keep the compact masthead.
- Make “One taste engine. Several ways out.” the page hero.
- Convert the current editorial brief into a compact current-period verdict inside Overview.
- Move candidate counts and horizon into a subdued utility line; do not give them a quarter of the opening viewport.

#### 2. Overview is not answering “what should I do now?”

The live Overview leads with high-fit events in August and October, even though the product promise is a short current brief. This makes “Your next good night out” feel like a database sort rather than a decision.

Decision:

- Overview defaults to the coming weekend or next 14 days.
- Show up to five current recommendations across eligible verticals.
- If fewer than five clear the threshold, show fewer than five.
- If none clear it, lead with “Don’t waste your time this weekend.”
- Add a separate **Plan ahead** strip for exceptional long-lead items.
- “Safe to wait” belongs in Plan ahead, not as the dominant status across the current shortlist.

#### 3. DELETED IN REVIEW

#### 4. DELETED IN REVIEW 

#### 5. The lists are effectively unbounded

The live Music view exposes 60 entries and 97 dates; Movies exposes 20 cards; Sports exposes 11 series and 34 games. On a 390px viewport the page is more than 8,000px tall before exploring every detail.

Decision:

- Default each vertical to its most useful time window.
- Render an intentional first batch, then “Show more.”
- Preserve filtering, but treat the full 180-day catalog as an exploration mode rather than the default state.

#### 6. Mobile tab discovery is incomplete

At 390px, the tab rail has a 348px viewport and a 527px scroll width. Only Overview, Music, and part of Movies are visible; Sports has no visible affordance.

Decision:

- At `<= 520px`, use a 2×2 tab grid.
- At wider widths, keep the single rail from the reference.
- Do not rely on invisible horizontal scrolling.
- Add correct keyboard tab behavior: Left/Right, Home/End, roving `tabIndex`, and visible `:focus-visible` styling.

#### 7. The reference’s visual half is simulated, not represented in data

`app/globals.css:113-117` creates the featured Overview atmosphere using gradients, noise, and pseudo-elements. This approximates the reference but cannot adapt meaningfully to music, film, and sports.

Decision:

- Add an optional display-safe visual field to published recommendation data.
- Use a consistent dark image treatment with a leftward mask.
- Fall back to vertical-specific abstract textures only when a permitted source image is unavailable.
- Do not use the same teal corridor treatment for every vertical.

#### 8. Small mono text is overused

Several essential labels and links render at 9–10px (`app/globals.css:94`, `120`, `123`, `148`, `165`, `191-192`, `209`, `219`, `230-231`, `253`, `257`, `261`, `267`, `269`). The style matches the reference in spirit but loses readability, especially on mobile.

Decision:

- Set 11px as the absolute minimum for nonessential metadata.
- Use 12px for controls, statuses, dates, and actionable labels.
- Reserve 9–10px only for legal attribution that is not interactive.

## New global information architecture

### 1. Utility masthead

Desktop:

- Taste Engine wordmark
- Los Angeles
- refreshed timestamp + health dot
- Engine notes link

Mobile:

- wordmark left
- health dot + refreshed short date right
- hide location and the phrase “Live projection”

The current mobile masthead wraps “Live projection” into the wordmark area. Simplify rather than squeeze.

### 2. Projection hero

Use the reference composition:

- eyebrow: `THE PROJECTION`
- headline: `One taste engine. Several ways out.`
- supporting paragraph in the right column
- tab rail immediately below

Desktop hero spacing: 64–88px top, 52–64px below.  
Mobile: single column, 40px top, 28px between headline and supporting copy.

### 3. Active vertical surface

Each vertical owns:

- one concise intro statement
- one primary feature or verdict
- a small set of supporting recommendations
- progressive exploration controls

### 4. Engine notes

Place below the active experience or in a footer drawer:

- source health
- how ranking works
- taste/profile health
- provider/legal attribution

Keep these rendered server-side and accessible even when collapsed.

## Shared design system

### Color tokens

The existing palette is close. Consolidate it rather than replacing it:

```css
--bg: #030504;
--surface-1: #080a09;
--surface-2: #0b0e0c;
--line: rgba(202, 218, 211, 0.16);
--line-strong: rgba(202, 218, 211, 0.28);
--text-1: #eceeeb;
--text-2: #bec5c1;
--text-3: #7f8984;
--signal: #62dfc3;
--signal-strong: #84ecd5;
--signal-wash: rgba(98, 223, 195, 0.10);
--warning: #d5a36f;
```

Rules:

- Teal means selected, personally relevant, or confirmed positive.
- Amber means urgency, partial confidence, or operational caution.
- Do not create a separate saturated color per vertical.
- Vertical identity comes primarily from imagery and content structure.

### Typography

- Display: Geist Sans, weight 400–480.
- Metadata: Geist Mono, weight 450–550.
- Desktop projection title: `clamp(64px, 6.8vw, 112px)`, line-height `.92`.
- Section title: `clamp(44px, 5vw, 76px)`, line-height `.94`.
- Feature title: `clamp(40px, 4.2vw, 68px)`.
- Body: 16–18px, line-height `1.5`.
- Metadata/actions: 11–12px minimum.
- Avoid the current `.77` hero line-height; it produces a compressed, promotional tone rather than the reference’s editorial calm.

### Layout and spacing

- Page gutter: `clamp(20px, 4.3vw, 72px)`.
- Content max width: 1600px, centered on very wide screens.
- Base spacing unit: 8px.
- Section separation: 72–112px desktop; 48–72px mobile.
- Card radius: 10–12px.
- Control radius: pill for filters; 8–10px for containers.
- Use 1px borders; no heavy drop shadows.

### Motion and focus

- Hover/focus transitions: 140–180ms.
- Use opacity, border, and small translate changes only.
- Respect `prefers-reduced-motion`.
- Suppress default pointer-click outlines, but provide a 2px high-contrast `:focus-visible` ring.

## Shared recommendation language

Every recommendation should expose the same five concepts, but not with equal visual weight:

1. **What** — event, engagement, or game.
2. **When and where** — legible before scrolling.
3. **Why you** — one sentence, taste-owned evidence.
4. **Call** — prioritize, consider, watch, or skip.
5. **Friction** — hassle and ticket urgency, as compact secondary signals.

Do not display raw numeric fit as the primary meaning across verticals. A music fit of 60 and a sports interest of 70 are not a shared calibrated scale.

On Overview use labels such as `strong fit`, `selective`, `wildcard`, and the explanatory sentence. Numeric detail can remain in the vertical view.

If hassle or price is unknown, render **unknown**. Never visually convert missing data to `0/10` or “safe.”

## Overview specification

### Structure

1. eyebrow + refreshed date
2. verdict headline
3. one-sentence rationale
4. current shortlist
5. Plan ahead strip

### Current shortlist

- Maximum five items.
- Eligible window defaults to the configured weekend/next 14 days.
- Rank 01 is a wide feature card matching the reference.
- Ranks 02–05 use two-column compact cards on desktop and stacked cards on mobile.
- A verified movie may enter.
- Show fewer items rather than padding the list.

### Feature card anatomy

Left 55–60%:

- rank
- date
- title
- venue/location
- why-you sentence

Right 40–45%:

- dark masked event visual
- vertical badge in the top-right

Bottom utility row:

- call
- hassle
- urgency
- open vertical/detail action

Do not show the full local advisory block, fit bar, confidence, and provider list in the Overview card. Those belong in detail or the vertical.

### Negative verdict

When nothing clears the threshold:

- headline: `Don’t waste your time this weekend.`
- follow with the best near-miss and why it still does not clear the bar
- retain Plan ahead below

This state must look intentional, not empty.

## Music specification

### Default state

- Default to Next 30 days, not All dates (`app/event-explorer.tsx:42`).
- Show the top eight grouped artists/events initially.
- “Show all 60” enters catalog mode.
- Keep date, type, provider, sort, urgent, and low-hassle controls.

### Controls

- Desktop: one compact filter rail.
- Mobile: date chips visible; remaining filters behind a `Filters (n)` disclosure.
- Add `aria-pressed` to date filters (`app/event-explorer.tsx:70-73`).
- Preserve visible result count after any interaction.

### Music cards

- First result uses the wide reference feature pattern.
- Standard cards are denser than current 480–560px minimum heights (`app/globals.css:158-159`). Target 300–360px before expanded detail.
- Collapse `Taste Engine note` to one recommendation sentence.
- Put repeated dates, provider links, scoring detail, and full advisory in disclosure.
- Keep the date block, why-you evidence, and call always visible.
- Replace “Price unavailable” with subdued `No price signal`.

### Music visual source

Preferred order:

1. permitted provider/artist image already included in a source contract
2. promoter-owned event image with canonical link
3. a small approved library of abstract venue/light textures keyed by event type

Never send SeatGeek-only materials to an image or language model.

## Movies specification

Movies should feel cinematic, not like music cards with different metadata.

### Hierarchy

- Lead with one **format watch** feature.
- Group remaining items into `Confirmed locally`, `Release watch`, and `Long lead`.
- Show six initially; move the remainder behind “Show all candidates.”

### Card anatomy

- backdrop or poster image
- release date
- title and director
- why it matches the film profile
- format status as the dominant badge
- confirmed theater/showtime when available
- detail link

### Score treatment

The live data shows several `100` taste candidates while every item is `verification pending` (`app/movie-explorer.tsx:54-65`). This creates false certainty.

Decision:

- Replace the prominent number with a qualitative taste tier.
- Keep numeric score in expanded evidence if needed.
- A pending item uses `Potential fit`; a locally confirmed engagement may use `Strong fit`.
- Format verification outranks taste score in the visual hierarchy.

### Movie visuals

Use TMDB poster/backdrop fields under the existing attribution requirements. Apply the same dark mask and border system as music, but preserve enough image information to identify the film.

## Sports specification

Sports should feel like a selective matchup brief, not a full schedule table.

### Default state

- Lead with **Best game to attend**, not the highest-rated series.
- Show the best three series initially.
- The full 34-game schedule remains available through “All games.”
- Weekend, rivalry, pitching quality, and timing should be visible reasons.

### Series card anatomy

- opponent and series dates
- one selected game as the recommendation
- matchup reason
- probable pitchers when confirmed
- hassle and urgency
- consolidated `Tickets` disclosure containing provider links
- “View series” for remaining games

Keep the current circular score motif only in the detailed Sports view. On Overview use the shared call language instead.

### Sports controls

- Add programmatic labels to both selects (`app/sports-explorer.tsx:53-54`).
- Add `aria-pressed` to date filters (`app/sports-explorer.tsx:50-52`).
- On mobile, put Sort, Tickets, and Rivalries behind one filters disclosure.

## Feedback-loop design

The feedback loop is a core product promise but is not yet visible in the reviewed surface.

Add two stages:

### Before the event

On detail/expanded cards:

- `Save`
- `Not for me`
- optional reason chips after dismissal: artist, venue, price, timing, travel, format, other

### After the event

For attended/saved events whose time has passed:

- `Worth it?` — Yes / Mixed / No
- reason chips
- optional one-line note

Keep these controls quiet and personal. Do not use public-social patterns such as hearts, like counts, or feeds.

This requires durable persistence before release; do not use browser storage as the source of truth.

## Accessibility and interaction requirements

1. Implement the ARIA tabs keyboard pattern in `app/vertical-shell.tsx:34-42`.
2. Use `aria-pressed` on every segmented date control.
3. Maintain an `h1 → h2 → h3` hierarchy after removing the duplicate hero.
4. Keep hit targets at least 44×44px on mobile.
5. Do not communicate selected, urgent, or partial state through color alone.
6. Use `:focus-visible`; the current browser-default focus outline visually persists on clicked tabs.
7. Ensure sticky tabs have an offset below any sticky masthead, or keep only the tabs sticky—not both.
8. Preserve native `details/summary` semantics for occurrences, series, and engine notes.
9. Add accessible names to icon-only or empty-text provider links. The live Sports DOM contains provider links with empty accessible text in collapsed game rows.
10. Test at 390×844, 768×1024, 1440×900, and 1680×1050.

## Component and code handoff

### `app/page.tsx`

- Remove or collapse the marketing hero and large stat rail (`49-80`).
- Move the editorial verdict (`82-98`) into Overview.
- Promote the projection intro (`100-110`) to the main hero.
- Replace three full operational sections (`122-190+`) with a compact Engine notes surface.

### `app/vertical-shell.tsx`

- Retain hash-addressable vertical state.
- Add keyboard tab behavior and roving focus.
- Add mobile 2×2 layout.
- Consider keeping vertical state in the URL query/hash so shared links remain stable.

### `app/overview-explorer.tsx`

- Expand item type to include verified movies.
- Split current shortlist and Plan ahead.
- Add optional visual metadata.
- Replace always-visible metrics/advisory/footer blocks (`54-56`) with a compact utility row.

### `app/event-explorer.tsx`

- Default to soon.
- Add progressive disclosure.
- Add pressed states and accessible control semantics.
- Split `EventCard` into shared feature-card shell plus music-specific evidence.
- Keep source/occurrence details in disclosure.

### `app/movie-explorer.tsx`

- Add poster/backdrop fields and local verification fields.
- Replace prominent numeric score.
- Group by verification state.
- Add progressive disclosure.

### `app/sports-explorer.tsx`

- Select one best game per series for the collapsed state.
- Add accessible labels/pressed states.
- Consolidate ticket links.
- Add progressive disclosure.

### `app/globals.css`

- Preserve the palette; normalize tokens.
- Remove the oversized `.hero` system and fold its useful type rules into the projection hero.
- Replace pseudo-image treatment with a real optional media slot.
- Reduce card minimum heights.
- Add shared primitives for feature cards, chips, utility rows, filter drawers, status, and media masks.
- Add 2×2 mobile tab layout and proper focus styles.
- Raise critical mono text sizes.

### Published projection schema

Add display-safe optional fields rather than deriving visuals in components:

```ts
type RecommendationVisual = {
  kind: "image" | "texture" | "none";
  url?: string;
  alt?: string;
  focalPoint?: "left" | "center" | "right";
  attribution?: string;
};

type OverviewRecommendation = {
  vertical: "music" | "movies" | "sports";
  bucket: "current" | "plan-ahead";
  call: "prioritize" | "consider" | "watch" | "skip";
  visual?: RecommendationVisual;
  // existing canonical facts and ranking evidence remain unchanged
};
```

Never infer visual rights from the presence of an image URL. The export pipeline must decide whether a visual is publishable.

## Implementation sequence

### Phase 1 — hierarchy and shared shell

1. Promote the reference projection hero.
2. Move verdict into Overview.
3. Implement current vs Plan ahead buckets.
4. Add mobile 2×2 tabs and keyboard behavior.
5. Collapse operational content into Engine notes.

Acceptance:

- The first desktop viewport contains the projection headline and tabs.
- The first post-tab viewport contains a decision, not diagnostics.
- All four tabs are visible at 390px.
- A weekend with zero qualifying items renders the negative verdict intentionally.

### Phase 2 — shared recommendation system

1. Build the shared feature-card/media/utility primitives.
2. Apply them to Overview and Music.
3. Add progressive disclosure.
4. Normalize chips, statuses, and action language.

Acceptance:

- Overview rank 01 matches the reference’s visual hierarchy.
- No default vertical view renders more than eight top-level cards/series.
- Unknown price/hassle never appears as a confident zero or safe state.

### Phase 3 — vertical-specific visual systems

1. Movies: cinematic media + verification hierarchy.
2. Sports: best-game feature + selective series list.
3. Add publishable visual metadata in the export.

Acceptance:

- Each tab is recognizably different without changing the global palette or typography.
- Movies prioritize format confirmation.
- Sports prioritizes the specific game worth attending.

### Phase 4 — feedback and durable state

1. Add authentication/authorization as required by the private site.
2. Add D1 persistence for save/dismiss/attend/review.
3. Add pre-event and post-event feedback controls.
4. Feed only validated personal outcomes back to the deterministic pipeline.

Acceptance:

- Feedback survives sessions.
- “Could not attend” is distinct from “not worth it.”
- Feedback UI does not expose private behavior publicly.

## QA checklist

### Visual

- Compare the projection hero, tab rail, Overview intro, and first card directly to the supplied rendering at 1680px.
- Check line wrapping at 1440px and 1024px.
- Confirm no critical label is below 11px.
- Confirm imagery masks do not obscure titles or status labels.

### Responsive

- 390px: four visible tabs, single-column content, filter disclosure, no horizontal overflow.
- 768px: single-column feature cards with balanced media height.
- 1440px: reference two-column intros and wide feature card.
- 1680px: page does not become over-wide; max-width remains centered.

### Interaction

- Mouse, keyboard, and touch tab switching.
- Hash links open the correct vertical and focus/scroll sensibly.
- Filters expose selected state programmatically.
- Show more preserves filters and scroll position.
- Details/summary controls retain accessible names.

### Content and data

- Current shortlist contains only current-window eligible items.
- Plan ahead contains exceptional long-lead items.
- Movies enter Overview only after local engagement confirmation.
- Missing values render unknown, never zero.
- Source health remains accurate after being visually demoted.

## Explicit non-goals for this redesign

- Do not change retrieval, deduplication, or canonical scoring authority.
- Do not let an LLM reorder or add candidates.
- Do not add a generic dashboard navigation shell.
- Do not introduce a bright color per vertical.
- Do not fill the page with posters or provider logos.
- Do not make source-health detail the primary experience.
- Do not optimize for showing all available inventory by default.

## Final design principle

The engine can know a great deal. The interface should reveal only what helps make the next decision.
