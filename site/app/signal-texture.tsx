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
