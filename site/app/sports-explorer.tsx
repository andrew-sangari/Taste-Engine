"use client";

import { useMemo, useState } from "react";
import { isGroundedAdvisory } from "./advisories";
import { CardActions, calendarInputFrom, planningInputFrom } from "./card-actions";
import type { PublicFeedbackSnapshot } from "./feedback-store";
import { FilterDisclosure } from "./filter-disclosure";
import { RecommendationVisual, type RecommendationVisual as RecommendationVisualType } from "./recommendation-visual";
import { RecommendationScore, type FeedbackAdjustment } from "./signal-texture";
import { eventAnchor } from "./event-anchor";
import { daysFromLocalDate, formatLocalDate, formatLocalTime } from "./local-date";

export type SportsLeague = "mlb" | "nfl";

export type SportsGame = {
  id: string;
  league?: string;
  sourceUrl: string;
  startLocal: string | null;
  timeTbd: boolean;
  venue: { name: string; city: string; state: string };
  homeTeam: { name: string; shortName: string; abbreviation: string };
  awayTeam: { name: string; shortName: string; abbreviation: string };
  series: { id: string | null; gameNumber: number | null; gameCount: number | null };
  sportsContext: {
    league?: string;
    rivalryTier: string;
    playoffLeverage: string;
    opponentTags?: string[];
    pitcherMatchupTier?: "ace" | "notable" | "standard" | "unknown";
    seriesPosition?: { label: string | null; gameNumber: number | null; gameCount: number | null };
    schedule?: { detailedState?: string; changed?: boolean; delayed?: boolean; postponed?: boolean; rescheduled?: boolean; dateTentative?: boolean };
    kickoffWindow?: { code: string; label: string; primetime: boolean } | null;
    broadcasts?: string[];
    seasonType?: string | null;
    probablePitchers: {
      home: { name: string; era: number | null; whip?: number | null; handedness?: string | null; wins?: number | null; losses?: number | null; strikeouts?: number | null } | null;
      away: { name: string; era: number | null; whip?: number | null; handedness?: string | null; wins?: number | null; losses?: number | null; strikeouts?: number | null } | null;
      confirmed: boolean;
    };
  };
  tags: string[];
  ticketObservations: Array<{ source: string; url: string; lowestPriceUsd: number | null; status: string }>;
  sourceLinks: Array<{ source: string; url: string }>;
  ranking: { interestScore: number; utility: number; hassleScore: number; hassleReasons?: string[]; urgency: string; confidence: string; whyYou: string; feedbackAdjustment?: FeedbackAdjustment | null };
  localEnhancement?: { personalFit?: { score: number; explanation: string }; recommendation?: { verdict: string; explanation: string }; urgency?: { label: string; explanation: string }; hassle?: { score: number; explanation: string } } | null;
  visual?: RecommendationVisualType;
  feedbackSnapshot?: PublicFeedbackSnapshot | null;
};

type WindowFilter = "all" | "soon" | "later";
type SortMode = "interest" | "date" | "hassle" | "urgency";
type TicketFilter = "all" | "ticketed" | "unknown";
type LeagueFilter = "all" | SportsLeague;

