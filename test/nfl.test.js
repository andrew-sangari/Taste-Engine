import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyNflStandings,
  fetchNflStandings,
  fetchRamsHomeGames,
  NFL_RETRY,
  nflSeasonsForWindow,
  normalizeNflGame,
  normalizeNflStandings
} from '../src/nfl.js';

NFL_RETRY.delayMs = 0;

// Trimmed copies of the live ESPN responses retrieved 2026-11-11 (logos,
// links, leaders, and the affiliate `tickets` block removed).
const schedule = JSON.parse(await readFile(new URL('./fixtures/nfl/espn-rams-schedule-2026.json', import.meta.url), 'utf8'));
const standingsBody = JSON.parse(await readFile(new URL('./fixtures/nfl/espn-nfl-standings-2026.json', import.meta.url), 'utf8'));

const eventByWeek = (week) => schedule.events.find((event) => event.week.number === week);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function scheduleFetch({ fail = () => false, requests = [] } = {}) {
  return async (url, init) => {
    requests.push({ url, init });
    const season = url.searchParams.get('season');
    const seasonType = url.searchParams.get('seasontype');
    if (fail(season, seasonType)) return json({ error: 'unavailable' }, 503);
    if (season === '2026' && seasonType === '2') return json(schedule);
    return json({ status: 'success', events: [] });
  };
}

test('fetches the remaining Rams home games at SoFi Stadium from the ESPN schedule', async () => {
  const requests = [];
  const games = await fetchRamsHomeGames({
    startDate: '2026-11-11',
    endDate: '2027-05-10',
    timezone: 'America/Los_Angeles',
    fetchImpl: scheduleFetch({ requests })
  });
  assert.deepEqual(games.map((game) => game.id), ['nfl:401873079', 'nfl:401873096', 'nfl:401873136', 'nfl:401873185']);
  assert.deepEqual(games.map((game) => game.awayTeam.shortName), ['Packers', 'Chiefs', 'Cowboys', 'Seahawks']);
  for (const game of games) {
    assert.equal(game.league, 'nfl');
    assert.equal(game.type, 'football');
    assert.equal(game.homeTeam.id, '14');
    assert.equal(game.venue.name, 'SoFi Stadium');
    assert.deepEqual(game.ticketObservations, []);
  }
  // Regular season and postseason for each season the window touches.
  assert.deepEqual(
    requests.map(({ url }) => `${url.pathname.split('/').slice(-2).join('/')}?${url.searchParams.get('season')}:${url.searchParams.get('seasontype')}`),
    ['14/schedule?2026:2', '14/schedule?2026:3', '14/schedule?2027:2', '14/schedule?2027:3']
  );
  assert.equal(requests[0].url.hostname, 'site.api.espn.com');
  assert.equal(requests[0].init.headers['user-agent'], 'taste-engine-schedule/0.1');
});

test('excludes away games, completed games, and a designated home game played abroad', async () => {
  const games = await fetchRamsHomeGames({ startDate: '2026-09-01', endDate: '2027-02-28', fetchImpl: scheduleFetch() });
  const ids = games.map((game) => game.sourceEventId);
  // Week 1 lists the Rams as the home team at Melbourne Cricket Ground.
  const melbourne = normalizeNflGame(eventByWeek(1));
  assert.equal(melbourne.homeTeam.id, '14');
  assert.equal(melbourne.neutralSite, true);
  assert.ok(!ids.includes(melbourne.sourceEventId));
  assert.ok(!ids.includes(eventByWeek(8).id), 'a finished home game is not a candidate');
  assert.ok(!ids.includes(eventByWeek(10).id), 'an away game is not a candidate');
  assert.equal(games.length, 4);
});

test('normalizes a scheduled game into the shared sports game shape', () => {
  const game = normalizeNflGame(eventByWeek(13), { retrievedAt: new Date('2026-11-11T20:00:00Z') });
  assert.equal(game.id, 'nfl:401873096');
  assert.equal(game.source, 'espn');
  assert.equal(game.title, 'Kansas City Chiefs at Los Angeles Rams');
  assert.equal(game.startLocal, '2026-12-03T17:15:00-08:00');
  assert.equal(game.startUtc, '2026-12-04T01:15:00.000Z');
  assert.equal(game.timeTbd, false);
  assert.equal(game.dateTbd, false);
  assert.deepEqual(game.kickoff, { code: 'TNF', label: 'Thursday Night Football', primetime: true });
  assert.deepEqual(game.broadcasts, ['Prime Video']);
  assert.deepEqual(game.season, { year: 2026, type: 'regular', week: 13, weekLabel: 'Week 13', headline: null });
  assert.deepEqual(game.awayTeam, { id: '12', name: 'Kansas City Chiefs', shortName: 'Chiefs', abbreviation: 'KC', league: null, division: null });
  assert.deepEqual(game.venue, { sourceId: null, name: 'SoFi Stadium', city: 'Inglewood', state: 'CA', lat: 33.9535, lon: -118.3392 });
  assert.equal(game.sourceUrl, 'https://www.espn.com/nfl/game/_/gameId/401873096/chiefs-rams');
  assert.equal(game.scheduleStatus.changed, false);
  assert.equal(game.scheduleStatus.flex, false);
  assert.equal(game.series.gameCount, null);
  assert.deepEqual(game.probablePitchers, { home: null, away: null, confirmed: false });
  assert.equal(game.sourceOccurrences[0].source, 'espn');
  assert.deepEqual(game.sourceOccurrences[0].performerNames, ['Kansas City Chiefs', 'Los Angeles Rams']);
  assert.equal(game.retrievedAt, '2026-11-11T20:00:00.000Z');
});

