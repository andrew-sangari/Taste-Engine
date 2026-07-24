import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarEvent, calendarFilename } from "../app/ics.ts";

const NOW = new Date("2026-07-13T18:00:00.000Z");

function timedEvent(overrides = {}) {
  return {
    uid: "seatgeek:123",
    title: "Prospa",
    startLocal: "2026-10-14T20:00:00",
    locationLabel: "Shrine Expo Hall · Los Angeles",
    description: "Prospa anchors two of your selected playlists.",
    url: "https://seatgeek.com/e/123",
    ...overrides,
  };
}

test("timed events carry TZID local wall time, tentative status, and no invented DTEND", () => {
  const ics = buildCalendarEvent(timedEvent(), { now: NOW });
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /PRODID:-\/\/Taste Engine\/\/Hold the Date\/\/EN\r\n/);
  assert.match(ics, /METHOD:PUBLISH\r\n/);
  assert.match(ics, /UID:seatgeek-123@taste-engine\r\n/);
  assert.match(ics, /DTSTAMP:20260713T180000Z\r\n/);
  assert.match(ics, /STATUS:TENTATIVE\r\n/);
  assert.match(ics, /DTSTART;TZID=America\/Los_Angeles:20261014T200000\r\n/);
  assert.doesNotMatch(ics, /DTEND/);
  assert.match(ics, /URL:https:\/\/seatgeek.com\/e\/123\r\n/);
  assert.ok(ics.endsWith("\r\n"));
  // The wall time must never be shifted through Date parsing.
  assert.doesNotMatch(ics, /20261015/);
});

test("all-day events use VALUE=DATE with exclusive next-day DTEND across month ends", () => {
  const ics = buildCalendarEvent({ uid: "tmdb:7", title: "The Odyssey", startLocal: null, dateLocal: "2026-07-31", allDay: true }, { now: NOW });
  assert.match(ics, /DTSTART;VALUE=DATE:20260731\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20260801\r\n/);
});

test("TBD-time events fall back to the local date as all-day", () => {
  const ics = buildCalendarEvent({ uid: "x", title: "Festival", startLocal: "2026-08-08", allDay: true }, { now: NOW });
  assert.match(ics, /DTSTART;VALUE=DATE:20260808\r\n/);
});

test("escapes commas, semicolons, backslashes, and newlines", () => {
  const ics = buildCalendarEvent(timedEvent({
    title: "A, B; C\\D",
    description: "line one\nline two",
  }), { now: NOW });
  assert.match(ics, /SUMMARY:A\\, B\\; C\\\\D\r\n/);
  assert.match(ics, /DESCRIPTION:line one\\nline two\r\n/);
});

test("folds long lines at 75 UTF-8 octets without splitting multibyte characters", () => {
  const title = "Ü".repeat(80); // 2 octets per character
  const ics = buildCalendarEvent(timedEvent({ title }), { now: NOW });
  const lines = ics.split("\r\n");
  const encoder = new TextEncoder();
  for (const line of lines) {
    assert.ok(encoder.encode(line).length <= 75, `line exceeds 75 octets: ${line.length} chars`);
  }
  const summaryStart = lines.findIndex((line) => line.startsWith("SUMMARY:"));
  assert.ok(lines[summaryStart + 1].startsWith(" "), "continuation lines begin with one space");
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes(`SUMMARY:${title}`), "unfolding restores the original text");
});

test("rejects non-http URLs and tolerates missing venue and url", () => {
  const ics = buildCalendarEvent(timedEvent({ url: "javascript:alert(1)", locationLabel: null, description: null }), { now: NOW });
  assert.doesNotMatch(ics, /URL:/);
  assert.doesNotMatch(ics, /LOCATION:/);
  assert.doesNotMatch(ics, /DESCRIPTION:/);
});

test("returns null when no usable date exists", () => {
  assert.equal(buildCalendarEvent({ uid: "x", title: "No date", startLocal: null }, { now: NOW }), null);
});

test("builds safe unicode-tolerant filenames", () => {
  assert.equal(calendarFilename("Prospa @ Shrine (21+)"), "Prospa-Shrine-21.ics");
  assert.equal(calendarFilename("···"), "taste-engine-event.ics");
});

test("parses as a calendar in a second parser (round-trip structure check)", () => {
  // Minimal structural parse: property names before the first colon on each
  // unfolded line must be well-formed, and the component nesting must balance.
  const ics = buildCalendarEvent(timedEvent({ title: "Ü".repeat(40) }), { now: NOW });
  const unfolded = ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
  const stack = [];
  for (const line of unfolded) {
    const [name] = line.split(/[:;]/, 1);
    assert.match(name, /^[A-Z-]+$/, `malformed property name in: ${line}`);
    if (line.startsWith("BEGIN:")) stack.push(line.slice(6));
    if (line.startsWith("END:")) assert.equal(stack.pop(), line.slice(4));
  }
  assert.equal(stack.length, 0);
});
