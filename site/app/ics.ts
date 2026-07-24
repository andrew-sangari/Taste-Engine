// Pure ICS (RFC 5545) formatter for "Hold the date" exports.
//
// Compatibility decision: events reference IANA timezones via
// `DTSTART;TZID=America/Los_Angeles` WITHOUT an embedded VTIMEZONE block.
// Apple Calendar and Google Calendar resolve IANA TZIDs natively; we accept
// that dependency rather than hand-maintaining daylight-saving rules.

export type CalendarEventInput = {
  uid: string;                    // stable id; sanitized into UID:<id>@taste-engine
  title: string;
  startLocal: string | null;      // "YYYY-MM-DDTHH:MM[:SS]" local wall time, or null
  dateLocal?: string | null;      // "YYYY-MM-DD" for all-day events (movies, TBD times)
  allDay?: boolean;
  locationLabel?: string | null;
  description?: string | null;
  url?: string | null;
};

export type CalendarOptions = {
  now?: Date;
  timezone?: string;
};

export function buildCalendarEvent(input: CalendarEventInput, options: CalendarOptions = {}): string | null {
  const timezone = options.timezone ?? "America/Los_Angeles";
  const now = options.now ?? new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Taste Engine//Hold the Date//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${sanitizeUid(input.uid)}@taste-engine`,
    `DTSTAMP:${utcStamp(now)}`,
    "STATUS:TENTATIVE",
  ];
  const timed = !input.allDay && parseLocalDateTime(input.startLocal);
  if (timed) {
    lines.push(`DTSTART;TZID=${timezone}:${timed}`);
  } else {
    const day = parseLocalDate(input.dateLocal ?? input.startLocal?.slice(0, 10) ?? null);
    if (!day) return null;
    lines.push(`DTSTART;VALUE=DATE:${day}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(day)}`); // DTEND is exclusive for all-day events
  }
  lines.push(`SUMMARY:${escapeText(input.title)}`);
  if (input.locationLabel) lines.push(`LOCATION:${escapeText(input.locationLabel)}`);
  if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  const url = safeUrl(input.url);
  if (url) lines.push(`URL:${url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function calendarFilename(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "taste-engine-event"}.ics`;
}

// Formats "YYYY-MM-DDTHH:MM[:SS]" wall time as YYYYMMDDTHHMMSS. The string's
// own components are used directly; passing it through `new Date()` would
// reinterpret it in the runtime timezone and can shift the hour.
function parseLocalDateTime(value: string | null | undefined): string | null {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6] ?? "00"}`;
}

function parseLocalDate(value: string | null): string | null {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

function nextDay(yyyymmdd: string): string {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function utcStamp(now: Date): string {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function sanitizeUid(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "event";
}

function escapeText(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function safeUrl(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(text)) return null;
  return text;
}

// RFC 5545 3.1: lines longer than 75 octets fold onto a continuation line
// beginning with one space. Folding counts UTF-8 octets, and a multibyte
// character is never split across the boundary.
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  let limit = 75;
  for (const char of line) {
    const octets = encoder.encode(char).length;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = " ";
      currentOctets = 1;
      limit = 75;
    }
    current += char;
    currentOctets += octets;
  }
  if (current) parts.push(current);
  return parts.join("\r\n");
}
