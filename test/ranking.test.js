import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeekendBrief, renderBriefMarkdown } from '../src/brief.js';
import { playlistAffinityFor, rankCandidates, topItemsAffinityFor } from '../src/ranking.js';

const config = {
  home: { label: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  maxTicketPriceUsd: 100,
  minimumUtility: 28,
  pinnedArtists: [],
  excludedArtists: ['No Thanks'],
  excludedVenues: []
};

const snapshot = {
  artists: [
    { spotifyArtistId: 'artist-one', name: 'Artist One', seedStrength: 10, evidence: [{ playlistId: 'one' }] },
    { spotifyArtistId: 'artist-two', name: 'Artist Two', seedStrength: 4, evidence: [{ playlistId: 'two' }] }
  ]
};

function candidate(overrides = {}) {
  return {
    title: 'Artist One Live',
    sourceUrl: 'https://example.com/tickets',
    startLocal: '2026-07-11T20:00:00',
    timeTbd: false,
    dateTbd: false,
    venue: { name: 'Local Venue', city: 'Los Angeles', lat: 34.06, lon: -118.25 },
    performers: [{ name: 'Artist One', spotifyId: null, primary: true }],
    ticketObservation: { listingCount: 8, lowestPriceUsd: 50 },
    ...overrides
  };
}

test('ranks an exact performer match and exposes reasons', () => {
  const [ranked] = rankCandidates([candidate()], snapshot, config, new Date('2026-07-10T00:00:00Z'));

  assert.equal(ranked.matchedArtists[0].matchMethod, 'exact-name');
  assert.equal(ranked.ranking.artistFit, 60);
  assert.equal(ranked.ranking.urgency, 'buy now');
  assert.equal(ranked.ranking.confidence, 'high');
  assert.match(ranked.ranking.whyYou, /Artist One/);
});

test('filters explicit negative artists from the brief', () => {
  const ranked = rankCandidates([candidate({ performers: [{ name: 'No Thanks', spotifyId: null, primary: true }] })], snapshot, config);
  const brief = createWeekendBrief({
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    rankedCandidates: ranked,
    minimumUtility: config.minimumUtility,
    generatedAt: '2026-07-10T00:00:00.000Z'
  });

  assert.equal(brief.verdict, 'do not waste your time this weekend');
  assert.equal(brief.recommendations.length, 0);
  assert.match(renderBriefMarkdown(brief), /Nothing cleared/);
});

test('distinguishes Framework roster provenance from the event provider', () => {
  const rosterSnapshot = {
    artists: [{
      name: 'Framework Artist',
      seedStrength: 3,
      origin: 'promoter',
      discoveryEvidence: [{ type: 'framework-roster', promoter: 'Framework' }]
    }]
  };
  const [ranked] = rankCandidates([candidate({
    performers: [{ name: 'Framework Artist', spotifyId: null, primary: true }],
    source: 'insomniac',
    sourceOccurrences: [{ source: 'insomniac', sourceUrl: 'https://insomniac.example/event' }]
  })], rosterSnapshot, config);
  assert.match(ranked.ranking.whyYou, /Framework artist roster/);
  assert.match(ranked.ranking.whyYou, /Insomniac/);
  assert.doesNotMatch(ranked.ranking.whyYou, /explicitly follow Framework/);
});

test('preserves the exact playlist affinity normalization and renormalizes partial Top Artists windows', () => {
  assert.equal(playlistAffinityFor({ seedStrength: 5 }, 10), 30);
  assert.equal(playlistAffinityFor({ seedStrength: 5 }, 5), 60);
  const artist = { topEvidence: { shortTermRank: 1, mediumTermRank: null, longTermRank: 50 } };
  const topItems = { windows: {
    shortTerm: { status: 'fresh' },
    mediumTerm: { status: 'unavailable' },
    longTerm: { status: 'fresh' }
  } };
  assert.equal(topItemsAffinityFor(artist, topItems), 37);
  assert.equal(topItemsAffinityFor(artist, { windows: { shortTerm: { status: 'fresh' }, mediumTerm: { status: 'unavailable' }, longTerm: { status: 'unavailable' } } }), 60);
  assert.equal(topItemsAffinityFor(artist, { windows: { shortTerm: { status: 'cached', expiresAt: '2026-07-01T00:00:00Z' } } }, new Date('2026-07-11T00:00:00Z')), 0);
});

test('uses Top Artists labels only when the required windows succeeded', () => {
  const topSnapshot = {
    topItems: { windows: {
      shortTerm: { status: 'fresh' },
      mediumTerm: { status: 'fresh' },
      longTerm: { status: 'fresh' }
    } },
    artists: [{ name: 'Artist One', seedStrength: 10, evidence: [], topEvidence: { shortTermRank: 2, mediumTermRank: 12, longTermRank: 18 } }]
  };
  const [ranked] = rankCandidates([candidate()], topSnapshot, config, new Date('2026-07-10T00:00:00Z'));
  assert.match(ranked.ranking.whyYou, /current top artist/);
  assert.match(ranked.ranking.whyYou, /sustained favorite/);
  const unavailable = { ...topSnapshot, topItems: { windows: { shortTerm: { status: 'fresh' }, mediumTerm: { status: 'unavailable' }, longTerm: { status: 'unavailable' } } } };
  const [fallback] = rankCandidates([candidate()], unavailable, config, new Date('2026-07-10T00:00:00Z'));
  assert.doesNotMatch(fallback.ranking.whyYou, /current surge/);
});

test('does not resolve conflicting normalized names without a provider identity', () => {
  const conflicting = {
    artists: [
      { spotifyArtistId: 'id-a', name: 'The Artist', seedStrength: 10, evidence: [] },
      { spotifyArtistId: 'id-b', name: 'The-Artist', seedStrength: 9, evidence: [] }
    ]
  };
  const [ranked] = rankCandidates([candidate({ performers: [{ name: 'the artist', primary: true }] })], conflicting, config);
  assert.equal(ranked.matchedArtists.length, 0);
});
