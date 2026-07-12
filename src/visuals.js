const TMDB_IMAGE_HOST = 'image.tmdb.org';

export const DEFAULT_FOCAL_POINT = Object.freeze({ x: 50, y: 50 });

export function resolveMusicVisual(event = {}) {
  const title = String(event.title ?? '').toLowerCase();
  const venue = String(event.venue?.name ?? '').toLowerCase();
  const eventType = String(event.eventType ?? event.type ?? '').toLowerCase();
  if (eventType.includes('festival') || title.includes('festival')) {
    return textureVisual('music-crowd-silhouette', 'Crowd and stage haze atmosphere', { x: 76, y: 52 });
  }
  if (eventType.includes('dj') || title.includes('open to close') || venue.includes('warehouse')) {
    return textureVisual('music-warehouse-beams', 'Directional warehouse performance light', { x: 82, y: 48 });
  }
  if (/arena|hall|amphitheater|pavilion|theatre|theater/.test(venue)) {
    return textureVisual('music-architectural-light', 'Architectural venue light', { x: 76, y: 46 });
  }
  return textureVisual('music-stage-haze', 'Stage haze and directional performance light', { x: 78, y: 50 });
}

export function resolveSportsVisual(game = {}) {
  const context = game.sportsContext ?? {};
  if (context.playoffLeverage === 'high') {
    return textureVisual('sports-scoreboard-glow', 'Restrained night-game scoreboard glow', { x: 84, y: 42 });
  }
  if (context.rivalryTier === 'high') {
    return textureVisual('sports-field-lines', 'Night-game field geometry', { x: 82, y: 58 });
  }
  const hour = localHour(game.startLocal);
  if (hour != null && hour >= 18) {
    return textureVisual('sports-night-game', 'Stadium floodlights and dark stands', { x: 82, y: 42 });
  }
  return textureVisual('sports-stadium-lights', 'Stadium light atmosphere', { x: 80, y: 50 });
}

export function resolveMovieVisual(movie = {}) {
  const title = String(movie.title ?? 'Movie').trim();
  const imageUrl = isAllowedTmdbImage(movie.backdropUrl)
    ? movie.backdropUrl
    : isAllowedTmdbImage(movie.posterUrl)
      ? movie.posterUrl
      : null;
  if (imageUrl) {
    return normalizeVisual({
      kind: 'image',
      url: imageUrl,
      alt: `${title} film image`,
      focalPoint: { x: 72, y: 50 },
      variant: 'movie-tmdb',
      attribution: 'TMDB'
    });
  }
  if (title) return textureVisual('movie-projection-light', 'Projection light and film grain', { x: 80, y: 50 });
  return { kind: 'none' };
}

export function normalizeVisual(visual) {
  if (!visual || typeof visual !== 'object') return { kind: 'none' };
  const kind = ['image', 'texture', 'none'].includes(visual.kind) ? visual.kind : 'none';
  const normalized = { kind };
  if (visual.url && kind === 'image') normalized.url = String(visual.url);
  if (visual.alt) normalized.alt = String(visual.alt);
  if (visual.variant) normalized.variant = String(visual.variant);
  if (visual.attribution) normalized.attribution = String(visual.attribution);
  if (kind !== 'none') normalized.focalPoint = normalizeFocalPoint(visual.focalPoint);
  return normalized;
}

export function normalizeFocalPoint(value) {
  return {
    x: clampPercent(value?.x),
    y: clampPercent(value?.y)
  };
}

export function isAllowedTmdbImage(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' && url.hostname === TMDB_IMAGE_HOST && url.pathname.startsWith('/t/p/');
  } catch {
    return false;
  }
}

function textureVisual(variant, alt, focalPoint) {
  return normalizeVisual({ kind: 'texture', variant, alt, focalPoint });
}

function localHour(value) {
  const match = String(value ?? '').match(/T(\d{2}):/);
  const hour = match ? Number(match[1]) : NaN;
  return Number.isFinite(hour) ? hour : null;
}

function clampPercent(value) {
  if (value == null || value === '') return 50;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 50;
}
