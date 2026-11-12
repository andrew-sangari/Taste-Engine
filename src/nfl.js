// NFL schedule adapter. ESPN's public site API is the schedule source: it is
// the only keyless source that returned the complete remaining season with
// home/away, venue, kickoff validity, flex status, and broadcast. It is
// undocumented, so every read below is schema-tolerant and a shape change
// throws instead of silently producing an empty schedule.
//
// ESPN embeds a `tickets` block (a Vivid Seats affiliate listing) in each
// competition. It is never read: ticket observations come only from the
// permitted SeatGeek and Ticketmaster adapters in `sports.js`.
const ESPN_SITE_API = 'https://site.api.espn.com';
const ESPN_GAME_ROOT = 'https://www.espn.com/nfl/game/_/gameId';
const REQUEST_HEADERS = { accept: 'application/json', 'user-agent': 'taste-engine-schedule/0.1' };
const SEASON_TYPES = { 1: 'preseason', 2: 'regular', 3: 'postseason' };
const BROADCAST_ZONE = 'America/New_York';

export const RAMS_TEAM_ID = '14';
export const SOFI_STADIUM = Object.freeze({
  name: 'SoFi Stadium',
  city: 'Inglewood',
  state: 'CA',
  lat: 33.9535,
  lon: -118.3392
});

export async function fetchRamsHomeGames({
  startDate,
  endDate,
  timezone = 'America/Los_Angeles',
  fetchImpl = fetch,
  teamId = RAMS_TEAM_ID,
  homeVenueNames = [SOFI_STADIUM.name],
  homeVenue = SOFI_STADIUM,
  seasons = null,
  seasonTypes = [2, 3],
  // Optional collector. A partial failure (postseason or next-season request)
  // is pushed here so the caller can report the source as `partial`.
  warnings = [],
  retrievedAt = new Date()
} = {}) {
  if (!startDate || !endDate) throw new Error('NFL schedule requires startDate and endDate.');
  const seasonYears = seasons?.length ? seasons : nflSeasonsForWindow(startDate, endDate);
  const requests = seasonYears.flatMap((season) => seasonTypes.map((seasonType) => ({ season, seasonType })));
  const events = new Map();
  for (const [index, request] of requests.entries()) {
    const label = `${request.season} ${SEASON_TYPES[request.seasonType] ?? `type ${request.seasonType}`}`;
    try {
      const body = await requestSchedule({ teamId, ...request, fetchImpl });
      if (index === 0 && !body.events.length && seasonIsUnderway(startDate)) {
        warnings.push(`NFL ${label} schedule returned no events.`);
      }
      for (const event of body.events) {
        if (event?.id != null && !events.has(String(event.id))) events.set(String(event.id), event);
      }
    } catch (error) {
      // The first request is the schedule itself. Without it there is nothing
      // trustworthy to publish, so the caller must see the failure.
      if (index === 0) throw error;
      warnings.push(`NFL ${label} schedule unavailable: ${error.message}`);
    }
  }
  return [...events.values()]
    .map((event) => normalizeNflGame(event, { timezone, teamId, retrievedAt, homeVenue }))
    .filter((game) => isHomeGame(game, teamId, homeVenueNames))
    .filter((game) => !game.scheduleStatus.completed)
    .filter((game) => {
      const date = String(game.startLocal ?? '').slice(0, 10);
      return Boolean(date) && date >= startDate && date <= endDate;
    })
    .sort((left, right) => String(left.startLocal).localeCompare(String(right.startLocal)));
}

export async function fetchNflStandings({ season = null, fetchImpl = fetch } = {}) {
  const url = new URL('/apis/v2/sports/football/nfl/standings', ESPN_SITE_API);
  // level=3 groups entries by division; the default groups by conference only.
  url.searchParams.set('level', '3');
  if (season != null) url.searchParams.set('season', String(season));
  const standings = normalizeNflStandings(await requestJson(url, fetchImpl, 'standings'));
  if (!standings.size) throw new Error('NFL standings response had an unexpected shape.');
  return standings;
}

