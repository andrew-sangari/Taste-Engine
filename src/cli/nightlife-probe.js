import { loadEnv } from '../env.js';
import { describeNightlifeConfig, nightlifeInferenceConfigured, readNightlifeConfig } from '../nightlife/config.js';
import { createGatewayProvider } from '../nightlife/providers/gateway.js';
import { createDirectServingProvider } from '../nightlife/providers/directServing.js';
import { buildQuestionSet } from '../nightlife/questions.js';
import { assessmentFromAnswers, validateAnswerEnvelope } from '../nightlife/decisionSchema.js';

/**
 * The design spike, as a command.
 *
 * Sends one synthetic candidate through the configured route and prints what
 * actually came back: the versioned model that answered, real latency, real
 * token spend, and whether the answers survive our own validation. This exists
 * because the Gateway's wire format for evaluation-type models is not publicly
 * documented — assume nothing, measure it.
 *
 * The candidate is synthetic on purpose, so the probe touches no real source
 * data and can be run against an unfamiliar route safely.
 */
loadEnv();

const config = readNightlifeConfig(process.env);
const described = describeNightlifeConfig(config);
console.log(`Route      ${described.provider}`);
console.log(`Model      ${described.model ?? '—'}`);
console.log(`Base URL   ${described.baseUrl ?? '—'}`);

if (!nightlifeInferenceConfigured(config)) {
  console.error('\nNot configured. Set NIGHTLIFE_INFERENCE_PROVIDER and the matching API key.');
  console.error('  gateway: AI_GATEWAY_API_KEY');
  console.error('  direct:  TYPESAFE_API_KEY');
  process.exitCode = 1;
} else {
  const adapter = config.provider === 'gateway'
    ? createGatewayProvider({ ...config.gateway, timeoutMs: config.requestTimeoutMs })
    : createDirectServingProvider({ ...config.direct, timeoutMs: config.requestTimeoutMs });

  // A synthetic candidate in exactly the serializer's shape. No real event, no
  // real source data, no private context.
  const input = {
    ref: 'probe-1',
    restricted: false,
    fields: {
      ref: 'probe-1',
      eventType: 'dj set',
      daysUntil: 2,
      dayOfWeek: 'Saturday',
      startPeriod: 'late',
      startClock: '23:00',
      providerContext: 'ticketmaster',
      eventTitle: 'Probe Event',
      venueName: 'Probe Venue',
      city: 'Los Angeles',
      neighborhood: 'Downtown / Arts District',
      namedPerformerCount: 2,
      adjacentEvidence: ['similar'],
      travelMinutesEstimate: 18,
      knownUnknowns: ['end-time', 'closing-hours', 'after-hours', 'age-policy', 'ticket-availability', 'cover-price']
    },
    evidenceRefs: ['probe-1/eventTitle', 'probe-1/venueName', 'probe-1/startClock']
  };
  const state = {
    request: {
      goal: 'A late electronic night downtown that can run past 2am',
      date: '2026-09-26',
      latestReturn: '03:00',
      startArea: 'Downtown / Arts District',
      transport: 'drive',
      lateNightIntent: 'out late'
    },
    candidate: { ref: input.ref, restricted: false, ...withoutRef(input.fields) }
  };

  try {
    const started = Date.now();
    const result = await adapter.evaluate({ state, questions: buildQuestionSet() });
    const elapsed = Date.now() - started;

    console.log(`\nReached the route in ${elapsed}ms (transport reported ${result.latencyMs}ms).`);
    console.log(`Answered by ${result.model}.`);
    console.log(`Tokens     in ${result.usage.inputTokens ?? '—'} / out ${result.usage.outputTokens ?? '—'}`);
    if (Number.isInteger(result.usage.inputTokens)) {
      console.log(`Cost       $${(result.usage.inputTokens * 42 / 1e9).toFixed(8)} for this one candidate`);
    }

    validateAnswerEnvelope(result.answers, { expectedQuestionIds: Object.keys(buildQuestionSet()) });
    const assessment = assessmentFromAnswers(result.answers, { candidateRef: input.ref, input });
    console.log('\nValidated assessment:');
    console.log(`  contextFit          ${assessment.contextFit} (${assessment.certainty.contextFit})`);
    console.log(`  musicAtmosphereFit  ${assessment.musicAtmosphereFit} (${assessment.certainty.musicAtmosphereFit})`);
    console.log(`  lateNightFit        ${assessment.lateNightFit} (${assessment.certainty.lateNightFit})`);
    console.log(`  novelty             ${assessment.novelty} (${assessment.certainty.novelty})`);
    console.log(`  frictionFlags       ${assessment.frictionFlags.join(', ') || 'none'}`);
    console.log(`  reason              ${assessment.reason}`);
    console.log('\nRaw signals:');
    for (const [question, signal] of Object.entries(assessment.signals)) {
      console.log(`  ${question.padEnd(22)} ${JSON.stringify(signal)}`);
    }
    console.log('\nThe route works and the decision contract holds.');
  } catch (error) {
    console.error(`\nProbe failed: ${error.message}`);
    if (error.status) console.error(`HTTP status: ${error.status}`);
    console.error('\nIf the route rejected the body, the Gateway may wrap evaluation requests');
    console.error('differently from the native API. Adjust src/nightlife/providers/gateway.js');
    console.error('and update docs/system-one-inference.md with what it actually expects.');
    process.exitCode = 1;
  }
}

function withoutRef(fields) {
  const { ref: _ref, ...rest } = fields;
  return rest;
}
