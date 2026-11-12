import { normalizeArtistName, PROMOTER_SOURCES } from './ranking.js';

// The evidence graph. Pure (no I/O, no clock, no randomness): the site runs it
// in the browser through a generated bundle, on the published projection only.
//
// A published card already carries the relationships that explain its rank
// (who on the bill is in the profile, the lineup, the venue, the followed
// promoter), but only as features of that one card. This module makes them
// first-class as a typed graph so a night can be explained through several
// independent routes, clusters of unfamiliar nights can be surfaced as scenes,
// and the whole thing can be drawn.
//
// It is explanation and discovery only. Nothing here changes a score or an
// ordering; `score` on an event node is the published utility, copied.
//
// What may appear in a node or an edge: display names, coarse relation labels
// and counts. Spotify ids, seed strengths, ranks and playlist names are never
// read into a payload, and no weight is derived from them: an artist is
// "in your rotation" or not, at two coarse levels.
//
// Ids are the feedback keys (`artist:josh baker`, `venue:the shrine los
// angeles`, `promoter:framework`, `opponent:san diego padres`, `shape:festival`),
// so learned feedback joins by key with no second normalization.
//
// Output is independent of input order: rows are sorted by id before anything
// is derived, nodes are sorted by id and edges by (kind, from, to).
export const GRAPH_POLICY = Object.freeze({
  version: 1,
  // Each hop after the first multiplies a path's strength by this.
  hopAttenuation: 0.85,
  // A node rated poorly multiplies every path through it by 1 - penalty * aversion.
  aversionPenalty: 0.8,
  weights: Object.freeze({
    listensCore: 1,
    listens: 0.85,
    nearSimilar: 0.55,
    nearTag: 0.4,
    followsPromoter: 0.6,
    followsTeam: 0.7,
    watching: 0.9,
    playsPrimary: 1,
    playsSupport: 0.8,
    at: 1,
    presents: 1,
    rosters: 0.7,
    // One upcoming night for a promoter; more nights combine as 1 - (1 - books)^n.
    books: 0.5,
    hosts: 1,
    visits: 1,
    isA: 0.6
  }),
  // A learned taste score in [-1, 1]. Above minScore it becomes an edge of
  // weight base + scale * score; below -minScore it becomes an aversion.
  learned: Object.freeze({ minScore: 0.05, base: 0.35, scale: 0.65 }),
  // One shared bill of n artists contributes base / sqrt(n - 1); a b2b pair
  // contributes at least b2b. Bills combine as 1 - prod(1 - c). Pairs below
  // minWeight (one festival-sized bill) are not emitted.
  sharedBill: Object.freeze({ base: 0.6, b2b: 0.8, minWeight: 0.1 }),
  paths: Object.freeze({ maxPaths: 4, maxHops: 4, hardMaxHops: 5, minStrength: 0.05 }),
  scenes: Object.freeze({
    minTie: 0.25,
    minArtists: 2,
    maxArtists: 16,
    maxArtistsListed: 12,
    maxBridges: 6,
    maxBridgesPerAnchor: 2,
    promoterBridge: 0.5,
    venueBridge: 0.5,
    nearBridge: 0.5,
    dominantShare: 0.5
  }),
  constellation: Object.freeze({
    maxNewPerEvent: 3,
    minEventGap: 0.12,
    minOuterGap: 0.06,
    indirectPull: 0.5,
    adjacentWeight: 0.5,
    newWeight: 0.35
  })
});

const TWO_PI = Math.PI * 2;
const DIRECT_ORIGINS = ['source', 'top-items'];
// Which matched-artist origins a discovery tier's "strongest match" can have.
const TIER_ORIGINS = {
  direct: DIRECT_ORIGINS,
  similar: ['similar'],
  tag: ['tag'],
  roster: ['promoter'],
  'promoter-night': ['promoter']
};
const LEARNED_NODE_CATEGORIES = ['artist', 'venue', 'promoter', 'opponent'];

/**
 * Build the typed graph from published rows.
 *
 * Node kinds: `you`, `artist` (relation direct | adjacent | new), `event`,
 * `game`, `venue`, `promoter`, `team`, `opponent`, and `shape` (only for a
 * kind of night the person has rated well).
 *
 * Edge kinds: `listens`, `near`, `follows`, `learned`, `watching` (out of
 * you); `plays` (artist -> event); `at` (event|game -> venue); `presents`
 * (promoter -> event); `rosters` (promoter -> artist on its roster); `books`
 * (promoter -> artist on one of its upcoming nights); `shares-bill` (artist
 * pair, emitted once with from < to); `hosts` (team -> game); `visits`
 * (opponent -> game); `is-a` (event|game -> shape).
 *
 * `now` drops rows whose local date has passed. A `YYYY-MM-DD...` string is
 * taken as the local date and is fully deterministic; a Date or number uses
 * the runtime's local calendar date, as the site's own date boundary does.
 *
 * `index` is plain JSON: `byId` (node id -> node index), `out` / `in` (node id
 * -> edge indices), `bill` (artist id -> its shares-bill edge indices, either
 * end), `anchoredBill` (the subset whose other end the person is tied to) and
 * `anchor` (node id -> index of the strongest edge from you).
 */
