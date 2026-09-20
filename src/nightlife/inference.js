import { sanitizeErrorMessage } from '../diagnostics.js';
import { EVENT_EVIDENCE_SCHEMA_VERSION } from '../eventEvidence.js';
import {
  DECISION_SCHEMA_VERSION,
  assessmentFromAnswers,
  validateAnswerEnvelope
} from './decisionSchema.js';
import { QUESTION_SET_VERSION, buildQuestionSet } from './questions.js';
import { assertNoRestrictedEvidence, serializeContext } from './semanticInput.js';
import { assessmentCacheKey, createAssessmentCache } from './assessmentCache.js';
import { createGatewayProvider } from './providers/gateway.js';
import { createDirectServingProvider } from './providers/directServing.js';

export const INFERENCE_PROVIDERS = ['gateway', 'direct', 'disabled'];

// $42 per billion input tokens, output free. Used only to report spend; a route
// that reports its own cost would override this.
const INPUT_TOKEN_COST_USD = 42 / 1e9;

/**
 * The domain-facing inference interface.
 *
 * Everything above this speaks only `SemanticAssessment`. Adding a provider
 * means adding an adapter; no other module in the recommendation pipeline may
 * branch on which provider is configured.
 *
 * One request carries one candidate as the state and every question at once:
 * questions are evaluated in parallel against a shared state, so asking seven
 * costs about what asking one costs. Candidates fan out across requests with
 * bounded concurrency.
 */
export function createDecisionInferenceProvider(config = {}, { fetchImpl = fetch, cache = createAssessmentCache() } = {}) {
  const adapter = adapterFor(config, fetchImpl);
  const concurrency = boundedInteger(config.concurrency, 1, 8, 4);
  const maxCandidates = boundedInteger(config.maxCandidates, 1, 80, 24);
  const maxAttempts = boundedInteger(config.maxAttempts, 1, 4, 3);
  const maxCostUsd = Number.isFinite(config.maxCostUsd) && config.maxCostUsd > 0 ? config.maxCostUsd : null;
  const deadlineMs = boundedInteger(config.deadlineMs, 1_000, 300_000, 60_000);
  const retryBaseMs = boundedInteger(config.retryBaseMs, 10, 5_000, 250);

  return {
    describe() {
      return {
        ...adapter.describe(),
        schemaVersion: DECISION_SCHEMA_VERSION,
        questionSetVersion: QUESTION_SET_VERSION,
        concurrency,
        maxCandidates,
        maxCostUsd,
        deadlineMs
      };
    },

    /**
     * @param {Array} inputs source-safe candidate inputs from `buildSemanticRequest`
     * @param {object} context normalized nightlife context
     * @returns {Promise<{assessments: Map<string, object>, telemetry: object}>}
     */
    async assessCandidates(inputs, context, options = {}) {
      const started = Date.now();
      const requested = inputs.slice(0, maxCandidates);
      const telemetry = baseTelemetry(adapter, {
        requestedCount: requested.length,
        skippedForBudget: inputs.length - requested.length
      });
      const assessments = new Map();

      if (!adapter.configured || !requested.length) {
        telemetry.status = adapter.configured ? 'no candidates' : 'not configured';
        telemetry.totalMs = Date.now() - started;
        telemetry.coverage = coverage(requested, assessments);
        return { assessments, telemetry };
      }

      const safeContext = serializeContext(context);
      const deadline = started + deadlineMs;
      const pending = [];

      for (const input of requested) {
        const questions = buildQuestionSet({ input });
        const evidenceMode = Object.keys(input.fields?.publishedFacts ?? {}).length > 0;
        const key = assessmentCacheKey({
          candidateRevision: input.revision ?? null,
          input: evidenceMode
            ? { publishedFacts: input.fields.publishedFacts, knownUnknowns: input.fields.knownUnknowns }
            : input.fields,
          context: evidenceMode ? null : safeContext,
          schemaVersion: DECISION_SCHEMA_VERSION,
          promptVersion: QUESTION_SET_VERSION,
          questionIds: Object.keys(questions),
          evidenceSchemaVersion: EVENT_EVIDENCE_SCHEMA_VERSION,
          criteriaVersion: QUESTION_SET_VERSION,
          provider: adapter.name,
          model: adapter.model
        });
        const cached = options.refreshCache ? null : cache.get(key);
        if (cached) {
          telemetry.cacheHits += 1;
          assessments.set(input.ref, { ...cached, cached: true });
          continue;
        }
        pending.push({ input, key, questions, evidenceMode });
      }

      await runWithConcurrency(pending, concurrency, async ({ input, key, questions, evidenceMode }) => {
        if (!Object.keys(questions).length) return;
        if (Date.now() >= deadline) {
          telemetry.deadlineSkipped += 1;
          return;
        }
        if (maxCostUsd != null && (telemetry.costUsd ?? 0) >= maxCostUsd) {
          telemetry.budgetSkipped += 1;
          return;
        }

        const state = evidenceMode
          ? {
            event: {
              ref: input.ref,
              published: input.fields.publishedFacts,
              missing: input.fields.knownUnknowns ?? []
            }
          }
          : { request: safeContext, candidate: { ref: input.ref, restricted: input.restricted, ...withoutRef(input.fields) } };
        assertNoRestrictedEvidence(state);

        let result = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          telemetry.callsAttempted += 1;
          try {
            result = await adapter.evaluate({
              state,
              questions,
              signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now()))
            });
            break;
          } catch (error) {
            if (!error?.retryable || attempt === maxAttempts || Date.now() >= deadline) {
              // Per-candidate fallback: this ref simply stays uncovered and the
              // deterministic layer answers for it.
              telemetry.errors.push(sanitizeErrorMessage(error));
              return;
            }
            telemetry.retries += 1;
            await delay(retryBaseMs * 2 ** (attempt - 1));
          }
        }
        if (!result) return;

        telemetry.callsCompleted += 1;
        telemetry.latencyMsTotal += result.latencyMs ?? 0;
        telemetry.latencies.push(result.latencyMs ?? 0);
        accumulateUsage(telemetry, result.usage);
        if (result.model) telemetry.resolvedModels.add(result.model);

        let assessment;
        try {
          validateAnswerEnvelope(result.answers, { expectedQuestionIds: Object.keys(questions) });
          assessment = assessmentFromAnswers(result.answers, {
            candidateRef: input.ref,
            input,
            certaintyThresholds: config.certaintyThresholds,
            noulThresholds: config.noulThresholds
          });
        } catch (error) {
          telemetry.validationFailures += 1;
          telemetry.errors.push(sanitizeErrorMessage(error));
          return;
        }

        const stored = { ...assessment, provider: adapter.name, model: result.model ?? adapter.model };
        cache.set(key, stored);
        assessments.set(input.ref, { ...stored, cached: false });
      });

      telemetry.totalMs = Date.now() - started;
      telemetry.coverage = coverage(requested, assessments);
      telemetry.status = statusFor(telemetry);
      telemetry.resolvedModels = [...telemetry.resolvedModels];
      telemetry.latencyMsMedian = median(telemetry.latencies);
      telemetry.latencyMsMax = telemetry.latencies.length ? Math.max(...telemetry.latencies) : null;
      delete telemetry.latencies;
      telemetry.costPerAssessedCandidateUsd = telemetry.costUsd != null && telemetry.coverage.covered
        ? Number((telemetry.costUsd / telemetry.coverage.covered).toFixed(8))
        : null;
      return { assessments, telemetry };
    }
  };
}

