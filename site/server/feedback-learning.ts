// Hosted, deterministic feedback replay. It accepts only durable D1 records
// and attaches a small public audit summary; notes and raw preference evidence
// never leave the private record store.

const HALF_LIFE_DAYS = 180;
const CAPS = { artist: 4, venue: 2, series: 2, shape: 1, total: 8 } as const;
const ATTENDED = new Set(["attended-worth-it", "attended-not-worth-it"]);

type Candidate = Record<string, any>;
type SignalCategory = "artist" | "venue" | "series" | "shape";

export function applyHostedFeedbackAdjustments<T extends Candidate>(candidates: T[], records: Array<Record<string, unknown>>, now = new Date()) {
  const signals = deriveSignals(records, now);
  const audit = { policyVersion: 3, decayHalfLifeDays: HALF_LIFE_DAYS, eligibleSignalCount: signals.size, appliedCandidateCount: 0, totalAbsoluteAdjustment: 0 };
  const adjusted = candidates.map((candidate) => {
    const effects = candidateEffects(candidate, signals);
    const delta = clamp(effects.reduce((sum, effect) => sum + effect.delta, 0), -CAPS.total, CAPS.total);
    if (!delta || !candidate.ranking || candidate.ranking.excluded) return candidate;
    audit.appliedCandidateCount += 1;
    audit.totalAbsoluteAdjustment += Math.abs(delta);
    return {
      ...candidate,
      ranking: {
        ...candidate.ranking,
        utility: round(Number(candidate.ranking.utility ?? 0) + delta),
        feedbackAdjustment: {
          applied: true,
          scoreDelta: delta,
          categories: [...new Set(effects.map((effect) => effect.category))],
          supportingOutcomeCount: effects.reduce((sum, effect) => sum + effect.outcomeCount, 0),
          policyVersion: 3,
        },
      },
    };
  });
  return { candidates: adjusted, audit: { ...audit, totalAbsoluteAdjustment: round(audit.totalAbsoluteAdjustment) } };
}

export function applyHostedPersonalContext<T extends Candidate>(candidates: T[], records: Array<Record<string, unknown>>, now = new Date()) {
  const byShape = new Map<string, number>();
  for (const record of records) {
    const status = String(record.status ?? "");
    const reasons = Array.isArray(record.reasonCodes) ? record.reasonCodes.map(String) : [];
    if (!['wanted-to-attend', 'did-not-attend-logistical', 'lost-interest'].includes(status) || !reasons.some((reason) => ['timing', 'hassle', 'price', 'distance', 'availability', 'calendar'].includes(reason))) continue;
    const snapshot = object(record.evidenceSnapshot);
    const shape = String(snapshot.eventShape ?? "");
    if (!shape || decay(record.recordedAt, now) < .35) continue;
    byShape.set(shape, (byShape.get(shape) ?? 0) + 1);
  }
  return candidates.map((candidate) => {
    const shape = candidateShape(candidate);
    // Three explicit, recent logistics reports are the minimum to influence a
    // future planning obstacle. The adjustment is capped at one friction point.
    const personalContextFriction = (byShape.get(shape) ?? 0) >= 3 ? 1 : 0;
    return personalContextFriction ? { ...candidate, personalContextFriction } : candidate;
  });
}

function deriveSignals(records: Array<Record<string, unknown>>, now: Date) {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const record of records) {
    if (!ATTENDED.has(String(record.status ?? ""))) continue;
    const snapshot = object(record.evidenceSnapshot);
    const categories: Array<[SignalCategory, string[]]> = [
      ["artist", array(snapshot.canonicalArtistIds).map(String)],
      ["venue", snapshot.canonicalVenueId ? [String(snapshot.canonicalVenueId)] : []],
      ["series", array(snapshot.promoterOrSeriesIds).map(String)],
      ["shape", snapshot.eventShape ? [String(snapshot.eventShape)] : []],
    ];
    for (const [category, ids] of categories) for (const id of ids) {
      if (!id) continue;
      const key = `${category}:${id}`;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
  }
  const signals = new Map<string, { category: SignalCategory; delta: number; outcomeCount: number }>();
  for (const [key, group] of groups) {
    const eventIds = new Set(group.map((record) => String(record.canonicalEventId ?? "")).filter(Boolean));
    if (eventIds.size < 2) continue;
    let positive = 0;
    let negative = 0;
    for (const record of group) {
      const weight = decay(record.recordedAt, now);
      if (String(record.status) === "attended-worth-it") positive += weight;
      else negative += weight;
    }
    const total = positive + negative;
    const dominant = Math.max(positive, negative);
    if (!total || dominant / total < .75) continue;
    const [category] = key.split(":") as [SignalCategory];
    const cap = CAPS[category];
    signals.set(key, { category, delta: positive > negative ? cap : -cap, outcomeCount: eventIds.size });
  }
  return signals;
}

function candidateEffects(candidate: Candidate, signals: Map<string, { category: SignalCategory; delta: number; outcomeCount: number }>) {
  const venue = object(candidate.venue);
  const series = object(candidate.series);
  const ids: Array<[SignalCategory, string[]]> = [
    ["artist", array(candidate.matchedArtists).map((artist) => object(artist).spotifyArtistId).filter(Boolean).map(String)],
    ["venue", venue.sourceId ? [String(venue.sourceId)] : []],
    ["series", series.id ? [String(series.id)] : []],
    ["shape", [candidateShape(candidate)].filter(Boolean)],
  ];
  return ids.flatMap(([category, values]) => {
    const effects = values.map((value) => signals.get(`${category}:${value}`)).filter(Boolean) as Array<{ category: SignalCategory; delta: number; outcomeCount: number }>;
    // One entity per category prevents a multi-artist lineup from multiplying
    // a single category cap.
    return effects.length ? [effects.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0]] : [];
  });
}

function candidateShape(candidate: Candidate) { return String(candidate.eventType ?? (candidate.source === "mlb" ? "baseball" : "")); }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function decay(value: unknown, now: Date) { const timestamp = Date.parse(String(value)); const age = Number.isFinite(timestamp) ? Math.max(0, now.getTime() - timestamp) / 86_400_000 : Infinity; return 2 ** (-age / HALF_LIFE_DAYS); }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number) { return Math.round(value * 100) / 100; }
