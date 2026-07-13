import {
  containsUnsupportedModelClaim,
  promptFieldManifest,
  sanitizeErrorMessage,
  sanitizePromptContext
} from './diagnostics.js';

const PASS_DEFINITIONS = {
  personalFit: {
    instruction: 'Assess personal fit from taste evidence only. Do not infer artist identity. evidenceOrigin says how the candidate was discovered: treat source (direct playlist evidence) as strongest, similar as medium, and tag or promoter discovery as exploratory. evidenceStrength is the deterministic 0-100 fit already computed from that evidence. Ground the explanation in these supplied signals; never answer that information is missing. Never claim scarcity, sellout, limited availability, or access loss.',
    fields: {
      score: { type: 'integer', minimum: 0, maximum: 100 },
      label: { type: 'string', enum: ['strong fit', 'possible fit', 'exploratory', 'weak fit'] },
      explanation: { type: 'string', maxLength: 180 }
    },
    input: (item) => serializeModelFields(item, ['ref', 'eventType', 'daysUntil', 'pinned', 'evidenceOrigin', 'evidenceStrength'])
  },
  recommendation: {
    instruction: 'Give a selective recommendation from the supplied evidence: evidenceOrigin (source is direct playlist evidence, similar is medium, tag or promoter is exploratory), evidenceStrength (deterministic 0-100 fit), timing, and event type. It is valid to recommend skipping, but justify the verdict from these signals; never answer that information is missing. Do not invent event facts or use scarcity, sellout, limited-availability, or access-loss claims.',
    fields: {
      verdict: { type: 'string', enum: ['prioritize', 'consider', 'watch', 'skip'] },
      explanation: { type: 'string', maxLength: 180 }
    },
    input: (item) => serializeModelFields(item, ['ref', 'eventType', 'daysUntil', 'pinned', 'evidenceOrigin', 'evidenceStrength'])
  },
  urgency: {
    instruction: 'Review the deterministic urgency label and timing. Return an advisory urgency, never invent inventory or prices. Never claim scarcity, sellout, limited availability, or access loss; if evidence is absent, say it is safe to wait or unknown. Only the supplied non-restricted candidates are eligible.',
    fields: {
      label: { type: 'string', enum: ['buy now', 'watch', 'safe to wait', 'unknown'] },
      explanation: { type: 'string', maxLength: 180 }
    },
    input: (item) => serializeModelFields(item, ['ref', 'eventType', 'daysUntil', 'deterministicUrgency'])
  },
  hassle: {
    instruction: 'Review the deterministic hassle score using only the supplied non-restricted features. Do not invent travel, venue, price, or schedule facts, and never use scarcity, sellout, limited-availability, or access-loss language.',
    fields: {
      score: { type: 'integer', minimum: 0, maximum: 10 },
      explanation: { type: 'string', maxLength: 180 }
    },
    input: (item) => serializeModelFields(item, ['ref', 'eventType', 'daysUntil', 'deterministicHassle'])
  }
};

const SPORTS_PASS_DEFINITIONS = {
  personalFit: {
    instruction: 'Assess the personal value of a Dodgers home game from the supplied MLB context and personal preferences. The Dodgers affinity is already deterministic; explain the incremental appeal of the opponent, rivalry, pitching, leverage, and timing without inventing facts.',
    fields: {
      score: { type: 'integer', minimum: 0, maximum: 100 },
      label: { type: 'string', enum: ['strong fit', 'possible fit', 'exploratory', 'weak fit'] },
      explanation: { type: 'string', maxLength: 180 }
    },
    input: (item) => pick(item, ['ref', 'daysUntil', 'opponentQuality', 'rivalryTier', 'pitchingScore', 'leverageScore', 'convenienceScore', 'deterministicInterest', 'confidence'])
  },
  recommendation: {
    instruction: 'Give a selective recommendation for a Dodgers home game from the supplied MLB context. It is valid to recommend skipping. Do not invent ticket, schedule, standings, or pitcher facts.',
    fields: {
      verdict: { type: 'string', enum: ['prioritize', 'consider', 'watch', 'skip'] },
      explanation: { type: 'string', maxLength: 180 }
    },
    input: (item) => pick(item, ['ref', 'daysUntil', 'opponentQuality', 'rivalryTier', 'pitchingScore', 'leverageScore', 'convenienceScore', 'deterministicInterest', 'confidence'])
  },
  urgency: {
    instruction: 'Review only the deterministic ticket urgency label and timing. Never infer inventory, scarcity, prices, sellout risk, or access loss. Unknown ticket coverage must remain unknown.',
    fields: {
      label: { type: 'string', enum: ['buy now', 'watch', 'safe to wait', 'unknown'] },
      explanation: { type: 'string', maxLength: 180 }
    },
    input: (item) => pick(item, ['ref', 'daysUntil', 'deterministicUrgency', 'confidence'])
  },
  hassle: {
    instruction: 'Review the deterministic hassle score using only timing and normalized logistics signals. Do not invent travel, venue, price, ticket, or schedule facts.',
    fields: {
      score: { type: 'integer', minimum: 0, maximum: 10 },
      explanation: { type: 'string', maxLength: 180 }
    },
    input: (item) => pick(item, ['ref', 'daysUntil', 'deterministicHassle', 'confidence'])
  }
};

