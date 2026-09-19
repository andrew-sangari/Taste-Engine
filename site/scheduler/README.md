# Taste Engine refresh scheduler

This Cloudflare Worker contains no ranking or source logic. It invokes the
protected hosted refresh at 15:30 UTC every Monday and Thursday (7:30 AM
Pacific Standard Time / 8:30 AM Pacific Daylight Time). The hosted endpoint
refreshes every enabled, connected profile serially.

One-time deployment:

```sh
npx wrangler login
npx wrangler secret put TASTE_REFRESH_SECRET --config scheduler/wrangler.jsonc
npx wrangler deploy --dry-run --config scheduler/wrangler.jsonc
npx wrangler deploy --config scheduler/wrangler.jsonc
```

Enter the same `TASTE_REFRESH_SECRET` stored in the Taste Engine Sites
environment. Never place it in `wrangler.jsonc` or source control.

The deployed Worker also exposes `POST /run` for a durable production manual
refresh. It requires the same bearer secret and immediately returns a Workflow
instance ID. Read its progress with authenticated `GET /runs/<instance-id>`.
Transient refresh-lock conflicts retry automatically. Deterministic per-profile
blockers are returned as profile outcomes without retrying profiles that already
published successfully, preventing one bad configuration from repeatedly
consuming every healthy profile's source quota.
