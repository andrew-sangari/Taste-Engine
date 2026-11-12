"use client";

import { useMemo, useState } from "react";
import { CardActions, calendarInputFrom, planningInputFrom } from "./card-actions";
import { currentLocalDateKey, isCurrentOrFuture, localDateKey } from "./date-aware";
import { RecommendationVisual, type RecommendationVisual as RecommendationVisualType } from "./recommendation-visual";

// A reviewed, sourced confirmation of a real screening (src/movieEngagements.js).
export type MovieEngagement = {
  theater: string;
  format: string;
  premium?: boolean;
  priorityTheater?: boolean;
  startDate: string;
  endDate?: string | null;
  showtimes?: string[];
  nextScreening?: string | null;
  nextShowtime?: string | null;
  nextScreeningBasis?: "showtime" | "run-start" | "run-in-progress";
  sourceUrl: string;
  confirmedAt?: string | null;
  expiresAt?: string | null;
  note?: string | null;
};

export type Movie = {
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
  // Present only when a reviewed confirmation matched; older projections omit them.
  engagements?: MovieEngagement[];
  actionable?: boolean;
  nextScreening?: string | null;
};

type LiveEngagement = MovieEngagement & {
  showtimes: string[];
  nextDate: string;
  nextTime: string | null;
  basis: "showtime" | "run-start" | "run-in-progress";
  expiryKey: string | null;
};

type WindowFilter = "all" | "soon" | "later";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_SHOWTIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// Confirmations still attendable on the viewer's current local date, soonest
// first. The export already drops expired entries; this repeats the date
// boundary in the browser so a lapsed confirmation falls back to the watchlist
// without a rebuild. Nothing is inferred: a showtime is shown only if published.
export function liveEngagements(movie: Movie, todayKey: string): LiveEngagement[] {
  const live: LiveEngagement[] = [];
  for (const engagement of Array.isArray(movie.engagements) ? movie.engagements : []) {
    if (!engagement?.theater || !engagement.format || !DATE_KEY.test(String(engagement.startDate ?? ""))) continue;
    if (!String(engagement.sourceUrl ?? "").startsWith("https://")) continue;
    const endKey = dateKeyOf(engagement.endDate);
    const expiryKey = dateKeyOf(engagement.expiresAt);
    if ((expiryKey && expiryKey < todayKey) || (endKey && endKey < todayKey)) continue;
    const published = (Array.isArray(engagement.showtimes) ? engagement.showtimes : []).filter((value) => LOCAL_SHOWTIME.test(String(value)));
    const showtimes = published.filter((value) => value.slice(0, 10) >= todayKey).sort();
    // Published showtimes with no end date are the whole known engagement.
    if (!endKey && published.length && !showtimes.length) continue;
    const next = showtimes[0];
    live.push({
      ...engagement,
      showtimes,
      nextDate: next ? next.slice(0, 10) : engagement.startDate >= todayKey ? engagement.startDate : todayKey,
      nextTime: next ?? null,
      basis: next ? "showtime" : engagement.startDate >= todayKey ? "run-start" : "run-in-progress",
      expiryKey,
    });
  }
  return live.sort((left, right) => left.nextDate.localeCompare(right.nextDate) || String(left.nextTime ?? "9").localeCompare(String(right.nextTime ?? "9")));
}

// A film stays visible past its release date while a confirmed run is live.
export function isMovieVisible(movie: Movie, todayKey: string): boolean {
  return isCurrentOrFuture(movie.releaseDate, todayKey) || liveEngagements(movie, todayKey).length > 0;
}

// Planning date for a film: its next confirmed screening, else its release date.
export function moviePlanningInput(movie: Movie, todayKey: string) {
  const headline = headlineEngagement(liveEngagements(movie, todayKey));
  return planningInputFrom("movies", headline
    ? { id: movie.id, title: movie.title, releaseDate: headline.nextDate, venue: { name: headline.theater } }
    : movie);
}

