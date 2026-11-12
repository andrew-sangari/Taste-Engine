import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPitcherStats, fetchDodgersHomeGames, fetchMlbPitcherStats, fetchMlbStandings, normalizeMlbGame } from '../src/mlb.js';
import { readFile } from 'node:fs/promises';
import { buildOverview } from '../src/overview.js';
import { toDisplaySportsGame } from '../src/projection.js';
import { applyNflStandings, normalizeNflGame, normalizeNflStandings } from '../src/nfl.js';
import { enrichSportsGames, fetchSeatGeekSportsEvents, fetchTicketmasterSportsEvents, joinSportsTickets, normalizeSeatGeekSportsEvent, normalizeTicketmasterSportsEvent, scoreSportsGame, sportsLeagueConfig, sportsLeagueOf, ticketMatchesGame } from '../src/sports.js';

const config = {
  teamName: 'Los Angeles Dodgers',
  home: { lat: 34.0522, lon: -118.2437 },
  searchRadiusMiles: 60,
  homeVenueNames: ['Dodger Stadium'],
  rivalries: { '135': { tier: 'high', label: 'Padres rivalry' } }
};

const gameRaw = {
  gamePk: 123,
  season: '2026',
  gameDate: '2026-08-15T23:10:00Z',
  officialDate: '2026-08-15',
  status: { startTimeTBD: false, detailedState: 'Scheduled' },
  seriesNumber: 4,
  seriesStatus: { gameNumber: 2, totalGames: 3 },
  venue: { id: 22, name: 'Dodger Stadium' },
  teams: {
    away: { team: { id: 135, name: 'San Diego Padres', shortName: 'San Diego', abbreviation: 'SD', league: { id: 104, name: 'National League' }, division: { id: 203, name: 'National League West' } }, probablePitcher: { id: 10, fullName: 'Padres Ace' } },
    home: { team: { id: 119, name: 'Los Angeles Dodgers', shortName: 'LA Dodgers', abbreviation: 'LAD', league: { id: 104, name: 'National League' }, division: { id: 203, name: 'National League West' } }, probablePitcher: { id: 11, fullName: 'Dodgers Ace' } }
  }
};

test('fetches and filters Dodgers home games from the MLB schedule', async () => {
  let requestUrl;
  const body = { dates: [{ games: [gameRaw, { ...gameRaw, gamePk: 124, teams: { ...gameRaw.teams, home: gameRaw.teams.away, away: gameRaw.teams.home } }] }] };
  const games = await fetchDodgersHomeGames({ teamId: 119, startDate: '2026-08-01', endDate: '2026-08-31', homeVenueIds: [22], timezone: 'America/Los_Angeles', fetchImpl: async (url) => { requestUrl = url; return new Response(JSON.stringify(body)); } });
  assert.equal(games.length, 1);
  assert.equal(games[0].id, 'mlb:123');
  assert.equal(games[0].series.gameNumber, 2);
  assert.match(requestUrl.search, /hydrate=.*probablePitcher/);
});

test('normalizes standings and optional pitcher stats', async () => {
  const standingsBody = { records: [{ teamRecords: [{
    team: { id: 135, name: 'San Diego Padres', shortName: 'San Diego', abbreviation: 'SD', league: { id: 104, name: 'National League' }, division: { id: 203, name: 'National League West' } },
    leagueRank: '4', divisionRank: '2', wins: 60, losses: 40, winningPercentage: '.600', streak: { streakCode: 'W3' }, wildCardGamesBack: '1.5', runDifferential: '72',
    records: { splitRecords: [{ type: 'lastTen', wins: 7, losses: 3 }, { type: 'home', wins: 34, losses: 18 }, { type: 'away', wins: 26, losses: 22 }] }
  }] }] };
  const standings = await fetchMlbStandings({ season: 2026, fetchImpl: async () => new Response(JSON.stringify(standingsBody)) });
  assert.equal(standings.get('135').winPct, 0.6);
  assert.equal(standings.get('135').lastTen, '7-3');
  assert.equal(standings.get('135').runDifferential, 72);
  assert.equal(standings.get('135').homeRecord.wins, 34);

  const statsBody = { people: [{ id: 10, fullName: 'Padres Ace', pitchHand: { code: 'L' }, stats: [{ splits: [{ season: '2026', stat: { era: '2.80', whip: '1.05', strikeOuts: '165', inningsPitched: '120.2' } }] }] }] };
  const stats = await fetchMlbPitcherStats(['10'], { season: 2026, fetchImpl: async () => new Response(JSON.stringify(statsBody)) });
  assert.equal(stats.get('10').era, 2.8);
  assert.equal(stats.get('10').handedness, 'L');
  assert.equal(stats.get('10').strikeouts, 165);
  assert.equal(applyPitcherStats([normalizeMlbGame(gameRaw)], stats)[0].probablePitchers.away.era, 2.8);
});

