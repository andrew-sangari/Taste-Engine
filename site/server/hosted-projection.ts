/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- The generated deterministic engine intentionally has no hand-maintained declaration surface.
// The generated deterministic engine bundle preserves the runtime contracts of
// the source JavaScript modules; its inferred declaration shapes are narrower
// than the actual optional adapter inputs used by this orchestration layer.
import {
  applyPitcherStats,
  buildExpandedArtistSnapshot,
  buildOverviewBuckets,
  buildTasteProfile,
  deduplicateCandidates,
  enrichEventsWithEdmtrain,
  enrichMovieMetadata,
  enrichSportsGames,
  eventWithinRadius,
  fetchDodgersHomeGames,
  fetchEdmtrainEvents,
  fetchFrameworkArtists,
  fetchFrameworkEvents,
  fetchInsomniacEvents,
  fetchMlbPitcherStats,
  fetchMlbStandings,
  fetchSeatGeekEvents,
  fetchSeatGeekEventsForPerformers,
  fetchSeatGeekSportsEvents,
  fetchTicketmasterEvents,
  fetchTicketmasterEventsForArtists,
  fetchTicketmasterSportsEvents,
  fetchUpcomingMovies,
  joinSportsTickets,
  normalizeArtistName,
  normalizeFrameworkEvent,
  normalizeInsomniacEvent,
  normalizeSeatGeekEvent,
  normalizeSeatGeekSportsEvent,
  normalizeTicketmasterEvent,
  normalizeTicketmasterSportsEvent,
  normalizeTmdbMovie,
  rankCandidates,
  resolveMovieVisual,
  resolveMusicVisual,
  resolveSeatGeekPerformers,
  resolveSportsVisual,
  selectMovieCandidates,
} from "./deterministic-engine.js";
import { enhanceHostedMusic, enhanceHostedSports, generateHostedEditorial } from "./hosted-advisory.ts";
import { readHostedPipelineConfig } from "./hosted-config.ts";

type SourceHealth = {
  source: string;
  status: "active" | "partial" | "unavailable" | "not configured";
  itemCount: number;
  warningCount: number;
  details?: Record<string, unknown>;
};

type SourceResult = {
  items: unknown[];
  warnings: string[];
};

export type HostedProjectionResult = {
  projection: Record<string, unknown>;
  artistSnapshot: Record<string, unknown>;
  sourceHealth: SourceHealth[];
  publicationBlockers: string[];
};