// An NFL season is named for the year it starts and runs into the following
// January/February, so a window that crosses New Year still belongs to the
// earlier season, and a window that reaches spring may touch the next one.
export function nflSeasonsForWindow(startDate, endDate) {
  const seasonFor = (value) => {
    const year = Number(String(value ?? '').slice(0, 4));
    const month = Number(String(value ?? '').slice(5, 7));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !year) return null;
    return month >= 3 ? year : year - 1;
  };
  const first = seasonFor(startDate);
  const last = seasonFor(endDate);
  if (first == null || last == null) throw new Error('NFL schedule dates must be YYYY-MM-DD.');
  const seasons = [];
  for (let season = first; season <= Math.max(first, last); season += 1) seasons.push(season);
  return seasons;
}

export function normalizeNflGame(event = {}, {
  timezone = 'America/Los_Angeles',
  teamId = RAMS_TEAM_ID,
  retrievedAt = new Date(),
  homeVenue = SOFI_STADIUM
} = {}) {
  const competition = event.competitions?.[0] ?? {};
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.find((competitor) => competitor?.homeAway === 'home') ?? {};
  const away = competitors.find((competitor) => competitor?.homeAway === 'away') ?? {};
  const homeTeam = normalizeNflTeam(home.team ?? (home.id != null ? { id: home.id } : {}));
  const awayTeam = normalizeNflTeam(away.team ?? (away.id != null ? { id: away.id } : {}));
  const eventId = String(event.id ?? competition.id ?? '');
  const rawDate = event.date ?? competition.date ?? null;
  const timeValid = (event.timeValid ?? competition.timeValid) !== false;
  const status = competition.status ?? event.status ?? {};
  const statusType = status.type ?? {};
  const flex = status.isTBDFlex === true;
  const timeTbd = !rawDate || !timeValid;
  const startLocal = localStart(rawDate, timeValid, timezone);
  const notes = (Array.isArray(competition.notes) ? competition.notes : []).map((note) => String(note?.headline ?? '').trim()).filter(Boolean);
  // A flex game without a kickoff can still move a day. ESPN states the
  // candidate dates in a note ("Flex Game: 1/9 or 1/10"); only the parsed
  // dates are kept, never the free text.
  const flexDates = flex && timeTbd ? flexCandidateDates(notes, startLocal) : [];
  const startUtc = rawDate && timeValid && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate).toISOString() : null;
  const venue = normalizeVenue(competition.venue, homeVenue);
  const broadcasts = broadcastNames(competition);
  const seasonTypeNumber = Number(event.seasonType?.type ?? event.seasonType?.id);
  const seasonType = SEASON_TYPES[seasonTypeNumber] ?? null;
  const weekNumber = numberOrNull(event.week?.number);
  const weekLabel = String(event.week?.text ?? '').trim() || (weekNumber != null ? `Week ${weekNumber}` : null);
  const seasonYear = numberOrNull(event.season?.year);
  const sourceUrl = gameUrl(event, eventId);
  const title = `${awayTeam.name || 'Away'} at ${homeTeam.name || 'Home'}`;
  const detailedState = String(statusType.description ?? '').trim() || 'Scheduled';
  const stateText = `${statusType.name ?? ''} ${detailedState}`;
  return {
    schemaVersion: 2,
    id: `nfl:${eventId}`,
    league: 'nfl',
    source: 'espn',
    sourceEventId: eventId,
    sourceUrl,
    retrievedAt: new Date(retrievedAt).toISOString(),
    title,
    type: 'football',
    startLocal,
    startUtc,
    timeTbd,
    dateTbd: !startLocal,
    status: detailedState,
    scheduleStatus: {
      abstractState: String(statusType.state ?? '').trim() || null,
      detailedState,
      codedState: String(statusType.name ?? '').trim() || null,
      reason: null,
      changed: /postpon|delay|suspend|resched|cancel/i.test(stateText),
      delayed: /delay/i.test(stateText),
      postponed: /postpon|suspend/i.test(stateText),
      rescheduled: /resched/i.test(stateText),
      completed: statusType.completed === true,
      flex,
      dateTentative: flex && timeTbd,
      flexDates
    },
    venue,
    neutralSite: competition.neutralSite === true,
    homeTeam,
    awayTeam,
    season: {
      year: seasonYear,
      type: seasonType,
      week: weekNumber,
      weekLabel,
      // The round name for a playoff game ("NFC Wild Card Playoffs").
      headline: seasonType === 'postseason' ? plainLabel(notes[0]) : null
    },
    // One NFL date is one matchup. A distinct id keeps each home date its own
    // card and its own overview representative.
    series: { id: `nfl:${seasonYear ?? 'season'}:${eventId}`, gameNumber: null, gameCount: null },
    kickoff: kickoffWindow(startUtc, timeTbd, competition),
    broadcasts,
    // Present so MLB-shaped consumers can read the field without a league branch.
    probablePitchers: { home: null, away: null, confirmed: false },
    ticketObservations: [],
    sourceOccurrences: [{
      source: 'espn',
      sourceEventId: eventId,
      sourceUrl,
      title,
      startLocal,
      venue: { name: venue.name, city: venue.city, state: venue.state },
      performerNames: [awayTeam.name, homeTeam.name].filter(Boolean)
    }]
  };
}

