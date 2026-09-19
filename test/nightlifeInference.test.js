import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionInferenceProvider } from '../src/nightlife/inference.js';
import { createGatewayProvider } from '../src/nightlife/providers/gateway.js';
import { createDirectServingProvider } from '../src/nightlife/providers/directServing.js';
import { buildSemanticRequest } from '../src/nightlife/semanticInput.js';
import { normalizeNightlifeContext } from '../src/nightlife/context.js';
import { readNightlifeConfig } from '../src/nightlife/config.js';

const context = normalizeNightlifeContext({
  goal: 'Something loud and late downtown',
  date: '2026-09-26',
  latestReturn: '03:00',
  startArea: 'Downtown / Arts District',
  lateNightIntent: 'out late',
  noveltyAppetite: 'exploratory'
});

function candidate(id = 'ticketmaster:1') {
  return {
    id,
    title: 'A Permitted Show',
    startLocal: '2026-09-26T22:00:00',
    timeTbd: false,
    venue: { name: 'Venue', city: 'Los Angeles', lat: 34.043, lon: -118.24 },
    performers: [],
    matchedArtists: [{ origin: 'similar' }],
    ticketObservation: { lowestPriceUsd: 30 },
    sourceOccurrences: [{
      source: 'ticketmaster',
      sourceEventId: 'tm-1',
      sourceUrl: 'https://ticketmaster.com/e/1',
      title: 'A Permitted Show',
      venue: { name: 'Venue', city: 'Los Angeles', lat: 34.043, lon: -118.24 },
      performerNames: ['Artist']
    }],
    ranking: { utility: 62 }
  };
}

// A complete, well-formed System One response for the question set.
function answersFixture({ contextFit = 'strong', confidence = 0.9, travelNoul = 0.1 } = {}) {
  return {
    model: 'jev-1.13.0',
    answers: {
      context_fit: { type: 'choice', choice: contextFit, probabilities: { strong: 0.9, possible: 0.06, exploratory: 0.03, poor: 0.01 }, confidence },
      music_fit: { type: 'choice', choice: 'possible', probabilities: { strong: 0.3, possible: 0.6, weak: 0.1 }, confidence: 0.8 },
      late_night_fit: { type: 'choice', choice: 'possible', probabilities: { confirmed: 0.2, possible: 0.7, unlikely: 0.1 }, confidence: 0.77 },
      novelty: { type: 'choice', choice: 'adjacent', probabilities: { familiar: 0.2, adjacent: 0.7, exploratory: 0.1 }, confidence: 0.81 },
      friction_travel: { type: 'noul', noul: travelNoul },
      friction_timing: { type: 'noul', noul: 0.2 },
      friction_coordination: { type: 'noul', noul: 0.15 }
    },
    usage: { input_tokens: 400, output_tokens: 20 }
  };
}

function inputsFor(candidates = [candidate()]) {
  return buildSemanticRequest(candidates, context, { now: new Date('2026-09-20T12:00:00') }).inputs;
}

function providerWith(fetchImpl, overrides = {}) {
  return createDecisionInferenceProvider({
    provider: 'direct',
    direct: { apiKey: 'test-key', model: 'jev-latest' },
    retryBaseMs: 10,
    ...overrides
  }, { fetchImpl });
}

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('the gateway adapter posts a System One body to the evaluation route', async () => {
  const seen = [];
  const adapter = createGatewayProvider({
    apiKey: 'gw-key',
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return ok(answersFixture());
    }
  });
  assert.equal(adapter.model, 'typesafe-ai/jev');
  const result = await adapter.evaluate({
    state: { candidate: { ref: 'cand-1' } },
    questions: { context_fit: { type: 'choice' }, friction_travel: { type: 'noul' } }
  });
  assert.equal(seen[0].url, 'https://ai-gateway.vercel.sh/v1/evaluate');
  assert.equal(seen[0].options.headers.authorization, 'Bearer gw-key');
  const body = JSON.parse(seen[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ['model', 'questions', 'state']);
  assert.equal(body.model, 'typesafe-ai/jev');
  // The versioned id that answered is recorded, not the alias that was asked for.
  assert.equal(result.model, 'jev-1.13.0');
  assert.equal(result.usage.inputTokens, 400);
  // The Gateway rejects `noul` and expects `boolean`; the translation belongs
  // in the adapter, not in the domain vocabulary.
  assert.equal(body.questions.friction_travel.type, 'boolean');
  assert.equal(body.questions.context_fit.type, 'choice');
});

test('a gateway boolean answer maps back to the internal noul vocabulary', async () => {
  const adapter = createGatewayProvider({
    apiKey: 'gw-key',
    fetchImpl: async () => ok({
      model: 'jev-1.13.0',
      answers: { friction_travel: { type: 'boolean', boolean: 0.82 } },
      usage: { input_tokens: 10, output_tokens: 1 }
    })
  });
  const result = await adapter.evaluate({ state: {}, questions: { friction_travel: { type: 'noul' } } });
  assert.deepEqual(result.answers.friction_travel, { type: 'noul', noul: 0.82 });
});

