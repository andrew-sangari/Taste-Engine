import { postSystemOne } from './systemOneTransport.js';

export const DEFAULT_DIRECT_BASE_URL = 'https://api.typesafe.ai/v1';
export const DEFAULT_DIRECT_MODEL = 'jev-latest';

/**
 * Direct TypeSafe serving adapter.
 *
 * This is the documented native route: `POST /v1/systemone` with a bearer key.
 * It is a real integration boundary rather than a stub — it owns its own
 * endpoint, credential and model naming — and it maps into the same internal
 * decision contract as the Gateway adapter. It is not credentialed yet, so it
 * is exercised against fixtures.
 *
 * Pin a versioned model id (`jev-1.13.0`) rather than the `jev-latest` alias
 * once confidence thresholds have been tuned, since an alias moves on release.
 */
export function createDirectServingProvider({
  apiKey,
  model = DEFAULT_DIRECT_MODEL,
  baseUrl = DEFAULT_DIRECT_BASE_URL,
  requestPath = 'systemone',
  timeoutMs = 45_000,
  fetchImpl = fetch
} = {}) {
  const route = `${String(baseUrl).replace(/\/$/, '')}/${String(requestPath).replace(/^\//, '')}`;
  const configured = Boolean(apiKey && model);
  return {
    name: 'typesafe-direct',
    model,
    route,
    configured,
    describe: () => ({ provider: 'typesafe-direct', model, route, configured }),

    async evaluate({ state, questions, signal } = {}) {
      if (!configured) throw new Error('The direct serving route is not configured.');
      return postSystemOne({
        route,
        headers: { authorization: `Bearer ${apiKey}` },
        model,
        state,
        questions,
        signal,
        timeoutMs,
        fetchImpl
      });
    }
  };
}
