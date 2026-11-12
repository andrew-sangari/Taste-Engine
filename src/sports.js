import { formatLocalDate, localDateDifference, localWeekdayIndex, weekdayForLocalDate } from './localDate.js';
import { RAMS_TEAM_ID, SOFI_STADIUM } from './nfl.js';

// League-specific settings that are not MLB's. MLB keeps reading the top-level
// sports config unchanged; another league reads `config.<league>` over these
// defaults and inherits the shared location and budget keys.
const LEAGUE_DEFAULTS = {
  nfl: {
    enabled: true,
    teamId: RAMS_TEAM_ID,
    teamName: 'Los Angeles Rams',
    homeVenueNames: [SOFI_STADIUM.name],
    homeVenue: { lat: SOFI_STADIUM.lat, lon: SOFI_STADIUM.lon },
    seatGeekTaxonomy: 'football',
    // Eight or nine regular-season home dates a year against MLB's 81: each
    // one starts from a higher floor, and a 70,000-seat building starts from
    // a higher hassle floor.
    baseInterest: 42,
    baseHassle: 3,
    rivalries: {
      '25': { tier: 'high', label: '49ers rivalry', division: true },
      '26': { tier: 'medium', label: 'Seahawks rivalry', division: true },
      '22': { tier: 'medium', label: 'Cardinals rivalry', division: true }
    }
  }
};
const SHARED_CONFIG_KEYS = ['home', 'searchRadiusMiles', 'maxTicketPriceUsd', 'maxTicketPages', 'featuredInterestThreshold'];

export function sportsLeagueOf(game = {}) {
  const league = String(game?.league ?? game?.sportsContext?.league ?? '').toLowerCase();
  if (league === 'nfl' || String(game?.id ?? '').startsWith('nfl:')) return 'nfl';
  return 'mlb';
}

export function sportsLeagueConfig(config = {}, league = 'mlb') {
  const defaults = LEAGUE_DEFAULTS[league];
  if (!defaults) return config ?? {};
  if (config?.league === league) return config;
  const shared = Object.fromEntries(SHARED_CONFIG_KEYS.filter((key) => config?.[key] !== undefined).map((key) => [key, config[key]]));
  return { ...defaults, ...shared, ...(config?.[league] ?? {}), league };
}

const SEATGEEK_EVENTS_URL = 'https://api.seatgeek.com/2/events';
const TICKETMASTER_EVENTS_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

export async function fetchSeatGeekSportsEvents({
  clientId,
  startDate,
  endDate,
  config,
  league = null,
  maxPages = 3,
  fetchImpl = fetch
} = {}) {
  if (!clientId) throw new Error('SEATGEEK_CLIENT_ID is not configured.');
  config = sportsLeagueConfig(config, league ?? config?.league);
  const events = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(SEATGEEK_EVENTS_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('q', config.teamName ?? 'Los Angeles Dodgers');
    url.searchParams.set('taxonomies.name', config.seatGeekTaxonomy ?? 'baseball');
    url.searchParams.set('lat', String(config.home?.lat ?? 34.0522));
    url.searchParams.set('lon', String(config.home?.lon ?? -118.2437));
    url.searchParams.set('range', `${config.searchRadiusMiles ?? 60}mi`);
    url.searchParams.set('datetime_local.gte', startDate);
    url.searchParams.set('datetime_local.lte', `${endDate}T23:59:59`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'datetime_local.asc');
    const body = await requestJson(url, fetchImpl, 'SeatGeek sports');
    const pageEvents = Array.isArray(body.events) ? body.events : [];
    events.push(...pageEvents);
    if (!pageEvents.length || pageEvents.length < 100 || events.length >= Number(body.meta?.total ?? 0)) break;
  }
  return events;
}

export async function fetchTicketmasterSportsEvents({
  apiKey,
  startDate,
  endDate,
  config,
  league = null,
  maxPages = 3,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY is not configured.');
  config = sportsLeagueConfig(config, league ?? config?.league);
  const events = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(TICKETMASTER_EVENTS_URL);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('classificationName', 'Sports');
    url.searchParams.set('keyword', config.teamName ?? 'Los Angeles Dodgers');
    url.searchParams.set('latlong', `${config.home?.lat ?? 34.0522},${config.home?.lon ?? -118.2437}`);
    url.searchParams.set('radius', String(config.searchRadiusMiles ?? 60));
    url.searchParams.set('unit', 'miles');
    url.searchParams.set('startDateTime', `${startDate}T00:00:00Z`);
    url.searchParams.set('endDateTime', `${endDate}T23:59:59Z`);
    url.searchParams.set('includeTBA', 'yes');
    url.searchParams.set('includeTBD', 'yes');
    url.searchParams.set('size', '200');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'date,asc');
    const body = await requestJson(url, fetchImpl, 'Ticketmaster sports');
    const pageEvents = body._embedded?.events ?? [];
    events.push(...pageEvents);
    if (!pageEvents.length || page + 1 >= Number(body.page?.totalPages ?? 0)) break;
  }
  return events;
}

