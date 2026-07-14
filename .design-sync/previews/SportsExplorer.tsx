import { SportsExplorer } from 'taste-engine-site';

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

const generatedAt = '2026-07-12T12:00:00.000-07:00';

const games = [
  {
    id: 'qa-sports-rivalry-1',
    sourceUrl: 'https://example.com/synthetic/rivalry-1',
    startLocal: '2026-07-16T19:10:00-07:00',
    timeTbd: false,
    venue: { name: 'Synthetic Stadium', city: 'Los Angeles', state: 'CA' },
    homeTeam: { name: 'Synthetic Dodgers', shortName: 'Dodgers', abbreviation: 'SYN' },
    awayTeam: { name: 'Synthetic Giants', shortName: 'Giants', abbreviation: 'SGI' },
    series: { id: 'qa-series-rivalry', gameNumber: 1, gameCount: 3 },
    sportsContext: { rivalryTier: 'high', playoffLeverage: 'medium', probablePitchers: { home: { name: 'A. Example', era: 2.8 }, away: { name: 'B. Example', era: 3.1 }, confirmed: true } },
    tags: ['rivalry', 'weeknight', 'confirmed pitchers'],
    ticketObservations: [{ source: 'seatgeek', url: 'https://example.com/synthetic/rivalry-1-tickets', lowestPriceUsd: 65, status: 'available' }],
    sourceLinks: [{ source: 'mlb', url: 'https://example.com/synthetic/rivalry-1' }, { source: 'seatgeek', url: 'https://example.com/synthetic/rivalry-1-tickets' }],
    ranking: { interestScore: 91, utility: 90, hassleScore: 4, urgency: 'watch', confidence: 'confirmed', whyYou: 'High-leverage rivalry context with a clean night-game shape.' },
    visual: { kind: 'texture', variant: 'sports-stadium-lights' },
  },
  {
    id: 'qa-sports-rivalry-2',
    sourceUrl: 'https://example.com/synthetic/rivalry-2',
    startLocal: '2026-07-17T19:10:00-07:00',
    timeTbd: false,
    venue: { name: 'Synthetic Stadium', city: 'Los Angeles', state: 'CA' },
    homeTeam: { name: 'Synthetic Dodgers', shortName: 'Dodgers', abbreviation: 'SYN' },
    awayTeam: { name: 'Synthetic Giants', shortName: 'Giants', abbreviation: 'SGI' },
    series: { id: 'qa-series-rivalry', gameNumber: 2, gameCount: 3 },
    sportsContext: { rivalryTier: 'high', playoffLeverage: 'medium', probablePitchers: { home: null, away: null, confirmed: false } },
    tags: ['rivalry', 'pitchers TBD'],
    ticketObservations: [],
    sourceLinks: [{ source: 'mlb', url: 'https://example.com/synthetic/rivalry-2' }],
    ranking: { interestScore: 62, utility: 60, hassleScore: 4, urgency: 'unknown', confidence: 'confirmed', whyYou: 'The series remains interesting even while ticket coverage is unknown.' },
    visual: { kind: 'texture', variant: 'sports-field-lines' },
  },
  {
    id: 'qa-sports-high-leverage',
    sourceUrl: 'https://example.com/synthetic/high-leverage',
    startLocal: '2026-07-22T18:40:00-07:00',
    timeTbd: false,
    venue: { name: 'Synthetic Stadium', city: 'Los Angeles', state: 'CA' },
    homeTeam: { name: 'Synthetic Dodgers', shortName: 'Dodgers', abbreviation: 'SYN' },
    awayTeam: { name: 'Synthetic Yankees', shortName: 'Yankees', abbreviation: 'SYN' },
    series: { id: 'qa-series-high-leverage', gameNumber: 1, gameCount: 1 },
    sportsContext: { rivalryTier: 'medium', playoffLeverage: 'high', probablePitchers: { home: { name: 'C. Example', era: 2.4 }, away: { name: 'D. Example', era: 2.9 }, confirmed: true } },
    tags: ['high leverage', 'early start'],
    ticketObservations: [{ source: 'seatgeek', url: 'https://example.com/synthetic/high-leverage-tickets', lowestPriceUsd: 95, status: 'available' }],
    sourceLinks: [{ source: 'mlb', url: 'https://example.com/synthetic/high-leverage' }, { source: 'seatgeek', url: 'https://example.com/synthetic/high-leverage-tickets' }],
    ranking: { interestScore: 88, utility: 86, hassleScore: 5, urgency: 'buy now', confidence: 'confirmed', whyYou: 'A high-leverage game with a specific reason to leave the house.' },
    localEnhancement: { recommendation: { verdict: 'Prioritize', explanation: 'The leverage is the point of this date.' } },
    visual: { kind: 'texture', variant: 'sports-scoreboard-glow' },
  },
  {
    id: 'qa-sports-default',
    sourceUrl: 'https://example.com/synthetic/default-game',
    startLocal: '2026-08-04T18:10:00-07:00',
    timeTbd: false,
    venue: { name: 'Synthetic Stadium', city: 'Los Angeles', state: 'CA' },
    homeTeam: { name: 'Synthetic Dodgers', shortName: 'Dodgers', abbreviation: 'SYN' },
    awayTeam: { name: 'Synthetic Mariners', shortName: 'Mariners', abbreviation: 'SMA' },
    series: { id: 'qa-series-default', gameNumber: 1, gameCount: 1 },
    sportsContext: { rivalryTier: 'none', playoffLeverage: 'low', probablePitchers: { home: null, away: null, confirmed: false } },
    tags: [],
    ticketObservations: [],
    sourceLinks: [{ source: 'mlb', url: 'https://example.com/synthetic/default-game' }],
    ranking: { interestScore: 52, utility: 50, hassleScore: 3, urgency: 'unknown', confidence: 'confirmed', whyYou: 'A default texture case with no ticket price signal.' },
    visual: { kind: 'texture', variant: 'sports-field-lines' },
  },
];

export function SeriesGrid() {
  return (
    <div style={canvas}>
      <SportsExplorer games={games} generatedAt={generatedAt} featuredThreshold={70} />
    </div>
  );
}

export function NoGamesForFilter() {
  return (
    <div style={canvas}>
      <SportsExplorer games={[]} generatedAt={generatedAt} featuredThreshold={70} />
    </div>
  );
}
