import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deduplicateCandidates } from '../src/candidates.js';
import { loadBriefConfig } from '../src/briefConfig.js';
import { loadEnv } from '../src/env.js';
import { buildEditorialCandidates, generateEditorialBrief } from '../src/editorial.js';
import { enhanceEventsWithOllama, enhanceSportsWithOllama } from '../src/eventEnhancement.js';
import { fetchFrameworkArtists, fetchFrameworkEvents, normalizeFrameworkEvent } from '../src/framework.js';
import { fetchInsomniacEvents, normalizeInsomniacEvent } from '../src/insomniac.js';
import { applyPitcherStats, fetchDodgersHomeGames, fetchMlbPitcherStats, fetchMlbStandings } from '../src/mlb.js';
import { selectMovieCandidates } from '../src/movieSelection.js';
import { normalizeArtistName, rankCandidates } from '../src/ranking.js';
import { buildOverviewBuckets } from '../src/overview.js';
import {
  enrichSportsGames,
  fetchSeatGeekSportsEvents,
  fetchTicketmasterSportsEvents,
  joinSportsTickets,
  normalizeSeatGeekSportsEvent,
  normalizeTicketmasterSportsEvent
} from '../src/sports.js';
import {
  eventWithinRadius,
  fetchSeatGeekEvents,
  fetchSeatGeekEventsForPerformers,
  normalizeSeatGeekEvent,
  resolveSeatGeekPerformers
} from '../src/seatgeek.js';
import { fetchTicketmasterEvents, fetchTicketmasterEventsForArtists, normalizeTicketmasterEvent } from '../src/ticketmaster.js';
import { enrichMovieMetadata, fetchUpcomingMovies, normalizeTmdbMovie } from '../src/tmdb.js';
import { resolveMovieVisual } from '../src/visuals.js';
import {
  buildCandidateTrace,
  createBuildReport,
  finalizeBuildReport,
  recordBuildSource,
  recordBuildStage,
  sanitizeErrorMessage
} from '../src/diagnostics.js';
import { enhancementFor, toDisplayEvent, toDisplaySportsGame } from '../src/projection.js';

loadEnv();

const pipelineStartedAt = Date.now();

const config = await loadBriefConfig(resolve('config/brief.json'));
const movieConfig = JSON.parse(await readFile(resolve('config/movies.json'), 'utf8'));
const sportsConfig = JSON.parse(await readFile(resolve('config/sports.json'), 'utf8'));
const personalContext = JSON.parse(await readFile(resolve('config/personal-context.json'), 'utf8'));
const sourceSnapshot = JSON.parse(await readFile(resolve('data/taste/artists.json'), 'utf8'));
const expandedSnapshot = await readJsonIfPresent(resolve('data/taste/expanded-artists.json'));
const artistSnapshot = expandedSnapshot?.sourceGeneratedAt === sourceSnapshot.generatedAt
  ? expandedSnapshot
  : sourceSnapshot;
const generatedAt = new Date();
const startDate = localIsoDate(generatedAt, config.timezone);
const end = new Date(generatedAt);
end.setDate(end.getDate() + config.upcomingHorizonDays);
const endDate = localIsoDate(end, config.timezone);
const sourceHealth = [];
const diagnostics = { generatedAt: generatedAt.toISOString(), horizon: { startDate, endDate }, sources: {} };
const buildReport = createBuildReport({
  now: generatedAt,
  timezone: config.timezone,
  horizon: { startDate, endDate, days: config.upcomingHorizonDays }
});
const ticketSourcesStartedAt = Date.now();