export function normalizeSeatGeekSportsEvent(event, retrievedAt = new Date()) {
  const venue = event.venue ?? {};
  const names = (event.performers ?? []).map((performer) => performer.name ?? performer.short_name).filter(Boolean);
  return {
    source: 'seatgeek',
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ''),
    title: String(event.title ?? event.short_title ?? '').trim(),
    startLocal: event.datetime_local ?? null,
    venue: normalizeTicketVenue(venue),
    teamNames: [...names, event.title ?? ''].filter(Boolean),
    ticketObservation: {
      source: 'seatgeek',
      sourceEventId: String(event.id),
      url: String(event.url ?? ''),
      lowestPriceUsd: numberOrNull(event.stats?.lowest_price),
      averagePriceUsd: numberOrNull(event.stats?.average_price),
      listingCount: numberOrNull(event.stats?.listing_count),
      status: event.status ?? 'scheduled',
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}

export function normalizeTicketmasterSportsEvent(event, retrievedAt = new Date()) {
  const venue = event._embedded?.venues?.[0] ?? {};
  const attractions = event._embedded?.attractions ?? [];
  const localDate = event.dates?.start?.localDate ?? null;
  const localTime = event.dates?.start?.localTime ?? '00:00:00';
  const names = attractions.map((attraction) => attraction.name).filter(Boolean);
  return {
    source: 'ticketmaster',
    sourceEventId: String(event.id),
    sourceUrl: String(event.url ?? ''),
    title: String(event.name ?? '').trim(),
    startLocal: localDate ? `${localDate}T${localTime}` : null,
    venue: normalizeTicketVenue(venue),
    teamNames: [...names, event.name ?? ''].filter(Boolean),
    ticketObservation: {
      source: 'ticketmaster',
      sourceEventId: String(event.id),
      url: String(event.url ?? ''),
      lowestPriceUsd: numberOrNull(event.priceRanges?.[0]?.min),
      averagePriceUsd: null,
      listingCount: null,
      status: event.dates?.status?.code ?? 'scheduled',
      observedAt: new Date(retrievedAt).toISOString()
    }
  };
}

export function enrichSportsGames(games, standings, config, {
  now = new Date(),
  pitcherStats = new Map()
} = {}) {
  return games.map((game) => {
    if (sportsLeagueOf(game) === 'nfl') return enrichNflGame(game, standings, sportsLeagueConfig(config, 'nfl'), now);
    const opponent = standings.get(String(game.awayTeam?.id));
    const rivalry = config.rivalries?.[String(game.awayTeam?.id)] ?? { tier: 'none', label: null };
    const probablePitchers = {
      home: mergePitcherStats(game.probablePitchers?.home, pitcherStats),
      away: mergePitcherStats(game.probablePitchers?.away, pitcherStats),
      confirmed: game.probablePitchers?.confirmed ?? false
    };
    const matchupTier = pitcherMatchupTier(probablePitchers);
    const seriesPosition = seriesPositionFor(game);
    const opponentTags = opponentStakesTags(game, opponent, rivalry);
    const sportsContext = {
      opponentWinPct: opponent?.winPct ?? null,
      opponentLeagueRank: opponent?.leagueRank ?? null,
      opponentDivisionRank: opponent?.divisionRank ?? null,
      opponentLast10: opponent?.lastTen ?? null,
      opponentLastTenRecord: opponent?.lastTenRecord ?? null,
      opponentStreak: opponent?.streak ?? null,
      opponentWildCardGamesBack: opponent?.wildCardGamesBack ?? null,
      opponentRunDifferential: opponent?.runDifferential ?? null,
      opponentHomeRecord: opponent?.homeRecord ?? null,
      opponentAwayRecord: opponent?.awayRecord ?? null,
      opponentAbove500Record: opponent?.above500Record ?? null,
      opponentLeagueName: opponent?.league?.name ?? null,
      opponentDivisionName: opponent?.division?.name ?? null,
      rivalryTier: rivalry.tier,
      probablePitchers,
      pitcherMatchupTier: matchupTier,
      seriesPosition,
      opponentTags,
      schedule: game.scheduleStatus ?? {
        detailedState: game.status ?? 'Scheduled',
        changed: false,
        delayed: false,
        postponed: false,
        rescheduled: false
      },
      playoffLeverage: playoffLeverage(game.startLocal, opponent),
      // A small, deterministic context object keeps the card explanation
      // legible without turning the Sports vertical into a stats dashboard.
      gameContext: {
        opponent: {
          tags: opponentTags,
          leagueRank: opponent?.leagueRank ?? null,
          divisionRank: opponent?.divisionRank ?? null,
          wildCardGamesBack: opponent?.wildCardGamesBack ?? null,
          runDifferential: opponent?.runDifferential ?? null,
          lastTen: opponent?.lastTen ?? null,
          streak: opponent?.streak ?? null
        },
        pitching: { matchupTier, confirmed: probablePitchers.confirmed },
        series: seriesPosition,
        schedule: game.scheduleStatus ?? { detailedState: game.status ?? 'Scheduled', changed: false }
      }
    };
    const tags = sportsTags(game, opponent, rivalry, sportsContext);
    const ranking = scoreSportsGame({ ...game, sportsContext, tags }, config, now);
    return { ...game, sportsContext, tags, ranking };
  });
}

export function scoreSportsGame(game, config, now = new Date()) {
  if (sportsLeagueOf(game) === 'nfl') return scoreNflGame(game, sportsLeagueConfig(config, 'nfl'), now);
  const opponentQuality = opponentQualityScore(game.sportsContext);
  const opponentStakesScore = opponentStakesScoreFor(game.sportsContext);
  const rivalryScore = ({ high: 15, medium: 8, low: 3, none: 0 }[game.sportsContext?.rivalryTier] ?? 0);
  const pitchingScore = pitchingMatchupScore(game.sportsContext?.probablePitchers);
  const leverageScore = ({ high: 10, medium: 6, low: 2, unknown: 0 }[game.sportsContext?.playoffLeverage] ?? 0);
  const leagueRelevanceScore = leagueRelevance(game.sportsContext);
  const convenienceScore = dateConvenience(game.startLocal);
  const hassle = sportsHassle(game, config);
  const hassleScore = hassle.score;
  const interestScore = Math.min(100, 35 + opponentQuality + opponentStakesScore + rivalryScore + pitchingScore + leverageScore + leagueRelevanceScore + convenienceScore);
  const urgency = sportsTicketUrgency(game.ticketObservations ?? [], game.startLocal, now);
  const confidence = game.sportsContext?.opponentWinPct == null ? 'medium' : game.sportsContext.probablePitchers.confirmed ? 'high' : 'medium';
  const whyYou = sportsWhyYou(game, { opponentQuality, opponentStakesScore, rivalryScore, pitchingScore, leverageScore, leagueRelevanceScore, convenienceScore, hassleScore });
  return {
    excluded: false,
    interestScore,
    utility: interestScore - hassleScore * 2,
    opponentQuality,
    opponentStakesScore,
    rivalryScore,
    pitchingScore,
    leverageScore,
    leagueRelevanceScore,
    convenienceScore,
    hassleScore,
    hassleBreakdown: hassle,
    hassleReasons: hassle.reasons,
    urgency,
    confidence,
    whyYou
  };
}

function sportsWhyYou(game, { opponentQuality, opponentStakesScore, rivalryScore, pitchingScore, leverageScore, leagueRelevanceScore, convenienceScore, hassleScore }) {
  const day = weekdayForLocalDate(game.startLocal);
  const friction = hassleScore <= 4 ? 'Low-hassle' : hassleScore <= 6 ? 'Manageable' : 'Higher-hassle';
  const reasons = [];
  if (rivalryScore >= 15) reasons.push(`${game.awayTeam.shortName || game.awayTeam.name} rivalry`);
  else if (opponentStakesScore >= 4 || opponentQuality >= 8) reasons.push('a stronger-than-usual matchup');
  if (game.sportsContext?.pitcherMatchupTier === 'ace') reasons.push('an ace matchup');
  else if (pitchingScore >= 5) reasons.push('a notable pitching matchup');
  if (leverageScore >= 6) reasons.push('useful late-season leverage');
  if (leagueRelevanceScore >= 4) reasons.push('an AL East measuring-stick matchup');
  if (!reasons.length && convenienceScore >= 8) reasons.push('a good weekend timing window');
  if (!reasons.length) reasons.push('a worthwhile Dodgers home-game setup');
  const series = game.sportsContext?.seriesPosition?.label;
  const schedule = game.sportsContext?.schedule;
  const statusNote = schedule?.changed ? ` ${schedule.detailedState || 'Schedule update'} — check MLB before leaving.` : '';
  return `${friction} ${day ? `${day} ` : ''}game with ${joinReasons(reasons)}.${series ? ` ${series}.` : ''}${statusNote}`;
}

function joinReasons(reasons) {
  if (reasons.length === 1) return reasons[0];
  if (reasons.length === 2) return `${reasons[0]} and ${reasons[1]}`;
  return `${reasons.slice(0, -1).join(', ')}, and ${reasons.at(-1)}`;
}

export function joinSportsTickets(games, ticketEvents, config, now = new Date()) {
  return games.map((game) => {
    const matches = ticketEvents.filter((ticket) => ticketMatchesGame(ticket, game));
    const observations = dedupeObservations(matches.map((ticket) => ticket.ticketObservation));
    const sourceOccurrences = [
      ...(game.sourceOccurrences ?? []),
      ...observations.map((observation) => ({
        source: observation.source,
        sourceEventId: observation.sourceEventId,
        sourceUrl: observation.url
      }))
    ];
    const next = { ...game, ticketObservations: observations, sourceOccurrences };
    return { ...next, ranking: scoreSportsGame(next, config, now) };
  });
}

export function sportsTicketUrgency(observations, startLocal, now = new Date()) {
  if (!observations?.length) return 'unknown';
  if (observations.some((observation) => /sold|cancel/i.test(String(observation.status)))) return 'likely unavailable';
  const listingCount = observations.map((observation) => observation.listingCount).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
  const days = daysUntil(startLocal, now);
  if (listingCount != null && listingCount <= 10) return 'buy now';
  if (days != null && days <= 7) return 'watch';
  return 'safe to wait';
}

export function ticketMatchesGame(ticket, game) {
  if (sportsLeagueOf(game) === 'nfl') return nflTicketMatchesGame(ticket, game);
  if (!ticket.startLocal || !game.startLocal || ticket.startLocal.slice(0, 10) !== game.startLocal.slice(0, 10)) return false;
  if (!venueMatches(ticket.venue, game.venue)) return false;
  const haystack = normalizeTeamText([ticket.title, ...(ticket.teamNames ?? [])].join(' '));
  if (!teamMatches(haystack, game.homeTeam)) return false;
  const opponentKnown = teamMatches(haystack, game.awayTeam);
  const anyOpponentMentioned = game.awayTeam?.name && normalizeTeamText(haystack).includes(normalizeTeamText(game.awayTeam.name).split(' ')[0]);
  return opponentKnown || !anyOpponentMentioned;
}

// ── NFL ────────────────────────────────────────────────────────────────────
// Same contract as MLB (interest, hassle, urgency, and confidence stay
// separate; an unticketed game keeps unknown urgency) with football inputs:
// opponent record, division rivalry, national kickoff window, and playoff-race
// leverage. Records from the first weeks of a season are too small a sample
// to rank on, so they are carried as context and scored only once established.
const NFL_ESTABLISHED_GAMES = 4;
const NFL_PRIMETIME_SCORES = { SNF: 8, MNF: 7, TNF: 6 };
const NON_GAME_LISTING = /\b(parking|tailgate|tailgating|shuttle|bus|tour|deposit|package|pass|passes|voucher|hospitality|experience)\b/;

function enrichNflGame(game, standings, config, now) {
  const opponent = standings?.get?.(String(game.awayTeam?.id)) ?? null;
  const home = standings?.get?.(String(game.homeTeam?.id)) ?? null;
  const configured = config.rivalries?.[String(game.awayTeam?.id)] ?? null;
  const homeDivision = home?.division ?? game.homeTeam?.division ?? null;
  const opponentDivision = opponent?.division ?? game.awayTeam?.division ?? null;
  const sameDivision = Boolean(homeDivision?.name && opponentDivision?.name && homeDivision.name === opponentDivision.name);
  const divisionGame = sameDivision || configured?.division === true;
  const rivalry = configured ?? (sameDivision ? { tier: 'medium', label: null } : { tier: 'none', label: null });
  const divisionName = sameDivision ? compactDivision(homeDivision.name) : null;
  const schedule = game.scheduleStatus ?? {
    detailedState: game.status ?? 'Scheduled',
    changed: false,
    delayed: false,
    postponed: false,
    rescheduled: false
  };
  const kickoffWindow = game.kickoff ?? null;
  const weekLabel = game.season?.weekLabel ?? null;
  const opponentTags = nflOpponentTags(opponent);
  const sportsContext = {
    league: 'nfl',
    opponentWinPct: opponent?.winPct ?? null,
    opponentRecord: opponent?.record ?? null,
    opponentGamesPlayed: opponent?.gamesPlayed ?? null,
    opponentLeagueRank: opponent?.leagueRank ?? null,
    opponentDivisionRank: opponent?.divisionRank ?? null,
    opponentLast10: null,
    opponentLastTenRecord: null,
    opponentStreak: opponent?.streak ?? null,
    opponentWildCardGamesBack: null,
    opponentPlayoffGamesBack: opponent?.playoffGamesBack ?? null,
    opponentRunDifferential: null,
    opponentPointDifferential: opponent?.pointDifferential ?? null,
    opponentHomeRecord: opponent?.homeRecord ?? null,
    opponentAwayRecord: opponent?.awayRecord ?? null,
    opponentAbove500Record: null,
    opponentLeagueName: opponent?.league?.name ?? null,
    opponentDivisionName: opponentDivision?.name ?? null,
    homeRecord: home?.record ?? null,
    homeLeagueRank: home?.leagueRank ?? null,
    homePlayoffGamesBack: home?.playoffGamesBack ?? null,
    rivalryTier: rivalry.tier ?? 'none',
    divisionGame,
    divisionName,
    // No football analogue. The fields stay so MLB-shaped consumers can read
    // them without branching, and they never score.
    probablePitchers: { home: null, away: null, confirmed: false },
    pitcherMatchupTier: 'unknown',
    seriesPosition: { label: weekLabel, gameNumber: null, gameCount: null },
    kickoffWindow,
    broadcasts: game.broadcasts ?? [],
    seasonType: game.season?.type ?? null,
    week: game.season?.week ?? null,
    opponentTags,
    schedule,
    playoffLeverage: nflPlayoffLeverage(game, opponent, home, divisionGame),
    gameContext: {
      opponent: {
        tags: opponentTags,
        record: opponent?.record ?? null,
        leagueRank: opponent?.leagueRank ?? null,
        divisionRank: opponent?.divisionRank ?? null,
        pointDifferential: opponent?.pointDifferential ?? null,
        streak: opponent?.streak ?? null
      },
      kickoff: kickoffWindow,
      schedule
    }
  };
  const tags = nflTags(game, rivalry, sportsContext);
  const ranking = scoreNflGame({ ...game, sportsContext, tags }, config, now);
  return { ...game, sportsContext, tags, ranking };
}

function scoreNflGame(game, config, now = new Date()) {
  const context = game.sportsContext ?? {};
  const established = nflRecordEstablished(context.opponentGamesPlayed);
  const opponentQuality = established && Number.isFinite(context.opponentWinPct)
    ? Math.max(0, Math.min(20, Math.round((context.opponentWinPct - 0.3) * 40)))
    : 0;
  const opponentStakesScore = established ? nflOpponentStakesScore(context) : 0;
  const rivalryScore = ({ high: 15, medium: 8, low: 3, none: 0 }[context.rivalryTier] ?? 0);
  const primetimeScore = context.seasonType === 'postseason'
    ? 0
    : NFL_PRIMETIME_SCORES[context.kickoffWindow?.code] ?? (context.kickoffWindow?.primetime ? 5 : 0);
  const leverageScore = ({ high: 10, medium: 6, low: 2, unknown: 0 }[context.playoffLeverage] ?? 0);
  const convenienceScore = dateConvenience(game.startLocal);
  const hassle = nflHassle(game, config);
  const hassleScore = hassle.score;
  const baseInterest = Number.isFinite(config.baseInterest) ? config.baseInterest : LEAGUE_DEFAULTS.nfl.baseInterest;
  const interestScore = Math.min(100, baseInterest + opponentQuality + opponentStakesScore + rivalryScore + primetimeScore + leverageScore + convenienceScore);
  const urgency = sportsTicketUrgency(game.ticketObservations ?? [], game.startLocal, now);
  // High confidence needs an established opponent record and a settled kickoff.
  const confidence = established && Number.isFinite(context.opponentWinPct) && !game.timeTbd && !game.dateTbd && !context.schedule?.changed ? 'high' : 'medium';
  const whyYou = nflWhyYou(game, { opponentQuality, rivalryScore, primetimeScore, leverageScore, convenienceScore, hassleScore });
  return {
    excluded: false,
    league: 'nfl',
    interestScore,
    utility: interestScore - hassleScore * 2,
    opponentQuality,
    opponentStakesScore,
    rivalryScore,
    pitchingScore: 0,
    primetimeScore,
    leverageScore,
    leagueRelevanceScore: 0,
    convenienceScore,
    hassleScore,
    hassleBreakdown: hassle,
    hassleReasons: hassle.reasons,
    urgency,
    confidence,
    whyYou
  };
}

function nflRecordEstablished(gamesPlayed) {
  return Number.isFinite(gamesPlayed) && gamesPlayed >= NFL_ESTABLISHED_GAMES;
}

function nflOpponentStakesScore(context = {}) {
  let score = 0;
  if (context.opponentDivisionRank === 1) score += 3;
  else if (Number.isFinite(context.opponentLeagueRank) && context.opponentLeagueRank <= 7) score += 2;
  if (Number.isFinite(context.opponentLeagueRank) && context.opponentLeagueRank <= 2) score += 2;
  if (Number.isFinite(context.opponentPointDifferential)) {
    if (context.opponentPointDifferential >= 75) score += 3;
    else if (context.opponentPointDifferential >= 40) score += 2;
    else if (context.opponentPointDifferential >= 15) score += 1;
  }
  if (/^W([4-9]|\d{2,})/i.test(String(context.opponentStreak ?? ''))) score += 1;
  return Math.min(10, score);
}

function nflOpponentTags(opponent) {
  if (!opponent || !nflRecordEstablished(opponent.gamesPlayed)) return [];
  const tags = [];
  if (opponent.record) tags.push(`${opponent.record} record`);
  const conference = String(opponent.league?.name ?? '').match(/\b(American|National)\b/i)?.[1];
  const conferenceLabel = conference ? `${conference[0].toUpperCase()}FC` : null;
  if (opponent.divisionRank === 1) tags.push(`${compactDivision(opponent.division?.name) || 'Division'} leader`);
  else if (Number.isFinite(opponent.leagueRank) && opponent.leagueRank <= 7) tags.push(`${conferenceLabel ? `${conferenceLabel} ` : ''}No. ${opponent.leagueRank} seed today`);
  if (Number.isFinite(opponent.pointDifferential) && opponent.pointDifferential >= 40) tags.push(`+${Math.round(opponent.pointDifferential)} point differential`);
  else if (/^W([4-9]|\d{2,})/i.test(String(opponent.streak ?? ''))) tags.push(`Won ${String(opponent.streak).slice(1)} straight`);
  return tags.slice(0, 3);
}

// Leverage is read from today's standings and is recomputed on every refresh.
// A team is "in the race" when it holds a playoff seed or sits within a game
// and a half of the last one.
function nflPlayoffLeverage(game, opponent, home, divisionGame) {
  if (game.season?.type === 'postseason') return 'high';
  const inRace = (team) => Boolean(team && nflRecordEstablished(team.gamesPlayed)
    && ((Number.isFinite(team.playoffSeed) && team.playoffSeed <= 7) || (Number.isFinite(team.playoffGamesBack) && team.playoffGamesBack <= 1.5)));
  const known = [opponent, home].some((team) => team && nflRecordEstablished(team.gamesPlayed));
  if (!known) return 'unknown';
  const week = Number(game.season?.week);
  const month = Number(String(game.startLocal ?? '').slice(5, 7));
  const late = Number.isFinite(week) && week > 0 ? week >= 14 : month === 12 || month === 1;
  const middle = Number.isFinite(week) && week > 0 ? week >= 10 : month === 11;
  const homeAlive = inRace(home);
  const opponentAlive = inRace(opponent);
  if (late && homeAlive && (opponentAlive || divisionGame)) return 'high';
  if (late && (homeAlive || opponentAlive)) return 'medium';
  if (middle && homeAlive && opponentAlive) return 'medium';
  return 'low';
}

function nflTags(game, rivalry, context) {
  const tags = [];
  if (context.schedule?.changed) tags.push('Schedule update');
  if (context.seasonType === 'postseason') tags.push('Playoff game');
  if (rivalry.tier === 'high' && rivalry.label) tags.push(rivalry.label);
  if (context.divisionGame) tags.push(context.divisionName ? `${context.divisionName} rival` : 'Division rival');
  if (context.kickoffWindow?.primetime && context.kickoffWindow.label) tags.push(context.kickoffWindow.label);
  if (context.seasonType !== 'postseason' && context.playoffLeverage === 'high') tags.push('Late-season leverage');
  tags.push(...(context.opponentTags ?? []));
  if (context.schedule?.dateTentative) tags.push('Date and kickoff TBD');
  else if (game.timeTbd || game.dateTbd) tags.push('Kickoff TBD');
  if (context.seriesPosition?.label) tags.push(context.seriesPosition.label);
  if (!context.schedule?.dateTentative && [0, 6].includes(localWeekdayIndex(game.startLocal))) tags.push('Weekend game');
  return [...new Set(tags)].slice(0, 7);
}

function nflHassle(game, config) {
  const venueName = String(game.venue?.name ?? '').trim();
  const logisticalReasons = [`${venueName || 'Stadium'} logistics`];
  const commercialReasons = [];
  let logistical = Number.isFinite(config.baseHassle) ? config.baseHassle : LEAGUE_DEFAULTS.nfl.baseHassle;
  let commercial = 0;
  const weekday = localWeekdayIndex(game.startLocal);
  const hour = Number(String(game.startLocal ?? '').match(/T(\d{2}):/)?.[1]);
  if (game.timeTbd || game.dateTbd) {
    logistical += 2;
    logisticalReasons.push(game.scheduleStatus?.dateTentative ? 'date and kickoff time are TBD' : 'kickoff time is TBD');
  } else if (weekday >= 1 && weekday <= 5 && Number.isFinite(hour) && hour >= 15 && hour < 19) {
    logistical += 1;
    logisticalReasons.push('weeknight rush-hour kickoff');
  }
  if (config.homeVenueNames?.length && !config.homeVenueNames.some((name) => normalizeTeamText(venueName).includes(normalizeTeamText(name)))) {
    logistical += 1;
    logisticalReasons.push('venue confirmation pending');
  }
  const lowest = (game.ticketObservations ?? []).map((item) => Number(item.lowestPriceUsd)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (lowest != null) {
    commercialReasons.push(`from $${lowest}`);
    if (Number.isFinite(config.maxTicketPriceUsd) && lowest > config.maxTicketPriceUsd) {
      commercial += 2;
      commercialReasons.push('above ticket budget');
    }
  }
  const personalContext = Math.max(-2, Math.min(2, Number(game.personalContextFriction ?? 0) || 0));
  return {
    score: Math.max(0, Math.min(10, logistical + commercial + personalContext)),
    logistical,
    commercial,
    personalContext,
    commercialUncertain: lowest == null,
    reasons: [...logisticalReasons, ...commercialReasons]
  };
}

// Every clause is backed by a field on the game: the opponent's current
// record, the division, the kickoff window, or today's standings.
function nflWhyYou(game, { opponentQuality, rivalryScore, primetimeScore, leverageScore, convenienceScore, hassleScore }) {
  const context = game.sportsContext ?? {};
  const tentative = context.schedule?.dateTentative === true;
  // A flex game can still move a day, so its listed weekday is not asserted.
  const day = tentative ? null : weekdayForLocalDate(game.startLocal);
  const friction = hassleScore <= 3 ? '' : hassleScore <= 5 ? 'Manageable' : 'Higher-hassle';
  const opponentName = game.awayTeam?.shortName || game.awayTeam?.name || 'visiting team';
  const homeName = game.homeTeam?.shortName || game.homeTeam?.name || 'home';
  const record = nflRecordEstablished(context.opponentGamesPlayed) && context.opponentRecord ? ` (${context.opponentRecord})` : '';
  const reasons = [];
  if (context.seasonType === 'postseason') reasons.push('a home playoff game');
  if (rivalryScore >= 15) reasons.push(context.divisionGame ? 'a marquee division rivalry' : 'a marquee rivalry');
  else if (context.divisionGame) reasons.push(context.divisionName ? `an ${context.divisionName} division matchup` : 'a division matchup');
  if (opponentQuality >= 15) reasons.push('a top-tier opponent');
  else if (opponentQuality >= 9) reasons.push('a winning opponent');
  if (primetimeScore > 0 && context.kickoffWindow?.label) {
    reasons.push(NFL_PRIMETIME_SCORES[context.kickoffWindow.code] ? `a prime-time ${context.kickoffWindow.label} window` : `a ${context.kickoffWindow.label}`);
  }
  if (context.seasonType !== 'postseason' && leverageScore >= 10) reasons.push('late-season playoff leverage');
  if (!reasons.length && convenienceScore >= 8 && !tentative) reasons.push('a weekend kickoff');
  if (!reasons.length) reasons.push(`one of the few ${homeName} home dates this season`);
  const opening = [friction, day, 'home game'].filter(Boolean).join(' ');
  const week = context.seriesPosition?.label;
  const flexDays = (context.schedule?.flexDates ?? []).map((date) => formatLocalDate(date, { weekday: 'long', month: 'long', day: 'numeric' })).filter(Boolean);
  const tbdNote = tentative
    ? ` Date and kickoff time are not final under NFL flexible scheduling${flexDays.length >= 2 ? ` (${flexDays.join(' or ')})` : ''}.`
    : game.timeTbd || game.dateTbd ? ' Kickoff time is still TBD.' : '';
  const statusNote = context.schedule?.changed ? ` ${context.schedule.detailedState || 'Schedule update'} — check the NFL schedule before leaving.` : '';
  return `${opening[0].toUpperCase()}${opening.slice(1)} against the ${opponentName}${record}: ${joinReasons(reasons)}.${week ? ` ${week}.` : ''}${tbdNote}${statusNote}`;
}

// A clean NFL join needs the same local date, the home building by name (the
// stadium shares a campus with other venues, so proximity alone is not
// enough), and both teams named as whole words. Parking, tailgate, and
// package listings share the game's title but are not game tickets.
function nflTicketMatchesGame(ticket, game) {
  if (!ticket?.startLocal || !game?.startLocal) return false;
  // A flex game may be listed on either candidate date until the NFL sets it.
  const dates = new Set([game.startLocal.slice(0, 10), ...(game.scheduleStatus?.dateTentative ? game.scheduleStatus.flexDates ?? [] : [])]);
  if (!dates.has(ticket.startLocal.slice(0, 10))) return false;
  if (!nflVenueMatches(ticket.venue, game.venue)) return false;
  const haystack = ` ${normalizeTeamText([ticket.title, ...(ticket.teamNames ?? [])].join(' '))} `;
  if (NON_GAME_LISTING.test(haystack)) return false;
  return teamNamedAsWords(haystack, game.homeTeam) && teamNamedAsWords(haystack, game.awayTeam);
}

function nflVenueMatches(left = {}, right = {}) {
  const leftName = normalizeTeamText(left.name);
  const rightName = normalizeTeamText(right.name);
  if (leftName && rightName) return leftName.includes(rightName) || rightName.includes(leftName);
  if (Number.isFinite(left.lat) && Number.isFinite(left.lon) && Number.isFinite(right.lat) && Number.isFinite(right.lon)) {
    return distanceMiles(left.lat, left.lon, right.lat, right.lon) <= 0.5;
  }
  return false;
}

function teamNamedAsWords(haystack, team = {}) {
  return [team.name, team.shortName]
    .map(normalizeTeamText)
    .filter((alias) => alias.length >= 4)
    .some((alias) => haystack.includes(` ${alias} `));
}

function sportsTags(game, opponent, rivalry, context) {
  const tags = [...(context.opponentTags ?? [])];
  if (rivalry.label) tags.push(`${game.awayTeam.shortName || game.awayTeam.name} rivalry`);
  if (/american league/i.test(String(opponent?.league?.name ?? ''))) tags.push('AL matchup');
  if (/american league east|al east/i.test(String(opponent?.division?.name ?? ''))) tags.push('AL East matchup');
  if (context.pitcherMatchupTier === 'ace') tags.push('Ace matchup');
  else if (context.pitcherMatchupTier === 'notable') tags.push('Notable pitching matchup');
  if (context.seriesPosition?.label) tags.push(context.seriesPosition.label);
  if (context.schedule?.postponed) tags.push('Schedule update');
  if (context.playoffLeverage === 'high') tags.push('Late-season leverage');
  if ([0, 6].includes(localWeekdayIndex(game.startLocal))) tags.push('Weekend game');
  return [...new Set(tags)].slice(0, 7);
}

function opponentQualityScore(context = {}) {
  if (Number.isFinite(context.opponentLeagueRank)) return Math.max(0, Math.min(20, Math.round(20 - (context.opponentLeagueRank - 1) * 1.25)));
  if (Number.isFinite(context.opponentWinPct)) return Math.max(0, Math.min(20, Math.round((context.opponentWinPct - 0.35) * 66.67)));
  return 0;
}

function opponentStakesScoreFor(context = {}) {
  let score = 0;
  if (context.opponentDivisionRank === 1) score += 3;
  else if (Number.isFinite(context.opponentWildCardGamesBack) && context.opponentWildCardGamesBack <= 3) score += 2;
  if (Number.isFinite(context.opponentLeagueRank) && context.opponentLeagueRank <= 5) score += 2;
  if (Number.isFinite(context.opponentRunDifferential)) {
    if (context.opponentRunDifferential >= 75) score += 3;
    else if (context.opponentRunDifferential >= 35) score += 2;
    else if (context.opponentRunDifferential >= 15) score += 1;
  }
  if (context.opponentLastTenRecord?.wins >= 7) score += 1;
  if (/^W[4-9]|^W\d{2,}/i.test(String(context.opponentStreak ?? ''))) score += 1;
  return Math.min(10, score);
}

function leagueRelevance(context = {}) {
  const league = String(context.opponentLeagueName ?? '');
  const division = String(context.opponentDivisionName ?? '');
  if (/american league east|al east/i.test(division)) return 5;
  if (/american league/i.test(league)) return 2;
  return 0;
}

function pitchingMatchupScore(pitchers = {}) {
  // Probables change. Do not reward a speculative single starter or a name
  // without enough verified season context to classify the matchup.
  if (!pitchers.confirmed) return 0;
  const quality = (pitcher) => {
    if (!pitcher || pitcher.era == null || pitcher.whip == null || (pitcher.inningsPitched ?? 0) < 45) return 0;
    if (pitcher.era <= 3.15 && pitcher.whip <= 1.15) return 5;
    if (pitcher.era <= 3.75 && pitcher.whip <= 1.28) return 3;
    return 1;
  };
  const homeQuality = quality(pitchers.home);
  const awayQuality = quality(pitchers.away);
  if (!homeQuality || !awayQuality) return 0;
  return Math.min(10, homeQuality + awayQuality);
}

function pitcherMatchupTier(pitchers = {}) {
  const score = pitchingMatchupScore(pitchers);
  if (!pitchers.confirmed || !score) return 'unknown';
  if (score >= 9) return 'ace';
  if (score >= 4) return 'notable';
  return 'standard';
}

function opponentStakesTags(game, opponent, rivalry) {
  if (!opponent) return rivalry.label ? [`${game.awayTeam.shortName || game.awayTeam.name} rivalry`] : [];
  const tags = [];
  if (opponent.divisionRank === 1) tags.push(`${compactDivision(opponent.division?.name) || 'Division'} leader`);
  else if (Number.isFinite(opponent.wildCardGamesBack) && opponent.wildCardGamesBack <= 3) tags.push('Wild-card contender');
  if (Number.isFinite(opponent.leagueRank) && opponent.leagueRank <= 5) tags.push('Top-five league record');
  if (Number.isFinite(opponent.runDifferential) && opponent.runDifferential >= 15) tags.push(`${opponent.runDifferential >= 0 ? '+' : ''}${Math.round(opponent.runDifferential)} run differential`);
  if (opponent.lastTenRecord?.wins >= 7) tags.push(`Won ${opponent.lastTenRecord.wins} of last 10`);
  else if (/^W([4-9]|\d{2,})/i.test(String(opponent.streak ?? ''))) tags.push(`Won ${String(opponent.streak).slice(1)} straight`);
  return tags;
}

function compactDivision(value) {
  return String(value ?? '')
    .replace(/^National League\s+/i, 'NL ')
    .replace(/^American League\s+/i, 'AL ')
    .trim();
}

function seriesPositionFor(game) {
  const gameNumber = Number(game.series?.gameNumber);
  const gameCount = Number(game.series?.gameCount);
  if (!Number.isFinite(gameNumber) || !Number.isFinite(gameCount) || gameCount < 2) return { label: 'Single game', gameNumber: null, gameCount: null };
  if (gameNumber === 1) return { label: 'Series opener', gameNumber, gameCount };
  if (gameNumber >= gameCount) return { label: 'Series finale', gameNumber, gameCount };
  return { label: `Game ${gameNumber} of ${gameCount}`, gameNumber, gameCount };
}

function playoffLeverage(startLocal, opponent) {
  if (!opponent) return 'unknown';
  const month = Number(String(startLocal ?? '').slice(5, 7));
  if (month >= 9 && (opponent.divisionRank <= 2 || (opponent.gamesBack != null && opponent.gamesBack <= 5))) return 'high';
  if (opponent.divisionRank <= 2 || (opponent.gamesBack != null && opponent.gamesBack <= 5)) return 'medium';
  return 'low';
}

function dateConvenience(startLocal) {
  const day = localWeekdayIndex(startLocal);
  if (day == null) return 0;
  if (day === 0 || day === 6) return 10;
  if (day === 5) return 8;
  return 4;
}

function sportsHassle(game, config) {
  const logisticalReasons = ['Dodger Stadium logistics'];
  const commercialReasons = [];
  let logistical = 2;
  let commercial = 0;
  if (game.timeTbd || game.dateTbd) {
    logistical += 2;
    logisticalReasons.push('time or date is TBD');
  }
  if (config.homeVenueNames?.length && !config.homeVenueNames.some((name) => normalizeTeamText(game.venue.name).includes(normalizeTeamText(name)))) {
    logistical += 1;
    logisticalReasons.push('venue confirmation pending');
  }
  const lowest = (game.ticketObservations ?? []).map((item) => Number(item.lowestPriceUsd)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (lowest != null) {
    commercialReasons.push(`from $${lowest}`);
    if (Number.isFinite(config.maxTicketPriceUsd) && lowest > config.maxTicketPriceUsd) {
      commercial += 2;
      commercialReasons.push('above ticket budget');
    }
  }
  const personalContext = Math.max(-2, Math.min(2, Number(game.personalContextFriction ?? 0) || 0));
  return {
    score: Math.max(0, Math.min(10, logistical + commercial + personalContext)),
    logistical,
    commercial,
    personalContext,
    commercialUncertain: lowest == null,
    reasons: [...logisticalReasons, ...commercialReasons]
  };
}

function mergePitcherStats(pitcher, stats) {
  return pitcher ? { ...pitcher, ...(stats.get(String(pitcher.id)) ?? {}) } : null;
}

function ticketObservationKey(observation) {
  return `${observation.source}|${observation.sourceEventId}|${observation.url}`;
}

function dedupeObservations(observations) {
  return [...new Map(observations.filter(Boolean).map((observation) => [ticketObservationKey(observation), observation])).values()];
}

function venueMatches(left = {}, right = {}) {
  if (Number.isFinite(left.lat) && Number.isFinite(left.lon) && Number.isFinite(right.lat) && Number.isFinite(right.lon)) {
    return distanceMiles(left.lat, left.lon, right.lat, right.lon) <= 3;
  }
  const leftName = normalizeTeamText(left.name);
  const rightName = normalizeTeamText(right.name);
  return Boolean(leftName && rightName && (leftName.includes(rightName) || rightName.includes(leftName) || leftName.includes('dodger') && rightName.includes('dodger')));
}

function teamMatches(haystack, team = {}) {
  const aliases = new Set([
    normalizeTeamText(team.name), normalizeTeamText(team.shortName), normalizeTeamText(team.abbreviation),
    ...(team.name ?? '').toLowerCase().split(/\s+/).slice(-1)
  ].filter(Boolean));
  return [...aliases].some((alias) => alias.length >= 3 && haystack.includes(alias));
}

function normalizeTeamText(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|los|la)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeTicketVenue(venue = {}) {
  return {
    sourceId: venue.id == null ? null : String(venue.id),
    name: String(venue.name ?? '').trim(),
    city: String(venue.city?.name ?? venue.city ?? '').trim(),
    state: String(venue.state?.stateCode ?? venue.state ?? '').trim(),
    lat: numberOrNull(venue.location?.latitude ?? venue.location?.lat),
    lon: numberOrNull(venue.location?.longitude ?? venue.location?.lon)
  };
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function daysUntil(startLocal, now) {
  return localDateDifference(startLocal, now);
}

async function requestJson(url, fetchImpl, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
  return response.json();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
