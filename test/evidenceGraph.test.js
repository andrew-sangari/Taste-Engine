import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GRAPH_POLICY,
  buildEvidenceGraph,
  connectionPaths,
  constellation,
  describeNode,
  findScenes
} from '../src/evidenceGraph.js';
import { deriveFeedbackSignals, feedbackKeysFor } from '../src/feedbackPolicy.js';

const W = GRAPH_POLICY.weights;
const HOP = GRAPH_POLICY.hopAttenuation;

// A published music row. Matched artists carry the private fields real rows
// carry, so every test also proves they stay out of the graph.
const night = (id, {
  title = id, date = '2026-12-05', venue = 'The Echo', city = 'Los Angeles', promoters = [], performers = [],
  matched = [], lineup = null, destination = null, type = 'concert', utility = 40, discovery = {}
} = {}) => ({
  id,
  title,
  startLocal: `${date}T21:00:00`,
  eventType: type,
  venue: { name: venue, city },
  promoters,
  performers: performers.map((name, position) => ({ name, primary: position === 0 })),
  matchedArtists: matched.map(([name, origin]) => ({
    spotifyArtistId: `spotify-${name}`, name, seedStrength: 9, origin, matchMethod: 'spotify-id', primary: performers[0] === name
  })),
  lineupDisplay: lineup,
  destination,
  ranking: {
    utility,
    excluded: false,
    discovery: { tier: 'none', promoterShow: null, rosterPromoter: null, ...discovery },
    whyYou: 'Runs through 3 of your selected playlists.'
  }
});
const game = (id, away, { utility = 55 } = {}) => ({
  id,
  league: 'mlb',
  startLocal: '2026-12-06T13:10:00',
  venue: { name: 'Dodger Stadium', city: 'Los Angeles' },
  homeTeam: { name: 'Los Angeles Dodgers' },
  awayTeam: { name: away },
  ranking: { utility, excluded: false }
});
const taste = (...entries) => ({
  taste: new Map(entries.map(([key, score, label = key]) => [key, { key, category: key.split(':')[0], label, score, outcomes: 2 }])),
  friction: new Map()
});

const PROFILE = {
  topArtists: [
    { name: 'Josh Baker', relativeSignal: 100, origin: 'source', signalKind: 'direct', evidenceLabels: ['Secret Mix playlist'] },
    { name: 'Fred again..', relativeSignal: 97, origin: 'source', signalKind: 'direct', evidenceLabels: ['Secret Mix playlist'] }
  ],
  topTags: ['house']
};
const TOWN = [
  night('e1', { title: 'Josh Baker', venue: 'The Shrine', promoters: ['Framework'], performers: ['Josh Baker', 'Kettama'], matched: [['Josh Baker', 'source']], discovery: { tier: 'direct', promoterShow: 'Framework' }, utility: 60 }),
  night('e2', { title: 'Kettama', venue: 'Sound Nightclub', performers: ['KETTAMA (DJ Set)', 'Prospa'], utility: 30 }),
  night('e3', { title: 'Chris Stussy', venue: 'Hollywood Palladium', performers: ['Chris Stussy'], matched: [['Chris Stussy', 'promoter']], discovery: { tier: 'roster', rosterPromoter: 'Framework' }, utility: 35 }),
  night('e4', { title: 'CRSSD Spring 2027', type: 'festival', venue: 'Waterfront Park', city: 'San Diego', destination: { name: 'CRSSD', distanceLabel: '120 miles' }, discovery: { tier: 'destination' }, utility: 50 }),
  night('e5', { title: 'Aurora Lane', performers: ['Aurora Lane'], matched: [['Aurora Lane', 'similar']], discovery: { tier: 'similar' }, utility: 45 }),
  night('e6', { title: 'Unknown Band', venue: 'Nowhere Hall', performers: ['Unknown Band'], utility: 12 }),
  night('e7', { title: 'Mall Grab', performers: ['Mall Grab'], matched: [['Mall Grab', 'promoter']], discovery: { tier: 'roster' }, utility: 28 }),
  night('e8', { title: 'Mall Grab at Exchange', venue: 'Exchange LA', promoters: ['Insomniac'], performers: ['Mall Grab'], matched: [['Mall Grab', 'promoter']], discovery: { tier: 'promoter-night', promoterShow: 'Insomniac' }, utility: 33 }),
  night('e9', { title: 'Prospa', venue: 'The Novo', performers: ['Prospa'], utility: 20 }),
  night('e10', { title: 'Tagged Act', venue: 'The Roxy', performers: ['Tagged Act'], matched: [['Tagged Act', 'tag']], discovery: { tier: 'tag' }, utility: 25 })
];
const GAMES = [game('mlb:1', 'San Diego Padres')];
const town = (signals = null) => buildEvidenceGraph({ events: TOWN, sports: GAMES, tasteProfile: PROFILE, signals });

const nodeOf = (graph, id) => graph.nodes[graph.index.byId[id]];
const edgesOf = (graph, kind) => graph.edges.filter((edge) => edge.kind === kind);
const edge = (graph, kind, from, to) => graph.edges.find((item) => item.kind === kind && item.from === from && item.to === to);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-3, `${message ?? 'value'}: ${actual} vs ${expected}`);
const route = (path) => path.hops.map((hop) => hop.nodeId);
// A fixed permutation: no randomness in tests either.
const shuffled = (rows) => rows.map((row, position) => rows[(position * 7 + 3) % rows.length]);