export function MovieExplorer({ movies, tmdbStatus, generatedAt }: { movies: Movie[]; tmdbStatus: string; generatedAt: string }) {
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("soon");
  const [showAll, setShowAll] = useState(false);
  const generated = useMemo(() => new Date(generatedAt), [generatedAt]);
  const todayKey = useMemo(() => currentLocalDateKey(generatedAt), [generatedAt]);
  const { confirmed, watchlist } = useMemo(() => {
    const inWindow = (dateKey: string | null) => {
      const date = dateKey ? new Date(`${dateKey}T12:00:00`) : null;
      const daysAway = date ? (date.getTime() - generated.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
      if (windowFilter === "soon" && daysAway > 30) return false;
      if (windowFilter === "later" && daysAway <= 30) return false;
      return true;
    };
    const screenings: Array<{ movie: Movie; engagements: LiveEngagement[] }> = [];
    const pending: Movie[] = [];
    for (const movie of movies) {
      const engagements = liveEngagements(movie, todayKey);
      if (engagements.length) {
        // A confirmed film is filtered by when it can be seen, not by its release date.
        if (inWindow(engagements[0].nextDate)) screenings.push({ movie, engagements });
      } else if (inWindow(movie.releaseDate)) {
        pending.push(movie);
      }
    }
    screenings.sort((left, right) => left.engagements[0].nextDate.localeCompare(right.engagements[0].nextDate) || String(left.engagements[0].nextTime ?? "9").localeCompare(String(right.engagements[0].nextTime ?? "9")) || tierRank(left.movie.tasteTier) - tierRank(right.movie.tasteTier));
    pending.sort((left, right) => tierRank(left.tasteTier) - tierRank(right.tasteTier) || String(left.releaseDate).localeCompare(String(right.releaseDate)));
    return { confirmed: screenings, watchlist: pending };
  }, [generated, movies, todayKey, windowFilter]);
  const displayedWatchlist = showAll ? watchlist : watchlist.slice(0, 6);
  const hasResults = confirmed.length + watchlist.length > 0;
  return (
    <section className="movieSection" id="movies">
      <div className="movieIntro">
        <div>
          <p className="eyebrow">Second vertical · movies</p>
          <h2>Theatrical candidates.<br />Format decides.</h2>
        </div>
        <p>TMDB narrows upcoming releases against a film profile. A film stays on the watchlist until a reviewed, sourced confirmation names the theater, the presentation, and the dates. Only then is it something to plan around.</p>
      </div>

      <div className="movieControls">
        <div className="dateFilterGroup" aria-label="Movie date filter">
          {([['all', 'All dates'], ['soon', 'Next 30 days'], ['later', 'Later']] as const).map(([value, label]) => <button aria-pressed={windowFilter === value} className={windowFilter === value ? "filterActive" : ""} key={value} onClick={() => { setWindowFilter(value); setShowAll(false); }} type="button">{label}</button>)}
        </div>
        <span className="resultCount">{confirmed.length} confirmed · {displayedWatchlist.length} of {watchlist.length} watchlist</span>
      </div>
      {hasResults ? (
        <div className="movieGroups">
          <section className="movieGroup movieGroupConfirmed" aria-label="Confirmed screenings">
            <div className="movieGroupHeader movieGroupSplit">
              <p className="eyebrow">Confirmed screenings</p>
              <p className="movieGroupNote">Theater, format, and dates verified at a linked source.</p>
            </div>
            {confirmed.length ? (
              <div className="movieGrid" data-stagger="">
                {confirmed.map(({ movie, engagements }) => <ScreeningCard engagements={engagements} key={movie.id} movie={movie} todayKey={todayKey} />)}
              </div>
            ) : (
              <p className="movieConfirmedEmpty">No screening is confirmed in this window. Nothing below is bookable on this evidence yet.</p>
            )}
          </section>
          {watchlist.length ? <section className="movieGroup movieGroupWatchlist" aria-label="Watchlist, format not yet confirmed">
            <div className="movieGroupHeader movieGroupSplit">
              <p className="eyebrow">Watchlist · format not yet confirmed</p>
              <p className="movieGroupNote">A release date is not a local engagement.</p>
            </div>
            <div className="movieGrid" data-stagger="">
              {displayedWatchlist.map((movie) => <MovieCard key={movie.id} movie={movie} />)}
            </div>
          </section> : null}
        </div>
      ) : (
        <div className="movieEmpty">
          <p className="eyebrow">Source status · {tmdbStatus}</p>
          <h3>No movie cards are being guessed into the list.</h3>
          <p>Once TMDB is connected, only the refined film-profile shortlist will render here.</p>
        </div>
      )}
      {watchlist.length > 6 ? <button className="showMore" onClick={() => setShowAll((value) => !value)} type="button">{showAll ? "Show first 6" : `Show all ${watchlist.length} watchlist films`}</button> : null}
      <p className="tmdbAttribution">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </section>
  );
}

function tierRank(tier: Movie["tasteTier"]) {
  return tier === "strong" ? 0 : tier === "potential" || tier == null ? 1 : 2;
}

const TIER_LABELS = { strong: "Strong fit", potential: "Potential fit", stretch: "Stretch" } as const;

// Watchlist card: a TMDB candidate with no live confirmation. It never shows a
// theater or format, whatever an older projection claimed.
function MovieCard({ movie }: { movie: Movie }) {
  const date = movie.releaseDate ? new Date(`${movie.releaseDate}T12:00:00`) : null;
  const tier = movie.tasteTier ?? "potential";
  return <article className="movieCard rv">
    <RecommendationVisual className="movieMedia" visual={movie.visual} />
    <div className="movieCardContent">
      <div className="movieMeta"><span>{date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Date TBD"}</span><span>Format watch</span></div>
      <h3>{movie.title}</h3>
      <p className="movieCredits">{movie.directors.length ? `Directed by ${movie.directors.join(", ")}` : "Director metadata pending"}{movie.runtimeMinutes ? ` · ${movie.runtimeMinutes} min` : ""}</p>
      <p>{movie.reasons[0] ?? movie.overview}</p>
      <div className="movieScore"><span>Taste tier</span><strong className={`tier-${tier}`}>{TIER_LABELS[tier]}</strong></div>
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

function ScreeningCard({ movie, engagements, todayKey }: { movie: Movie; engagements: LiveEngagement[]; todayKey: string }) {
  const headline = headlineEngagement(engagements) ?? engagements[0];
  // Taste fit is reported as measured; a confirmed run does not upgrade it.
  const tier = movie.tasteTier ?? "potential";
  return <article className="movieCard movieConfirmed movieScreening rv">
    <RecommendationVisual className="movieMedia" visual={movie.visual} />
    <div className="movieCardContent">
      <div className="movieMeta"><span className="movieNext">{nextLabel(headline, todayKey)}</span><span>{headline.format}</span></div>
      <h3>{movie.title}</h3>
      <p className="movieCredits">{movie.directors.length ? `Directed by ${movie.directors.join(", ")}` : "Director metadata pending"}{movie.runtimeMinutes ? ` · ${movie.runtimeMinutes} min` : ""}</p>
      <p>{movie.reasons[0] ?? movie.overview}</p>
      <ul className="movieEngagements" aria-label={`Confirmed screenings of ${movie.title}`}>
        {engagements.map((engagement) => <EngagementRow engagement={engagement} key={`${engagement.theater}|${engagement.format}|${engagement.startDate}`} />)}
      </ul>
      <div className="movieScore"><span>Taste tier</span><strong className={`tier-${tier}`}>{TIER_LABELS[tier]}</strong></div>
      <div className="movieCardFooter">
        <CardActions
          calendarEvent={calendarInputFrom({
            id: movie.id,
            title: `${movie.title} · ${headline.format}`,
            startLocal: headline.nextTime,
            releaseDate: headline.nextDate,
            venue: { name: headline.theater },
            description: headline.note ?? movie.reasons[0] ?? movie.overview,
            sourceUrl: headline.sourceUrl,
          })}
          layout="movie"
          planning={moviePlanningInput(movie, todayKey)}
        />
        <a href={movie.sourceUrl} rel="noreferrer" target="_blank">Details <span aria-hidden="true">→</span></a>
      </div>
    </div>
  </article>;
}

function EngagementRow({ engagement }: { engagement: LiveEngagement }) {
  const days = showtimesByDay(engagement.showtimes);
  const shownDays = days.slice(0, 3);
  const hiddenCount = days.slice(3).reduce((total, day) => total + day.times.length, 0);
  const confirmedKey = dateKeyOf(engagement.confirmedAt);
  return <li className="movieEngagement">
    <p className="movieEngagementHead"><strong>{engagement.theater}</strong><span>{engagement.format}</span></p>
    <p className="movieEngagementDates">{runLabel(engagement)}</p>
    {shownDays.length ? <ul className="movieShowtimes" aria-label="Published showtimes">
      {shownDays.map((day) => <li key={day.dateKey}><span>{formatDay(day.dateKey)}</span>{day.times.map((time) => <b key={time}>{formatTime(time)}</b>)}</li>)}
      {hiddenCount ? <li className="movieShowtimesMore">+{hiddenCount} more at the source</li> : null}
    </ul> : <p className="movieEngagementQuiet">Showtimes not published · check the source before going</p>}
    {engagement.note ? <p className="movieEngagementNote">{engagement.note}</p> : null}
    <p className="movieEngagementFoot">
      <a className="movieEngagementSource" href={engagement.sourceUrl} rel="noreferrer" target="_blank">Confirmed at source <span aria-hidden="true">→</span></a>
      <span className="movieEngagementQuiet">{confirmedKey ? `Checked ${formatDay(confirmedKey, false)}` : "Reviewed"}{engagement.expiryKey ? ` · recheck after ${formatDay(engagement.expiryKey, false)}` : ""}</span>
    </p>
  </li>;
}

// Soonest premium engagement, else the soonest one (mirrors the export).
function headlineEngagement(engagements: LiveEngagement[]): LiveEngagement | null {
  return engagements.find((engagement) => engagement.premium ?? engagement.format !== "Standard") ?? engagements[0] ?? null;
}

function nextLabel(engagement: LiveEngagement, todayKey: string) {
  if (engagement.basis === "showtime" && engagement.nextTime) return `${formatDay(engagement.nextDate)} · ${formatTime(engagement.nextTime)}`;
  if (engagement.basis === "run-in-progress") return "Now showing";
  return engagement.nextDate === todayKey ? "Opens today" : `Opens ${formatDay(engagement.nextDate)}`;
}

function runLabel(engagement: LiveEngagement) {
  const endKey = dateKeyOf(engagement.endDate);
  if (!endKey) return `From ${formatDay(engagement.startDate)} · end date not published`;
  if (endKey === engagement.startDate) return `${formatDay(engagement.startDate)} only`;
  return `${formatDay(engagement.startDate)} – ${formatDay(endKey)}`;
}

function showtimesByDay(showtimes: string[]) {
  const days: Array<{ dateKey: string; times: string[] }> = [];
  for (const showtime of showtimes) {
    const dateKey = showtime.slice(0, 10);
    const last = days[days.length - 1];
    if (last?.dateKey === dateKey) last.times.push(showtime);
    else days.push({ dateKey, times: [showtime] });
  }
  return days;
}

// A bare YYYY-MM-DD is already a local day; a timestamp is converted to one.
function dateKeyOf(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return DATE_KEY.test(text) ? text : localDateKey(text);
}

function formatDay(dateKey: string, weekday = true) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", weekday ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
}

// Formats the wall-clock components directly; no Date, so no zone shift.
function formatTime(showtime: string) {
  const hour = Number(showtime.slice(11, 13));
  const minute = showtime.slice(14, 16);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}
