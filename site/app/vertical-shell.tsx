"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EventExplorer, discoveryLabel, type EventItem } from "./event-explorer";
import { SeasonStrip, type SeasonItem } from "./season-strip";
import { TriageDeck } from "./triage-deck";
import { Radar, radarHref, type RadarContact } from "./radar";
import { MovieExplorer, isMovieVisible, moviePlanningInput, type Movie } from "./movie-explorer";
import { OverviewExplorer, type Editorial, type OverviewItem } from "./overview-explorer";
import { SportsExplorer, gameTitle, type SportsGame } from "./sports-explorer";
import { TasteExplorer, type LiveLearning, type TasteProfile } from "./taste-explorer";
import { applyFeedbackOverlay, buildEvidenceGraph, buildOverviewBuckets, connectionPaths, deriveFeedbackSignals, describeLearning, type EvidenceGraph } from "./engine-client.js";
import { Constellation } from "./constellation";
import { DecisionPlans } from "./decision-plans";
import type { ChangesSinceRefresh } from "./changes-strip";
import { FeedbackProvider, useFeedback } from "./feedback-context";
import { planningInputFrom } from "./card-actions";
import type { PlanningInput, RecommendationHistoryItem } from "./feedback-store";
import { currentLocalDateKey, isCurrentOrFuture, isDateAwareRefreshNeeded } from "./date-aware";
import { eventIdFromHash } from "./event-anchor";

type Vertical = "overview" | "radar" | "music" | "movies" | "sports" | "taste";
const TABS: Array<[Vertical, string]> = [['overview', 'Overview'], ['radar', 'Radar'], ['music', 'Music'], ['movies', 'Movies'], ['sports', 'Sports'], ['taste', 'Taste']];

export type RankingConfig = { currentMinScore: number; planAheadMinScore: number; currentDays: number };

