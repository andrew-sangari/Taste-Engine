"use client";

import { useMemo, useState } from "react";
import { CardActions, calendarInputFrom, planningInputFrom } from "./card-actions";
import { RecommendationVisual, type RecommendationVisual as RecommendationVisualType } from "./recommendation-visual";

type Movie = {
  id: string;
  title: string;
  sourceUrl: string;
  releaseDate: string | null;
  overview: string;
  tasteScore: number;
  reasons: string[];
  directors: string[];
  runtimeMinutes: number | null;
  formatStatus: string;
  tasteTier?: "strong" | "potential" | "stretch";
  visual?: RecommendationVisualType;
  format?: string | null;
  theater?: string | null;
  premiumFormatConfirmed?: boolean;
  posterUrl?: string | null;
  backdropUrl?: string | null;
};

type WindowFilter = "all" | "soon" | "later";

export function MovieExplorer({ movies, tmdbStatus, generatedAt }: { movies: Movie[]; tmdbStatus: string; generatedAt: string }) {
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("soon");
  const [showAll, setShowAll] = useState(false);
  const generated = useMemo(() => new Date(generatedAt), [generatedAt]);
  const visibleMovies = useMemo(() => movies.filter((movie) => {
    const date = movie.releaseDate ? new Date(`${movie.releaseDate}T12:00:00`) : null;
    const daysAway = date ? (date.getTime() - generated.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
    if (windowFilter === "soon" && daysAway > 30) return false;
    if (windowFilter === "later" && daysAway <= 30) return false;
    return true;
  }).sort((left, right) => Number(Boolean(right.premiumFormatConfirmed)) - Number(Boolean(left.premiumFormatConfirmed)) || tierRank(left.tasteTier) - tierRank(right.tasteTier) || String(left.releaseDate).localeCompare(String(right.releaseDate))), [generated, movies, windowFilter]);
  const displayedMovies = showAll ? visibleMovies : visibleMovies.slice(0, 6);
  const groups = [
    { key: "confirmed", label: "Confirmed locally", items: displayedMovies.filter((movie) => movie.premiumFormatConfirmed) },
    { key: "release", label: "Release watch", items: displayedMovies.filter((movie) => !movie.premiumFormatConfirmed && movie.releaseDate) },
    { key: "long", label: "Long lead", items: displayedMovies.filter((movie) => !movie.premiumFormatConfirmed && !movie.releaseDate) }
  ].filter((group) => group.items.length);
  return (
    <section className="movieSection" id="movies">
      <div className="movieIntro">
        <div>
          <p className="eyebrow">Second vertical · movies</p>
          <h2>Theatrical candidates.<br />Format decides.</h2>
        </div>
        <p>TMDB narrows upcoming releases against a film profile. A movie remains provisional until local discovery confirms the theater, presentation, and how quickly that premium run may disappear.</p>
      </div>

      <div className="movieControls">
        <div className="dateFilterGroup" aria-label="Movie date filter">
          {([['all', 'All dates'], ['soon', 'Next 30 days'], ['later', 'Later']] as const).map(([value, label]) => <button aria-pressed={windowFilter === value} className={windowFilter === value ? "filterActive" : ""} key={value} onClick={() => { setWindowFilter(value); setShowAll(false); }} type="button">{label}</button>)}
        </div>
        <span className="resultCount">{showAll ? visibleMovies.length : Math.min(visibleMovies.length, 6)} of {visibleMovies.length} candidates</span>
      </div>
      {groups.length ? (
        <div className="movieGroups">
          {groups.map((group) => <section className="movieGroup" key={group.key}>
            <div className="movieGroupHeader"><p className="eyebrow">{group.label}</p></div>
            <div className="movieGrid" data-stagger="">
              {group.items.map((movie) => <MovieCard key={movie.id} movie={movie} />)}
            </div>
          </section>)}
        </div>
      ) : (
        <div className="movieEmpty">
          <p className="eyebrow">Source status · {tmdbStatus}</p>
          <h3>No movie cards are being guessed into the list.</h3>
          <p>Once TMDB is connected, only the refined film-profile shortlist will render here.</p>
        </div>
      )}
      {visibleMovies.length > 6 ? <button className="showMore" onClick={() => setShowAll((value) => !value)} type="button">{showAll ? "Show first 6" : `Show all ${visibleMovies.length} candidates`}</button> : null}
      <p className="tmdbAttribution">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </section>
  );
}

function tierRank(tier: Movie["tasteTier"]) {
  return tier === "strong" ? 0 : tier === "potential" || tier == null ? 1 : 2;
}

const TIER_LABELS = { strong: "Strong fit", potential: "Potential fit", stretch: "Stretch" } as const;

function MovieCard({ movie }: { movie: Movie }) {
  const date = movie.releaseDate ? new Date(`${movie.releaseDate}T12:00:00`) : null;
  const formatLabel = movie.premiumFormatConfirmed && movie.format ? movie.format : "Format watch";
  const tier = movie.premiumFormatConfirmed ? "strong" : movie.tasteTier ?? "potential";
  const tasteTier = TIER_LABELS[tier];
  return <article className={`movieCard rv ${movie.premiumFormatConfirmed ? "movieConfirmed" : ""}`}>
    <RecommendationVisual className="movieMedia" visual={movie.visual} />
    <div className="movieCardContent">
      <div className="movieMeta"><span>{date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Date TBD"}</span><span>{formatLabel}</span></div>
      <h3>{movie.title}</h3>
      <p className="movieCredits">{movie.directors.length ? `Directed by ${movie.directors.join(", ")}` : "Director metadata pending"}{movie.runtimeMinutes ? ` · ${movie.runtimeMinutes} min` : ""}</p>
      <p>{movie.reasons[0] ?? movie.overview}</p>
      {movie.theater ? <p className="movieTheater">{movie.theater}{movie.format ? ` · ${movie.format}` : ""}</p> : null}
      <div className="movieScore"><span>Taste tier</span><strong className={`tier-${tier}`}>{tasteTier}</strong></div>
      <div className="movieCardFooter">
        <CardActions
          calendarEvent={calendarInputFrom({ ...movie, startLocal: null, description: movie.reasons[0] ?? movie.overview })}
          layout="movie"
          planning={planningInputFrom("movies", movie)}
        />
        <a href={movie.sourceUrl} rel="noreferrer" target="_blank">Details <span aria-hidden="true">→</span></a>
      </div>
    </div>
  </article>;
}
