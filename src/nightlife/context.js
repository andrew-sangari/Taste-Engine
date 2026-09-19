import { LA_AREAS } from './semanticInput.js';

export const TRANSPORT_MODES = ['drive', 'rideshare', 'transit', 'walk', 'bike'];
export const PARTY_MODES = ['solo', 'date', 'small group', 'large group'];
export const ENERGY_LEVELS = ['low', 'medium', 'high'];
export const LATE_NIGHT_INTENTS = ['home early', 'flexible', 'out late', 'out very late'];
export const NOVELTY_APPETITES = ['familiar', 'balanced', 'exploratory'];

export class NightlifeContextError extends Error {}

/**
 * Normalize an explicit user request. Nothing here is inferred from the device,
 * the calendar, or stored companions: an unstated dimension stays null and the
 * deterministic layer treats it as unconstrained rather than as a preference.
 */
export function normalizeNightlifeContext(input = {}, { now = new Date() } = {}) {
  const goal = text(input.goal, 400);
  const date = localDate(input.date) ?? localDateKey(now);
  const earliestStart = clock(input.earliestStart) ?? null;
  const latestReturn = clock(input.latestReturn) ?? null;
  if (earliestStart && latestReturn && !crossesMidnight(earliestStart, latestReturn) && earliestStart >= latestReturn) {
    throw new NightlifeContextError('The latest return must be after the earliest start.');
  }
  return {
    goal,
    window: { date, earliestStart, latestReturn },
    startArea: resolveStartArea(input.startArea),
    transport: oneOf(input.transport, TRANSPORT_MODES),
    budgetUsd: positiveNumber(input.budgetUsd),
    party: oneOf(input.party, PARTY_MODES),
    preferredMusic: list(input.preferredMusic, 8, 40),
    energy: oneOf(input.energy, ENERGY_LEVELS),
    lateNightIntent: oneOf(input.lateNightIntent, LATE_NIGHT_INTENTS),
    noveltyAppetite: oneOf(input.noveltyAppetite, NOVELTY_APPETITES),
    maxCandidates: boundedInteger(input.maxCandidates, 1, 60, 24),
    shortlistSize: boundedInteger(input.shortlistSize, 1, 10, 4)
  };
}

/**
 * A coarse, manually chosen starting area. A free-text area that matches no
 * known region keeps its label and contributes no geometry, so travel estimates
 * are simply absent rather than fabricated.
 */
export function resolveStartArea(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const label = text(value.label, 60);
    if (!label) return null;
    return {
      label,
      lat: Number.isFinite(value.lat) ? value.lat : null,
      lon: Number.isFinite(value.lon) ? value.lon : null
    };
  }
  const label = text(value, 60);
  if (!label) return null;
  const normalized = label.toLowerCase();
  const known = LA_AREAS.find((area) => area.label.toLowerCase().includes(normalized) || normalized.includes(area.label.toLowerCase().split(' / ')[0]));
  return known ? { label: known.label, lat: known.lat, lon: known.lon } : { label, lat: null, lon: null };
}

/** The window's absolute bounds, used by every deterministic feasibility check. */
export function windowBounds(context, { now = new Date() } = {}) {
  const date = context.window?.date ?? localDateKey(now);
  const start = new Date(`${date}T${context.window?.earliestStart ?? '17:00'}:00`);
  const endClock = context.window?.latestReturn ?? '02:30';
  const end = new Date(`${date}T${endClock}:00`);
  // A "latest return" before the start means the following morning, which is
  // the normal case for a night out.
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

export function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function crossesMidnight(earliest, latest) {
  return latest < '06:00' && earliest >= '12:00';
}

function localDate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function clock(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function text(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, max) : null;
}

function list(value, maxEntries, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry, maxLength)).filter(Boolean))].slice(0, maxEntries);
}

function oneOf(value, allowed) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
