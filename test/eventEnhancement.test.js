import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEventType, enhanceEventsWithOllama, enhanceSportsWithOllama } from '../src/eventEnhancement.js';

function event(id, sources, overrides = {}) {
  return {
    id,
    title: id === 'one' ? 'DO NOT SEND EVENT TITLE' : 'Another Event',
    startLocal: '2026-07-12T20:00:00',
    sourceOccurrences: sources.map((source) => ({ source })),
    performers: [{ name: 'DO NOT SEND ARTIST' }],
    matchedArtists: [{ origin: 'source' }],
    ranking: {
      utility: 50,
      artistFit: 60,
      confidence: 'high',
      pinnedBonus: 0,
      urgency: 'watch',
      hassleScore: 4
    },
    ...overrides
  };
}

test('classifies festivals separately from ordinary concerts', () => {
  assert.equal(classifyEventType(event('festival', ['ticketmaster'], { title: 'HARD Summer Music Festival' })), 'festival');
  assert.equal(classifyEventType(event('concert', ['ticketmaster'])), 'concert');
});

test('runs four independent local passes and withholds restricted source features', async () => {
  const requests = [];
  const result = await enhanceEventsWithOllama([
    event('one', ['seatgeek']),
    event('two', ['framework'])
  ], { background: ['LA context'], decisionPreferences: ['Be selective'], maxEnhancedEvents: 2 }, {
    now: new Date('2026-07-10T00:00:00Z'),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const input = JSON.parse(body.messages[1].content).candidates;
      const system = body.messages[0].content;
      const items = input.map(({ ref }) => {
        if (system.includes('Assess personal fit')) return { ref, score: 80, label: 'strong fit', explanation: 'Strong direct evidence.' };
        if (system.includes('selective recommendation')) return { ref, verdict: 'prioritize', explanation: 'Worth prioritizing.' };
        if (system.includes('advisory urgency')) return { ref, label: 'watch', explanation: 'Monitor timing.' };
        return { ref, score: 4, explanation: 'Manageable friction.' };
      });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });

  assert.equal(requests.length, 4);
  assert.equal(result.mode, 'ollama');
  assert.equal(result.byId.get('one').personalFit.score, 80);
  assert.equal(result.byId.get('one').urgency, undefined);
  assert.equal(result.byId.get('two').urgency.label, 'watch');
  assert.doesNotMatch(JSON.stringify(requests), /DO NOT SEND/);
  const urgencyRequest = requests.find((request) => request.messages[0].content.includes('advisory urgency'));
  assert.equal(JSON.parse(urgencyRequest.messages[1].content).candidates.length, 1);
});