export function buildEvidenceGraph({ events = [], sports = [], tasteProfile = null, signals = null, now = null } = {}) {
  const W = GRAPH_POLICY.weights;
  const today = localDateKey(now);
  const nodes = new Map([['you', { id: 'you', kind: 'you', label: 'You' }]]);
  const edges = new Map();
  const put = (id, fields) => {
    if (!nodes.has(id)) nodes.set(id, { id, ...fields });
    return nodes.get(id);
  };
  const link = (from, to, kind, weight, evidence, extra = {}) => {
    const key = `${kind}|${from}|${to}`;
    const current = edges.get(key);
    if (!current || weight > current.weight) edges.set(key, { from, to, kind, weight: round(clamp(weight)), evidence, ...extra });
  };

  const artists = new Map();
  const seeArtist = (name, rank) => {
    const label = clean(name);
    const key = normalizeArtistName(label);
    if (!key) return null;
    const id = `artist:${key}`;
    const artist = artists.get(id) ?? { id, label, rank, direct: false, core: false, similar: false, tag: false, promoter: false, adjacent: false };
    // One display name per artist: the profile's spelling, then the bill's,
    // then the lineup's; within a source the plainest (shortest) one.
    const better = rank - artist.rank || label.length - artist.label.length || cmp(label, artist.label);
    if (better < 0) Object.assign(artist, { label, rank });
    artists.set(id, artist);
    return artist;
  };
  const promoterNode = (name) => {
    const label = clean(name);
    const key = normalizeArtistName(label);
    if (!key) return null;
    return put(`promoter:${key}`, { kind: 'promoter', label, followed: PROMOTER_SOURCES.includes(key) });
  };
  const venueNode = (row) => {
    const name = clean(row.venue?.name);
    const key = normalizeArtistName(`${name} ${row.venue?.city ?? ''}`);
    if (!name || !key) return null;
    const city = clean(row.venue?.city);
    return put(frozenKey(row, 'venue') ?? `venue:${key}`, { kind: 'venue', label: name, ...(city ? { city } : {}) });
  };
  // shape key -> { label, members } for the learned join; a shape only becomes
  // a node when the person has rated that kind of night well.
  const shapes = new Map();
  const noteShape = (key, label, memberId) => {
    if (!key) return;
    const shape = shapes.get(key) ?? { label, members: [] };
    shape.members.push(memberId);
    shapes.set(key, shape);
  };
  const pairs = new Map();
  const bookings = new Map();

  for (const row of liveRows(events, today)) {
    const eventId = `event:${row.id}`;
    const destination = row.destination && typeof row.destination === 'object' ? clean(row.destination.name) || clean(row.title) : null;
    put(eventId, {
      kind: 'event',
      label: clean(row.title) || 'Untitled night',
      eventId: row.id,
      startLocal: clean(row.startLocal),
      score: finite(row.ranking?.utility),
      ...(row.eventType ? { shape: clean(row.eventType) } : {}),
      ...(destination ? { destination } : {})
    });
    if (destination) link('you', eventId, 'watching', W.watching, 'on your destination watchlist');

    const bill = new Map();
    const billed = (name, rank, primary) => {
      const artist = seeArtist(name, rank);
      if (artist) bill.set(artist.id, Boolean(primary) || Boolean(bill.get(artist.id)));
      return artist;
    };
    for (const performer of list(row.performers)) billed(performer?.name, 1, performer?.primary);
    for (const match of list(row.matchedArtists)) {
      const artist = billed(match?.name, 0, match?.primary);
      if (!artist) continue;
      const origin = match.origin ?? 'source';
      if (DIRECT_ORIGINS.includes(origin)) artist.direct = true;
      else if (origin === 'similar' || origin === 'tag' || origin === 'promoter') artist[origin] = true;
      else artist.adjacent = true;
    }
    const lineup = list(row.lineupDisplay?.orderedArtists);
    const tiered = lineup.some((entry) => Number(entry?.billingGroupIndex) > 0);
    const b2b = new Set();
    lineup.forEach((entry, position) => {
      const artist = billed(entry?.displayName, 2, tiered && Number(entry?.billingGroupIndex) === 0);
      if (!artist) return;
      if (entry.relation === 'direct') artist.direct = true;
      else if (entry.relation === 'adjacent') artist.adjacent = true;
      const next = entry.b2bWithNext ? normalizeArtistName(lineup[position + 1]?.displayName) : '';
      if (next && `artist:${next}` !== artist.id) b2b.add(pairKey(artist.id, `artist:${next}`));
    });
    const ids = [...bill.keys()].sort();
    for (const id of ids) link(id, eventId, 'plays', bill.get(id) ? W.playsPrimary : W.playsSupport, bill.get(id) ? 'headliner' : 'on the bill');
    if (ids.length > 1) {
      const share = GRAPH_POLICY.sharedBill.base / Math.sqrt(ids.length - 1);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const key = pairKey(ids[i], ids[j]);
          const pair = pairs.get(key) ?? { from: ids[i], to: ids[j], miss: 1, count: 0 };
          pair.miss *= 1 - (b2b.has(key) ? Math.max(share, GRAPH_POLICY.sharedBill.b2b) : share);
          pair.count += 1;
          pairs.set(key, pair);
        }
      }
    }

    const venue = venueNode(row);
    if (venue) link(eventId, venue.id, 'at', W.at, 'venue');
    const discovery = row.ranking?.discovery ?? {};
    const sources = new Set([...list(row.sources), row.source].filter(Boolean));
    const presenting = [
      ...list(row.promoters),
      discovery.promoterShow,
      ...PROMOTER_SOURCES.filter((source) => sources.has(source)).map((source) => source[0].toUpperCase() + source.slice(1))
    ];
    const presenters = new Set();
    for (const name of presenting) {
      const promoter = promoterNode(name);
      if (!promoter) continue;
      presenters.add(promoter.id);
      link(promoter.id, eventId, 'presents', W.presents, 'presents this night');
    }
    for (const promoter of presenters) {
      for (const id of ids) {
        const key = `${promoter}|${id}`;
        bookings.set(key, { from: promoter, to: id, count: (bookings.get(key)?.count ?? 0) + 1 });
      }
    }
    // `rosterPromoter` describes the strongest match only. It is attributed to
    // an artist when exactly one matched artist can be that match; otherwise
    // nothing is claimed.
    const roster = discovery.rosterPromoter ? promoterNode(discovery.rosterPromoter) : null;
    const origins = TIER_ORIGINS[discovery.tier];
    if (roster && origins) {
      const pool = new Set(list(row.matchedArtists)
        .filter((match) => origins.includes(match?.origin ?? 'source'))
        .map((match) => normalizeArtistName(match?.name))
        .filter(Boolean));
      if (pool.size === 1) link(roster.id, `artist:${[...pool][0]}`, 'rosters', W.rosters, 'on the roster');
    }
    const shape = normalizeArtistName(row.eventType);
    const shapeLabel = row.eventType === 'dj set' ? 'DJ sets' : `${clean(row.eventType)}s`;
    noteShape(frozenKey(row, 'shape') ?? (shape ? `shape:${shape}` : null), frozenLabel(row, 'shape') ?? shapeLabel, eventId);
  }

  for (const row of liveRows(sports, today)) {
    const gameId = `game:${row.id}`;
    const home = clean(row.homeTeam?.name ?? row.homeTeam?.shortName);
    const away = clean(row.awayTeam?.name ?? row.awayTeam?.shortName);
    const league = clean(row.league ?? row.sportsContext?.league);
    put(gameId, {
      kind: 'game',
      label: [away, home].filter(Boolean).join(' at ') || 'Home game',
      eventId: row.id,
      startLocal: clean(row.startLocal),
      score: finite(row.ranking?.utility),
      ...(league ? { league } : {})
    });
    const homeKey = normalizeArtistName(home);
    if (homeKey) {
      const team = put(`team:${homeKey}`, { kind: 'team', label: home });
      link(team.id, gameId, 'hosts', W.hosts, 'home game');
      link('you', team.id, 'follows', W.followsTeam, 'home team');
    }
    const awayKey = normalizeArtistName(away);
    if (awayKey) {
      const opponent = put(`opponent:${awayKey}`, { kind: 'opponent', label: away });
      link(opponent.id, gameId, 'visits', W.visits, 'visiting');
    }
    const venue = venueNode(row);
    if (venue) link(gameId, venue.id, 'at', W.at, 'venue');
    const football = league === 'nfl' || String(row.id).startsWith('nfl:');
    noteShape(frozenKey(row, 'shape') ?? `shape:${football ? 'football' : 'baseball'}`, frozenLabel(row, 'shape') ?? (football ? 'Rams games' : 'Dodgers games'), gameId);
  }

  for (const top of list(tasteProfile?.topArtists)) {
    if (!DIRECT_ORIGINS.includes(top?.origin ?? 'source')) continue;
    const artist = seeArtist(top?.name, 0);
    if (artist) Object.assign(artist, { direct: true, core: true });
  }

  for (const artist of artists.values()) {
    const relation = artist.direct ? 'direct' : (artist.similar || artist.tag || artist.promoter || artist.adjacent) ? 'adjacent' : 'new';
    const via = relation !== 'adjacent' ? null : artist.similar ? 'similar' : artist.tag ? 'tag' : artist.promoter ? 'promoter' : null;
    put(artist.id, { kind: 'artist', label: artist.label, relation, ...(via ? { via } : {}) });
    if (relation === 'direct') link('you', artist.id, 'listens', artist.core ? W.listensCore : W.listens, artist.core ? 'a core artist in your profile' : 'in your rotation');
    else if (via === 'similar') link('you', artist.id, 'near', W.nearSimilar, 'similar to artists you play');
    else if (via === 'tag') link('you', artist.id, 'near', W.nearTag, 'in a tag cluster you play');
  }
  for (const node of nodes.values()) {
    if (node.kind === 'promoter' && node.followed) link('you', node.id, 'follows', W.followsPromoter, 'a promoter you follow');
  }
  for (const booking of bookings.values()) {
    link(booking.from, booking.to, 'books', 1 - (1 - W.books) ** booking.count, `${booking.count} upcoming night${booking.count === 1 ? '' : 's'}`, { count: booking.count });
  }
  for (const pair of pairs.values()) {
    const weight = 1 - pair.miss;
    if (weight >= GRAPH_POLICY.sharedBill.minWeight) {
      link(pair.from, pair.to, 'shares-bill', weight, `${pair.count} shared bill${pair.count === 1 ? '' : 's'}`, { count: pair.count });
    }
  }

  // Learned feedback. A positive taste score adds an edge; a negative one is
  // recorded on the node and can only weaken a path. Friction is logistics
  // and is never read here. A key with no node in the upcoming graph is
  // ignored: feedback alone never creates a node.
  for (const [key, signal] of entriesOf(signals?.taste)) {
    const score = Number(signal?.score);
    if (!Number.isFinite(score) || Math.abs(score) < GRAPH_POLICY.learned.minScore) continue;
    const category = String(key).slice(0, String(key).indexOf(':'));
    let target = LEARNED_NODE_CATEGORIES.includes(category) && nodes.has(key) ? nodes.get(key) : null;
    if (category === 'shape' && score > 0 && shapes.has(key)) {
      const shape = shapes.get(key);
      target = put(key, { kind: 'shape', label: clean(signal.label) || shape.label });
      for (const member of shape.members) link(member, key, 'is-a', GRAPH_POLICY.weights.isA, 'kind of night');
    }
    if (!target || target.kind !== category) continue;
    if (score > 0) {
      const outcomes = Number.isInteger(signal.outcomes) && signal.outcomes > 0 ? signal.outcomes : null;
      link('you', target.id, 'learned', GRAPH_POLICY.learned.base + GRAPH_POLICY.learned.scale * Math.min(1, score),
        outcomes ? `learned from ${outcomes} outcome${outcomes === 1 ? '' : 's'}` : 'learned from your feedback');
    } else {
      target.aversion = round(Math.min(1, -score));
    }
  }

  const sortedNodes = [...nodes.values()].sort((a, b) => (a.id === 'you' ? -1 : b.id === 'you' ? 1 : cmp(a.id, b.id)));
  const sortedEdges = [...edges.values()]
    .filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
    .sort((a, b) => cmp(a.kind, b.kind) || cmp(a.from, b.from) || cmp(a.to, b.to));
  return { policyVersion: GRAPH_POLICY.version, nodes: sortedNodes, edges: sortedEdges, index: buildIndex(sortedNodes, sortedEdges) };
}