test('builds deterministic opponent, pitching, and series context for a game', () => {
  const base = normalizeMlbGame(gameRaw);
  const enriched = enrichSportsGames([base], new Map([['135', {
    winPct: 0.6, leagueRank: 4, divisionRank: 2, lastTen: '7-3', lastTenRecord: { wins: 7, losses: 3 }, streak: 'W3', gamesBack: 2,
    wildCardGamesBack: 1.5, runDifferential: 72, division: { name: 'National League West' }
  }]]), config, { pitcherStats: new Map([
    ['10', { era: 2.8, whip: 1.05, inningsPitched: 120, handedness: 'L' }],
    ['11', { era: 3.1, whip: 1.1, inningsPitched: 115, handedness: 'R' }]
  ]) });
  assert.equal(enriched[0].sportsContext.rivalryTier, 'high');
  assert.ok(enriched[0].ranking.rivalryScore >= 15);
  assert.ok(enriched[0].ranking.pitchingScore >= 7);
  assert.equal(enriched[0].sportsContext.pitcherMatchupTier, 'ace');
  assert.equal(enriched[0].sportsContext.seriesPosition.label, 'Game 2 of 3');
  assert.ok(enriched[0].sportsContext.opponentTags.includes('+72 run differential'));
  assert.equal(enriched[0].sportsContext.gameContext.pitching.matchupTier, 'ace');
  assert.ok(enriched[0].ranking.interestScore > 60);
  assert.equal(enriched[0].ranking.urgency, 'unknown');
});

test('keeps incomplete probable pitchers and changed schedule out of strong matchup claims', () => {
  const normalized = normalizeMlbGame({ ...gameRaw, status: { detailedState: 'Postponed', abstractGameState: 'Final' }, teams: {
    ...gameRaw.teams,
    away: { ...gameRaw.teams.away, probablePitcher: null }
  } });
  const enriched = enrichSportsGames([normalized], new Map(), config)[0];
  assert.equal(enriched.sportsContext.pitcherMatchupTier, 'unknown');
  assert.equal(enriched.ranking.pitchingScore, 0);
  assert.equal(enriched.sportsContext.schedule.postponed, true);
  assert.ok(enriched.tags.includes('Schedule update'));
});

test('joins ticket sources without hiding an unticketed game', () => {
  const game = enrichSportsGames([normalizeMlbGame(gameRaw)], new Map(), config)[0];
  const ticket = normalizeTicketmasterSportsEvent({ id: 'tm1', name: 'San Diego Padres at Los Angeles Dodgers', url: 'https://ticketmaster.example/game', dates: { start: { localDate: '2026-08-15', localTime: '16:10:00' } }, _embedded: { venues: [{ id: '22', name: 'Dodger Stadium', city: { name: 'Los Angeles' }, state: { stateCode: 'CA' } }], attractions: [{ name: 'Los Angeles Dodgers' }, { name: 'San Diego Padres' }] } });
  const joined = joinSportsTickets(game ? [game] : [], [ticket], config, new Date('2026-08-01T00:00:00Z'))[0];
  assert.equal(joined.ticketObservations[0].source, 'ticketmaster');
  assert.equal(joined.ranking.urgency, 'safe to wait');
  const unknown = joinSportsTickets([game], [], config)[0];
  assert.equal(unknown.ranking.urgency, 'unknown');
});

test('sports ticket adapters apply source-specific queries', async () => {
  let seatGeekUrl;
  await fetchSeatGeekSportsEvents({ clientId: 'key', startDate: '2026-08-01', endDate: '2026-08-31', config, fetchImpl: async (url) => { seatGeekUrl = url; return new Response(JSON.stringify({ events: [], meta: { total: 0 } })); } });
  assert.equal(seatGeekUrl.searchParams.get('taxonomies.name'), 'baseball');
  let ticketmasterUrl;
  await fetchTicketmasterSportsEvents({ apiKey: 'key', startDate: '2026-08-01', endDate: '2026-08-31', config, fetchImpl: async (url) => { ticketmasterUrl = url; return new Response(JSON.stringify({ _embedded: { events: [] }, page: { totalPages: 0 } })); } });
  assert.equal(ticketmasterUrl.searchParams.get('classificationName'), 'Sports');
  assert.equal(ticketmasterUrl.searchParams.get('keyword'), 'Los Angeles Dodgers');
});

