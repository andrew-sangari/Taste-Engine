import { localDateDifference, localWeekdayIndex, weekdayForLocalDate } from './localDate.js';

const SEATGEEK_EVENTS_URL = 'https://api.seatgeek.com/2/events';
const TICKETMASTER_EVENTS_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

export async function fetchSeatGeekSportsEvents({
  clientId,
  startDate,
  endDate,
  config,
  maxPages = 3,
  fetchImpl = fetch
} = {}) {
  if (!clientId) throw new Error('SEATGEEK_CLIENT_ID is not configured.');
  const events = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(SEATGEEK_EVENTS_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('q', config.teamName ?? 'Los Angeles Dodgers');
    url.searchParams.set('taxonomies.name', 'baseball');
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
  maxPages = 3,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY is not configured.');
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
  if (!ticket.startLocal || !game.startLocal || ticket.startLocal.slice(0, 10) !== game.startLocal.slice(0, 10)) return false;
  if (!venueMatches(ticket.venue, game.venue)) return false;
  const haystack = normalizeTeamText([ticket.title, ...(ticket.teamNames ?? [])].join(' '));
  if (!teamMatches(haystack, game.homeTeam)) return false;
  const opponentKnown = teamMatches(haystack, game.awayTeam);
  const anyOpponentMentioned = game.awayTeam?.name && normalizeTeamText(haystack).includes(normalizeTeamText(game.awayTeam.name).split(' ')[0]);
  return opponentKnown || !anyOpponentMentioned;
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