export function SportsExplorer({ games, generatedAt, featuredThreshold = 70, targetEventId = null }: { games: SportsGame[]; generatedAt: string; featuredThreshold?: number; targetEventId?: string | null }) {
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("interest");
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>("all");
  const [rivalryOnly, setRivalryOnly] = useState(false);
  const [leagueFilter, setLeagueFilter] = useState<LeagueFilter>("all");
  const [showAll, setShowAll] = useState(Boolean(targetEventId));
  // The feed is described from what it actually holds. A Dodgers-only feed
  // reads exactly as it did before a second team existed.
  const teams = useMemo(() => homeTeams(games), [games]);
  const mixed = teams.length > 1;
  const baseballOnly = games.every((game) => leagueOf(game) === "mlb");
  const groupNoun = baseballOnly ? "series" : "matchups";
  const filtered = useMemo(() => games.filter((game) => {
    const daysAway = daysFromLocalDate(game.startLocal, generatedAt) ?? Number.POSITIVE_INFINITY;
    if (leagueFilter !== "all" && leagueOf(game) !== leagueFilter) return false;
    if (windowFilter === "soon" && daysAway > 30) return false;
    if (windowFilter === "later" && daysAway <= 30) return false;
    if (ticketFilter === "ticketed" && !game.ticketObservations.length) return false;
    if (ticketFilter === "unknown" && game.ticketObservations.length) return false;
    if (rivalryOnly && game.sportsContext.rivalryTier === "none") return false;
    return true;
  }).sort(gameComparator(sortMode)), [games, generatedAt, leagueFilter, rivalryOnly, sortMode, ticketFilter, windowFilter]);
  const series = useMemo(() => groupSeries(filtered), [filtered]);
  const visibleSeries = showAll ? series : series.slice(0, 3);
  return (
    <section className="sportsSection" aria-label={`${teams.length ? `${teams.map((team) => team.label).join(" and ")} ` : ""}sports schedule`} id="sports-feed">
      <div className="sportsIntro">
        <div><p className="eyebrow">{["Third vertical", ...teams.map((team) => team.label)].join(" · ")}</p><h2>Best games to attend.</h2></div>
        <p>{baseballOnly
          ? "MLB defines the game. Standings, rivalries, pitching, timing, and hassle decide whether this particular date is worth the trip. Ticket links are additive; missing ticket coverage stays visible as unknown."
          : "The league schedule defines the game. Standings, rivalries, the matchup, the kickoff or first-pitch window, and hassle decide whether this particular date is worth the trip. Ticket links are additive; missing ticket coverage stays visible as unknown."}</p>
      </div>
      <div className="sportsControls">
        <div className="dateFilterGroup" aria-label="Sports date filter">
          {([['all', 'All dates'], ['soon', 'Next 30 days'], ['later', 'Later']] as const).map(([value, label]) => <button aria-pressed={windowFilter === value} className={windowFilter === value ? "filterActive" : ""} key={value} onClick={() => { setWindowFilter(value); setShowAll(false); }} type="button">{label}</button>)}
        </div>
        <FilterDisclosure count={[sortMode !== "interest", ticketFilter !== "all", rivalryOnly, leagueFilter !== "all"].filter(Boolean).length} onClear={() => { setSortMode("interest"); setTicketFilter("all"); setRivalryOnly(false); setLeagueFilter("all"); setShowAll(false); }}>
            {mixed ? <label className="selectControl">Team<select aria-label="Sports team" onChange={(event) => { setLeagueFilter(event.target.value as LeagueFilter); setShowAll(false); }} value={leagueFilter}><option value="all">All teams</option>{teams.map((team) => <option key={team.league} value={team.league}>{team.label}</option>)}</select></label> : null}
            <label className="selectControl">Sort<select aria-label="Sports sort order" onChange={(event) => { setSortMode(event.target.value as SortMode); setShowAll(false); }} value={sortMode}><option value="interest">Interest</option><option value="date">Date</option><option value="hassle">Lowest hassle</option><option value="urgency">Ticket urgency</option></select></label>
            <label className="selectControl">Tickets<select aria-label="Sports ticket coverage" onChange={(event) => { setTicketFilter(event.target.value as TicketFilter); setShowAll(false); }} value={ticketFilter}><option value="all">All</option><option value="ticketed">Ticket link</option><option value="unknown">Unknown</option></select></label>
            <label className="hassleToggle"><input checked={rivalryOnly} onChange={(event) => { setRivalryOnly(event.target.checked); setShowAll(false); }} type="checkbox" /><span>Rivalries</span></label>
        </FilterDisclosure>
        <span className="resultCount">{showAll ? series.length : Math.min(series.length, 3)} of {series.length} {groupNoun} · {filtered.length} games</span>
      </div>
      {series.length ? <div className="sportsSeriesGrid" data-stagger="">{visibleSeries.map((group, index) => <SeriesCard games={group} isFeatured={index === 0} featuredThreshold={featuredThreshold} key={group[0].series.id ?? group[0].id} showHomeTeam={mixed} />)}</div> : <div className="sportsEmpty"><p className="eyebrow">Source status</p><h3>No {emptyTeamLabel(teams, leagueFilter)}games match this filter.</h3><p>Try widening the date, {mixed ? "team, " : ""}rivalry, or ticket view.</p></div>}
      {series.length > 3 ? <button className="showMore" onClick={() => setShowAll((value) => !value)} type="button">{showAll ? `Show top 3 ${groupNoun}` : `Show all ${series.length} ${groupNoun}`}</button> : null}
    </section>
  );
}