export async function enhanceEventsWithOllama(events, personalContext, {
  baseUrl = 'http://127.0.0.1:11434',
  model = 'gemma4:26b-mlx',
  timeoutMs = 180_000,
  fetchImpl = fetch,
  now = new Date(),
  requiredIds = []
} = {}) {
  const safePersonalContext = sanitizePromptContext(personalContext);
  const required = new Set(requiredIds);
  const requiredEvents = events.filter((event) => required.has(event.id));
  const remaining = [...events]
    .filter((event) => !required.has(event.id))
    .sort((a, b) => String(a.startLocal).localeCompare(String(b.startLocal)) || b.ranking.utility - a.ranking.utility)
    .slice(0, Math.max(0, (personalContext.maxEnhancedEvents ?? 16) - requiredEvents.length));
  const selected = [...requiredEvents, ...remaining];
  const refToId = new Map();
  const vectors = selected.map((event, index) => {
    const ref = `candidate-${index + 1}`;
    refToId.set(ref, event.id);
    const sources = new Set((event.sourceOccurrences ?? []).map((occurrence) => occurrence.source));
    const primaryArtist = (event.matchedArtists ?? []).find((artist) => artist.primary) ?? (event.matchedArtists ?? [])[0];
    return {
      ref,
      eventType: classifyEventType(event),
      daysUntil: daysUntil(event.startLocal, now),
      pinned: event.ranking.pinnedBonus > 0,
      // Derived taste evidence only: discovery origin plus the deterministic
      // fit score. No artist identity and no raw Spotify payload fields.
      evidenceOrigin: primaryArtist?.origin ?? 'source',
      evidenceStrength: event.ranking.artistFit ?? 0,
      deterministicUrgency: event.ranking.urgency,
      deterministicHassle: event.ranking.hassleScore,
      // SeatGeek-only payloads stay out of the model. A candidate with a
      // matching Ticketmaster occurrence can use the Ticketmaster-backed
      // normalized features for the advisory passes without sending raw
      // third-party payload fields.
      restrictedSource: sources.has('seatgeek') && !sources.has('ticketmaster')
    };
  });
  const byId = new Map(selected.map((event) => [event.id, {}]));
  const passes = {};
  let callsAttempted = 0;
  let callsCompleted = 0;

  for (const [name, definition] of Object.entries(PASS_DEFINITIONS)) {
    const eligible = (name === 'urgency' || name === 'hassle')
      ? vectors.filter((item) => !item.restrictedSource)
      : vectors;
    if (!eligible.length) {
      passes[name] = { status: 'deterministic fallback', itemCount: 0 };
      continue;
    }
    try {
      // Recommendation prose is the largest pass. Keep requests small enough
      // that the structured response cannot be truncated before every ref is
      // returned by the local model.
      const batchSize = name === 'recommendation' ? 6 : eligible.length;
      const results = [];
      for (const batch of chunk(eligible, batchSize)) {
        callsAttempted += 1;
        results.push(await callOllamaPass({
          baseUrl,
          model,
          timeoutMs,
          fetchImpl,
          personalContext: safePersonalContext,
          definition,
          items: batch.map(definition.input)
        }));
        callsCompleted += 1;
      }
      const result = { items: results.flatMap((batch) => batch.items) };
      for (const item of result.items) {
        const id = refToId.get(item.ref);
        if (id && byId.has(id)) byId.get(id)[name] = omitRef(item);
      }
      const uniqueRefs = new Set(result.items.map((item) => item.ref).filter((ref) => refToId.has(ref)));
      const missingCount = Math.max(0, eligible.length - uniqueRefs.size);
      passes[name] = {
        status: missingCount ? 'partial local enhancement' : 'locally enhanced',
        itemCount: uniqueRefs.size,
        missingCount
      };
    } catch (error) {
      passes[name] = { status: `fallback: ${sanitizeErrorMessage(error)}`, itemCount: 0 };
    }
  }

  const activePasses = Object.values(passes).filter((pass) => pass.status === 'locally enhanced').length;
  const partialPasses = Object.values(passes).filter((pass) => pass.status === 'partial local enhancement').length;
  return {
    mode: activePasses === 4 ? 'ollama' : activePasses + partialPasses > 0 ? 'partial' : 'deterministic',
    model: activePasses + partialPasses ? model : null,
    enhancedEventCount: [...byId.values()].filter((value) => Object.keys(value).length).length,
    passes,
    callsAttempted,
    callsCompleted,
    inputFieldManifest: promptFieldManifest({
      personalContext: safePersonalContext,
      candidates: Object.values(PASS_DEFINITIONS).map((definition) => definition.input(vectors[0] ?? { ref: 'candidate-1' }))
    }),
    byId
  };
}