export function VerticalShell({ overview, overviewPlanAhead, events, movies, sports, recentHistory, generatedAt, tmdbStatus, featuredInterestThreshold, editorial, tasteProfile, rankingConfig = null, horizonDays = null, changesSinceRefresh, storageProfileId, allowLegacyStorageMigration }: {
  rankingConfig?: RankingConfig | null;
  horizonDays?: number | null;
  overview: OverviewItem[];
  overviewPlanAhead?: OverviewItem[];
  events: EventItem[];
  movies: Movie[];
  sports: SportsGame[];
  recentHistory: RecommendationHistoryItem[];
  generatedAt: string;
  tmdbStatus: string;
  featuredInterestThreshold: number;
  editorial?: Editorial;
  tasteProfile?: TasteProfile | null;
  changesSinceRefresh?: ChangesSinceRefresh | null;
  storageProfileId: string | null;
  allowLegacyStorageMigration: boolean;
}) {
  const [active, setActive] = useState<Vertical>("overview");
  const [targetEventId, setTargetEventId] = useState<string | null>(null);
  const [currentAsOf, setCurrentAsOf] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const verticalByEventId = useMemo(() => new Map<string, Vertical>([
    ...events.map((event): [string, Vertical] => [String(event.id), "music"]),
    ...sports.map((game): [string, Vertical] => [String(game.id), "sports"]),
  ]), [events, sports]);
  useEffect(() => {
    const setFromHash = () => {
      const next = window.location.hash.slice(1) as Vertical;
      const eventId = eventIdFromHash(window.location.hash);
      if (eventId) {
        const vertical = verticalByEventId.get(eventId);
        if (vertical) {
          setTargetEventId(eventId);
          setActive(vertical);
        }
      } else if (["overview", "radar", "music", "movies", "sports", "taste"].includes(next)) {
        setTargetEventId(null);
        setActive(next);
      }
    };
    setFromHash();
    window.addEventListener("hashchange", setFromHash);
    window.addEventListener("popstate", setFromHash);
    return () => {
      window.removeEventListener("hashchange", setFromHash);
      window.removeEventListener("popstate", setFromHash);
    };
  }, [verticalByEventId]);
  useEffect(() => {
    if (!targetEventId) return;
    const anchor = `event-${targetEventId}`;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(anchor);
      if (!target) return;
      const parentDetails = target.closest("details") as HTMLDetailsElement | null;
      if (parentDetails) parentDetails.open = true;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("eventAnchorHighlight");
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      window.setTimeout(() => target.classList.remove("eventAnchorHighlight"), 1800);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [active, targetEventId]);
  useEffect(() => {
    const updateClock = () => setCurrentAsOf(new Date().toISOString());
    updateClock();
    const interval = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const asOf = currentAsOf ?? generatedAt;
  const todayKey = currentLocalDateKey(asOf);
  const visibleEvents = events.filter((event) => isCurrentOrFuture(event.startLocal, todayKey));
  // A film stays visible past its release date while a confirmed run is live.
  const visibleMovies = movies.filter((movie) => isMovieVisible(movie, todayKey));
  const visibleSports = sports.filter((game) => isCurrentOrFuture(game.startLocal, todayKey));
  const visibleOverview = overview.filter((item) => isCurrentOrFuture(item.startLocal, todayKey));
  const visiblePlanAhead = (overviewPlanAhead ?? []).filter((item) => isCurrentOrFuture(item.startLocal, todayKey));
  const dateAwareRefresh = isDateAwareRefreshNeeded(generatedAt, todayKey);
  // Planning inputs cover the FULL projection (not just visible items) so a
  // saved event whose date passed still reconciles instead of vanishing.
  const projectionItems = useMemo(() => [
    ...events.map((event) => planningInputFrom("music", event)),
    ...sports.map((game) => planningInputFrom("sports", { ...game, title: sportsTitle(game) })),
    ...movies.map((movie) => moviePlanningInput(movie, todayKey))
  ].filter((item): item is PlanningInput => item != null), [events, movies, sports, todayKey]);
  const staleDays = Math.max(0, Math.round((Date.parse(`${todayKey}T12:00:00Z`) - Date.parse(`${currentLocalDateKey(generatedAt)}T12:00:00Z`)) / 86_400_000));
  const select = (next: Vertical, focus = false) => {
    setActive(next);
    setTargetEventId(null);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, "", `#${next}`);
    if (focus) window.setTimeout(() => tabRefs.current[TABS.findIndex(([value]) => value === next)]?.focus({ preventScroll: true }), 0);
  };
  const move = (current: Vertical, direction: "next" | "previous" | "first" | "last") => {
    const index = TABS.findIndex(([value]) => value === current);
    const nextIndex = direction === "first" ? 0 : direction === "last" ? TABS.length - 1 : (index + (direction === "next" ? 1 : -1) + TABS.length) % TABS.length;
    select(TABS[nextIndex][0], true);
  };
  return <FeedbackProvider allowLegacyStorageMigration={allowLegacyStorageMigration} profileId={storageProfileId} projectionItems={projectionItems} recentHistory={recentHistory} todayKey={todayKey}>
    {currentAsOf && staleDays >= 4 ? <aside className={`staleBanner ${staleDays >= 14 ? "staleSevere" : ""}`} role="status">
      <strong>This projection is {staleDays} days old.</strong>
      <span>Dates that have passed are hidden, but nothing new has been retrieved, and scores, lineups and ticket status are as of the last refresh. Run a refresh before trusting the shortlist.</span>
    </aside> : null}
    <section className="verticalShell" aria-label="Taste Engine verticals">
    <div className="verticalTabs" role="tablist" aria-label="Taste Engine verticals">
      {TABS.map(([value, label], index) => <TabButton
        active={active === value}
        key={value}
        label={label}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") { event.preventDefault(); move(value, "next"); }
          if (event.key === "ArrowLeft") { event.preventDefault(); move(value, "previous"); }
          if (event.key === "Home") { event.preventDefault(); move(value, "first"); }
          if (event.key === "End") { event.preventDefault(); move(value, "last"); }
        }}
        onSelect={() => select(value)}
        refCallback={(element) => { tabRefs.current[index] = element; }}
        value={value}
      />)}
    </div>
    <LiveRanking asOf={asOf} config={rankingConfig} tasteProfile={tasteProfile ?? null} events={visibleEvents} generatedAt={generatedAt} horizonDays={horizonDays} overview={visibleOverview} planAhead={visiblePlanAhead} sports={visibleSports} todayKey={todayKey}>
      {(live) => <div aria-labelledby={`tab-${active}`} className={`verticalPanel verticalPanel-${active}`} id={`panel-${active}`} role="tabpanel" tabIndex={0}>
        {active === "overview" ? <OverviewExplorer adjustedByFeedback={live.learning.shortlistChanged} between={<><SeasonStrip items={live.seasonItems} todayKey={todayKey} /><DecisionPlans events={live.events} items={live.seasonItems} sports={live.sports} todayKey={todayKey} /><TriageDeck items={live.seasonItems} /></>} changesSinceRefresh={changesSinceRefresh} dateAwareRefresh={dateAwareRefresh} editorial={editorial} generatedAt={asOf} overview={live.overview} planAhead={live.planAhead} projectionGeneratedAt={generatedAt} /> : null}
        {active === "radar" ? <RadarTab contacts={radarContacts(live.seasonItems, visibleMovies, todayKey)} graph={live.graph} todayKey={todayKey} /> : null}
        {active === "music" ? <EventExplorer events={live.events} routes={live.routes} generatedAt={asOf} key={targetEventId ?? "music"} targetEventId={targetEventId} /> : null}
        {active === "movies" ? <MovieExplorer generatedAt={asOf} movies={visibleMovies} tmdbStatus={tmdbStatus} /> : null}
        {active === "sports" ? <SportsExplorer featuredThreshold={featuredInterestThreshold} games={live.sports} generatedAt={asOf} key={targetEventId ?? "sports"} targetEventId={targetEventId} /> : null}
        {active === "taste" ? <TasteExplorer learning={live.learning} profile={tasteProfile ?? null} /> : null}
      </div>}
    </LiveRanking>
    </section>
  </FeedbackProvider>;
}