/**
 * The distinct routes by which one event connects to the person, strongest
 * first. `eventId` is a row id or a node id.
 *
 * Strength is the product of the edge weights, times `hopAttenuation` for
 * every hop after the first, times the aversion penalty of every node passed
 * through. Returned paths are independent: no path repeats a node and no two
 * share any node other than you and the event (so never the same first hop).
 * Another event is never an intermediate node; a shared-bill hop always
 * refers to a different bill than the event being explained, and a booking
 * hop to a different night. Paths weaker than `paths.minStrength` are dropped.
 */
export function connectionPaths(graph, eventId, { maxPaths = GRAPH_POLICY.paths.maxPaths, maxHops = GRAPH_POLICY.paths.maxHops } = {}) {
  const target = resolveEvent(graph, eventId);
  if (!target || !(maxPaths > 0)) return [];
  const { nodes, edges, index } = graph;
  const limit = Math.min(Math.floor(maxHops), GRAPH_POLICY.paths.hardMaxHops);
  if (!(limit >= 1)) return [];
  const best = new Map();
  // `chain` runs backwards from the node next to the event; `trail` holds the
  // matching edge indices, the edge into the event first.
  const record = (chain, trail, anchor) => {
    const ids = ['you', ...[...chain].reverse(), target.id];
    const used = [anchor, ...[...trail].reverse()];
    let strength = GRAPH_POLICY.hopAttenuation ** (used.length - 1);
    for (const i of used) strength *= edges[i].weight;
    for (const id of chain) strength *= 1 - GRAPH_POLICY.aversionPenalty * (nodes[index.byId[id]].aversion ?? 0);
    if (!(strength >= GRAPH_POLICY.paths.minStrength)) return;
    const key = `${chain[chain.length - 1]}|${chain[0]}`;
    const signature = ids.join('>');
    const current = best.get(key);
    if (!current || strength > current.strength || (strength === current.strength && signature < current.signature)) {
      best.set(key, { strength, ids, used, signature });
    }
  };
  const onBill = new Set();
  const presenters = new Set();
  const entries = [];
  for (const i of index.in[target.id] ?? []) {
    const edge = edges[i];
    if (edge.from === 'you') {
      best.set('you', { strength: edge.weight, ids: ['you', target.id], used: [i], signature: `you>${target.id}` });
    } else {
      entries.push([edge.from, i]);
      if (edge.kind === 'plays') onBill.add(edge.from);
      if (edge.kind === 'presents') presenters.add(edge.from);
    }
  }
  for (const i of index.out[target.id] ?? []) entries.push([edges[i].to, i]);
  const walk = (id, chain, trail) => {
    const hops = trail.length;
    const anchor = index.anchor[id];
    if (anchor !== undefined && hops + 1 <= limit) record(chain, trail, anchor);
    if (hops + 2 > limit || nodes[index.byId[id]].kind !== 'artist') return;
    for (const i of index.in[id] ?? []) {
      const edge = edges[i];
      if ((edge.kind !== 'rosters' && edge.kind !== 'books') || chain.includes(edge.from)) continue;
      // A booking only counts as a route when it is another night.
      if (edge.kind === 'books' && presenters.has(edge.from)) continue;
      const followed = index.anchor[edge.from];
      if (followed !== undefined) record([...chain, edge.from], [...trail, i], followed);
    }
    // On the last hop only neighbours the person is tied to can finish a path.
    for (const i of (hops + 2 === limit ? index.anchoredBill[id] : index.bill[id]) ?? []) {
      const edge = edges[i];
      const next = edge.from === id ? edge.to : edge.from;
      if (onBill.has(next) || chain.includes(next)) continue;
      walk(next, [...chain, next], [...trail, i]);
    }
  };
  for (const [id, i] of entries) walk(id, [id], [i]);

  const taken = new Set();
  const chosen = [];
  const ranked = [...best.values()].sort((a, b) => b.strength - a.strength || a.ids.length - b.ids.length || cmp(a.signature, b.signature));
  for (const path of ranked) {
    const interior = path.ids.slice(1, -1);
    if (interior.some((id) => taken.has(id))) continue;
    for (const id of interior) taken.add(id);
    const hops = path.ids.map((id, position) => {
      const node = nodes[index.byId[id]];
      return { nodeId: id, label: node.label, nodeKind: node.kind, via: position ? edges[path.used[position - 1]].kind : null };
    });
    chosen.push({ strength: round(path.strength), ...describePath(hops, nodes[index.byId[target.id]]), hops });
    if (chosen.length >= maxPaths) break;
  }
  return chosen;
}

