import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { loadProjection } from "./data/projection";
import { Reveal } from "./reveal";
import { VerticalShell } from "./vertical-shell";

export const metadata: Metadata = {
  title: "Taste Engine — Upcoming",
  description: "A private, ranked view of the music, movies, and Dodgers games worth leaving home for.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const upcoming = await loadProjection();
  const projection = upcoming as typeof upcoming & {
    overview?: any[];
    overviewPlanAhead?: any[];
    recentHistory?: any[];
    sports?: any[];
    sportsConfig?: { featuredInterestThreshold?: number };
    sportsEnhancement?: { mode: string; model: string | null; enhancedGameCount: number };
    movies?: any[];
    sourceHealth?: Array<{
      source: string;
      status: string;
      itemCount: number;
      warningCount: number;
      details?: Record<string, string | null>;
    }>;
    priorityTheaters?: Array<{ name: string; formats: string[] }>;
    editorial?: {
      mode: string;
      status: string;
      headline: string;
      verdict: string;
      lead: string;
      decisionNotes: string[];
      skipCall: string;
      caution: string;
    };
  };
  const movies = projection.movies ?? [];
  const sports = projection.sports ?? [];
  const overview = projection.overview ?? [];
  const sourceHealth = projection.sourceHealth ?? [];
  const healthSummary = summarizeSourceHealth(sourceHealth);
  const tmdbStatus = sourceHealth.find((source) => source.source === "tmdb")?.status ?? "not configured";
  return (
    <main>
      <Reveal />
      <header className="masthead">
        <a className="wordmark" href="#top" aria-label="Taste Engine home">
          <span>TASTE</span>
          <span>ENGINE</span>
        </a>
        <div className="mastheadMeta">
          <span className="mastheadLocation">Los Angeles</span>
          <span className="liveDot">Refreshed {new Date(upcoming.generatedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" })}</span>
          <a className="mastheadNotes" href="#engine-notes">Engine notes ↓</a>
        </div>
      </header>

      <section className="projectionHero" id="top">
        <div className="rv">
          <p className="kicker">The projection</p>
          <h1>One taste engine.<br />Several ways out.</h1>
        </div>
        <div className="projectionAside rv">
          <p>
          Start with the short list, then switch verticals without losing the
          timing lens. Music remains the primary learned taste signal; films
          and Dodgers games stay legible, bounded, and explainable.
          </p>
          <p className="projectionUtility"><span><b data-count={upcoming.events.length + movies.length + sports.length}>{upcoming.events.length + movies.length + sports.length}</b> ranked candidates</span><span aria-hidden="true">·</span><span><b data-count={(upcoming as { expandedArtistCount?: number }).expandedArtistCount ?? upcoming.sourceArtistCount}>{(upcoming as { expandedArtistCount?: number }).expandedArtistCount ?? upcoming.sourceArtistCount}</b> taste signals</span><span aria-hidden="true">·</span><span><b data-count={upcoming.horizon.days}>{upcoming.horizon.days}</b>-day horizon</span></p>
        </div>
      </section>

      <VerticalShell
        changesSinceRefresh={(projection as { changesSinceRefresh?: unknown }).changesSinceRefresh ?? null}
        events={upcoming.events}
        editorial={projection.editorial}
        featuredInterestThreshold={projection.sportsConfig?.featuredInterestThreshold ?? 70}
        generatedAt={upcoming.generatedAt}
        movies={movies}
        overview={overview}
        overviewPlanAhead={projection.overviewPlanAhead ?? []}
        recentHistory={projection.recentHistory ?? []}
        sports={sports}
        tasteProfile={(projection as { tasteProfile?: never }).tasteProfile ?? null}
        tmdbStatus={tmdbStatus}
      />

      <section className="engineNotes" id="engine-notes" aria-label="Engine notes">
      <section className="sourceHealth" id="source-health">
        <p className="eyebrow"><span className="lit">Source health</span></p>
        <div className="sourceHealthIntro">
          <h2>{healthSummary}</h2>
          <p className="sourceHealthHint">The full provenance ledger stays available. Degraded lanes open first so a healthy refresh does not consume the Overview.</p>
        </div>
        <div className="sourceHealthList board rv">
          {groupSourceHealth(sourceHealth).map((group) => (
            <details className="sourceHealthGroup boardGroup" key={group.label} open={group.sources.some((source) => source.status !== "active")}>
              <summary className="boardGroupHead"><strong>{group.label}</strong><span>{group.sources.length} source{group.sources.length === 1 ? "" : "s"}</span></summary>
              <div className="sourceHealthGroupBody">
                {group.sources.map((source) => {
                  const width = sourceBarWidth(source.itemCount, group.sources);
                  const statusClass = source.status === "active" ? "" : source.status === "partial" ? "partial" : "down";
                  return <div className={`srcRow ${source.warningCount || source.status === "partial" ? "warn" : ""}`.trim()} key={source.source}>
                    <span aria-hidden="true" className={`led ${statusClass}`.trim()} />
                    <strong className="srcName">{sourceLabel(source.source)}<small className="sourceMobileStatus">{source.status}</small></strong>
                    <span className="srcCount">{source.itemCount} item{source.itemCount === 1 ? "" : "s"}</span>
                    <span className="srcBar" style={{ "--source-width": `${width}%` } as CSSProperties}><i /></span>
                    <small className={`srcNote sourceStatus status-${source.status.replaceAll(" ", "-")}`}>
                      {source.warningCount || source.status !== "active" ? <em>{formatSourceNote(source)}</em> : formatSourceNote(source)}
                    </small>
                  </div>
                })}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="method">
        <p className="eyebrow"><span className="lit">How it thinks</span></p>
        <div className="methodIntro">
          <h2>Preference first.<br />Friction second.</h2>
          <p>Deterministic scores make the call. Model-generated editorial enrichment can clarify it, but never becomes the source of truth.</p>
        </div>
        <ol className="methodSteps methodRail">
          <li className="methodStep">
            <span className="methodNode">01</span>
            <strong>Listen</strong><p>Selected playlists and the three Spotify Top Artists windows become replaceable revealed-preference evidence; Last.fm adds constrained similarity and tag neighborhoods without pretending they are direct taste.</p>
          </li>
          <li className="methodStep">
            <span className="methodNode">02</span>
            <strong>Retrieve</strong><p>Music comes from independent SeatGeek, Ticketmaster, Framework, and Insomniac paths. MLB defines Dodgers games; TMDB keeps a refined theatrical film shortlist.</p>
          </li>
          <li className="methodStep">
            <span className="methodNode">03</span>
            <strong>Join &amp; rank</strong><p>Duplicates collapse across providers, while fit, interest, hassle, urgency, and confidence stay separate. A ticket source can enrich a game without becoming its identity.</p>
          </li>
          <li className="methodStep">
            <span className="methodNode">04</span>
            <strong>Explain</strong><p>Deterministic scores make the call. Ollama editorial enrichment may add concise prose and advisories from explicitly allowed non-Spotify fields, but it cannot add candidates, change rankings, or make unsupported scarcity claims.</p>
          </li>
        </ol>
      </section>

      <section className="sourceNote">
        <p className="eyebrow"><span className="lit">Taste health</span></p>
        <div className="sourceNoteGrid">
          <div>
            <h2>{upcoming.sourcePlaylistCount} source playlists anchor three bounded verticals.</h2>
          <p>
            Music remains the learned center of gravity, with current Spotify
            affinity kept as replaceable cache evidence rather than a permanent
            listening history. Movies are refined by
            film-profile evidence and theater-format confirmation; Dodgers games
            are grounded in MLB schedule and standings data, with ticket sources
            attached only when they match cleanly.
          </p>
          </div>
          <div>
          <p>
            The seed is intentionally editable. Add representative playlists as
            your taste shifts, then refresh the projection. After each outing, a
            quick worth-it check-in is the feedback loop that can change future fit.
          </p>
          {projection.priorityTheaters?.length ? (
            <p className="theaterList"><strong>Premium-format watch</strong><span>{projection.priorityTheaters.map((theater) => theater.name).join(" · ")}</span></p>
          ) : null}
          </div>
        </div>
      </section>
      <section className="tmdbCredits" aria-label="TMDB credits">
        <p className="eyebrow">Credits</p>
        <div className="tmdbCreditsBody">
          <a href="https://www.themoviedb.org" rel="noreferrer" target="_blank">
            <img src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" loading="lazy" />
          </a>
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        </div>
      </section>
      </section>

      <footer>
        <span>Taste Engine</span>
        <span className="sig">Private, personal, explainable.</span>
      </footer>
    </main>
  );
}

type SourceHealth = { source: string; status: string; itemCount: number; warningCount: number; details?: Record<string, string | number | null> };

function groupSourceHealth(sources: SourceHealth[]) {
  const order = ["Music", "Sports", "Movies", "Editorial", "Other"];
  const groups = new Map(order.map((label) => [label, [] as typeof sources]));
  for (const source of sources) {
    const category = sourceCategory(source.source);
    groups.get(category)?.push(source);
  }
  return order.map((label) => ({
    label,
    sources: (groups.get(label) ?? []).sort((left, right) => Number(left.status === "active") - Number(right.status === "active") || left.source.localeCompare(right.source))
  })).filter((group) => group.sources.length);
}

function summarizeSourceHealth(sources: SourceHealth[]) {
  const healthy = sources.filter((source) => source.status === "active").length;
  const degraded = sources.filter((source) => source.status !== "active" && source.status !== "unavailable").length;
  const blockers = sources.filter((source) => source.status === "unavailable").length;
  return `${healthy} healthy · ${degraded + blockers} degraded · ${blockers ? `${blockers} blocker${blockers === 1 ? "" : "s"}` : "no blockers"}`;
}

function sourceCategory(source: string) {
  if (["seatgeek", "ticketmaster", "framework", "framework-artists", "insomniac", "edmtrain", "ollama-events", "spotify-top-artists"].includes(source)) return "Music";
  if (["mlb", "sports-seatgeek", "sports-ticketmaster", "ollama-sports"].includes(source)) return "Sports";
  if (source === "tmdb") return "Movies";
  if (source === "ollama" || source === "ollama-overview") return "Editorial";
  return "Other";
}

function sourceLabel(source: string) {
  return ({
    seatgeek: "SeatGeek events",
    ticketmaster: "Ticketmaster music",
    framework: "Framework events",
    "framework-artists": "Framework artist roster",
    edmtrain: "EDMTrain lineup enrichment",
    insomniac: "Insomniac events",
    "ollama-events": "Ollama music advisories",
    "spotify-top-artists": "Spotify Top Artists",
    mlb: "MLB schedule",
    "sports-seatgeek": "SeatGeek sports tickets",
    "sports-ticketmaster": "Ticketmaster sports tickets",
    "ollama-sports": "Ollama sports advisories",
    tmdb: "TMDB film candidates",
    ollama: "Ollama editorial brief",
    "ollama-overview": "Ollama overview queue"
  } as Record<string, string>)[source] ?? source;
}

function sourceBarWidth(items: number, sources: SourceHealth[]) {
  const maxItems = Math.max(0, ...sources.map((source) => source.itemCount));
  if (maxItems === 0) return 0;
  return Math.round(100 * Math.min(1, Math.log10(1 + items) / Math.log10(1 + maxItems)));
}

function formatSourceNote(source: SourceHealth) {
  const warnings = source.warningCount ? `${source.warningCount} warning${source.warningCount === 1 ? "" : "s"}` : "clean";
  const details = source.details ? ` · ${formatSourceDetails(source.details)}` : "";
  return `${source.status} · ${warnings}${details}`;
}

function formatSourceDetails(details: Record<string, string | number | null>) {
  if (details.matchedEvents != null) {
    return `${details.matchedEvents} matched · ${details.lineupArtists ?? 0} lineup artists · ${details.ambiguousMatches ?? 0} ambiguous`;
  }
  if (details.reusedPasses != null) {
    return Number(details.reusedPasses) > 0 ? `${details.reusedPasses} prior passes retained across ${details.reusedItems ?? 0} unchanged items` : "no prior passes needed";
  }
  const windows = [
    ["shortTerm", "short"],
    ["mediumTerm", "medium"],
    ["longTerm", "long"]
  ]
    .map(([key, label]) => details[key] ? `${label}: ${details[key]}` : null)
    .filter(Boolean);
  const refreshed = details.lastSuccessfulRefresh ? ` · refreshed ${formatHealthDate(details.lastSuccessfulRefresh)}` : "";
  const expiry = details.cacheExpiry ? ` · expires ${formatHealthDate(details.cacheExpiry)}` : "";
  return `${windows.join(" · ")}${refreshed}${expiry}` || "window detail unavailable";
}

function formatHealthDate(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" });
}
