// Browser counterpart to src/localDate.js. Projection timestamps are LA wall
// clock values, so displayed days must not depend on the viewer's device zone.
export function localDateKey(value: unknown): string | null {
  const key = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function atNoon(value: unknown): Date | null {
  const key = localDateKey(value);
  return key ? new Date(`${key}T12:00:00Z`) : null;
}

export function formatLocalDate(value: unknown, options: Intl.DateTimeFormatOptions = {}, locale = "en-US"): string | null {
  const date = atNoon(value);
  return date ? date.toLocaleDateString(locale, { timeZone: "UTC", ...options }) : null;
}

export function formatLocalTime(value: unknown, locale = "en-US"): string | null {
  const match = String(value ?? "").match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])));
  return date.toLocaleTimeString(locale, { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
}

export function daysFromLocalDate(value: unknown, generatedAt: unknown): number | null {
  const event = atNoon(value);
  const generated = atNoon(generatedAt);
  return event && generated ? Math.round((event.getTime() - generated.getTime()) / 86_400_000) : null;
}
