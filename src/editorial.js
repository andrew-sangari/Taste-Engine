import { sanitizeErrorMessage, sanitizePromptContext } from './diagnostics.js';
import { localDateDifference, weekdayForLocalDate } from './localDate.js';

const VERDICTS = new Set(['go out', 'maybe', 'do not waste your time']);
const UNSUPPORTED_CLAIMS = /\b(?:sell[ -]?out|scarcity|limited availability|access loss|loss of access|will disappear|tickets? (?:disappear|vanish)|become unavailable)\b/i;
const EDITORIAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string', maxLength: 90 },
    verdict: { type: 'string', enum: ['go out', 'maybe', 'do not waste your time'] },
    lead: { type: 'string', maxLength: 520 },
    decisionNotes: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 180 } },
    skipCall: { type: 'string', maxLength: 180 },
    caution: { type: 'string', maxLength: 220 },
    mentions: { type: 'array', maxItems: 3, items: { type: 'string' } }
  },
  required: ['headline', 'verdict', 'lead', 'decisionNotes', 'skipCall', 'caution', 'mentions']
};

export function buildEditorialInput(projection, personalContext = {}) {
  const safePersonalContext = sanitizePromptContext(personalContext);
  const originCounts = {};
  const confidenceCounts = {};
  const urgencyCounts = {};
  const verticalCounts = { music: projection.events?.length ?? 0, movies: projection.movies?.length ?? 0, sports: projection.sports?.length ?? 0 };
  const now = new Date(projection.generatedAt ?? Date.now());
  const upcomingWindows = { next7Days: 0, next14Days: 0, next30Days: 0 };
  const next14 = { music: 0, sports: 0, movies: 0 };
  for (const event of projection.events ?? []) {
    const origins = new Set((event.matchedArtists ?? []).map((artist) => artist.origin ?? 'source'));
    for (const origin of origins) originCounts[origin] = (originCounts[origin] ?? 0) + 1;
    const confidence = event.ranking?.confidence ?? 'unknown';
    confidenceCounts[confidence] = (confidenceCounts[confidence] ?? 0) + 1;
    const urgency = event.ranking?.urgency ?? 'unknown';
    urgencyCounts[urgency] = (urgencyCounts[urgency] ?? 0) + 1;
    const days = daysFromNow(event.startLocal, now);
    if (days != null && days >= 0) {
      if (days <= 7) upcomingWindows.next7Days += 1;
      if (days <= 14) {
        upcomingWindows.next14Days += 1;
        next14.music += 1;
      }
      if (days <= 30) upcomingWindows.next30Days += 1;
    }
  }
  for (const game of projection.sports ?? []) {
    const days = daysFromNow(game.startLocal, now);
    if (days != null && days <= 14 && days >= 0) next14.sports += 1;
  }
  for (const movie of projection.movies ?? []) {
    const days = daysFromNow(movie.releaseDate, now);
    if (days != null && days <= 14 && days >= 0) next14.movies += 1;
  }

  const overviewRefs = new Set((projection.overview ?? []).map((candidate) => candidate.id));
  const allNamedCandidates = (projection.editorialCandidates ?? [])
    .filter((candidate) => candidate.named === true && candidate.vertical !== 'movies');
  // Keep every eligible Overview candidate in the editorial context before
  // applying the small general cap. This prevents a sports-first Overview
  // from disappearing behind the first eight music candidates.
  const namedCandidates = [
    ...allNamedCandidates.filter((candidate) => overviewRefs.has(candidate.ref)),
    ...allNamedCandidates.filter((candidate) => !overviewRefs.has(candidate.ref))
  ]
    .slice(0, 8)
    .map(({ named: _named, ...candidate }) => candidate);
  const namedRefs = new Set(namedCandidates.map((candidate) => candidate.ref));
  const overview = (projection.overview ?? [])
    .filter((candidate) => namedRefs.has(candidate.id))
    .map((candidate) => ({ ref: candidate.id, vertical: candidate.vertical, score: candidate.score, startLocal: candidate.startLocal }));

  return {
    schemaVersion: 2,
    horizonDays: projection.horizon?.days ?? null,
    verticalCounts,
    concertCandidateCount: projection.events?.length ?? 0,
    sportsGameCount: projection.sports?.length ?? 0,
    movieCandidateCount: projection.movies?.length ?? 0,
    premiumMovieCount: (projection.movies ?? []).filter((movie) => movie.premiumFormatConfirmed).length,
    tasteTierCounts: originCounts,
    confidenceCounts,
    urgencyCounts,
    upcomingWindows,
    next14Days: next14,
    overview,
    overviewPriority: overview[0]?.vertical ?? null,
    namedCandidates,
    personalContext: safePersonalContext,
    sourceHealth: (projection.sourceHealth ?? []).map(({ source, status }) => ({ source, status }))
  };
}

