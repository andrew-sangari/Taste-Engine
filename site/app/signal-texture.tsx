export function HassleDial({ score }: { score: number }) {
  const normalized = Math.max(0, Math.min(10, Math.round(score)));
  return <span className="hassle">Hassle
    <span className={`hassleTicks ${normalized >= 6 ? "warm" : ""}`.trim()} aria-label={`Hassle ${normalized} of 10`}>
      {Array.from({ length: 10 }, (_, index) => <i className={index < normalized ? "on" : undefined} key={index} />)}
    </span>
  </span>;
}

const URGENCY_LABELS: Record<string, string> = {
  "buy now": "Buy now",
  watch: "Watch",
  "safe to wait": "Safe to wait",
  unknown: "Availability unknown",
  "likely unavailable": "Likely unavailable",
};

export function urgencyLabel(urgency: string | null | undefined) {
  return URGENCY_LABELS[String(urgency ?? "unknown")] ?? String(urgency);
}

export function UrgencyChip({ urgency }: { urgency: string }) {
  const tone = urgency === "buy now" ? "hot" : urgency === "watch" ? "watch" : urgency === "safe to wait" ? "" : "unknown";
  return <span className={`urgency ${tone}`.trim()}>{urgencyLabel(urgency)}</span>;
}

export type FeedbackAdjustment = {
  applied: boolean;
  scoreDelta: number;
  reasons?: Array<{ category: string; label: string; delta: number; outcomes: number }>;
};

// The four decision dimensions stay visible and independent on every card: a
// strong fit with a real planning obstacle reads as exactly that. The single
// number is the summary, not the explanation.
export function RecommendationScore({ score, fit, friction, urgency, confidence, status, adjustment }: {
  score?: number | null;
  fit: number | null | undefined;
  friction: number | null | undefined;
  urgency?: string | null;
  confidence?: string | null;
  status?: string | null;
  adjustment?: FeedbackAdjustment | null;
}) {
  const points = Math.max(0, Math.min(100, Math.round(score ?? fit ?? 0)));
  const fitValue = fit == null ? null : Math.max(0, Math.round(fit));
  const frictionValue = friction == null ? null : Math.max(0, Math.min(10, Math.round(friction)));
  const learned = adjustment && adjustment.applied && Math.abs(adjustment.scoreDelta) >= 0.5 ? adjustment : null;
  return <div className="decisionScore" role="group" aria-label={`Score ${points}${status ? `, ${status}` : ""}`}>
    <div className="decisionHead">
      <strong className="decisionPoints">{points}</strong>
      <span className="decisionCall">{status ?? "Score"}</span>
      <span aria-hidden="true" className="decisionTrack"><i style={{ width: `${points}%` }} /></span>
    </div>
    <dl className="decisionFactors">
      {fitValue != null ? <div><dt>Fit</dt><dd><span aria-hidden="true" className="factorBar"><i style={{ width: `${Math.min(100, Math.round(fitValue / 0.68))}%` }} /></span>{fitValue}</dd></div> : null}
      {frictionValue != null ? <div className={frictionValue >= 6 ? "factorWarm" : undefined}><dt>Friction</dt><dd><span aria-hidden="true" className="factorTicks">{Array.from({ length: 10 }, (_, index) => <i className={index < frictionValue ? "on" : undefined} key={index} />)}</span>{frictionValue}/10</dd></div> : null}
      {urgency ? <div className={urgency === "buy now" ? "factorHot" : undefined}><dt>Tickets</dt><dd>{urgencyLabel(urgency)}</dd></div> : null}
      {confidence ? <div><dt>Confidence</dt><dd>{confidence}</dd></div> : null}
    </dl>
    {learned ? <p className="decisionLearned">
      <b>{learned.scoreDelta > 0 ? "+" : "−"}{Math.abs(learned.scoreDelta).toFixed(1)}</b> from your feedback
      {learned.reasons?.length ? <> · {learned.reasons.map((reason) => reason.label).join(", ")}</> : null}
    </p> : null}
  </div>;
}
