import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEditorialCandidates, buildEditorialInput, generateEditorialBrief, serializeEditorialInput } from '../src/editorial.js';

const projection = {
  generatedAt: '2026-07-10T00:00:00Z',
  horizon: { days: 180 },
  sourceHealth: [{ source: 'seatgeek', status: 'active', itemCount: 100 }],
  events: [{
    id: 'seatgeek:1',
    title: 'DO NOT SEND THIS TITLE',
    sourceUrl: 'https://private.example/event',
    sources: ['seatgeek'],
    venue: { name: 'DO NOT SEND THIS VENUE' },
    ticketObservation: { lowestPriceUsd: 123 },
    matchedArtists: [{ origin: 'source', name: 'DO NOT SEND THIS ARTIST' }],
    ranking: { confidence: 'high', urgency: 'watch', artistFit: 60, hassleScore: 4, utility: 52, whyYou: 'Direct evidence.' },
    sourceOccurrences: [{ source: 'seatgeek', sourceEventId: '1', sourceUrl: 'https://private.example/event', title: 'DO NOT SEND THIS TITLE', startLocal: '2026-07-12T20:00:00', venue: { name: 'DO NOT SEND THIS VENUE' } }]
  }],
  sports: [],
  movies: []
};

test('builds an aggregate editorial input without source payload fields', () => {
  const input = JSON.stringify(buildEditorialInput(projection));
  assert.doesNotMatch(input, /DO NOT SEND|private\.example|123/);
  assert.equal(JSON.parse(input).tasteTierCounts.source, 1);
});

test('permits named editorial context from Ticketmaster in a SeatGeek + Ticketmaster merge', () => {
  const merged = {
    ...projection.events[0],
    id: 'merged:1',
    title: 'SeatGeek billing should stay private',
    sources: ['seatgeek', 'ticketmaster'],
    sourceOccurrences: [
      { source: 'seatgeek', sourceEventId: 'sg', title: 'SeatGeek billing should stay private', sourceUrl: 'https://seatgeek.example' },
      { source: 'ticketmaster', sourceEventId: 'tm', title: 'Ticketmaster safe title', sourceUrl: 'https://ticketmaster.example', startLocal: '2026-07-12T20:00:00', venue: { name: 'Safe venue' } }
    ]
  };
  const candidates = buildEditorialCandidates({ events: [merged] });
  assert.equal(candidates[0].named, true);
  assert.equal(candidates[0].title, 'Ticketmaster safe title');
});

test('provenance serializer excludes Spotify-derived values while retaining independently sourced names', () => {
  const input = buildEditorialInput({
    ...projection,
    namedCandidates: [{
      ref: 'tm:independent', vertical: 'music', named: true, provenance: 'ticketmaster',
      title: 'Independent artist event', venue: 'Independent venue', startLocal: '2026-07-12T20:00:00',
      whyYou: 'Spotify seed strength 60; top rank 1', fitScore: 60, fitBand: 'high',
      urgency: 'watch', hassleScore: 2
    }]
  });
  // buildEditorialInput consumes editorialCandidates, so exercise the public
  // serializer with a shape that models the projection boundary explicitly.
  const serialized = serializeEditorialInput({
    ...input,
    namedCandidates: [{
      ref: 'tm:independent', vertical: 'music', provenance: 'ticketmaster', eventType: 'concert',
      title: 'Independent artist event', venue: 'Independent venue', startLocal: '2026-07-12T20:00:00',
      whyYou: 'Spotify seed strength 60; top rank 1', spotifyArtistId: 'secret', topItemsAffinity: 60,
      urgency: 'watch', hassleScore: 2
    }]
  });
  const payload = JSON.stringify(serialized);
  assert.match(payload, /Independent artist event/);
  assert.doesNotMatch(payload, /Spotify seed strength|top rank 1|secret|topItemsAffinity/);
});

test('keeps eligible Overview sports context ahead of the general named-candidate cap', () => {
  const music = Array.from({ length: 10 }, (_, index) => ({
    ref: `tm:music-${index}`,
    vertical: 'music',
    named: true,
    title: `Music ${index}`
  }));
  const input = buildEditorialInput({
    ...projection,
    overview: [{ id: 'mlb:1', vertical: 'sports', score: 88, startLocal: '2026-07-12T19:10:00' }],
    editorialCandidates: [
      ...music,
      { ref: 'mlb:1', vertical: 'sports', named: true, title: 'Dodgers vs. Diamondbacks', startLocal: '2026-07-12T19:10:00' }
    ]
  });
  assert.equal(input.overviewPriority, 'sports');
  assert.equal(input.overview[0].ref, 'mlb:1');
});