export function normalizeNflTeam(team = {}) {
  const nickname = String(team.shortDisplayName ?? team.nickname ?? team.name ?? '').trim();
  const location = String(team.location ?? '').trim();
  return {
    id: team.id == null ? null : String(team.id),
    name: String(team.displayName ?? [location, nickname].filter(Boolean).join(' ')).trim(),
    shortName: nickname,
    abbreviation: String(team.abbreviation ?? '').trim(),
    league: null,
    division: null
  };
}

export function normalizeNflStandings(body = {}) {
  const standings = new Map();
  const visit = (group, conference) => {
    if (!group || typeof group !== 'object') return;
    const isConference = group.isConference === true || /conference/i.test(String(group.name ?? ''));
    const nextConference = isConference ? groupRef(group) : conference;
    const entries = group.standings?.entries;
    if (Array.isArray(entries)) {
      const division = isConference ? null : groupRef(group);
      entries.forEach((entry, index) => {
        const team = normalizeNflTeam(entry?.team);
        if (!team.id) return;
        const stats = statLookup(entry.stats);
        const wins = stats.number('wins');
        const losses = stats.number('losses');
        const ties = stats.number('ties') ?? 0;
        const gamesPlayed = wins != null && losses != null ? wins + losses + ties : null;
        const seed = stats.number('playoffseed');
        standings.set(team.id, {
          team: { ...team, league: nextConference, division },
          league: nextConference,
          division,
          leagueRank: seed,
          playoffSeed: seed,
          // ESPN orders a division group by rank; a conference-only response
          // carries no division order, so the rank stays unknown.
          divisionRank: division ? index + 1 : null,
          wins,
          losses,
          ties,
          gamesPlayed,
          winPct: stats.number('winpercent') ?? (gamesPlayed ? (wins + ties / 2) / gamesPlayed : null),
          record: wins != null && losses != null ? `${wins}-${losses}${ties ? `-${ties}` : ''}` : stats.display('total'),
          lastTen: null,
          lastTenRecord: null,
          streak: stats.display('streak'),
          gamesBack: stats.number('gamesbehind'),
          wildCardGamesBack: null,
          playoffGamesBack: null,
          pointDifferential: stats.number('pointdifferential') ?? stats.number('differential'),
          pointsFor: stats.number('pointsfor'),
          pointsAgainst: stats.number('pointsagainst'),
          homeRecord: parseRecord(stats.display('home')),
          awayRecord: parseRecord(stats.display('road')),
          divisionRecord: parseRecord(stats.display('vsdiv')),
          conferenceRecord: parseRecord(stats.display('vsconf'))
        });
      });
    }
    for (const child of group.children ?? []) visit(child, nextConference);
  };
  visit(body, null);
  applyPlayoffGamesBack(standings);
  return standings;
}

// Attaches conference, division, and current record to each team so display
// and matching code can read them from the game without the standings map.
export function applyNflStandings(games, standings) {
  const withRecord = (team) => {
    const record = standings?.get?.(String(team?.id));
    return record ? { ...team, league: record.league, division: record.division, record: record.record } : team;
  };
  return (games ?? []).map((game) => ({
    ...game,
    homeTeam: withRecord(game.homeTeam),
    awayTeam: withRecord(game.awayTeam)
  }));
}