test('normalizes SeatGeek sports observations without exposing raw payload fields', () => {
  const normalized = normalizeSeatGeekSportsEvent({ id: 1, title: 'Padres at Dodgers', url: 'https://seatgeek.example', datetime_local: '2026-08-15T16:10:00', performers: [{ name: 'Los Angeles Dodgers' }, { name: 'San Diego Padres' }], venue: { id: 22, name: 'Dodger Stadium', city: 'Los Angeles' }, stats: { lowest_price: 40, listing_count: 12 } });
  assert.equal(normalized.ticketObservation.lowestPriceUsd, 40);
  assert.equal(normalized.teamNames.length, 3);
});

// ── NFL ────────────────────────────────────────────────────────────────────
// The same shared config object the MLB tests use, extended with an `nfl`
// block the way config/sports.json would carry it.
const nflSchedule = JSON.parse(await readFile(new URL('./fixtures/nfl/espn-rams-schedule-2026.json', import.meta.url), 'utf8'));
const nflStandings = normalizeNflStandings(JSON.parse(await readFile(new URL('./fixtures/nfl/espn-nfl-standings-2026.json', import.meta.url), 'utf8')));
const sharedConfig = { ...config, maxTicketPriceUsd: 250, nfl: { teamName: 'Los Angeles Rams' } };
const nflNow = new Date('2026-11-11T20:00:00Z');
const nflGame = (week, overrides = {}) => applyNflStandings([normalizeNflGame({ ...nflSchedule.events.find((event) => event.week.number === week), ...overrides })], nflStandings)[0];
const enrichNfl = (game, standings = nflStandings, sportsConfig = sharedConfig) => enrichSportsGames([game], standings, sportsConfig, { now: nflNow })[0];
const ramsTicket = (overrides = {}) => normalizeTicketmasterSportsEvent({
  id: 'tm-rams-chiefs',
  name: 'Los Angeles Rams vs. Kansas City Chiefs',
  url: 'https://ticketmaster.example/rams-chiefs',
  dates: { start: { localDate: '2026-12-03', localTime: '17:15:00' } },
  priceRanges: [{ min: 180 }],
  _embedded: {
    venues: [{ id: 'sofi', name: 'SoFi Stadium', city: { name: 'Inglewood' }, state: { stateCode: 'CA' }, location: { latitude: '33.9535', longitude: '-118.3392' } }],
    attractions: [{ name: 'Los Angeles Rams' }, { name: 'Kansas City Chiefs' }]
  },
  ...overrides
});

test('resolves league config without changing the MLB config object', () => {
  assert.equal(sportsLeagueConfig(config, 'mlb'), config);
  assert.equal(sportsLeagueOf(normalizeMlbGame(gameRaw)), 'mlb');
  assert.equal(sportsLeagueOf(nflGame(13)), 'nfl');
  assert.equal(sportsLeagueOf({ id: 'nfl:1' }), 'nfl');
  const nfl = sportsLeagueConfig({ ...sharedConfig, nfl: { teamName: 'Los Angeles Rams', baseHassle: 4, rivalries: { '26': { tier: 'high', label: 'Seahawks rivalry', division: true } } } }, 'nfl');
  assert.equal(nfl.league, 'nfl');
  assert.equal(nfl.teamName, 'Los Angeles Rams');
  assert.deepEqual(nfl.homeVenueNames, ['SoFi Stadium']);
  assert.deepEqual(nfl.home, config.home);
  assert.equal(nfl.maxTicketPriceUsd, 250);
  assert.equal(nfl.baseHassle, 4);
  // A configured rivalry map replaces the default one.
  assert.deepEqual(Object.keys(nfl.rivalries), ['26']);
  // The MLB rivalry map never leaks into another league.
  assert.equal(sportsLeagueConfig(sharedConfig, 'nfl').rivalries['135'], undefined);
  assert.equal(sportsLeagueConfig(nfl, 'nfl'), nfl);
});

