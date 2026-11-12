"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "./feedback-context";
import type { FeedbackReasonCode } from "./feedback-store";
import { formatLocalDate } from "./local-date";
import type { SeasonItem } from "./season-strip";
import { urgencyLabel } from "./signal-texture";

const DECK_SIZE = 12;
// One tap each. Taste reasons teach the engine about the artist or room;
// logistics reasons only ever raise friction and never count against taste.
const PASS_REASONS: Array<{ code: FeedbackReasonCode; label: string; kind: "taste" | "logistics" }> = [
  { code: "artist", label: "Not my taste", kind: "taste" },
  { code: "venue", label: "Not that venue", kind: "taste" },
  { code: "timing", label: "Wrong night", kind: "logistics" },
  { code: "price", label: "Too pricey", kind: "logistics" },
  { code: "distance", label: "Too far", kind: "logistics" },
];
type Answer = { id: string; kind: "in" | "curious" | "pass"; label: string };

// Triage: a two-minute pass over the dates the engine has not heard about.
// Post-event check-ins are rare; a quick read on a dozen upcoming nights gives
// the learning policy an order of magnitude more signal, while it is still
// useful for deciding what to do.
export function TriageDeck({ items }: { items: SeasonItem[] }) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const [deck, setDeck] = useState<SeasonItem[]>([]);
  const [index, setIndex] = useState(0);
  const [passing, setPassing] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const pending = useMemo(() => {
    if (!feedback?.ready) return [];
    const seen = new Set<string>();
    return [...items]
      .filter((item) => item.planning?.feedbackSnapshot && !feedback.feedbackFor(item.planning.feedbackSnapshot))
      .filter((item) => { const planning = feedback.planningFor(item.id); return !(planning?.saved || planning?.held); })
      .sort((left, right) => right.score - left.score || String(left.startLocal).localeCompare(String(right.startLocal)))
      .filter((item) => (seen.has(item.groupKey) ? false : (seen.add(item.groupKey), true)));
  }, [feedback, items]);

  const start = () => {
    setDeck(pending.slice(0, DECK_SIZE));
    setIndex(0);
    setAnswers([]);
    setPassing(false);
    setOpen(true);
  };
  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus();
  }, []);
  const current = deck[index] ?? null;
  const snapshot = current?.planning?.feedbackSnapshot ?? null;

  const answer = useCallback((kind: Answer["kind"], reason?: (typeof PASS_REASONS)[number]) => {
    if (!current || !snapshot || !feedback) return;
    if (kind === "pass") {
      if (!reason) { setPassing(true); return; }
      feedback.notForMe(snapshot, [reason.code]);
    } else {
      feedback.interested(snapshot, kind);
      if (kind === "in" && current.planning) feedback.setIntent(current.planning, "saved", true);
    }
    setAnswers((list) => [...list, { id: current.id, kind, label: kind === "pass" ? reason!.label : kind === "in" ? "I'm in" : "Curious" }]);
    setPassing(false);
    setIndex((value) => value + 1);
  }, [current, feedback, snapshot]);

  const undo = useCallback(() => {
    if (passing) { setPassing(false); return; }
    const last = answers.at(-1);
    const previous = deck[index - 1];
    if (!last || !previous?.planning?.feedbackSnapshot || !feedback) return;
    feedback.withdraw(previous.planning.feedbackSnapshot);
    if (last.kind === "in") feedback.setIntent(previous.planning, "saved", false);
    setAnswers((list) => list.slice(0, -1));
    setIndex((value) => Math.max(0, value - 1));
  }, [answers, deck, feedback, index, passing]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") answer("in");
      else if (event.key === "ArrowUp") { event.preventDefault(); answer("curious"); }
      else if (event.key === "ArrowLeft") answer("pass");
      else if (event.key === "Backspace" || event.key.toLowerCase() === "z") undo();
      else if (passing && /^[1-5]$/.test(event.key)) answer("pass", PASS_REASONS[Number(event.key) - 1]);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [answer, close, open, passing, undo]);

  if (!feedback?.ready || (!pending.length && !open)) return null;
  const done = open && !current;
  const tally = (kind: Answer["kind"]) => answers.filter((entry) => entry.kind === kind).length;
  return <>
    <div className="triageInvite">
      <div>
        <p className="eyebrow">Triage</p>
        <p className="triageInviteCopy"><b>{pending.length}</b> upcoming {pending.length === 1 ? "date hasn't" : "dates haven't"} heard from you. A quick read on each is the fastest way to sharpen the ranking.</p>
      </div>
      <button className="triageStart" onClick={start} ref={openerRef} type="button">Start triage <span aria-hidden="true">→</span></button>
    </div>
    {open ? <div className="triageScrim" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div aria-label="Triage upcoming dates" aria-modal="true" className="triageDialog" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="triageBar">
          <span className="triageProgress" aria-label={`${Math.min(index + 1, deck.length)} of ${deck.length}`}>
            {deck.map((item, position) => <i className={position < index ? `done ${answers[position]?.kind ?? ""}` : position === index ? "now" : ""} key={item.id} />)}
          </span>
          <button className="triageClose" onClick={close} type="button">Close</button>
        </header>
        {current ? <article className="triageCard" key={current.id}>
          <p className="triageMeta"><span>{current.vertical}</span><span>{current.label}</span><span>{current.call}</span></p>
          <p className="triageDate">{formatLocalDate(current.startLocal, { weekday: "long", month: "long", day: "numeric" }) ?? "Date TBD"}</p>
          <h3>{current.title}</h3>
          <p className="triageVenue">{current.venueLabel}</p>
          <p className="triageWhy">{current.why}</p>
          <dl className="triageFactors">
            <div><dt>Score</dt><dd>{Math.round(current.score)}</dd></div>
            {current.fit != null ? <div><dt>Fit</dt><dd>{Math.round(current.fit)}</dd></div> : null}
            {current.friction != null ? <div><dt>Friction</dt><dd>{Math.round(current.friction)}/10</dd></div> : null}
            <div><dt>Tickets</dt><dd>{urgencyLabel(current.urgency)}</dd></div>
          </dl>
          {passing ? <div className="triageReasons" role="group" aria-label="Why pass?">
            <p>Why pass? <small>Only taste reasons count against the artist.</small></p>
            <div>{PASS_REASONS.map((reason, position) => <button className={`triageReason reason-${reason.kind}`} key={reason.code} onClick={() => answer("pass", reason)} type="button"><kbd>{position + 1}</kbd>{reason.label}</button>)}</div>
            <button className="triageUndo" onClick={() => setPassing(false)} type="button">Back</button>
          </div> : <div className="triageActions">
            <button className="triagePass" onClick={() => answer("pass")} type="button"><kbd>←</kbd>Pass</button>
            <button className="triageCurious" onClick={() => answer("curious")} type="button"><kbd>↑</kbd>Curious</button>
            <button className="triageIn" onClick={() => answer("in")} type="button">I&rsquo;m in<kbd>→</kbd></button>
          </div>}
          {answers.length && !passing ? <button className="triageUndo" onClick={undo} type="button">Undo last</button> : null}
        </article> : null}
        {done ? <div className="triageDone">
          <p className="eyebrow">Done</p>
          <h3>{answers.length} {answers.length === 1 ? "read" : "reads"} captured.</h3>
          <p>{tally("in")} in · {tally("curious")} curious · {tally("pass")} passed. The ones you&rsquo;re in on are saved to your plans, and every read feeds the next refresh.</p>
          <div className="triageActions">
            {pending.length ? <button className="triageCurious" onClick={start} type="button">Next {Math.min(DECK_SIZE, pending.length)}</button> : null}
            <button className="triageIn" onClick={close} type="button">Back to the shortlist</button>
          </div>
        </div> : null}
      </div>
    </div> : null}
  </>;
}
