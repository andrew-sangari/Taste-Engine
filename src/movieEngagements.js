// Reviewed, sourced confirmations of real local film screenings.
//
// TMDB supplies a theatrical date; it never confirms a theater, a premium
// format, or a worthwhile local engagement. This module joins a hand-reviewed
// list of confirmations (theater, format, dates, optional published showtimes,
// source link, expiry) onto the TMDB shortlist so a confirmed film becomes
// actionable while every other film stays "verification pending".
//
// Pure and deterministic: no I/O, no `node:` imports, safe to bundle for a
// Worker. Nothing here infers a showtime; a showtime is only ever one the
// reviewer typed in from the linked source.

export const ENGAGEMENT_FORMATS = Object.freeze(['IMAX', 'IMAX 70mm', '70mm', '35mm', 'Dolby Cinema', 'Standard']);
export const DEFAULT_ENGAGEMENT_EXPIRY_DAYS = 21;
export const ENGAGEMENT_TIME_ZONE = 'America/Los_Angeles';
export const ENGAGEMENT_SOURCE = 'movie-engagements';

// Headline preference when one film has several live engagements on the same
// day: the rarer presentation first.
const FORMAT_RANK = new Map(['IMAX 70mm', '70mm', 'IMAX', 'Dolby Cinema', '35mm', 'Standard'].map((format, index) => [format, index]));
const FORMAT_BY_KEY = new Map(ENGAGEMENT_FORMATS.map((format) => [normalizeName(format), format]));
const MAX_NOTE_LENGTH = 280;
const ENTRY_FIELDS = new Set([
  'tmdbId', 'title', 'year', 'theater', 'format', 'startDate', 'endDate', 'showtimes',
  'sourceUrl', 'confirmedAt', 'expiresAt', 'note', 'allowOtherTheater',
  // Derived by normalizeEngagements; accepted so its output can be fed back in.
  'index', 'premium', 'priorityTheater'
]);

/**
 * Validate a reviewed list of screening confirmations.
 *
 * `input` is an array, a `{ engagements: [...] }` file object, or null/undefined
 * (no confirmations on file, which is valid). `priorityTheaters` is the list
 * from the movie config (`[{ name, formats }]` or plain names); omitted means
 * an empty allowlist, so only `allowOtherTheater: true` entries pass.
 *
 * Returns `{ configured, engagements, rejected, expired, warnings, error }`.
 * Nothing is thrown for bad entries: each is reported with its index and a
 * reason so source health can show it.
 */
export function normalizeEngagements(input, { now = new Date(), priorityTheaters = [], timeZone = ENGAGEMENT_TIME_ZONE } = {}) {
  const clock = localClock(now, timeZone);
  const result = { configured: input != null, engagements: [], rejected: [], expired: [], warnings: [], error: null };
  if (input == null) return result;
  const list = Array.isArray(input) ? input : Array.isArray(input?.engagements) ? input.engagements : null;
  if (!list) {
    result.error = 'Engagement list must be an array or an object with an "engagements" array.';
    return result;
  }
  const theaters = theaterAllowlist(priorityTheaters);
  const seen = new Map();
  list.forEach((raw, position) => {
    const index = isPlainObject(raw) && Number.isInteger(raw.index) && raw.index >= 0 ? raw.index : position;
    const outcome = normalizeEntry(raw, { clock, theaters, timeZone });
    const label = { index, title: outcome.title ?? null };
    if (outcome.reason) {
      result.rejected.push({ ...label, reason: outcome.reason });
      return;
    }
    const engagement = { index, ...outcome.engagement };
    const duplicateKey = [engagement.tmdbId ?? `${normalizeName(engagement.title)}#${engagement.year ?? ''}`, normalizeName(engagement.theater), engagement.format, engagement.startDate, engagement.endDate ?? ''].join('|');
    if (seen.has(duplicateKey)) {
      result.rejected.push({ ...label, reason: `duplicate of entry ${seen.get(duplicateKey)}` });
      return;
    }
    seen.set(duplicateKey, index);
    const lapse = expiryReason(engagement, clock, timeZone);
    if (lapse) {
      result.expired.push({ ...label, theater: engagement.theater, format: engagement.format, expiresAt: engagement.expiresAt, reason: lapse });
      return;
    }
    if (outcome.warning) result.warnings.push({ ...label, reason: outcome.warning });
    result.engagements.push(engagement);
  });
  return result;
}

