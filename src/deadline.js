// A hung provider must not stall a refresh. The deadline rejects the source so
// it is reported unavailable and every other source still publishes; the
// underlying request is abandoned rather than awaited.
export const SOURCE_DEADLINE_MS = 60_000;

export function withDeadline(promise, ms = SOURCE_DEADLINE_MS, label = 'source') {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}