/**
 * Scenes: clusters of artists the person has no listening evidence for, tied
 * together by upcoming nights and anchored to something the person
 * demonstrably likes.
 *
 * Method, deterministic throughout:
 * 1. Members are artists that are not direct, not already rated well, not
 *    rated poorly, and on at least one upcoming bill.
 * 2. Two members are tied when they share upcoming bills with weight at least
 *    `scenes.minTie`, or play nights in the same room (the same promoter at
 *    the same venue). Scenes are the connected components.
 * 3. A component above `scenes.maxArtists` is split by each member's dominant
 *    room; a member with no room follows its strongest tie.
 * 4. A scene needs a bridge: a shared bill with a known artist, a night by a
 *    followed or well-rated promoter, a well-rated venue, a followed
 *    promoter's roster, or (weakest) a member that is itself similar to the
 *    person's listening. No bridge, no scene.
 * 5. Strength is the number of upcoming events times the combined strength of
 *    the bridges (one contribution per distinct anchor).
 *
 * The label is the dominant promoter and/or venue when one covers at least
 * two and at least half of the scene's nights, otherwise "Around <artist>". `artists` lists
 * members and the known artists bridging in; `knownCount` counts the latter.
 */
export function findScenes(graph, { minEvents = 2, maxScenes = 6 } = {}) {
  if (!graph?.nodes?.length || !(maxScenes > 0)) return [];
  const S = GRAPH_POLICY.scenes;
  const { nodes, edges, index } = graph;
  const nodeOf = (id) => nodes[index.byId[id]];
  const anchorOf = (id) => (index.anchor[id] === undefined ? null : edges[index.anchor[id]]);
  const isKnown = (node) => node.relation === 'direct' || anchorOf(node.id)?.kind === 'learned';
  const nightsOf = (id) => (index.out[id] ?? []).map((i) => edges[i]).filter((edge) => edge.kind === 'plays' && nodeOf(edge.to).kind === 'event').map((edge) => edge.to);
  const contexts = new Map();
  const contextOf = (eventId) => {
    if (!contexts.has(eventId)) {
      contexts.set(eventId, {
        venue: (index.out[eventId] ?? []).map((i) => edges[i]).find((edge) => edge.kind === 'at')?.to ?? null,
        promoters: (index.in[eventId] ?? []).map((i) => edges[i]).filter((edge) => edge.kind === 'presents').map((edge) => edge.from)
      });
    }
    return contexts.get(eventId);
  };

  const members = nodes.filter((node) => node.kind === 'artist' && !isKnown(node) && !node.aversion && nightsOf(node.id).length).map((node) => node.id);
  const parent = new Map(members.map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };
  const union = (a, b) => {
    const [low, high] = [find(a), find(b)].sort();
    if (low !== high) parent.set(high, low);
  };
  for (const edge of edges) {
    if (edge.kind === 'shares-bill' && edge.weight >= S.minTie && parent.has(edge.from) && parent.has(edge.to)) union(edge.from, edge.to);
  }
  const rooms = new Map();
  const roomsOf = new Map();
  for (const id of members) {
    const counts = new Map();
    for (const eventId of nightsOf(id)) {
      const context = contextOf(eventId);
      for (const promoter of context.promoters) {
        const room = `${promoter}|${context.venue ?? ''}`;
        counts.set(room, (counts.get(room) ?? 0) + 1);
        if (!rooms.has(room)) rooms.set(room, id);
        union(rooms.get(room), id);
      }
    }
    roomsOf.set(id, counts);
  }
  const components = new Map();
  for (const id of members) components.set(find(id), [...(components.get(find(id)) ?? []), id]);

  const groups = [];
  for (const ids of components.values()) {
    if (ids.length <= S.maxArtists) {
      groups.push(ids);
      continue;
    }
    const inside = new Set(ids);
    const dominant = new Map(ids.map((id) => [id, [...roomsOf.get(id).entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0] ?? null]));
    const split = new Map();
    for (const id of ids) {
      let key = dominant.get(id);
      if (!key) {
        const ties = (index.bill[id] ?? []).map((i) => edges[i])
          .map((edge) => ({ other: edge.from === id ? edge.to : edge.from, weight: edge.weight }))
          .filter((tie) => tie.weight >= S.minTie && inside.has(tie.other) && dominant.get(tie.other))
          .sort((a, b) => b.weight - a.weight || cmp(a.other, b.other));
        key = ties.length ? dominant.get(ties[0].other) : `bill:${ids[0]}`;
      }
      split.set(key, [...(split.get(key) ?? []), id]);
    }
    groups.push(...split.values());
  }

  const scenes = [];
  for (const ids of groups) {
    if (ids.length < S.minArtists) continue;
    const nights = new Map();
    const appearances = new Map();
    const bridges = new Map();
    const bridge = (anchorId, from, to, via, strength) => {
      const key = `${anchorId}|${to}|${via}`;
      if (!bridges.has(key) || strength > bridges.get(key).strength) bridges.set(key, { anchorId, from, to, via, strength });
    };
    for (const id of ids) {
      const member = nodeOf(id);
      const near = anchorOf(id);
      if (near?.kind === 'near') bridge('you', 'Your listening', member.label, member.via === 'tag' ? 'tag cluster' : 'similar artist', near.weight * S.nearBridge);
      for (const i of index.anchoredBill[id] ?? []) {
        const edge = edges[i];
        const other = nodeOf(edge.from === id ? edge.to : edge.from);
        if (isKnown(other) && !other.aversion) bridge(other.id, other.label, member.label, 'shared bill', anchorOf(other.id).weight * edge.weight);
      }
      for (const i of index.in[id] ?? []) {
        const edge = edges[i];
        const followed = edge.kind === 'rosters' ? anchorOf(edge.from) : null;
        if (followed) bridge(edge.from, nodeOf(edge.from).label, member.label, 'roster', followed.weight * edge.weight);
      }
      for (const eventId of nightsOf(id)) {
        nights.set(eventId, nodeOf(eventId));
        appearances.set(id, (appearances.get(id) ?? 0) + 1);
        const context = contextOf(eventId);
        for (const promoter of context.promoters) {
          const followed = anchorOf(promoter);
          if (followed && !nodeOf(promoter).aversion) bridge(promoter, nodeOf(promoter).label, member.label, 'promoter night', followed.weight * S.promoterBridge);
        }
        const liked = context.venue ? anchorOf(context.venue) : null;
        if (liked) bridge(context.venue, nodeOf(context.venue).label, member.label, 'venue', liked.weight * S.venueBridge);
      }
    }
    if (nights.size < minEvents || !bridges.size) continue;

    const ranked = [...bridges.values()].sort((a, b) => b.strength - a.strength || cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.via, b.via));
    const perAnchor = new Map();
    for (const item of ranked) perAnchor.set(item.anchorId, Math.max(perAnchor.get(item.anchorId) ?? 0, item.strength));
    const bridgeStrength = 1 - [...perAnchor.values()].reduce((miss, strength) => miss * (1 - Math.min(1, strength)), 1);
    const shown = [];
    const shownPerAnchor = new Map();
    for (const item of ranked) {
      const count = shownPerAnchor.get(item.anchorId) ?? 0;
      if (count >= S.maxBridgesPerAnchor || shown.length >= S.maxBridges) continue;
      shownPerAnchor.set(item.anchorId, count + 1);
      shown.push({ from: item.from, to: item.to, via: item.via, strength: round(item.strength) });
    }

    const tally = (pick) => {
      const counts = new Map();
      for (const eventId of nights.keys()) for (const id of pick(contextOf(eventId))) counts.set(id, (counts.get(id) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
    };
    const promoters = tally((context) => context.promoters);
    const venues = tally((context) => (context.venue ? [context.venue] : []));
    // "Dominant" means at least two nights and at least half of them.
    const needed = Math.max(2, Math.ceil(nights.size * S.dominantShare));
    const promoter = promoters[0]?.[1] >= needed ? nodeOf(promoters[0][0]).label : null;
    const venue = venues[0]?.[1] >= needed ? nodeOf(venues[0][0]).label : null;
    const bridgeArtist = ranked.find((item) => item.via === 'shared bill');
    const lead = [...ids].sort((a, b) => appearances.get(b) - appearances.get(a) || cmp(a, b))[0];
    const [label, basis] = promoter && venue ? [`${promoter} at ${venue}`, 'promoter-venue']
      : promoter ? [`${promoter} nights`, 'promoter']
        : venue ? [`Nights at ${venue}`, 'venue']
          : bridgeArtist ? [`Around ${bridgeArtist.from}`, 'bridge-artist']
            : [`Around ${nodeOf(lead).label}`, 'adjacent-artist'];

    const knownIds = [...new Set(ranked.filter((item) => item.via === 'shared bill').map((item) => item.anchorId))];
    const listed = [
      ...knownIds.map((id) => ({ node: nodeOf(id), known: true, nights: 0 })),
      ...ids.map((id) => ({ node: nodeOf(id), known: false, nights: appearances.get(id) }))
    ].sort((a, b) => Number(b.known) - Number(a.known) || b.nights - a.nights || cmp(a.node.label, b.node.label) || cmp(a.node.id, b.node.id));
    scenes.push({
      id: `scene:${ids[0].slice('artist:'.length)}`,
      label,
      basis,
      artists: listed.slice(0, S.maxArtistsListed).map((item) => ({ name: item.node.label, relation: item.node.relation, known: item.known })),
      events: [...nights.values()]
        .sort(byScore)
        .map((node) => ({ id: node.eventId, title: node.label, startLocal: node.startLocal, score: node.score })),
      venues: venues.map(([id]) => nodeOf(id).label),
      promoters: promoters.map(([id]) => nodeOf(id).label),
      bridges: shown,
      knownCount: knownIds.length,
      newCount: ids.length,
      strength: round(nights.size * bridgeStrength)
    });
  }

  scenes.sort((a, b) => b.strength - a.strength || b.events.length - a.events.length || cmp(a.id, b.id));
  const labels = new Map();
  return scenes.slice(0, maxScenes).map((scene) => {
    const seen = (labels.get(scene.label) ?? 0) + 1;
    labels.set(scene.label, seen);
    return seen === 1 ? scene : { ...scene, label: `${scene.label} (${seen})` };
  });
}

/**
 * Input for a radial drawing. No physics and no randomness.
 *
 * Ring 0 is you. Ring 1 is what the person already likes and that touches a
 * shown event: artists they play, promoters and teams they follow, anything
 * rated well. Ring 2 is the `maxEvents` highest-scoring events. Ring 3 is who
 * is new on those bills (up to `maxNewPerEvent` each), including artists that
 * are only similar to the person's listening.
 *
 * Layout: ring-1 anchors are ordered by a greedy chain that keeps anchors
 * sharing events next to each other and are spaced evenly. Each event sits at
 * the weighted circular mean of its anchors' angles (an anchor one shared
 * bill, roster or booking away pulls at `indirectPull`); an event with no
 * anchor takes an even slot in date order. Ring-3 artists sit at the circular
 * mean of their events. Rings 2 and 3 are then spread to a minimum angular
 * gap, cutting the circle at its widest empty arc. Games are left out unless
 * `includeGames` is set.
 */
export function constellation(graph, { maxEvents = 40, includeGames = false } = {}) {
  const you = { id: 'you', kind: 'you', label: 'You', ring: 0, angle: 0, weight: 1 };
  if (!graph?.nodes?.length) return { nodes: [you], links: [] };
  const C = GRAPH_POLICY.constellation;
  const { nodes, edges, index } = graph;
  const nodeOf = (id) => nodes[index.byId[id]];
  // What the person already likes; "near" is a discovery, not a liking.
  const likedBy = (id) => {
    const edge = index.anchor[id] === undefined ? null : edges[index.anchor[id]];
    return edge && edge.kind !== 'near' ? edge : null;
  };
  const picked = nodes
    .filter((node) => node.kind === 'event' || (includeGames && node.kind === 'game'))
    .sort(byScore)
    .slice(0, Math.max(0, Math.floor(maxEvents)));

  const links = new Map();
  const addLink = (from, to, kind, weight) => {
    const key = `${from}|${to}|${kind}`;
    if (!links.has(key) || weight > links.get(key).weight) links.set(key, { from, to, kind, weight });
  };
  const pulls = new Map();
  const outer = new Map();
  for (const event of picked) {
    const pull = new Map();
    const tug = (id, weight) => pull.set(id, Math.max(pull.get(id) ?? 0, weight));
    const onBill = new Set();
    const presenters = new Set();
    const unknown = [];
    const around = [
      ...(index.in[event.id] ?? []).map((i) => [edges[i].from, edges[i]]),
      ...(index.out[event.id] ?? []).map((i) => [edges[i].to, edges[i]])
    ];
    for (const [id, edge] of around) {
      if (edge.kind === 'plays') onBill.add(id);
      if (edge.kind === 'presents') presenters.add(id);
      if (id === 'you') {
        addLink('you', event.id, edge.kind, edge.weight);
        continue;
      }
      const liked = likedBy(id);
      if (liked) {
        tug(id, liked.weight * edge.weight);
        addLink(id, event.id, edge.kind, edge.weight);
      } else if (edge.kind === 'plays') {
        unknown.push({ id, weight: edge.weight, node: nodeOf(id) });
      }
    }
    unknown.sort((a, b) => b.weight - a.weight || cmp(a.node.relation, b.node.relation) || cmp(a.node.label, b.node.label) || cmp(a.id, b.id));
    for (const artist of unknown.slice(0, C.maxNewPerEvent)) {
      outer.set(artist.id, [...(outer.get(artist.id) ?? []), { event, weight: artist.weight }]);
      addLink(artist.id, event.id, 'plays', artist.weight);
      for (const i of index.anchoredBill[artist.id] ?? []) {
        const edge = edges[i];
        const other = edge.from === artist.id ? edge.to : edge.from;
        const liked = likedBy(other);
        if (!liked || onBill.has(other)) continue;
        tug(other, liked.weight * edge.weight * artist.weight * C.indirectPull);
        addLink(other, artist.id, 'shares-bill', edge.weight);
      }
      // A followed promoter that rosters the artist, or books them on another night.
      for (const i of index.in[artist.id] ?? []) {
        const edge = edges[i];
        const liked = edge.kind === 'rosters' || edge.kind === 'books' ? likedBy(edge.from) : null;
        if (!liked || presenters.has(edge.from)) continue;
        tug(edge.from, liked.weight * edge.weight * artist.weight * C.indirectPull);
        addLink(edge.from, artist.id, edge.kind, edge.weight);
      }
    }
    pulls.set(event.id, pull);
  }

  // Ring 1: a greedy chain so anchors that share events sit together.
  const totals = new Map();
  for (const pull of pulls.values()) for (const [id, weight] of pull) totals.set(id, (totals.get(id) ?? 0) + weight);
  const anchors = [...totals.keys()].sort();
  const affinity = (a, b) => {
    let sum = 0;
    for (const pull of pulls.values()) if (pull.has(a) && pull.has(b)) sum += Math.min(pull.get(a), pull.get(b));
    return sum;
  };
  const strongest = (ids) => [...ids].sort((a, b) => totals.get(b) - totals.get(a) || cmp(a, b))[0];
  const order = [];
  const waiting = new Set(anchors);
  while (waiting.size) {
    const last = order[order.length - 1];
    let next = null;
    let bestAffinity = 0;
    if (last) {
      for (const id of anchors) {
        if (!waiting.has(id)) continue;
        const value = affinity(last, id);
        if (value > bestAffinity) [next, bestAffinity] = [id, value];
      }
    }
    next ??= strongest(waiting);
    order.push(next);
    waiting.delete(next);
  }
  const angles = new Map(order.map((id, position) => [id, (TWO_PI * position) / order.length]));
  for (const id of order) addLink('you', id, likedBy(id).kind, likedBy(id).weight);

  // Ring 2.
  const pulled = new Map(picked.map((event) => [
    event.id,
    circularMean([...pulls.get(event.id)].sort((a, b) => cmp(a[0], b[0])).map(([id, weight]) => [angles.get(id), weight]))
  ]));
  const adrift = picked.filter((event) => pulled.get(event.id) === null)
    .sort((a, b) => cmp(a.startLocal, b.startLocal) || cmp(a.id, b.id));
  const eventAngles = spread(picked.map((event) => ({
    id: event.id,
    angle: pulled.get(event.id) ?? (TWO_PI * (adrift.indexOf(event) + 0.5)) / adrift.length
  })), C.minEventGap);

  // Ring 3.
  const outerIds = [...outer.keys()].sort();
  const outerAngles = spread(outerIds.map((id) => ({
    id,
    angle: circularMean(outer.get(id).map(({ event, weight }) => [eventAngles.get(event.id), weight])) ?? 0
  })), C.minOuterGap);

  const byAngle = (map) => (a, b) => map.get(a.id) - map.get(b.id) || cmp(a.id, b.id);
  const out = [
    you,
    ...order.map((id) => nodeOf(id)).map((node) => ({
      id: node.id, kind: node.kind, label: node.label, ring: 1, angle: round(angles.get(node.id), 6), weight: likedBy(node.id).weight,
      ...(node.relation ? { relation: node.relation } : {})
    })),
    ...[...picked].sort(byAngle(eventAngles)).map((node) => ({
      id: node.id, kind: node.kind, label: node.label, ring: 2, angle: round(eventAngles.get(node.id), 6), weight: round(clamp(node.score / 100)), eventId: node.eventId
    })),
    ...outerIds.map((id) => nodeOf(id)).sort(byAngle(outerAngles)).map((node) => ({
      id: node.id, kind: node.kind, label: node.label, ring: 3, angle: round(outerAngles.get(node.id), 6),
      weight: node.relation === 'adjacent' ? C.adjacentWeight : C.newWeight, relation: node.relation,
      eventId: outer.get(node.id).map((item) => item.event).sort(byScore)[0].eventId
    }))
  ];
  return { nodes: out, links: [...links.values()].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind)) };
}

