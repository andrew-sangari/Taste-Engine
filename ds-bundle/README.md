## Taste Engine site — conventions

This is the UI layer of a Next.js (App Router) personal recommendation app, synced without a component-library build (no `dist`/`.d.ts` — see the `.pkg-entry.mjs` synth-entry note in each `.prompt.md`). Components take app-shaped data props (`OverviewItem`, `EventItem`, `SportsGame`, `Movie`), not generic primitives — build with them by assembling that data, not by inventing new prop shapes.

### Required wrapper

Every component assumes the dark canvas the real app's `<body>` supplies (`body { background: var(--background); color: var(--text-primary) }` in the source app). That rule lives on `body`, not on any component root, so a design that mounts a component into its own container must reapply it or content renders on a default white background with pale, barely-visible text:

```jsx
<div style={{ background: 'var(--background)', color: 'var(--text-primary)', padding: 24 }}>
  <VerticalShell overview={...} events={...} movies={...} sports={...} recentHistory={...}
    generatedAt={...} tmdbStatus="active" featuredInterestThreshold={70} tasteProfile={null} />
</div>
```

### Styling idiom: tokens, not utility classes

This is a token-driven dark UI, not a utility-class API — don't invent Tailwind-style classnames for it. Components ship their own semantic class names (`eventCard`, `movieCard`, `overviewCard`, `seriesCard`, `cardActions`) as an internal implementation detail; compose by passing data props to the exported components, never by targeting those classes. The real design tokens (`:root` custom properties, all resolvable in the shipped `_ds_bundle.css`):

| Token | Value | Use |
|---|---|---|
| `--background` | `#030504` | page canvas |
| `--surface` / `--surface-raised` | `#080a09` / `#0b0e0c` | card backgrounds |
| `--text-primary` / `--text-secondary` / `--text-muted` | `#eceeeb` / `#bec5c1` / `#7f8984` | text hierarchy |
| `--accent` / `--accent-bright` / `--accent-dark` | `#62dfc3` / `#84ecd5` / `#173f36` | the signature mint-green accent (scores, active tabs, CTAs) |
| `--border` / `--border-strong` | translucent near-white | hairlines |
| `--font-mono` | real system mono stack | labels/eyebrows (`text-transform: uppercase`, tracked) |

### Known gap: brand font

The real app sets its sans-serif body font (Geist) via `next/font` in `layout.tsx`, which this sync deliberately excludes (Next reserved route files execute server-only code that breaks a standalone bundle — see `.design-sync/NOTES.md`). `--font-sans` is therefore **undefined** here; text falls back to the browser default sans-serif. Don't invent a `--font-sans` value — if brand-font fidelity matters for a design, ask for the Geist font files to be wired in via `extraFonts` on a future sync.

### Where the truth lives

- `styles.css` → `@import`s `_ds_bundle.css`, the real compiled Tailwind v4 output of the app's own `app/globals.css`. Read it before styling anything.
- Each `components/general/<Name>/<Name>.prompt.md` — real usage composed from this app's own QA fixture data (`tests/fixtures/qa-projection.json`).

### Example: a ranked list section

```jsx
<div style={{ background: 'var(--background)', color: 'var(--text-primary)', padding: 24 }}>
  <EventExplorer
    generatedAt="2026-07-12T12:00:00.000-07:00"
    events={[{
      id: 'evt-1', title: 'Short Signal', sourceUrl: 'https://example.com/evt-1',
      eventType: 'concert', startLocal: '2026-07-15T20:00:00-07:00', timeTbd: false,
      venue: { name: 'The Example Hall', city: 'Los Angeles', state: 'CA' },
      ticketObservation: { lowestPriceUsd: 45, listingCount: 18 },
      matchedArtists: [{ name: 'Short Signal', seedStrength: 0.9, primary: true, origin: 'source' }],
      ranking: { artistFit: 92, hassleScore: 3, hassleReasons: [], utility: 91, confidence: 'confirmed', urgency: 'watch', whyYou: 'A direct seed with a clean weeknight fit.' },
    }]}
  />
</div>
```

# TasteEngineSite (taste-engine-site@0.1.0)

This design system is the published taste-engine-site React library, bundled as a single
browser global. All 10 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.TasteEngineSite`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.TasteEngineSite.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { CardActions } = window.TasteEngineSite;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<CardActions />);
```

## Tokens

41 CSS custom properties from taste-engine-site. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (7): `--tw-drop-shadow-color`, `--surface`, `--surface-raised`, …
- **typography** (4): `--font-sans`, `--font-mono`, `--default-font-family`, …
- **shadow** (3): `--tw-drop-shadow`, `--tw-drop-shadow-alpha`, `--tw-drop-shadow-size`
- **other** (27): `--tw-blur`, `--tw-brightness`, `--tw-contrast`, …

## Components

### general
- `CardActions`
- `ChangesStrip`
- `EventExplorer`
- `FilterDisclosure`
- `MovieExplorer`
- `OverviewExplorer`
- `RecommendationVisual`
- `SportsExplorer`
- `TasteExplorer`
- `VerticalShell`
