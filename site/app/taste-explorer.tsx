"use client";

import { useState } from "react";
import { useFeedback } from "./feedback-context";
import { HostedConnections } from "./hosted-connections";
import { MissingRecommendation } from "./missing-recommendation";
import type { FeedbackReasonCode, FeedbackSignalTag, FeedbackStatus, HistoryQueueEntry } from "./feedback-store";
import { formatLocalDate } from "./local-date";
import { eventHref } from "./event-anchor";

export type LearnedSignal = { kind: "taste" | "friction"; category: string; label: string; direction: "up" | "down"; strength: number; delta: number; outcomes: number; lastDate: string | null };
// Computed live in the browser from the person's own records with the shared
// policy; nothing here comes from the published projection.
export type LiveLearning = {
  enabled: boolean;
  countedOutcomeCount: number;
  learned: LearnedSignal[];
  movedCount: number;
  shortlistChanged: boolean;
  movements: Array<{ id: string; title: string; scoreDelta: number; reason: string | null }>;
};

export type TasteProfile = {
  generatedAt: string;
  seedSummary: { playlistCount: number; sourceArtistCount: number; topArtistCount: number; artistCount: number };
  topArtists: Array<{ name: string; relativeSignal: number; signalContribution?: number; playlistDiversity: number; seedTrackCount: number; origin: string; signalKind?: "direct" | "inferred"; evidenceLabels?: string[]; labels?: string[] }>;
  topTags: string[];
  expansionByOrigin: Record<string, number>;
  feedback: { statusCounts: Record<string, number>; attendedCount: number } | null;
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  "attended-worth-it": "Went — worth it",
  "attended-not-worth-it": "Went — not worth it",
  "wanted-to-attend": "Wanted to attend",
  "lost-interest": "Lost interest",
  "did-not-attend-logistical": "Logistics prevented it",
  interested: "Interested ahead of time",
  withdrawn: "Withdrawn",
};

const ORIGIN_LABELS: Record<string, string> = {
  source: "Direct playlist evidence",
  "top-items": "Spotify top artists",
  similar: "Similar-artist discovery",
  tag: "Tag-cluster discovery",
  promoter: "Promoter calendars",
};

export function TasteExplorer({ profile, learning }: { profile: TasteProfile | null; learning: LiveLearning }) {
  return (
    <section className="tasteSection" aria-label="Taste profile and feedback" id="taste-feed">
      <div className="tasteIntro">
        <div><p className="eyebrow">Your timeline</p><h2>Plans, recommendations, and outcomes.</h2></div>
        <p>Make plans now, then answer only the check-ins that carry a real taste signal. Missing an event is never treated as dislike.</p>
      </div>

      <RecentRecommendations />
      <UpcomingSaves />
      <LearnedPanel learning={learning} />

      <section className="tasteBlock" aria-labelledby="taste-profile-title">
        <div className="tasteBlockHeading"><p className="eyebrow">Taste profile</p><h3 id="taste-profile-title">What the engine has learned.</h3></div>
        {profile ? <><ProfilePanels profile={profile} /><ImportedHistory profile={profile} /></> : (
          <div className="tasteEmpty"><h3>The taste profile ships with the next refresh.</h3><p>Planning and recent recommendation check-ins still work on this device.</p></div>
        )}
      </section>

      <HostedConnections />
      <MissingRecommendation />
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
          <div><strong>{item.currentSnapshot.title}</strong><span>{formatLocalDate(item.currentSnapshot.dateLocal, { weekday: "short", month: "short", day: "numeric" }) ?? item.currentSnapshot.dateLocal}{item.currentSnapshot.locationLabel ? ` · ${item.currentSnapshot.locationLabel}` : ""}</span></div>
          <p>{item.saved && item.held ? "Saved · calendar held" : item.held ? "Calendar held" : "Saved"}</p>
        </article>
      ))}</div> : <p className="tasteQuietEmpty">Nothing saved or held right now.</p>}
    </section>
  );
}