type LiveView = {
  events: EventItem[];
  sports: SportsGame[];
  overview: OverviewItem[];
  planAhead: OverviewItem[];
  seasonItems: SeasonItem[];
  learning: LiveLearning;
  // The typed relationships behind the ranking, and each night's independent
  // routes back to the person. Explanation only; neither changes a score.
  graph: EvidenceGraph;
  routes: Map<string, string[]>;
};

// Feedback is a read-time overlay. The projection carries canonical scores;
// this lays the person's own reads and outcomes over them with the shared
// policy, so a new answer re-ranks every view immediately and switching it
// off restores the published order. Nothing here is persisted.
function LiveRanking({ events, sports, overview, planAhead, config, horizonDays, generatedAt, asOf, todayKey, tasteProfile, children }: {
  tasteProfile: TasteProfile | null;
  events: EventItem[];
  sports: SportsGame[];
  overview: OverviewItem[];
  planAhead: OverviewItem[];
  config: RankingConfig | null;
  horizonDays: number | null;
  generatedAt: string;
  asOf: string;
  todayKey: string;
  children: (live: LiveView) => React.ReactNode;
}) {
  const feedback = useFeedback();
  const storedRecords = feedback?.ready ? feedback.store.records : null;
  const enabled = feedback?.learning ?? true;
  const live = useMemo<LiveView>(() => {
    const records = Object.values(storedRecords ?? {}).map((entry) => entry.record);
    const signals = records.length ? deriveFeedbackSignals(records, { now: `${todayKey}T12:00:00Z` }) : null;
    const base = { enabled, countedOutcomeCount: signals?.countedRecords ?? 0, learned: signals ? describeLearning(signals, { limit: 16 }) : [] };
    const evidence = (rows: EventItem[], games: SportsGame[]) => {
      const graph = buildEvidenceGraph({ events: rows, sports: games, tasteProfile, signals: enabled ? signals : null });
      const routes = new Map<string, string[]>();
      for (const row of rows) {
        const paths = connectionPaths(graph, row.id, { maxPaths: 3 });
        if (paths.length >= 2) routes.set(row.id, paths.map(shortRoute));
      }
      return { graph, routes };
    };
    const music = signals && enabled ? applyFeedbackOverlay(events, "music", signals) : null;
    const games = signals && enabled ? applyFeedbackOverlay(sports, "sports", signals) : null;
    const moved = (music?.audit.adjustedCount ?? 0) + (games?.audit.adjustedCount ?? 0);
    if (!music || !games || !moved) {
      return { events, sports, overview, planAhead, seasonItems: toSeasonItems(events, sports), learning: { ...base, movedCount: 0, shortlistChanged: false, movements: [] }, ...evidence(events, sports) };
    }
    // Re-run the shortlist over the adjusted scores with the same builder and
    // the same clock the refresh used, then hide what has already passed.
    const buckets = buildOverviewBuckets(music.rows, games.rows, {
      now: generatedAt,
      currentDays: config?.currentDays ?? 14,
      currentMinScore: config?.currentMinScore ?? 28,
      planAheadMinScore: config?.planAheadMinScore ?? 55,
      horizonDays,
    });
    const current = buckets.current.filter((item) => isCurrentOrFuture(item.startLocal, todayKey));
    const ahead = buckets.planAhead.filter((item) => isCurrentOrFuture(item.startLocal, todayKey));
    const ids = (items: OverviewItem[]) => items.map((item) => item.id).join("|");
    const movements = [...music.rows, ...games.rows.map((game) => ({ ...game, title: sportsTitle(game) }))]
      .flatMap((row) => {
        const adjustment = row.ranking.feedbackAdjustment;
        return adjustment?.scoreDelta
          ? [{ id: String(row.id), title: String(row.title), scoreDelta: adjustment.scoreDelta, reason: adjustment.reasons?.[0]?.label ?? null }]
          : [];
      })
      .sort((left, right) => Math.abs(right.scoreDelta) - Math.abs(left.scoreDelta))
      .slice(0, 6);
    return {
      events: music.rows,
      sports: games.rows,
      overview: current,
      planAhead: ahead,
      seasonItems: toSeasonItems(music.rows, games.rows),
      learning: { ...base, movedCount: moved, shortlistChanged: ids(current) !== ids(overview) || ids(ahead) !== ids(planAhead), movements },
      ...evidence(music.rows, games.rows),
    };
  }, [config, enabled, events, generatedAt, horizonDays, overview, planAhead, sports, storedRecords, tasteProfile, todayKey]);
  void asOf;
  return <>{children(live)}</>;
}

