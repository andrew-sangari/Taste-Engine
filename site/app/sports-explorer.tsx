"use client";

import { useMemo, useState } from "react";
import { isGroundedAdvisory } from "./advisories";
import { CardActions, calendarInputFrom, planningInputFrom } from "./card-actions";
import type { PublicFeedbackSnapshot } from "./feedback-store";
import { FilterDisclosure } from "./filter-disclosure";
import { RecommendationVisual, type RecommendationVisual as RecommendationVisualType } from "./recommendation-visual";
import { HassleDial, UrgencyChip } from "./signal-texture";

type SportsGame = {
  id: string;
  sourceUrl: string;
  startLocal: string | null;
  timeTbd: boolean;
  venue: { name: string; city: string; state: string };
  homeTeam: { name: string; shortName: string; abbreviation: string };
  awayTeam: { name: string; shortName: string; abbreviation: string };
  series: { id: string | null; gameNumber: number | null; gameCount: number | null };
  sportsContext: { rivalryTier: string; playoffLeverage: string; probablePitchers: { home: { name: string; era: number | null } | null; away: { name: string; era: number | null } | null; confirmed: boolean } };
  tags: string[];
  ticketObservations: Array<{ source: string; url: string; lowestPriceUsd: number | null; status: string }>;
  sourceLinks: Array<{ source: string; url: string }>;
  ranking: { interestScore: number; utility: number; hassleScore: number; urgency: string; confidence: string; whyYou: string };
  localEnhancement?: { personalFit?: { score: number; explanation: string }; recommendation?: { verdict: string; explanation: string }; urgency?: { label: string; explanation: string }; hassle?: { score: number; explanation: string } } | null;
  visual?: RecommendationVisualType;
  feedbackSnapshot?: PublicFeedbackSnapshot | null;
};

type WindowFilter = "all" | "soon" | "later";
type SortMode = "interest" | "date" | "hassle" | "urgency";
type TicketFilter = "all" | "ticketed" | "unknown";