const topItemsHealth = sourceSnapshot.topItems ?? { status: 'unavailable', windows: {}, warnings: [] };
sourceHealth.push({
  source: 'spotify-top-artists',
  status: topItemsHealth.status === 'active' ? 'active' : topItemsHealth.status === 'partial' ? 'partial' : 'unavailable',
  itemCount: sourceSnapshot.topArtistCount ?? 0,
  warningCount: (topItemsHealth.warnings ?? []).length,
  details: {
    shortTerm: topItemsHealth.windows?.shortTerm?.status ?? 'unavailable',
    mediumTerm: topItemsHealth.windows?.mediumTerm?.status ?? 'unavailable',
    longTerm: topItemsHealth.windows?.longTerm?.status ?? 'unavailable',
    lastSuccessfulRefresh: latestWindowTimestamp(topItemsHealth.windows),
    cacheExpiry: earliestWindowExpiry(topItemsHealth.windows)
  }
});
recordBuildSource(buildReport, 'spotify-top-artists', {
  fetched: Boolean(topItemsHealth.generatedAt),
  cached: Object.values(topItemsHealth.windows ?? {}).some((window) => window?.status === 'cached'),
  normalized: sourceSnapshot.topArtistCount ?? 0,
  rejected: 0,
  deduplicated: 0,
  warningCount: (topItemsHealth.warnings ?? []).length,
  failureStatus: topItemsHealth.status === 'active' || topItemsHealth.status === 'partial' ? null : topItemsHealth.status,
  lastUsableFreshness: latestWindowTimestamp(topItemsHealth.windows),
  status: topItemsHealth.status ?? 'unavailable'
});

const frameworkArtists = await optionalSource('framework-artists', true, async () => {
  const items = await fetchFrameworkArtists();
  if (items.length) await writePrivateJson(resolve('data/taste/framework-artists.json'), items);
  return { items, warnings: [] };
});

const seatGeek = await optionalSource('seatgeek', Boolean(process.env.SEATGEEK_CLIENT_ID), async () => {
  const result = await collectSeatGeek();
  return { items: result.events, warnings: result.warnings };
});
const ticketmaster = await optionalSource('ticketmaster', Boolean(process.env.TICKETMASTER_API_KEY), async () => {
  const raw = await fetchTicketmasterEvents({
    apiKey: process.env.TICKETMASTER_API_KEY,
    startDate,
    endDate,
    config
  });
  const artistDiagnostics = {};
  const expanded = await fetchTicketmasterEventsForArtists({
    artists: frameworkArtists.items,
    apiKey: process.env.TICKETMASTER_API_KEY,
    startDate,
    endDate,
    config,
    maxArtists: config.ticketmasterArtistQueryLimit,
    maxPages: 1,
    diagnostics: artistDiagnostics
  });
  diagnostics.ticketmasterFrameworkArtistQueries = artistDiagnostics;
  const merged = [...new Map([...raw, ...expanded.events]
    .map((event) => [String(event.id ?? event.url ?? `${event.name}|${event.dates?.start?.localDate ?? ''}`), event])).values()];
  return { items: merged.map((event) => normalizeTicketmasterEvent(event, generatedAt)), warnings: expanded.warnings };
});
const framework = await optionalSource('framework', true, async () => {
  const raw = await fetchFrameworkEvents({ startDate, endDate });
  return { items: raw.map((event) => normalizeFrameworkEvent(event, generatedAt)), warnings: [] };
});
const insomniac = await optionalSource('insomniac', true, async () => {
  const raw = await fetchInsomniacEvents({ startDate, endDate });
  return { items: raw.map((event) => normalizeInsomniacEvent(event, generatedAt)), warnings: [] };
});
printTiming('Ticket sources', Date.now() - ticketSourcesStartedAt);
const sportsSourceConfig = {
  ...sportsConfig,
  home: config.home,
  searchRadiusMiles: config.searchRadiusMiles
};
const mlbTmdbStartedAt = Date.now();
const mlb = await optionalSource('mlb', sportsConfig.enabled !== false, async () => {
  const warnings = [];
  const rawGames = await fetchDodgersHomeGames({
    teamId: sportsConfig.teamId,
    startDate,
    endDate,
    homeVenueIds: sportsConfig.homeOnly === false ? [] : sportsConfig.homeVenueIds,
    timezone: config.timezone
  });
  let standings = new Map();
  try {
    standings = await fetchMlbStandings({ season: generatedAt.getFullYear() });
  } catch (error) {
    warnings.push(`Standings unavailable: ${error.message}`);
  }
  let games = rawGames;
  try {
    const pitcherIds = rawGames.flatMap((game) => [game.probablePitchers?.home?.id, game.probablePitchers?.away?.id]).filter(Boolean);
    const pitcherStats = await fetchMlbPitcherStats(pitcherIds, {
      season: generatedAt.getFullYear(),
      maxPitchers: sportsConfig.maxPitcherStats
    });
    games = applyPitcherStats(games, pitcherStats);
  } catch (error) {
    warnings.push(`Pitcher enrichment unavailable: ${error.message}`);
  }
  return { items: enrichSportsGames(games, standings, sportsSourceConfig, { now: generatedAt }), warnings };
});
const sportsSeatGeek = await optionalSource('sports-seatgeek', Boolean(process.env.SEATGEEK_CLIENT_ID), async () => {
  const raw = await fetchSeatGeekSportsEvents({
    clientId: process.env.SEATGEEK_CLIENT_ID,
    startDate,
    endDate,
    config: sportsSourceConfig,
    maxPages: sportsConfig.maxTicketPages
  });
  return { items: raw.map((event) => normalizeSeatGeekSportsEvent(event, generatedAt)), warnings: [] };
});
const sportsTicketmaster = await optionalSource('sports-ticketmaster', Boolean(process.env.TICKETMASTER_API_KEY), async () => {
  const raw = await fetchTicketmasterSportsEvents({
    apiKey: process.env.TICKETMASTER_API_KEY,
    startDate,
    endDate,
    config: sportsSourceConfig,
    maxPages: sportsConfig.maxTicketPages
  });
  return { items: raw.map((event) => normalizeTicketmasterSportsEvent(event, generatedAt)), warnings: [] };
});
const sports = joinSportsTickets(
  mlb.items,
  [...sportsSeatGeek.items, ...sportsTicketmaster.items],
  sportsSourceConfig,
  generatedAt
);
const tmdb = await optionalSource('tmdb', Boolean(process.env.TMDB_ACCESS_TOKEN || process.env.TMDB_API_KEY), async () => {
  const raw = await fetchUpcomingMovies({
    accessToken: process.env.TMDB_ACCESS_TOKEN,
    apiKey: process.env.TMDB_API_KEY,
    startDate,
    endDate
  });
  const enriched = await enrichMovieMetadata(raw, {
    accessToken: process.env.TMDB_ACCESS_TOKEN,
    apiKey: process.env.TMDB_API_KEY
  });
  const selected = selectMovieCandidates(enriched, movieConfig).map(({ movie, score, reasons }) => {
    const normalized = normalizeTmdbMovie(movie, generatedAt);
    return {
    ...normalized,
    candidateScore: Math.round(score * 10) / 10,
    tasteScore: Math.min(100, Math.round(score)),
    reasons,
    visual: resolveMovieVisual(normalized)
    };
  });
  return { items: selected, warnings: [] };
});
printTiming('MLB/TMDB', Date.now() - mlbTmdbStartedAt);

