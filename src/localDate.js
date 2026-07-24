// Local event timestamps are stored as Los Angeles wall-clock values. Avoid
// parsing a timezone-less timestamp in the host timezone when deriving dates.
export function localDateKey(value) {
  const key = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

export function localDateAtNoon(value) {
  const key = localDateKey(value);
  return key ? new Date(`${key}T12:00:00Z`) : null;
}

export function weekdayForLocalDate(value, locale = 'en-US') {
  const date = localDateAtNoon(value);
  return date ? date.toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'long' }) : null;
}

export function localWeekdayIndex(value) {
  const date = localDateAtNoon(value);
  return date ? date.getUTCDay() : null;
}

export function formatLocalDate(value, options = {}, locale = 'en-US') {
  const date = localDateAtNoon(value);
  return date ? date.toLocaleDateString(locale, { timeZone: 'UTC', ...options }) : null;
}

export function formatLocalTime(value, locale = 'en-US') {
  const match = String(value ?? '').match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])));
  return date.toLocaleTimeString(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
}

export function localDateDifference(value, now = new Date(), timeZone = 'America/Los_Angeles') {
  const event = localDateAtNoon(value);
  if (!event || Number.isNaN(new Date(now).getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(now)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const reference = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  return Math.round((event.getTime() - reference.getTime()) / 86_400_000);
}
