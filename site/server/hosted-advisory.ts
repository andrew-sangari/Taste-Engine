import { ollamaCloudStatus, runOllamaCloudStructuredPass } from "./ollama-cloud.ts";

type AdvisoryItem = Record<string, unknown> & { id: string };
type AdvisoryResult = {
  mode: "ollama" | "partial" | "deterministic";
  model: string | null;
  enhancedCount: number;
  callsAttempted: number;
  callsCompleted: number;
  passes: Record<string, { status: string; itemCount: number; missingCount: number }>;
  byId: Map<string, Record<string, unknown>>;
};

const UNSUPPORTED_CLAIM = /\b(?:sell[ -]?out|scarcity|limited availability|access loss|loss of access|will disappear|tickets? (?:disappear|vanish)|become unavailable)\b/i;

const MUSIC_PASSES = {
  personalFit: {
    instruction: "Assess contextual personal fit. Missing artist, genre, or lineup detail is uncertainty, never negative evidence.",
    fields: {
      score: { type: "integer", minimum: 0, maximum: 100 },
      label: { type: "string", enum: ["strong fit", "possible fit", "exploratory", "weak fit"] },
      explanation: { type: "string", maxLength: 180 },
    },
  },
  recommendation: {
    instruction: "Give a selective advisory recommendation. Use skip only for a supplied concrete negative such as excessive friction or poor timing.",
    fields: {
      verdict: { type: "string", enum: ["prioritize", "consider", "watch", "skip"] },
      explanation: { type: "string", maxLength: 180 },
    },
  },
  urgency: {
    instruction: "Review only the supplied deterministic urgency and timing. Do not infer inventory, price movement, or availability.",
    fields: {
      label: { type: "string", enum: ["buy now", "watch", "safe to wait", "unknown"] },
      explanation: { type: "string", maxLength: 180 },
    },
  },
  hassle: {
    instruction: "Review only the supplied deterministic hassle features. Do not invent travel, venue, price, or schedule facts.",
    fields: {
      score: { type: "integer", minimum: 0, maximum: 10 },
      explanation: { type: "string", maxLength: 180 },
    },
  },
} as const;

const SPORTS_PASSES = {
  personalFit: MUSIC_PASSES.personalFit,
  recommendation: MUSIC_PASSES.recommendation,
  urgency: MUSIC_PASSES.urgency,
  hassle: MUSIC_PASSES.hassle,
} as const;

export async function enhanceHostedMusic(
  events: AdvisoryItem[],
  personalContext: Record<string, unknown>,
  requiredIds: string[],
): Promise<AdvisoryResult> {
  const selected = prioritized(events, requiredIds, positive(personalContext.maxEnhancedEvents, 16));
  const vectors = selected.map((event, index) => buildHostedMusicVector(event, index));
  return runPasses({
    selected,
    vectors,
    definitions: MUSIC_PASSES,
    personalContext,
    role: "private music advisory layer",
    eligible: (pass, vector) => !["urgency", "hassle"].includes(pass) || vector.restrictedSource !== true,
    normalize: normalizeMusicAdvisory,
  });
}

export async function enhanceHostedSports(
  games: AdvisoryItem[],
  personalContext: Record<string, unknown>,
  requiredIds: string[],
): Promise<AdvisoryResult> {
  const selected = prioritized(games, requiredIds, positive(personalContext.maxEnhancedSports, 12));
  const vectors = selected.map((game, index) => sportsVector(game, index));
  return runPasses({
    selected,
    vectors,
    definitions: SPORTS_PASSES,
    personalContext,
    role: "private sports advisory layer",
    eligible: () => true,
  });
}