test('the gateway adapter unwraps an enveloped response', async () => {
  const adapter = createGatewayProvider({
    apiKey: 'gw-key',
    fetchImpl: async () => ok({ data: answersFixture() })
  });
  const result = await adapter.evaluate({ state: {}, questions: {} });
  assert.ok(result.answers.context_fit);
});

test('the direct adapter posts to the documented native endpoint', async () => {
  const seen = [];
  const adapter = createDirectServingProvider({
    apiKey: 'ts-key',
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return ok(answersFixture());
    }
  });
  await adapter.evaluate({ state: {}, questions: {} });
  assert.equal(seen[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(JSON.parse(seen[0].options.body).model, 'jev-latest');
});

test('both routes produce an identical assessment from identical answers', async () => {
  const fixture = answersFixture();
  const gateway = createDecisionInferenceProvider(
    { provider: 'gateway', gateway: { apiKey: 'k' } },
    { fetchImpl: async () => ok(fixture) }
  );
  const direct = createDecisionInferenceProvider(
    { provider: 'direct', direct: { apiKey: 'k' } },
    { fetchImpl: async () => ok(fixture) }
  );
  const inputs = inputsFor();
  const left = await gateway.assessCandidates(inputs, context);
  const right = await direct.assessCandidates(inputs, context);
  const strip = (value) => {
    const { provider: _provider, model: _model, cached: _cached, ...rest } = value;
    return rest;
  };
  assert.deepEqual(strip(left.assessments.get('cand-1')), strip(right.assessments.get('cand-1')));
});

test('low confidence becomes unknown rather than a weak rating', async () => {
  const provider = providerWith(async () => ok(answersFixture({ contextFit: 'poor', confidence: 0.31 })));
  const { assessments } = await provider.assessCandidates(inputsFor(), context);
  const assessment = assessments.get('cand-1');
  assert.equal(assessment.contextFit, 'unknown');
  assert.equal(assessment.certainty.contextFit, 'low');
  assert.match(assessment.reason, /Not enough evidence/);
});

test('the composed reason is deterministic and never quotes the model', async () => {
  const provider = providerWith(async () => ok(answersFixture()));
  const { assessments } = await provider.assessCandidates(inputsFor(), context);
  const assessment = assessments.get('cand-1');
  assert.equal(assessment.reason, 'Matches the night you described; it could run late, though no source publishes an end time, it sits one step off your usual pattern.');
  assert.ok(!/https?:\/\//.test(assessment.reason));
  // Evidence refs point back into what was actually supplied.
  assert.ok(assessment.evidenceRefs.every((ref) => ref.startsWith('cand-1/')));
});

test('a friction noul above the flag threshold raises exactly one flag', async () => {
  const provider = providerWith(async () => ok(answersFixture({ travelNoul: 0.8 })));
  const { assessments } = await provider.assessCandidates(inputsFor(), context);
  assert.ok(assessments.get('cand-1').frictionFlags.includes('long-travel'));

  const quiet = providerWith(async () => ok(answersFixture({ travelNoul: 0.5 })));
  const { assessments: unflagged } = await quiet.assessCandidates(inputsFor(), context);
  // The middle band is "not established" and must not raise the flag.
  assert.ok(!unflagged.get('cand-1').frictionFlags.includes('long-travel'));
});

test('an unrequested question id is rejected as a validation failure', async () => {
  const provider = providerWith(async () => ok({
    model: 'jev-1.13.0',
    answers: { ...answersFixture().answers, smuggled: { type: 'noul', noul: 1 } },
    usage: { input_tokens: 10, output_tokens: 1 }
  }));
  const { assessments, telemetry } = await provider.assessCandidates(inputsFor(), context);
  assert.equal(assessments.size, 0);
  assert.equal(telemetry.validationFailures, 1);
  assert.equal(telemetry.status, 'deterministic fallback');
});

test('an option outside the declared criteria is rejected', async () => {
  const fixture = answersFixture();
  fixture.answers.context_fit.choice = 'spectacular';
  const provider = providerWith(async () => ok(fixture));
  const { telemetry } = await provider.assessCandidates(inputsFor(), context);
  assert.equal(telemetry.validationFailures, 1);
});

test('one failing candidate falls back alone and coverage reports it', async () => {
  let call = 0;
  const provider = providerWith(async () => {
    call += 1;
    if (call === 1) return { ok: false, status: 422, json: async () => ({}) };
    return ok(answersFixture());
  }, { concurrency: 1 });
  const inputs = inputsFor([candidate('ticketmaster:1'), candidate('ticketmaster:2')]);
  const { assessments, telemetry } = await provider.assessCandidates(inputs, context);
  assert.equal(assessments.size, 1);
  assert.equal(telemetry.status, 'partial inference');
  assert.deepEqual(telemetry.coverage, { requested: 2, covered: 1, uncovered: ['cand-1'] });
});

test('a 429 is retried with backoff and a 422 is not', async () => {
  let attempts = 0;
  const retried = providerWith(async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 429, json: async () => ({}) };
    return ok(answersFixture());
  });
  const result = await retried.assessCandidates(inputsFor(), context);
  assert.equal(result.assessments.size, 1);
  assert.equal(result.telemetry.retries, 1);

  let hardAttempts = 0;
  const notRetried = providerWith(async () => {
    hardAttempts += 1;
    return { ok: false, status: 422, json: async () => ({}) };
  });
  await notRetried.assessCandidates(inputsFor(), context);
  assert.equal(hardAttempts, 1, 'a malformed request must not be retried');
});