test('classifies kickoff windows from the national broadcast clock', () => {
  assert.equal(normalizeNflGame(eventByWeek(12)).kickoff.label, 'Wednesday night national broadcast');
  assert.equal(normalizeNflGame(eventByWeek(15)).kickoff.code, 'sunday-late');
  assert.equal(normalizeNflGame(eventByWeek(15)).kickoff.primetime, false);
  const monday = normalizeNflGame({ ...eventByWeek(13), date: '2026-12-08T01:15Z' });
  assert.equal(monday.kickoff.code, 'MNF');
  const sunday = normalizeNflGame({ ...eventByWeek(13), date: '2026-12-07T01:20Z' });
  assert.equal(sunday.kickoff.code, 'SNF');
  assert.equal(sunday.startLocal, '2026-12-06T17:20:00-08:00');
});

test('keeps an unscheduled flex game on its listed date with the kickoff marked TBD', () => {
  const game = normalizeNflGame(eventByWeek(18));
  // ESPN publishes midnight Eastern (05:00Z) as the placeholder; in Pacific
  // time that instant is still the previous evening.
  assert.equal(eventByWeek(18).date, '2027-01-10T05:00Z');
  assert.equal(game.startLocal, '2027-01-10T00:00:00-08:00');
  assert.equal(game.startUtc, null);
  assert.equal(game.timeTbd, true);
  assert.equal(game.dateTbd, false);
  assert.equal(game.scheduleStatus.flex, true);
  assert.equal(game.scheduleStatus.dateTentative, true);
  assert.deepEqual(game.scheduleStatus.flexDates, ['2027-01-09', '2027-01-10']);
  assert.deepEqual(game.kickoff, { code: 'tbd', label: 'Kickoff TBD', primetime: false });
  assert.deepEqual(game.broadcasts, []);
});

test('never reads the affiliate ticket block ESPN embeds in a competition', () => {
  const raw = structuredClone(eventByWeek(13));
  raw.competitions[0].tickets = [{ summary: 'Tickets as low as $142', startingPrice: 142, numberAvailable: 6857, links: [{ href: 'https://tickets.example/affiliate' }] }];
  const game = normalizeNflGame(raw);
  assert.deepEqual(game.ticketObservations, []);
  assert.equal(game.sourceOccurrences.length, 1);
  assert.ok(!JSON.stringify(game).includes('tickets.example'));
  assert.ok(!JSON.stringify(game).includes('as low as'));
});

test('tolerates missing fields and reports schedule changes', () => {
  const empty = normalizeNflGame({});
  assert.equal(empty.id, 'nfl:');
  assert.equal(empty.startLocal, null);
  assert.equal(empty.timeTbd, true);
  assert.equal(empty.dateTbd, true);
  assert.equal(empty.homeTeam.id, null);
  const postponed = normalizeNflGame({
    ...eventByWeek(13),
    competitions: [{ ...eventByWeek(13).competitions[0], status: { type: { name: 'STATUS_POSTPONED', state: 'post', completed: false, description: 'Postponed' } } }]
  });
  assert.equal(postponed.scheduleStatus.postponed, true);
  assert.equal(postponed.scheduleStatus.changed, true);
  assert.equal(postponed.scheduleStatus.completed, false);
  // A link that is not ESPN's falls back to the canonical game URL.
  const relinked = normalizeNflGame({ ...eventByWeek(13), links: [{ rel: ['summary', 'desktop'], href: 'https://example.com/elsewhere' }] });
  assert.equal(relinked.sourceUrl, 'https://www.espn.com/nfl/game/_/gameId/401873096');
});

test('a failing schedule request throws so the source can be marked unavailable', async () => {
  await assert.rejects(
    fetchRamsHomeGames({ startDate: '2026-11-11', endDate: '2026-12-31', fetchImpl: async () => json({}, 503) }),
    /NFL schedule request failed \(503\)/
  );
  await assert.rejects(
    fetchRamsHomeGames({ startDate: '2026-11-11', endDate: '2026-12-31', fetchImpl: async () => json({ status: 'success' }) }),
    /unexpected shape/
  );
  await assert.rejects(fetchRamsHomeGames({ fetchImpl: scheduleFetch() }), /requires startDate and endDate/);
});