export async function generateHostedEditorial(
  projection: Record<string, unknown>,
  personalContext: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fallback = deterministicEditorial(projection);
  if (!ollamaCloudStatus().configured) return fallback;
  const namedCandidates = editorialCandidates(projection);
  const allowedRefs = new Set(namedCandidates.map((candidate) => String(candidate.ref)));
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string", maxLength: 90 },
      verdict: { type: "string", enum: ["go out", "maybe", "do not waste your time"] },
      lead: { type: "string", maxLength: 520 },
      decisionNotes: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
      skipCall: { type: "string", maxLength: 180 },
      caution: { type: "string", maxLength: 220 },
      mentions: { type: "array", maxItems: 3, items: { type: "string" } },
    },
    required: ["headline", "verdict", "lead", "decisionNotes", "skipCall", "caution", "mentions"],
  };
  try {
    const output = await runOllamaCloudStructuredPass<Record<string, unknown>>({
      system: "You are the optional editorial layer for a private personal decision engine. Lead with the next 7–14 days and music, then add sports selectively. Movies stay separate. Name only candidates supplied in namedCandidates and put only their refs in mentions. Never invent facts, prices, formats, ticket availability, scarcity, or reasons to act. Do not alter ordering, scores, membership, or source health. A valid verdict may be do not waste your time.",
      user: {
        generatedAt: projection.generatedAt,
        horizon: projection.horizon,
        counts: {
          music: array(projection.events).length,
          sports: array(projection.sports).length,
          movies: array(projection.movies).length,
        },
        overview: array(projection.overview).map((item) => ({
          ref: record(item).id,
          vertical: record(item).vertical,
          startLocal: record(item).startLocal,
        })),
        namedCandidates,
        personalContext: safePersonalContext(personalContext),
        sourceHealth: array(projection.sourceHealth).map((item) => ({
          source: record(item).source,
          status: record(item).status,
          itemCount: record(item).itemCount,
        })),
      },
      schema,
    });
    validateEditorial(output, allowedRefs);
    return {
      mode: "ollama",
      status: "cloud enhanced",
      model: ollamaCloudStatus().model,
      generatedAt: new Date().toISOString(),
      ...output,
    };
  } catch {
    return fallback;
  }
}

async function runPasses({
  selected,
  vectors,
  definitions,
  personalContext,
  role,
  eligible,
  normalize,
}: {
  selected: AdvisoryItem[];
  vectors: Array<Record<string, unknown> & { ref: string }>;
  definitions: typeof MUSIC_PASSES;
  personalContext: Record<string, unknown>;
  role: string;
  eligible: (pass: string, vector: Record<string, unknown>) => boolean;
  normalize?: (pass: string, value: Record<string, unknown>, item: AdvisoryItem) => Record<string, unknown>;
}): Promise<AdvisoryResult> {
  const byId = new Map(selected.map((item) => [item.id, {} as Record<string, unknown>]));
  const refToItem = new Map(vectors.map((vector, index) => [vector.ref, selected[index]]));
  const passes: AdvisoryResult["passes"] = {};
  let callsAttempted = 0;
  let callsCompleted = 0;
  if (!ollamaCloudStatus().configured || !selected.length) {
    for (const name of Object.keys(definitions)) {
      passes[name] = { status: "deterministic fallback", itemCount: 0, missingCount: selected.length };
    }
    return {
      mode: "deterministic",
      model: null,
      enhancedCount: 0,
      callsAttempted,
      callsCompleted,
      passes,
      byId,
    };
  }
  for (const [name, definition] of Object.entries(definitions)) {
    const candidates = vectors.filter((vector) => eligible(name, vector));
    if (!candidates.length) {
      passes[name] = { status: "deterministic fallback", itemCount: 0, missingCount: 0 };
      continue;
    }
    const schema = passSchema(definition.fields);
    try {
      const outputItems: Record<string, unknown>[] = [];
      const batchSize = name === "recommendation" ? 6 : 16;
      for (const batch of chunks(candidates, batchSize)) {
        callsAttempted += 1;
        const result = await runOllamaCloudStructuredPass<{ items: Record<string, unknown>[] }>({
          system: `You are a ${role}. ${definition.instruction} Never invent identities or facts. Never claim scarcity, sellout, limited availability, access loss, or tickets disappearing. Return exactly one item for every supplied ref and only JSON matching the schema.`,
          user: {
            personalContext: safePersonalContext(personalContext),
            candidates: batch.map((candidate) => fieldsForPass(name, candidate)),
          },
          schema,
          temperature: 0,
          maxTokens: 1200,
        });
        const validated = validatePassItems(result.items, batch, definition.fields);
        outputItems.push(...validated);
        callsCompleted += 1;
      }
      for (const item of outputItems) {
        const ref = String(item.ref);
        const source = refToItem.get(ref);
        if (!source) continue;
        const value = { ...item };
        delete value.ref;
        byId.get(source.id)![name] = normalize ? normalize(name, value, source) : value;
      }
      const uniqueRefs = new Set(outputItems.map((item) => String(item.ref)));
      const missingCount = Math.max(0, candidates.length - uniqueRefs.size);
      passes[name] = {
        status: missingCount ? "partial cloud enhancement" : "cloud enhanced",
        itemCount: uniqueRefs.size,
        missingCount,
      };
    } catch {
      passes[name] = { status: "deterministic fallback", itemCount: 0, missingCount: candidates.length };
    }
  }
  const active = Object.values(passes).filter((pass) => pass.status === "cloud enhanced").length;
  const partial = Object.values(passes).filter((pass) => pass.status === "partial cloud enhancement").length;
  return {
    mode: active === 4 ? "ollama" : active + partial ? "partial" : "deterministic",
    model: active + partial ? ollamaCloudStatus().model : null,
    enhancedCount: [...byId.values()].filter((value) => Object.keys(value).length).length,
    callsAttempted,
    callsCompleted,
    passes,
    byId,
  };
}

