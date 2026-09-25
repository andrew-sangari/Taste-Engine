import { assertNoRestrictedEvidence } from '../semanticInput.js';

export class InferenceTransportError extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

// 429 (rate limited) and 529 (overloaded) are documented as retryable with
// backoff. 401 and 422 are not: retrying a bad credential or a malformed
// question body only burns the budget and the rate limit.
const RETRYABLE_STATUSES = new Set([429, 529]);

/**
 * Shared System One transport.
 *
 * Both routes speak the same documented request and response shape, so the
 * mapping lives here once and each adapter supplies only its endpoint, auth,
 * model identifier, and any response envelope it wraps around the payload.
 */
export async function postSystemOne({
  route,
  headers,
  model,
  state,
  questions,
  signal,
  timeoutMs,
  fetchImpl,
  unwrap = (body) => body
}) {
  // Last gate before the payload leaves the process, behind the serializer's
  // allowlist. A leak should be impossible; this makes it loud if it is not.
  assertNoRestrictedEvidence(state);

  const started = Date.now();
  let response;
  try {
    response = await fetchImpl(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ state, model, questions }),
      signal: signal ?? AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new InferenceTransportError(
      timedOut ? 'The inference request timed out.' : 'The inference request could not be sent.',
      { retryable: timedOut }
    );
  }

  if (!response.ok) {
    throw new InferenceTransportError(`The inference request failed (${response.status}).`, {
      retryable: RETRYABLE_STATUSES.has(response.status) || response.status >= 500,
      status: response.status
    });
  }

  let body;
  try {
    body = unwrap(await response.json());
  } catch {
    throw new InferenceTransportError('The inference response was not valid JSON.');
  }
  if (!body || typeof body !== 'object' || !body.answers || typeof body.answers !== 'object') {
    throw new InferenceTransportError('The inference response contained no answers map.');
  }

  return {
    answers: body.answers,
    latencyMs: Date.now() - started,
    route,
    // The alias may move, so the versioned id that actually answered is
    // recorded rather than the id we asked for.
    model: typeof body.model === 'string' ? body.model : model,
    usage: {
      inputTokens: integerOrNull(body.usage?.input_tokens),
      outputTokens: integerOrNull(body.usage?.output_tokens)
    }
  };
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