test('scores an NFL home game from opponent record, kickoff window, and leverage', () => {
  const chiefs = enrichNfl(nflGame(13));
  assert.equal(chiefs.sportsContext.league, 'nfl');
  assert.equal(chiefs.sportsContext.opponentRecord, '6-2');
  assert.equal(chiefs.sportsContext.rivalryTier, 'none');
  assert.equal(chiefs.sportsContext.kickoffWindow.code, 'TNF');
  assert.equal(chiefs.sportsContext.playoffLeverage, 'medium');
  assert.equal(chiefs.sportsContext.seriesPosition.label, 'Week 13');
  assert.deepEqual(chiefs.sportsContext.probablePitchers, { home: null, away: null, confirmed: false });
  assert.equal(chiefs.ranking.league, 'nfl');
  assert.equal(chiefs.ranking.opponentQuality, 18);
  assert.equal(chiefs.ranking.opponentStakesScore, 4);
  assert.equal(chiefs.ranking.rivalryScore, 0);
  assert.equal(chiefs.ranking.primetimeScore, 6);
  assert.equal(chiefs.ranking.leverageScore, 6);
  assert.equal(chiefs.ranking.convenienceScore, 4);
  assert.equal(chiefs.ranking.pitchingScore, 0);
  // 42 base + 18 + 4 + 0 + 6 + 6 + 4.
  assert.equal(chiefs.ranking.interestScore, 80);
  // Interest and hassle stay separate: the weeknight kickoff costs hassle only.
  assert.equal(chiefs.ranking.hassleScore, 4);
  assert.deepEqual(chiefs.ranking.hassleReasons, ['SoFi Stadium logistics', 'weeknight rush-hour kickoff']);
  assert.equal(chiefs.ranking.utility, 72);
  assert.equal(chiefs.ranking.urgency, 'unknown');
  assert.equal(chiefs.ranking.confidence, 'high');
  assert.deepEqual(chiefs.tags, ['Thursday Night Football', '6-2 record', 'AFC No. 5 seed today', '+59 point differential', 'Week 13']);
  assert.equal(chiefs.ranking.whyYou, 'Manageable Thursday home game against the Chiefs (6-2): a top-tier opponent and a prime-time Thursday Night Football window. Week 13.');
});

test('scores a division rival and late-season leverage, and keeps a flex date tentative', () => {
  const seahawks = enrichNfl(nflGame(18));
  assert.equal(seahawks.sportsContext.divisionGame, true);
  assert.equal(seahawks.sportsContext.divisionName, 'NFC West');
  assert.equal(seahawks.sportsContext.rivalryTier, 'medium');
  assert.equal(seahawks.sportsContext.playoffLeverage, 'high');
  assert.equal(seahawks.ranking.rivalryScore, 8);
  assert.equal(seahawks.ranking.leverageScore, 10);
  assert.equal(seahawks.ranking.primetimeScore, 0);
  assert.equal(seahawks.ranking.interestScore, 82);
  assert.equal(seahawks.ranking.hassleScore, 5);
  assert.ok(seahawks.ranking.hassleReasons.includes('date and kickoff time are TBD'));
  assert.equal(seahawks.ranking.confidence, 'medium');
  assert.ok(seahawks.tags.includes('NFC West rival'));
  assert.ok(seahawks.tags.includes('Late-season leverage'));
  assert.ok(seahawks.tags.includes('Date and kickoff TBD'));
  // The listed Sunday is a placeholder, so no weekday is asserted.
  assert.ok(!seahawks.tags.includes('Weekend game'));
  assert.equal(seahawks.ranking.whyYou, 'Manageable home game against the Seahawks (5-4): an NFC West division matchup, a winning opponent, and late-season playoff leverage. Week 18. Date and kickoff time are not final under NFL flexible scheduling (Saturday, January 9 or Sunday, January 10).');

  // The configured marquee rivalry outranks the plain division tier.
  const niners = enrichNfl(nflGame(15, {
    competitions: [{
      ...nflSchedule.events.find((event) => event.week.number === 15).competitions[0],
      competitors: [
        { homeAway: 'home', team: { id: '14', displayName: 'Los Angeles Rams', shortDisplayName: 'Rams', abbreviation: 'LAR' } },
        { homeAway: 'away', team: { id: '25', displayName: 'San Francisco 49ers', shortDisplayName: '49ers', abbreviation: 'SF' } }
      ]
    }]
  }));
  assert.equal(niners.sportsContext.rivalryTier, 'high');
  assert.equal(niners.ranking.rivalryScore, 15);
  assert.deepEqual(niners.tags.slice(0, 3), ['49ers rivalry', 'NFC West rival', 'Late-season leverage']);
  assert.match(niners.ranking.whyYou, /^Sunday home game against the 49ers \(7-1\): a marquee division rivalry, a top-tier opponent, and late-season playoff leverage\. Week 15\.$/);
});

