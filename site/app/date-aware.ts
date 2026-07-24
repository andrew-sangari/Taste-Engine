export const SITE_TIME_ZONE = "America/Los_Angeles";

export function localDateKey(value: string | Date | null | undefined, timeZone = SITE_TIME_ZONE): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function currentLocalDateKey(value: string | Date = new Date(), timeZone = SITE_TIME_ZONE): string {
  return localDateKey(value, timeZone) ?? "9999-12-31";
}

export function projectionDateKey(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

export function isCurrentOrFuture(value: string | null | undefined, todayKey: string): boolean {
  const dateKey = projectionDateKey(value);
  return dateKey == null || dateKey >= todayKey;
}

export function isDateAwareRefreshNeeded(generatedAt: string, todayKey: string): boolean {
  const generatedKey = localDateKey(generatedAt);
  return Boolean(generatedKey && todayKey > generatedKey);
}