export function buildEditorialCandidates({ events = [], sports = [], movies = [] } = {}) {
  const music = events.map((event) => {
    const sources = new Set(event.sourceOccurrences?.map((occurrence) => occurrence.source) ?? event.sources ?? []);
    const ticketmasterOccurrence = event.sourceOccurrences?.find((occurrence) => occurrence.source === 'ticketmaster');
    const allowedOccurrence = ticketmasterOccurrence ?? event.sourceOccurrences?.find((occurrence) => occurrence.source !== 'seatgeek');
    const named = Boolean(allowedOccurrence) && (!sources.has('seatgeek') || sources.has('ticketmaster'));
    return {
      ref: event.id,
      vertical: 'music',
      named,
      provenance: allowedOccurrence?.source ?? null,
      title: allowedOccurrence?.title ?? event.title,
      startLocal: allowedOccurrence?.startLocal ?? event.startLocal,
      venue: allowedOccurrence?.venue?.name ?? event.venue?.name ?? null,
      eventType: event.eventType ?? 'concert',
      fitBand: event.ranking?.confidence ?? 'unknown',
      fitScore: event.ranking?.artistFit ?? null,
      urgency: event.ranking?.urgency ?? 'unknown',
      hassleScore: event.ranking?.hassleScore ?? null,
      whyYou: event.ranking?.whyYou ?? ''
    };
  });
  const baseball = sports.map((game) => ({
    ref: game.id,
    vertical: 'sports',
    named: true,
    provenance: 'mlb',
    title: `${game.awayTeam?.shortName || game.awayTeam?.name || 'Away'} at ${game.homeTeam?.shortName || game.homeTeam?.name || 'Home'}`,
    startLocal: game.startLocal,
    venue: game.venue?.name ?? null,
    tags: game.tags ?? [],
    fitBand: game.ranking?.confidence ?? 'unknown',
    fitScore: game.ranking?.interestScore ?? null,
    urgency: game.ranking?.urgency ?? 'unknown',
    hassleScore: game.ranking?.hassleScore ?? null,
    whyYou: game.ranking?.whyYou ?? ''
  }));
  const film = movies.map((movie) => ({
    ref: movie.id,
    vertical: 'movies',
    named: true,
    provenance: 'tmdb',
    title: movie.title,
    startLocal: movie.releaseDate,
    venue: movie.theater ?? null,
    fitBand: movie.formatStatus ?? 'unknown',
    fitScore: movie.tasteScore ?? null,
    urgency: movie.urgency ?? 'unknown',
    hassleScore: movie.hassle ?? null,
    whyYou: movie.reasons?.[0] ?? ''
  }));
  return [...music, ...baseball, ...film];
}

export function serializeEditorialInput(input) {
  const allowedProvenance = new Set(['ticketmaster', 'framework', 'insomniac', 'mlb', 'tmdb']);
  return {
    schemaVersion: input.schemaVersion,
    horizonDays: input.horizonDays,
    verticalCounts: input.verticalCounts,
    concertCandidateCount: input.concertCandidateCount,
    sportsGameCount: input.sportsGameCount,
    movieCandidateCount: input.movieCandidateCount,
    premiumMovieCount: input.premiumMovieCount,
    confidenceCounts: input.confidenceCounts,
    urgencyCounts: input.urgencyCounts,
    upcomingWindows: input.upcomingWindows,
    next14Days: input.next14Days,
    overview: (input.overview ?? []).map(({ ref, vertical, startLocal }) => ({ ref, vertical, startLocal })),
    overviewPriority: input.overviewPriority,
    namedCandidates: (input.namedCandidates ?? []).map((candidate) => {
      const safe = {
        ref: candidate.ref,
        vertical: candidate.vertical,
        eventType: candidate.eventType,
        startLocal: candidate.startLocal,
        urgency: candidate.urgency,
        hassleScore: candidate.hassleScore,
        provenance: candidate.provenance
      };
      if (allowedProvenance.has(candidate.provenance)) {
        safe.title = candidate.title;
        safe.venue = candidate.venue;
      }
      return safe;
    }),
    personalContext: sanitizePromptContext(input.personalContext),
    sourceHealth: input.sourceHealth
  };
}