export function buildHostedMusicVector(event: AdvisoryItem, index: number): Record<string, unknown> & { ref: string } {
  const occurrences = array(event.sourceOccurrences).map(record);
  const sources = new Set(occurrences.map((occurrence) => String(occurrence.source ?? "")));
  const allowed = occurrences.find((occurrence) => ["ticketmaster", "framework", "insomniac"].includes(String(occurrence.source)));
  const ranking = record(event.ranking);
  const start = new Date(String(event.startLocal ?? ""));
  return {
    ref: `candidate-${index + 1}`,
    eventType: classifyEventType(event),
    daysUntil: daysUntil(event.startLocal),
    dayOfWeek: Number.isNaN(start.getTime()) ? "unknown" : start.toLocaleDateString("en-US", { weekday: "long" }),
    startPeriod: startPeriod(start, event.timeTbd === true),
    providerContext: allowed?.source ?? null,
    eventTitle: allowed?.title ?? null,
    venueName: record(allowed?.venue).name ?? null,
    city: record(allowed?.venue).city ?? null,
    namedPerformerCount: array(allowed?.performerNames).length,
    adjacentEvidence: [...new Set(array(event.matchedArtists)
      .map((item) => String(record(item).origin ?? ""))
      .filter((origin) => ["similar", "tag", "promoter"].includes(origin)))],
    pinned: Number(ranking.pinnedBonus ?? 0) > 0,
    deterministicUrgency: ranking.urgency ?? "unknown",
    deterministicHassle: ranking.hassleScore ?? 0,
    deterministicFit: ranking.artistFit ?? 0,
    deterministicUtility: ranking.utility ?? 0,
    restrictedSource: sources.has("seatgeek") && !sources.has("ticketmaster"),
  };
}

function sportsVector(game: AdvisoryItem, index: number): Record<string, unknown> & { ref: string } {
  const ranking = record(game.ranking);
  const context = record(game.sportsContext);
  return {
    ref: `sports-${index + 1}`,
    daysUntil: daysUntil(game.startLocal),
    opponentQuality: ranking.opponentQuality ?? 0,
    rivalryTier: context.rivalryTier ?? "none",
    pitchingScore: ranking.pitchingScore ?? 0,
    leverageScore: ranking.leverageScore ?? 0,
    convenienceScore: ranking.convenienceScore ?? 0,
    deterministicInterest: ranking.interestScore ?? 0,
    deterministicUrgency: ranking.urgency ?? "unknown",
    deterministicHassle: ranking.hassleScore ?? 0,
    confidence: ranking.confidence ?? "unknown",
  };
}