test('every node kind is built once, with namespaced feedback-key ids', () => {
  const graph = town(taste(['shape:festival', 0.4, 'festivals']));
  assert.equal(graph.policyVersion, GRAPH_POLICY.version);
  assert.equal(graph.nodes[0].id, 'you');
  const kinds = new Set(graph.nodes.map((node) => node.kind));
  assert.deepEqual([...kinds].sort(), ['artist', 'event', 'game', 'opponent', 'promoter', 'shape', 'team', 'venue', 'you']);
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
  assert.deepEqual(nodeOf(graph, 'event:e1'), { id: 'event:e1', kind: 'event', label: 'Josh Baker', eventId: 'e1', startLocal: '2026-12-05T21:00:00', score: 60, shape: 'concert' });
  assert.deepEqual(nodeOf(graph, 'venue:the shrine los angeles'), { id: 'venue:the shrine los angeles', kind: 'venue', label: 'The Shrine', city: 'Los Angeles' });
  assert.deepEqual(nodeOf(graph, 'promoter:framework'), { id: 'promoter:framework', kind: 'promoter', label: 'Framework', followed: true });
  assert.equal(nodeOf(graph, 'game:mlb:1').label, 'San Diego Padres at Los Angeles Dodgers');
  assert.equal(nodeOf(graph, 'team:los angeles dodgers').kind, 'team');
  assert.equal(nodeOf(graph, 'opponent:san diego padres').kind, 'opponent');
  assert.equal(nodeOf(graph, 'event:e4').destination, 'CRSSD');
  // The same ids the feedback policy derives from the same rows.
  const keys = feedbackKeysFor(TOWN[0]);
  assert.ok(nodeOf(graph, keys.venue[0].key) && nodeOf(graph, keys.promoter[0].key));
  for (const entry of keys.artist) assert.equal(nodeOf(graph, entry.key).kind, 'artist');
  assert.ok(nodeOf(graph, feedbackKeysFor(GAMES[0], 'sports').opponent[0].key));
  // Tags are published only as profile-level strings, so there is no tag node.
  assert.ok(!graph.nodes.some((node) => node.kind === 'tag'));
});

test('artists are de-duplicated by normalized name and classified direct, adjacent or new', () => {
  const graph = town();
  const kettama = graph.nodes.filter((node) => node.id === 'artist:kettama');
  assert.equal(kettama.length, 1, 'two bills, two spellings, one node');
  assert.equal(kettama[0].label, 'Kettama');
  assert.equal(edgesOf(graph, 'plays').filter((item) => item.from === 'artist:kettama').length, 2);
  assert.equal(nodeOf(graph, 'artist:josh baker').relation, 'direct');
  assert.deepEqual([nodeOf(graph, 'artist:aurora lane').relation, nodeOf(graph, 'artist:aurora lane').via], ['adjacent', 'similar']);
  assert.deepEqual([nodeOf(graph, 'artist:tagged act').relation, nodeOf(graph, 'artist:tagged act').via], ['adjacent', 'tag']);
  assert.deepEqual([nodeOf(graph, 'artist:chris stussy').relation, nodeOf(graph, 'artist:chris stussy').via], ['adjacent', 'promoter']);
  assert.equal(nodeOf(graph, 'artist:kettama').relation, 'new');
  // A profile artist with no upcoming night is still something the person plays.
  assert.equal(nodeOf(graph, 'artist:fred again').relation, 'direct');
  // The lineup's own relation labels count when a row has no matched artist.
  const lineup = buildEvidenceGraph({
    events: [night('l1', { performers: ['Headliner'], lineup: { orderedArtists: [
      { displayName: 'Headliner', relation: 'direct', billingGroupIndex: 0, b2bWithNext: false },
      { displayName: 'Opener One', relation: 'adjacent', billingGroupIndex: 1, b2bWithNext: true },
      { displayName: 'Opener Two', relation: 'unknown', billingGroupIndex: 1, b2bWithNext: false }
    ] } })]
  });
  assert.deepEqual(['headliner', 'opener one', 'opener two'].map((name) => nodeOf(lineup, `artist:${name}`).relation), ['direct', 'adjacent', 'new']);
  assert.ok(!edge(lineup, 'near', 'you', 'artist:opener one'), 'an unexplained adjacency is not a taste claim');
  close(edge(lineup, 'shares-bill', 'artist:opener one', 'artist:opener two').weight, GRAPH_POLICY.sharedBill.b2b, 'a b2b pair is a strong tie');
  close(edge(lineup, 'shares-bill', 'artist:headliner', 'artist:opener one').weight, GRAPH_POLICY.sharedBill.base / Math.sqrt(2), 'three on a bill');
});

test('every edge kind is typed, weighted and labelled', () => {
  const graph = town();
  for (const item of graph.edges) {
    assert.ok(item.weight > 0 && item.weight <= 1, `${item.kind} weight ${item.weight}`);
    assert.ok(typeof item.evidence === 'string' && item.evidence.length > 0);
    assert.ok(nodeOf(graph, item.from) && nodeOf(graph, item.to), `${item.kind} ${item.from} -> ${item.to}`);
  }
  assert.deepEqual([...new Set(graph.edges.map((item) => item.kind))].sort(),
    ['at', 'books', 'follows', 'hosts', 'listens', 'near', 'plays', 'presents', 'rosters', 'shares-bill', 'visits', 'watching']);
  assert.equal(edge(graph, 'listens', 'you', 'artist:josh baker').weight, W.listensCore);
  assert.equal(edge(graph, 'near', 'you', 'artist:aurora lane').weight, W.nearSimilar);
  assert.equal(edge(graph, 'near', 'you', 'artist:tagged act').weight, W.nearTag);
  assert.ok(!graph.edges.some((item) => item.from === 'you' && item.to === 'artist:chris stussy'), 'a discovery path is not a preference');
  assert.deepEqual(edgesOf(graph, 'follows').map((item) => item.to), ['promoter:framework', 'promoter:insomniac', 'team:los angeles dodgers']);
  assert.equal(edge(graph, 'plays', 'artist:josh baker', 'event:e1').weight, W.playsPrimary);
  assert.equal(edge(graph, 'plays', 'artist:kettama', 'event:e1').weight, W.playsSupport);
  assert.ok(edge(graph, 'at', 'event:e1', 'venue:the shrine los angeles'));
  assert.ok(edge(graph, 'presents', 'promoter:framework', 'event:e1'));
  assert.ok(edge(graph, 'rosters', 'promoter:framework', 'artist:chris stussy'));
  assert.deepEqual(edge(graph, 'books', 'promoter:insomniac', 'artist:mall grab').count, 1);
  assert.ok(edge(graph, 'hosts', 'team:los angeles dodgers', 'game:mlb:1'));
  assert.ok(edge(graph, 'visits', 'opponent:san diego padres', 'game:mlb:1'));
  assert.ok(edge(graph, 'at', 'game:mlb:1', 'venue:dodger stadium los angeles'));
  assert.ok(edge(graph, 'watching', 'you', 'event:e4'));
  // The index is plain JSON and consistent with the arrays.
  assert.deepEqual(JSON.parse(JSON.stringify(graph)), graph);
  graph.edges.forEach((item, position) => {
    assert.ok(graph.index.out[item.from].includes(position) && graph.index.in[item.to].includes(position));
  });
  assert.equal(graph.edges[graph.index.anchor['artist:josh baker']].kind, 'listens');
});