export async function buildHostedProjection({
  sourceSnapshot,
  initialSourceHealth,
  previousProjection,
  generatedAt = new Date(),
}: {
  sourceSnapshot: Record<string, unknown>;
  initialSourceHealth: SourceHealth[];
  previousProjection: Record<string, unknown> | null;
  generatedAt?: Date;
}): Promise<HostedProjectionResult> {
  const config = readHostedPipelineConfig();
  const startDate = localIsoDate(generatedAt, config.brief.timezone);
  const end = new Date(generatedAt);
  end.setDate(end.getDate() + config.brief.upcomingHorizonDays);
  const endDate = localIsoDate(end, config.brief.timezone);
  const sourceHealth = [...initialSourceHealth];

  const [expandedResult, frameworkArtistsResult] = await Promise.all([
    optionalSource(sourceHealth, "lastfm", Boolean(process.env.LASTFM_API_KEY), async () => {
      const snapshot = await buildExpandedArtistSnapshot(sourceSnapshot, config.brief, {
        apiKey: process.env.LASTFM_API_KEY,
        generatedAt,
      });
      return { items: array(snapshot.artists), warnings: array(snapshot.warnings).map(String), value: snapshot };
    }),
    optionalSource(sourceHealth, "framework-artists", true, async () => ({
      items: await fetchFrameworkArtists(),
      warnings: [],
    })),
  ]);
  const artistSnapshot = isRecord(expandedResult.value)
    ? expandedResult.value
    : {
      ...sourceSnapshot,
      source: "hosted-spotify",
      sourceGeneratedAt: sourceSnapshot.generatedAt,
      artistCount: array(sourceSnapshot.artists).length,
      topTags: [],
    };
  const frameworkArtists = frameworkArtistsResult.items;

  const sportsSourceConfig = {
    ...config.sports,
    home: config.brief.home,
    searchRadiusMiles: config.brief.searchRadiusMiles,
  };

  const [
    seatGeek,
    ticketmaster,
    framework,
    insomniac,
    edmtrain,
    mlb,
    sportsSeatGeek,
    sportsTicketmaster,
    tmdb,
  ] = await Promise.all([
    optionalSource(sourceHealth, "seatgeek", Boolean(process.env.SEATGEEK_CLIENT_ID), async () => {
      const warnings: string[] = [];
      let geographic: unknown[] = [];
      let performerEvents: unknown[] = [];
      try {
        geographic = await fetchSeatGeekEvents({
          clientId: process.env.SEATGEEK_CLIENT_ID,
          startDate,
          endDate,
          config: config.brief,
          maxPages: config.brief.maxSeatGeekPages,
          windowDays: config.brief.seatGeekWindowDays,
        });
      } catch {
        warnings.push("SeatGeek geographic retrieval was unavailable.");
      }
      try {
        const watchlist = uniqueArtists([
          ...array(artistSnapshot.artists).slice(0, config.brief.seatGeekPerformerArtistLimit),
          ...frameworkArtists.slice(0, config.brief.frameworkArtistLimit),
        ]);
        const resolution = await resolveSeatGeekPerformers(watchlist, {
          clientId: process.env.SEATGEEK_CLIENT_ID,
          concurrency: 5,
        });
        const artistByName = new Map(array(resolution.resolved)
          .map((item) => [normalizeArtistName(record(item).artistName), String(record(item).performerId)]));
        for (const artist of array(artistSnapshot.artists).map(record)) {
          artist.seatGeekPerformerId = artistByName.get(normalizeArtistName(artist.name)) ?? null;
        }
        const raw = await fetchSeatGeekEventsForPerformers({
          performerIds: array(resolution.resolved).map((item) => record(item).performerId),
          clientId: process.env.SEATGEEK_CLIENT_ID,
          startDate,
          endDate,
          config: config.brief,
          maxPages: config.brief.maxSeatGeekPages,
        });
        performerEvents = array(raw).filter((event) =>
          eventWithinRadius(event, config.brief.home, config.brief.searchRadiusMiles));
      } catch {
        warnings.push("SeatGeek performer retrieval was unavailable.");
      }
      const raw = [...new Map([...geographic, ...performerEvents]
        .map((event) => [String(record(event).id ?? record(event).url ?? ""), event])
        .filter(([key]) => key)).values()];
      if (!raw.length && warnings.length) throw new Error("SeatGeek retrieval failed.");
      return { items: raw.map((event) => normalizeSeatGeekEvent(event, generatedAt)), warnings };
    }),
    optionalSource(sourceHealth, "ticketmaster", Boolean(process.env.TICKETMASTER_API_KEY), async () => {
      const broad = await fetchTicketmasterEvents({
        apiKey: process.env.TICKETMASTER_API_KEY,
        startDate,
        endDate,
        config: config.brief,
      });
      const expanded = await fetchTicketmasterEventsForArtists({
        artists: frameworkArtists,
        apiKey: process.env.TICKETMASTER_API_KEY,
        startDate,
        endDate,
        config: config.brief,
        maxArtists: config.brief.ticketmasterArtistQueryLimit,
        maxPages: 1,
        concurrency: 4,
      });
      const merged = [...new Map([...array(broad), ...array(expanded.events)]
        .map((event) => [String(record(event).id ?? record(event).url ?? ""), event])
        .filter(([key]) => key)).values()];
      return {
        items: merged.map((event) => normalizeTicketmasterEvent(event, generatedAt)),
        warnings: array(expanded.warnings).map(String),
      };
    }),
    optionalSource(sourceHealth, "framework", true, async () => ({
      items: array(await fetchFrameworkEvents({ startDate, endDate }))
        .map((event) => normalizeFrameworkEvent(event, generatedAt)),
      warnings: [],
    })),
    optionalSource(sourceHealth, "insomniac", true, async () => ({
      items: array(await fetchInsomniacEvents({ startDate, endDate }))
        .map((event) => normalizeInsomniacEvent(event, generatedAt)),
      warnings: [],
    })),
    optionalSource(sourceHealth, "edmtrain", config.brief.edmtrain.enabled && Boolean(process.env.EDMTRAIN_CLIENT_KEY), async () => ({
      items: await fetchEdmtrainEvents({
        clientKey: process.env.EDMTRAIN_CLIENT_KEY,
        startDate,
        endDate,
        city: config.brief.edmtrain.city,
        state: config.brief.edmtrain.state,
      }),
      warnings: [],
    })),
    optionalSource(sourceHealth, "mlb", config.sports.enabled, async () => {
      const warnings: string[] = [];
      let games = await fetchDodgersHomeGames({
        teamId: config.sports.teamId,
        startDate,
        endDate,
        homeVenueIds: config.sports.homeOnly ? config.sports.homeVenueIds : [],
        timezone: config.brief.timezone,
      });
      let standings = new Map();
      try {
        standings = await fetchMlbStandings({ season: generatedAt.getFullYear() });
      } catch {
        warnings.push("MLB standings were unavailable.");
      }
      try {
        const pitcherIds = array(games).flatMap((game) => {
          const pitchers = record(record(game).probablePitchers);
          return [record(pitchers.home).id, record(pitchers.away).id].filter(Boolean);
        });
        const stats = await fetchMlbPitcherStats(pitcherIds, {
          season: generatedAt.getFullYear(),
          maxPitchers: config.sports.maxPitcherStats,
        });
        games = applyPitcherStats(games, stats);
      } catch {
        warnings.push("MLB pitcher enrichment was unavailable.");
      }
      return {
        items: enrichSportsGames(games, standings, sportsSourceConfig, { now: generatedAt }),
        warnings,
      };
    }),
    optionalSource(sourceHealth, "sports-seatgeek", Boolean(process.env.SEATGEEK_CLIENT_ID), async () => ({
      items: array(await fetchSeatGeekSportsEvents({
        clientId: process.env.SEATGEEK_CLIENT_ID,
        startDate,
        endDate,
        config: sportsSourceConfig,
        maxPages: config.sports.maxTicketPages,
      })).map((event) => normalizeSeatGeekSportsEvent(event, generatedAt)),
      warnings: [],
    })),
    optionalSource(sourceHealth, "sports-ticketmaster", Boolean(process.env.TICKETMASTER_API_KEY), async () => ({
      items: array(await fetchTicketmasterSportsEvents({
        apiKey: process.env.TICKETMASTER_API_KEY,
        startDate,
        endDate,
        config: sportsSourceConfig,
        maxPages: config.sports.maxTicketPages,
      })).map((event) => normalizeTicketmasterSportsEvent(event, generatedAt)),
      warnings: [],
    })),
    optionalSource(sourceHealth, "tmdb", Boolean(process.env.TMDB_ACCESS_TOKEN || process.env.TMDB_API_KEY), async () => {
      const raw = await fetchUpcomingMovies({
        accessToken: process.env.TMDB_ACCESS_TOKEN,
        apiKey: process.env.TMDB_API_KEY,
        startDate,
        endDate,
      });
      const enriched = await enrichMovieMetadata(raw, {
        accessToken: process.env.TMDB_ACCESS_TOKEN,
        apiKey: process.env.TMDB_API_KEY,
      });
      const selected = selectMovieCandidates(enriched, config.movies).map((selection: unknown) => {
        const item = record(selection);
        const normalized = normalizeTmdbMovie(item.movie, generatedAt);
        return {
          ...normalized,
          candidateScore: Math.round(Number(item.score ?? 0) * 10) / 10,
          tasteScore: Math.min(100, Math.round(Number(item.score ?? 0))),
          tasteTier: item.tasteTier,
          reasons: item.reasons,
          visual: resolveMovieVisual(normalized),
        };
      });
      return { items: selected, warnings: [] };
    }),
  ]);

  const deduplication: Record<string, unknown> = {};
  const canonicalConcerts = deduplicateCandidates(
    [...seatGeek.items, ...ticketmaster.items, ...framework.items, ...insomniac.items],
    deduplication,
  );
  const rankedSnapshot = addPromoterEvidence(
    artistSnapshot,
    [...framework.items, ...insomniac.items],
    frameworkArtists,
  );
  const edmtrainEnrichment = enrichEventsWithEdmtrain(canonicalConcerts, edmtrain.items, rankedSnapshot);
  updateEdmtrainHealth(sourceHealth, edmtrain.items.length, edmtrainEnrichment);
  const rankedAll = rankCandidates(edmtrainEnrichment.events, rankedSnapshot, config.brief, generatedAt);
  const ranked = array(rankedAll)
    .filter((candidate) => !record(record(candidate).ranking).excluded && array(record(candidate).matchedArtists).length > 0)
    .slice(0, 120);
  const sports = joinSportsTickets(
    mlb.items,
    [...sportsSeatGeek.items, ...sportsTicketmaster.items],
    sportsSourceConfig,
    generatedAt,
  );

  const deterministicMusic = ranked.map((candidate) => toDisplayEvent(candidate, null));
  const deterministicSports = array(sports).map((game) => toDisplaySportsGame(game, null));
  await attachFeedbackSnapshots(deterministicMusic, "music");
  await attachFeedbackSnapshots(deterministicSports, "sports");
  const initialOverview = buildOverviewBuckets(deterministicMusic, deterministicSports, {
    now: generatedAt,
    currentDays: 14,
    planAheadMinScore: config.brief.overviewPlanAheadMinScore,
    horizonDays: config.brief.upcomingHorizonDays,
  });
  const requiredMusicIds = [...array(initialOverview.current), ...array(initialOverview.planAhead)]
    .filter((item) => record(item).vertical === "music")
    .map((item) => String(record(item).id));
  const requiredSportsIds = [...array(initialOverview.current), ...array(initialOverview.planAhead)]
    .filter((item) => record(item).vertical === "sports")
    .map((item) => String(record(item).id));

  const musicAdvisory = await enhanceHostedMusic(
    ranked.map(record) as Array<Record<string, unknown> & { id: string }>,
    config.personalContext,
    requiredMusicIds,
  );
  const sportsAdvisory = await enhanceHostedSports(
    array(sports).map(record) as Array<Record<string, unknown> & { id: string }>,
    config.personalContext,
    requiredSportsIds,
  );
  sourceHealth.push(advisoryHealth("ollama-events", musicAdvisory));
  sourceHealth.push(advisoryHealth("ollama-sports", sportsAdvisory));

  const events = ranked.map((candidate) =>
    toDisplayEvent(candidate, nonEmpty(musicAdvisory.byId.get(String(record(candidate).id)))));
  const sportsDisplay = array(sports).map((game) =>
    toDisplaySportsGame(game, nonEmpty(sportsAdvisory.byId.get(String(record(game).id)))));
  await attachFeedbackSnapshots(events, "music");
  await attachFeedbackSnapshots(sportsDisplay, "sports");
  const overview = buildOverviewBuckets(events, sportsDisplay, {
    now: generatedAt,
    currentDays: 14,
    planAheadMinScore: config.brief.overviewPlanAheadMinScore,
    horizonDays: config.brief.upcomingHorizonDays,
  });
  const overviewItems = [...array(overview.current), ...array(overview.planAhead)].map(record);
  const enhancedOverviewCount = overviewItems.filter((item) => {
    const id = String(item.id ?? "");
    return nonEmpty(musicAdvisory.byId.get(id)) || nonEmpty(sportsAdvisory.byId.get(id));
  }).length;
  const overviewCount = overviewItems.length;
  const overviewAdvisory = {
    queuedCount: overviewCount,
    enhancedCount: enhancedOverviewCount,
    model: musicAdvisory.model ?? sportsAdvisory.model,
    status: overviewCount === 0 || enhancedOverviewCount === overviewCount
      ? "active"
      : enhancedOverviewCount > 0 ? "partial" : "unavailable",
  };
  sourceHealth.push({
    source: "ollama-overview",
    status: overviewAdvisory.status as SourceHealth["status"],
    itemCount: enhancedOverviewCount,
    warningCount: Math.max(0, overviewCount - enhancedOverviewCount),
  });

  const projection: Record<string, unknown> = {
    schemaVersion: 5,
    generatedAt: generatedAt.toISOString(),
    horizon: { startDate, endDate, days: config.brief.upcomingHorizonDays },
    sourcePlaylistCount: Number(sourceSnapshot.playlistCount ?? 0),
    sourceArtistCount: Number(sourceSnapshot.sourceArtistCount ?? array(sourceSnapshot.artists).length),
    topArtistCount: Number(sourceSnapshot.topArtistCount ?? 0),
    expandedArtistCount: Number(rankedSnapshot.artistCount ?? array(rankedSnapshot.artists).length),
    scannedEventCount: array(edmtrainEnrichment.events).length,
    sourceHealth,
    priorityTheaters: config.movies.priorityTheaters,
    sportsConfig: {
      teamName: config.sports.teamName,
      featuredInterestThreshold: config.sports.featuredInterestThreshold,
    },
    events,
    sports: sportsDisplay,
    movies: tmdb.items,
    overview: overview.current,
    overviewPlanAhead: overview.planAhead,
    overviewAdvisory,
    tasteProfile: buildTasteProfile(rankedSnapshot),
    eventEnhancement: {
      mode: musicAdvisory.mode,
      model: musicAdvisory.model,
      enhancedEventCount: musicAdvisory.enhancedCount,
      passes: musicAdvisory.passes,
    },
    sportsEnhancement: {
      mode: sportsAdvisory.mode,
      model: sportsAdvisory.model,
      enhancedGameCount: sportsAdvisory.enhancedCount,
      passes: sportsAdvisory.passes,
    },
  };
  projection.editorial = await generateHostedEditorial(projection, config.personalContext);
  sourceHealth.push({
    source: "ollama",
    status: record(projection.editorial).mode === "ollama" ? "active" : "unavailable",
    itemCount: record(projection.editorial).mode === "ollama" ? 1 : 0,
    warningCount: record(projection.editorial).mode === "ollama" ? 0 : 1,
  });
  projection.recentHistory = buildRecentHistory(projection, previousProjection, generatedAt);

  const blockers = validateProjection(projection, sourceHealth);
  return { projection, artistSnapshot: rankedSnapshot, sourceHealth, publicationBlockers: blockers };
}

