const DISCOVER_URL = 'https://api.themoviedb.org/3/discover/movie';

export async function fetchUpcomingMovies({
  accessToken,
  apiKey,
  startDate,
  endDate,
  maxPages = 5,
  fetchImpl = fetch
}) {
  const auth = resolveTmdbAuth(accessToken, apiKey);
  if (!auth.accessToken && !auth.apiKey) throw new Error('TMDB_ACCESS_TOKEN or TMDB_API_KEY is not configured.');
  const movies = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(DISCOVER_URL);
    url.searchParams.set('language', 'en-US');
    url.searchParams.set('region', 'US');
    url.searchParams.set('include_adult', 'false');
    url.searchParams.set('include_video', 'false');
    url.searchParams.set('with_release_type', '2|3');
    url.searchParams.set('release_date.gte', startDate);
    url.searchParams.set('release_date.lte', endDate);
    url.searchParams.set('sort_by', 'popularity.desc');
    url.searchParams.set('page', String(page));
    if (auth.apiKey) url.searchParams.set('api_key', auth.apiKey);
    const headers = auth.accessToken ? { authorization: `Bearer ${auth.accessToken}`, accept: 'application/json' } : { accept: 'application/json' };
    const response = await fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`TMDB request failed (${response.status}).`);
    const body = await response.json();
    movies.push(...(Array.isArray(body.results) ? body.results : []));
    if (page >= Number(body.total_pages ?? 1)) break;
  }
  return movies;
}

export async function enrichMovieMetadata(movies, {
  accessToken,
  apiKey,
  limit = 40,
  concurrency = 4,
  fetchImpl = fetch
}) {
  const auth = resolveTmdbAuth(accessToken, apiKey);
  const selected = movies.slice(0, limit);
  const output = new Array(selected.length);
  let next = 0;
  async function worker() {
    while (next < selected.length) {
      const index = next;
      next += 1;
      const movie = selected[index];
      const url = new URL(`https://api.themoviedb.org/3/movie/${movie.id}`);
      url.searchParams.set('language', 'en-US');
      url.searchParams.set('append_to_response', 'credits,keywords,release_dates');
      if (auth.apiKey) url.searchParams.set('api_key', auth.apiKey);
      const headers = auth.accessToken ? { authorization: `Bearer ${auth.accessToken}`, accept: 'application/json' } : { accept: 'application/json' };
      const response = await fetchImpl(url, { headers });
      if (!response.ok) throw new Error(`TMDB movie metadata request failed (${response.status}).`);
      output[index] = { ...movie, ...await response.json() };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  return output;
}

export function resolveTmdbAuth(accessToken, apiKey) {
  const token = String(accessToken ?? '').trim().replace(/^Bearer\s+/i, '');
  const key = String(apiKey ?? '').trim();
  if (key) return { accessToken: token || null, apiKey: key };
  if (/^[a-f0-9]{32}$/i.test(token)) return { accessToken: null, apiKey: token };
  return { accessToken: token || null, apiKey: null };
}

export function normalizeTmdbMovie(movie, retrievedAt = new Date()) {
  const crew = movie.credits?.crew ?? [];
  const usRelease = (movie.release_dates?.results ?? []).find((item) => item.iso_3166_1 === 'US');
  return {
    id: `tmdb:${movie.id}`,
    source: 'tmdb',
    sourceUrl: `https://www.themoviedb.org/movie/${movie.id}`,
    retrievedAt: new Date(retrievedAt).toISOString(),
    title: String(movie.title ?? movie.original_title ?? '').trim(),
    releaseDate: movie.release_date || null,
    overview: String(movie.overview ?? '').trim(),
    popularity: Number(movie.popularity) || 0,
    voteAverage: Number(movie.vote_average) || 0,
    runtimeMinutes: Number(movie.runtime) || null,
    genres: (movie.genres ?? []).map((genre) => genre.name).filter(Boolean),
    directors: crew.filter((person) => person.job === 'Director').map((person) => person.name),
    cinematographers: crew.filter((person) => person.job === 'Director of Photography').map((person) => person.name),
    cast: (movie.credits?.cast ?? []).slice(0, 8).map((person) => person.name),
    companies: (movie.production_companies ?? []).map((company) => company.name),
    keywords: (movie.keywords?.keywords ?? []).map((keyword) => keyword.name),
    usReleaseDates: (usRelease?.release_dates ?? []).map((release) => ({
      date: release.release_date ?? null,
      type: release.type ?? null,
      note: release.note ?? ''
    })),
    posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    backdropUrl: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
    releaseType: 'theatrical-candidate',
    premiumFormatConfirmed: false,
    format: null,
    theater: null,
    urgency: null,
    hassle: null,
    experienceScore: null,
    formatStatus: 'verification pending'
  };
}
