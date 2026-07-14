import { EventExplorer } from 'taste-engine-site';

const DEMO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2362dfc3'/%3E%3Cstop offset='1' stop-color='%23173f36'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)'/%3E%3C/svg%3E";

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

const generatedAt = '2026-07-12T12:00:00.000-07:00';

const events = [
  {
    id: 'qa-music-image',
    title: 'Short Signal',
    sourceUrl: 'https://example.com/synthetic/short-signal',
    sources: ['framework'],
    sourceLinks: [{ source: 'framework', url: 'https://example.com/synthetic/short-signal' }],
    eventType: 'concert',
    startLocal: '2026-07-15T20:00:00-07:00',
    timeTbd: false,
    venue: { name: 'The Example Hall', city: 'Los Angeles', state: 'CA' },
    ticketObservation: { lowestPriceUsd: 45, listingCount: 18 },
    matchedArtists: [{ name: 'Short Signal', seedStrength: 0.9, primary: true, origin: 'source' }],
    ranking: { artistFit: 92, hassleScore: 3, hassleReasons: ['Easy rail access'], utility: 91, confidence: 'confirmed', urgency: 'watch', whyYou: 'A direct synthetic seed with a compact venue and a clean weeknight fit.' },
    visual: { kind: 'image', url: DEMO_IMAGE, alt: 'A synthetic atmospheric event image', focalPoint: { x: 72, y: 50 }, attribution: 'Synthetic local fixture' },
  },
  {
    id: 'qa-music-long',
    title: 'An Extremely Long Synthetic Festival Billing With Many Words That Must Wrap Without Breaking The Recommendation Card',
    sourceUrl: 'https://example.com/synthetic/long-billing',
    sources: ['seatgeek', 'framework'],
    sourceLinks: [{ source: 'seatgeek', url: 'https://example.com/synthetic/long-billing' }, { source: 'framework', url: 'https://example.com/synthetic/long-billing-framework' }],
    eventType: 'concert',
    startLocal: '2026-07-18T21:00:00-07:00',
    timeTbd: false,
    venue: { name: 'VenueWithAnUnbrokenSyntheticTokenThatShouldWrapWithoutEscapingItsCard', city: 'Los Angeles', state: 'CA' },
    ticketObservation: { lowestPriceUsd: null, listingCount: null },
    matchedArtists: [
      { name: 'Long Signal', seedStrength: 0.82, primary: true, origin: 'similar' },
      { name: 'Support Artist One', seedStrength: 0.34, primary: false, origin: 'tag' },
    ],
    ranking: { artistFit: 78, hassleScore: 7, hassleReasons: ['Unknown price', 'Long venue transfer'], utility: 76, confidence: 'likely', urgency: 'safe to wait', whyYou: 'The bridge is credible, but the unusually long bill and unknown price make this a deliberate rather than automatic yes.' },
    localEnhancement: {
      personalFit: { score: 78, label: 'Selective', explanation: 'A useful adjacent signal with a lot to verify.' },
      recommendation: { verdict: 'Consider', explanation: 'Keep it on the shortlist while the details settle.' },
      urgency: { label: 'Safe to wait', explanation: 'No synthetic scarcity signal is available.' },
      hassle: { score: 7, explanation: 'The venue token and unknown price are the main friction.' },
    },
    visual: { kind: 'texture', variant: 'music-warehouse-beams', focalPoint: { x: 80, y: 40 } },
  },
  {
    id: 'qa-music-none',
    title: 'No Visual Set',
    sourceUrl: 'https://example.com/synthetic/no-visual',
    sources: ['seatgeek'],
    sourceLinks: [{ source: 'seatgeek', url: 'https://example.com/synthetic/no-visual' }],
    eventType: 'dj set',
    startLocal: '2026-08-04T22:00:00-07:00',
    timeTbd: true,
    venue: { name: 'Black Box Example', city: 'Los Angeles', state: 'CA' },
    ticketObservation: { lowestPriceUsd: null, listingCount: 0 },
    matchedArtists: [{ name: 'No Visual Set', seedStrength: 0.66, primary: true, origin: 'tag' }],
    ranking: { artistFit: 67, hassleScore: 5, hassleReasons: ['Time TBD'], utility: 64, confidence: 'exploratory', urgency: 'safe to wait', whyYou: 'The fit is promising enough to keep visible even though the event has no declared visual or ticket price.' },
    visual: { kind: 'none' },
  },
  {
    id: 'qa-music-festival',
    title: 'Synthetic Night Market + more',
    sourceUrl: 'https://example.com/synthetic/night-market',
    sources: ['framework'],
    sourceLinks: [{ source: 'framework', url: 'https://example.com/synthetic/night-market' }],
    eventType: 'festival',
    startLocal: '2026-07-25T18:30:00-07:00',
    timeTbd: false,
    venue: { name: 'Synthetic River Park', city: 'Los Angeles', state: 'CA' },
    ticketObservation: { lowestPriceUsd: 80, listingCount: 24 },
    matchedArtists: [
      { name: 'Night Market', seedStrength: 0.74, primary: true, origin: 'promoter' },
      { name: 'More Synthetic Artists', seedStrength: 0.3, primary: false, origin: 'promoter' },
    ],
    ranking: { artistFit: 72, hassleScore: 6, hassleReasons: ['Festival footprint'], utility: 70, confidence: 'exploratory', urgency: 'watch', whyYou: 'A promoter-followed festival shape with enough direct signal to inspect the lineup.' },
    visual: { kind: 'texture', variant: 'music-crowd-silhouette' },
  },
];

export function RankedList() {
  return (
    <div style={canvas}>
      <EventExplorer events={events} generatedAt={generatedAt} />
    </div>
  );
}

export function NoResultsForFilter() {
  return (
    <div style={canvas}>
      <EventExplorer events={events.filter((e) => e.eventType === 'nonexistent-type')} generatedAt={generatedAt} />
    </div>
  );
}