test('allows urgency and hassle advisory passes for a SeatGeek occurrence also matched by Ticketmaster', async () => {
  const requests = [];
  const result = await enhanceEventsWithOllama([
    event('merged', ['seatgeek', 'ticketmaster'])
  ], { background: ['LA context'], decisionPreferences: ['Be selective'], maxEnhancedEvents: 1 }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const input = JSON.parse(body.messages[1].content).candidates;
      const items = input.map(({ ref }) => body.messages[0].content.includes('advisory urgency')
        ? { ref, label: 'watch', explanation: 'Advisory timing only.' }
        : { ref, score: 4, explanation: 'Manageable friction.' });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  assert.equal(result.byId.get('merged').urgency.label, 'watch');
  assert.equal(result.byId.get('merged').hassle.score, 4);
  assert.equal(requests.filter((request) => request.messages[0].content.includes('advisory urgency')).length, 1);
});

test('keeps overview-required events in the local advisory queue ahead of the general cap', async () => {
  const requestedRefs = [];
  const result = await enhanceEventsWithOllama([
    event('near', ['framework'], { startLocal: '2026-07-11T20:00:00' }),
    event('overview-required', ['framework'], { startLocal: '2026-12-01T20:00:00' })
  ], { background: [], decisionPreferences: [], maxEnhancedEvents: 1 }, {
    requiredIds: ['overview-required'],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestedRefs.push(JSON.parse(body.messages[1].content).candidates.map(({ ref }) => ref));
      const input = JSON.parse(body.messages[1].content).candidates;
      const items = input.map(({ ref }) => body.messages[0].content.includes('advisory urgency')
        ? { ref, label: 'watch', explanation: 'Advisory timing only.' }
        : body.messages[0].content.includes('selective recommendation')
          ? { ref, verdict: 'consider', explanation: 'Worth a closer look.' }
          : { ref, score: 60, ...(body.messages[0].content.includes('personal fit') ? { label: 'possible fit' } : {}), explanation: 'Useful local context.' });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  assert.equal(result.byId.has('overview-required'), true);
  assert.equal(requestedRefs.every((refs) => refs.includes('candidate-1')), true);
});

test('runs optional sports advisory passes from normalized MLB context only', async () => {
  const game = {
    id: 'mlb:1',
    startLocal: '2026-08-15T16:10:00-07:00',
    sportsContext: { rivalryTier: 'high' },
    ranking: { utility: 80, interestScore: 90, opponentQuality: 15, pitchingScore: 8, leverageScore: 6, convenienceScore: 10, hassleScore: 4, urgency: 'unknown', confidence: 'high' }
  };
  const result = await enhanceSportsWithOllama([game], { background: ['Dodgers context'], decisionPreferences: ['Be selective'] }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.messages[1].content).candidates;
      const system = body.messages[0].content;
      const items = input.map(({ ref }) => system.includes('personal value')
        ? { ref, score: 88, label: 'strong fit', explanation: 'Rivalry context adds real value.' }
        : system.includes('selective recommendation')
          ? { ref, verdict: 'prioritize', explanation: 'A strong home-game candidate.' }
          : system.includes('deterministic ticket urgency')
            ? { ref, label: 'unknown', explanation: 'Ticket coverage is unknown.' }
            : { ref, score: 4, explanation: 'Manageable logistics.' });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  assert.equal(result.mode, 'ollama');
  assert.equal(result.byId.get('mlb:1').recommendation.verdict, 'prioritize');
  assert.equal(result.byId.get('mlb:1').urgency.label, 'unknown');
});

test('recursively strips restricted nested personal context values before building prompts', async () => {
  const requests = [];
  await enhanceEventsWithOllama([event('two', ['framework'])], {
    background: [{ spotify: { artists: ['restricted'] } }, 'safe context'],
    decisionPreferences: [{ seatgeek: { payload: 'restricted' } }, 'be selective'],
    maxEnhancedEvents: 1
  }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const input = JSON.parse(body.messages[1].content).candidates;
      const system = body.messages[0].content;
      const items = input.map(({ ref }) => system.includes('personal fit')
        ? { ref, score: 60, label: 'possible fit', explanation: 'Safe advisory.' }
        : system.includes('selective recommendation')
          ? { ref, verdict: 'consider', explanation: 'Safe advisory.' }
          : system.includes('deterministic urgency')
            ? { ref, label: 'watch', explanation: 'Safe advisory.' }
            : { ref, score: 3, explanation: 'Safe advisory.' });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  const payload = requests.map((request) => request.messages[1].content).join('\n');
  assert.match(payload, /safe context|be selective/);
  assert.doesNotMatch(payload, /spotify|seatgeek|restricted/);
});

test('rejects model output that attempts to alter canonical ranking fields', async () => {
  const result = await enhanceEventsWithOllama([event('two', ['framework'])], { background: [], decisionPreferences: [], maxEnhancedEvents: 1 }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const candidates = JSON.parse(body.messages[1].content).candidates;
      const items = candidates.map(({ ref }) => ({ ref, score: 99, label: 'strong fit', explanation: 'Advisory only.', utility: 999 }));
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  assert.equal(result.mode, 'deterministic');
  assert.equal(result.byId.get('two').personalFit, undefined);
  assert.match(result.passes.personalFit.status, /unsupported field/);
});

test('rejects unsupported scarcity claims from per-event model output', async () => {
  const result = await enhanceEventsWithOllama([event('two', ['framework'])], { background: [], decisionPreferences: [], maxEnhancedEvents: 1 }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const candidates = JSON.parse(body.messages[1].content).candidates;
      const items = candidates.map(({ ref }) => ({ ref, score: 60, label: 'possible fit', explanation: 'This will sell out.' }));
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  assert.equal(result.mode, 'deterministic');
  assert.match(result.passes.personalFit.status, /unsupported scarcity claim/);
});

test('sends derived taste evidence to fit passes and drops no-information advisories', async () => {
  const requests = [];
  const result = await enhanceEventsWithOllama([
    event('grounded', ['framework'], { matchedArtists: [{ origin: 'similar', primary: true }], ranking: { utility: 50, artistFit: 72, confidence: 'high', pinnedBonus: 0, urgency: 'watch', hassleScore: 4 } }),
    event('refusal', ['framework'])
  ], { background: ['LA context'], decisionPreferences: ['Be selective'], maxEnhancedEvents: 2 }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const input = JSON.parse(body.messages[1].content).candidates;
      const system = body.messages[0].content;
      const items = input.map(({ ref }) => {
        if (system.includes('Assess personal fit')) {
          return ref === 'candidate-2'
            ? { ref, score: 40, label: 'weak fit', explanation: 'Cannot assess value without specific artist data.' }
            : { ref, score: 70, label: 'possible fit', explanation: 'Similar-artist evidence with solid deterministic fit.' };
        }
        if (system.includes('selective recommendation')) return { ref, verdict: 'consider', explanation: 'Similarity evidence supports a look.' };
        if (system.includes('advisory urgency')) return { ref, label: 'watch', explanation: 'Monitor timing.' };
        return { ref, score: 4, explanation: 'Manageable friction.' };
      });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });

  const fitRequest = requests.find((request) => request.messages[0].content.includes('Assess personal fit'));
  const fitCandidates = JSON.parse(fitRequest.messages[1].content).candidates;
  assert.equal(fitCandidates[0].evidenceOrigin, 'similar');
  assert.equal(fitCandidates[0].evidenceStrength, 72);
  assert.equal(fitCandidates[1].evidenceOrigin, 'source');
  assert.equal(result.byId.get('grounded').personalFit.score, 70);
  assert.equal(result.byId.get('refusal').personalFit, undefined);
  assert.equal(result.passes.personalFit.status, 'partial local enhancement');
});