/** A readout for one node: what it is, in one or two sentences, and its nights. */
export function describeNode(graph, nodeId) {
  const position = graph?.index?.byId?.[nodeId];
  if (position === undefined) return null;
  const { nodes, edges, index } = graph;
  const node = nodes[position];
  const nodeOf = (id) => nodes[index.byId[id]];
  const outgoing = (kind) => (index.out[node.id] ?? []).map((i) => edges[i]).filter((edge) => edge.kind === kind);
  const incoming = (kind) => (index.in[node.id] ?? []).map((i) => edges[i]).filter((edge) => edge.kind === kind);
  const anchor = index.anchor[node.id] === undefined ? null : edges[index.anchor[node.id]];
  const learned = incoming('learned').length > 0;
  const count = (n, one, many = `${one}s`) => `${n} upcoming ${n === 1 ? one : many}`;
  const rated = (subject) => (learned ? ` You have rated ${subject} well.` : node.aversion ? ` You have rated ${subject} poorly.` : '');
  let nights = [];
  let summary = '';
  if (node.kind === 'you') {
    nights = outgoing('watching').map((edge) => nodeOf(edge.to));
    const listens = outgoing('listens').filter((edge) => (index.out[edge.to] ?? []).some((i) => edges[i].kind === 'plays')).length;
    const follows = outgoing('follows').filter((edge) => nodeOf(edge.to).kind === 'promoter').length;
    summary = `${listens} ${listens === 1 ? 'artist' : 'artists'} you play ${listens === 1 ? 'is' : 'are'} on upcoming bills, and you follow ${follows} ${follows === 1 ? 'promoter' : 'promoters'}.`;
  } else if (node.kind === 'artist') {
    nights = outgoing('plays').map((edge) => nodeOf(edge.to));
    const lead = node.relation === 'direct' ? 'In your rotation.'
      : node.via === 'similar' ? 'Similar to artists you play; no listening of your own yet.'
        : node.via === 'tag' ? 'From a tag cluster you play; no listening of your own yet.'
          : node.via === 'promoter' ? 'Found through a promoter you follow; no listening of your own yet.'
            : node.relation === 'adjacent' ? 'Adjacent to your profile; no listening of your own yet.'
              : 'New to you.';
    const known = (index.anchoredBill[node.id] ?? [])
      .map((i) => edges[i])
      .map((edge) => ({ other: nodeOf(edge.from === node.id ? edge.to : edge.from), weight: edge.weight }))
      .filter((tie) => tie.other.relation === 'direct')
      .sort((a, b) => b.weight - a.weight || cmp(a.other.label, b.other.label))[0];
    const roster = incoming('rosters').map((edge) => nodeOf(edge.from).label).sort()[0];
    summary = `${lead} On ${count(nights.length, 'bill')}.${known && node.relation !== 'direct' ? ` Shares a bill with ${known.other.label}, whom you play.` : ''}${roster ? ` On the ${roster} roster.` : ''}${rated('their nights')}`;
  } else if (node.kind === 'event') {
    nights = [node];
    const venue = outgoing('at').map((edge) => nodeOf(edge.to).label)[0];
    const promoters = incoming('presents').map((edge) => nodeOf(edge.from).label).sort();
    const bill = incoming('plays').map((edge) => nodeOf(edge.from));
    const direct = bill.filter((artist) => artist.relation === 'direct').length;
    summary = `${venue ? `At ${venue}` : 'Venue not listed'}${promoters.length ? `, presented by ${promoters.join(' and ')}` : ''}. `
      + `${bill.length} ${bill.length === 1 ? 'artist' : 'artists'} on the bill${direct ? `, ${direct} in your rotation` : ''}.`
      + `${node.destination ? ' On your destination watchlist.' : ''}`;
  } else if (node.kind === 'game') {
    nights = [node];
    const venue = outgoing('at').map((edge) => nodeOf(edge.to).label)[0];
    summary = `${node.label}${venue ? `, at ${venue}` : ''}.`;
  } else if (node.kind === 'venue') {
    nights = incoming('at').map((edge) => nodeOf(edge.from));
    summary = `${capitalize(count(nights.length, 'date'))}${node.city ? ` in ${node.city}` : ''}.${rated('nights here')}`;
  } else if (node.kind === 'promoter') {
    nights = outgoing('presents').map((edge) => nodeOf(edge.to));
    const roster = outgoing('rosters').length;
    summary = `${node.followed ? 'A promoter you follow. ' : ''}Presents ${count(nights.length, 'night')}.${roster ? ` ${roster} roster ${roster === 1 ? 'artist is' : 'artists are'} on upcoming bills.` : ''}${rated('their nights')}`;
  } else if (node.kind === 'team') {
    nights = outgoing('hosts').map((edge) => nodeOf(edge.to));
    summary = `${anchor ? 'A home team you follow. ' : ''}${capitalize(count(nights.length, 'home game'))}.`;
  } else if (node.kind === 'opponent') {
    nights = outgoing('visits').map((edge) => nodeOf(edge.to));
    summary = `Visiting for ${count(nights.length, 'game')}.${rated('games against them')}`;
  } else if (node.kind === 'shape') {
    nights = incoming('is-a').map((edge) => nodeOf(edge.from));
    summary = `${capitalize(count(nights.length, 'date'))} of this kind.${rated(node.label)}`;
  }
  return {
    label: node.label,
    kind: node.kind,
    summary,
    events: nights
      .sort((a, b) => cmp(a.startLocal, b.startLocal) || cmp(a.id, b.id))
      .map((night) => ({ id: night.eventId, title: night.label, startLocal: night.startLocal }))
  };
}