test('uses local Ollama structured output with source-gated named candidates', async () => {
  let requestBody;
  const editorialProjection = {
    ...projection,
    overview: [{ id: 'tm:1', vertical: 'music', score: 80, startLocal: '2026-07-12T20:00:00' }],
    editorialCandidates: [{ ref: 'tm:1', vertical: 'music', named: true, title: 'Safe artist event', startLocal: '2026-07-12T20:00:00', venue: 'Safe venue', fitBand: 'high', fitScore: 80, urgency: 'watch', hassleScore: 3, whyYou: 'Direct taste signal.' }]
  };
  const editorial = await generateEditorialBrief({
    model: 'gpt-test',
    projection: editorialProjection,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ message: { content: JSON.stringify({
        headline: 'A few dates feel genuinely worth it.',
        verdict: 'maybe',
        lead: 'The near-term calendar has one clear music signal. It deserves attention without turning the week into a chase.',
        decisionNotes: ['Keep the strongest direct signal in view.'],
        skipCall: 'Skip the weaker adjacent options.',
        caution: 'The deterministic pipeline remains authoritative.',
        mentions: ['tm:1']
      }) } }));
    }
  });
  assert.equal(editorial.mode, 'ollama');
  assert.equal(editorial.mentions[0], 'tm:1');
  assert.equal(requestBody.format.type, 'object');
  assert.doesNotMatch(JSON.stringify(requestBody), /DO NOT SEND|private\.example|123/);
});

test('keeps a sports-first overview editorially aligned with the broader music shortlist', async () => {
  const editorial = await generateEditorialBrief({
    model: 'gpt-test',
    projection: {
      ...projection,
      overview: [{ id: 'mlb:1', vertical: 'sports', score: 88, startLocal: '2026-07-11T19:10:00' }],
      editorialCandidates: [{ ref: 'mlb:1', vertical: 'sports', named: true, title: 'Arizona at LA Dodgers', startLocal: '2026-07-11T19:10:00', venue: 'Dodger Stadium', fitBand: 'high', fitScore: 88, urgency: 'watch', hassleScore: 4, whyYou: 'Rivalry and matchup.' }]
    },
    fetchImpl: async () => new Response(JSON.stringify({ message: { content: JSON.stringify({
      headline: 'A few dates feel worth it.', verdict: 'maybe', lead: 'The next two weeks center on electronic music opportunities.',
      decisionNotes: ['Keep the strongest signal in view.'], skipCall: 'Skip the weaker options.', caution: 'The deterministic pipeline remains authoritative.', mentions: ['mlb:1']
    }) } }))
  });
  assert.equal(editorial.mode, 'ollama');
  assert.match(editorial.lead, /Music leads the broader shortlist/);
  assert.match(editorial.lead, /Dodgers game/);
});

test('uses a safe deterministic caution when Ollama leaves that field empty', async () => {
  const editorial = await generateEditorialBrief({
    model: 'gpt-test',
    projection: {
      ...projection,
      overview: [{ id: 'tm:1', vertical: 'music', score: 80, startLocal: '2026-07-12T20:00:00' }],
      editorialCandidates: [{ ref: 'tm:1', vertical: 'music', named: true, title: 'Safe artist event', startLocal: '2026-07-12T20:00:00' }]
    },
    fetchImpl: async () => new Response(JSON.stringify({ message: { content: JSON.stringify({
      headline: 'A clear signal.', verdict: 'maybe', lead: 'Keep the strongest signal in view.', decisionNotes: [], skipCall: 'Skip the weaker options.', caution: '', mentions: ['tm:1']
    }) } }))
  });
  assert.equal(editorial.mode, 'ollama');
  assert.match(editorial.caution, /remain deterministic/);
});

test('falls back deterministically when the Ollama request fails', async () => {
  const editorial = await generateEditorialBrief({
    projection,
    fetchImpl: async () => new Response('nope', { status: 500 })
  });
  assert.equal(editorial.mode, 'deterministic');
  assert.equal(editorial.status, 'deterministic fallback');
  assert.match(editorial.warning, /Ollama request failed/);
});

test('rejects unsupported scarcity claims from local editorial output', async () => {
  const editorial = await generateEditorialBrief({
    projection,
    fetchImpl: async () => new Response(JSON.stringify({ message: { content: JSON.stringify({
      headline: 'Act now', verdict: 'go out', lead: 'You will lose access.',
      decisionNotes: ['Scarcity is certain.'], skipCall: 'None.', caution: 'None.', mentions: []
    }) } }))
  });
  assert.equal(editorial.mode, 'deterministic');
  assert.equal(editorial.status, 'deterministic fallback');
  assert.match(editorial.warning, /unsupported scarcity claim/);
});
