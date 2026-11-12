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

test('discovered artists are separated by how much of the profile\'s scenes their tags cover', async () => {
  const { buildSceneProfile, sceneFitFor, promoterAffinityFor } = await import('../src/ranking.js');
  const direct = (name, seedStrength, genres) => ({ name, seedStrength, genres, origin: 'source', evidence: [{}] });
  const found = (name, genres) => ({ name, seedStrength: 0, genres, origin: 'promoter' });
  const artists = [
    direct('Anchor One', 10, ['house', 'tech house', 'electronic', 'british']),
    direct('Anchor Two', 8, ['house', 'electronic', 'seen live']),
    direct('Anchor Three', 2, ['k-pop', 'pop']),
    // Every discovered artist is "electronic", so that tag separates none of them.
    ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id) => found(`Filler ${id}`, ['electronic', 'bass'])),
    found('House Act', ['house', 'tech house', 'electronic']),
    found('Techno Act', ['techno', 'electronic']),
    found('Untagged Act', [])
  ];
  const profile = buildSceneProfile(artists);
  assert.equal(profile.tags.has('british'), false, 'nationality and listener-habit tags are not scenes');
  assert.ok(profile.tags.get('electronic') < profile.tags.get('house'), 'a tag every discovery shares is discounted');
  const house = sceneFitFor(artists.find((artist) => artist.name === 'House Act'), profile);
  const techno = sceneFitFor(artists.find((artist) => artist.name === 'Techno Act'), profile);
  const untagged = sceneFitFor(artists.find((artist) => artist.name === 'Untagged Act'), profile);
  assert.ok(house.points > techno.points && techno.points >= untagged.points, `${house.points} > ${techno.points} >= ${untagged.points}`);
  assert.equal(untagged.points, 0, 'no tags is no evidence, not a penalty');
  assert.deepEqual(house.tags, ['house', 'tech house']);
  assert.equal(promoterAffinityFor({}, { scene: house }).affinity - promoterAffinityFor({}, {}).affinity, house.points);
});

test('a watched destination festival is ranked as a deliberate trip, not priced out by distance', () => {
  const far = candidate({
    id: 'tm:proper', title: 'Proper NYE', performers: [],
    venue: { name: 'Petco Park', city: 'San Diego', state: 'CA', lat: 32.7073, lon: -117.1566 },
    destination: { name: 'Proper NYE', distanceLabel: 'about 110 mi to San Diego' }
  });
  const [trip] = rankCandidates([far], { artists: [] }, config);
  const [drive] = rankCandidates([{ ...far, destination: undefined }], { artists: [] }, config);
  assert.equal(trip.ranking.discovery.tier, 'destination');
  assert.match(trip.ranking.whyYou, /destination watchlist/);
  assert.ok(trip.ranking.hassleReasons.some((reason) => /destination trip/.test(reason)));
  assert.ok(trip.ranking.hassleScore < drive.ranking.hassleScore);
  assert.ok(trip.ranking.utility >= config.minimumUtility, 'explicit interest clears the bar without a matched artist');
});