function buildIndex(nodes, edges) {
  const index = { byId: {}, out: {}, in: {}, bill: {}, anchoredBill: {}, anchor: {} };
  nodes.forEach((node, position) => { index.byId[node.id] = position; });
  const push = (table, id, value) => (table[id] ?? (table[id] = [])).push(value);
  edges.forEach((edge, i) => {
    push(index.out, edge.from, i);
    push(index.in, edge.to, i);
    if (edge.from === 'you' && edge.kind !== 'watching') {
      const current = index.anchor[edge.to];
      if (current === undefined || edge.weight > edges[current].weight) index.anchor[edge.to] = i;
    }
  });
  edges.forEach((edge, i) => {
    if (edge.kind !== 'shares-bill') return;
    push(index.bill, edge.from, i);
    push(index.bill, edge.to, i);
    if (index.anchor[edge.to] !== undefined) push(index.anchoredBill, edge.from, i);
    if (index.anchor[edge.from] !== undefined) push(index.anchoredBill, edge.to, i);
  });
  return index;
}

function resolveEvent(graph, eventId) {
  const byId = graph?.index?.byId;
  if (!byId || eventId == null) return null;
  for (const id of [`event:${eventId}`, `game:${eventId}`, String(eventId)]) {
    const node = byId[id] === undefined ? null : graph.nodes[byId[id]];
    if (node && (node.kind === 'event' || node.kind === 'game')) return node;
  }
  return null;
}

