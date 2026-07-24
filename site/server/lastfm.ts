const API_URL = "https://ws.audioscrobbler.com/2.0/";

export type SimilarArtist = {
  name: string;
  match: number;
  sourceArtist: string;
};

export async function getLastfmSimilarArtists(
  artistName: string,
  {
    limit = 8,
    signal,
    fetchImpl = fetch,
  }: {
    limit?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SimilarArtist[]> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) throw new LastfmNotConfiguredError();
  const url = new URL(API_URL);
  url.searchParams.set("method", "artist.getsimilar");
  url.searchParams.set("artist", artistName);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");
  url.searchParams.set("limit", String(Math.min(20, Math.max(1, limit))));
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new LastfmHttpError(response.status);
  const body = await response.json() as {
    similarartists?: { artist?: Array<{ name?: string; match?: string | number }> };
    error?: number;
    message?: string;
  };
  if (body.error) throw new Error(`Last.fm request failed (${body.error}).`);
  return (body.similarartists?.artist ?? [])
    .map((artist) => ({
      name: String(artist.name ?? "").trim(),
      match: boundedNumber(artist.match),
      sourceArtist: artistName,
    }))
    .filter((artist) => artist.name && artist.match > 0);
}

function boundedNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

export class LastfmNotConfiguredError extends Error {
  constructor() {
    super("Last.fm is not configured.");
  }
}

export class LastfmHttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`Last.fm request failed (${status}).`);
    this.status = status;
  }
}
