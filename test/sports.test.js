import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPitcherStats, fetchDodgersHomeGames, fetchMlbPitcherStats, fetchMlbStandings, normalizeMlbGame } from '../src/mlb.js';
import { enrichSportsGames, fetchSeatGeekSportsEvents, fetchTicketmasterSportsEvents, joinSportsTickets, normalizeSeatGeekSportsEvent, normalizeTicketmasterSportsEvent } from '../src/sports.js';

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
    leagueRank: '4', divisionRank: '2', wins: 60, losses: 40, winningPercentage: '.600', streak: { streakCode: 'W3' },
    records: { splitRecords: [{ type: 'lastTen', wins: 7, losses: 3 }] }
  }] }] };
  const standings = await fetchMlbStandings({ season: 2026, fetchImpl: async () => new Response(JSON.stringify(standingsBody)) });
  assert.equal(standings.get('135').winPct, 0.6);
  assert.equal(standings.get('135').lastTen, '7-3');

  const statsBody = { people: [{ id: 10, fullName: 'Padres Ace', stats: [{ splits: [{ season: '2026', stat: { era: '2.80', whip: '1.05' } }] }] }] };
  const stats = await fetchMlbPitcherStats(['10'], { season: 2026, fetchImpl: async () => new Response(JSON.stringify(statsBody)) });
  assert.equal(stats.get('10').era, 2.8);
  assert.equal(applyPitcherStats([normalizeMlbGame(gameRaw)], stats)[0].probablePitchers.away.era, 2.8);
});

test('scores rivalry, standings, pitching, and convenience separately', () => {
  const base = normalizeMlbGame(gameRaw);
  const enriched = enrichSportsGames([base], new Map([['135', { winPct: 0.6, leagueRank: 4, divisionRank: 2, lastTen: '7-3', streak: 'W3', gamesBack: 2, division: { name: 'National League West' } }]]), config, { pitcherStats: new Map([['10', { era: 2.8, whip: 1.05 }], ['11', { era: 3.1, whip: 1.1 }]]) });
  assert.equal(enriched[0].sportsContext.rivalryTier, 'high');
  assert.ok(enriched[0].ranking.rivalryScore >= 15);
  assert.ok(enriched[0].ranking.pitchingScore >= 7);
  assert.ok(enriched[0].ranking.interestScore > 60);
  assert.equal(enriched[0].ranking.urgency, 'unknown');
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