test('a shared bill is one edge per pair and strengthens with every further bill', () => {
  const once = buildEvidenceGraph({ events: [night('a', { performers: ['Alpha', 'Beta'] })] });
  const twice = buildEvidenceGraph({ events: [night('a', { performers: ['Alpha', 'Beta'] }), night('b', { performers: ['Beta', 'Alpha'] })] });
  assert.equal(edgesOf(twice, 'shares-bill').length, 1);
  const [single, double] = [edgesOf(once, 'shares-bill')[0], edgesOf(twice, 'shares-bill')[0]];
  assert.deepEqual([double.from, double.to, double.count, double.evidence], ['artist:alpha', 'artist:beta', 2, '2 shared bills']);
  close(single.weight, GRAPH_POLICY.sharedBill.base);
  close(double.weight, 1 - (1 - GRAPH_POLICY.sharedBill.base) ** 2);
  // One festival-sized bill is too weak a tie to assert between any two acts.
  const festival = buildEvidenceGraph({ events: [night('f', { performers: Array.from({ length: 60 }, (_, n) => `Act ${n}`) })] });
  assert.equal(edgesOf(festival, 'shares-bill').length, 0);
  assert.equal(edgesOf(festival, 'plays').length, 60);
});

test('no private field reaches the graph or anything derived from it', () => {
  const graph = town(taste(['venue:the shrine los angeles', 0.5, 'The Shrine']));
  const everything = JSON.stringify([
    graph,
    TOWN.map((row) => connectionPaths(graph, row.id)),
    findScenes(graph, { minEvents: 1 }),
    constellation(graph, { includeGames: true }),
    graph.nodes.map((node) => describeNode(graph, node.id))
  ]);
  for (const banned of ['spotify', 'seedStrength', 'spotifyArtistId', 'Secret Mix', 'playlist', 'relativeSignal', 'matchMethod']) {
    assert.ok(!everything.toLowerCase().includes(banned.toLowerCase()), `${banned} leaked`);
  }
  const allowed = new Set(['id', 'kind', 'label', 'relation', 'via', 'eventId', 'startLocal', 'score', 'shape', 'destination', 'city', 'followed', 'league', 'aversion']);
  for (const node of graph.nodes) for (const key of Object.keys(node)) assert.ok(allowed.has(key), `unexpected node field ${key}`);
  for (const item of graph.edges) assert.deepEqual(Object.keys(item).filter((key) => key !== 'count'), ['from', 'to', 'kind', 'weight', 'evidence']);
});

test('feedback joins by key: a good outcome adds a learned edge, a bad one only an aversion', () => {
  assert.equal(edgesOf(town(), 'learned').length, 0, 'no signals, no learned edges');
  assert.equal(edgesOf(town({ taste: new Map(), friction: new Map() }), 'learned').length, 0);

  const graph = town(taste(
    ['venue:the shrine los angeles', 0.5, 'The Shrine'],
    ['artist:josh baker', -0.25, 'Josh Baker'],
    ['venue:nowhere hall los angeles', -0.8, 'Nowhere Hall'],
    ['artist:not on any bill', 0.9, 'Not On Any Bill'],
    ['shape:concert', -0.6, 'concerts'],
    ['opponent:san diego padres', 0.01, 'San Diego Padres']
  ));
  const learned = edgesOf(graph, 'learned');
  assert.deepEqual(learned.map((item) => item.to), ['venue:the shrine los angeles']);
  close(learned[0].weight, GRAPH_POLICY.learned.base + GRAPH_POLICY.learned.scale * 0.5);
  assert.equal(learned[0].evidence, 'learned from 2 outcomes');
  assert.equal(nodeOf(graph, 'artist:josh baker').aversion, 0.25);
  assert.equal(nodeOf(graph, 'venue:nowhere hall los angeles').aversion, 0.8);
  assert.ok(!nodeOf(graph, 'artist:not on any bill'), 'feedback alone never creates a node');
  assert.ok(!graph.nodes.some((node) => node.kind === 'shape'), 'a disliked kind of night creates nothing');

  // A poor rating weakens the route through the artist and creates none.
  const before = connectionPaths(town(), 'e1').find((path) => path.kind === 'artist');
  const after = connectionPaths(graph, 'e1').find((path) => path.kind === 'artist');
  close(before.strength, W.listensCore * W.playsPrimary * HOP);
  close(after.strength, before.strength * (1 - GRAPH_POLICY.aversionPenalty * 0.25));
  assert.deepEqual(connectionPaths(graph, 'e6'), [], 'a disliked venue is not a connection');

  // A plain object works as well as a Map, for signals that crossed JSON.
  const plain = town({ taste: { 'venue:the shrine los angeles': { score: 0.5, label: 'The Shrine' } } });
  assert.equal(edgesOf(plain, 'learned')[0].evidence, 'learned from your feedback');
});