export function deterministicEditorial(projection, status = 'deterministic fallback', warning = null, { now = new Date() } = {}) {
  const input = buildEditorialInput(projection);
  const direct = input.tasteTierCounts.source ?? 0;
  const exploratory = (input.tasteTierCounts.similar ?? 0) + (input.tasteTierCounts.tag ?? 0) + (input.tasteTierCounts.promoter ?? 0);
  const sports = input.sportsGameCount;
  const verdict = direct >= 5 || sports >= 3 ? 'go out' : direct + exploratory >= 3 ? 'maybe' : 'do not waste your time';
  const headline = verdict === 'go out'
    ? 'A few dates deserve your attention.'
    : verdict === 'maybe'
      ? 'A watchlist, not a mandate.'
      : 'Nothing earns the trip yet.';
  const sportsLeadsNow = input.overviewPriority === 'sports';
  const immediateDay = weekdayForLocalDate(input.overview.find((candidate) => candidate.vertical === 'sports')?.startLocal) ?? 'upcoming';
  const lead = input.concertCandidateCount || sports
    ? sportsLeadsNow
      ? `Music leads the broader shortlist, but this ${immediateDay} Dodgers game is the strongest immediate option. The remaining dates can wait for a clearer music signal.`
      : `The next two weeks hold ${input.next14Days.music} music candidate${input.next14Days.music === 1 ? '' : 's'} and ${input.next14Days.sports} Dodgers game${input.next14Days.sports === 1 ? '' : 's'}; music leads the broader shortlist, with sports as a selective second lane.`
    : 'The current horizon is quiet enough that staying home remains a reasonable call.';
  return {
    mode: 'deterministic',
    status,
    warning,
    model: null,
    generatedAt: new Date(now).toISOString(),
    headline,
    verdict,
    lead,
    decisionNotes: [
      `${input.upcomingWindows.next14Days} total concert candidates land in the next two weeks.`,
      sports ? `${sports} Dodgers home games are available as a separate sports lane.` : 'No sports schedule currently contributes to the overview.',
      input.movieCandidateCount ? `${input.movieCandidateCount} movie candidates remain in their own vertical.` : 'The movie vertical is waiting for a configured, refined candidate source.'
    ].slice(0, 3),
    skipCall: verdict === 'do not waste your time' ? 'Do not force a plan this weekend; the current evidence does not clear the personal-value bar.' : 'Skip anything that requires a weaker fit or unnecessary coordination.',
    caution: 'Candidate identity, ordering, scores, and source health come only from the deterministic pipeline.',
    mentions: []
  };
}

export async function generateEditorialBrief({
  baseUrl = 'http://127.0.0.1:11434',
  model = 'gemma4:26b-mlx',
  timeoutMs = 180_000,
  projection,
  personalContext = {},
  fetchImpl = fetch,
  now = new Date()
}) {
  const safeInput = serializeEditorialInput(buildEditorialInput(projection, sanitizePromptContext(personalContext)));
  const allowedRefs = new Set(safeInput.namedCandidates.map((candidate) => candidate.ref));
  const blockedNames = (projection.editorialCandidates ?? []).filter((candidate) => candidate.named !== true).map((candidate) => candidate.title).filter(Boolean);
  const request = {
    model,
    stream: false,
    think: false,
    keep_alive: '10m',
    options: { temperature: 0.2, num_predict: 750 },
    format: EDITORIAL_SCHEMA,
    messages: [
      {
        role: 'system',
        content: 'You are the optional editorial layer for a private personal taste engine. Write a concise human brief, not a restatement of counts. Lead with the next 7 to 14 days and music, then add a selective sports read when it is meaningful. Movies are a separate vertical and do not belong in the overview. If overviewPriority is sports, explicitly acknowledge that music leads the broader shortlist while this game is the strongest immediate option; do not describe that ranking as contradictory. You may name only candidates in namedCandidates and may place only their refs in mentions. Never introduce any event, artist, venue, title, or candidate name that is not present in namedCandidates. Do not invent facts, prices, ticket availability, formats, venues, dates, or sources. Never claim scarcity, sellout risk, limited availability, access loss, tickets disappearing, or an unsupported reason to act now. An urgency label is advisory only. Do not alter candidate ordering, scores, membership, or source health. Use a calm, selective, slightly prosaic voice; make the lead two or three vivid but compact sentences. Always provide every schema field: skipCall must be one nonempty sentence, and mentions must be an array (possibly empty). A valid verdict may be do not waste your time. Return only JSON matching this schema: ' + JSON.stringify(EDITORIAL_SCHEMA)
      },
      {
        role: 'user',
        content: JSON.stringify(safeInput)
      }
    ]
  };

  try {
    const endpoint = new URL('/api/chat', `${String(baseUrl).replace(/\/$/, '')}/`);
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`Ollama request failed (${response.status}).`);
    const body = await response.json();
    const outputText = body.message?.content;
    if (!outputText) throw new Error('Ollama response did not contain structured output text.');
    const editorial = alignEditorialWithOverview(
      validateEditorial(parseStructuredJson(outputText), allowedRefs, blockedNames),
      safeInput
    );
    return {
      mode: 'ollama',
      status: 'locally enhanced',
      model,
      generatedAt: new Date(now).toISOString(),
      ...editorial
    };
  } catch (error) {
    return deterministicEditorial(projection, 'deterministic fallback', sanitizeErrorMessage(error), { now });
  }
}