async function optionalSource(
  health: SourceHealth[],
  source: string,
  configured: boolean,
  callback: () => Promise<SourceResult & { value?: unknown }>,
): Promise<SourceResult & { value?: unknown }> {
  if (!configured) {
    health.push({ source, status: "not configured", itemCount: 0, warningCount: 0 });
    return { items: [], warnings: [] };
  }
  try {
    const result = await callback();
    health.push({
      source,
      status: result.warnings.length ? "partial" : "active",
      itemCount: result.items.length,
      warningCount: result.warnings.length,
    });
    return result;
  } catch {
    health.push({ source, status: "unavailable", itemCount: 0, warningCount: 1 });
    return { items: [], warnings: [`${source} unavailable.`] };
  }
}

function addPromoterEvidence(snapshot: Record<string, unknown>, promoterEvents: unknown[], rosterArtists: unknown[]) {
  const artists = array(snapshot.artists).map((artist) => ({ ...record(artist) }));
  const names = new Set(artists.map((artist) => normalizeArtistName(artist.name)));
  const maximumSeed = Math.max(1, ...artists.map((artist) => Number(artist.seedStrength ?? 0)));
  const add = (name: unknown, promoter: string, sourceUrl: unknown, type: string) => {
    const normalized = normalizeArtistName(name);
    if (!normalized || names.has(normalized)) return;
    names.add(normalized);
    artists.push({
      spotifyArtistId: null,
      name: String(name).trim(),
      seedStrength: maximumSeed * 0.32,
      evidence: [],
      origin: "promoter",
      discoveryEvidence: [{ type, promoter, sourceUrl: sourceUrl ?? null }],
    });
  };
  for (const artist of rosterArtists.map(record)) add(artist.name, "Framework", artist.sourceUrl, "framework-roster");
  for (const event of promoterEvents.map(record)) {
    const promoter = event.source === "insomniac" ? "Insomniac" : "Framework";
    for (const performer of array(event.performers).map(record)) {
      add(performer.name, promoter, event.sourceUrl, "promoter-event");
    }
  }
  return { ...snapshot, artists, artistCount: artists.length };
}