function adapterFor(config, fetchImpl) {
  const provider = String(config.provider ?? 'disabled').toLowerCase();
  if (provider === 'gateway') return createGatewayProvider({ ...config.gateway, timeoutMs: config.requestTimeoutMs, fetchImpl });
  if (provider === 'direct') return createDirectServingProvider({ ...config.direct, timeoutMs: config.requestTimeoutMs, fetchImpl });
  if (provider === 'custom' && config.adapter) return config.adapter;
  return disabledAdapter();
}

function disabledAdapter() {
  return {
    name: 'disabled',
    model: null,
    route: null,
    configured: false,
    describe: () => ({ provider: 'disabled', model: null, route: null, configured: false }),
    async evaluate() {
      throw new Error('Decision inference is disabled.');
    }
  };
}

function baseTelemetry(adapter, { requestedCount, skippedForBudget }) {
  const described = adapter.describe();
  return {
    provider: described.provider,
    model: described.model,
    route: described.route,
    resolvedModels: new Set(),
    schemaVersion: DECISION_SCHEMA_VERSION,
    questionSetVersion: QUESTION_SET_VERSION,
    requestedCount,
    skippedForBudget,
    callsAttempted: 0,
    callsCompleted: 0,
    retries: 0,
    cacheHits: 0,
    validationFailures: 0,
    deadlineSkipped: 0,
    budgetSkipped: 0,
    latencies: [],
    latencyMsTotal: 0,
    latencyMsMedian: null,
    latencyMsMax: null,
    totalMs: 0,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    costPerAssessedCandidateUsd: null,
    errors: [],
    coverage: { requested: requestedCount, covered: 0, uncovered: [] },
    status: 'pending'
  };
}

function accumulateUsage(telemetry, usage = {}) {
  if (Number.isInteger(usage.inputTokens)) {
    telemetry.inputTokens = (telemetry.inputTokens ?? 0) + usage.inputTokens;
    telemetry.costUsd = Number((((telemetry.costUsd ?? 0) + usage.inputTokens * INPUT_TOKEN_COST_USD)).toFixed(10));
  }
  if (Number.isInteger(usage.outputTokens)) telemetry.outputTokens = (telemetry.outputTokens ?? 0) + usage.outputTokens;
}

function coverage(requested, assessments) {
  const uncovered = requested.filter((input) => !assessments.has(input.ref)).map((input) => input.ref);
  return { requested: requested.length, covered: requested.length - uncovered.length, uncovered };
}

function statusFor(telemetry) {
  if (!telemetry.coverage.covered) return 'deterministic fallback';
  return telemetry.coverage.uncovered.length ? 'partial inference' : 'assessed';
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function withoutRef(fields) {
  const { ref: _ref, ...rest } = fields;
  return rest;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