export async function enhanceSportsWithOllama(games, personalContext, {
  baseUrl = 'http://127.0.0.1:11434',
  model = 'gemma4:26b-mlx',
  timeoutMs = 180_000,
  fetchImpl = fetch,
  now = new Date(),
  requiredIds = []
} = {}) {
  const safePersonalContext = sanitizePromptContext(personalContext);
  const required = new Set(requiredIds);
  const requiredGames = games.filter((game) => required.has(game.id));
  const remaining = [...games]
    .filter((game) => !required.has(game.id))
    .sort((a, b) => String(a.startLocal).localeCompare(String(b.startLocal)) || (b.ranking?.utility ?? 0) - (a.ranking?.utility ?? 0))
    .slice(0, Math.max(0, (personalContext.maxEnhancedSports ?? 12) - requiredGames.length));
  const selected = [...requiredGames, ...remaining];
  const refToId = new Map();
  const vectors = selected.map((game, index) => {
    const ref = `sports-${index + 1}`;
    refToId.set(ref, game.id);
    return {
      ref,
      daysUntil: daysUntil(game.startLocal, now),
      opponentQuality: game.ranking?.opponentQuality ?? 0,
      rivalryTier: game.sportsContext?.rivalryTier ?? 'none',
      pitchingScore: game.ranking?.pitchingScore ?? 0,
      leverageScore: game.ranking?.leverageScore ?? 0,
      convenienceScore: game.ranking?.convenienceScore ?? 0,
      deterministicInterest: game.ranking?.interestScore ?? 0,
      deterministicUrgency: game.ranking?.urgency ?? 'unknown',
      deterministicHassle: game.ranking?.hassleScore ?? 0,
      confidence: game.ranking?.confidence ?? 'unknown'
    };
  });
  const byId = new Map(selected.map((game) => [game.id, {}]));
  const passes = {};
  let callsAttempted = 0;
  let callsCompleted = 0;
  for (const [name, definition] of Object.entries(SPORTS_PASS_DEFINITIONS)) {
    try {
      const batchSize = name === 'recommendation' ? 6 : vectors.length;
      const results = [];
      for (const batch of chunk(vectors, batchSize)) {
        callsAttempted += 1;
        results.push(await callOllamaPass({
          baseUrl,
          model,
          timeoutMs,
          fetchImpl,
          personalContext: safePersonalContext,
          definition,
          items: batch.map(definition.input),
          roleDescription: 'You are a private local sports advisory layer.'
        }));
        callsCompleted += 1;
      }
      const result = { items: results.flatMap((batch) => batch.items) };
      for (const item of result.items) {
        const id = refToId.get(item.ref);
        if (id && byId.has(id)) byId.get(id)[name] = omitRef(item);
      }
      const uniqueRefs = new Set(result.items.map((item) => item.ref).filter((ref) => refToId.has(ref)));
      const missingCount = Math.max(0, vectors.length - uniqueRefs.size);
      passes[name] = { status: missingCount ? 'partial local enhancement' : 'locally enhanced', itemCount: uniqueRefs.size, missingCount };
    } catch (error) {
      passes[name] = { status: `fallback: ${sanitizeErrorMessage(error)}`, itemCount: 0 };
    }
  }
  const activePasses = Object.values(passes).filter((pass) => pass.status === 'locally enhanced').length;
  const partialPasses = Object.values(passes).filter((pass) => pass.status === 'partial local enhancement').length;
  return {
    mode: activePasses === 4 ? 'ollama' : activePasses + partialPasses > 0 ? 'partial' : 'deterministic',
    model: activePasses + partialPasses ? model : null,
    enhancedGameCount: [...byId.values()].filter((value) => Object.keys(value).length).length,
    passes,
    callsAttempted,
    callsCompleted,
    inputFieldManifest: promptFieldManifest({
      personalContext: safePersonalContext,
      candidates: Object.values(SPORTS_PASS_DEFINITIONS).map((definition) => definition.input(vectors[0] ?? { ref: 'sports-1' }))
    }),
    byId
  };
}

