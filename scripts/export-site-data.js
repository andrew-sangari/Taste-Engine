import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deduplicateCandidates } from '../src/candidates.js';
import { loadBriefConfig } from '../src/briefConfig.js';
import { loadEnv } from '../src/env.js';
import { buildEditorialCandidates, generateEditorialBrief } from '../src/editorial.js';
import { enrichEventsWithEdmtrain, fetchEdmtrainEvents } from '../src/edmtrain.js';
import { enhanceEventsWithOllama, enhanceSportsWithOllama, reusePreviousEnhancements } from '../src/eventEnhancement.js';
import { fetchFrameworkArtists, fetchFrameworkEvents, normalizeFrameworkEvent } from '../src/framework.js';
import { fetchInsomniacEvents, INSOMNIAC_ADAPTER_VERIFIED, normalizeInsomniacEvent } from '../src/insomniac.js';
import { applyPitcherStats, fetchDodgersHomeGames, fetchMlbPitcherStats, fetchMlbStandings } from '../src/mlb.js';
import { selectMovieCandidates } from '../src/movieSelection.js';
import { normalizeArtistName, rankCandidates, selectPublishedConcerts } from '../src/ranking.js';
import { addPromoterEvidence, applyArtistTags, knownArtistNames } from '../src/discovery.js';
import { artistTagKey, resolveArtistTags } from '../src/artistTags.js';
import { readTagCache, writeTagCache } from '../src/artistTagsCache.js';
import { withDeadline } from '../src/deadline.js';
import { applyEngagements, engagementSourceHealth } from '../src/movieEngagements.js';
import { fetchDestinationEvents } from '../src/destinationEvents.js';
import { buildOverviewBuckets } from '../src/overview.js';
import {
  enrichSportsGames,
  fetchSeatGeekSportsEvents,
  fetchTicketmasterSportsEvents,
  joinSportsTickets,
  normalizeSeatGeekSportsEvent,
  normalizeTicketmasterSportsEvent,
  sportsLeagueConfig
} from '../src/sports.js';
import { applyNflStandings, fetchNflStandings, fetchRamsHomeGames, nflSeasonsForWindow } from '../src/nfl.js';
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
import { summarizeEvidenceCoverage } from '../src/eventEvidence.js';
import { enrichSemanticEventCards, semanticSourceHealth } from '../src/nightlife/cardEnrichment.js';
import { createDecisionInferenceProvider } from '../src/nightlife/inference.js';
import { readNightlifeConfig } from '../src/nightlife/config.js';
import { buildFeedbackSnapshot, mergeSnapshotIndex } from '../src/feedbackSnapshots.js';
import { buildTasteProfile } from '../src/tasteProfile.js';
import { DEFAULT_CHANGES_TOP_N, buildChangesSinceRefresh } from '../src/projectionChanges.js';
import { updateProjectionHistory } from '../src/recommendationHistory.js';
import { FEEDBACK_POLICY } from '../src/feedbackPolicy.js';
import { deriveFeedbackState, loadFeedbackConfig, readFeedbackJournal } from '../src/feedback.js';
import { buildFeedbackReview } from '../src/feedbackReview.js';

loadEnv();

const pipelineStartedAt = Date.now();

