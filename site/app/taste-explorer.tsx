"use client";

import { useState } from "react";
import { useFeedback } from "./feedback-context";
import { HostedConnections } from "./hosted-connections";
import type { FeedbackStatus, HistoryQueueEntry } from "./feedback-store";

export type TasteProfile = {
  generatedAt: string;
  seedSummary: { playlistCount: number; sourceArtistCount: number; topArtistCount: number; artistCount: number };
  topArtists: Array<{ name: string; relativeSignal: number; playlistDiversity: number; seedTrackCount: number; origin: string; evidenceLabels: string[] }>;
  topTags: string[];
  expansionByOrigin: Record<string, number>;
  feedback: { statusCounts: Record<string, number>; attendedCount: number } | null;
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  "attended-worth-it": "Went — worth it",
  "attended-not-worth-it": "Went — not worth it",
  "skipped-still-interested": "Still interested",
  "skipped-no-longer-interested": "Not for me",
};

const ORIGIN_LABELS: Record<string, string> = {
  source: "Direct playlist evidence",
  "top-items": "Spotify top artists",
  similar: "Similar-artist discovery",
  tag: "Tag-cluster discovery",
  promoter: "Promoter calendars",
};

export function TasteExplorer({ profile }: { profile: TasteProfile | null }) {
  return (
    <section className="tasteSection" aria-label="Taste profile and feedback" id="taste-feed">
      <div className="tasteIntro">
        <div><p className="eyebrow">Your timeline</p><h2>Plans, recommendations, and outcomes.</h2></div>
        <p>Make plans now, then answer only the check-ins that carry a real taste signal. Missing an event is never treated as dislike.</p>
      </div>

      <UpcomingSaves />
      <RecentRecommendations />
      <HostedConnections />

      <section className="tasteBlock" aria-labelledby="taste-profile-title">
        <div className="tasteBlockHeading"><p className="eyebrow">Taste profile</p><h3 id="taste-profile-title">What the engine has learned.</h3></div>
        {profile ? <><ProfilePanels profile={profile} /><ImportedHistory profile={profile} /></> : (
          <div className="tasteEmpty"><h3>The taste profile ships with the next refresh.</h3><p>Planning and recent recommendation check-ins still work on this device.</p></div>
        )}
      </section>

      <FeedbackSync />
    </section>
  );
}

function UpcomingSaves() {
  const feedback = useFeedback();
  const upcoming = feedback?.upcoming ?? [];
  return (
    <section className="tasteBlock" aria-labelledby="upcoming-saves-title">
      <div className="tasteBlockHeading"><p className="eyebrow">Upcoming saves</p><h3 id="upcoming-saves-title">Dates you meant to keep.</h3></div>
      {upcoming.length ? <div className="timelineList">{upcoming.map((item) => (
        <article className="timelineRow" key={item.itemId}>
          <div><strong>{item.currentSnapshot.title}</strong><span>{item.currentSnapshot.dateLocal}{item.currentSnapshot.locationLabel ? ` · ${item.currentSnapshot.locationLabel}` : ""}</span></div>
          <p>{item.saved && item.held ? "Saved · calendar held" : item.held ? "Calendar held" : "Saved"}</p>
        </article>
      ))}</div> : <p className="tasteQuietEmpty">Nothing saved or held right now.</p>}
    </section>
  );
}

function RecentRecommendations() {
  const feedback = useFeedback();
  const queue = feedback?.queue ?? [];
  return (
    <section className="tasteBlock" aria-labelledby="recent-recommendations-title">
      <div className="tasteBlockHeading"><p className="eyebrow">Recent recommendations</p><h3 id="recent-recommendations-title">Did any of these happen?</h3></div>
      {queue.length ? <div className="timelineList">{queue.map((entry) => <RecentRecommendation entry={entry} key={entry.history.historyId} />)}</div>
        : <p className="tasteQuietEmpty">No recent recommendations are waiting for you.</p>}
    </section>
  );
}

