import { MovieExplorer } from 'taste-engine-site';

const DEMO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2362dfc3'/%3E%3Cstop offset='1' stop-color='%23173f36'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)'/%3E%3C/svg%3E";

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

const generatedAt = '2026-07-12T12:00:00.000-07:00';

const movies = [
  {
    id: 'qa-movie-confirmed',
    title: 'Synthetic Projection',
    sourceUrl: 'https://example.com/synthetic/synthetic-projection',
    releaseDate: '2026-07-20',
    overview: 'A synthetic theatrical description used only for browser QA.',
    tasteScore: 88,
    reasons: ['The local fixture confirms a premium presentation.'],
    directors: ['Example Director'],
    runtimeMinutes: 124,
    formatStatus: 'confirmed locally',
    format: 'IMAX',
    theater: 'Synthetic Cinema',
    premiumFormatConfirmed: true,
    posterUrl: DEMO_IMAGE,
    backdropUrl: DEMO_IMAGE,
    visual: { kind: 'image', url: DEMO_IMAGE, alt: 'Synthetic Projection poster', focalPoint: { x: 78, y: 50 }, attribution: 'Synthetic TMDB-style local fixture' },
  },
  {
    id: 'qa-movie-fallback',
    title: 'Image Fallback Feature',
    sourceUrl: 'https://example.com/synthetic/image-fallback-feature',
    releaseDate: '2026-07-30',
    overview: 'This card keeps its title and reason when its declared image is missing.',
    tasteScore: 74,
    reasons: ['Format confirmation remains pending.'],
    directors: [],
    runtimeMinutes: null,
    formatStatus: 'release watch',
    format: null,
    theater: null,
    premiumFormatConfirmed: false,
    posterUrl: null,
    backdropUrl: '/missing-qa-movie.svg',
    visual: { kind: 'image', url: '/missing-qa-movie.svg', alt: 'Synthetic fallback feature image' },
  },
  {
    id: 'qa-movie-long-lead',
    title: 'Long Lead Cinema',
    sourceUrl: 'https://example.com/synthetic/long-lead-cinema',
    releaseDate: null,
    overview: 'A no-date movie case remains visible without inventing a release date.',
    tasteScore: 63,
    reasons: [],
    directors: ['Pending Director'],
    runtimeMinutes: 99,
    formatStatus: 'long lead',
    format: null,
    theater: null,
    premiumFormatConfirmed: false,
    posterUrl: null,
    backdropUrl: null,
    visual: { kind: 'texture', variant: 'movie-projection-light' },
  },
];

export function ConfirmedAndUpcoming() {
  return (
    <div style={canvas}>
      <MovieExplorer movies={movies} tmdbStatus="active" generatedAt={generatedAt} />
    </div>
  );
}

export function NoTmdbSource() {
  return (
    <div style={canvas}>
      <MovieExplorer movies={[]} tmdbStatus="not configured" generatedAt={generatedAt} />
    </div>
  );
}