// One route as a few words for a card: who or what links the night to you.
function shortRoute(path: { kind: string; text: string; hops: Array<{ label: string; nodeKind: string }> }): string {
  const first = path.hops.find((hop) => hop.nodeKind !== "you");
  if (path.kind === "watchlist") return "On your watchlist";
  if (!first) return path.text;
  if (first.nodeKind === "artist") return path.hops.length > 3 ? `Via ${first.label}` : `You play ${first.label}`;
  if (first.nodeKind === "promoter") return `You follow ${first.label}`;
  if (first.nodeKind === "venue") return `You rate ${first.label}`;
  return `Via ${first.label}`;
}

// The Radar tab has two readings of the same horizon: the scope (when and how
// strong) and the constellation (why: what connects each night to you).
function RadarTab({ contacts, graph, todayKey }: { contacts: RadarContact[]; graph: EvidenceGraph; todayKey: string }) {
  const [mode, setMode] = useState<"scope" | "constellation">("scope");
  return <section className="radarTab">
    <div className="radarModes">
      <div aria-label="Radar view" role="group">
        <button aria-pressed={mode === "scope"} onClick={() => setMode("scope")} type="button">Scope</button>
        <button aria-pressed={mode === "constellation"} onClick={() => setMode("constellation")} type="button">Constellation</button>
      </div>
      <p>{mode === "scope" ? "When it is, and how strong." : "Why it is here: what connects each night to you."}</p>
    </div>
    {mode === "scope" ? <Radar contacts={contacts} todayKey={todayKey} /> : <Constellation graph={graph} />}
  </section>;
}