async function requestSchedule({ teamId, season, seasonType, fetchImpl }) {
  const url = new URL(`/apis/site/v2/sports/football/nfl/teams/${encodeURIComponent(String(teamId))}/schedule`, ESPN_SITE_API);
  url.searchParams.set('season', String(season));
  url.searchParams.set('seasontype', String(seasonType));
  const body = await requestJson(url, fetchImpl, 'schedule');
  if (!Array.isArray(body?.events)) throw new Error('NFL schedule response had an unexpected shape.');
  return body;
}

// ESPN's public endpoints drop the occasional request. One retry after a short
// pause separates a blip from an outage; a 4xx other than 429 is never retried.
export const NFL_RETRY = { attempts: 2, delayMs: 800 };

async function requestJson(url, fetchImpl, context) {
  let lastError = null;
  for (let attempt = 1; attempt <= NFL_RETRY.attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: REQUEST_HEADERS });
      if (response.ok) return await response.json();
      lastError = new Error(`NFL ${context} request failed (${response.status}).`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < NFL_RETRY.attempts) await new Promise((resolve) => setTimeout(resolve, NFL_RETRY.delayMs));
  }
  throw lastError;
}

function isHomeGame(game, teamId, homeVenueNames) {
  if (String(game.homeTeam?.id ?? '') !== String(teamId)) return false;
  // A designated-home game played abroad is not a home date to attend.
  if (game.neutralSite) return false;
  if (!homeVenueNames?.length) return true;
  const venue = normalizeText(game.venue?.name);
  // ESPN omits the venue for some unscheduled games; a non-neutral home game
  // without one is still a home date.
  if (!venue) return true;
  return homeVenueNames.some((name) => venue.includes(normalizeText(name)));
}

function seasonIsUnderway(startDate) {
  const month = Number(String(startDate ?? '').slice(5, 7));
  return month >= 9 || month === 1;
}

function localStart(rawDate, timeValid, timezone) {
  if (!rawDate) return null;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return null;
  if (timeValid) return toLocalIso(date, timezone);
  // An unscheduled kickoff is published as midnight Eastern. Converting that
  // instant to Pacific time would move the game to the previous day, so keep
  // the Eastern calendar date and carry no real time.
  const dateKey = toLocalIso(date, BROADCAST_ZONE)?.slice(0, 10);
  if (!dateKey) return null;
  const offset = toLocalIso(new Date(`${dateKey}T20:00:00Z`), timezone)?.slice(19) ?? '';
  return `${dateKey}T00:00:00${offset}`;
}