test('a failing postseason request leaves the regular season usable and is reported', async () => {
  const warnings = [];
  const games = await fetchRamsHomeGames({
    startDate: '2026-11-11',
    endDate: '2026-12-31',
    warnings,
    fetchImpl: scheduleFetch({ fail: (_season, seasonType) => seasonType === '3' })
  });
  assert.equal(games.length, 3);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2026 postseason schedule unavailable/);
});

test('an empty in-season schedule is reported rather than published silently', async () => {
  const warnings = [];
  const games = await fetchRamsHomeGames({
    startDate: '2026-11-11',
    endDate: '2026-12-31',
    warnings,
    fetchImpl: async () => json({ status: 'success', events: [] })
  });
  assert.deepEqual(games, []);
  assert.match(warnings[0], /2026 regular schedule returned no events/);
});

test('maps a date window to the NFL seasons it touches', () => {
  assert.deepEqual(nflSeasonsForWindow('2026-11-11', '2026-12-31'), [2026]);
  assert.deepEqual(nflSeasonsForWindow('2027-01-05', '2027-02-10'), [2026]);
  assert.deepEqual(nflSeasonsForWindow('2026-11-11', '2027-05-10'), [2026, 2027]);
  assert.throws(() => nflSeasonsForWindow('soon', '2027-05-10'), /YYYY-MM-DD/);
});

test('normalizes division standings and distance from the last playoff seed', async () => {
  let requestUrl;
  const standings = await fetchNflStandings({ season: 2026, fetchImpl: async (url) => { requestUrl = url; return json(standingsBody); } });
  assert.equal(requestUrl.searchParams.get('level'), '3');
  assert.equal(requestUrl.searchParams.get('season'), '2026');
  const niners = standings.get('25');
  assert.equal(niners.record, '7-1');
  assert.equal(niners.winPct, 0.875);
  assert.equal(niners.gamesPlayed, 8);
  assert.equal(niners.divisionRank, 1);
  assert.equal(niners.playoffSeed, 1);
  assert.equal(niners.pointDifferential, 79);
  assert.equal(niners.streak, 'W1');
  assert.deepEqual(niners.division, { id: '3', name: 'NFC West' });
  assert.equal(niners.league.name, 'National Football Conference');
  assert.deepEqual(niners.homeRecord, { wins: 5, losses: 0, ties: 0, winPct: 1 });
  assert.equal(niners.playoffGamesBack, 0);
  // Rams 5-4 against the seventh-seeded Packers at 6-3.
  const rams = standings.get('14');
  assert.equal(rams.divisionRank, 3);
  assert.equal(rams.playoffSeed, 9);
  assert.equal(rams.playoffGamesBack, 1);
  assert.equal(standings.get('19').record, '5-2-1');
  assert.equal(standings.get('12').division.name, 'AFC West');
});

test('standings enrichment attaches division and record without requiring them', () => {
  const standings = normalizeNflStandings(standingsBody);
  const [game] = applyNflStandings([normalizeNflGame(eventByWeek(18))], standings);
  assert.equal(game.awayTeam.division.name, 'NFC West');
  assert.equal(game.awayTeam.record, '5-4');
  assert.equal(game.homeTeam.record, '5-4');
  const [untouched] = applyNflStandings([normalizeNflGame(eventByWeek(18))], new Map());
  assert.equal(untouched.awayTeam.division, null);
});

test('a conference-only standings response carries no division rank', () => {
  assert.equal(normalizeNflStandings({}).size, 0);
  const conferenceOnly = normalizeNflStandings({ children: [{
    name: 'National Football Conference',
    isConference: true,
    standings: { entries: [{ team: { id: '14', displayName: 'Los Angeles Rams' }, stats: [] }] }
  }] });
  assert.equal(conferenceOnly.get('14').divisionRank, null);
  assert.equal(conferenceOnly.get('14').division, null);
  assert.equal(conferenceOnly.get('14').winPct, null);
});

test('an unusable standings response throws', async () => {
  await assert.rejects(fetchNflStandings({ season: 2026, fetchImpl: async () => json({ children: [] }) }), /unexpected shape/);
  await assert.rejects(fetchNflStandings({ season: 2026, fetchImpl: async () => json({}, 500) }), /NFL standings request failed \(500\)/);
});

test('a dropped ESPN request is retried once; a client error and a second failure are not', async () => {
  const window = { startDate: '2026-11-11', endDate: '2026-12-31', seasons: [2026], seasonTypes: [2] };
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ events: [] }));
  };
  assert.deepEqual(await fetchRamsHomeGames({ ...window, fetchImpl: flaky }), []);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(fetchRamsHomeGames({ ...window, fetchImpl: async () => { calls += 1; return new Response('{}', { status: 503 }); } }), /503/);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(fetchRamsHomeGames({ ...window, fetchImpl: async () => { calls += 1; return new Response('{}', { status: 404 }); } }), /404/);
  assert.equal(calls, 1);
});
