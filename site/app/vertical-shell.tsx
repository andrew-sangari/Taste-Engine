"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EventExplorer } from "./event-explorer";
import { MovieExplorer } from "./movie-explorer";
import { OverviewExplorer } from "./overview-explorer";
import { SportsExplorer } from "./sports-explorer";
import { TasteExplorer, type TasteProfile } from "./taste-explorer";
import { FeedbackProvider, useFeedback } from "./feedback-context";
import { planningInputFrom } from "./card-actions";
import type { PlanningInput, RecommendationHistoryItem } from "./feedback-store";
import { currentLocalDateKey, isCurrentOrFuture, isDateAwareRefreshNeeded } from "./date-aware";

type Vertical = "overview" | "music" | "movies" | "sports" | "taste";
const TABS: Array<[Vertical, string]> = [['overview', 'Overview'], ['music', 'Music'], ['movies', 'Movies'], ['sports', 'Sports'], ['taste', 'Taste']];

export function VerticalShell({ overview, overviewPlanAhead, events, movies, sports, recentHistory, generatedAt, tmdbStatus, featuredInterestThreshold, editorial, tasteProfile, changesSinceRefresh }: {
  overview: any[];
  overviewPlanAhead?: any[];
  events: any[];
  movies: any[];
  sports: any[];
  recentHistory: RecommendationHistoryItem[];
  generatedAt: string;
  tmdbStatus: string;
  featuredInterestThreshold: number;
  editorial?: any;
  tasteProfile?: TasteProfile | null;
  changesSinceRefresh?: any;
}) {
  const [active, setActive] = useState<Vertical>("overview");
  const [currentAsOf, setCurrentAsOf] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const setFromHash = () => {
      const next = window.location.hash.slice(1) as Vertical;
      if (["overview", "music", "movies", "sports", "taste"].includes(next)) setActive(next);
    };
    setFromHash();
    window.addEventListener("hashchange", setFromHash);
    window.addEventListener("popstate", setFromHash);
    return () => {
      window.removeEventListener("hashchange", setFromHash);
      window.removeEventListener("popstate", setFromHash);
    };
  }, []);
  useEffect(() => {
    const updateClock = () => setCurrentAsOf(new Date().toISOString());
    updateClock();
    const interval = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const asOf = currentAsOf ?? generatedAt;
  const todayKey = currentLocalDateKey(asOf);
  const visibleEvents = events.filter((event) => isCurrentOrFuture(event.startLocal, todayKey));
  const visibleMovies = movies.filter((movie) => isCurrentOrFuture(movie.releaseDate, todayKey));
  const visibleSports = sports.filter((game) => isCurrentOrFuture(game.startLocal, todayKey));
  const visibleOverview = overview.filter((item) => isCurrentOrFuture(item.startLocal, todayKey));
  const visiblePlanAhead = (overviewPlanAhead ?? []).filter((item) => isCurrentOrFuture(item.startLocal, todayKey));
  const dateAwareRefresh = isDateAwareRefreshNeeded(generatedAt, todayKey);
  // Planning inputs cover the FULL projection (not just visible items) so a
  // saved event whose date passed still reconciles instead of vanishing.
  const projectionItems = useMemo(() => [
    ...events.map((event) => planningInputFrom("music", event)),
    ...sports.map((game) => planningInputFrom("sports", { ...game, title: sportsTitle(game) })),
    ...movies.map((movie) => planningInputFrom("movies", movie))
  ].filter((item): item is PlanningInput => item != null), [events, movies, sports]);
  const select = (next: Vertical, focus = false) => {
    setActive(next);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, "", `#${next}`);
    if (focus) window.setTimeout(() => tabRefs.current[TABS.findIndex(([value]) => value === next)]?.focus({ preventScroll: true }), 0);
  };
  const move = (current: Vertical, direction: "next" | "previous" | "first" | "last") => {
    const index = TABS.findIndex(([value]) => value === current);
    const nextIndex = direction === "first" ? 0 : direction === "last" ? TABS.length - 1 : (index + (direction === "next" ? 1 : -1) + TABS.length) % TABS.length;
    select(TABS[nextIndex][0], true);
  };
  return <FeedbackProvider projectionItems={projectionItems} recentHistory={recentHistory} todayKey={todayKey}>
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
    <div aria-labelledby={`tab-${active}`} id={`panel-${active}`} role="tabpanel" tabIndex={0}>
      {active === "overview" ? <OverviewExplorer changesSinceRefresh={changesSinceRefresh} dateAwareRefresh={dateAwareRefresh} editorial={editorial} generatedAt={asOf} overview={visibleOverview} planAhead={visiblePlanAhead} projectionGeneratedAt={generatedAt} /> : null}
      {active === "music" ? <EventExplorer events={visibleEvents} generatedAt={asOf} /> : null}
      {active === "movies" ? <MovieExplorer generatedAt={asOf} movies={visibleMovies} tmdbStatus={tmdbStatus} /> : null}
      {active === "sports" ? <SportsExplorer featuredThreshold={featuredInterestThreshold} games={visibleSports} generatedAt={asOf} /> : null}
      {active === "taste" ? <TasteExplorer profile={tasteProfile ?? null} /> : null}
    </div>
    </section>
  </FeedbackProvider>;
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

function sportsTitle(game: any) {
  const opponent = game.awayTeam?.shortName ?? game.awayTeam?.name ?? "opponent";
  return `Dodgers vs. ${opponent}`;
}