test('real feedback records join the graph through the keys the policy froze', () => {
  const past = { ...TOWN[0], id: 'past-1', startLocal: '2026-10-10T21:00:00' };
  const signals = deriveFeedbackSignals([{
    feedbackId: 'f1', canonicalEventId: 'past-1', eventDateLocal: '2026-10-10', eventTitleSnapshot: 'Josh Baker',
    status: 'attended-worth-it', rating: 5, reasonCodes: [], signalTags: [], recordedAt: '2026-10-11T18:00:00Z',
    feedbackKeys: feedbackKeysFor(past)
  }], { now: new Date('2026-11-01T12:00:00Z') });
  const graph = town(signals);
  assert.deepEqual(edgesOf(graph, 'learned').map((item) => item.to),
    ['artist:josh baker', 'artist:kettama', 'promoter:framework', 'shape:concert', 'venue:the shrine los angeles']);
  assert.equal(nodeOf(graph, 'shape:concert').label, 'concerts');
  assert.equal(edgesOf(graph, 'is-a').length, TOWN.filter((row) => row.eventType === 'concert').length);
  assert.ok(edgesOf(graph, 'learned').every((item) => item.evidence === 'learned from 1 outcome'));
});

test('each kind of route is found, with its exact sentence', () => {
  const graph = town();
  const only = (eventId) => {
    const paths = connectionPaths(graph, eventId);
    assert.equal(paths.length, 1, `${eventId} has one route`);
    return paths[0];
  };

  const [artist, promoter] = connectionPaths(graph, 'e1');
  assert.equal(connectionPaths(graph, 'e1').length, 2);
  assert.deepEqual([artist.kind, artist.text], ['artist', 'You play Josh Baker, who is on the bill.']);
  assert.deepEqual(artist.hops, [
    { nodeId: 'you', label: 'You', nodeKind: 'you', via: null },
    { nodeId: 'artist:josh baker', label: 'Josh Baker', nodeKind: 'artist', via: 'listens' },
    { nodeId: 'event:e1', label: 'Josh Baker', nodeKind: 'event', via: 'plays' }
  ]);
  assert.deepEqual([promoter.kind, promoter.text], ['promoter', 'You follow Framework, which presents this night.']);
  assert.deepEqual(route(promoter), ['you', 'promoter:framework', 'event:e1']);
  close(promoter.strength, W.followsPromoter * W.presents * HOP);

  const shared = only('e2');
  assert.deepEqual([shared.kind, shared.text], ['shared-bill', 'Kettama shares another upcoming bill with Josh Baker, whom you play.']);
  assert.deepEqual(shared.hops.map((hop) => hop.via), [null, 'listens', 'shares-bill', 'plays']);
  close(shared.strength, W.listensCore * GRAPH_POLICY.sharedBill.base * W.playsPrimary * HOP ** 2);

  const roster = only('e3');
  assert.deepEqual([roster.kind, roster.text], ['roster', 'Chris Stussy is on the roster of Framework, which you follow.']);
  close(roster.strength, W.followsPromoter * W.rosters * W.playsPrimary * HOP ** 2);

  const watching = only('e4');
  assert.deepEqual([watching.kind, watching.text, watching.strength], ['watchlist', 'CRSSD is on your destination watchlist.', W.watching]);
  assert.deepEqual(watching.hops.map((hop) => [hop.nodeId, hop.via]), [['you', null], ['event:e4', 'watching']]);

  const near = only('e5');
  assert.deepEqual([near.kind, near.text], ['near-artist', 'Aurora Lane is on the bill and sits close to what you play.']);
  close(near.strength, W.nearSimilar * W.playsPrimary * HOP);
  close(only('e10').strength, W.nearTag * W.playsPrimary * HOP, 'a tag match is weaker than a similar artist');

  const booking = only('e7');
  assert.deepEqual([booking.kind, booking.text], ['booking', 'Mall Grab plays another upcoming night for Insomniac, which you follow.']);
  assert.deepEqual(route(booking), ['you', 'promoter:insomniac', 'artist:mall grab', 'event:e7']);
  // On the promoter's own night the booking is that night, not another one.
  assert.deepEqual(connectionPaths(graph, 'e8').map((path) => path.kind), ['promoter']);

  const chained = only('e9');
  assert.equal(chained.text, 'Prospa shares another upcoming bill with Kettama, who shares one with Josh Baker, whom you play.');
  assert.equal(chained.hops.length - 1, 4);

  const home = only('mlb:1');
  assert.deepEqual([home.kind, home.text], ['home-team', 'You follow the Los Angeles Dodgers, and this is a home game.']);
  close(home.strength, W.followsTeam * W.hosts * HOP);

  assert.deepEqual(connectionPaths(graph, 'e6'), [], 'no route is a valid answer');
  assert.deepEqual(connectionPaths(graph, 'no-such-event'), []);
  assert.deepEqual(connectionPaths(graph, 'event:e1'), connectionPaths(graph, 'e1'), 'a node id works as well as a row id');
});

