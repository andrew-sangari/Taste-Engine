const API_ROOT = 'https://statsapi.mlb.com/api/v1';
const MLB_GAMEDAY_ROOT = 'https://www.mlb.com/gameday';

export async function fetchDodgersHomeGames({
  teamId = 119,
  startDate,
  endDate,
  homeVenueIds = [],
  season = null,
  timezone = 'America/Los_Angeles',
  fetchImpl = fetch
} = {}) {
  if (!startDate || !endDate) throw new Error('MLB schedule requires startDate and endDate.');
  const url = new URL('/api/v1/schedule', 'https://statsapi.mlb.com');
  url.searchParams.set('sportId', '1');
  url.searchParams.set('teamId', String(teamId));
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  url.searchParams.set('hydrate', 'team,venue,seriesStatus,probablePitcher');
  url.searchParams.set('includeSeriesNumber', 'true');
  if (season != null) url.searchParams.set('season', String(season));
  const body = await requestJson(url, fetchImpl, 'schedule');
  const games = (body.dates ?? []).flatMap((date) => date.games ?? []);
  return games
    .filter((game) => isHomeGame(game, teamId, homeVenueIds))
    .map((game) => normalizeMlbGame(game, { timezone, teamId }));
}

export async function fetchMlbStandings({
  season,
  leagueIds = ['103', '104'],
  fetchImpl = fetch
} = {}) {
  const url = new URL('/api/v1/standings', 'https://statsapi.mlb.com');
  url.searchParams.set('leagueId', leagueIds.join(','));
  url.searchParams.set('standingsTypes', 'regularSeason');
  url.searchParams.set('hydrate', 'team');
  if (season != null) url.searchParams.set('season', String(season));
  const body = await requestJson(url, fetchImpl, 'standings');
  return normalizeStandings(body);
}

export async function fetchMlbPitcherStats(pitcherIds, {
  season,
  maxPitchers = 48,
  fetchImpl = fetch,
  concurrency = 4
} = {}) {
  const ids = [...new Set((pitcherIds ?? []).map(String).filter(Boolean))].slice(0, maxPitchers);
  const result = new Map();
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const url = new URL(`/api/v1/people/${encodeURIComponent(id)}`, 'https://statsapi.mlb.com');
        url.searchParams.set('hydrate', `stats(group=pitching,type=season${season != null ? `,season=${season}` : ''})`);
        const body = await requestJson(url, fetchImpl, `pitcher stats ${id}`);
        const person = body.people?.[0];
        const split = person?.stats?.flatMap((item) => item.splits ?? [])?.[0];
        const stat = split?.stat;
        if (person && stat) result.set(id, {
          id,
          name: person.fullName ?? null,
          era: numberOrNull(stat.era),
          whip: numberOrNull(stat.whip),
          strikeoutsPer9: numberOrNull(stat.strikeoutsPer9Inn),
          inningsPitched: numberOrNull(String(stat.inningsPitched ?? '').replace(/[^0-9.]/g, '')),
          wins: numberOrNull(stat.wins),
          losses: numberOrNull(stat.losses),
          season: split.season ?? season ?? null
        });
      } catch {
        // Pitcher stats are enrichment only. Keep the schedule usable when a
        // player endpoint is unavailable or a probable pitcher is unresolved.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return result;
}