function fieldsForPass(name: string, candidate: Record<string, unknown>): Record<string, unknown> {
  const common = ["ref", "daysUntil"];
  const keys = name === "personalFit"
    ? [...common, "eventType", "dayOfWeek", "startPeriod", "providerContext", "eventTitle", "venueName", "city", "namedPerformerCount", "adjacentEvidence", "pinned", "deterministicFit", "opponentQuality", "rivalryTier", "pitchingScore", "leverageScore", "confidence"]
    : name === "recommendation"
      ? [...common, "eventType", "dayOfWeek", "startPeriod", "providerContext", "eventTitle", "venueName", "city", "namedPerformerCount", "adjacentEvidence", "pinned", "deterministicUrgency", "deterministicHassle", "deterministicUtility", "deterministicInterest", "opponentQuality", "rivalryTier", "pitchingScore", "leverageScore", "convenienceScore", "confidence"]
      : name === "urgency"
        ? [...common, "eventType", "startPeriod", "deterministicUrgency"]
        : [...common, "eventType", "dayOfWeek", "startPeriod", "city", "deterministicHassle"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(candidate, key)).map((key) => [key, candidate[key]]));
}

function passSchema(fields: Record<string, unknown>) {
  const properties = { ref: { type: "string" }, ...fields };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties,
          required: Object.keys(properties),
        },
      },
    },
    required: ["items"],
  };
}

function validatePassItems(
  items: unknown,
  candidates: Array<Record<string, unknown> & { ref: string }>,
  fields: Record<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  if (!Array.isArray(items)) throw new Error("Invalid advisory output.");
  const expected = new Set(candidates.map((candidate) => candidate.ref));
  const seen = new Set<string>();
  const output: Record<string, unknown>[] = [];
  for (const item of items) {
    const value = record(item);
    const ref = String(value.ref ?? "");
    if (!expected.has(ref) || seen.has(ref)) throw new Error("Invalid advisory reference.");
    const normalized: Record<string, unknown> = { ref };
    for (const [key, schema] of Object.entries(fields)) {
      const field = value[key];
      if (schema.type === "string") {
        if (typeof field !== "string" || field.length > Number(schema.maxLength ?? Infinity)) throw new Error("Invalid advisory string.");
        if (Array.isArray(schema.enum) && !schema.enum.includes(field)) throw new Error("Invalid advisory enum.");
      } else if (schema.type === "integer") {
        if (!Number.isInteger(field) || Number(field) < Number(schema.minimum) || Number(field) > Number(schema.maximum)) throw new Error("Invalid advisory number.");
      }
      normalized[key] = field;
    }
    if (UNSUPPORTED_CLAIM.test(JSON.stringify(normalized))) throw new Error("Unsupported advisory claim.");
    seen.add(ref);
    output.push(normalized);
  }
  return output;
}

function normalizeMusicAdvisory(
  pass: string,
  value: Record<string, unknown>,
  event: AdvisoryItem,
): Record<string, unknown> {
  if (pass === "recommendation" && value.verdict === "skip" && Number(record(event.ranking).hassleScore ?? 0) < 8) {
    return {
      verdict: Number(record(event.ranking).utility ?? 0) >= 45 ? "consider" : "watch",
      explanation: "Missing source-safe detail is treated as uncertainty; the deterministic ranking remains primary.",
    };
  }
  return value;
}

function validateEditorial(value: Record<string, unknown>, allowedRefs: Set<string>): void {
  if (!["go out", "maybe", "do not waste your time"].includes(String(value.verdict))) throw new Error("Invalid editorial verdict.");
  if (!Array.isArray(value.decisionNotes) || !Array.isArray(value.mentions)) throw new Error("Invalid editorial arrays.");
  if (array(value.mentions).some((ref) => !allowedRefs.has(String(ref)))) throw new Error("Invalid editorial mention.");
  if (UNSUPPORTED_CLAIM.test(JSON.stringify(value))) throw new Error("Unsupported editorial claim.");
}