function toDisplayEvent(candidateInput: unknown, localEnhancement: Record<string, unknown> | null) {
  const candidate = record(candidateInput);
  const occurrences = array(candidate.sourceOccurrences).map(record);
  const sourceLinks = [...new Map(occurrences
    .filter((occurrence) => occurrence.sourceUrl)
    .map((occurrence) => [
      `${occurrence.source}|${occurrence.sourceUrl}`,
      { source: occurrence.source, url: occurrence.sourceUrl },
    ])).values()];
  const ranking = { ...record(candidate.ranking) };
  delete ranking.playlistAffinity;
  delete ranking.topItemsAffinity;
  delete ranking.corroborationBonus;
  return {
    id: candidate.id,
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    sources: [...new Set(occurrences.map((occurrence) => occurrence.source))],
    sourceLinks,
    eventType: classifyEventType(candidate),
    startLocal: candidate.startLocal,
    timeTbd: candidate.timeTbd === true,
    venue: candidate.venue,
    performers: array(candidate.performers).map((performer) => ({
      name: record(performer).name,
      primary: record(performer).primary === true,
    })),
    ticketObservation: candidate.ticketObservation,
    matchedArtists: array(candidate.matchedArtists).map((artist) => {
      const value = record(artist);
      return {
        spotifyArtistId: value.spotifyArtistId,
        name: value.name,
        seedStrength: value.seedStrength,
        origin: value.origin,
        matchMethod: value.matchMethod,
        primary: value.primary,
      };
    }),
    lineupDisplay: sanitizeLineup(candidate.lineupDisplay),
    visual: candidate.visual ?? resolveMusicVisual(candidate),
    ranking,
    localEnhancement,
  };
}

