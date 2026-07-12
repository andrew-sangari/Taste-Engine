import { readFile } from 'node:fs/promises';

export async function loadSpotifySeedConfig(path) {
  let input;
  try {
    input = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Spotify seed config not found at ${path}. Copy config/spotify-playlists.example.json to config/spotify-playlists.json first.`);
    }
    throw new Error(`Could not read Spotify seed config at ${path}: ${error.message}`);
  }

  return normalizeSpotifySeedConfig(input);
}

export function normalizeSpotifySeedConfig(input = {}) {
  const baseUrl = String(input.playlistSyncBaseUrl ?? 'http://127.0.0.1:4317').replace(/\/$/, '');
  const maxTracksPerPlaylist = positiveInteger(input.maxTracksPerPlaylist ?? 500, 'maxTracksPerPlaylist');
  const playlists = Array.isArray(input.playlists) ? input.playlists : [];

  const normalized = playlists.map((playlist, index) => {
    const id = String(playlist?.id ?? '').trim();
    if (!id) throw new Error(`playlists[${index}].id is required`);
    const weight = Number(playlist.weight ?? 1);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`playlists[${index}].weight must be greater than zero`);
    }
    return {
      id,
      name: String(playlist.name ?? id).trim() || id,
      enabled: playlist.enabled !== false,
      weight
    };
  });

  if (normalized.filter((playlist) => playlist.enabled).length === 0) {
    throw new Error('At least one Spotify seed playlist must be enabled');
  }

  const ids = normalized.map((playlist) => playlist.id);
  if (new Set(ids).size !== ids.length) throw new Error('Spotify seed playlist IDs must be unique');

  return { playlistSyncBaseUrl: baseUrl, maxTracksPerPlaylist, playlists: normalized };
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}