/**
 * Join reviewed confirmations onto the film shortlist.
 *
 * `engagements` is the raw reviewed list (array or `{ engagements }` object),
 * null/undefined for "no file", or a previous `normalizeEngagements` result.
 * It is always (re)validated here against `priorityTheaters` and `now`.
 *
 * A film with at least one live confirmation gains `engagements` (soonest
 * first), `premiumFormatConfirmed`, `formatStatus: 'confirmed'`, `theater`,
 * `format`, `actionable: true`, and `nextScreening` (YYYY-MM-DD). The headline
 * `theater` / `format` / `nextScreening` come from the soonest premium
 * engagement, else the soonest one. A film with no live confirmation is
 * returned as the same, untouched object.
 */
export function applyEngagements(movies, engagements, { priorityTheaters = [], now = new Date(), timeZone = ENGAGEMENT_TIME_ZONE } = {}) {
  const clock = localClock(now, timeZone);
  const films = Array.isArray(movies) ? movies : [];
  const normalized = normalizeEngagements(engagements, { now, priorityTheaters, timeZone });
  // A previous normalizeEngagements result keeps what it already reported.
  const carried = isPlainObject(engagements) ? engagements : {};
  const rejected = [...reportList(carried.rejected), ...normalized.rejected];
  const expired = [...reportList(carried.expired), ...normalized.expired];
  const configured = carried.configured === false ? false : normalized.configured;
  const error = normalized.error ?? (typeof carried.error === 'string' ? carried.error : null);
  const unmatched = [];

  const byTmdbId = new Map();
  const byTitle = new Map();
  films.forEach((movie, position) => {
    const id = movieTmdbId(movie);
    if (id && !byTmdbId.has(id)) byTmdbId.set(id, position);
    const key = normalizeName(movie?.title);
    if (key) byTitle.set(key, [...(byTitle.get(key) ?? []), position]);
  });

  const matches = new Map();
  for (const engagement of normalized.engagements) {
    const match = matchFilm(engagement, films, byTmdbId, byTitle);
    if (match.reason) {
      unmatched.push({
        index: engagement.index,
        title: engagement.title,
        year: engagement.year,
        tmdbId: engagement.tmdbId,
        theater: engagement.theater,
        format: engagement.format,
        reason: match.reason
      });
      continue;
    }
    matches.set(match.position, [...(matches.get(match.position) ?? []), displayEngagement(engagement, clock)]);
  }

  let appliedCount = 0;
  const output = films.map((movie, position) => {
    const display = matches.get(position);
    if (!display?.length) return movie;
    display.sort(compareEngagements);
    appliedCount += display.length;
    const headline = display.find((engagement) => engagement.premium) ?? display[0];
    return {
      ...movie,
      engagements: display,
      premiumFormatConfirmed: display.some((engagement) => engagement.premium),
      formatStatus: 'confirmed',
      theater: headline.theater,
      format: headline.format,
      actionable: true,
      nextScreening: headline.nextScreening
    };
  });

  return {
    movies: output,
    configured,
    error,
    appliedCount,
    confirmedMovieCount: matches.size,
    unmatched,
    expired,
    rejected,
    warnings: normalized.warnings
  };
}

/**
 * Source-health row for the reviewed confirmations. Published, so `details`
 * carries counts and one date only: no titles, theaters, or URLs.
 */