const config = await loadBriefConfig(resolve('config/brief.json'));
const movieConfig = JSON.parse(await readFile(resolve('config/movies.json'), 'utf8'));
const sportsConfig = JSON.parse(await readFile(resolve('config/sports.json'), 'utf8'));
const personalContext = JSON.parse(await readFile(resolve('config/personal-context.json'), 'utf8'));
const sourceSnapshot = JSON.parse(await readFile(resolve('data/taste/artists.json'), 'utf8'));
const previousProjection = await readJsonIfPresent(resolve('site/app/data/upcoming.json'));
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
  const known = knownArtistNames(artistSnapshot, frameworkArtists.items);
  return { items: raw.map((event) => normalizeFrameworkEvent(event, generatedAt, { knownArtistNames: known })), warnings: [] };
});
const insomniac = await optionalSource('insomniac', true, async () => {
  if (!INSOMNIAC_ADAPTER_VERIFIED) throw new Error('Insomniac parser is unverified.');
  const insomniacDiagnostics = { warnings: [] };
  const raw = await fetchInsomniacEvents({ startDate, endDate, diagnostics: insomniacDiagnostics });
  const known = knownArtistNames(artistSnapshot, frameworkArtists.items);
  return { items: raw.map((event) => normalizeInsomniacEvent(event, generatedAt, { knownArtistNames: known })), warnings: insomniacDiagnostics.warnings ?? [] };
});
// Named festivals worth travelling for (CRSSD, Proper NYE), found by exact
// name through the ticketing APIs regardless of the home radius.
const destination = await optionalSource('destination-events', Boolean(process.env.TICKETMASTER_API_KEY || process.env.SEATGEEK_CLIENT_ID), async () => {
  const result = await fetchDestinationEvents({
    config,
    startDate,
    endDate,
    ticketmasterApiKey: process.env.TICKETMASTER_API_KEY ?? null,
    seatGeekClientId: process.env.SEATGEEK_CLIENT_ID ?? null,
    edmtrainClientKey: config.edmtrain.enabled ? process.env.EDMTRAIN_CLIENT_KEY ?? null : null,
    artistSnapshot,
    retrievedAt: generatedAt
  });
  await writePrivateJson(resolve('data/taste/destination-events.json'), { generatedAt: generatedAt.toISOString(), pending: result.pending, audit: result.audit, sources: result.sources });
  return { items: result.events, warnings: result.warnings };
});
const edmtrain = await optionalSource('edmtrain', config.edmtrain.enabled && Boolean(process.env.EDMTRAIN_CLIENT_KEY), async () => {
  const items = await fetchEdmtrainEvents({
    clientKey: process.env.EDMTRAIN_CLIENT_KEY,
    startDate,
    endDate,
    city: config.edmtrain.city,
    state: config.edmtrain.state
  });
  return { items, warnings: [] };
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
// Rams home games from ESPN's public schedule. Ticket sources stay
// observations only; an unticketed game is still a valid candidate.
const nflEnabled = sportsConfig.enabled !== false && sportsLeagueConfig(sportsSourceConfig, 'nfl').enabled !== false;
const nfl = await optionalSource('nfl', nflEnabled, async () => {
  const warnings = [];
  let games = await fetchRamsHomeGames({ startDate, endDate, timezone: config.timezone, warnings });
  let standings = new Map();
  try {
    standings = await fetchNflStandings({ season: nflSeasonsForWindow(startDate, endDate)[0] });
    games = applyNflStandings(games, standings);
  } catch (error) {
    warnings.push(`NFL standings unavailable: ${error.message}`);
  }
  return { items: enrichSportsGames(games, standings, sportsSourceConfig, { now: generatedAt }), warnings };
});
const sportsSeatGeek = await optionalSource('sports-seatgeek', Boolean(process.env.SEATGEEK_CLIENT_ID), async () => {
  const request = { clientId: process.env.SEATGEEK_CLIENT_ID, startDate, endDate, config: sportsSourceConfig, maxPages: sportsConfig.maxTicketPages };
  const raw = [
    ...await fetchSeatGeekSportsEvents(request),
    ...(nflEnabled ? await fetchSeatGeekSportsEvents({ ...request, league: 'nfl' }) : [])
  ];
  return { items: raw.map((event) => normalizeSeatGeekSportsEvent(event, generatedAt)), warnings: [] };
});
const sportsTicketmaster = await optionalSource('sports-ticketmaster', Boolean(process.env.TICKETMASTER_API_KEY), async () => {
  const request = { apiKey: process.env.TICKETMASTER_API_KEY, startDate, endDate, config: sportsSourceConfig, maxPages: sportsConfig.maxTicketPages };
  const raw = [
    ...await fetchTicketmasterSportsEvents(request),
    ...(nflEnabled ? await fetchTicketmasterSportsEvents({ ...request, league: 'nfl' }) : [])
  ];
  return { items: raw.map((event) => normalizeTicketmasterSportsEvent(event, generatedAt)), warnings: [] };
});
let sports = joinSportsTickets(
  [...mlb.items, ...nfl.items],
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
  const selected = selectMovieCandidates(enriched, movieConfig).map(({ movie, score, tasteTier, reasons }) => {
    const normalized = normalizeTmdbMovie(movie, generatedAt);
    return {
    ...normalized,
    candidateScore: Math.round(score * 10) / 10,
    tasteScore: Math.min(100, Math.round(score)),
    tasteTier,
    reasons,
    visual: resolveMovieVisual(normalized)
    };
  });
  return { items: selected, warnings: [] };
});
// Reviewed screening confirmations turn a film from "format not yet
// confirmed" into something attendable. A missing file means none yet.
let engagementInput;
try {
  engagementInput = await readJsonIfPresent(resolve('config/movie-engagements.json'));
} catch {
  engagementInput = 'invalid';
}
const movieEngagements = applyEngagements(tmdb.items, engagementInput, { priorityTheaters: movieConfig.priorityTheaters, now: generatedAt });
sourceHealth.push(engagementSourceHealth(movieEngagements));
printTiming('MLB/TMDB', Date.now() - mlbTmdbStartedAt);

const normalizationStartedAt = Date.now();
const deduplication = {};
const canonicalConcerts = deduplicateCandidates([...seatGeek.items, ...ticketmaster.items, ...framework.items, ...insomniac.items, ...destination.items], deduplication);
const discoveredSnapshot = addPromoterEvidence(artistSnapshot, [...framework.items, ...insomniac.items], frameworkArtists.items);
// Genre tags for artists the profile has never heard, from Last.fm when a key
// is configured and MusicBrainz otherwise. Cached, and capped per run.
const artistTags = await optionalSource('artist-tags', true, async () => {
  // The default path resolves to the canonical data directory even when
  // this runs from a preview copy, so lookups are never repeated.
  const tagCachePath = undefined;
  const names = discoveredSnapshot.artists.filter((artist) => artist.origin === 'promoter').map((artist) => artist.name);
  const result = await resolveArtistTags(names, {
    lastFmApiKey: process.env.LASTFM_API_KEY ?? null,
    cache: await readTagCache(tagCachePath),
    now: generatedAt,
    maxLookups: config.artistTagLookupsPerRun
  });
  await writeTagCache(tagCachePath, result.cache);
  const tagged = [...result.tags.values()].filter((tags) => tags.length).length;
  return { items: Array.from({ length: tagged }), warnings: result.warnings, value: result };
// Keyless lookups run at one request a second, so this source gets more room.
}, { deadlineMs: 300_000 });
const rankedSnapshot = applyArtistTags(discoveredSnapshot, artistTags.value?.tags ?? new Map(), artistTagKey);
const edmtrainEnrichment = enrichEventsWithEdmtrain(canonicalConcerts, edmtrain.items, rankedSnapshot);
const allConcerts = edmtrainEnrichment.events;
await writePrivateJson(resolve('data/taste/edmtrain-audit.json'), {
  generatedAt: generatedAt.toISOString(),
  matchedCount: edmtrainEnrichment.matchedCount,
  ambiguousCount: edmtrainEnrichment.ambiguousCount,
  unmatchedCount: edmtrainEnrichment.unmatchedCount,
  audit: edmtrainEnrichment.audit
});
const edmtrainHealth = sourceHealth.find((source) => source.source === 'edmtrain');
if (edmtrainHealth) {
  edmtrainHealth.itemCount = edmtrainEnrichment.matchedCount;
  edmtrainHealth.details = {
    fetchedEvents: edmtrain.items.length,
    matchedEvents: edmtrainEnrichment.matchedCount,
    lineupArtists: edmtrainEnrichment.lineupArtistCount,
    ambiguousMatches: edmtrainEnrichment.ambiguousCount,
    unmatchedAuditOnly: edmtrainEnrichment.unmatchedCount
  };
}
const feedbackConfig = await loadFeedbackConfig(resolve('config/feedback.json'));
const feedbackJournal = await readFeedbackJournal(resolve(feedbackConfig.journalPath));
const feedbackState = deriveFeedbackState(feedbackJournal.records, { journalIssues: feedbackJournal.issues });
// Feedback never changes what is published. The projection carries canonical
// scores; the site lays each person's feedback over them at read time (see
// src/feedbackPolicy.js).
const rankedAll = rankCandidates(allConcerts, rankedSnapshot, config, generatedAt);
const ranked = selectPublishedConcerts(rankedAll);
const deterministicOverviewBuckets = buildOverviewBuckets(
  ranked.map((candidate) => toDisplayEvent(candidate)),
  sports.map((game) => toDisplaySportsGame(game)),
  { now: generatedAt, currentDays: 14, currentMinScore: config.minimumUtility, planAheadMinScore: config.overviewPlanAheadMinScore, horizonDays: config.upcomingHorizonDays }
);
const deterministicOverview = [...deterministicOverviewBuckets.current, ...deterministicOverviewBuckets.planAhead];
const overviewMusicIds = deterministicOverview.filter((item) => item.vertical === 'music').map((item) => item.id);
const overviewSportsIds = deterministicOverview.filter((item) => item.vertical === 'sports').map((item) => item.id);
const overviewCurrentIds = deterministicOverviewBuckets.current.map((item) => item.id);
const overviewPlanAheadIds = deterministicOverviewBuckets.planAhead.map((item) => item.id);
const semanticEnrichment = await enrichSemanticEventCards(ranked, {
  provider: createDecisionInferenceProvider(readNightlifeConfig(process.env)),
  now: generatedAt,
  requiredIds: overviewMusicIds,
  // Compared locally against Jev's event characterization; never sent to it.
  preferences: { topTags: artistSnapshot?.topTags ?? [] }
});
sourceHealth.push(semanticSourceHealth(semanticEnrichment));
// Evidence stays out of the published projection: a display row must not become
// a backdoor to source material or imply that an old snapshot is
// inference-capable. It is written to the private, gitignored data directory so
// `npm run nightlife:cards` can evaluate the evidence layer against what the
// sources actually supplied.
const evidenceArtifactPath = resolve('data/nightlife/evidence-latest.json');
await mkdir(dirname(evidenceArtifactPath), { recursive: true });
await writeFile(evidenceArtifactPath, `${JSON.stringify({
  generatedAt: new Date(generatedAt).toISOString(),
  // The profile-scoped signals the personal-relevance comparison reads, so the
  // live evaluation can reproduce it. Private: this file is never published.
  preferences: { topTags: artistSnapshot?.topTags ?? [] },
  candidates: ranked.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    sources: [...new Set((candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.source))],
    eventEvidence: candidate.eventEvidence ?? null,
    // Occurrence-level evidence is what lets field-by-field merging run again
    // during evaluation exactly as it ran here.
    sourceOccurrences: candidate.sourceOccurrences ?? [],
    startLocal: candidate.startLocal ?? null,
    timeTbd: Boolean(candidate.timeTbd),
    // The same fields the published row already carries for artist matches.
    matchedArtists: (candidate.matchedArtists ?? []).map(({ name, origin, primary }) => ({ name, origin, primary })),
    ranking: { utility: candidate.ranking?.utility ?? null }
  }))
}, null, 2)}\n`);
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
reusePreviousEnhancements(sportsEnhancement, sports, previousProjection?.sports ?? []);
sourceHealth.push({
  source: 'ollama-sports',
  status: sportsEnhancement.mode === 'ollama' ? 'active' : sportsEnhancement.mode === 'partial' ? 'partial' : 'unavailable',
  itemCount: sportsEnhancement.enhancedGameCount,
  warningCount: Object.values(sportsEnhancement.passes).filter((pass) => pass.status !== 'locally enhanced').length,
  details: { reusedPasses: sportsEnhancement.reusedPassCount ?? 0, reusedItems: sportsEnhancement.reusedItemCount ?? 0 }
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
reusePreviousEnhancements(eventEnhancement, ranked, previousProjection?.events ?? []);
sourceHealth.push({
  source: 'ollama-events',
  status: eventEnhancement.mode === 'ollama' ? 'active' : eventEnhancement.mode === 'partial' ? 'partial' : 'unavailable',
  itemCount: eventEnhancement.enhancedEventCount,
  warningCount: Object.values(eventEnhancement.passes).filter((pass) => pass.status !== 'locally enhanced').length,
  details: { reusedPasses: eventEnhancement.reusedPassCount ?? 0, reusedItems: eventEnhancement.reusedItemCount ?? 0 }
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
  events: ranked.map((candidate) => toDisplayEvent({
    ...candidate,
    semanticInsight: semanticEnrichment.byId.get(String(candidate.id)) ?? null
  }, enhancementFor(eventEnhancement.byId.get(candidate.id)))),
  sports: sports.map((game) => toDisplaySportsGame(game, enhancementFor(sportsEnhancement.byId.get(game.id)))),
  movies: movieEngagements.movies,
  editorialCandidates: buildEditorialCandidates({ events: ranked, sports, movies: movieEngagements.movies })
};
// Public feedback snapshots carry event identity plus an opaque id; the
// provider-native evidence entities stay in the private snapshot index and
// are rehydrated by taste:feedback:import. Attached before the overview is
// built so overview cards inherit them.
const feedbackSnapshotEntries = [];
for (const [displayItems, vertical, sourceItems] of [[exportData.events, 'music', ranked], [exportData.sports, 'sports', sports]]) {
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  for (const display of displayItems) {
    const snapshot = buildFeedbackSnapshot(sourceById.get(display.id) ?? display, vertical);
    if (!snapshot) continue;
    display.feedbackSnapshot = snapshot.public;
    feedbackSnapshotEntries.push(snapshot);
  }
}

const overviewBuckets = buildOverviewBuckets(exportData.events, exportData.sports, {
  now: generatedAt,
  currentDays: 14,
  currentMinScore: config.minimumUtility,
  planAheadMinScore: config.overviewPlanAheadMinScore,
  horizonDays: config.upcomingHorizonDays
});
exportData.overview = overviewBuckets.current;
exportData.overviewPlanAhead = overviewBuckets.planAhead;
exportData.overviewAdvisory = overviewAdvisory;

exportData.tasteProfile = buildTasteProfile(artistSnapshot, {
  feedbackState
});
// What the site needs to re-run the shortlist over feedback-adjusted scores.
exportData.rankingConfig = { currentMinScore: config.minimumUtility, planAheadMinScore: config.overviewPlanAheadMinScore, currentDays: 14 };
exportData.feedbackLearning = { applied: false, mode: 'read-time-overlay', policyVersion: FEEDBACK_POLICY.version };
// Private report: what the local journal's feedback would move on this
// projection. The site computes the same thing live from its own records.
await writePrivateJson(resolve(feedbackConfig.reportPath), {
  ...buildFeedbackReview({
    projection: exportData,
    records: feedbackConfig.enabled ? feedbackState.activeRecords : [],
    now: generatedAt,
    currentMinScore: config.minimumUtility,
    planAheadMinScore: config.overviewPlanAheadMinScore
  })
});

const acceptedProjectionPath = valueAfterFlag('--accepted-projection') ?? process.env.ACCEPTED_PROJECTION_PATH ?? null;
if (acceptedProjectionPath) {
  try {
    const accepted = JSON.parse(await readFile(resolve(acceptedProjectionPath), 'utf8'));
    const changes = buildChangesSinceRefresh(stripVolatileProjectionFields(accepted), stripVolatileProjectionFields(exportData), {
      topN: config.changesSinceRefreshTopN ?? DEFAULT_CHANGES_TOP_N
    });
    if (changes) exportData.changesSinceRefresh = changes;
  } catch (error) {
    diagnostics.changesSinceRefreshWarning = sanitizeErrorMessage(error);
  }
}
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
try {
  await mergeSnapshotIndex(feedbackSnapshotEntries, {
    now: generatedAt,
    retentionDays: config.feedbackSnapshotRetentionDays ?? undefined
  });
} catch (error) {
  diagnostics.feedbackSnapshotIndexWarning = sanitizeErrorMessage(error);
}
try {
  await updateProjectionHistory({
    projection: exportData,
    now: generatedAt,
    retentionDays: config.recommendationHistoryRetentionDays ?? undefined,
    shortlistLimit: 5
  });
} catch (error) {
  diagnostics.recommendationHistoryWarning = sanitizeErrorMessage(error);
  exportData.recentHistory = Array.isArray(previousProjection?.recentHistory) ? previousProjection.recentHistory : [];
}
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

async function optionalSource(source, configured, callback, { deadlineMs = Number(process.env.TASTE_SOURCE_DEADLINE_MS) || 120_000 } = {}) {
  const startedAt = Date.now();
  const reportsEventEvidence = ['ticketmaster', 'framework', 'insomniac'].includes(source);
  if (!configured) {
    const result = {
      source,
      status: 'not configured',
      itemCount: 0,
      warningCount: 0,
      ...(reportsEventEvidence ? { details: { evidenceCount: 0, modelEligibleCount: 0, fieldCoverage: {} } } : {})
    };
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
    const result = await withDeadline(callback(), deadlineMs, source);
    const health = {
      source,
      status: result.warnings.length ? 'partial' : 'active',
      itemCount: result.items.length,
      warningCount: result.warnings.length,
      ...(reportsEventEvidence ? { details: summarizeEvidenceCoverage(result.items) } : {})
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
    sourceHealth.push({
      source,
      status: 'unavailable',
      itemCount: 0,
      warningCount: 1,
      ...(reportsEventEvidence ? { details: { evidenceCount: 0, modelEligibleCount: 0, fieldCoverage: {}, reason: sanitizeErrorMessage(error) } } : {})
    });
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

function localIsoDate(date, timezone) {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

function valueAfterFlag(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

// Volatile blocks would otherwise make the diff recursively report changes
// caused by the previous diff itself.
function stripVolatileProjectionFields(projection) {
  const { changesSinceRefresh: _changes, tasteProfile: _profile, ...rest } = projection ?? {};
  return rest;
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
