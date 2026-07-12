import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpotifySeedConfig } from '../src/config.js';

test('normalizes Spotify seed playlists', () => {
  const config = normalizeSpotifySeedConfig({
    playlistSyncBaseUrl: 'http://127.0.0.1:4317/',
    playlists: [{ id: 'one', name: 'One', weight: 2 }]
  });

  assert.equal(config.playlistSyncBaseUrl, 'http://127.0.0.1:4317');
  assert.equal(config.maxTracksPerPlaylist, 500);
  assert.deepEqual(config.playlists[0], { id: 'one', name: 'One', enabled: true, weight: 2 });
});

test('requires an enabled playlist', () => {
  assert.throws(
    () => normalizeSpotifySeedConfig({ playlists: [{ id: 'one', enabled: false }] }),
    /At least one Spotify seed playlist must be enabled/
  );
});

test('rejects duplicate playlist IDs', () => {
  assert.throws(
    () => normalizeSpotifySeedConfig({ playlists: [{ id: 'one' }, { id: 'one' }] }),
    /playlist IDs must be unique/
  );
});
