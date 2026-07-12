import { buildArtistSnapshot } from './spotifyTaste.js';
import { normalizeSeatGeekEvent } from './seatgeek.js';
import { normalizeTicketmasterEvent } from './ticketmaster.js';
import { normalizeFrameworkEvent } from './framework.js';
import { normalizeInsomniacEvent } from './insomniac.js';
import { normalizeMlbGame, normalizeStandings } from './mlb.js';
import {
  enrichSportsGames,
  joinSportsTickets,
  normalizeSeatGeekSportsEvent,
  normalizeTicketmasterSportsEvent
} from './sports.js';
import { normalizeTmdbMovie } from './tmdb.js';
import { deduplicateCandidates } from './candidates.js';
import { rankCandidates, normalizeArtistName } from './ranking.js';
import { buildOverviewBuckets } from './overview.js';
import { buildEditorialCandidates, generateEditorialBrief } from './editorial.js';
import { enhanceEventsWithOllama, enhanceSportsWithOllama } from './eventEnhancement.js';
import { resolveMovieVisual } from './visuals.js';
import { enhancementFor, toDisplayEvent, toDisplaySportsGame } from './projection.js';
import { sanitizePromptContext } from './diagnostics.js';

export const FIXTURE_TIMEZONE = 'America/Los_Angeles';
export const FIXTURE_NOW = '2026-07-12T12:00:00-07:00';

