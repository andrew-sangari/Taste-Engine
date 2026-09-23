import { DEFAULT_GATEWAY_BASE_URL, DEFAULT_GATEWAY_MODEL } from './providers/gateway.js';
import { DEFAULT_DIRECT_BASE_URL, DEFAULT_DIRECT_MODEL } from './providers/directServing.js';

/**
 * Provider selection is configuration, not code. Nothing outside the adapters
 * knows a Gateway URL or a served-model identifier, so a new provider is a new
 * adapter plus a new value here.
 */
export function readNightlifeConfig(env = process.env) {
  return {
    provider: resolveProvider(env),
    requestTimeoutMs: integer(env.NIGHTLIFE_REQUEST_TIMEOUT_MS, 45_000),
    concurrency: integer(env.NIGHTLIFE_CONCURRENCY, 4),
    maxCandidates: integer(env.NIGHTLIFE_MAX_CANDIDATES, 24),
    maxAttempts: integer(env.NIGHTLIFE_MAX_ATTEMPTS, 3),
    deadlineMs: integer(env.NIGHTLIFE_DEADLINE_MS, 60_000),
    maxCostUsd: float(env.NIGHTLIFE_MAX_COST_USD, null),
    gateway: {
      apiKey: text(env.AI_GATEWAY_API_KEY),
      model: text(env.AI_GATEWAY_MODEL) ?? DEFAULT_GATEWAY_MODEL,
      baseUrl: text(env.AI_GATEWAY_BASE_URL) ?? DEFAULT_GATEWAY_BASE_URL,
      requestPath: text(env.AI_GATEWAY_REQUEST_PATH) ?? undefined
    },
    direct: {
      // TYPESAFE_API_KEY is the vendor SDK's conventional name; the longer
      // form is what this project's environment uses.
      apiKey: text(env.TYPESAFE_AI_API_KEY) ?? text(env.TYPESAFE_API_KEY),
      model: text(env.TYPESAFE_AI_MODEL) ?? text(env.TYPESAFE_MODEL) ?? DEFAULT_DIRECT_MODEL,
      baseUrl: text(env.TYPESAFE_AI_BASE_URL) ?? text(env.TYPESAFE_BASE_URL) ?? DEFAULT_DIRECT_BASE_URL,
      requestPath: text(env.TYPESAFE_REQUEST_PATH) ?? undefined
    }
  };
}

/** Whether the selected provider has everything it needs to be called at all. */
export function nightlifeInferenceConfigured(config) {
  if (config.provider === 'gateway') return Boolean(config.gateway.apiKey && config.gateway.model);
  if (config.provider === 'direct') return Boolean(config.direct.apiKey && config.direct.model);
  return false;
}

/** Safe to log and to return from a status route: names routes, never secrets. */
export function describeNightlifeConfig(config) {
  return {
    provider: config.provider,
    configured: nightlifeInferenceConfigured(config),
    model: config.provider === 'gateway' ? config.gateway.model : config.provider === 'direct' ? config.direct.model : null,
    baseUrl: config.provider === 'gateway' ? config.gateway.baseUrl : config.provider === 'direct' ? config.direct.baseUrl : null,
    maxCandidates: config.maxCandidates,
    concurrency: config.concurrency,
    deadlineMs: config.deadlineMs,
    maxCostUsd: config.maxCostUsd
  };
}

/**
 * An explicit NIGHTLIFE_INFERENCE_PROVIDER always wins. With nothing set, pick
 * the route that actually has a credential, preferring direct TypeSafe serving
 * because it is the documented and verified path; the Gateway is the fallback.
 * With no credential at all, stay disabled rather than failing every request.
 */
function resolveProvider(env) {
  const explicit = String(env.NIGHTLIFE_INFERENCE_PROVIDER ?? '').trim().toLowerCase();
  if (['gateway', 'direct', 'disabled'].includes(explicit)) return explicit;
  if (env.TYPESAFE_AI_API_KEY || env.TYPESAFE_API_KEY) return 'direct';
  if (env.AI_GATEWAY_API_KEY) return 'gateway';
  return 'disabled';
}

function text(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function float(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
