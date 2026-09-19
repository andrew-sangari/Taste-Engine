# Taste Engine Sites application

The authenticated production UI and API run on vinext with a required Sites D1
binding named `DB`. The repository-root pipeline remains the local recovery
producer.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm ci
npm run dev
npm run build
npm run verify
```

The application uses `.openai/hosting.json`; it does not use a site-level
`wrangler.jsonc`. The separate scheduler does.

Taste Engine's projection is date-aware at runtime: the browser compares each record's local date with the current Los Angeles date and hides past records without requiring a new deployment. New source data and ranking changes still come from the local Taste Engine refresh.

## Runtime shape

- edit site code under `app/`
- `.openai/hosting.json` declares the required Sites D1 binding and no R2 binding
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` and `drizzle/` define profile-scoped production persistence
- `drizzle.config.ts` supports local migration generation when needed
- `GET /api/health` reports release and readiness metadata without secrets
- `tests/deployment-smoke.mjs` checks the packaged Worker, bindings, and migrations

## Workspace Auth Headers

Sites provides authenticated email plus optional full name. Taste Engine hashes
the normalized server-injected email into an opaque profile ID; the browser
cannot select the tenancy key.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Production
requires the comma-separated server-side `TASTE_ALLOWED_PROFILE_EMAILS` allowlist,
and the Sites hosting access policy remains the outer restriction. Deployment
automation must preserve the current access policy and must not toggle share
visibility as part of a build or publish.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: production-build and run server, rendering, profile-isolation, Spotify, scheduler, and persistence tests
- `npm run typecheck`: validate the application and Worker/D1 boundary
- `npm run smoke:build`: validate the already-built deployment package
- `npm run verify`: lint, type-check, test/build, and run the deployment smoke check
- `npm run db:generate`: generate Drizzle migrations after schema changes

See [deployment and profile operations](../docs/deployment-and-profiles.md) for
release metadata, clean-checkout verification, migration order, and external
Spotify/Sites actions.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
