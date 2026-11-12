import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a request carries Vercel Cron's bearer secret. An unset or short
 * `CRON_SECRET` authorizes nothing, so a missing variable can never open the
 * refresh route. Compared in constant time.
 */
export function cronAuthorized(request: Request): boolean {
  const configured = process.env.CRON_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 24 || !supplied) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(configured), digest(supplied));
}