export async function evaluateFixture(fixture, {
  now = fixture.now ?? FIXTURE_NOW,
  timezone = fixture.timezone ?? FIXTURE_TIMEZONE,
  modelMode = 'absent',
  modelFetch = null
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Fixture now must be a valid date.');
  const config = { ...fixture.config, timezone };
  const horizonDays = Number(config.upcomingHorizonDays) || 180;
  const startDate = localDate(generatedAt, timezone);
  const endDate = localDate(new Date(generatedAt.getTime() + horizonDays * 86_400_000), timezone);
  const retrievedAt = generatedAt.toISOString();
  const normalized = normalizeFixtureInputs(fixture, { generatedAt, retrievedAt, timezone, config });
  const deduplication = {};
  const allConcerts = deduplicateCandidates(normalized.concerts, deduplication);
  const rankedAll = rankCandidates(allConcerts, normalized.artistSnapshot, config, generatedAt);
  const ranked = rankedAll
    .filter((candidate) => !candidate.ranking.excluded && candidate.matchedArtists.length > 0)
    .slice(0, 120);

  const deterministicOverviewBuckets = buildOverviewBuckets(
    ranked.map((candidate) => toDisplayEvent(candidate)),
    normalized.sports.map((game) => toDisplaySportsGame(game)),
    {
      now: generatedAt,
      currentDays: 14,
      planAheadMinScore: config.overviewPlanAheadMinScore,
      horizonDays
    }
  );
  const overview = [...deterministicOverviewBuckets.current, ...deterministicOverviewBuckets.planAhead];
  const overviewMusicIds = overview.filter((item) => item.vertical === 'music').map((item) => item.id);
  const overviewSportsIds = overview.filter((item) => item.vertical === 'sports').map((item) => item.id);
  const fetchImpl = modelFetch ?? fixtureModelFetch(modelMode);
  const personalContext = sanitizePromptContext(fixture.personalContext);
  const sportsEnhancement = await enhanceSportsWithOllama(normalized.sports, personalContext, {
    model: 'fixture-model',
    fetchImpl,
    now: generatedAt,
    requiredIds: overviewSportsIds
  });
  const eventEnhancement = await enhanceEventsWithOllama(ranked, personalContext, {
    model: 'fixture-model',
    fetchImpl,
    now: generatedAt,
    requiredIds: overviewMusicIds
  });

  const sourceHealth = normalized.sourceHealth.map((source) => ({ ...source }));
  sourceHealth.push({
    source: 'ollama-sports',
    status: enhancementStatus(sportsEnhancement.mode),
    itemCount: sportsEnhancement.enhancedGameCount,
    warningCount: warningCount(sportsEnhancement.passes)
  });
  sourceHealth.push({
    source: 'ollama-events',
    status: enhancementStatus(eventEnhancement.mode),
    itemCount: eventEnhancement.enhancedEventCount,
    warningCount: warningCount(eventEnhancement.passes)
  });
  const overviewEnhancedCount = overview.filter((item) => {
    const advisory = item.vertical === 'music'
      ? eventEnhancement.byId.get(item.id)
      : sportsEnhancement.byId.get(item.id);
    return advisory && Object.keys(advisory).length > 0;
  }).length;
  sourceHealth.push({
    source: 'ollama-overview',
    status: overview.length === 0 || overviewEnhancedCount === overview.length ? 'active' : overviewEnhancedCount ? 'partial' : 'unavailable',
    itemCount: overviewEnhancedCount,
    warningCount: Math.max(0, overview.length - overviewEnhancedCount)
  });

  const projection = {
    schemaVersion: 5,
    generatedAt: retrievedAt,
    horizon: { startDate, endDate, days: horizonDays },
    sourcePlaylistCount: normalized.artistSnapshot.playlistCount,
    sourceArtistCount: normalized.artistSnapshot.sourceArtistCount,
    topArtistCount: normalized.artistSnapshot.topArtistCount ?? 0,
    expandedArtistCount: normalized.artistSnapshot.artistCount,
    scannedEventCount: allConcerts.length,
    sourceHealth,
    priorityTheaters: fixture.priorityTheaters ?? [],
    sportsConfig: {
      teamName: normalized.sportsConfig.teamName,
      featuredInterestThreshold: normalized.sportsConfig.featuredInterestThreshold ?? 70
    },
    events: ranked.map((candidate) => toDisplayEvent(candidate, enhancementFor(eventEnhancement.byId.get(candidate.id)))),
    sports: normalized.sports.map((game) => toDisplaySportsGame(game, enhancementFor(sportsEnhancement.byId.get(game.id)))),
    movies: normalized.movies,
    editorialCandidates: buildEditorialCandidates({ events: ranked, sports: normalized.sports, movies: normalized.movies })
  };
  const finalOverviewBuckets = buildOverviewBuckets(projection.events, projection.sports, {
    now: generatedAt,
    currentDays: 14,
    planAheadMinScore: config.overviewPlanAheadMinScore,
    horizonDays
  });
  projection.overview = finalOverviewBuckets.current;
  projection.overviewPlanAhead = finalOverviewBuckets.planAhead;
  projection.overviewAdvisory = {
    queuedCount: overview.length,
    enhancedCount: overviewEnhancedCount,
    model: eventEnhancement.model || sportsEnhancement.model || null,
    status: overview.length === 0 || overviewEnhancedCount === overview.length ? 'active' : overviewEnhancedCount ? 'partial' : 'unavailable'
  };
  projection.eventEnhancement = {
    mode: eventEnhancement.mode,
    model: eventEnhancement.model,
    enhancedEventCount: eventEnhancement.enhancedEventCount,
    passes: eventEnhancement.passes
  };
  projection.sportsEnhancement = {
    mode: sportsEnhancement.mode,
    model: sportsEnhancement.model,
    enhancedGameCount: sportsEnhancement.enhancedGameCount,
    passes: sportsEnhancement.passes
  };
  projection.editorial = await generateEditorialBrief({
    model: 'fixture-model',
    fetchImpl,
    personalContext,
    projection,
    now: generatedAt
  });
  delete projection.editorialCandidates;

  return {
    projection,
    stages: {
      normalized,
      deduplication,
      rankedAll,
      ranked,
      deterministicOverviewBuckets,
      eventEnhancement,
      sportsEnhancement
    }
  };
}

export function normalizeFixtureInputs(fixture, { generatedAt, retrievedAt, timezone, config }) {
  const providers = fixture.providers ?? {};
  const concerts = [
    ...sortRaw(providers.seatgeek).map((event) => normalizeSeatGeekEvent(event, retrievedAt)),
    ...sortRaw(providers.ticketmaster).map((event) => normalizeTicketmasterEvent(event, retrievedAt)),
    ...sortRaw(providers.framework).map((event) => normalizeFrameworkEvent(event, retrievedAt)),
    ...sortRaw(providers.insomniac).map((event) => normalizeInsomniacEvent(event, retrievedAt))
  ];
  const baseSnapshot = buildArtistSnapshot({
    evidence: fixture.taste?.playlists ?? [],
    topArtists: fixture.taste?.topArtists ?? null
  }, generatedAt);
  const artistSnapshot = addDiscoveryArtists(baseSnapshot, fixture.taste?.discoveryArtists ?? []);
  const sportsConfig = {
    ...(fixture.sports?.config ?? {}),
    home: config.home,
    searchRadiusMiles: config.searchRadiusMiles
  };
  const games = sortRaw(fixture.sports?.games).map((game) => normalizeMlbGame(game, {
    timezone,
    teamId: 119,
    retrievedAt
  }));
  const standings = normalizeStandings({ records: fixture.sports?.standings ?? [] });
  const enrichedGames = enrichSportsGames(games, standings, sportsConfig, { now: generatedAt });
  const ticketEvents = [
    ...sortRaw(fixture.sports?.seatgeek).map((event) => normalizeSeatGeekSportsEvent(event, retrievedAt)),
    ...sortRaw(fixture.sports?.ticketmaster).map((event) => normalizeTicketmasterSportsEvent(event, retrievedAt))
  ];
  const sports = joinSportsTickets(enrichedGames, ticketEvents, sportsConfig, generatedAt);
  const movies = (fixture.movies ?? []).map((movie) => {
    const normalized = normalizeTmdbMovie(movie, retrievedAt);
    return {
      ...normalized,
      candidateScore: Number(movie.candidateScore ?? movie.popularity ?? 0),
      tasteScore: Number(movie.tasteScore ?? movie.popularity ?? 0),
      reasons: movie.reasons ?? ['Fixture theatrical candidate.'],
      visual: resolveMovieVisual(normalized)
    };
  });
  return {
    concerts,
    artistSnapshot,
    sports,
    sportsConfig,
    movies,
    sourceHealth: [
      sourceHealth('spotify-top-artists', 'partial', artistSnapshot.topArtistCount ?? 0, artistSnapshot.topItems?.warnings?.length ?? 0),
      sourceHealth('seatgeek', 'active', providers.seatgeek?.length ?? 0, 0),
      sourceHealth('ticketmaster', 'active', providers.ticketmaster?.length ?? 0, 0),
      sourceHealth('framework', 'active', providers.framework?.length ?? 0, 0),
      sourceHealth('insomniac', 'active', providers.insomniac?.length ?? 0, 0),
      sourceHealth('mlb', 'active', games.length, 0),
      sourceHealth('tmdb', 'active', movies.length, 0)
    ]
  };
}

export function fixtureModelFetch(mode = 'absent') {
  if (mode === 'absent') return async () => { throw new Error('Fixture Ollama unavailable'); };
  if (mode === 'timeout') return async () => { throw new Error('Fixture Ollama timeout'); };
  if (mode === 'malformed') return async () => responseWithContent('{not valid json');
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages?.[0]?.content ?? '';
    const input = JSON.parse(request.messages?.[1]?.content ?? '{}');
    if (mode === 'unsupported') {
      if (system.includes('editorial layer')) {
        return responseWithContent(JSON.stringify({
          headline: 'Act now', verdict: 'go out', lead: 'Tickets will sell out.', decisionNotes: ['Scarcity is certain.'],
          skipCall: 'None.', caution: 'None.', mentions: []
        }));
      }
      return responseWithContent(JSON.stringify({ items: (input.candidates ?? []).map(({ ref }) => ({ ref, score: 50, label: 'possible fit', explanation: 'This will sell out.' })) }));
    }
    if (mode === 'ranking-mutation') {
      return responseWithContent(JSON.stringify({ items: (input.candidates ?? []).map(({ ref }) => ({ ref, score: 99, label: 'strong fit', explanation: 'Advisory only.', utility: 999 })) }));
    }
    if (system.includes('editorial layer')) {
      const ref = input.namedCandidates?.[0]?.ref;
      return responseWithContent(JSON.stringify({
        headline: 'A fixture signal is worth a look.',
        verdict: 'maybe',
        lead: 'The fixture shortlist has one clear near-term signal. Keep the strongest option in view and let the weaker dates wait.',
        decisionNotes: ['Keep deterministic ordering authoritative.'],
        skipCall: 'Skip the weaker options.',
        caution: 'Facts and membership remain deterministic.',
        mentions: ref ? [ref] : []
      }));
    }
    const items = (input.candidates ?? []).map(({ ref }) => system.includes('selective recommendation')
      ? { ref, verdict: 'consider', explanation: 'Fixture advisory only.' }
      : system.includes('personal fit') || system.includes('personal value')
        ? { ref, score: 60, label: 'possible fit', explanation: 'Fixture advisory only.' }
        : system.includes('advisory urgency') || system.includes('deterministic ticket urgency') || system.includes('deterministic urgency label')
          ? { ref, label: 'watch', explanation: 'Fixture advisory only.' }
          : { ref, score: 4, explanation: 'Fixture advisory only.' });
    return responseWithContent(JSON.stringify({ items }));
  };
}

