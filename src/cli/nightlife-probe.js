import { loadEnv } from '../env.js';
import { normalizeTicketmasterEvent } from '../ticketmaster.js';
import { describeNightlifeConfig, nightlifeInferenceConfigured, readNightlifeConfig } from '../nightlife/config.js';
import { createDecisionInferenceProvider } from '../nightlife/inference.js';
import { buildSemanticRequest } from '../nightlife/semanticInput.js';
import { buildQuestionSet } from '../nightlife/questions.js';

/**
 * The design spike, as a command.
 *
 * Runs one synthetic event through exactly the path production uses — adapter
 * normalization, field-level evidence, the model-input serializer, per-event
 * question composition, and the inference orchestrator — then prints what came
 * back: the versioned model that answered, real latency, real spend, and
 * whether the answers survive validation.
 *
 * Driving the real orchestrator rather than hand-building a request is the
 * point. A probe that assembles its own payload drifts silently when the
 * contract changes; this one fails the moment production would.
 *
 * The event is synthetic on purpose, so the probe touches no real source data,
 * no private context, and no restricted provider.
 */
loadEnv();

const config = readNightlifeConfig(process.env);
const described = describeNightlifeConfig(config);
console.log(`Route      ${described.provider}`);
console.log(`Model      ${described.model ?? '—'}`);
console.log(`Base URL   ${described.baseUrl ?? '—'}`);

if (!nightlifeInferenceConfigured(config)) {
  console.error('\nNot configured. Set the matching API key, or NIGHTLIFE_INFERENCE_PROVIDER explicitly.');
  console.error('  direct:  TYPESAFE_AI_API_KEY');
  console.error('  gateway: AI_GATEWAY_API_KEY');
  process.exitCode = 1;
} else {
  const now = new Date();
  const event = normalizeTicketmasterEvent(syntheticTicketmasterEvent(now), now);
  event.ranking = { utility: 60 };
  const { inputs } = buildSemanticRequest([event], {}, { now });
  const questions = buildQuestionSet({ input: inputs[0] });

  if (!Object.keys(questions).length) {
    // An empty question set means the evidence contract and the question
    // composer disagree. Sending it would only earn a 422, so stop here with
    // the reason instead.
    console.error('\nProbe composed no questions from the synthetic event.');
    console.error(`Model-transmittable facts: ${Object.keys(inputs[0].fields.publishedFacts ?? {}).join(', ') || 'none'}`);
    console.error('The serializer and buildQuestionSet have drifted apart; fix that before calling any route.');
    process.exitCode = 1;
  } else {
    console.log(`Questions  ${Object.keys(questions).join(', ')}`);
    const provider = createDecisionInferenceProvider({ ...config, maxAttempts: 1 });
    const { assessments, telemetry } = await provider.assessCandidates(inputs, {}, { refreshCache: true });
    const assessment = assessments.get(inputs[0].ref);

    if (!assessment) {
      console.error(`\nProbe failed: ${telemetry.errors[0] ?? telemetry.status}`);
      if (config.provider === 'gateway') {
        console.error('\nThe Gateway answers `customer_verification_required` until a card is on file for');
        console.error('the Vercel team. Other rejections mean its wire format differs from the native API;');
        console.error('adjust src/nightlife/providers/gateway.js and record what it expects in');
        console.error('docs/system-one-inference.md.');
      }
      process.exitCode = 1;
    } else {
      console.log(`\nAnswered by ${telemetry.resolvedModels.join(', ') || described.model}.`);
      console.log(`Latency    ${telemetry.latencyMsMedian}ms`);
      console.log(`Tokens     in ${telemetry.inputTokens ?? '—'} / out ${telemetry.outputTokens ?? '—'}`);
      if (telemetry.costUsd != null) console.log(`Cost       $${telemetry.costUsd.toFixed(8)} for this one candidate`);

      console.log('\nValidated assessment:');
      for (const [field, band] of Object.entries(assessment.certainty ?? {})) {
        console.log(`  ${field.padEnd(22)} ${String(assessment[field]).padEnd(24)} (${band})`);
      }
      console.log(`  ${'reason'.padEnd(22)} ${assessment.reason}`);
      console.log('\nRaw signals (provider-scoped diagnostics, never rendered):');
      for (const [question, signal] of Object.entries(assessment.signals ?? {})) {
        console.log(`  ${question.padEnd(22)} ${JSON.stringify(signal)}`);
      }
      console.log('\nThe route works and the decision contract holds.');
    }
  }
}

// A plausible Ticketmaster Discovery payload with classification, lineup and a
// published start, dated a few days out so it is always a future event.
function syntheticTicketmasterEvent(now) {
  const date = new Date(now);
  date.setDate(date.getDate() + 5);
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    id: 'probe-synthetic',
    name: 'Probe Night: Open to Close',
    url: 'https://www.ticketmaster.com/event/probe-synthetic',
    dates: { start: { localDate, localTime: '22:00:00' }, status: { code: 'onsale' } },
    classifications: [{ segment: { name: 'Music' }, genre: { name: 'Dance/Electronic' }, subGenre: { name: 'House' } }],
    _embedded: {
      venues: [{ id: 'probe-venue', name: 'Probe Hall', city: { name: 'Los Angeles' }, state: { stateCode: 'CA' }, location: { latitude: '34.04', longitude: '-118.24' } }],
      attractions: [{ id: 'probe-artist', name: 'Probe Artist' }]
    }
  };
}
