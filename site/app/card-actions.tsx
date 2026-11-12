"use client";

import { useState } from "react";
import { buildCalendarEvent, type CalendarEventInput } from "./ics";
import { useFeedback } from "./feedback-context";
import type { PlanningInput } from "./feedback-store";
import type { FeedbackKeys, FeedbackReasonCode } from "./feedback-store";

// Shared secondary-action disclosure. Cards keep their primary decision CTA
// visible and tuck planning/feedback actions behind one compact control.
// Movies pass a planning input with feedbackSnapshot null (planning + calendar
// only — no attendance journal for films).
const NOT_FOR_ME: Array<{ code: FeedbackReasonCode; label: string }> = [
  { code: "artist", label: "Not my taste" },
  { code: "lineup", label: "Lineup" },
  { code: "venue", label: "Venue" },
  { code: "timing", label: "Wrong night" },
  { code: "price", label: "Price" },
  { code: "distance", label: "Too far" },
];
const STATE_LABELS: Record<string, string> = {
  interested: "You're interested",
  "lost-interest": "Passed",
  "attended-worth-it": "Went · worth it",
  "attended-not-worth-it": "Went · not worth it",
  "wanted-to-attend": "Wanted to go",
  "did-not-attend-logistical": "Couldn't make it",
};

// Planning and feedback sit on the card, one tap each, instead of behind a
// disclosure. A reason is always an explicit choice (never a default), and
// anything recorded here can be undone.
export function CardActions({ layout, planning, calendarEvent }: {
  layout: "overview" | "music" | "sports" | "movie";
  planning: PlanningInput | null;
  calendarEvent: CalendarEventInput | null;
}) {
  const feedback = useFeedback();
  const [choosingReason, setChoosingReason] = useState(false);
  const item = planning && feedback?.ready ? feedback.planningFor(planning.planningSnapshot.itemId) : null;
  const saved = item?.saved ?? false;
  const held = item?.held ?? false;
  const snapshot = planning?.feedbackSnapshot ?? null;
  const recorded = feedback?.ready ? feedback.feedbackFor(snapshot) : null;
  const canPlan = Boolean(planning?.planningSnapshot.dateLocal) && feedback?.ready;
  const holdDate = () => {
    if (held) {
      if (planning && feedback?.ready) feedback.setIntent(planning, "held", false);
      return;
    }
    if (planning && feedback?.ready) feedback.setIntent(planning, "held", true);
    if (!calendarEvent) return;
    const ics = buildCalendarEvent(calendarEvent);
    if (!ics) return;
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  if (!planning && !calendarEvent) return null;
  return (
    <div className={`cardActions cardActions-${layout}`}>
      <div className="cardActionsMenu">
        {planning ? <button
          aria-pressed={saved}
          className={saved ? "cardAction actionActive" : "cardAction"}
          disabled={!canPlan}
          onClick={() => feedback?.setIntent(planning, "saved", !saved)}
          type="button"
        >{saved ? "Remove save" : "Save"}</button> : null}
        {calendarEvent ? <button aria-pressed={held} className={held ? "cardAction actionActive" : "cardAction"} onClick={holdDate} type="button">{held ? "Remove hold" : "Hold date"}</button> : null}
        {snapshot && !recorded && !choosingReason ? (
          <button className="cardAction cardActionQuiet" onClick={() => setChoosingReason(true)} type="button">Not for me</button>
        ) : null}
        {snapshot && recorded ? <span className="cardActionResolved">
          {STATE_LABELS[recorded.status] ?? "Feedback recorded"}
          <button className="cardActionUndo" onClick={() => feedback?.withdraw(snapshot)} type="button">Undo</button>
        </span> : null}
      </div>
      {snapshot && choosingReason && !recorded ? <div className="cardActionConfirm" role="group" aria-label="Why is this not for you?">
        <span>Because…</span>
        {NOT_FOR_ME.map((reason) => <button key={reason.code} onClick={() => { feedback?.notForMe(snapshot, [reason.code]); setChoosingReason(false); }} type="button">{reason.label}</button>)}
        <button className="cardActionCancel" onClick={() => setChoosingReason(false)} type="button">Cancel</button>
      </div> : null}
    </div>
  );
}

type VenueLike = { name?: string | null; city?: string | null } | null | undefined;

export function planningInputFrom(vertical: "music" | "sports" | "movies", item: {
  id: string;
  title: string;
  startLocal?: string | null;
  releaseDate?: string | null;
  venue?: VenueLike;
  feedbackSnapshot?: PlanningInput["feedbackSnapshot"];
  feedbackKeys?: FeedbackKeys | null;
}): PlanningInput | null {
  const dateLocal = (item.startLocal ?? item.releaseDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) return null;
  return {
    planningSnapshot: {
      itemId: item.id,
      title: item.title,
      dateLocal,
      vertical,
      locationLabel: locationLabel(item.venue),
    },
    feedbackSnapshot: vertical === "movies" || !item.feedbackSnapshot ? null : { ...item.feedbackSnapshot, feedbackKeys: item.feedbackKeys ?? item.feedbackSnapshot.feedbackKeys ?? null },
  };
}

export function calendarInputFrom(item: {
  id: string;
  title: string;
  startLocal?: string | null;
  releaseDate?: string | null;
  timeTbd?: boolean;
  venue?: VenueLike;
  description?: string | null;
  sourceUrl?: string | null;
}): CalendarEventInput | null {
  const startLocal = item.startLocal ?? null;
  const dateLocal = (startLocal ?? item.releaseDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) return null;
  const timed = Boolean(startLocal && !item.timeTbd && /T\d{2}:\d{2}/.test(startLocal));
  return {
    uid: item.id,
    title: item.title,
    startLocal: timed ? startLocal : null,
    dateLocal,
    allDay: !timed,
    locationLabel: locationLabel(item.venue),
    description: item.description ?? null,
    url: item.sourceUrl ?? null,
  };
}

function locationLabel(venue: VenueLike): string | null {
  if (!venue) return null;
  return [venue.name, venue.city].filter(Boolean).join(" · ") || null;
}