// Several dates of one run (five Prospa nights) are one question, not five.
function groupQueue(queue: HistoryQueueEntry[]) {
  const groups = new Map<string, HistoryQueueEntry[]>();
  for (const entry of queue) {
    const base = entry.history.title.replace(/\s*[([][^)\]]*[)\]]/g, "").trim().toLocaleLowerCase();
    const key = `${entry.history.vertical}|${entry.eligible ? base : entry.history.historyId}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()];
}

function RecentRecommendations() {
  const feedback = useFeedback();
  const groups = groupQueue(feedback?.queue ?? []);
  return (
    <section className="tasteBlock" aria-labelledby="recent-recommendations-title">
      <div className="tasteBlockHeading"><p className="eyebrow">Check-ins</p><h3 id="recent-recommendations-title">How did these go?</h3></div>
      {groups.length ? <div className="timelineList">{groups.map((group) => <RecentRecommendation entries={group} key={group[0].history.historyId} />)}</div>
        : <p className="tasteQuietEmpty">Nothing is waiting for a check-in.</p>}
    </section>
  );
}

const WORTH: Array<{ label: string; status: FeedbackStatus; rating: number }> = [
  { label: "Loved it", status: "attended-worth-it", rating: 5 },
  { label: "Worth it", status: "attended-worth-it", rating: 4 },
  { label: "Mixed", status: "attended-not-worth-it", rating: 3 },
  { label: "Regret", status: "attended-not-worth-it", rating: 1 },
];
const MADE_IT: Array<{ tag: FeedbackSignalTag; label: string }> = [
  { tag: "artist", label: "The artist" }, { tag: "production", label: "Sound & production" }, { tag: "crowd", label: "Crowd" }, { tag: "venue", label: "Venue" },
];
const MISSED: Array<{ code: FeedbackReasonCode; label: string }> = [
  { code: "calendar", label: "Had a conflict" }, { code: "availability", label: "Sold out" }, { code: "price", label: "Too pricey" }, { code: "distance", label: "Too far" }, { code: "timing", label: "Too late / wrong night" },
];
const LOST: Array<{ code: FeedbackReasonCode; label: string }> = [
  { code: "artist", label: "Cooled on the artist" }, { code: "lineup", label: "Lineup" }, { code: "venue", label: "Venue" }, { code: "other", label: "Just didn't feel like it" },
];

function RecentRecommendation({ entries }: { entries: HistoryQueueEntry[] }) {
  const feedback = useFeedback();
  const [step, setStep] = useState<"attendance" | "worth" | "detail" | "missed" | "lost">("attendance");
  const [worth, setWorth] = useState<(typeof WORTH)[number] | null>(null);
  const [tags, setTags] = useState<FeedbackSignalTag[]>([]);
  const [rough, setRough] = useState(false);
  const entry = entries[0];
  const item = entry.history;
  const dates = [...new Set(entries.map((each) => each.history.dateLocal))].sort();
  // One answer covers the whole run: record it once, and clear the other dates.
  const settle = (status: FeedbackStatus, reasons: FeedbackReasonCode[] = [], detail: { rating?: number; signalTags?: FeedbackSignalTag[] } = {}) => {
    feedback?.checkIn(item, status, reasons, detail);
    for (const other of entries.slice(1)) feedback?.dismiss(other.history.historyId);
  };
  const dismissAll = () => { for (const each of entries) feedback?.dismiss(each.history.historyId); };
  const toggle = (tag: FeedbackSignalTag) => setTags((list) => list.includes(tag) ? list.filter((value) => value !== tag) : [...list, tag]);
  return (
    <article className="timelineRow recentRecommendation">
      <div className="timelineCopy">
        <span className="timelineMeta">{item.vertical} · {dates.map((date) => formatLocalDate(date, { month: "short", day: "numeric" }) ?? date).join(", ")}{entries.some((each) => each.planned) ? " · saved or held" : ""}</span>
        <strong>{item.title.replace(/\s*[([][^)\]]*[)\]]/g, "")}</strong>
        {item.locationLabel ? <span>{item.locationLabel}</span> : null}
      </div>
      {!entry.eligible ? <div className="checkInPrompt">
        <p>{item.vertical === "movies" ? "Movie history only for now." : "No feedback snapshot is available."}</p>
        <button onClick={dismissAll} type="button">Dismiss</button>
      </div> : step === "attendance" ? <div className="checkInPrompt">
        <p><strong>Did you go?</strong></p>
        <div className="checkInOptions">
          <button className="checkInPrimary" onClick={() => setStep("worth")} type="button">I went</button>
          <button onClick={() => setStep("missed")} type="button">Wanted to, couldn&rsquo;t</button>
          <button onClick={() => setStep("lost")} type="button">Chose not to</button>
          <button className="quietAction" onClick={dismissAll} type="button">Skip</button>
        </div>
      </div> : step === "worth" ? <div className="checkInPrompt">
        <p><strong>Was it worth it?</strong></p>
        <div className="checkInOptions">
          {WORTH.map((option) => <button key={option.label} onClick={() => { setWorth(option); setStep("detail"); }} type="button">{option.label}</button>)}
          <button className="quietAction" onClick={() => setStep("attendance")} type="button">Back</button>
        </div>
      </div> : step === "detail" && worth ? <div className="checkInPrompt">
        <p><strong>{worth.rating >= 4 ? "What made it?" : "What let it down?"}</strong> <small>Optional — it tells the engine what to credit.</small></p>
        <div className="checkInOptions checkInChips">
          {MADE_IT.map((option) => <button aria-pressed={tags.includes(option.tag)} key={option.tag} onClick={() => toggle(option.tag)} type="button">{option.label}</button>)}
          <button aria-pressed={rough} onClick={() => setRough((value) => !value)} type="button">Rough next day</button>
        </div>
        <div className="checkInOptions">
          <button className="checkInPrimary" onClick={() => settle(worth.status, rough ? ["recovery"] : [], { rating: worth.rating, signalTags: tags })} type="button">Save {worth.label.toLocaleLowerCase()}</button>
          <button className="quietAction" onClick={() => setStep("worth")} type="button">Back</button>
        </div>
      </div> : step === "missed" ? <div className="checkInPrompt">
        <p><strong>What got in the way?</strong> <small>Never counted against the artist.</small></p>
        <div className="checkInOptions">
          {MISSED.map((option) => <button key={option.code} onClick={() => settle(option.code === "calendar" || option.code === "availability" ? "wanted-to-attend" : "did-not-attend-logistical", [option.code])} type="button">{option.label}</button>)}
          <button className="quietAction" onClick={() => setStep("attendance")} type="button">Back</button>
        </div>
      </div> : <div className="checkInPrompt">
        <p><strong>What changed?</strong></p>
        <div className="checkInOptions">
          {LOST.map((option) => <button key={option.code} onClick={() => settle("lost-interest", [option.code])} type="button">{option.label}</button>)}
          <button className="quietAction" onClick={() => setStep("attendance")} type="button">Back</button>
        </div>
      </div>}
    </article>
  );
}

const CATEGORY_LABELS: Record<string, string> = { artist: "Artist", venue: "Venue", promoter: "Promoter", shape: "Kind of night", opponent: "Opponent", weekday: "Day of week" };

// What your feedback has actually changed, in plain terms, with the evidence
// count beside each line so a single outcome never looks like a verdict.
function LearnedPanel({ learning }: { learning: LiveLearning }) {
  const feedback = useFeedback();
  const taste = learning.learned.filter((row) => row.kind === "taste");
  const friction = learning.learned.filter((row) => row.kind === "friction");
  const sync = feedback?.persistence === "hosted"
    ? feedback.syncState === "saving" ? "Saving…" : feedback.syncState === "retrying" ? "Saved here · syncing will retry" : "Saved to your profile"
    : "Saved on this device";
  return (
    <section className="tasteBlock learnedPanel" aria-labelledby="learned-title">
      <div className="tasteBlockHeading"><p className="eyebrow">From your feedback</p><h3 id="learned-title">What the engine has learned.</h3></div>
      <div className="learnedControl">
        <label className="learnedSwitch">
          <input checked={learning.enabled} disabled={!feedback?.ready} onChange={(event) => feedback?.setLearning(event.target.checked)} role="switch" type="checkbox" />
          <span>Use my feedback in the ranking</span>
        </label>
        <p className="learnedStatus" aria-live="polite">
          {learning.enabled
            ? learning.movedCount
              ? <><b>{learning.movedCount}</b> {learning.movedCount === 1 ? "date is" : "dates are"} moved right now{learning.shortlistChanged ? ", and the shortlist is different because of it" : "; the shortlist is unchanged"}.</>
              : learning.countedOutcomeCount ? "Nothing on the calendar is affected yet." : "Nothing to apply yet."
            : "Off. You are seeing the published order; everything below is still remembered."}
          <span className="learnedSync"> · {sync}</span>
        </p>
      </div>
      {learning.learned.length ? <>
        <p className="learnedNote">{learning.countedOutcomeCount} {learning.countedOutcomeCount === 1 ? "read or outcome" : "reads and outcomes"} counted. Each one moves a date by a few points at most, updates the moment you give it, and can be undone.</p>
        <div className="learnedColumns">
          {taste.length ? <div><p className="eyebrow">Taste</p>{taste.map((row) => <LearnedRow key={`${row.category}:${row.label}`} row={row} />)}</div> : null}
          {friction.length ? <div><p className="eyebrow">Friction</p>{friction.map((row) => <LearnedRow key={`f:${row.category}:${row.label}`} row={row} />)}</div> : null}
          {learning.movements.length ? <div><p className="eyebrow">Moved right now</p>{learning.movements.map((move) => <a className="learnedMove" href={eventHref(move.id)} key={move.id}>
            <span className="learnedLabel"><strong>{move.title}</strong>{move.reason ? <small>{move.reason}</small> : null}</span>
            <span className={`learnedDelta ${move.scoreDelta > 0 ? "up" : "down"}`}>{move.scoreDelta > 0 ? "+" : "−"}{Math.abs(move.scoreDelta).toFixed(1)}</span>
          </a>)}</div> : null}
        </div>
      </> : <p className="tasteQuietEmpty">Nothing yet. Triage a few upcoming dates or answer a check-in, and what it teaches shows up here straight away.</p>}
    </section>
  );
}

function LearnedRow({ row }: { row: LearnedSignal }) {
  const good = row.kind === "taste" ? row.direction === "up" : row.direction === "down";
  return <div className={`learnedRow ${good ? "learnedUp" : "learnedDown"}`}>
    <span className="learnedLabel"><strong>{row.label}</strong><small>{CATEGORY_LABELS[row.category] ?? row.category} · {row.outcomes} {row.outcomes === 1 ? "night" : "nights"}</small></span>
    <span aria-hidden="true" className="learnedBar"><i style={{ width: `${Math.max(8, Math.round(row.strength * 100))}%` }} /></span>
    <span className="learnedDelta">{row.kind === "friction" ? (row.direction === "up" ? "more hassle" : "less hassle") : `${row.delta > 0 ? "+" : "−"}${Math.abs(row.delta).toFixed(1)}`}</span>
  </div>;
}

function ProfilePanels({ profile }: { profile: TasteProfile }) {
  const strongestSignals = normalizeStrongestSignals(profile.topArtists);
  return <>
    <p className="tasteSummaryLine">{profile.seedSummary.playlistCount} source playlists · {profile.seedSummary.sourceArtistCount} seeded artists · {profile.seedSummary.topArtistCount} top-artist signals · {profile.seedSummary.artistCount} artists after expansion</p>
    <div className="tasteColumns">
      <div className="tasteArtists">
        <p className="eyebrow">Strongest signals</p><p className="tasteScaleNote">Ranked by current deterministic contribution. Bars are scaled within this shortlist.</p>
        {strongestSignals.length ? strongestSignals.map((artist) => <div className="tasteArtistRow" data-signal-kind={artist.signalKind} key={artist.name}>
          <div className="tasteArtistName"><strong>{artist.name}</strong><span>{artist.signalKind === "inferred" ? "Inferred discovery" : "Direct taste"}{artist.labels.length ? ` · ${artist.labels.join(" · ")}` : ""}</span></div>
          <div aria-label={`${artist.name}: ${artist.signalKind} signal`} className="tasteArtistTrack"><span style={{ width: `${artist.width}%` }} /></div>
        </div>) : <p className="tasteQuietEmpty">No current signals are ready to rank. Refresh the taste seed to restore this view.</p>}
      </div>
      <div className="tasteMeta">
        <p className="eyebrow">Taste clusters</p><div className="tasteTags">{profile.topTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <p className="eyebrow">Where candidates come from</p>
        <ul className="tasteOrigins">{Object.entries(profile.expansionByOrigin).map(([origin, count]) => <li key={origin}><strong>{count}</strong> {ORIGIN_LABELS[origin] ?? origin}</li>)}</ul>
      </div>
    </div>
  </>;
}

function normalizeStrongestSignals(artists: TasteProfile["topArtists"]) {
  const rows = artists
    .map((artist) => {
      const name = String(artist.name ?? "").trim();
      const contribution = finiteSignal(artist.signalContribution) ?? finiteSignal(artist.relativeSignal);
      const signalKind = artist.signalKind ?? (['similar', 'tag', 'promoter'].includes(artist.origin) ? "inferred" : "direct");
      const labels = (artist.evidenceLabels ?? artist.labels ?? [])
        .map((label) => String(label).trim())
        .filter(Boolean)
        .filter((label) => signalKind === "inferred" || !/adjacent discovery/i.test(label));
      return { name, contribution, signalKind, labels };
    })
    .filter((artist): artist is { name: string; contribution: number; signalKind: "direct" | "inferred"; labels: string[] } => Boolean(artist.name) && artist.contribution != null)
    .sort((left, right) => right.contribution - left.contribution || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  const values = rows.map((artist) => artist.contribution);
  const maximum = Math.max(...values, 0);
  const minimum = Math.min(...values, maximum);
  const span = maximum - minimum;
  return rows.map((artist) => ({
    ...artist,
    // The source score is intentionally not exposed as a raw preference
    // value. This visual scale prevents a nearly-flat 87–100 list from
    // looking like every artist has identical strength.
    width: span > 0 ? Math.round(28 + ((artist.contribution - minimum) / span) * 72) : 100,
  }));
}

function finiteSignal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
        ? "Plans and outcomes persist in the private hosted database and follow your sign-in."
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
