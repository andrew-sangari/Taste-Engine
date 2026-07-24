export function HassleDial({ score }: { score: number }) {
  const normalized = Math.max(0, Math.min(10, Math.round(score)));
  return <span className="hassle">Hassle
    <span className={`hassleTicks ${normalized >= 6 ? "warm" : ""}`.trim()} aria-label={`Hassle ${normalized} of 10`}>
      {Array.from({ length: 10 }, (_, index) => <i className={index < normalized ? "on" : undefined} key={index} />)}
    </span>
  </span>;
}

export function UrgencyChip({ urgency }: { urgency: string }) {
  return <span className={`urgency ${urgency === "watch" ? "watch" : ""}`.trim()}>{urgency}</span>;
}

// Keep the decision dimensions visually independent. A recommendation can be
// a strong fit with a real planning obstacle; neither label is a composite
// classification of the other.
export function RecommendationSignals({ fit, friction, urgency, confidence, status }: {
  fit: number | null | undefined;
  friction: number | null | undefined;
  urgency?: string | null;
  confidence?: string | null;
  status?: string | null;
}) {
  return <div className="recommendationSignals" aria-label="Recommendation signals">
    {fit != null ? <span className="signalMetric"><b>Fit</b> {Math.round(fit)}</span> : null}
    {friction != null ? <span className="signalMetric"><b>Friction</b> {Math.round(friction)}/10</span> : null}
    {urgency ? <span className="signalMetric"><b>Urgency</b> {urgency}</span> : null}
    {confidence ? <span className="signalMetric"><b>Confidence</b> {confidence}</span> : null}
    {status ? <span className="signalMetric"><b>Status</b> {status}</span> : null}
  </div>;
}