function radarContacts(items: SeasonItem[], movies: Movie[], todayKey: string): RadarContact[] {
  return [
    ...items.map((item): RadarContact => ({
      id: item.id, sector: item.vertical, title: item.title, startLocal: item.startLocal, venueLabel: item.venueLabel, why: item.why,
      score: item.score, label: item.label, groupKey: item.groupKey, href: radarHref(item.vertical, item.id), planning: item.planning,
    })),
    ...movies.map((movie): RadarContact => {
      const planning = moviePlanningInput(movie, todayKey);
      return {
        id: movie.id, sector: "film", title: movie.title,
        startLocal: planning?.planningSnapshot.dateLocal ?? movie.releaseDate,
        venueLabel: movie.theater ?? (movie.actionable ? "Confirmed screening" : "Format not yet confirmed"),
        why: movie.reasons?.[0] ?? movie.overview?.slice(0, 160) ?? "",
        // A film without a confirmed screening is a watchlist item, not a night out.
        score: movie.tasteScore * (movie.actionable ? 0.6 : 0.32),
        label: movie.actionable ? "Confirmed screening" : "Watchlist", groupKey: `film:${movie.id}`, href: radarHref("film", movie.id), planning,
      };
    }),
  ];
}

// One shape for the season strip and the triage deck, across music and sports.
function toSeasonItems(events: EventItem[], sports: SportsGame[]): SeasonItem[] {
  return [
    ...events.map((event): SeasonItem => {
      const primary = event.matchedArtists.find((artist) => artist.primary) ?? event.matchedArtists[0];
      return {
        id: event.id, vertical: "music", title: event.lineupDisplay?.displayTitle || event.title, startLocal: event.startLocal,
        venueLabel: [event.venue.name, event.venue.city].filter(Boolean).join(" · "), why: event.ranking.whyYou,
        score: event.ranking.utility, fit: event.ranking.artistFit, friction: event.ranking.hassleScore, urgency: event.ranking.urgency,
        confidence: event.ranking.confidence, call: event.ranking.call ?? "Watch", label: discoveryLabel(event),
        groupKey: `music:${(primary?.name ?? event.title).toLocaleLowerCase()}`, planning: planningInputFrom("music", event),
      };
    }),
    ...sports.map((game): SeasonItem => ({
      id: game.id, vertical: "sports", title: sportsTitle(game), startLocal: game.startLocal,
      venueLabel: [game.venue?.name, game.venue?.city].filter(Boolean).join(" · "), why: game.ranking.whyYou,
      score: game.ranking.utility, fit: game.ranking.interestScore ?? null, friction: game.ranking.hassleScore ?? null, urgency: game.ranking.urgency,
      confidence: game.ranking.confidence, call: "Game day", label: "Home game",
      groupKey: `sports:${game.series?.id ?? game.id}`, planning: planningInputFrom("sports", { ...game, title: sportsTitle(game) }),
    })),
  ];
}

// Separate component so the Taste tab's accessible name can carry the pending
// check-in count ("Taste, 2 pending check-ins") from inside the provider.
function TabButton({ value, label, active, onSelect, onKeyDown, refCallback }: {
  value: Vertical;
  label: string;
  active: boolean;
  onSelect: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  refCallback: (element: HTMLButtonElement | null) => void;
}) {
  const feedback = useFeedback();
  const pending = value === "taste" ? feedback?.pendingCount ?? 0 : 0;
  return <button
    aria-controls={`panel-${value}`}
    aria-label={pending ? `${label}, ${pending} pending check-in${pending === 1 ? "" : "s"}` : undefined}
    aria-selected={active}
    className={active ? "verticalTab tabActive" : "verticalTab"}
    id={`tab-${value}`}
    onClick={onSelect}
    onKeyDown={onKeyDown}
    ref={refCallback}
    role="tab"
    tabIndex={active ? 0 : -1}
    type="button"
  >{label}{pending ? <span aria-hidden="true" className="tabBadge">{pending}</span> : null}</button>;
}

// One league-aware title for every surface ("Rams vs. Packers").
function sportsTitle(game: SportsGame) {
  return gameTitle(game);
}