function toDisplaySportsGame(gameInput: unknown, localEnhancement: Record<string, unknown> | null) {
  const game = record(gameInput);
  const links = [
    ...array(game.sourceOccurrences).map(record)
      .filter((occurrence) => occurrence.sourceUrl)
      .map((occurrence) => ({ source: occurrence.source, url: occurrence.sourceUrl })),
    ...array(game.ticketObservations).map(record)
      .filter((observation) => observation.url)
      .map((observation) => ({ source: observation.source, url: observation.url })),
  ];
  return {
    id: game.id,
    source: "mlb",
    sourceUrl: game.sourceUrl,
    startLocal: game.startLocal,
    timeTbd: game.timeTbd === true,
    venue: game.venue,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    series: game.series,
    sportsContext: game.sportsContext,
    tags: game.tags,
    ticketObservations: game.ticketObservations,
    sourceLinks: [...new Map(links.map((link) => [`${link.source}|${link.url}`, link])).values()],
    ranking: game.ranking,
    visual: game.visual ?? resolveSportsVisual(game),
    localEnhancement,
  };
}

async function attachFeedbackSnapshots(items: Array<Record<string, unknown>>, vertical: "music" | "sports") {
  for (const item of items) {
    const date = String(item.startLocal ?? "").slice(0, 10);
    const title = vertical === "sports"
      ? `${record(item.awayTeam).name ?? "Away"} at ${record(item.homeTeam).name ?? "Home"}`
      : String(item.title ?? "");
    if (!item.id || !date || !title) continue;
    const snapshotId = `fs-${(await sha256(JSON.stringify({
      canonicalEventId: item.id,
      eventDateLocal: date,
      eventTitleSnapshot: title,
      vertical,
    }))).slice(0, 24)}`;
    item.feedbackSnapshot = {
      feedbackSnapshotId: snapshotId,
      canonicalEventId: item.id,
      eventDateLocal: date,
      eventTitleSnapshot: title,
      vertical,
    };
  }
}

