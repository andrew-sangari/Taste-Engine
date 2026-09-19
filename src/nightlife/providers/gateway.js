import { postSystemOne } from './systemOneTransport.js';

export const DEFAULT_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
export const DEFAULT_GATEWAY_MODEL = 'typesafe-ai/jev';

/**
 * Vercel AI Gateway adapter.
 *
 * The Gateway catalogues Jev as `typesafe-ai/jev` with `type: "evaluation"` —
 * a different modality from its language models, and definitively not the
 * chat-completions surface. Two differences from the native API are confirmed
 * against the live endpoint:
 *
 * - the route is `POST /v1/evaluate`, not `/v1/systemone`;
 * - the yes/no primitive is named `boolean`, not `noul`. The Gateway rejects
 *   `noul` with "Expected 'boolean' | 'choice' | 'score'".
 *
 * Translating that naming is exactly what this adapter is for: the domain
 * vocabulary stays `noul` everywhere above the transport.
 *
 * Routing inference through the Gateway is not a hosting decision; requests are
 * made server-side from the existing Sites runtime.
 */
export function createGatewayProvider({
  apiKey,
  model = DEFAULT_GATEWAY_MODEL,
  baseUrl = DEFAULT_GATEWAY_BASE_URL,
  requestPath = 'evaluate',
  timeoutMs = 45_000,
  fetchImpl = fetch
} = {}) {
  const route = `${String(baseUrl).replace(/\/$/, '')}/${String(requestPath).replace(/^\//, '')}`;
  const configured = Boolean(apiKey && model);
  return {
    name: 'vercel-ai-gateway',
    model,
    route,
    configured,
    describe: () => ({ provider: 'vercel-ai-gateway', model, route, configured }),

    async evaluate({ state, questions, signal } = {}) {
      if (!configured) throw new Error('The AI Gateway route is not configured.');
      return postSystemOne({
        route,
        headers: { authorization: `Bearer ${apiKey}` },
        model,
        state,
        questions: toGatewayQuestions(questions),
        signal,
        timeoutMs,
        fetchImpl,
        unwrap: (body) => fromGatewayBody(body)
      });
    }
  };
}

/** `noul` is this project's vocabulary; the Gateway calls the same thing `boolean`. */
export function toGatewayQuestions(questions = {}) {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [
    id,
    question?.type === 'noul' ? { ...question, type: 'boolean' } : question
  ]));
}

function fromGatewayBody(body) {
  const envelope = body?.answers ? body : body?.data ?? body?.result ?? body;
  if (!envelope?.answers || typeof envelope.answers !== 'object') return envelope;
  return {
    ...envelope,
    answers: Object.fromEntries(Object.entries(envelope.answers).map(([id, answer]) => [id, fromGatewayAnswer(answer)]))
  };
}

/**
 * Map a Gateway answer back into the internal vocabulary.
 *
 * The request-side naming is confirmed; the exact field carrying the boolean
 * probability in the response is not, because the account this was probed with
 * has not been enabled for billing. Several plausible spellings are accepted so
 * the first live call produces a usable answer rather than a validation error,
 * and the decision contract's own validation stays authoritative either way.
 */
function fromGatewayAnswer(answer) {
  if (!answer || typeof answer !== 'object' || answer.type !== 'boolean') return answer;
  const value = [answer.noul, answer.boolean, answer.probability, answer.value]
    .find((candidate) => Number.isFinite(Number(candidate)));
  return { type: 'noul', noul: Number(value) };
}