// One plain sentence, built only from node labels and the kinds of the edges
// walked. `hops` runs from you to the event.
function describePath(hops, target) {
  const kinds = hops.slice(1).map((hop) => hop.via);
  const first = kinds[0];
  const last = kinds[kinds.length - 1];
  const anchor = hops[1];
  const kind = kinds.includes('shares-bill') ? 'shared-bill'
    : kinds.includes('rosters') ? 'roster'
      : kinds.includes('books') ? 'booking'
        : first === 'watching' ? 'watchlist'
          : first === 'listens' ? 'artist'
            : first === 'near' ? 'near-artist'
              : first === 'learned' ? 'learned'
                : last === 'hosts' ? 'home-team' : 'promoter';
  if (first === 'watching') return { kind, text: `${target.destination ?? target.label} is on your destination watchlist.` };
  if (last === 'plays') {
    const billed = hops[hops.length - 2].label;
    if (hops.length === 3) {
      return {
        kind,
        text: first === 'listens' ? `You play ${billed}, who is on the bill.`
          : first === 'near' ? `${billed} is on the bill and sits close to what you play.`
            : `You have rated nights with ${billed} well, and ${billed} is on the bill.`
      };
    }
    let text = billed;
    for (let position = hops.length - 2; position >= 2; position -= 1) {
      const opening = position === hops.length - 2;
      const toward = hops[position - 1].label;
      text += hops[position].via === 'rosters' ? `${opening ? ' is' : ', who is'} on the roster of ${toward}`
        : hops[position].via === 'books' ? `${opening ? ' plays another' : ', who plays an'} upcoming night for ${toward}`
          : opening ? ` shares another upcoming bill with ${toward}` : `, who shares one with ${toward}`;
    }
    const tail = anchor.nodeKind === 'promoter'
      ? (first === 'follows' ? ', which you follow.' : ', whose nights you have rated well.')
      : first === 'listens' ? ', whom you play.'
        : first === 'near' ? ', who sits close to what you play.'
          : ', whom you have rated well.';
    return { kind, text: `${text}${tail}` };
  }
  const game = target.kind === 'game';
  const text = last === 'presents' ? (first === 'follows' ? `You follow ${anchor.label}, which presents this night.` : `You have rated ${anchor.label} nights well.`)
    : last === 'at' ? `You have rated ${game ? 'games' : 'nights'} at ${anchor.label} well.`
      : last === 'is-a' ? `You have rated ${anchor.label} well.`
        : last === 'hosts' ? `You follow the ${anchor.label}, and this is a home game.`
          : last === 'visits' ? `You have rated games against the ${anchor.label} well.`
            : `${anchor.label} connects you to this ${game ? 'game' : 'night'}.`;
  return { kind, text };
}

