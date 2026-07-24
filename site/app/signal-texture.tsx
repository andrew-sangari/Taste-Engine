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
export function RecommendationScore({ score, fit, friction, urgency, confidence, status }: {
  score?: number | null;
  fit: number | null | undefined;
  friction: number | null | undefined;
  urgency?: string | null;
  confidence?: string | null;
  status?: string | null;
}) {
  const points = Math.max(0, Math.min(100, Math.round(score ?? fit ?? 0)));
  return <details className="recommendationScore">
    <summary aria-label={`Decision points ${points}. Show score factors`}>
      <span className="recommendationScoreLabel">Decision points</span>
      <strong>{points}</strong>
      <span aria-hidden="true" className="recommendationScoreTrack"><i style={{ width: `${points}%` }} /></span>
      <span className="recommendationScorePrompt">Factors</span>
    </summary>
    <div className="recommendationScoreFactors" aria-label="Decision score factors">
      {fit != null ? <span><b>Fit</b> {Math.round(fit)}</span> : null}
      {friction != null ? <span><b>Friction</b> {Math.round(friction)}/10</span> : null}
      {urgency ? <span><b>Urgency</b> {urgency}</span> : null}
      {confidence ? <span><b>Confidence</b> {confidence}</span> : null}
      {status ? <span><b>Status</b> {status}</span> : null}
    </div>
  </details>;
}
