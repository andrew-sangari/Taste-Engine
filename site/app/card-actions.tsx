"use client";

import { useState } from "react";
import { buildCalendarEvent, type CalendarEventInput } from "./ics";
import { useFeedback } from "./feedback-context";
import type { PlanningInput } from "./feedback-store";
import type { FeedbackReasonCode } from "./feedback-store";

// Shared secondary-action disclosure. Cards keep their primary decision CTA
// visible and tuck planning/feedback actions behind one compact control.
// Movies pass a planning input with feedbackSnapshot null (planning + calendar
// only — no attendance journal for films).
export function CardActions({ layout, planning, calendarEvent }: {
  layout: "overview" | "music" | "sports" | "movie";
  planning: PlanningInput | null;
  calendarEvent: CalendarEventInput | null;
}) {
  const feedback = useFeedback();
  const [confirmingNegative, setConfirmingNegative] = useState(false);
  const [negativeReason, setNegativeReason] = useState<FeedbackReasonCode>("artist");
  const item = planning && feedback?.ready ? feedback.planningFor(planning.planningSnapshot.itemId) : null;
  const saved = item?.saved ?? false;
  const held = item?.held ?? false;
  const outcomeRecorded = feedback?.hasOutcome(planning?.feedbackSnapshot ?? null) ?? false;
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
  const stateLabel = outcomeRecorded ? "Feedback added" : saved && held ? "Saved · Held" : saved ? "Saved" : held ? "Held" : null;
  return (
    <details className={`cardActions cardActions-${layout}`}>
      <summary>
        <span>Plan</span>
        {stateLabel ? <strong>{stateLabel}</strong> : null}
      </summary>
      <div className="cardActionsMenu">
        {planning ? <>
          <button
            aria-pressed={saved}
            className={saved ? "cardAction actionActive" : "cardAction"}
            disabled={!canPlan}
            onClick={() => feedback?.setIntent(planning, "saved", !saved)}
            type="button"
          >{saved ? "Remove save" : "Save"}</button>
        </> : null}
        {calendarEvent ? <button aria-pressed={held} className={held ? "cardAction actionActive" : "cardAction"} onClick={holdDate} type="button">{held ? "Remove hold" : "Hold date"}</button> : null}
        {planning?.feedbackSnapshot && !outcomeRecorded && !confirmingNegative ? (
          <button className="cardAction cardActionQuiet" onClick={() => setConfirmingNegative(true)} type="button">Not for me</button>
        ) : null}
        {planning?.feedbackSnapshot && confirmingNegative ? <span className="cardActionConfirm" role="group" aria-label="Confirm Not for me">
          <span>What changed?</span>
          <select aria-label="Not for me reason" onChange={(event) => setNegativeReason(event.target.value as FeedbackReasonCode)} value={negativeReason}>
            <option value="artist">Artist or taste</option><option value="lineup">Lineup</option><option value="production">Production quality</option><option value="venue">Venue</option><option value="timing">Timing</option><option value="price">Price</option><option value="distance">Distance</option><option value="other">Other</option>
          </select>
          <button onClick={() => { feedback?.notForMe(planning.feedbackSnapshot!, [negativeReason]); setConfirmingNegative(false); }} type="button">Confirm</button>
          <button onClick={() => setConfirmingNegative(false)} type="button">Cancel</button>
        </span> : null}
        {outcomeRecorded ? <span className="cardActionResolved">Taste feedback recorded</span> : null}
      </div>
    </details>
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
    feedbackSnapshot: vertical === "movies" ? null : item.feedbackSnapshot ?? null,
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