test('learned routes read as what the person has rated, for every kind of key', () => {
  const graph = town(taste(
    ['venue:the shrine los angeles', 0.5, 'The Shrine'],
    ['artist:kettama', 0.6, 'Kettama'],
    ['promoter:insomniac', 0.6, 'Insomniac'],
    ['shape:festival', 0.4, 'festivals'],
    ['opponent:san diego padres', 0.5, 'San Diego Padres'],
    ['venue:dodger stadium los angeles', 0.3, 'Dodger Stadium']
  ));
  const texts = (eventId) => connectionPaths(graph, eventId).map((path) => `${path.kind}: ${path.text}`);
  assert.deepEqual(texts('e1'), [
    'artist: You play Josh Baker, who is on the bill.',
    'learned: You have rated nights at The Shrine well.',
    'promoter: You follow Framework, which presents this night.',
    // Kettama is support on this bill, so the route through them is weakest.
    'learned: You have rated nights with Kettama well, and Kettama is on the bill.'
  ]);
  assert.deepEqual(texts('e2'), ['learned: You have rated nights with Kettama well, and Kettama is on the bill.']);
  // A well-rated promoter outranks merely following it; it is still one route.
  assert.deepEqual(texts('e8'), ['learned: You have rated Insomniac nights well.']);
  assert.deepEqual(texts('e4'), ['watchlist: CRSSD is on your destination watchlist.', 'learned: You have rated festivals well.']);
  assert.deepEqual(texts('mlb:1'), [
    'home-team: You follow the Los Angeles Dodgers, and this is a home game.',
    'learned: You have rated games against the San Diego Padres well.',
    'learned: You have rated games at Dodger Stadium well.'
  ]);
  assert.deepEqual(texts('e9'), ['shared-bill: Prospa shares another upcoming bill with Kettama, whom you have rated well.']);
});

test('routes are ordered by strength, independent, and bounded by maxPaths and maxHops', () => {
  const graph = town(taste(['venue:the shrine los angeles', 0.5, 'The Shrine']));
  const paths = connectionPaths(graph, 'e1');
  assert.deepEqual(paths.map((path) => path.kind), ['artist', 'learned', 'promoter']);
  close(paths[1].strength, (GRAPH_POLICY.learned.base + GRAPH_POLICY.learned.scale * 0.5) * W.at * HOP);
  assert.deepEqual(connectionPaths(graph, 'e1', { maxPaths: 2 }).map((path) => path.kind), ['artist', 'learned']);
  assert.deepEqual(connectionPaths(graph, 'e1', { maxPaths: 0 }), []);

  assert.equal(connectionPaths(graph, 'e9', { maxHops: 4 }).length, 1);
  assert.deepEqual(connectionPaths(graph, 'e9', { maxHops: 3 }), [], 'the only route to this night is four hops long');
  assert.equal(connectionPaths(graph, 'e2', { maxHops: 3 }).length, 1);
  assert.deepEqual(connectionPaths(graph, 'e2', { maxHops: 2 }), []);
  assert.deepEqual(connectionPaths(graph, 'e4', { maxHops: 1 }).map((path) => path.kind), ['watchlist']);
  assert.deepEqual(connectionPaths(graph, 'e1', { maxHops: 1 }), []);

  // Two artists the person plays both share other bills with the same support
  // act. That is one route to the support act's own night, not two.
  const crowded = buildEvidenceGraph({
    events: [
      night('x1', { performers: ['Known One', 'Support'], matched: [['Known One', 'source']] }),
      night('x2', { performers: ['Known Two', 'Support'], matched: [['Known Two', 'source']] }),
      night('x3', { performers: ['Known Three', 'Other Support'], matched: [['Known Three', 'source']] }),
      night('x4', { performers: ['Support', 'Other Support'] })
    ]
  });
  const routes = connectionPaths(crowded, 'x4');
  assert.deepEqual(routes.map(route), [
    ['you', 'artist:known one', 'artist:support', 'event:x4'],
    ['you', 'artist:known three', 'artist:other support', 'event:x4']
  ]);
  assert.ok(routes[0].strength > routes[1].strength, 'the headliner of the night carries the stronger route');

  for (const graphUnderTest of [graph, crowded, town()]) {
    for (const event of graphUnderTest.nodes.filter((node) => node.kind === 'event' || node.kind === 'game')) {
      const found = connectionPaths(graphUnderTest, event.id, { maxPaths: 10, maxHops: 5 });
      const firstHops = found.map((path) => path.hops[1].nodeId);
      assert.equal(new Set(firstHops).size, firstHops.length, 'no two routes leave you the same way');
      const interior = found.flatMap((path) => route(path).slice(1, -1));
      assert.equal(new Set(interior).size, interior.length, 'routes share nothing but you and the event');
      for (const path of found) {
        assert.equal(new Set(route(path)).size, path.hops.length, 'no route repeats a node');
        assert.ok(path.strength > 0 && path.strength <= 1);
        assert.deepEqual([path.hops[0].nodeId, path.hops[path.hops.length - 1].nodeId], ['you', event.id]);
        assert.ok(path.hops.slice(1, -1).every((hop) => hop.nodeKind !== 'event' && hop.nodeKind !== 'game'), 'another night is never a stepping stone');
      }
      assert.deepEqual(found.map((path) => path.strength), found.map((path) => path.strength).sort((a, b) => b - a));
    }
  }
});

test('past and excluded rows are left out, and a duplicate id is one event', () => {
  const rows = [
    night('old', { date: '2026-11-30', performers: ['Gone'] }),
    night('today', { date: '2026-12-01', performers: ['Here'] }),
    { ...night('cut', { performers: ['Hidden'] }), ranking: { utility: -100, excluded: true } },
    night('today', { date: '2026-12-01', performers: ['Here'] })
  ];
  const events = (graph) => graph.nodes.filter((node) => node.kind === 'event').map((node) => node.id);
  assert.deepEqual(events(buildEvidenceGraph({ events: rows })), ['event:old', 'event:today']);
  assert.deepEqual(events(buildEvidenceGraph({ events: rows, now: '2026-12-01' })), ['event:today']);
  assert.deepEqual(events(buildEvidenceGraph({ events: rows, now: '2026-12-01T23:30:00' })), ['event:today']);
  assert.ok(!nodeOf(buildEvidenceGraph({ events: rows, now: '2026-12-01' }), 'artist:gone'));
  assert.deepEqual(buildEvidenceGraph().nodes, [{ id: 'you', kind: 'you', label: 'You' }]);
  assert.deepEqual(buildEvidenceGraph({ events: null, sports: undefined }).edges, []);
});