const normalizationStartedAt = Date.now();
const deduplication = {};
const allConcerts = deduplicateCandidates([...seatGeek.items, ...ticketmaster.items, ...framework.items, ...insomniac.items], deduplication);
const rankedSnapshot = addPromoterEvidence(artistSnapshot, [...framework.items, ...insomniac.items], frameworkArtists.items);
const rankedAll = rankCandidates(allConcerts, rankedSnapshot, config, generatedAt);
const ranked = rankedAll
  .filter((candidate) => !candidate.ranking.excluded && candidate.matchedArtists.length > 0)
  .slice(0, 120);
const deterministicOverviewBuckets = buildOverviewBuckets(
  ranked.map((candidate) => toDisplayEvent(candidate)),
  sports.map((game) => toDisplaySportsGame(game)),
  { now: generatedAt, currentDays: 14, planAheadMinScore: config.overviewPlanAheadMinScore, horizonDays: config.upcomingHorizonDays }
);
const deterministicOverview = [...deterministicOverviewBuckets.current, ...deterministicOverviewBuckets.planAhead];
const overviewMusicIds = deterministicOverview.filter((item) => item.vertical === 'music').map((item) => item.id);
const overviewSportsIds = deterministicOverview.filter((item) => item.vertical === 'sports').map((item) => item.id);
const overviewCurrentIds = deterministicOverviewBuckets.current.map((item) => item.id);
const overviewPlanAheadIds = deterministicOverviewBuckets.planAhead.map((item) => item.id);
buildReport.resolution.events = {
  confidentMerges: deduplication.mergedCount ?? 0,
  ambiguousMatches: 0,
  rejectedNearMatches: 0,
  venueAliasUse: deduplication.venueAliasUse ?? 0
};
const artistMatches = rankedAll.flatMap((candidate) => candidate.matchedArtists ?? []);
buildReport.resolution.artists = {
  exactMatches: artistMatches.filter((artist) => artist.matchMethod === 'exact-name').length,
  aliasOrProviderMatches: artistMatches.filter((artist) => artist.matchMethod !== 'exact-name').length,
  unresolved: rankedAll.filter((candidate) => !(candidate.matchedArtists ?? []).length).length
};
buildReport.ranking = {
  ...buildReport.ranking,
  directFitCount: ranked.filter((candidate) => (candidate.matchedArtists ?? []).some((artist) => ['source', 'top-items'].includes(artist.origin))).length,
  adjacentFitCount: ranked.filter((candidate) => (candidate.matchedArtists ?? []).some((artist) => ['similar', 'tag', 'promoter'].includes(artist.origin))).length,
  scoreDistribution: scoreDistribution(rankedAll),
  exclusionReasons: exclusionReasons(rankedAll),
  thresholdCounts: {
    minimumUtility: config.minimumUtility,
    atMinimum: rankedAll.filter((candidate) => candidate.ranking.utility === config.minimumUtility).length,
    aboveMinimum: rankedAll.filter((candidate) => candidate.ranking.utility >= config.minimumUtility).length
  },
  currentWindowEligibleCount: overviewCurrentIds.length,
  planAheadEligibleCount: overviewPlanAheadIds.length,
  overviewIds: [...overviewCurrentIds],
  planAheadIds: [...overviewPlanAheadIds],
  candidateTraces: {}
};
printTiming('Normalization', Date.now() - normalizationStartedAt);
const ollamaStartedAt = Date.now();
const sportsEnhancement = await enhanceSportsWithOllama(sports, personalContext, {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'gemma4:26b-mlx',
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 180_000,
  now: generatedAt,
  requiredIds: overviewSportsIds
});
sourceHealth.push({
  source: 'ollama-sports',
  status: sportsEnhancement.mode === 'ollama' ? 'active' : sportsEnhancement.mode === 'partial' ? 'partial' : 'unavailable',
  itemCount: sportsEnhancement.enhancedGameCount,
  warningCount: Object.values(sportsEnhancement.passes).filter((pass) => pass.status !== 'locally enhanced').length
});
recordBuildSource(buildReport, 'ollama-sports', {
  fetched: sportsEnhancement.callsAttempted > 0,
  normalized: sportsEnhancement.enhancedGameCount,
  warningCount: Object.values(sportsEnhancement.passes).filter((pass) => pass.status !== 'locally enhanced').length,
  failureStatus: sportsEnhancement.mode === 'deterministic' ? 'unavailable' : null,
  status: sportsEnhancement.mode
});
const eventEnhancement = await enhanceEventsWithOllama(ranked, personalContext, {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'gemma4:26b-mlx',
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 180_000,
  now: generatedAt,
  requiredIds: overviewMusicIds
});
sourceHealth.push({
  source: 'ollama-events',
  status: eventEnhancement.mode === 'ollama' ? 'active' : eventEnhancement.mode === 'partial' ? 'partial' : 'unavailable',
  itemCount: eventEnhancement.enhancedEventCount,
  warningCount: Object.values(eventEnhancement.passes).filter((pass) => pass.status !== 'locally enhanced').length
});
recordBuildSource(buildReport, 'ollama-events', {
  fetched: eventEnhancement.callsAttempted > 0,
  normalized: eventEnhancement.enhancedEventCount,
  warningCount: Object.values(eventEnhancement.passes).filter((pass) => pass.status !== 'locally enhanced').length,
  failureStatus: eventEnhancement.mode === 'deterministic' ? 'unavailable' : null,
  status: eventEnhancement.mode
});
const overviewEnhancedCount = deterministicOverview.filter((item) => {
  const advisory = item.vertical === 'music'
    ? eventEnhancement.byId.get(item.id)
    : sportsEnhancement.byId.get(item.id);
  return advisory && Object.keys(advisory).length > 0;
}).length;
const overviewAdvisory = {
  queuedCount: deterministicOverview.length,
  enhancedCount: overviewEnhancedCount,
  model: eventEnhancement.model || sportsEnhancement.model || null,
  status: deterministicOverview.length === 0 || overviewEnhancedCount === deterministicOverview.length
    ? 'active'
    : overviewEnhancedCount > 0
      ? 'partial'
      : 'unavailable'
};
sourceHealth.push({
  source: 'ollama-overview',
  status: overviewAdvisory.status,
  itemCount: overviewEnhancedCount,
  warningCount: Math.max(0, overviewAdvisory.queuedCount - overviewEnhancedCount)
});
recordBuildSource(buildReport, 'ollama-overview', {
  fetched: overviewAdvisory.queuedCount > 0,
  normalized: overviewEnhancedCount,
  warningCount: Math.max(0, overviewAdvisory.queuedCount - overviewEnhancedCount),
  failureStatus: overviewAdvisory.status === 'unavailable' ? 'unavailable' : null,
  status: overviewAdvisory.status
});

