const API_URL = 'https://ws.audioscrobbler.com/2.0/';

export async function getSimilarArtists(artist, { apiKey, limit = 6, fetchImpl = fetch } = {}) {
  const body = await lastFmRequest('artist.getsimilar', { artist, limit, autocorrect: 1 }, { apiKey, fetchImpl });
  return (Array.isArray(body.similarartists?.artist) ? body.similarartists.artist : [])
    .map((item) => ({
      name: String(item.name ?? '').trim(),
      mbid: String(item.mbid ?? '').trim() || null,
      url: String(item.url ?? '').trim() || null,
      match: boundedNumber(item.match, 0, 1)
    }))
    .filter((item) => item.name);
}

export async function getTopArtistsForTag(tag, { apiKey, limit = 25, page = 1, fetchImpl = fetch } = {}) {
  const body = await lastFmRequest('tag.gettopartists', { tag, limit, page }, { apiKey, fetchImpl });
  return (Array.isArray(body.topartists?.artist) ? body.topartists.artist : [])
    .map((item, index) => ({
      name: String(item.name ?? '').trim(),
      mbid: String(item.mbid ?? '').trim() || null,
      url: String(item.url ?? '').trim() || null,
      rank: positiveInteger(item['@attr']?.rank, index + 1)
    }))
    .filter((item) => item.name);
}

async function lastFmRequest(method, params, { apiKey, fetchImpl }) {
  if (!apiKey) throw new Error('Set LASTFM_API_KEY before expanding taste signals.');
  const url = new URL(API_URL);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`Last.fm ${method} request failed: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Last.fm ${method} request failed (${response.status}).`);
  const body = await response.json();
  if (body.error) throw new Error(`Last.fm ${method} request failed (${body.error}): ${body.message ?? 'Unknown API error'}`);
  return body;
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
