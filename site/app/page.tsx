import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { loadProjection } from "./data/projection";
import { Reveal } from "./reveal";
import { VerticalShell } from "./vertical-shell";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { ProfileAccessError, profileScopeForUser, resolveProfile, type ProfileScope } from "../server/profiles";
import { HostedConnections } from "./hosted-connections";
import { deploymentEnvironment } from "../server/release";
import type { ChangesSinceRefresh } from "./changes-strip";
import type { EventItem } from "./event-explorer";
import type { RecommendationHistoryItem } from "./feedback-store";
import type { Movie } from "./movie-explorer";
import type { Editorial, OverviewItem } from "./overview-explorer";
import type { SportsGame } from "./sports-explorer";
import type { TasteProfile } from "./taste-explorer";

export const metadata: Metadata = {
  title: "Taste Engine — Upcoming",
  description: "A private, ranked view of the music, movies, and Dodgers games worth leaving home for.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user && !["local", "test"].includes(deploymentEnvironment())) return <SignInRequired />;
  let profile: ProfileScope | null = null;
  if (user) {
    try {
      profile = await resolveProfile(user);
    } catch (error) {
      if (error instanceof ProfileAccessError) throw error;
      // D1 outages may use the bundled projection only for the explicitly
      // configured original profile. Authorization failures never bypass D1.
      profile = await profileScopeForUser(user);
    }
  }
  const upcoming = await loadProjection(profile ? {
    id: profile.id,
    allowBundledFallback: profile.legacyDefault,
  } : null);
  if (!upcoming) return <ProfileOnboarding displayName={profile?.displayName ?? "your profile"} />;
  const projection = upcoming as unknown as ProjectionView;
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
          {profile ? <span>Profile · {profile.displayName}</span> : null}
          <span className="liveDot">Refreshed {new Date(projection.generatedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" })}</span>
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
          <p className="projectionUtility"><span><b data-count={projection.events.length + movies.length + sports.length}>{projection.events.length + movies.length + sports.length}</b> ranked candidates</span><span aria-hidden="true">·</span><span><b data-count={projection.expandedArtistCount ?? projection.sourceArtistCount}>{projection.expandedArtistCount ?? projection.sourceArtistCount}</b> taste signals</span><span aria-hidden="true">·</span><span><b data-count={projection.horizon.days}>{projection.horizon.days}</b>-day horizon</span></p>
        </div>
      </section>

      <VerticalShell
        changesSinceRefresh={projection.changesSinceRefresh ?? null}
        allowLegacyStorageMigration={profile?.legacyDefault ?? true}
        events={projection.events}
        editorial={projection.editorial}
        featuredInterestThreshold={projection.sportsConfig?.featuredInterestThreshold ?? 70}
        generatedAt={projection.generatedAt}
        movies={movies}
        overview={overview}
        overviewPlanAhead={projection.overviewPlanAhead ?? []}
        recentHistory={projection.recentHistory ?? []}
        sports={sports}
        storageProfileId={profile?.id ?? null}
        tasteProfile={projection.tasteProfile ?? null}
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
            <strong>Retrieve</strong><p>Music comes from independent SeatGeek, Ticketmaster, and Framework paths. Insomniac remains explicitly unavailable until its adapter is verified. MLB defines Dodgers games; TMDB keeps a refined theatrical film shortlist.</p>
          </li>
          <li className="methodStep">
            <span className="methodNode">03</span>
            <strong>Join &amp; rank</strong><p>Duplicates collapse across providers, while fit, interest, hassle, urgency, and confidence stay separate. A ticket source can enrich a game without becoming its identity.</p>
          </li>
          <li className="methodStep">
            <span className="methodNode">04</span>
            <strong>Explain</strong><p>Deterministic scores make the call. Source-grounded Jev characterization may clarify an event card, and Ollama may add concise editorial prose from explicitly allowed fields. Neither can add candidates, change rankings, or make unsupported scarcity claims.</p>
          </li>
        </ol>
      </section>

      <section className="sourceNote">
        <p className="eyebrow"><span className="lit">Taste health</span></p>
        <div className="sourceNoteGrid">
          <div>
            <h2>{projection.sourcePlaylistCount} source playlists anchor three bounded verticals.</h2>
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

function ProfileOnboarding({ displayName }: { displayName: string }) {
  return <main>
    <header className="masthead">
      <a className="wordmark" href="#top" aria-label="Taste Engine home"><span>TASTE</span><span>ENGINE</span></a>
      <div className="mastheadMeta"><span>Profile · {displayName}</span></div>
    </header>
    <section className="projectionHero" id="top">
      <div><p className="kicker">Private profile</p><h1>Connect your own taste signals.</h1></div>
      <div className="projectionAside">
        <p>This profile starts empty so another person’s Spotify evidence and recommendations never become yours.</p>
        <p><a href="/api/spotify/connect">Connect Spotify</a>, select the playlists that represent you, then run the hosted refresh from the Taste tab.</p>
      </div>
    </section>
    <section className="engineNotes"><HostedConnections /></section>
  </main>;
}

function SignInRequired() {
  return <main>
    <header className="masthead"><span className="wordmark"><span>TASTE</span><span>ENGINE</span></span></header>
    <section className="projectionHero" id="top">
      <div><p className="kicker">Private by design</p><h1>Sign in to select your taste profile.</h1></div>
      <div className="projectionAside"><p>Recommendation and Spotify state are selected only from the authenticated ChatGPT identity.</p><p><a href={chatGPTSignInPath("/")} target="_top">Sign in with ChatGPT</a></p></div>
    </section>
  </main>;
}

type SourceHealth = { source: string; status: string; itemCount: number; warningCount: number; details?: Record<string, string | number | null> };

type ProjectionView = {
  changesSinceRefresh?: ChangesSinceRefresh | null;
  editorial?: Editorial;
  events: EventItem[];
  expandedArtistCount?: number;
  generatedAt: string;
  horizon: { days: number };
  movies?: Movie[];
  overview?: OverviewItem[];
  overviewPlanAhead?: OverviewItem[];
  priorityTheaters?: Array<{ name: string; formats: string[] }>;
  recentHistory?: RecommendationHistoryItem[];
  sourceArtistCount: number;
  sourceHealth?: SourceHealth[];
  sourcePlaylistCount: number;
  sports?: SportsGame[];
  sportsConfig?: { featuredInterestThreshold?: number };
  tasteProfile?: TasteProfile | null;
};

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
  if (["seatgeek", "ticketmaster", "framework", "framework-artists", "insomniac", "edmtrain", "jev-events", "ollama-events", "spotify-top-artists"].includes(source)) return "Music";
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
    "jev-events": "Jev event characterization",
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
  if (details.evidenceCount != null || details.modelEligibleCount != null) {
    return `${Number(details.evidenceCount ?? 0)} evidenced · ${Number(details.modelEligibleCount ?? 0)} model-eligible`;
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
