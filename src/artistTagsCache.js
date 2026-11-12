// File persistence for the artist tag cache used by artistTags.js.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveSpotifyStateDir } from './spotifyClient.js';

export function defaultTagCachePath() {
  return join(resolveSpotifyStateDir(), 'artist-tags.json');
}

export function readTagCache(path = defaultTagCachePath()) {
  try {
    const value = JSON.parse(readFileSync(path ?? defaultTagCachePath(), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function writeTagCache(path, cache) {
  const target = path ?? defaultTagCachePath();
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(cache ?? {}, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  return target;
}