function SeriesCard({ games, featuredThreshold, isFeatured, showHomeTeam }: { games: SportsGame[]; featuredThreshold: number; isFeatured: boolean; showHomeTeam: boolean }) {
  const best = [...games].sort(gameComparator("interest"))[0];
  const shown = best && best.ranking.interestScore >= featuredThreshold ? [best] : games.slice(0, 1);
  const league = leagueOf(games[0]);
  const home = friendlyHomeName(games[0]);
  // A baseball card is a series against one opponent; a football card is one
  // matchup, and with two home teams the card has to say whose game it is.
  const heading = league === "mlb" && !showHomeTeam ? friendlyOpponentName(games[0].awayTeam) : gameTitle(games[0]);
  const eyebrow = league === "nfl"
    ? `${home} ${games[0].sportsContext.seasonType === "postseason" ? "home playoff game" : "home game"}`
    : games[0].series.gameCount ? `${showHomeTeam ? `${home} · ` : ""}${games[0].series.gameCount}-game series` : `${home} home series`;
  return <article className={`seriesCard rv ${isFeatured ? "seriesFeatured" : "seriesCompact"}`}>
    <RecommendationVisual className="seriesVisual" visual={games[0].visual} />
    <div className="seriesHeader"><div><p className="eyebrow">{eyebrow}</p><h3>{heading}</h3><p>{best.tags.slice(0, 3).join(" · ") || (league === "nfl" ? "Home game" : "Regular-season home games")}</p></div><strong>{Math.max(...games.map((game) => game.ranking.interestScore))}</strong></div>
    <div className="seriesGames">{shown.map((game) => <GameRow game={game} key={game.id} />)}</div>
    {games.length > shown.length ? <details className="seriesDetails"><summary>View series · all {games.length} games</summary><div className="seriesGames">{games.filter((game) => !shown.some((shownGame) => shownGame.id === game.id)).map((game) => <GameRow game={game} key={game.id} />)}</div></details> : null}
  </article>;
}

function GameRow({ game }: { game: SportsGame }) {
  const pitchers = game.sportsContext.probablePitchers;
  const opponentContext = game.sportsContext.opponentTags?.slice(0, 3) ?? [];
  const pitcherLine = pitchers.confirmed ? formatPitcherMatchup(pitchers.away, pitchers.home) : null;
  const tier = game.sportsContext.pitcherMatchupTier;
  const football = leagueOf(game) === "nfl";
  const kickoff = game.sportsContext.kickoffWindow;
  const broadcastLine = football ? [kickoff && kickoff.code !== "tbd" ? kickoff.label : null, ...(game.sportsContext.broadcasts ?? [])].filter(Boolean).join(" · ") : "";
  const timeTbdLabel = football ? (game.sportsContext.schedule?.dateTentative ? "Date and kickoff TBD" : "Kickoff TBD") : "Time TBD";
  return <div className="gameRow" id={eventAnchor(game.id)}>
    <div className="gameDate"><span>{formatLocalDate(game.startLocal, { weekday: "short", month: "short" }) ?? "TBD"}</span><strong>{formatLocalDate(game.startLocal, { day: "numeric" }) ?? "—"}</strong></div>
    <div className="gameMain">
      <div className="gameMatchup">
        <strong>{game.awayTeam.abbreviation} at {game.homeTeam.abbreviation}</strong>
        <span>{!game.timeTbd && formatLocalTime(game.startLocal) ? formatLocalTime(game.startLocal) : timeTbdLabel}</span>
        {opponentContext.length ? <p className="gameContextLine">{opponentContext.join(" · ")}</p> : null}
        {football
          ? (broadcastLine ? <p className={`gamePitching${kickoff?.primetime ? "" : " gamePitchingUnknown"}`}>{broadcastLine}</p> : null)
          : pitcherLine ? <p className={`gamePitching matchup-${tier ?? "unknown"}`}>{pitcherLine}{tier && tier !== "unknown" ? <b>{tier === "ace" ? "Ace matchup" : tier === "notable" ? "Notable matchup" : "Probable matchup"}</b> : null}</p> : <p className="gamePitching gamePitchingUnknown">Probable pitchers TBD</p>}
        {game.sportsContext.seriesPosition?.label ? <p className="gameSeriesPosition">{game.sportsContext.seriesPosition.label}</p> : null}
        {game.sportsContext.schedule?.changed ? <p className="gameScheduleUpdate">{game.sportsContext.schedule.detailedState || "Schedule update"} — verify before leaving.</p> : null}
      </div>
      <div className="gameSignals"><RecommendationScore adjustment={game.ranking.feedbackAdjustment} confidence={game.ranking.confidence} fit={game.ranking.interestScore} friction={game.ranking.hassleScore} score={game.ranking.utility} status={game.ranking.interestScore >= 55 ? "Recommended" : "Watch"} urgency={game.ticketObservations.length ? game.ranking.urgency : "ticket coverage unknown"} /></div>
      {game.ranking.interestScore >= 55 && game.ranking.hassleScore >= 6 ? <p className="planningObstacle">Strong matchup · planning obstacle: {(game.ranking.hassleReasons ?? []).join(" · ") || "check logistics before committing"}.</p> : null}
      <div className="gameLinks">{game.sourceLinks.map((link) => <a href={link.url} key={`${link.source}|${link.url}`} rel="noreferrer" target="_blank">{providerLabel(link.source)} ↗</a>)}</div>
      <CardActions
        calendarEvent={calendarInputFrom({ ...game, title: gameTitle(game), description: game.ranking.whyYou })}
        layout="sports"
        planning={planningInputFrom("sports", { ...game, title: gameTitle(game) })}
      />
      {game.localEnhancement?.recommendation && isGroundedAdvisory(game.localEnhancement.recommendation) ? <p className="gameAdvisory"><strong>{game.localEnhancement.recommendation.verdict}</strong> {game.localEnhancement.recommendation.explanation}</p> : null}
    </div>
  </div>;
}