export function engagementSourceHealth(result = {}) {
  const count = (value) => (Array.isArray(value) ? value.length : 0);
  const applied = Number(result.appliedCount) || 0;
  const unmatched = count(result.unmatched);
  const expired = count(result.expired);
  const rejected = count(result.rejected);
  const conflicts = count(result.warnings);
  const warningCount = unmatched + rejected + conflicts + (result.error ? 1 : 0);
  let status;
  if (result.error) status = 'unavailable';
  else if (!result.configured) status = 'not configured';
  else if (warningCount > 0) status = 'partial';
  else status = 'active';
  const expiries = (Array.isArray(result.movies) ? result.movies : [])
    .flatMap((movie) => (Array.isArray(movie?.engagements) ? movie.engagements : []))
    .map((engagement) => String(engagement.expiresAt ?? '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return {
    source: ENGAGEMENT_SOURCE,
    status,
    itemCount: applied,
    warningCount,
    details: {
      confirmedFilms: Number(result.confirmedMovieCount) || 0,
      activeEngagements: applied,
      unmatchedEngagements: unmatched,
      expiredEngagements: expired,
      rejectedEngagements: rejected,
      formatConflicts: conflicts,
      nextExpiry: expiries[0] ?? null
    }
  };
}

// ---------- validation ----------

function normalizeEntry(raw, { clock, theaters, timeZone }) {
  if (!isPlainObject(raw)) return { reason: 'entry must be an object' };
  const title = cleanText(raw.title);
  const fail = (reason) => ({ title: title || null, reason });
  if (!title || !normalizeName(title)) return fail('title is required');
  const unknown = Object.keys(raw).find((key) => !ENTRY_FIELDS.has(key));
  if (unknown) return fail(`unknown field "${unknown}"`);

  const sourceUrl = httpsUrl(raw.sourceUrl);
  if (!sourceUrl) return fail('sourceUrl is required and must be an https URL');

  let tmdbId = null;
  if (raw.tmdbId != null && raw.tmdbId !== '') {
    tmdbId = parseTmdbId(raw.tmdbId);
    if (!tmdbId) return fail('tmdbId must be a positive integer');
  }
  let year = null;
  if (raw.year != null && raw.year !== '') {
    year = Number(raw.year);
    if (!Number.isInteger(year) || year < 1888 || year > 2200) return fail('year must be a four-digit year');
  }

  const format = FORMAT_BY_KEY.get(normalizeName(raw.format));
  if (!format) return fail(`format must be one of: ${ENGAGEMENT_FORMATS.join(', ')}`);

  const theaterInput = cleanText(raw.theater);
  const theaterKey = normalizeName(theaterInput);
  if (!theaterKey) return fail('theater is required');
  const listed = theaters.get(theaterKey);
  if (raw.allowOtherTheater != null && typeof raw.allowOtherTheater !== 'boolean') return fail('allowOtherTheater must be true or false');
  if (!listed && raw.allowOtherTheater !== true) return fail('theater is not a configured priority theater (set allowOtherTheater: true to permit it)');

  if (!isDateKey(raw.startDate)) return fail('startDate is required as YYYY-MM-DD');
  const startDate = raw.startDate;
  let endDate = null;
  if (raw.endDate != null && raw.endDate !== '') {
    if (!isDateKey(raw.endDate)) return fail('endDate must be YYYY-MM-DD');
    if (raw.endDate < startDate) return fail('endDate is before startDate');
    endDate = raw.endDate;
  }

  let showtimes = [];
  if (raw.showtimes != null) {
    if (!Array.isArray(raw.showtimes)) return fail('showtimes must be an array of local ISO date-times');
    const parsed = raw.showtimes.map(parseLocalShowtime);
    if (parsed.some((value) => !value)) return fail('showtimes must be local ISO date-times such as 2026-12-18T19:00 (no time zone suffix)');
    if (parsed.some((value) => value.slice(0, 10) < startDate || (endDate && value.slice(0, 10) > endDate))) return fail('a showtime falls outside startDate/endDate');
    showtimes = [...new Set(parsed)].sort();
  }

  const confirmed = parseStamp(raw.confirmedAt, timeZone);
  if (!confirmed) return fail('confirmedAt is required as YYYY-MM-DD or an ISO timestamp with a time zone');
  if (confirmed.dateKey > clock.date) return fail('confirmedAt is in the future');

  let expires = null;
  if (raw.expiresAt != null && raw.expiresAt !== '') {
    expires = parseStamp(raw.expiresAt, timeZone);
    if (!expires) return fail('expiresAt must be YYYY-MM-DD or an ISO timestamp with a time zone');
  }

  let note = null;
  if (raw.note != null && raw.note !== '') {
    if (typeof raw.note !== 'string') return fail('note must be text');
    note = cleanText(raw.note).slice(0, MAX_NOTE_LENGTH) || null;
  }

  const premium = format !== 'Standard';
  const conflict = listed && premium && listed.formats.size && !listed.formats.has(format)
    ? `${format} is not among the formats configured for this priority theater`
    : null;
  return {
    title,
    warning: conflict,
    engagement: {
      tmdbId,
      title,
      year,
      theater: listed?.name ?? theaterInput,
      format,
      premium,
      priorityTheater: Boolean(listed),
      ...(listed ? {} : { allowOtherTheater: true }),
      startDate,
      endDate,
      showtimes,
      sourceUrl,
      confirmedAt: confirmed.value,
      // Default expiry: the run's end date, else three weeks after review.
      expiresAt: expires?.value ?? endDate ?? addDays(confirmed.dateKey, DEFAULT_ENGAGEMENT_EXPIRY_DAYS),
      note
    }
  };
}

function expiryReason(engagement, clock, timeZone) {
  const expires = parseStamp(engagement.expiresAt, timeZone);
  if (expires?.instant != null ? clock.instant > expires.instant : clock.date > expires.dateKey) return 'confirmation expired';
  if (engagement.endDate && clock.date > engagement.endDate) return 'run ended';
  // Published showtimes with no end date are the whole known engagement. Once
  // they have all passed there is nothing left to act on.
  if (!engagement.endDate && engagement.showtimes.length && engagement.showtimes.every((showtime) => showtime < clock.dateTime)) {
    return 'published showtimes have passed';
  }
  return null;
}

// ---------- joining ----------

function matchFilm(engagement, films, byTmdbId, byTitle) {
  if (engagement.tmdbId) {
    const position = byTmdbId.get(engagement.tmdbId);
    return position == null ? { reason: 'no shortlisted film has this TMDB id' } : { position };
  }
  let candidates = byTitle.get(normalizeName(engagement.title)) ?? [];
  if (engagement.year != null) {
    candidates = candidates.filter((position) => String(films[position]?.releaseDate ?? '').slice(0, 4) === String(engagement.year));
  }
  if (!candidates.length) {
    return { reason: engagement.year != null ? 'no shortlisted film has this exact title and year' : 'no shortlisted film has this exact title' };
  }
  if (candidates.length > 1) return { reason: 'title matches more than one shortlisted film; add tmdbId or year' };
  return { position: candidates[0] };
}

function displayEngagement(engagement, clock) {
  const upcoming = engagement.showtimes.filter((showtime) => showtime >= clock.dateTime);
  let nextScreening;
  let nextScreeningBasis;
  if (upcoming.length) {
    nextScreening = upcoming[0].slice(0, 10);
    nextScreeningBasis = 'showtime';
  } else if (engagement.startDate >= clock.date) {
    nextScreening = engagement.startDate;
    nextScreeningBasis = 'run-start';
  } else {
    nextScreening = clock.date;
    nextScreeningBasis = 'run-in-progress';
  }
  return {
    theater: engagement.theater,
    format: engagement.format,
    premium: engagement.premium,
    priorityTheater: engagement.priorityTheater,
    startDate: engagement.startDate,
    endDate: engagement.endDate,
    showtimes: upcoming,
    nextScreening,
    nextShowtime: upcoming[0] ?? null,
    nextScreeningBasis,
    sourceUrl: engagement.sourceUrl,
    confirmedAt: engagement.confirmedAt,
    expiresAt: engagement.expiresAt,
    note: engagement.note
  };
}

function compareEngagements(left, right) {
  return left.nextScreening.localeCompare(right.nextScreening)
    || String(left.nextShowtime ?? '9999').localeCompare(String(right.nextShowtime ?? '9999'))
    || FORMAT_RANK.get(left.format) - FORMAT_RANK.get(right.format)
    || left.theater.localeCompare(right.theater)
    || left.startDate.localeCompare(right.startDate);
}

function movieTmdbId(movie) {
  return parseTmdbId(movie?.tmdbId) ?? parseTmdbId(movie?.id);
}

// ---------- primitives ----------

function theaterAllowlist(priorityTheaters) {
  const allowlist = new Map();
  for (const entry of Array.isArray(priorityTheaters) ? priorityTheaters : []) {
    const name = cleanText(typeof entry === 'string' ? entry : entry?.name);
    const key = normalizeName(name);
    if (!key || allowlist.has(key)) continue;
    const formats = new Set((Array.isArray(entry?.formats) ? entry.formats : [])
      .map((format) => FORMAT_BY_KEY.get(normalizeName(format)))
      .filter(Boolean));
    allowlist.set(key, { name, formats });
  }
  return allowlist;
}

function parseTmdbId(value) {
  const match = String(value ?? '').trim().match(/^(?:tmdb:)?([1-9]\d*)$/i);
  return match ? match[1] : null;
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseLocalShowtime(value) {
  const match = typeof value === 'string'
    ? value.trim().match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/)
    : null;
  return match && isDateKey(match[1]) ? `${match[1]}T${match[2]}:${match[3]}` : null;
}

// A date-only stamp is a local calendar day. A timestamp must carry its own
// zone so the instant is unambiguous.
function parseStamp(value, timeZone) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (isDateKey(text)) return { value: text, dateKey: text, instant: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  const instant = Date.parse(text);
  if (Number.isNaN(instant)) return null;
  const date = new Date(instant);
  return { value: date.toISOString(), dateKey: localClock(date, timeZone).date, instant };
}

function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localClock(now, timeZone) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new TypeError('movieEngagements: "now" must be a valid date.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { instant: date.getTime(), date: day, dateTime: `${day}T${parts.hour}:${parts.minute}` };
}

// Exact-match key for titles and theater names: case, accents, punctuation,
// and spacing are ignored; nothing is fuzzy.
function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function reportList(value) {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