function buildRecentHistory(
  projection: Record<string, unknown>,
  previous: Record<string, unknown> | null,
  now: Date,
) {
  const prior = array(previous?.recentHistory).map(record);
  const byId = new Map(prior.map((item) => [String(item.historyId), { ...item }]));
  const surfaced = [
    ...array(projection.overview).map((item, index) => ({ item: record(item), surface: "overview", rank: index + 1 })),
    ...array(projection.overviewPlanAhead).map((item, index) => ({ item: record(item), surface: "plan-ahead", rank: index + 1 })),
    ...array(projection.events).slice(0, 5).map((item, index) => ({ item: record(item), surface: "shortlist", rank: index + 1 })),
    ...array(projection.sports).slice(0, 5).map((item, index) => ({ item: record(item), surface: "shortlist", rank: index + 1 })),
  ];
  for (const entry of surfaced) {
    const feedback = record(entry.item.feedbackSnapshot);
    const id = String(entry.item.id ?? "");
    const date = String(entry.item.startLocal ?? "").slice(0, 10);
    if (!id || !date) continue;
    const historyId = `rh-${id}-${date}`;
    const existing = byId.get(historyId);
    const title = String(entry.item.title ?? `${record(entry.item.awayTeam).name ?? "Away"} at ${record(entry.item.homeTeam).name ?? "Home"}`);
    const surfaces = [...new Set([...(array(existing?.surfaces).map(String)), entry.surface])];
    byId.set(historyId, {
      historyId,
      canonicalEventId: id,
      feedbackSnapshotId: feedback.feedbackSnapshotId ?? null,
      vertical: feedback.vertical ?? entry.item.vertical ?? (entry.item.source === "mlb" ? "sports" : "music"),
      title,
      dateLocal: date,
      locationLabel: String(record(entry.item.venue).name ?? ""),
      firstShownAt: existing?.firstShownAt ?? now.toISOString(),
      lastShownAt: now.toISOString(),
      surfaces,
      bestRank: Math.min(Number(existing?.bestRank ?? Infinity), entry.rank),
    });
  }
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 90);
  return [...byId.values()]
    .filter((item) => new Date(`${item.dateLocal}T23:59:59Z`) >= cutoff)
    .sort((left, right) => String(right.dateLocal).localeCompare(String(left.dateLocal)))
    .slice(0, 100);
}