export function normalizeMlbGame(game, { timezone = 'America/Los_Angeles', teamId = 119, retrievedAt = new Date() } = {}) {
  const home = game.teams?.home ?? {};
  const away = game.teams?.away ?? {};
  const homeTeam = normalizeTeam(home.team);
  const awayTeam = normalizeTeam(away.team);
  const venue = game.venue ?? home.team?.venue ?? {};
  const season = game.season ?? game.seasonDisplay ?? null;
  const seriesNumber = game.seriesNumber ?? home.seriesNumber ?? away.seriesNumber ?? null;
  const seriesId = season != null && seriesNumber != null
    ? `mlb:${season}:${seriesNumber}:${Math.min(Number(homeTeam.id ?? teamId), Number(awayTeam.id ?? 0))}:${Math.max(Number(homeTeam.id ?? teamId), Number(awayTeam.id ?? 0))}`
    : null;
  return {
    schemaVersion: 1,
    id: `mlb:${game.gamePk}`,
    source: 'mlb',
    sourceEventId: String(game.gamePk),
    sourceUrl: `${MLB_GAMEDAY_ROOT}/${game.gamePk}`,
    retrievedAt: new Date(retrievedAt).toISOString(),
    title: `${awayTeam.name ?? 'Away'} at ${homeTeam.name ?? 'Home'}`,
    type: 'baseball',
    startLocal: game.gameDate ? toLocalIso(game.gameDate, timezone) : null,
    startUtc: game.gameDate ?? null,
    timeTbd: Boolean(game.status?.startTimeTBD),
    dateTbd: !game.officialDate,
    status: game.status?.detailedState ?? 'Scheduled',
    venue: {
      sourceId: venue.id == null ? null : String(venue.id),
      name: String(venue.name ?? 'Dodger Stadium').trim(),
      city: 'Los Angeles',
      state: 'CA',
      lat: numberOrNull(venue.location?.latitude ?? venue.geoLocation?.latitude),
      lon: numberOrNull(venue.location?.longitude ?? venue.geoLocation?.longitude)
    },
    homeTeam,
    awayTeam,
    series: {
      id: seriesId,
      gameNumber: numberOrNull(game.seriesStatus?.gameNumber ?? game.seriesGameNumber ?? game.gameNumber),
      gameCount: numberOrNull(game.seriesStatus?.totalGames ?? game.gamesInSeries)
    },
    probablePitchers: {
      home: normalizePitcher(home.probablePitcher),
      away: normalizePitcher(away.probablePitcher),
      confirmed: Boolean(home.probablePitcher?.id && away.probablePitcher?.id)
    },
    ticketObservations: []
    ,sourceOccurrences: [{
      source: 'mlb',
      sourceEventId: String(game.gamePk),
      sourceUrl: `${MLB_GAMEDAY_ROOT}/${game.gamePk}`,
      title: `${awayTeam.name ?? 'Away'} at ${homeTeam.name ?? 'Home'}`,
      startLocal: game.gameDate ? toLocalIso(game.gameDate, timezone) : null,
      venue: {
        name: String(venue.name ?? 'Dodger Stadium').trim(),
        city: 'Los Angeles',
        state: 'CA'
      },
      performerNames: [awayTeam.name, homeTeam.name].filter(Boolean)
    }]
  };
}

export function normalizeStandings(body) {
  const standings = new Map();
  for (const record of body.records ?? []) {
    for (const teamRecord of record.teamRecords ?? []) {
      const team = normalizeTeam(teamRecord.team);
      const lastTen = (teamRecord.records?.splitRecords ?? []).find((split) => split.type === 'lastTen');
      standings.set(String(team.id), {
        team,
        leagueRank: numberOrNull(teamRecord.leagueRank),
        divisionRank: numberOrNull(teamRecord.divisionRank),
        wins: numberOrNull(teamRecord.wins ?? teamRecord.leagueRecord?.wins),
        losses: numberOrNull(teamRecord.losses ?? teamRecord.leagueRecord?.losses),
        winPct: numberOrNull(teamRecord.winningPercentage ?? teamRecord.leagueRecord?.pct),
        lastTen: lastTen ? `${lastTen.wins}-${lastTen.losses}` : null,
        streak: teamRecord.streak?.streakCode ?? null,
        gamesBack: numberOrNull(teamRecord.gamesBack),
        division: team.division,
        league: team.league
      });
    }
  }
  return standings;
}

export function normalizeTeam(team = {}) {
  return {
    id: team.id == null ? null : String(team.id),
    name: String(team.name ?? '').trim(),
    shortName: String(team.shortName ?? team.teamName ?? '').trim(),
    abbreviation: String(team.abbreviation ?? '').trim(),
    league: team.league ? { id: String(team.league.id), name: String(team.league.name ?? '') } : null,
    division: team.division ? { id: String(team.division.id), name: String(team.division.name ?? '') } : null
  };
}

export function normalizePitcher(pitcher) {
  if (!pitcher?.id && !pitcher?.fullName) return null;
  return {
    id: pitcher.id == null ? null : String(pitcher.id),
    name: String(pitcher.fullName ?? '').trim(),
    era: null,
    whip: null,
    strikeoutsPer9: null,
    inningsPitched: null
  };
}

export function applyPitcherStats(games, stats) {
  return games.map((game) => {
    const pitcherStats = (pitcher) => pitcher ? { ...pitcher, ...(stats.get(String(pitcher.id)) ?? {}) } : null;
    return {
      ...game,
      probablePitchers: {
        home: pitcherStats(game.probablePitchers?.home),
        away: pitcherStats(game.probablePitchers?.away),
        confirmed: game.probablePitchers?.confirmed ?? false
      }
    };
  });
}

function isHomeGame(game, teamId, homeVenueIds) {
  if (String(game.teams?.home?.team?.id ?? '') !== String(teamId)) return false;
  if (!homeVenueIds?.length) return true;
  return homeVenueIds.map(String).includes(String(game.venue?.id ?? game.teams?.home?.team?.venue?.id ?? ''));
}

function toLocalIso(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const offset = String(values.timeZoneName ?? 'GMT').replace(/^GMT/, '') || '+00:00';
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}${offset}`;
}

async function requestJson(url, fetchImpl, context) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`MLB ${context} request failed (${response.status}).`);
  return response.json();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
