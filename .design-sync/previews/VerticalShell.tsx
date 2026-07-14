import { VerticalShell } from 'taste-engine-site';

const DEMO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2362dfc3'/%3E%3Cstop offset='1' stop-color='%23173f36'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)'/%3E%3C/svg%3E";

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

const generatedAt = '2026-07-12T12:00:00.000-07:00';

const overview = [
  {
    vertical: 'music', id: 'qa-music-image', title: 'Short Signal', sourceUrl: 'https://example.com/synthetic/short-signal',
    startLocal: '2026-07-15T20:00:00-07:00', venue: { name: 'The Example Hall', city: 'Los Angeles' }, score: 92,
    interestScore: null, hassleScore: 3, urgency: 'watch', confidence: 'confirmed',
    reason: 'A direct synthetic seed with a compact weeknight fit.', call: 'Strong fit', bucket: 'current',
    visual: { kind: 'image', url: DEMO_IMAGE, alt: 'Short Signal atmosphere' },
  },
  {
    vertical: 'sports', id: 'qa-sports-rivalry-1', title: 'Giants', sourceUrl: 'https://example.com/synthetic/rivalry-1',
    startLocal: '2026-07-16T19:10:00-07:00', venue: { name: 'Synthetic Stadium', city: 'Los Angeles' }, score: 91,
    interestScore: 91, hassleScore: 4, urgency: 'watch', confidence: 'confirmed',
    reason: 'High-leverage rivalry context with a clean night-game shape.', call: 'Prioritize', bucket: 'current',
    visual: { kind: 'texture', variant: 'sports-stadium-lights' },
  },
];

const events = [
  {
    id: 'qa-music-image', title: 'Short Signal', sourceUrl: 'https://example.com/synthetic/short-signal',
    sources: ['framework'], sourceLinks: [{ source: 'framework', url: 'https://example.com/synthetic/short-signal' }],
    eventType: 'concert', startLocal: '2026-07-15T20:00:00-07:00', timeTbd: false,
    venue: { name: 'The Example Hall', city: 'Los Angeles', state: 'CA' },
    ticketObservation: { lowestPriceUsd: 45, listingCount: 18 },
    matchedArtists: [{ name: 'Short Signal', seedStrength: 0.9, primary: true, origin: 'source' }],
    ranking: { artistFit: 92, hassleScore: 3, hassleReasons: ['Easy rail access'], utility: 91, confidence: 'confirmed', urgency: 'watch', whyYou: 'A direct synthetic seed with a compact venue and a clean weeknight fit.' },
    visual: { kind: 'image', url: DEMO_IMAGE, alt: 'A synthetic atmospheric event image' },
  },
];

const movies = [
  {
    id: 'qa-movie-confirmed', title: 'Synthetic Projection', sourceUrl: 'https://example.com/synthetic/synthetic-projection',
    releaseDate: '2026-07-20', overview: 'A synthetic theatrical description used only for browser QA.', tasteScore: 88,
    reasons: ['The local fixture confirms a premium presentation.'], directors: ['Example Director'], runtimeMinutes: 124,
    formatStatus: 'confirmed locally', format: 'IMAX', theater: 'Synthetic Cinema', premiumFormatConfirmed: true,
    posterUrl: DEMO_IMAGE, backdropUrl: DEMO_IMAGE,
    visual: { kind: 'image', url: DEMO_IMAGE, alt: 'Synthetic Projection poster' },
  },
];

const sports = [
  {
    id: 'qa-sports-rivalry-1', sourceUrl: 'https://example.com/synthetic/rivalry-1', startLocal: '2026-07-16T19:10:00-07:00',
    timeTbd: false, venue: { name: 'Synthetic Stadium', city: 'Los Angeles', state: 'CA' },
    homeTeam: { name: 'Synthetic Dodgers', shortName: 'Dodgers', abbreviation: 'SYN' },
    awayTeam: { name: 'Synthetic Giants', shortName: 'Giants', abbreviation: 'SGI' },
    series: { id: 'qa-series-rivalry', gameNumber: 1, gameCount: 3 },
    sportsContext: { rivalryTier: 'high', playoffLeverage: 'medium', probablePitchers: { home: { name: 'A. Example', era: 2.8 }, away: { name: 'B. Example', era: 3.1 }, confirmed: true } },
    tags: ['rivalry', 'weeknight', 'confirmed pitchers'],
    ticketObservations: [{ source: 'seatgeek', url: 'https://example.com/synthetic/rivalry-1-tickets', lowestPriceUsd: 65, status: 'available' }],
    sourceLinks: [{ source: 'mlb', url: 'https://example.com/synthetic/rivalry-1' }],
    ranking: { interestScore: 91, utility: 90, hassleScore: 4, urgency: 'watch', confidence: 'confirmed', whyYou: 'High-leverage rivalry context with a clean night-game shape.' },
    visual: { kind: 'texture', variant: 'sports-stadium-lights' },
  },
];

const recentHistory = [
  {
    historyId: 'rh-qa-past-music', canonicalEventId: 'qa-past-music', feedbackSnapshotId: 'fs-qa-past-music',
    vertical: 'music', title: 'Past Synthetic Set', dateLocal: '2026-07-01', locationLabel: 'Synthetic Hall · Los Angeles',
    firstShownAt: '2026-06-20T19:00:00.000Z', lastShownAt: '2026-06-30T19:00:00.000Z', surfaces: ['overview', 'shortlist'], bestRank: 1,
  },
];

const editorial = {
  headline: 'A few synthetic options clear the bar.',
  verdict: 'selective',
  lead: 'The fixture keeps the current call small while leaving the longer evidence available in each vertical.',
  skipCall: 'Do not confuse a complete-looking card with confirmed availability.',
};

export function Default() {
  return (
    <div style={canvas}>
      <VerticalShell
        overview={overview}
        overviewPlanAhead={[]}
        events={events}
        movies={movies}
        sports={sports}
        recentHistory={recentHistory}
        generatedAt={generatedAt}
        tmdbStatus="active"
        featuredInterestThreshold={70}
        editorial={editorial}
        tasteProfile={null}
        changesSinceRefresh={null}
      />
    </div>
  );
}
