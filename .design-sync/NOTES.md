# design-sync notes — Taste Engine site

## Repo shape

`site/` is a Next.js (App Router) app, not a packaged component library — no `dist`, no `.d.ts`, no `main`/`module`/`exports` in `site/package.json`. The sync uses **synth-entry mode** (`cfg.srcDir: "app"`) and a self-referencing `node_modules/taste-engine-site -> ..` symlink inside `site/` so the converter's `PKG_DIR` resolution (which expects `node_modules/<pkg>`) resolves back to `site/` itself. Recreate that symlink on a fresh clone:

```sh
cd site && ln -sfn .. node_modules/taste-engine-site
```

## Forked `source-kit.mjs` (`.design-sync/overrides/source-kit.mjs`)

Next.js reserved route files (`layout.tsx`, `page.tsx`, `loading.tsx`, etc.) execute Next-only code at module top level (`next/font`, `next/headers`, `import "./globals.css"` which itself does `@import "tailwindcss"`). The stock converter's synth-entry step re-exports **every** `.tsx`/`.jsx` file under `srcDir` regardless of `cfg.componentSrcMap`, so those files broke the bundle even after excluding their component names. The fork extends `NON_IMPL_RX` to also skip reserved route filenames from both entry synthesis and `deriveComponentsFromSrc`. If the app adds new page/layout files under `app/`, no action needed — the fork's filename pattern covers the whole reserved-file family.

## Component scope (10 of ~13 exported values)

Excluded via the fork (route files) or `cfg.componentSrcMap`:
- `Home` (`page.tsx`) — full page, data-fetching, not a reusable component.
- `RootLayout` (`layout.tsx`) — html/body wrapper, Next-only.
- `FeedbackProvider` (`feedback-context.tsx`) — context provider, no visual surface of its own; `useFeedback()` degrades gracefully to `null` outside it, so no `cfg.provider` wrapping was needed for the other 10 components.

## Dark-canvas wrapper is load-bearing

The real app's dark background/text color comes from a `body { background: var(--background); color: var(--text-primary) }` rule in `app/globals.css`, not from any component root. The floor-card/preview harness sets an explicit `background:#fff` on its own `<body>` (same specificity, later in source order — wins). Every authored preview wraps its story in a `<div style={{ background: 'var(--background)', color: 'var(--text-primary)', padding: 24 }}>` to compensate. This is documented in `.design-sync/conventions.md` as the required wrapper for anything built with these components.

## Known limitation: brand font not shipped

`--font-sans` (Geist, via `next/font` in the excluded `layout.tsx`) has no `@font-face` anywhere in the scraped CSS, so `[FONT_MISSING]` never fires (there's nothing for the scraper to detect) — text silently falls back to the browser default sans-serif. `--font-mono` IS a real system stack and renders correctly. Not resolved this sync; would need Geist's font files wired via `cfg.extraFonts` on a future pass, with the user's OK.

## `cfg.overrides`

- `MovieExplorer`, `OverviewExplorer`, `TasteExplorer`: `{"cardMode": "column"}` — full-width page sections, flagged `[GRID_OVERFLOW]` in a product grid cell.
- `FilterDisclosure`: `{"viewport": "375x260"}` — this component is responsive in the *opposite* direction from most: `app/globals.css` shows it flat/inline with no toggle at desktop widths (`display: contents`) and only renders its actual pill-toggle-with-count-badge UI under `@media (max-width: 820px)`. The default browser viewport is wider than that breakpoint, so without the override both stories rendered visually identical flat content. The narrower viewport is what makes the `count` prop's effect (the "(2)" badge) visible at all.

## Preview data source

All fixture data is copied/trimmed from `site/tests/fixtures/qa-projection.json` (the app's own browser-QA fixture) — not invented. `/tmdb-logo.svg` and similar `public/`-relative image paths 404 in the standalone bundle (no `public/` copied), so preview files use an inline SVG data URI (`DEMO_IMAGE` const, repeated per preview file) wherever a story needs to show a genuinely *loaded* image. Paths that intentionally test the missing-image fallback (e.g. `MovieExplorer`'s fallback card) were left pointing at a nonexistent path on purpose — the component's CSS-background approach degrades to blank, not a broken-image icon, which is the real intended behavior.

## Known render warns

None outstanding — render check is `bad: 0`, `thin: 0`, `variantsIdentical: 0` as of this sync.

## Re-sync risks

- If `site/app/globals.css`'s Tailwind output changes meaningfully, re-run `cd site && npm run build` (or `npm run dev` then stop it) before re-syncing so `cfg.cssEntry` (`dist/client/assets/index-BTcwYKcL.css`) is current — the sync does NOT rebuild the site itself. If the hashed filename changes on a future site build, update `cssEntry` in `.design-sync/config.json` to match.
- The `node_modules/taste-engine-site` self-symlink lives under `site/node_modules/`, which is gitignored — it will NOT survive a fresh clone or `npm ci`. Recreate it (see above) before re-running the converter.
- If `app/page.tsx` or `app/layout.tsx` are renamed away from Next's reserved filenames, or a new page/layout is added with a non-reserved name that also does server-only work, the fork's filename-based exclusion won't catch it — check the build log for new `[UNRESOLVED_IMPORT]`/esbuild errors referencing `next/headers`, `next/font`, or unresolvable CSS.
- Component prop types are still `[key: string]: unknown` in every `.d.ts` (no real `.d.ts` tree exists to extract from in synth-entry mode) — the `.prompt.md` usage examples are the real contract for the design agent, not the `.d.ts` files.
