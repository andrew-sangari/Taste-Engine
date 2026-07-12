import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFocalPoint, resolveMovieVisual, resolveMusicVisual, resolveSportsVisual } from '../src/visuals.js';

test('music textures follow the deterministic precedence order', () => {
  assert.equal(resolveMusicVisual({ title: 'Warehouse DJ Festival', eventType: 'festival', venue: { name: 'Warehouse' } }).variant, 'music-crowd-silhouette');
  assert.equal(resolveMusicVisual({ title: 'Open to close', eventType: 'concert', venue: { name: 'Warehouse LA' } }).variant, 'music-warehouse-beams');
  assert.equal(resolveMusicVisual({ title: 'Artist live', eventType: 'concert', venue: { name: 'Arena' } }).variant, 'music-architectural-light');
  assert.equal(resolveMusicVisual({ title: 'Artist live', eventType: 'concert', venue: { name: 'Small room' } }).variant, 'music-stage-haze');
});

test('sports textures prioritize leverage, rivalry, then night timing', () => {
  assert.equal(resolveSportsVisual({ sportsContext: { playoffLeverage: 'high', rivalryTier: 'high' }, startLocal: '2026-07-11T20:00:00' }).variant, 'sports-scoreboard-glow');
  assert.equal(resolveSportsVisual({ sportsContext: { playoffLeverage: 'low', rivalryTier: 'high' }, startLocal: '2026-07-11T20:00:00' }).variant, 'sports-field-lines');
  assert.equal(resolveSportsVisual({ sportsContext: { playoffLeverage: 'low', rivalryTier: 'low' }, startLocal: '2026-07-11T20:00:00' }).variant, 'sports-night-game');
  assert.equal(resolveSportsVisual({ sportsContext: { playoffLeverage: 'low', rivalryTier: 'low' }, startLocal: '2026-07-11T16:00:00' }).variant, 'sports-stadium-lights');
});

test('movie visuals allow only TMDB image hosts and otherwise fall back to projection texture', () => {
  const image = resolveMovieVisual({ title: 'A film', backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg' });
  assert.equal(image.kind, 'image');
  assert.equal(image.variant, 'movie-tmdb');
  assert.deepEqual(image.focalPoint, { x: 72, y: 50 });
  assert.equal(resolveMovieVisual({ title: 'A film', backdropUrl: 'https://example.com/backdrop.jpg' }).variant, 'movie-projection-light');
});

test('visual focal coordinates clamp invalid values to the display contract', () => {
  assert.deepEqual(normalizeFocalPoint({ x: -10, y: 125 }), { x: 0, y: 100 });
  assert.deepEqual(normalizeFocalPoint({ x: 'bad', y: null }), { x: 50, y: 50 });
});
