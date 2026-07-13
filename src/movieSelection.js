const GENRES = new Map([
  [12, 'adventure'], [14, 'fantasy'], [16, 'animation'], [27, 'horror'],
  [28, 'action'], [53, 'thriller'], [878, 'science fiction']
]);

export function selectMovieCandidates(movies, config) {
  const preferred = new Set(config.preferredGenreIds ?? []);
  const excluded = new Set(config.excludedGenreIds ?? []);
  return movies
    .filter((movie) => !(movie.genre_ids ?? []).some((id) => excluded.has(id)))
    .map((movie) => {
      const preferredGenres = (movie.genre_ids ?? []).filter((id) => preferred.has(id));
      const popularity = Number(movie.popularity) || 0;
      const names = new Set([
        ...(movie.credits?.crew ?? []).map((person) => person.name),
        ...(movie.credits?.cast ?? []).map((person) => person.name),
        ...(movie.production_companies ?? []).map((company) => company.name)
      ].map(normalize));
      const keywords = new Set((movie.keywords?.keywords ?? []).map((keyword) => normalize(keyword.name)));
      const profileMatches = [
        ...(config.preferredDirectors ?? []),
        ...(config.preferredCinematographers ?? []),
        ...(config.preferredCast ?? []),
        ...(config.preferredCompanies ?? [])
      ].filter((name) => names.has(normalize(name)));
      const keywordMatches = (config.preferredKeywords ?? []).filter((keyword) => keywords.has(normalize(keyword)));
      // Animation alone is a weak taste signal (it sweeps in family-franchise
      // releases); it only counts as genre evidence next to another preferred
      // genre backed by profile or keyword evidence.
      const genreEvidence = profileMatches.length || keywordMatches.length
        ? preferredGenres
        : preferredGenres.filter((id) => id !== 16);
      const tasteTier = profileMatches.length || keywordMatches.length >= 2
        ? 'strong'
        : keywordMatches.length === 1 || genreEvidence.length >= 2
          ? 'potential'
          : 'stretch';
      const qualifies = preferredGenres.length > 0 || popularity >= config.highPopularityOverride;
      const score = popularity + genreEvidence.length * 20 + profileMatches.length * 35 + keywordMatches.length * 12 + (Number(movie.vote_average) || 0) * 2;
      const reasons = [];
      if (profileMatches.length) reasons.push(`Taste-profile match: ${profileMatches.slice(0, 3).join(', ')}.`);
      if (keywordMatches.length) reasons.push(`Preferred film themes: ${keywordMatches.slice(0, 3).join(', ')}.`);
      if (preferredGenres.length) reasons.push(`Premium-format potential: ${preferredGenres.map((id) => GENRES.get(id) ?? `genre ${id}`).join(', ')}.`);
      if (!reasons.length) reasons.push('High-profile theatrical release worth checking for a premium-format engagement.');
      return {
        movie,
        qualifies: (qualifies || profileMatches.length > 0 || keywordMatches.length > 0) && popularity >= config.minimumPopularity,
        score,
        tasteTier,
        reasons
      };
    })
    .filter((item) => item.qualifies)
    .sort((a, b) => tierRank(a.tasteTier) - tierRank(b.tasteTier) || b.score - a.score || String(a.movie.release_date).localeCompare(String(b.movie.release_date)))
    .slice(0, config.maxCandidates);
}

function tierRank(tier) {
  return tier === 'strong' ? 0 : tier === 'potential' ? 1 : 2;
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}