function alignEditorialWithOverview(editorial, input) {
  if (input.overviewPriority !== 'sports') return editorial;
  const lead = editorial.lead.trim();
  // Remove a common model reversal ("baseball/sports leads") before adding
  // the deterministic relationship the Overview actually established.
  const cleanedLead = lead
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\b(?:baseball|sports|music)\s+leads?\b/i.test(sentence))
    .filter((sentence) => !/\bstrongest immediate option\b/i.test(sentence))
    .join(' ')
    .trim();

  const sportsDate = input.overview.find((candidate) => candidate.vertical === 'sports')?.startLocal;
  const day = weekdayForLocalDate(sportsDate) ?? 'upcoming';
  const bridge = `Music leads the broader shortlist, but this ${day} Dodgers game is the strongest immediate option.`;
  return {
    ...editorial,
    lead: `${bridge} ${cleanedLead}`.trim().slice(0, 520)
  };
}

function parseStructuredJson(value) {
  const text = String(value ?? '').trim();
  const unwrapped = text.startsWith('```')
    ? text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : text;
  return JSON.parse(unwrapped);
}

function validateEditorial(value, allowedRefs, blockedNames) {
  if (!value || typeof value !== 'object') throw new Error('Editorial output must be an object.');
  if (!VERDICTS.has(value.verdict)) throw new Error('Editorial verdict is invalid.');
  for (const key of ['headline', 'lead', 'skipCall']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error(`Editorial ${key} is invalid.`);
  }
  if (!Array.isArray(value.decisionNotes) || value.decisionNotes.some((note) => typeof note !== 'string')) throw new Error('Editorial decisionNotes are invalid.');
  const rawMentions = value.mentions == null ? [] : value.mentions;
  if (!Array.isArray(rawMentions)) throw new Error('Editorial mentions are invalid.');
  // Mentions are advisory only. Keep validated refs and quietly drop any
  // model-produced labels or unknown refs rather than publishing them.
  const mentions = rawMentions.filter((ref) => typeof ref === 'string' && allowedRefs.has(ref));
  const skipCall = typeof value.skipCall === 'string' && value.skipCall.trim()
    ? value.skipCall
    : 'Skip the weaker options and keep the strongest signal in view.';
  const caution = typeof value.caution === 'string' && value.caution.trim()
    ? value.caution
    : 'Facts, ordering, and source health remain deterministic.';
  const combined = [value.headline, value.lead, skipCall, caution, ...value.decisionNotes].join(' ');
  if (UNSUPPORTED_CLAIMS.test(combined)) throw new Error('Editorial output made an unsupported scarcity claim.');
  if (containsRestrictedCandidate(combined, blockedNames)) throw new Error('Editorial output named a source-restricted candidate.');
  return {
    headline: value.headline.trim().slice(0, 90),
    verdict: value.verdict,
    lead: value.lead.trim().slice(0, 520),
    decisionNotes: value.decisionNotes.slice(0, 3).map((note) => note.trim().slice(0, 180)),
    skipCall: skipCall.trim().slice(0, 180),
    caution: caution.trim().slice(0, 220),
    mentions: [...new Set(mentions)].slice(0, 3)
  };
}

function containsRestrictedCandidate(text, blockedNames) {
  for (const blockedName of blockedNames) {
    const name = String(blockedName ?? '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    // Match complete candidate phrases only. A substring check makes ordinary
    // prose such as “live” or “LA” look like a restricted event title.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
    if (pattern.test(text)) return true;
  }
  return false;
}

function daysFromNow(value, now) {
  return localDateDifference(value, now);
}