test('a weak opponent is not auto-recommended and still reads truthfully', () => {
  const cowboys = enrichNfl(nflGame(15));
  assert.equal(cowboys.ranking.opponentQuality, 6);
  assert.equal(cowboys.ranking.rivalryScore, 0);
  assert.equal(cowboys.ranking.interestScore, 64);
  assert.equal(cowboys.ranking.hassleScore, 3);
  assert.equal(cowboys.ranking.whyYou, 'Sunday home game against the Cowboys (4-5): a weekend kickoff. Week 15.');
  // A winless visitor on a weeknight falls below the recommendation line.
  const winless = new Map([...nflStandings].map(([id, record]) => [id, id === '12' ? { ...record, wins: 0, losses: 8, winPct: 0, record: '0-8', playoffSeed: 16, leagueRank: 16, divisionRank: 4, pointDifferential: -98, streak: 'L8', playoffGamesBack: 6 } : record]));
  const weak = enrichNfl(nflGame(13), winless);
  assert.equal(weak.ranking.opponentQuality, 0);
  assert.equal(weak.ranking.opponentStakesScore, 0);
  assert.ok(weak.ranking.interestScore < 55);
});

test('missing or early-season standings are uncertainty, not a negative signal', () => {
  const unknown = enrichNfl(nflGame(13), new Map());
  assert.equal(unknown.sportsContext.opponentWinPct, null);
  assert.equal(unknown.sportsContext.playoffLeverage, 'unknown');
  assert.equal(unknown.ranking.opponentQuality, 0);
  assert.equal(unknown.ranking.leverageScore, 0);
  assert.equal(unknown.ranking.confidence, 'medium');
  assert.deepEqual(unknown.sportsContext.opponentTags, []);
  assert.equal(unknown.ranking.whyYou, 'Manageable Thursday home game against the Chiefs: a prime-time Thursday Night Football window. Week 13.');
  // With no standings the configured division map still identifies a rival.
  const rival = enrichNfl(normalizeNflGame(nflSchedule.events.find((event) => event.week.number === 18)), new Map());
  assert.equal(rival.sportsContext.divisionGame, true);
  assert.equal(rival.ranking.rivalryScore, 8);
  assert.ok(rival.tags.includes('Division rival'));

  // One game played is not a record worth ranking on.
  const weekTwo = new Map([...nflStandings].map(([id, record]) => [id, { ...record, wins: 1, losses: 0, ties: 0, gamesPlayed: 1, winPct: 1, record: '1-0' }]));
  const early = enrichNfl(nflGame(13), weekTwo);
  assert.equal(early.ranking.opponentQuality, 0);
  assert.equal(early.ranking.opponentStakesScore, 0);
  assert.equal(early.ranking.confidence, 'medium');
  assert.ok(!early.ranking.whyYou.includes('1-0'));
});

test('a postseason home game carries playoff leverage without a regular-season window bonus', () => {
  const playoff = enrichNfl(nflGame(13, { seasonType: { id: '3', type: 3, name: 'Postseason' }, week: { number: 1, text: 'Wild Card' } }));
  assert.equal(playoff.sportsContext.seasonType, 'postseason');
  assert.equal(playoff.sportsContext.playoffLeverage, 'high');
  assert.equal(playoff.ranking.leverageScore, 10);
  assert.equal(playoff.ranking.primetimeScore, 0);
  assert.equal(playoff.tags[0], 'Playoff game');
  assert.match(playoff.ranking.whyYou, /a home playoff game/);
  assert.match(playoff.ranking.whyYou, /Wild Card\.$/);
});

test('MLB scoring is untouched by the league generalization', () => {
  const ranking = enrichSportsGames([normalizeMlbGame(gameRaw)], new Map(), sharedConfig)[0].ranking;
  assert.ok(!('league' in ranking));
  assert.ok(!('primetimeScore' in ranking));
  assert.deepEqual(ranking.hassleReasons, ['Dodger Stadium logistics']);
  assert.deepEqual(scoreSportsGame(enrichSportsGames([normalizeMlbGame(gameRaw)], new Map(), config)[0], config), enrichSportsGames([normalizeMlbGame(gameRaw)], new Map(), config)[0].ranking);
});