function kickoffWindow(startUtc, timeTbd, competition) {
  if (timeTbd || !startUtc) return { code: 'tbd', label: 'Kickoff TBD', primetime: false };
  // Windows are defined by the national broadcast clock, not the venue's.
  const eastern = toLocalIso(new Date(startUtc), BROADCAST_ZONE);
  const weekday = new Date(`${eastern.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const hour = Number(eastern.slice(11, 13));
  const night = hour >= 19;
  if (weekday === 4 && night) return { code: 'TNF', label: 'Thursday Night Football', primetime: true };
  if (weekday === 0 && night) return { code: 'SNF', label: 'Sunday Night Football', primetime: true };
  if (weekday === 1 && night) return { code: 'MNF', label: 'Monday Night Football', primetime: true };
  if (weekday === 0) {
    return hour >= 16
      ? { code: 'sunday-late', label: 'Sunday late-afternoon kickoff', primetime: false }
      : { code: 'sunday-early', label: 'Sunday early kickoff', primetime: false };
  }
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday];
  if (hasNationalBroadcast(competition)) {
    return { code: 'standalone', label: `${dayName}${night ? ' night' : ''} national broadcast`, primetime: night };
  }
  return { code: 'other', label: `${dayName} kickoff`, primetime: false };
}

function flexCandidateDates(notes, startLocal) {
  const anchor = String(startLocal ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return [];
  const anchorTime = Date.parse(`${anchor}T12:00:00Z`);
  const dates = new Set();
  for (const note of notes) {
    if (!/flex/i.test(note)) continue;
    for (const match of note.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      // The note carries no year; take the one that lands beside the listed date.
      const candidate = [-1, 0, 1]
        .map((offset) => Date.UTC(Number(anchor.slice(0, 4)) + offset, month - 1, day, 12))
        .sort((left, right) => Math.abs(left - anchorTime) - Math.abs(right - anchorTime))[0];
      if (Math.abs(candidate - anchorTime) <= 7 * 86_400_000) dates.add(new Date(candidate).toISOString().slice(0, 10));
    }
  }
  return [...dates].sort();
}

function plainLabel(value) {
  const label = String(value ?? '').replace(/[^A-Za-z0-9 .,:&'/-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return label || null;
}

function hasNationalBroadcast(competition = {}) {
  return (competition.broadcasts ?? []).some((broadcast) => /national/i.test(String(broadcast?.market?.type ?? broadcast?.market ?? '')));
}

function broadcastNames(competition = {}) {
  const names = [
    ...(competition.broadcasts ?? []).flatMap((broadcast) => [broadcast?.media?.shortName, ...(Array.isArray(broadcast?.names) ? broadcast.names : [])]),
    ...(competition.geoBroadcasts ?? []).map((broadcast) => broadcast?.media?.shortName),
    typeof competition.broadcast === 'string' ? competition.broadcast : null
  ].map((name) => String(name ?? '').trim()).filter(Boolean);
  return [...new Set(names)];
}

function normalizeVenue(venue = {}, homeVenue = SOFI_STADIUM) {
  const name = String(venue?.fullName ?? venue?.name ?? '').trim();
  const isHomeVenue = Boolean(name && homeVenue?.name && normalizeText(name).includes(normalizeText(homeVenue.name)));
  return {
    sourceId: venue?.id == null ? null : String(venue.id),
    name,
    city: String(venue?.address?.city ?? (isHomeVenue ? homeVenue.city : '') ?? '').trim(),
    state: String(venue?.address?.state ?? (isHomeVenue ? homeVenue.state : '') ?? '').trim(),
    // ESPN's schedule carries no coordinates; the configured home venue does.
    lat: isHomeVenue ? numberOrNull(homeVenue.lat) : null,
    lon: isHomeVenue ? numberOrNull(homeVenue.lon) : null
  };
}

function gameUrl(event, eventId) {
  const link = (event.links ?? []).find((item) => (item?.rel ?? []).includes('summary') && (item?.rel ?? []).includes('desktop'));
  try {
    const url = new URL(String(link?.href ?? ''));
    if (url.protocol === 'https:' && /(^|\.)espn\.com$/.test(url.hostname)) return url.toString();
  } catch {
    // Fall through to the canonical game URL.
  }
  return `${ESPN_GAME_ROOT}/${eventId}`;
}

function groupRef(group) {
  return { id: group.id == null ? null : String(group.id), name: String(group.name ?? '').trim() };
}

function statLookup(stats) {
  const byKey = new Map();
  for (const stat of Array.isArray(stats) ? stats : []) {
    for (const key of [stat?.type, stat?.name]) {
      const normalized = String(key ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalized && !byKey.has(normalized)) byKey.set(normalized, stat);
    }
  }
  return {
    number: (key) => {
      const stat = byKey.get(key);
      return stat && stat.value != null ? numberOrNull(stat.value) : null;
    },
    display: (key) => {
      const value = String(byKey.get(key)?.displayValue ?? byKey.get(key)?.summary ?? '').trim();
      return value || null;
    }
  };
}

function parseRecord(value) {
  const match = String(value ?? '').match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  const ties = Number(match[3] ?? 0);
  const games = wins + losses + ties;
  return { wins, losses, ties, winPct: games ? (wins + ties / 2) / games : null };
}

// Seven teams per conference qualify. Distance from the seventh seed is the
// only "in the race" measure the standings support without tiebreak logic.
function applyPlayoffGamesBack(standings) {
  const conferences = new Map();
  for (const record of standings.values()) {
    const key = record.league?.id ?? record.league?.name ?? 'league';
    conferences.set(key, [...(conferences.get(key) ?? []), record]);
  }
  for (const records of conferences.values()) {
    const cutoff = records.find((record) => record.playoffSeed === 7);
    if (!cutoff || cutoff.wins == null || cutoff.losses == null) continue;
    for (const record of records) {
      if (record.wins == null || record.losses == null || record.playoffSeed == null) continue;
      record.playoffGamesBack = record.playoffSeed <= 7
        ? 0
        : Math.max(0, ((cutoff.wins - record.wins) + (record.losses - cutoff.losses)) / 2);
    }
  }
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

function normalizeText(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