function validateProjection(projection: Record<string, unknown>, health: SourceHealth[]): string[] {
  const blockers: string[] = [];
  if (projection.schemaVersion !== 5) blockers.push("Projection schema version is invalid.");
  if (!Number.isFinite(Date.parse(String(projection.generatedAt ?? "")))) blockers.push("Projection timestamp is invalid.");
  for (const key of ["events", "sports", "movies", "overview", "overviewPlanAhead", "sourceHealth"]) {
    if (!Array.isArray(projection[key])) blockers.push(`Projection ${key} is invalid.`);
  }
  const candidateSources = ["seatgeek", "ticketmaster", "framework", "insomniac", "mlb", "tmdb"];
  if (!health.some((item) => candidateSources.includes(item.source) && ["active", "partial"].includes(item.status))) {
    blockers.push("Every hosted candidate source was unavailable; the previous projection was preserved.");
  }
  if (new TextEncoder().encode(JSON.stringify(projection)).byteLength > 3_000_000) {
    blockers.push("Projection exceeds the D1 publication size limit.");
  }
  return blockers;
}

function advisoryHealth(source: string, result: {
  mode: string;
  enhancedCount: number;
  passes: Record<string, { status: string }>;
}): SourceHealth {
  return {
    source,
    status: result.mode === "ollama" ? "active" : result.mode === "partial" ? "partial" : "unavailable",
    itemCount: result.enhancedCount,
    warningCount: Object.values(result.passes).filter((pass) => pass.status !== "cloud enhanced").length,
  };
}

function updateEdmtrainHealth(health: SourceHealth[], fetched: number, enrichment: unknown) {
  const item = health.find((entry) => entry.source === "edmtrain");
  if (!item) return;
  const value = record(enrichment);
  item.itemCount = Number(value.matchedCount ?? 0);
  item.details = {
    fetchedEvents: fetched,
    matchedEvents: Number(value.matchedCount ?? 0),
    lineupArtists: Number(value.lineupArtistCount ?? 0),
    ambiguousMatches: Number(value.ambiguousCount ?? 0),
    unmatchedAuditOnly: Number(value.unmatchedCount ?? 0),
  };
}

function sanitizeLineup(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    displayTitle: value.displayTitle || null,
    displayShape: value.displayShape || "general-show",
    orderedArtists: array(value.orderedArtists).map((item) => {
      const artist = record(item);
      return {
        lineupEntryId: artist.lineupEntryId,
        displayName: artist.displayName,
        relation: artist.relation,
        billingGroupIndex: artist.billingGroupIndex,
        b2bWithNext: artist.b2bWithNext,
      };
    }),
    totalArtists: Number(value.totalArtists ?? 0),
    directCount: Number(value.directCount ?? 0),
    adjacentCount: Number(value.adjacentCount ?? 0),
    ages: value.ages || null,
    sourceUrl: value.sourceUrl || null,
  };
}

function classifyEventType(event: Record<string, unknown>): string {
  const title = String(event.title ?? "").toLowerCase();
  if (title.includes("festival") || array(event.performers).length >= 6) return "festival";
  if (title.includes("dj set") || title.includes("open to close")) return "dj set";
  return "concert";
}

function uniqueArtists(items: unknown[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeArtistName(record(item).name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nonEmpty(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && Object.keys(value).length ? value : null;
}

function localIsoDate(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