test('joins an NFL ticket only on a clean date, venue, and both-team match', () => {
  const game = enrichNfl(nflGame(13));
  assert.equal(ticketMatchesGame(ramsTicket(), game), true);
  // The Chargers share the building: same venue and date is not enough.
  assert.equal(ticketMatchesGame(ramsTicket({ name: 'Los Angeles Chargers vs. Kansas City Chiefs', _embedded: { ...ramsTicket.embedded, venues: [{ name: 'SoFi Stadium' }], attractions: [{ name: 'Los Angeles Chargers' }, { name: 'Kansas City Chiefs' }] } }), game), false);
  assert.equal(ticketMatchesGame(ramsTicket({ dates: { start: { localDate: '2026-12-04', localTime: '17:15:00' } } }), game), false);
  assert.equal(ticketMatchesGame(ramsTicket({ name: 'PARKING: Los Angeles Rams vs. Kansas City Chiefs' }), game), false);
  // A neighbouring venue on the same campus is not the stadium.
  assert.equal(ticketMatchesGame(ramsTicket({ _embedded: { venues: [{ name: 'YouTube Theater', location: { latitude: '33.9530', longitude: '-118.3380' } }], attractions: [{ name: 'Los Angeles Rams' }, { name: 'Kansas City Chiefs' }] } }), game), false);
  // The opponent must be named; a home-team-only listing is not this game.
  assert.equal(ticketMatchesGame(ramsTicket({ name: 'Los Angeles Rams Home Game', _embedded: { venues: [{ name: 'SoFi Stadium' }], attractions: [{ name: 'Los Angeles Rams' }] } }), game), false);
  const seatGeek = normalizeSeatGeekSportsEvent({ id: 9, title: 'Kansas City Chiefs at Los Angeles Rams', url: 'https://seatgeek.example/rams', datetime_local: '2026-12-03T17:15:00', performers: [{ name: 'Los Angeles Rams' }, { name: 'Kansas City Chiefs' }], venue: { id: 1, name: 'SoFi Stadium', city: 'Inglewood', location: { lat: 33.9535, lon: -118.3392 } }, stats: { lowest_price: 300, listing_count: 900 } });
  assert.equal(ticketMatchesGame(seatGeek, game), true);

  const dodgers = enrichSportsGames([normalizeMlbGame(gameRaw)], new Map(), sharedConfig)[0];
  const joined = joinSportsTickets([dodgers, game], [ramsTicket(), seatGeek], sharedConfig, nflNow);
  assert.equal(joined[0].ticketObservations.length, 0);
  assert.equal(joined[0].ranking.urgency, 'unknown');
  assert.deepEqual(joined[1].ticketObservations.map((observation) => observation.source), ['ticketmaster', 'seatgeek']);
  assert.equal(joined[1].ranking.urgency, 'safe to wait');
  assert.equal(joined[1].ranking.interestScore, 80);
  // The lowest observed price is under the shared budget, so only logistics count.
  assert.equal(joined[1].ranking.hassleScore, 4);
  assert.ok(joined[1].ranking.hassleReasons.includes('from $180'));
  assert.deepEqual(joined[1].sourceOccurrences.map((occurrence) => occurrence.source), ['espn', 'ticketmaster', 'seatgeek']);

  const overBudget = joinSportsTickets([game], [seatGeek], sharedConfig, nflNow)[0];
  assert.equal(overBudget.ranking.hassleScore, 6);
  assert.ok(overBudget.ranking.hassleReasons.includes('above ticket budget'));
  assert.equal(overBudget.ranking.interestScore, 80);

  const unticketed = joinSportsTickets([game], [], sharedConfig, nflNow)[0];
  assert.deepEqual(unticketed.ticketObservations, []);
  assert.equal(unticketed.ranking.urgency, 'unknown');
  assert.equal(unticketed.ranking.excluded, false);
});

test('a flex game accepts a ticket listed on either candidate date', () => {
  const game = enrichNfl(nflGame(18));
  const ticket = (localDate) => ramsTicket({ name: 'Los Angeles Rams vs. Seattle Seahawks', dates: { start: { localDate } }, _embedded: { venues: [{ name: 'SoFi Stadium' }], attractions: [{ name: 'Los Angeles Rams' }, { name: 'Seattle Seahawks' }] } });
  assert.equal(ticketMatchesGame(ticket('2027-01-10'), game), true);
  assert.equal(ticketMatchesGame(ticket('2027-01-09'), game), true);
  assert.equal(ticketMatchesGame(ticket('2027-01-17'), game), false);
});