// Three clusters of artists the person has never played: one tied by a
// followed promoter's room, one by shared bills and reached through an artist
// the person plays, and one with no tie to the person at all.
const SCENE_ROWS = [
  night('f1', { title: 'Framework: Nova', venue: 'Sears Building', promoters: ['Framework'], performers: ['Nova One', 'Nova Two'], utility: 30, date: '2026-12-10' }),
  night('f2', { title: 'Framework: Nova II', venue: 'Sears Building', promoters: ['Framework'], performers: ['Nova Two', 'Nova Three'], utility: 34, date: '2026-12-17' }),
  night('b1', { title: 'Josh Baker', venue: 'The Shrine', performers: ['Josh Baker', 'Lumen'], matched: [['Josh Baker', 'source']], utility: 55, date: '2026-12-11' }),
  night('b2', { title: 'Lumen', venue: 'The Echo', performers: ['Lumen', 'Mira'], utility: 22, date: '2026-12-12' }),
  night('u1', { title: 'Orphans', venue: 'Zebulon', performers: ['Orphan One', 'Orphan Two'], utility: 15, date: '2026-12-13' }),
  night('u2', { title: 'Orphans II', venue: 'The Smell', performers: ['Orphan Two', 'Orphan Three'], utility: 15, date: '2026-12-14' })
];

test('scenes: two anchored clusters are found and the unanchored one is not', () => {
  const graph = buildEvidenceGraph({ events: SCENE_ROWS });
  const scenes = findScenes(graph);
  assert.deepEqual(scenes.map((scene) => scene.label), ['Around Josh Baker', 'Framework at Sears Building']);

  const [around, room] = scenes;
  assert.deepEqual(around, {
    id: 'scene:lumen',
    label: 'Around Josh Baker',
    basis: 'bridge-artist',
    artists: [
      { name: 'Josh Baker', relation: 'direct', known: true },
      { name: 'Lumen', relation: 'new', known: false },
      { name: 'Mira', relation: 'new', known: false }
    ],
    events: [
      { id: 'b1', title: 'Josh Baker', startLocal: '2026-12-11T21:00:00', score: 55 },
      { id: 'b2', title: 'Lumen', startLocal: '2026-12-12T21:00:00', score: 22 }
    ],
    venues: ['The Echo', 'The Shrine'],
    promoters: [],
    bridges: [{ from: 'Josh Baker', to: 'Lumen', via: 'shared bill', strength: 0.51 }],
    knownCount: 1,
    newCount: 2,
    strength: 1.02
  });
  assert.equal(room.basis, 'promoter-venue');
  assert.deepEqual(room.artists.map((artist) => artist.name), ['Nova Two', 'Nova One', 'Nova Three']);
  assert.deepEqual(room.events.map((event) => event.id), ['f2', 'f1'], 'highest score first');
  assert.deepEqual([room.venues, room.promoters, room.knownCount, room.newCount], [['Sears Building'], ['Framework'], 0, 3]);
  assert.ok(room.bridges.length === GRAPH_POLICY.scenes.maxBridgesPerAnchor && room.bridges.every((bridge) => bridge.from === 'Framework' && bridge.via === 'promoter night'));
  close(room.strength, 2 * W.followsPromoter * GRAPH_POLICY.scenes.promoterBridge);

  const everyName = scenes.flatMap((scene) => scene.artists.map((artist) => artist.name));
  assert.ok(!everyName.some((name) => name.startsWith('Orphan')), 'no bridge, no scene');
  assert.deepEqual(findScenes(graph, { maxScenes: 1 }).map((scene) => scene.id), ['scene:lumen']);
  assert.deepEqual(findScenes(graph, { minEvents: 3 }), []);
  assert.deepEqual(findScenes(graph, { maxScenes: 0 }), []);
  assert.deepEqual(findScenes(buildEvidenceGraph({ events: SCENE_ROWS.slice(4) })), [], 'nothing anchored, nothing returned');
  assert.deepEqual(findScenes(buildEvidenceGraph({ events: shuffled(SCENE_ROWS) })), scenes, 'input order does not matter');
});

test('scenes: feedback can anchor a cluster or remove an artist from one', () => {
  const liked = buildEvidenceGraph({ events: SCENE_ROWS, signals: taste(['venue:zebulon los angeles', 0.6, 'Zebulon']) });
  const orphans = findScenes(liked).find((scene) => scene.artists.some((artist) => artist.name === 'Orphan One'));
  assert.ok(orphans, 'a well-rated venue is a bridge');
  assert.deepEqual([orphans.label, orphans.bridges[0].via, orphans.bridges[0].from], ['Around Orphan Two', 'venue', 'Zebulon']);

  // An artist rated well is known, not new: it bridges instead of belonging.
  const known = buildEvidenceGraph({ events: SCENE_ROWS, signals: taste(['artist:orphan two', 0.7, 'Orphan Two']) });
  assert.ok(!findScenes(known).some((scene) => scene.artists.some((artist) => artist.name.startsWith('Orphan'))), 'one artist either side of a known one is not a cluster');

  const disliked = buildEvidenceGraph({ events: SCENE_ROWS, signals: taste(['artist:mira', -0.6, 'Mira']) });
  assert.ok(!findScenes(disliked).some((scene) => scene.artists.some((artist) => artist.name === 'Mira')));
});