function addDiscoveryArtists(snapshot, discoveryArtists) {
  const artists = (snapshot.artists ?? []).map((artist) => ({ ...artist }));
  const names = new Set(artists.map((artist) => normalizeArtistName(artist.name)));
  for (const artist of discoveryArtists) {
    const name = String(artist.name ?? '').trim();
    const key = normalizeArtistName(name);
    if (!key || names.has(key)) continue;
    names.add(key);
    artists.push({
      spotifyArtistId: artist.spotifyArtistId ?? null,
      name,
      seedStrength: Number(artist.seedStrength) || 0,
      playlistDiversity: 0,
      trackCount: 0,
      genres: [],
      sampleTracks: [],
      evidence: [],
      aliases: [],
      origin: artist.origin ?? 'source',
      discoveryEvidence: artist.discoveryEvidence ?? [],
      ...(artist.topEvidence ? { topEvidence: artist.topEvidence } : {})
    });
  }
  return { ...snapshot, artists, artistCount: artists.length };
}

function sortRaw(records = []) {
  return [...records].sort((left, right) => rawKey(left).localeCompare(rawKey(right)) || stableString(left).localeCompare(stableString(right)));
}

function rawKey(record = {}) {
  return String(record.id ?? record.gamePk ?? record.sourceEventId ?? record.url ?? record.name ?? record.title ?? '');
}

function stableString(value) {
  if (Array.isArray(value)) return `[${value.map(stableString).sort().join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
}

function localDate(value, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function responseWithContent(content) {
  return new Response(JSON.stringify({ message: { content } }));
}

function sourceHealth(source, status, itemCount, warningCount) {
  return { source, status, itemCount, warningCount };
}

function enhancementStatus(mode) {
  return mode === 'ollama' ? 'active' : mode === 'partial' ? 'partial' : 'unavailable';
}

function warningCount(passes = {}) {
  return Object.values(passes).filter((pass) => pass.status !== 'locally enhanced').length;
}