export function SportsExplorer({ games, generatedAt, featuredThreshold = 70 }: { games: SportsGame[]; generatedAt: string; featuredThreshold?: number }) {
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("interest");
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>("all");
  const [rivalryOnly, setRivalryOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const generated = useMemo(() => new Date(generatedAt), [generatedAt]);
  const filtered = useMemo(() => games.filter((game) => {
    const date = game.startLocal ? new Date(game.startLocal) : null;
    const daysAway = date ? (date.getTime() - generated.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
    if (windowFilter === "soon" && daysAway > 30) return false;
    if (windowFilter === "later" && daysAway <= 30) return false;
    if (ticketFilter === "ticketed" && !game.ticketObservations.length) return false;
    if (ticketFilter === "unknown" && game.ticketObservations.length) return false;
    if (rivalryOnly && game.sportsContext.rivalryTier === "none") return false;
    return true;
  }).sort(gameComparator(sortMode)), [games, generated, rivalryOnly, sortMode, ticketFilter, windowFilter]);
  const series = useMemo(() => groupSeries(filtered), [filtered]);
  const visibleSeries = showAll ? series : series.slice(0, 3);
  return (
    <section className="sportsSection" aria-label="Dodgers sports schedule" id="sports-feed">
      <div className="sportsIntro">
        <div><p className="eyebrow">Third vertical · Dodgers</p><h2>Best games to attend.</h2></div>
        <p>MLB defines the game. Standings, rivalries, pitching, timing, and hassle decide whether this particular date is worth the trip. Ticket links are additive; missing ticket coverage stays visible as unknown.</p>
      </div>
      <div className="sportsControls">
        <div className="dateFilterGroup" aria-label="Sports date filter">
          {([['all', 'All dates'], ['soon', 'Next 30 days'], ['later', 'Later']] as const).map(([value, label]) => <button aria-pressed={windowFilter === value} className={windowFilter === value ? "filterActive" : ""} key={value} onClick={() => { setWindowFilter(value); setShowAll(false); }} type="button">{label}</button>)}
        </div>
        <FilterDisclosure count={[sortMode !== "interest", ticketFilter !== "all", rivalryOnly].filter(Boolean).length}>
            <label className="selectControl">Sort<select aria-label="Sports sort order" onChange={(event) => setSortMode(event.target.value as SortMode)} value={sortMode}><option value="interest">Interest</option><option value="date">Date</option><option value="hassle">Lowest hassle</option><option value="urgency">Ticket urgency</option></select></label>
            <label className="selectControl">Tickets<select aria-label="Sports ticket coverage" onChange={(event) => setTicketFilter(event.target.value as TicketFilter)} value={ticketFilter}><option value="all">All</option><option value="ticketed">Ticket link</option><option value="unknown">Unknown</option></select></label>
            <label className="hassleToggle"><input checked={rivalryOnly} onChange={(event) => setRivalryOnly(event.target.checked)} type="checkbox" /><span>Rivalries</span></label>
        </FilterDisclosure>
        <span className="resultCount">{showAll ? series.length : Math.min(series.length, 3)} of {series.length} series · {filtered.length} games</span>
      </div>
      {series.length ? <div className="sportsSeriesGrid" data-stagger="">{visibleSeries.map((group, index) => <SeriesCard games={group} isFeatured={index === 0} featuredThreshold={featuredThreshold} key={group[0].series.id ?? group[0].id} />)}</div> : <div className="sportsEmpty"><p className="eyebrow">Source status</p><h3>No Dodgers games match this filter.</h3><p>Try widening the date, rivalry, or ticket view.</p></div>}
      {series.length > 3 ? <button className="showMore" onClick={() => setShowAll((value) => !value)} type="button">{showAll ? "Show top 3 series" : `Show all ${series.length} series`}</button> : null}
    </section>
  );
}

function SeriesCard({ games, featuredThreshold, isFeatured }: { games: SportsGame[]; featuredThreshold: number; isFeatured: boolean }) {
  const featured = games.filter((game) => game.ranking.interestScore >= featuredThreshold);
  const shown = featured.length ? featured : games.slice(0, 1);
  const opponent = friendlyOpponentName(games[0].awayTeam);
  return <article className={`seriesCard rv ${isFeatured ? "seriesFeatured" : "seriesCompact"}`}>
    <RecommendationVisual className="seriesVisual" visual={games[0].visual} />
    <div className="seriesHeader"><div><p className="eyebrow">{games[0].series.gameCount ? `${games[0].series.gameCount}-game series` : "Dodgers home series"}</p><h3>{opponent}</h3><p>{games[0].tags.slice(0, 3).join(" · ") || "Regular-season home games"}</p></div><strong>{Math.max(...games.map((game) => game.ranking.interestScore))}</strong></div>
    <div className="seriesGames">{shown.map((game) => <GameRow game={game} key={game.id} />)}</div>
    {games.length > shown.length ? <details className="seriesDetails"><summary>View all {games.length} games</summary><div className="seriesGames">{games.filter((game) => !shown.some((shownGame) => shownGame.id === game.id)).map((game) => <GameRow game={game} key={game.id} />)}</div></details> : null}
  </article>;
}

function GameRow({ game }: { game: SportsGame }) {
  const date = game.startLocal ? new Date(game.startLocal) : null;
  const pitchers = game.sportsContext.probablePitchers;
  return <div className="gameRow">
    <div className="gameDate"><span>{date ? date.toLocaleDateString("en-US", { weekday: "short", month: "short" }) : "TBD"}</span><strong>{date ? date.getDate() : "—"}</strong></div>
    <div className="gameMatchup"><strong>{game.awayTeam.abbreviation} at {game.homeTeam.abbreviation}</strong><span>{date && !game.timeTbd ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "Time TBD"}{pitchers.confirmed ? ` · ${pitchers.away?.name ?? "TBD"} / ${pitchers.home?.name ?? "TBD"}` : ""}</span></div>
    <div className="gameSignals"><span>{game.ranking.interestScore} interest</span><HassleDial score={game.ranking.hassleScore} />{game.ticketObservations.length ? <UrgencyChip urgency={game.ranking.urgency} /> : <span className="signalAbsent">tickets unknown</span>}</div>
    <div className="gameLinks">{game.sourceLinks.map((link) => <a href={link.url} key={`${link.source}|${link.url}`} rel="noreferrer" target="_blank">{providerLabel(link.source)} ↗</a>)}</div>
    <CardActions
      calendarEvent={calendarInputFrom({ ...game, title: gameTitle(game), description: game.ranking.whyYou })}
      layout="sports"
      planning={planningInputFrom("sports", { ...game, title: gameTitle(game) })}
    />
    {game.localEnhancement?.recommendation && isGroundedAdvisory(game.localEnhancement.recommendation) ? <p className="gameAdvisory"><strong>{game.localEnhancement.recommendation.verdict}</strong> {game.localEnhancement.recommendation.explanation}</p> : null}
  </div>;
}

function gameTitle(game: SportsGame) {
  return `Dodgers vs. ${friendlyOpponentName(game.awayTeam)}`;
}

function groupSeries(games: SportsGame[]) {
  const groups = new Map<string, SportsGame[]>();
  for (const game of games) {
    const key = game.series.id ?? game.id;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  return [...groups.values()];
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
  return ({ mlb: "MLB", seatgeek: "SeatGeek", ticketmaster: "Ticketmaster" } as Record<string, string>)[value] ?? value;
}

function friendlyOpponentName(team: { name: string; shortName: string }) {
  const name = `${team.name} ${team.shortName}`;
  const known = ['Diamondbacks', 'Padres', 'Giants', 'Yankees', 'Mets', 'Cubs', 'Cardinals', 'Astros', 'Red Sox', 'Braves', 'Phillies', 'Brewers', 'Marlins', 'Nationals', 'Reds', 'Pirates', 'Rockies', 'Tigers', 'Twins', 'White Sox', 'Guardians', 'Rays', 'Blue Jays', 'Orioles', 'Royals', 'Angels', 'Athletics', 'Mariners', 'Rangers'];
  return known.find((label) => name.toLocaleLowerCase().includes(label.toLocaleLowerCase())) ?? team.shortName.replace(/^Arizona$/i, 'Diamondbacks');
}