test('sports ticket adapters query the NFL team when asked for that league', async () => {
  let seatGeekUrl;
  await fetchSeatGeekSportsEvents({ clientId: 'key', startDate: '2026-11-11', endDate: '2027-05-10', config: sharedConfig, league: 'nfl', fetchImpl: async (url) => { seatGeekUrl = url; return new Response(JSON.stringify({ events: [], meta: { total: 0 } })); } });
  assert.equal(seatGeekUrl.searchParams.get('taxonomies.name'), 'football');
  assert.equal(seatGeekUrl.searchParams.get('q'), 'Los Angeles Rams');
  assert.equal(seatGeekUrl.searchParams.get('lat'), String(config.home.lat));
  let ticketmasterUrl;
  await fetchTicketmasterSportsEvents({ apiKey: 'key', startDate: '2026-11-11', endDate: '2027-05-10', config: sharedConfig, league: 'nfl', fetchImpl: async (url) => { ticketmasterUrl = url; return new Response(JSON.stringify({ _embedded: { events: [] }, page: { totalPages: 0 } })); } });
  assert.equal(ticketmasterUrl.searchParams.get('keyword'), 'Los Angeles Rams');
  assert.equal(ticketmasterUrl.searchParams.get('classificationName'), 'Sports');
  // Without a league the same shared config still queries the Dodgers.
  await fetchSeatGeekSportsEvents({ clientId: 'key', startDate: '2026-08-01', endDate: '2026-08-31', config: sharedConfig, fetchImpl: async (url) => { seatGeekUrl = url; return new Response(JSON.stringify({ events: [], meta: { total: 0 } })); } });
  assert.equal(seatGeekUrl.searchParams.get('taxonomies.name'), 'baseball');
  assert.equal(seatGeekUrl.searchParams.get('q'), 'Los Angeles Dodgers');
});

test('NFL games flow through the shared display row and overview with their own title', () => {
  const rams = toDisplaySportsGame(joinSportsTickets([enrichNfl(nflGame(18))], [], sharedConfig, nflNow)[0]);
  const dodgers = toDisplaySportsGame(enrichSportsGames([normalizeMlbGame(gameRaw)], new Map(), sharedConfig)[0]);
  assert.equal(rams.id, 'nfl:401873185');
  assert.equal(rams.sportsContext.league, 'nfl');
  assert.equal(rams.timeTbd, true);
  assert.deepEqual(rams.sourceLinks, [{ source: 'espn', url: 'https://www.espn.com/nfl/game/_/gameId/401873185/seahawks-rams' }]);
  assert.equal(rams.visual.kind, 'texture');
  const overview = buildOverview([], [rams, dodgers]);
  assert.deepEqual(overview.map((item) => item.title), ['Rams vs. Seahawks', 'Dodgers vs. Padres']);
  assert.deepEqual(overview.map((item) => item.urgency), ['unknown', 'unknown']);
  // A row with no home team predates the second team and was a Dodgers game.
  const legacy = buildOverview([], [{ ...dodgers, homeTeam: undefined }]);
  assert.equal(legacy[0].title, 'Dodgers vs. Padres');
  // Two Rams home dates are two overview candidates, not one series.
  const chiefs = toDisplaySportsGame(enrichNfl(nflGame(13)));
  assert.deepEqual(buildOverview([], [rams, chiefs]).map((item) => item.title).sort(), ['Rams vs. Chiefs', 'Rams vs. Seahawks']);
});

test('the documented example config carries the NFL defaults', async () => {
  const example = JSON.parse(await readFile(new URL('../config/sports.example.json', import.meta.url), 'utf8'));
  // The example spells out every default, so an empty config resolves the same.
  const { maxTicketPages: _pages, featuredInterestThreshold: _threshold, ...resolved } = sportsLeagueConfig(example, 'nfl');
  assert.deepEqual(resolved, sportsLeagueConfig({}, 'nfl'));
  assert.equal(sportsLeagueConfig(example, 'nfl').maxTicketPages, 3);
  assert.equal(sportsLeagueConfig(example, 'mlb'), example);
});