test('a timeout falls back without throwing', async () => {
  const provider = providerWith(async () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  }, { maxAttempts: 1 });
  const { assessments, telemetry } = await provider.assessCandidates(inputsFor(), context);
  assert.equal(assessments.size, 0);
  assert.equal(telemetry.errors.length, 1);
});

test('a malformed body is a validation failure, not a crash', async () => {
  const provider = providerWith(async () => ok({ model: 'jev-1.13.0', notAnswers: true }));
  const { telemetry } = await provider.assessCandidates(inputsFor(), context);
  assert.equal(telemetry.callsCompleted, 0);
  assert.equal(telemetry.errors.length, 1);
});

test('a second identical request is served from cache without another call', async () => {
  let calls = 0;
  const provider = providerWith(async () => {
    calls += 1;
    return ok(answersFixture());
  });
  const inputs = inputsFor();
  await provider.assessCandidates(inputs, context);
  const second = await provider.assessCandidates(inputs, context);
  assert.equal(calls, 1);
  assert.equal(second.telemetry.cacheHits, 1);
  assert.equal(second.assessments.get('cand-1').cached, true);
});

test('a changed candidate revision invalidates the cached assessment', async () => {
  let calls = 0;
  const provider = providerWith(async () => {
    calls += 1;
    return ok(answersFixture());
  });
  const inputs = inputsFor();
  inputs[0].revision = 'rev-1';
  await provider.assessCandidates(inputs, context);
  const moved = inputsFor();
  moved[0].revision = 'rev-2';
  await provider.assessCandidates(moved, context);
  assert.equal(calls, 2);
});

test('spend is reported per assessed candidate from documented pricing', async () => {
  const provider = providerWith(async () => ok(answersFixture()));
  const { telemetry } = await provider.assessCandidates(inputsFor(), context);
  // 400 input tokens at $42 per billion.
  assert.equal(telemetry.costUsd, 0.0000168);
  assert.equal(telemetry.costPerAssessedCandidateUsd, 0.0000168);
  assert.deepEqual(telemetry.resolvedModels, ['jev-1.13.0']);
});

test('a disabled provider makes no call and reports deterministic fallback', async () => {
  const provider = createDecisionInferenceProvider({ provider: 'disabled' }, {
    fetchImpl: async () => {
      throw new Error('must not be called');
    }
  });
  const { assessments, telemetry } = await provider.assessCandidates(inputsFor(), context);
  assert.equal(assessments.size, 0);
  assert.equal(telemetry.status, 'not configured');
});

test('config selects a route without leaking a secret into its description', () => {
  const config = readNightlifeConfig({ NIGHTLIFE_INFERENCE_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'super-secret' });
  assert.equal(config.provider, 'gateway');
  assert.equal(config.gateway.model, 'typesafe-ai/jev');
  const described = createDecisionInferenceProvider(config, { fetchImpl: async () => ok(answersFixture()) }).describe();
  assert.ok(!JSON.stringify(described).includes('super-secret'));
  assert.equal(described.configured, true);
});

test('an unknown provider name falls back to disabled rather than guessing', () => {
  assert.equal(readNightlifeConfig({ NIGHTLIFE_INFERENCE_PROVIDER: 'anthropic' }).provider, 'disabled');
});

test('with no explicit provider, the verified direct route is preferred', () => {
  assert.equal(readNightlifeConfig({ TYPESAFE_AI_API_KEY: 'k' }).provider, 'direct');
  assert.equal(readNightlifeConfig({ AI_GATEWAY_API_KEY: 'k' }).provider, 'gateway');
  // A credential for both prefers direct; an explicit choice still wins.
  assert.equal(readNightlifeConfig({ TYPESAFE_AI_API_KEY: 'k', AI_GATEWAY_API_KEY: 'k' }).provider, 'direct');
  assert.equal(readNightlifeConfig({ TYPESAFE_AI_API_KEY: 'k', NIGHTLIFE_INFERENCE_PROVIDER: 'gateway' }).provider, 'gateway');
  assert.equal(readNightlifeConfig({}).provider, 'disabled');
});