function RecentRecommendation({ entry }: { entry: HistoryQueueEntry }) {
  const feedback = useFeedback();
  const [step, setStep] = useState<"attendance" | "worth">("attendance");
  const [confirmingNegative, setConfirmingNegative] = useState(false);
  const item = entry.history;
  return (
    <article className="timelineRow recentRecommendation">
      <div className="timelineCopy">
        <span className="timelineMeta">{item.vertical} · {item.dateLocal}{entry.planned ? " · saved or held" : ""}</span>
        <strong>{item.title}</strong>
        {item.locationLabel ? <span>{item.locationLabel}</span> : null}
      </div>
      {!entry.eligible ? <div className="checkInPrompt">
        <p>{item.vertical === "movies" ? "Movie history only for now." : "No feedback snapshot is available."}</p>
        <button onClick={() => feedback?.dismiss(item.historyId)} type="button">Dismiss</button>
      </div> : step === "attendance" ? <div className="checkInPrompt">
        <p><strong>Did you go?</strong></p>
        <div className="checkInOptions">
          <button onClick={() => setStep("worth")} type="button">Yes</button>
          <button onClick={() => feedback?.dismiss(item.historyId)} type="button">No</button>
          {!confirmingNegative ? <button className="quietAction" onClick={() => setConfirmingNegative(true)} type="button">Not for me</button> : null}
        </div>
        {confirmingNegative ? <div className="inlineConfirmation" role="group" aria-label="Confirm Not for me">
          <span>Create negative taste feedback?</span>
          <button onClick={() => feedback?.checkIn(item, "skipped-no-longer-interested")} type="button">Confirm</button>
          <button onClick={() => setConfirmingNegative(false)} type="button">Cancel</button>
        </div> : null}
      </div> : <div className="checkInPrompt">
        <p><strong>Was it worth it?</strong></p>
        <div className="checkInOptions">
          <button onClick={() => feedback?.checkIn(item, "attended-worth-it")} type="button">Yes</button>
          <button onClick={() => feedback?.checkIn(item, "attended-not-worth-it")} type="button">No</button>
          <button className="quietAction" onClick={() => setStep("attendance")} type="button">Back</button>
        </div>
      </div>}
    </article>
  );
}

function ProfilePanels({ profile }: { profile: TasteProfile }) {
  return <>
    <p className="tasteSummaryLine">{profile.seedSummary.playlistCount} source playlists · {profile.seedSummary.sourceArtistCount} seeded artists · {profile.seedSummary.topArtistCount} top-artist signals · {profile.seedSummary.artistCount} artists after expansion</p>
    <div className="tasteColumns">
      <div className="tasteArtists">
        <p className="eyebrow">Strongest signals</p><p className="tasteScaleNote">Relative signal within the current Taste Engine seed.</p>
        {profile.topArtists.map((artist) => <div className="tasteArtistRow" key={artist.name}>
          <div className="tasteArtistName"><strong>{artist.name}</strong>{artist.evidenceLabels.length ? <span>{artist.evidenceLabels.join(" · ")}</span> : null}</div>
          <div className="tasteArtistTrack"><span style={{ width: `${artist.relativeSignal}%` }} /></div>
        </div>)}
      </div>
      <div className="tasteMeta">
        <p className="eyebrow">Taste clusters</p><div className="tasteTags">{profile.topTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <p className="eyebrow">Where candidates come from</p>
        <ul className="tasteOrigins">{Object.entries(profile.expansionByOrigin).map(([origin, count]) => <li key={origin}><strong>{count}</strong> {ORIGIN_LABELS[origin] ?? origin}</li>)}</ul>
      </div>
    </div>
  </>;
}

function ImportedHistory({ profile }: { profile: TasteProfile }) {
  const counts = Object.entries(profile.feedback?.statusCounts ?? {}).filter(([, count]) => count > 0);
  return <details className="importedHistory"><summary>Imported outcome history</summary>
    {counts.length ? <ul>{counts.map(([status, count]) => <li key={status}><strong>{count}</strong> {STATUS_LABELS[status as FeedbackStatus] ?? status}</li>)}</ul>
      : <p>No imported outcomes yet.</p>}
  </details>;
}

function FeedbackSync() {
  const feedback = useFeedback();
  const unexported = feedback?.unexportedCount ?? 0;
  const hosted = feedback?.persistence === "hosted";
  return (
    <section className="tasteBlock feedbackSync" aria-labelledby="feedback-sync-title">
      <div className="tasteBlockHeading"><p className="eyebrow">Feedback sync</p><h3 id="feedback-sync-title">{hosted ? "Stored with Taste Engine." : "Device fallback is active."}</h3></div>
      <p>{hosted
        ? "Plans and outcomes persist in the private hosted database and follow your ChatGPT sign-in."
        : unexported
          ? `${unexported} new outcome${unexported === 1 ? "" : "s"} ready to export.`
          : "This browser has no feedback waiting to export."}</p>
      {feedback?.persistenceError ? <small>{feedback.persistenceError}</small> : null}
      {!hosted ? <div className="checkInOptions">
        <button disabled={!unexported} onClick={() => feedback?.exportNew()} type="button">Export feedback</button>
        {feedback?.hasTriggeredBatch ? <button onClick={() => feedback.redownloadLast()} type="button">Re-download last</button> : null}
        {feedback?.hasTriggeredBatch ? <button className="quietAction" onClick={() => feedback.exportAll()} type="button">Export all</button> : null}
      </div> : null}
      <small>{hosted ? "No download-and-import loop is required." : "Downloaded feedback remains compatible with the guarded local refresh."}</small>
    </section>
  );
}