diagnostics.uniqueConcertsAfterMerge = allConcerts.length;
diagnostics.rankedConcerts = ranked.length;

const exportData = {
  schemaVersion: 5,
  generatedAt: generatedAt.toISOString(),
  horizon: { startDate, endDate, days: config.upcomingHorizonDays },
  sourcePlaylistCount: sourceSnapshot.playlistCount,
  sourceArtistCount: sourceSnapshot.artistCount,
  topArtistCount: sourceSnapshot.topArtistCount ?? 0,
  expandedArtistCount: artistSnapshot.artistCount,
  scannedEventCount: allConcerts.length,
  sourceHealth,
  priorityTheaters: movieConfig.priorityTheaters,
  sportsConfig: {
    teamName: sportsConfig.teamName,
    featuredInterestThreshold: sportsConfig.featuredInterestThreshold
  },
  events: ranked.map((candidate) => toDisplayEvent(candidate, enhancementFor(eventEnhancement.byId.get(candidate.id)))),
  sports: sports.map((game) => toDisplaySportsGame(game, enhancementFor(sportsEnhancement.byId.get(game.id)))),
  movies: tmdb.items,
  editorialCandidates: buildEditorialCandidates({ events: ranked, sports, movies: tmdb.items })
};
const overviewBuckets = buildOverviewBuckets(exportData.events, exportData.sports, {
  now: generatedAt,
  currentDays: 14,
  planAheadMinScore: config.overviewPlanAheadMinScore,
  horizonDays: config.upcomingHorizonDays
});
exportData.overview = overviewBuckets.current;
exportData.overviewPlanAhead = overviewBuckets.planAhead;
exportData.overviewAdvisory = overviewAdvisory;
exportData.eventEnhancement = {
  mode: eventEnhancement.mode,
  model: eventEnhancement.model,
  enhancedEventCount: eventEnhancement.enhancedEventCount,
  passes: eventEnhancement.passes
};
exportData.sportsEnhancement = {
  mode: sportsEnhancement.mode,
  model: sportsEnhancement.model,
  enhancedGameCount: sportsEnhancement.enhancedGameCount,
  passes: sportsEnhancement.passes
};
exportData.editorial = await generateEditorialBrief({
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'gemma4:26b-mlx',
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 180_000,
  personalContext,
  projection: exportData
});
delete exportData.editorialCandidates;
sourceHealth.push({
  source: 'ollama',
  status: exportData.editorial.mode === 'ollama' ? 'active' : 'unavailable',
  itemCount: exportData.editorial.mode === 'ollama' ? 1 : 0,
  warningCount: exportData.editorial.mode === 'ollama' ? 0 : 1
});
recordBuildSource(buildReport, 'ollama', {
  fetched: true,
  normalized: exportData.editorial.mode === 'ollama' ? 1 : 0,
  warningCount: exportData.editorial.mode === 'ollama' ? 0 : 1,
  failureStatus: exportData.editorial.mode === 'ollama' ? null : 'unavailable',
  status: exportData.editorial.mode
});
const modelGroups = [
  ['events', eventEnhancement],
  ['sports', sportsEnhancement],
  ['overview', overviewAdvisory],
  ['editorial', exportData.editorial]
];
buildReport.modelPasses = summarizeModelPasses(modelGroups, {
  inputFieldManifest: [
    ...(eventEnhancement.inputFieldManifest ?? []),
    ...(sportsEnhancement.inputFieldManifest ?? []),
    'editorial.aggregateCounts', 'editorial.allowlistedNamedCandidates'
  ]
});
buildReport.ranking.candidateTraces = Object.fromEntries([
  ...rankedAll.map((candidate) => [candidate.id, buildCandidateTrace(candidate, {
    currentOverviewIds: overviewCurrentIds,
    planAheadIds: overviewPlanAheadIds,
    model: {
      mode: eventEnhancement.mode,
      passes: eventEnhancement.passes,
      enhanced: Boolean(eventEnhancement.byId.get(candidate.id) && Object.keys(eventEnhancement.byId.get(candidate.id)).length)
    }
  })]),
  ...sports.map((game) => [game.id, buildCandidateTrace(game, {
    vertical: 'sports',
    currentOverviewIds: overviewCurrentIds,
    planAheadIds: overviewPlanAheadIds,
    model: {
      mode: sportsEnhancement.mode,
      passes: sportsEnhancement.passes,
      enhanced: Boolean(sportsEnhancement.byId.get(game.id) && Object.keys(sportsEnhancement.byId.get(game.id)).length)
    }
  })])
]);
printTiming('Ollama enhancement', Date.now() - ollamaStartedAt);
const projectionStartedAt = Date.now();
diagnostics.sources = Object.fromEntries(sourceHealth.map((source) => [source.source, source]));
diagnostics.editorialMode = exportData.editorial.mode;
await writePrivateJson(resolve('data/taste/source-diagnostics.json'), diagnostics);
const output = resolve('site/app/data/upcoming.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(exportData, null, 2)}\n`);
printTiming('Projection export', Date.now() - projectionStartedAt);
buildReport.timing.totalMs = Date.now() - pipelineStartedAt;
await writePrivateJson(resolve('data/taste/build-report.json'), finalizeBuildReport(buildReport));
console.log(`Exported ${exportData.events.length} concert(s), ${exportData.sports.length} sports game(s), and ${exportData.movies.length} movie candidate(s) from ${allConcerts.length} normalized concert occurrences.`);

async function collectSeatGeek() {
  const warnings = [];
  let geographicEvents = [];
  let regionalPerformerEvents = [];
  const seatGeekDiagnostics = { geographicPagesFetched: 0, performerPagesFetched: 0 };
  try {
    geographicEvents = await fetchSeatGeekEvents({
      clientId: process.env.SEATGEEK_CLIENT_ID,
      startDate,
      endDate,
      config,
      maxPages: config.maxSeatGeekPages,
      windowDays: config.seatGeekWindowDays,
      diagnostics: seatGeekDiagnostics
    });
  } catch (error) {
    warnings.push(`Geographic retrieval unavailable: ${error.message}`);
  }

  let resolution = { resolved: [], unresolvedCount: 0, cache: {} };
  try {
    const performerCachePath = resolve('data/taste/seatgeek-performers.json');
    const performerCache = await readJsonIfPresent(performerCachePath) ?? {};
    const performerArtists = uniqueArtistWatchlist([
      ...(artistSnapshot.artists ?? []).slice(0, config.seatGeekPerformerArtistLimit),
      ...frameworkArtists.items.slice(0, config.frameworkArtistLimit)
    ]);
    resolution = await resolveSeatGeekPerformers(
      performerArtists,
      { clientId: process.env.SEATGEEK_CLIENT_ID, cache: performerCache }
    );
    seatGeekDiagnostics.performerArtistsQueried = performerArtists.length;
    seatGeekDiagnostics.performerArtistsResolved = resolution.resolved.length;
    await writePrivateJson(performerCachePath, resolution.cache);
    const performerEvents = await fetchSeatGeekEventsForPerformers({
      performerIds: resolution.resolved.map((item) => item.performerId),
      clientId: process.env.SEATGEEK_CLIENT_ID,
      startDate,
      endDate,
      config,
      maxPages: config.maxSeatGeekPages,
      windowDays: null,
      diagnostics: seatGeekDiagnostics
    });
    regionalPerformerEvents = performerEvents.filter((event) => eventWithinRadius(event, config.home, config.searchRadiusMiles));
    seatGeekDiagnostics.performerEventsFetched = performerEvents.length;
    seatGeekDiagnostics.performerEventsFilteredByDistance = performerEvents.length - regionalPerformerEvents.length;
  } catch (error) {
    warnings.push(`Performer retrieval unavailable: ${error.message}`);
  }

  if (!geographicEvents.length && !regionalPerformerEvents.length && warnings.length) throw new Error(warnings.join(' '));
  const raw = [...new Map([...geographicEvents, ...regionalPerformerEvents].map((event) => [String(event.id), event])).values()];
  const performerByArtist = new Map(resolution.resolved.map((item) => [normalizeArtistName(item.artistName), item.performerId]));
  for (const artist of artistSnapshot.artists ?? []) {
    artist.seatGeekPerformerId = performerByArtist.get(normalizeArtistName(artist.name)) ?? null;
  }
  seatGeekDiagnostics.events = raw.length;
  diagnostics.seatGeekRetrieval = seatGeekDiagnostics;
  return { events: raw.map((event) => normalizeSeatGeekEvent(event, generatedAt)), warnings };
}

function uniqueArtistWatchlist(artists) {
  const seen = new Set();
  const result = [];
  for (const artist of artists) {
    const key = normalizeArtistName(artist?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(artist);
  }
  return result;
}

async function optionalSource(source, configured, callback) {
  const startedAt = Date.now();
  if (!configured) {
    const result = { source, status: 'not configured', itemCount: 0, warningCount: 0 };
    sourceHealth.push(result);
    recordBuildSource(buildReport, source, {
      fetched: false,
      normalized: 0,
      rejected: 0,
      deduplicated: 0,
      warningCount: 0,
      failureStatus: 'not configured',
      timingMs: Date.now() - startedAt,
      status: 'not configured'
    });
    return { items: [], warnings: [] };
  }
  try {
    const result = await callback();
    const health = {
      source,
      status: result.warnings.length ? 'partial' : 'active',
      itemCount: result.items.length,
      warningCount: result.warnings.length
    };
    sourceHealth.push(health);
    recordBuildSource(buildReport, source, {
      fetched: true,
      cached: result.cached,
      normalized: result.items.length,
      rejected: result.rejectedCount,
      deduplicated: result.deduplicatedCount,
      warningCount: result.warnings.length,
      lastUsableFreshness: result.lastUsableFreshness,
      timingMs: Date.now() - startedAt,
      status: health.status
    });
    return result;
  } catch (error) {
    sourceHealth.push({ source, status: 'unavailable', itemCount: 0, warningCount: 1 });
    recordBuildSource(buildReport, source, {
      fetched: true,
      normalized: 0,
      rejected: 0,
      deduplicated: 0,
      warningCount: 1,
      failureStatus: 'unavailable',
      timingMs: Date.now() - startedAt,
      status: `unavailable: ${sanitizeErrorMessage(error)}`
    });
    return { items: [], warnings: [error.message] };
  }
}

function addPromoterEvidence(snapshot, promoterEvents, rosterArtists = []) {
  const artists = (snapshot.artists ?? []).map((artist) => ({ ...artist }));
  const names = new Set(artists.map((artist) => normalizeArtistName(artist.name)));
  const maximumSeed = Math.max(1, ...artists.map((artist) => artist.seedStrength ?? 0));
  for (const artist of rosterArtists) {
    addPromoterArtist(artists, names, maximumSeed, artist.name, 'Framework', artist.sourceUrl, 'framework-roster');
  }
  for (const event of promoterEvents) {
    const promoter = event.source === 'insomniac' ? 'Insomniac' : 'Framework';
    for (const performer of event.performers) {
      addPromoterArtist(artists, names, maximumSeed, performer.name, promoter, event.sourceUrl, 'promoter-event');
    }
  }
  return { ...snapshot, artists, artistCount: artists.length };
}

function addPromoterArtist(artists, names, maximumSeed, name, promoter, sourceUrl = null, evidenceType = 'promoter-event') {
  const key = normalizeArtistName(name);
  if (!key) return;
  if (names.has(key)) {
    const existing = artists.find((artist) => normalizeArtistName(artist.name) === key);
    if (existing?.origin === 'promoter') {
      existing.discoveryEvidence ??= [];
      if (!existing.discoveryEvidence.some((evidence) => evidence.type === evidenceType && evidence.promoter === promoter)) {
        existing.discoveryEvidence.push({ type: evidenceType, promoter, sourceUrl });
      }
    }
    return;
  }
  names.add(key);
  artists.push({
    spotifyArtistId: null,
    name: String(name).trim(),
    seedStrength: maximumSeed * 0.32,
    evidence: [],
    origin: 'promoter',
    discoveryEvidence: [{ type: evidenceType, promoter, sourceUrl }]
  });
}

function localIsoDate(date, timezone) {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function latestWindowTimestamp(windows = {}) {
  const values = Object.values(windows).map((window) => window?.fetchedAt).filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
  return values.length ? new Date(Math.max(...values)).toISOString() : null;
}

function earliestWindowExpiry(windows = {}) {
  const values = Object.values(windows).map((window) => window?.expiresAt).filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
  return values.length ? new Date(Math.min(...values)).toISOString() : null;
}

function printTiming(label, elapsedMs) {
  recordBuildStage(buildReport, label, elapsedMs);
  console.log(`${label.padEnd(21)} ${(elapsedMs / 1000).toFixed(1)}s`);
}

function scoreDistribution(candidates) {
  const buckets = {};
  for (const candidate of candidates) {
    const score = Number(candidate.ranking?.utility);
    if (!Number.isFinite(score)) continue;
    const lower = Math.floor(score / 10) * 10;
    const key = `${lower}-${lower + 9}`;
    buckets[key] = (buckets[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(buckets).sort(([left], [right]) => Number(left.split('-')[0]) - Number(right.split('-')[0])));
}

function exclusionReasons(candidates) {
  const reasons = {};
  for (const candidate of candidates) {
    if (candidate.ranking?.excluded) reasons.explicitExclusion = (reasons.explicitExclusion ?? 0) + 1;
    if (!(candidate.matchedArtists ?? []).length) reasons.unresolvedArtist = (reasons.unresolvedArtist ?? 0) + 1;
  }
  return reasons;
}

function summarizeModelPasses(groups, { inputFieldManifest = [] } = {}) {
  const passes = {};
  let callsAttempted = 0;
  let callsCompleted = 0;
  let timeouts = 0;
  let malformedOutputs = 0;
  let fallbackCount = 0;
  for (const [group, result] of groups) {
    if (!result) continue;
    if (result.passes) {
      const hasCallCounts = Object.hasOwn(result, 'callsAttempted');
      callsAttempted += hasCallCounts ? Number(result.callsAttempted) || 0 : Object.keys(result.passes).length;
      callsCompleted += hasCallCounts ? Number(result.callsCompleted) || 0 : Object.values(result.passes).filter((pass) => /locally enhanced|partial/i.test(String(pass.status))).length;
      for (const [pass, details] of Object.entries(result.passes)) {
        const key = `${group}.${pass}`;
        const status = String(details.status ?? 'unknown');
        passes[key] = {
          status,
          itemCount: Number(details.itemCount) || 0,
          missingCount: Number(details.missingCount) || 0
        };
        if (/timeout/i.test(status)) timeouts += 1;
        if (/malformed|schema|json/i.test(status)) malformedOutputs += 1;
        if (!/locally enhanced/i.test(status)) fallbackCount += 1;
      }
    } else if (group === 'overview' || group === 'editorial') {
      const status = String(result.status ?? result.mode ?? 'unavailable');
      passes[group] = { status, itemCount: Number(result.enhancedCount ?? (result.mode === 'ollama' ? 1 : 0)) || 0 };
      callsAttempted += 1;
      if (/active|ollama|locally enhanced/i.test(status)) callsCompleted += 1;
      if (/timeout/i.test(status)) timeouts += 1;
      if (/malformed|schema|json/i.test(status)) malformedOutputs += 1;
      if (!/active|ollama|locally enhanced/i.test(status)) fallbackCount += 1;
    }
  }
  return {
    callsAttempted,
    callsCompleted,
    timeouts,
    malformedOutputs,
    fallbackCount,
    inputFieldManifest: [...new Set(inputFieldManifest)].sort(),
    restrictedProvenanceExcluded: true,
    passes
  };
}