// Weighted circular mean of [angle, weight] pairs; null when nothing pulls or
// the pulls cancel.
function circularMean(pairs) {
  let x = 0;
  let y = 0;
  for (const [angle, weight] of pairs) {
    if (!Number.isFinite(angle) || !(weight > 0)) continue;
    x += Math.cos(angle) * weight;
    y += Math.sin(angle) * weight;
  }
  if (Math.hypot(x, y) < 1e-9) return null;
  return (Math.atan2(y, x) + TWO_PI) % TWO_PI;
}

// Keep the given order of angles but hold every pair at least `minGap` apart
// (less when the ring is too full). Items sharing a target fan out around it;
// the circle is cut at its widest empty arc so nothing is pushed across it.
function spread(items, minGap) {
  const n = items.length;
  if (!n) return new Map();
  const gap = Math.min(minGap, TWO_PI / n);
  const sorted = [...items].sort((a, b) => a.angle - b.angle || cmp(a.id, b.id));
  const fanned = [];
  for (let start = 0; start < n;) {
    let end = start;
    while (end + 1 < n && sorted[end + 1].angle - sorted[start].angle < 1e-9) end += 1;
    const size = end - start + 1;
    for (let k = 0; k < size; k += 1) fanned.push({ id: sorted[start + k].id, angle: sorted[start].angle + (k - (size - 1) / 2) * gap });
    start = end + 1;
  }
  fanned.sort((a, b) => a.angle - b.angle || cmp(a.id, b.id));
  let cut = 0;
  let widest = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const next = i === n - 1 ? fanned[0].angle + TWO_PI : fanned[i + 1].angle;
    if (next - fanned[i].angle > widest + 1e-12) {
      widest = next - fanned[i].angle;
      cut = (i + 1) % n;
    }
  }
  const ring = [...fanned.slice(cut), ...fanned.slice(0, cut).map((item) => ({ ...item, angle: item.angle + TWO_PI }))];
  const positions = ring.map((item) => item.angle);
  for (let i = 1; i < n; i += 1) positions[i] = Math.max(positions[i], positions[i - 1] + gap);
  const limit = positions[0] + TWO_PI - gap;
  if (positions[n - 1] > limit) {
    positions[n - 1] = limit;
    for (let i = n - 2; i >= 1; i -= 1) positions[i] = Math.min(positions[i], positions[i + 1] - gap);
  }
  return new Map(ring.map((item, i) => [item.id, ((positions[i] % TWO_PI) + TWO_PI) % TWO_PI]));
}

// Published rows that are still upcoming, one per id, in id order.
function liveRows(rows, today) {
  const seen = new Set();
  return list(rows)
    .filter((row) => row && typeof row === 'object' && row.id != null && row.id !== '' && !row.ranking?.excluded)
    .filter((row) => !today || !/^\d{4}-\d{2}-\d{2}/.test(String(row.startLocal ?? '')) || String(row.startLocal).slice(0, 10) >= today)
    .sort((a, b) => cmp(String(a.id), String(b.id)) || cmp(String(a.startLocal ?? ''), String(b.startLocal ?? '')) || cmp(String(a.title ?? ''), String(b.title ?? '')))
    .filter((row) => !seen.has(String(row.id)) && seen.add(String(row.id)));
}

function localDateKey(now) {
  if (now == null || now === '') return null;
  if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}/.test(now)) return now.slice(0, 10);
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The key a row froze for a category, when it is well formed.
function frozenKey(row, category) {
  const key = row.feedbackKeys?.[category]?.[0]?.key;
  return typeof key === 'string' && key.startsWith(`${category}:`) && key.length > category.length + 1 ? key : null;
}

function frozenLabel(row, category) {
  return frozenKey(row, category) ? clean(row.feedbackKeys[category][0].label) || null : null;
}

function entriesOf(table) {
  if (!table) return [];
  const entries = table instanceof Map ? [...table.entries()] : typeof table === 'object' ? Object.entries(table) : [];
  return entries.sort((a, b) => cmp(String(a[0]), String(b[0])));
}

function byScore(a, b) {
  return b.score - a.score || cmp(a.startLocal, b.startLocal) || cmp(a.id, b.id);
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? '').trim().slice(0, 160);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// Code-unit comparison: the same order in every runtime and locale.
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round(value, places = 4) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
