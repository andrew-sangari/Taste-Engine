import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEventType, enhanceEventsWithOllama, enhanceSportsWithOllama, reusePreviousEnhancements } from '../src/eventEnhancement.js';

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

test('does not let missing source-safe detail turn a selected music event into skip', async () => {
  const result = await enhanceEventsWithOllama([event('two', ['framework'])], { background: [], decisionPreferences: [], maxEnhancedEvents: 1 }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const candidates = JSON.parse(body.messages[1].content).candidates;
      const system = body.messages[0].content;
      const items = candidates.map(({ ref }) => system.includes('selective recommendation')
        ? { ref, verdict: 'skip', explanation: 'Missing lineup and genre detail means there is not enough fit information.' }
        : system.includes('contextual fit')
          ? { ref, score: 10, label: 'weak fit', explanation: 'Insufficient artist detail to assess fit.' }
          : system.includes('advisory urgency')
            ? { ref, label: 'watch', explanation: 'Timing only.' }
            : { ref, score: 4, explanation: 'Known friction only.' });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  assert.notEqual(result.byId.get('two').recommendation.verdict, 'skip');
  assert.equal(result.byId.get('two').personalFit.label, 'possible fit');
});

test('passes only explicitly provider-backed music identity context to Ollama', async () => {
  const requests = [];
  await enhanceEventsWithOllama([event('safe', ['ticketmaster'], {
    sourceOccurrences: [{ source: 'ticketmaster', title: 'Allowed title', venue: { name: 'Allowed venue', city: 'Los Angeles' }, performerNames: ['Allowed artist'] }]
  })], { background: [], decisionPreferences: [], maxEnhancedEvents: 1 }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const input = JSON.parse(body.messages[1].content).candidates;
      const system = body.messages[0].content;
      const items = input.map(({ ref }) => system.includes('contextual fit')
        ? { ref, score: 60, label: 'possible fit', explanation: 'Provider context supports a closer look.' }
        : system.includes('selective recommendation')
          ? { ref, verdict: 'consider', explanation: 'The supplied event context clears the bar.' }
          : system.includes('advisory urgency')
            ? { ref, label: 'watch', explanation: 'Timing only.' }
            : { ref, score: 4, explanation: 'Known friction only.' });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  const payload = requests.map((request) => request.messages[1].content).join('\n');
  assert.match(payload, /Allowed title/);
  assert.match(payload, /Allowed venue/);
  assert.doesNotMatch(payload, /DO NOT SEND/);
  assert.doesNotMatch(payload, /artistFit|seedStrength|playlistAffinity|topItemsAffinity/);
});

test('ignores harmless cross-pass advisory fields without accepting canonical mutations', async () => {
  const result = await enhanceEventsWithOllama([event('two', ['framework'])], { background: [], decisionPreferences: [], maxEnhancedEvents: 1 }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.messages[1].content).candidates;
      const system = body.messages[0].content;
      const items = input.map(({ ref }) => system.includes('selective recommendation')
        ? { ref, verdict: 'consider', score: 70, label: 'possible fit', explanation: 'Worth consideration.' }
        : system.includes('personal fit')
          ? { ref, score: 70, label: 'possible fit', explanation: 'Context supports it.' }
          : system.includes('advisory urgency')
            ? { ref, label: 'watch', explanation: 'Timing only.' }
            : { ref, score: 4, explanation: 'Known friction only.' });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  assert.equal(result.byId.get('two').recommendation.verdict, 'consider');
  assert.deepEqual(Object.keys(result.byId.get('two').recommendation).sort(), ['explanation', 'verdict']);
});

test('rejects inferred genre mismatch and low-friction skip claims', async () => {
  const result = await enhanceEventsWithOllama([event('two', ['framework'])], { background: ['Electronic and K-pop interests'], decisionPreferences: [], maxEnhancedEvents: 1 }, {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.messages[1].content).candidates;
      const system = body.messages[0].content;
      const items = input.map(({ ref }) => system.includes('selective recommendation')
        ? { ref, verdict: 'skip', explanation: 'The genre does not align with your taste profile.' }
        : system.includes('personal fit')
          ? { ref, score: 60, label: 'possible fit', explanation: 'Context supports a closer look.' }
          : system.includes('advisory urgency')
            ? { ref, label: 'watch', explanation: 'Timing only.' }
            : { ref, score: 4, explanation: 'Known friction only.' });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ items }) } }));
    }
  });
  assert.notEqual(result.byId.get('two').recommendation.verdict, 'skip');
});
test('reuses only matching prior advisory passes when a local pass is absent', () => {
  const enhancement = { byId: new Map([['one', { personalFit: { score: 70, label: 'possible fit', explanation: 'Fresh fit.' } }]]) };
  const current = [event('one', ['ticketmaster'], { title: 'Same Event', startLocal: '2026-08-01T20:00:00', venue: { name: 'Same Venue' } })];
  const previous = [{ id: 'one', title: 'Same Event', startLocal: '2026-08-01T19:00:00', venue: { name: 'Same Venue' }, localEnhancement: {
    personalFit: { score: 40, label: 'exploratory', explanation: 'Old fit.' },
    recommendation: { verdict: 'consider', explanation: 'Previously valid recommendation.' }
  }}];
  const result = reusePreviousEnhancements(enhancement, current, previous);
  assert.deepEqual(result, { reusedPassCount: 1, reusedItemCount: 1 });
  assert.equal(enhancement.byId.get('one').personalFit.explanation, 'Fresh fit.');
  assert.equal(enhancement.byId.get('one').recommendation.verdict, 'consider');

  const changed = { byId: new Map([['one', {}]]) };
  reusePreviousEnhancements(changed, [{ ...current[0], venue: { name: 'Changed Venue' } }], previous);
  assert.deepEqual(changed.byId.get('one'), {});
});