function formatPitcherMatchup(away: SportsGame["sportsContext"]["probablePitchers"]["away"], home: SportsGame["sportsContext"]["probablePitchers"]["home"]) {
  return `${formatPitcher(away)} vs ${formatPitcher(home)}`;
}

function formatPitcher(pitcher: SportsGame["sportsContext"]["probablePitchers"]["home"]) {
  if (!pitcher) return "TBD";
  const detail = [pitcher.handedness ? `${pitcher.handedness}HP` : null, pitcher.era != null ? `${pitcher.era.toFixed(2)} ERA` : null].filter(Boolean).join(" · ");
  return `${pitcher.name || "TBD"}${detail ? ` (${detail})` : ""}`;
}

export function gameTitle(game: SportsGame) {
  return `${friendlyHomeName(game)} vs. ${friendlyOpponentName(game.awayTeam)}`;
}

// The published row carries the league inside `sportsContext`; the id prefix
// covers rows from a build that predates it. Anything else is baseball.
function leagueOf(game: SportsGame): SportsLeague {
  const league = String(game.sportsContext?.league ?? game.league ?? "").toLowerCase();
  return league === "nfl" || game.id.startsWith("nfl:") ? "nfl" : "mlb";
}

function friendlyHomeName(game: SportsGame) {
  const team = game.homeTeam;
  if (!team?.name && !team?.shortName) return leagueOf(game) === "nfl" ? "Rams" : "Dodgers";
  if (/dodgers/i.test(`${team.name} ${team.shortName}`)) return "Dodgers";
  return friendlyOpponentName(team);
}

function homeTeams(games: SportsGame[]) {
  const teams = new Map<SportsLeague, string>();
  for (const game of games) {
    const league = leagueOf(game);
    if (!teams.has(league)) teams.set(league, friendlyHomeName(game));
  }
  return (["mlb", "nfl"] as const).filter((league) => teams.has(league)).map((league) => ({ league, label: teams.get(league) as string }));
}

function emptyTeamLabel(teams: Array<{ league: SportsLeague; label: string }>, filter: LeagueFilter) {
  const selected = filter === "all" ? teams : teams.filter((team) => team.league === filter);
  // A feed with no games at all has no team to name.
  return selected.length ? `${selected.map((team) => team.label).join(" or ")} ` : "";
}

function groupSeries(games: SportsGame[]) {
  const groups = new Map<string, SportsGame[]>();
  for (const game of games) {
    const key = game.series.id ?? game.id;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  return [...groups.values()]
    .map((series) => [...series].sort(gameComparator("interest")))
    .sort((left, right) => gameComparator("interest")(left[0], right[0]));
}

function gameComparator(mode: SortMode) {
  const urgency = (value: string) => ({ "buy now": 0, watch: 1, "safe to wait": 2, unknown: 3, "likely unavailable": 4 }[value] ?? 5);
  return (left: SportsGame, right: SportsGame) => {
    if (mode === "date") return String(left.startLocal).localeCompare(String(right.startLocal));
    if (mode === "hassle") return left.ranking.hassleScore - right.ranking.hassleScore || right.ranking.interestScore - left.ranking.interestScore;
    if (mode === "urgency") return urgency(left.ranking.urgency) - urgency(right.ranking.urgency) || String(left.startLocal).localeCompare(String(right.startLocal));
    return right.ranking.interestScore - left.ranking.interestScore || String(left.startLocal).localeCompare(String(right.startLocal));
  };
}

function providerLabel(value: string) {
  return ({ mlb: "MLB", espn: "ESPN", nfl: "NFL", seatgeek: "SeatGeek", ticketmaster: "Ticketmaster" } as Record<string, string>)[value] ?? value;
}

function friendlyOpponentName(team: { name: string; shortName: string }) {
  const name = `${team.name} ${team.shortName}`;
  const known = ['Diamondbacks', 'Padres', 'Giants', 'Yankees', 'Mets', 'Cubs', 'Cardinals', 'Astros', 'Red Sox', 'Braves', 'Phillies', 'Brewers', 'Marlins', 'Nationals', 'Reds', 'Pirates', 'Rockies', 'Tigers', 'Twins', 'White Sox', 'Guardians', 'Rays', 'Blue Jays', 'Orioles', 'Royals', 'Angels', 'Athletics', 'Mariners', 'Rangers'];
  return known.find((label) => name.toLocaleLowerCase().includes(label.toLocaleLowerCase())) ?? (team.shortName || team.name).replace(/^Arizona$/i, 'Diamondbacks').replace(/^Los Angeles\s+/i, '');
}