test('constellation: rings, finite deterministic angles, and links between shown nodes only', () => {
  const graph = town();
  const drawn = constellation(graph);
  assert.deepEqual(drawn, constellation(town()));
  assert.deepEqual(drawn.nodes[0], { id: 'you', kind: 'you', label: 'You', ring: 0, angle: 0, weight: 1 });
  const ring = Object.fromEntries(drawn.nodes.map((node) => [node.id, node.ring]));
  assert.equal(ring['artist:josh baker'], 1);
  assert.equal(ring['promoter:framework'], 1);
  assert.equal(ring['promoter:insomniac'], 1);
  assert.equal(ring['artist:fred again'], undefined, 'an anchor with no shown night is not drawn');
  for (const row of TOWN) assert.equal(ring[`event:${row.id}`], 2);
  assert.equal(ring['artist:kettama'], 3);
  assert.equal(ring['artist:aurora lane'], 3, 'similar to your listening is still new to you');
  assert.equal(ring['game:mlb:1'], undefined);
  assert.equal(constellation(graph, { includeGames: true }).nodes.find((node) => node.id === 'game:mlb:1').ring, 2);

  const ids = new Set(drawn.nodes.map((node) => node.id));
  assert.equal(ids.size, drawn.nodes.length);
  for (const node of drawn.nodes) {
    assert.ok(Number.isFinite(node.angle) && node.angle >= 0 && node.angle < Math.PI * 2, `${node.id} angle ${node.angle}`);
    assert.ok(node.weight >= 0 && node.weight <= 1);
    assert.ok([0, 1, 2, 3].includes(node.ring));
    if (node.ring >= 2) assert.ok(TOWN.some((row) => row.id === node.eventId), `${node.id} names an event`);
  }
  for (const link of drawn.links) {
    assert.ok(ids.has(link.from) && ids.has(link.to), `${link.kind} ${link.from} -> ${link.to}`);
    assert.ok(link.weight > 0 && link.weight <= 1);
  }
  const has = (from, to, kind) => drawn.links.some((link) => link.from === from && link.to === to && link.kind === kind);
  assert.ok(has('you', 'artist:josh baker', 'listens') && has('artist:josh baker', 'event:e1', 'plays'));
  assert.ok(has('you', 'event:e4', 'watching') && has('promoter:framework', 'event:e1', 'presents'));
  assert.ok(has('artist:josh baker', 'artist:kettama', 'shares-bill') && has('promoter:framework', 'artist:chris stussy', 'rosters'));
  assert.ok(has('promoter:insomniac', 'artist:mall grab', 'books') && has('artist:kettama', 'event:e2', 'plays'));

  // Related nodes sit together: a night is drawn near the thing that explains it.
  const angle = Object.fromEntries(drawn.nodes.map((node) => [node.id, node.angle]));
  const apart = (a, b) => Math.abs(Math.atan2(Math.sin(angle[a] - angle[b]), Math.cos(angle[a] - angle[b])));
  assert.ok(apart('event:e8', 'promoter:insomniac') < 0.4, `${apart('event:e8', 'promoter:insomniac')}`);
  assert.ok(apart('event:e2', 'artist:josh baker') < 0.6);
  assert.ok(apart('artist:mall grab', 'promoter:insomniac') < 0.6);
  const events = drawn.nodes.filter((node) => node.ring === 2).map((node) => node.angle).sort((a, b) => a - b);
  const gaps = events.map((value, position) => (position ? value - events[position - 1] : value + Math.PI * 2 - events[events.length - 1]));
  assert.ok(Math.min(...gaps) >= GRAPH_POLICY.constellation.minEventGap - 1e-6, 'events do not overlap');
});

test('constellation: independent of input order and keeps the highest-scoring events', () => {
  const reordered = buildEvidenceGraph({ events: shuffled(TOWN), sports: GAMES, tasteProfile: { ...PROFILE, topArtists: [...PROFILE.topArtists].reverse() } });
  assert.notDeepEqual(shuffled(TOWN).map((row) => row.id), TOWN.map((row) => row.id));
  assert.deepEqual(reordered, town());
  assert.deepEqual(constellation(reordered), constellation(town()));
  assert.deepEqual(TOWN.map((row) => connectionPaths(reordered, row.id)), TOWN.map((row) => connectionPaths(town(), row.id)));

  const top = constellation(town(), { maxEvents: 3 });
  assert.deepEqual(top.nodes.filter((node) => node.ring === 2).map((node) => node.eventId).sort(), ['e1', 'e4', 'e5']);
  assert.ok(!top.nodes.some((node) => node.id === 'promoter:insomniac'), 'anchors of dropped events are dropped with them');
  assert.deepEqual(constellation(town(), { maxEvents: 0 }), { nodes: [{ id: 'you', kind: 'you', label: 'You', ring: 0, angle: 0, weight: 1 }], links: [] });
  assert.deepEqual(constellation(buildEvidenceGraph()).nodes.length, 1);

  // A crowded ring still places everything, in order, without collisions.
  const crowd = buildEvidenceGraph({ events: Array.from({ length: 80 }, (_, n) => night(`c${n}`, { performers: ['Josh Baker', `Guest ${n}`], matched: [['Josh Baker', 'source']], utility: n })) });
  const full = constellation(crowd, { maxEvents: 80 });
  const angles = full.nodes.filter((node) => node.ring === 2).map((node) => node.angle);
  assert.equal(new Set(angles).size, 80);
  assert.ok(angles.every((value) => Number.isFinite(value)));
});

