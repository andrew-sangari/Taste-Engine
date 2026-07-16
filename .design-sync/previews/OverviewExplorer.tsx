import { OverviewExplorer } from 'taste-engine-site';

const DEMO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2362dfc3'/%3E%3Cstop offset='1' stop-color='%23173f36'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)'/%3E%3C/svg%3E";

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

const generatedAt = '2026-07-12T12:00:00.000-07:00';

const overview = [
  {
    vertical: 'music',
    id: 'qa-music-image',
    title: 'Short Signal',
    sourceUrl: 'https://example.com/synthetic/short-signal',
    startLocal: '2026-07-15T20:00:00-07:00',
    venue: { name: 'The Example Hall', city: 'Los Angeles' },
    score: 92,
    interestScore: null,
    hassleScore: 3,
    urgency: 'watch',
    confidence: 'confirmed',
    reason: 'A direct synthetic seed with a compact weeknight fit.',
    call: 'Strong fit',
    bucket: 'current',
    visual: { kind: 'image', url: DEMO_IMAGE, alt: 'Short Signal atmosphere' },
  },
  {
    vertical: 'sports',
    id: 'qa-sports-rivalry-1',
    title: 'Giants',
    sourceUrl: 'https://example.com/synthetic/rivalry-1',
    startLocal: '2026-07-16T19:10:00-07:00',
    venue: { name: 'Synthetic Stadium', city: 'Los Angeles' },
    score: 91,
    interestScore: 91,
    hassleScore: 4,
    urgency: 'watch',
    confidence: 'confirmed',
    reason: 'High-leverage rivalry context with a clean night-game shape.',
    call: 'Prioritize',
    bucket: 'current',
    visual: { kind: 'texture', variant: 'sports-stadium-lights' },
  },
  {
    vertical: 'movies',
    id: 'qa-movie-confirmed',
    title: 'Synthetic Projection',
    sourceUrl: 'https://example.com/synthetic/synthetic-projection',
    startLocal: '2026-07-20T12:00:00-07:00',
    venue: { name: 'Synthetic Cinema', city: 'Los Angeles' },
    score: 88,
    interestScore: null,
    hassleScore: null,
    urgency: 'watch',
    confidence: 'likely',
    reason: 'The local fixture confirms a premium presentation.',
    call: 'Consider',
    bucket: 'current',
    visual: { kind: 'image', url: DEMO_IMAGE, alt: 'Synthetic Projection poster' },
  },
];

const planAhead = [
  {
    vertical: 'sports',
    id: 'qa-sports-high-leverage',
    title: 'Yankees',
    sourceUrl: 'https://example.com/synthetic/high-leverage',
    startLocal: '2026-09-18T18:40:00-07:00',
    venue: { name: 'Synthetic Stadium', city: 'Los Angeles' },
    score: 84,
    interestScore: 88,
    hassleScore: 5,
    urgency: 'safe to wait',
    confidence: 'confirmed',
    reason: 'High leverage remains useful planning context even outside the current window.',
    call: 'Prioritize',
    bucket: 'plan-ahead',
    visual: { kind: 'texture', variant: 'sports-scoreboard-glow' },
  },
];

const editorial = {
  headline: 'A few synthetic options clear the bar.',
  verdict: 'selective',
  lead: 'The fixture keeps the current call small while leaving the longer evidence available in each vertical.',
  skipCall: 'Do not confuse a complete-looking card with confirmed availability.',
  decisionNotes: ['Direct signals remain separate from exploratory bridges.', 'Unknown price stays unknown.'],
};

export function CurrentCallWithPlanAhead() {
  return (
    <div style={canvas}>
      <OverviewExplorer overview={overview} planAhead={planAhead} generatedAt={generatedAt} editorial={editorial} />
    </div>
  );
}

export function NothingClearsTheBar() {
  return (
    <div style={canvas}>
      <OverviewExplorer
        overview={[]}
        planAhead={[]}
        generatedAt={generatedAt}
        editorial={{ headline: "Don't waste your time this weekend.", verdict: 'do not waste your time', lead: 'Nothing in the current window earns the trip yet.', skipCall: 'Wait for the next refresh rather than settling.' }}
      />
    </div>
  );
}