export function classifyEventType(event) {
  const title = String(event.title ?? '').toLowerCase();
  if (title.includes('festival') || (event.performers?.length ?? 0) >= 6) return 'festival';
  if (title.includes('dj set') || title.includes('open to close')) return 'dj set';
  return 'concert';
}

async function callOllamaPass({ baseUrl, model, timeoutMs, fetchImpl, personalContext, definition, items, roleDescription = 'You are a private local advisory layer.' }) {
  const itemProperties = { ref: { type: 'string' }, ...definition.fields };
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: itemProperties,
          required: Object.keys(itemProperties)
        }
      }
    },
    required: ['items']
  };
  const response = await fetchImpl(new URL('/api/chat', `${String(baseUrl).replace(/\/$/, '')}/`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: '10m',
      format: schema,
      options: { temperature: 0, num_predict: 1200 },
      messages: [
        {
          role: 'system',
          content: `${roleDescription} ${definition.instruction} Never invent identities or facts. Do not imply that a ticket will sell out, disappear, become unavailable, or require immediate action unless the supplied deterministic label explicitly says buy now; even then, describe it only as an advisory label, not as evidence. Return exactly one item for every supplied candidate ref; do not omit, merge, or invent refs. Return only JSON matching this schema: ${JSON.stringify(schema)}`
        },
        {
          role: 'user',
          content: JSON.stringify({
            personalContext: {
              background: personalContext.background ?? [],
              decisionPreferences: personalContext.decisionPreferences ?? []
            },
            candidates: items
          })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`Ollama request failed (${response.status})`);
  const body = await response.json();
  const content = String(body.message?.content ?? '').trim();
  if (!content) throw new Error('Ollama returned no content');
  const parsed = JSON.parse(content.startsWith('```') ? content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : content);
  if (!Array.isArray(parsed.items)) throw new Error('Ollama output failed schema validation');
  const expectedRefs = new Set(items.map((item) => item.ref));
  const seenRefs = new Set();
  const normalized = [];
  for (const item of parsed.items) {
    if (!item || typeof item.ref !== 'string' || !expectedRefs.has(item.ref)) continue;
    if (seenRefs.has(item.ref)) throw new Error('Ollama output repeated a candidate ref');
    seenRefs.add(item.ref);
    const validated = validatePassItem(item, definition);
    if (isNoInformationAdvisory(validated)) continue;
    normalized.push(validated);
  }
  return { items: normalized };
}

// Advisories that only complain about missing input add nothing over the
// deterministic scores and contradict them on the page; treat them as absent.
const NO_INFORMATION_PATTERN = /\b(cannot|can't|impossible to|unable to|insufficient|no specific|not enough|lack(?:s|ing)? (?:of )?(?:artist|venue|genre|presentation|specific)|not provided|no .{0,24}(?:data|detail|information)s? provided)\b/i;

export function isNoInformationAdvisory(item) {
  return typeof item?.explanation === 'string' && NO_INFORMATION_PATTERN.test(item.explanation);
}

function validatePassItem(item, definition) {
  const allowed = new Set(Object.keys(definition.fields));
  for (const key of Object.keys(item)) {
    if (key !== 'ref' && !allowed.has(key)) throw new Error('Ollama output attempted to add an unsupported field');
  }
  const output = { ref: item.ref };
  for (const [key, schema] of Object.entries(definition.fields)) {
    const value = item[key];
    if (value == null) throw new Error(`Ollama output omitted ${key}`);
    if (schema.type === 'string') {
      if (typeof value !== 'string' || value.length > (schema.maxLength ?? Infinity)) throw new Error(`Ollama output has invalid ${key}`);
      if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`Ollama output has invalid ${key}`);
    } else if (schema.type === 'integer') {
      if (!Number.isInteger(value) || value < schema.minimum || value > schema.maximum) throw new Error(`Ollama output has invalid ${key}`);
    }
    output[key] = value;
  }
  if (containsUnsupportedModelClaim(output)) throw new Error('Ollama output made an unsupported scarcity claim');
  return output;
}

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

function serializeModelFields(object, keys) {
  return Object.fromEntries(keys
    .filter((key) => Object.prototype.hasOwnProperty.call(object, key))
    .map((key) => [key, object[key]]));
}

function omitRef(item) {
  const { ref: _ref, ...value } = item;
  return value;
}

function daysUntil(startLocal, now) {
  const start = new Date(startLocal);
  return Number.isNaN(start.getTime()) ? null : Math.max(0, Math.ceil((start.getTime() - now.getTime()) / 86_400_000));
}

function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}