test('describeNode gives a readout for every kind and null for an unknown id', () => {
  const graph = town(taste(['venue:the shrine los angeles', 0.5, 'The Shrine'], ['artist:tagged act', -0.4, 'Tagged Act']));
  assert.deepEqual(describeNode(graph, 'artist:josh baker'), {
    label: 'Josh Baker', kind: 'artist', summary: 'In your rotation. On 1 upcoming bill.',
    events: [{ id: 'e1', title: 'Josh Baker', startLocal: '2026-12-05T21:00:00' }]
  });
  assert.deepEqual(describeNode(graph, 'artist:kettama'), {
    label: 'Kettama', kind: 'artist', summary: 'New to you. On 2 upcoming bills. Shares a bill with Josh Baker, whom you play.',
    events: [{ id: 'e1', title: 'Josh Baker', startLocal: '2026-12-05T21:00:00' }, { id: 'e2', title: 'Kettama', startLocal: '2026-12-05T21:00:00' }]
  });
  assert.equal(describeNode(graph, 'artist:chris stussy').summary, 'Found through a promoter you follow; no listening of your own yet. On 1 upcoming bill. On the Framework roster.');
  assert.equal(describeNode(graph, 'artist:aurora lane').summary, 'Similar to artists you play; no listening of your own yet. On 1 upcoming bill.');
  assert.equal(describeNode(graph, 'artist:tagged act').summary, 'From a tag cluster you play; no listening of your own yet. On 1 upcoming bill. You have rated their nights poorly.');
  assert.equal(describeNode(graph, 'artist:fred again').summary, 'In your rotation. On 0 upcoming bills.');
  assert.deepEqual(describeNode(graph, 'event:e1'), {
    label: 'Josh Baker', kind: 'event', summary: 'At The Shrine, presented by Framework. 2 artists on the bill, 1 in your rotation.',
    events: [{ id: 'e1', title: 'Josh Baker', startLocal: '2026-12-05T21:00:00' }]
  });
  assert.equal(describeNode(graph, 'event:e4').summary, 'At Waterfront Park. 0 artists on the bill. On your destination watchlist.');
  assert.equal(describeNode(graph, 'venue:the shrine los angeles').summary, '1 upcoming date in Los Angeles. You have rated nights here well.');
  assert.equal(describeNode(graph, 'venue:the echo los angeles').events.length, 2);
  assert.equal(describeNode(graph, 'promoter:framework').summary, 'A promoter you follow. Presents 1 upcoming night. 1 roster artist is on upcoming bills.');
  assert.equal(describeNode(graph, 'team:los angeles dodgers').summary, 'A home team you follow. 1 upcoming home game.');
  assert.equal(describeNode(graph, 'opponent:san diego padres').summary, 'Visiting for 1 upcoming game.');
  assert.equal(describeNode(graph, 'game:mlb:1').summary, 'San Diego Padres at Los Angeles Dodgers, at Dodger Stadium.');
  assert.deepEqual(describeNode(graph, 'you'), {
    label: 'You', kind: 'you', summary: '1 artist you play is on upcoming bills, and you follow 2 promoters.',
    events: [{ id: 'e4', title: 'CRSSD Spring 2027', startLocal: '2026-12-05T21:00:00' }]
  });
  assert.equal(describeNode(graph, 'artist:nobody'), null);
  assert.equal(describeNode(null, 'you'), null);
});

const PROJECTION = fileURLToPath(new URL('../site/app/data/upcoming.json', import.meta.url));
const readProjection = () => {
  try {
    return existsSync(PROJECTION) ? JSON.parse(readFileSync(PROJECTION, 'utf8')) : null;
  } catch {
    // Mid-rewrite by a refresh: treat it as missing rather than fail.
    return null;
  }
};
const projection = readProjection();

test('smoke: the published projection builds a consistent graph quickly', { skip: !projection && 'site/app/data/upcoming.json is not available' }, () => {
  const started = performance.now();
  const graph = buildEvidenceGraph(projection);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `built in ${elapsed.toFixed(1)} ms`);

  for (const item of graph.edges) {
    assert.ok(graph.index.byId[item.from] !== undefined && graph.index.byId[item.to] !== undefined, `${item.kind} ${item.from} -> ${item.to}`);
    assert.ok(item.weight > 0 && item.weight <= 1);
  }
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
  assert.ok(!/spotify|seedstrength|playlist/i.test(JSON.stringify(graph)), 'no private field in the graph');

  const events = projection.events ?? [];
  const rows = [...events, ...(projection.sports ?? [])];
  const pathsStarted = performance.now();
  const paths = new Map(rows.map((row) => [row.id, connectionPaths(graph, row.id)]));
  const pathsElapsed = performance.now() - pathsStarted;
  assert.ok(pathsElapsed < 250, `every route in ${pathsElapsed.toFixed(1)} ms`);
  for (const found of paths.values()) {
    const interior = found.flatMap((path) => path.hops.slice(1, -1).map((hop) => hop.nodeId));
    assert.equal(new Set(interior).size, interior.length);
    assert.ok(found.every((path) => path.strength > 0 && path.strength <= 1 && path.text.endsWith('.')));
  }
  const followed = new Set(graph.nodes.filter((node) => node.kind === 'promoter' && node.followed).map((node) => node.label.toLowerCase()));
  const both = events.filter((row) => !row.ranking?.excluded
    && (row.matchedArtists ?? []).some((artist) => ['source', 'top-items'].includes(artist.origin ?? 'source'))
    && (row.promoters ?? []).some((name) => followed.has(String(name).toLowerCase())));
  if (both.length) {
    assert.ok(events.some((row) => paths.get(row.id).length >= 2), 'an artist you play on a followed promoter night is two routes');
    for (const row of both) assert.ok(paths.get(row.id).length >= 2, `${row.id} has two independent routes`);
  }

  const scenes = findScenes(graph);
  assert.ok(scenes.every((scene) => scene.events.length >= 2 && scene.bridges.length > 0 && scene.strength > 0));
  const drawn = constellation(graph);
  const ids = new Set(drawn.nodes.map((node) => node.id));
  assert.ok(drawn.nodes.every((node) => Number.isFinite(node.angle)));
  assert.ok(drawn.links.every((link) => ids.has(link.from) && ids.has(link.to)));
  assert.ok(drawn.nodes.filter((node) => node.ring === 2).length <= 40);
  assert.deepEqual(buildEvidenceGraph({ ...projection, events: [...events].reverse() }), graph, 'independent of row order');
});