function editorialCandidates(projection: Record<string, unknown>) {
  const music = array(projection.events).map(record).flatMap((event) => {
    const occurrence = array(event.sourceLinks).map(record)
      .find((link) => ["ticketmaster", "framework", "insomniac"].includes(String(link.source)));
    if (!occurrence) return [];
    return [{
      ref: event.id,
      vertical: "music",
      provenance: occurrence.source,
      title: event.title,
      startLocal: event.startLocal,
      venue: record(event.venue).name ?? null,
      urgency: record(event.ranking).urgency ?? "unknown",
      hassleScore: record(event.ranking).hassleScore ?? null,
    }];
  });
  const sports = array(projection.sports).map(record).slice(0, 8).map((game) => ({
    ref: game.id,
    vertical: "sports",
    provenance: "mlb",
    title: `${record(game.awayTeam).name ?? "Away"} at ${record(game.homeTeam).name ?? "Home"}`,
    startLocal: game.startLocal,
    venue: record(game.venue).name ?? null,
    urgency: record(game.ranking).urgency ?? "unknown",
    hassleScore: record(game.ranking).hassleScore ?? null,
  }));
  const movies = array(projection.movies).map(record).slice(0, 8).map((movie) => ({
    ref: movie.id,
    vertical: "movies",
    provenance: "tmdb",
    title: movie.title,
    startLocal: movie.releaseDate,
    venue: null,
    urgency: movie.urgency ?? "unknown",
    hassleScore: movie.hassle ?? null,
  }));
  return [...music, ...sports, ...movies].slice(0, 24);
}

function deterministicEditorial(projection: Record<string, unknown>): Record<string, unknown> {
  const events = array(projection.events);
  const sports = array(projection.sports);
  const direct = events.filter((event) => array(record(event).matchedArtists)
    .some((artist) => ["source", "top-items"].includes(String(record(artist).origin)))).length;
  const verdict = direct >= 5 || sports.length >= 3 ? "go out" : direct + events.length >= 3 ? "maybe" : "do not waste your time";
  return {
    mode: "deterministic",
    status: "deterministic fallback",
    warning: null,
    model: null,
    generatedAt: new Date().toISOString(),
    headline: verdict === "go out" ? "A few dates deserve your attention." : verdict === "maybe" ? "A watchlist, not a mandate." : "Nothing earns the trip yet.",
    verdict,
    lead: events.length || sports.length
      ? `The current horizon has ${events.length} ranked music dates and ${sports.length} Dodgers home games; the deterministic ranking remains the decision authority.`
      : "The current horizon is quiet enough that staying home remains a reasonable call.",
    decisionNotes: [
      `${events.length} music candidates cleared the deterministic publication filter.`,
      `${sports.length} Dodgers home games remain in a separate sports lane.`,
      `${array(projection.movies).length} movie candidates await independent format confirmation.`,
    ],
    skipCall: verdict === "do not waste your time" ? "Do not force a plan; the current evidence does not clear the personal-value bar." : "Skip anything that requires a weaker fit or unnecessary coordination.",
    caution: "Candidate identity, ordering, scores, and source health come only from the deterministic pipeline.",
    mentions: [],
  };
}

function prioritized(items: AdvisoryItem[], requiredIds: string[], limit: number): AdvisoryItem[] {
  const required = new Set(requiredIds);
  const first = items.filter((item) => required.has(item.id));
  const rest = items.filter((item) => !required.has(item.id))
    .sort((left, right) => String(left.startLocal ?? "").localeCompare(String(right.startLocal ?? ""))
      || Number(record(right.ranking).utility ?? 0) - Number(record(left.ranking).utility ?? 0));
  return [...first, ...rest.slice(0, Math.max(0, limit - first.length))];
}

function safePersonalContext(value: Record<string, unknown>): Record<string, string[]> {
  return {
    background: array(value.background).map(String).slice(0, 12),
    decisionPreferences: array(value.decisionPreferences).map(String).slice(0, 12),
  };
}

function classifyEventType(event: Record<string, unknown>): string {
  const title = String(event.title ?? "").toLowerCase();
  if (title.includes("festival") || array(event.performers).length >= 6) return "festival";
  if (title.includes("dj set") || title.includes("open to close")) return "dj set";
  return "concert";
}

function daysUntil(value: unknown): number | null {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

function startPeriod(date: Date, tbd: boolean): string {
  if (tbd || Number.isNaN(date.getTime())) return "unknown";
  return date.getHours() < 17 ? "afternoon" : date.getHours() < 22 ? "evening" : "late";
}

function positive(value: unknown, fallback: number): number {
  const output = Number(value);
  return Number.isInteger(output) && output > 0 ? output : fallback;
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
