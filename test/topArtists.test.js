import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTopArtistsWindowHealth, refreshTopArtists, TOP_ARTIST_WINDOWS } from '../src/topArtists.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'taste-top-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, cachePath: join(dir, 'top-artists.json') };
}

function page(...names) {
  return { items: names.map((name) => ({ id: `id-${name}`, name })) };
}

function failure(statusCode, message = 'Spotify API request failed') {
  return Object.assign(new Error(message), { statusCode });
}

test('three fresh windows are active, merged by artist id, and cached for seven days', async (t) => {
  const { cachePath } = workspace(t);
  const seen = [];
  const result = await refreshTopArtists({
    now: NOW,
    cachePath,
    fetchWindow: async (range, limit) => {
      seen.push([range, limit]);
      return { short_term: page('Alpha', 'Beta'), medium_term: page('Beta', 'Gamma'), long_term: page('Alpha') }[range];
    }
  });

  assert.deepEqual(seen, [['short_term', 50], ['medium_term', 50], ['long_term', 50]]);
  assert.equal(result.status, 'active');
  assert.deepEqual(Object.keys(result), ['status', 'generatedAt', 'windows', 'artists', 'warnings']);
  assert.equal(result.generatedAt, NOW.toISOString());
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.artists, [
    { artistId: 'id-Alpha', artistName: 'Alpha', shortTermRank: 1, mediumTermRank: null, longTermRank: 1 },
    { artistId: 'id-Beta', artistName: 'Beta', shortTermRank: 2, mediumTermRank: 1, longTermRank: null },
    { artistId: 'id-Gamma', artistName: 'Gamma', shortTermRank: null, mediumTermRank: 2, longTermRank: null }
  ]);
  assert.deepEqual(result.windows.shortTerm, {
    status: 'fresh',
    warning: null,
    fetchedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString()
  });
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.equal(cache.version, 1);
  assert.deepEqual(cache.windows.mediumTerm.items, [
    { artistId: 'id-Beta', artistName: 'Beta', rank: 1 },
    { artistId: 'id-Gamma', artistName: 'Gamma', rank: 2 }
  ]);
});

test('a failed window reuses a still-valid cached window and only fresh windows are replaced', async (t) => {
  const { cachePath } = workspace(t);
  await refreshTopArtists({ now: NOW, cachePath, fetchWindow: async () => page('Cached One') });

  const later = new Date(NOW.getTime() + 3 * DAY);
  const result = await refreshTopArtists({
    now: later,
    cachePath,
    fetchWindow: async (range) => {
      if (range === 'medium_term') throw failure(500, 'Spotify API request failed: /me/top/artists');
      return page('Fresh One');
    }
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.windows.mediumTerm.status, 'cached');
  assert.equal(result.windows.mediumTerm.fetchedAt, NOW.toISOString());
  assert.equal(result.windows.mediumTerm.expiresAt, new Date(NOW.getTime() + 7 * DAY).toISOString());
  assert.equal(result.windows.shortTerm.status, 'fresh');
  assert.equal(result.windows.shortTerm.fetchedAt, later.toISOString());
  assert.deepEqual(result.warnings, ['Spotify API request failed: /me/top/artists']);
  assert.deepEqual(result.artists.map((artist) => [artist.artistName, artist.shortTermRank, artist.mediumTermRank, artist.longTermRank]), [
    ['Cached One', null, 1, null],
    ['Fresh One', 1, null, 1]
  ]);
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.equal(cache.windows.mediumTerm.expiresAt, new Date(NOW.getTime() + 7 * DAY).toISOString(), 'reuse never extends the expiry');
});

test('an expired cached window contributes nothing', async (t) => {
  const { cachePath } = workspace(t);
  await refreshTopArtists({ now: NOW, cachePath, fetchWindow: async () => page('Old Favourite') });

  const later = new Date(NOW.getTime() + 7 * DAY);
  const result = await refreshTopArtists({
    now: later,
    cachePath,
    fetchWindow: async (range) => {
      if (range === 'long_term') throw failure(502, 'network');
      return page('Current');
    }
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.windows.longTerm, { status: 'unavailable', warning: 'network', fetchedAt: null, expiresAt: null });
  assert.deepEqual(result.artists.map((artist) => artist.artistName), ['Current']);
  assert.equal(result.artists[0].longTermRank, null);
});

test('when every window fails and nothing valid is cached the lane is unavailable and the stale cache is removed', async (t) => {
  const { cachePath } = workspace(t);
  await refreshTopArtists({ now: NOW, cachePath, fetchWindow: async () => page('Stale') });

  const result = await refreshTopArtists({
    now: new Date(NOW.getTime() + 8 * DAY),
    cachePath,
    fetchWindow: async () => { throw failure(500, 'down'); }
  });

  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.artists, []);
  assert.equal(existsSync(cachePath), false);
});

test('every failing window with a valid cache stays usable without rewriting freshness', async (t) => {
  const { cachePath } = workspace(t);
  await refreshTopArtists({ now: NOW, cachePath, fetchWindow: async () => page('Kept') });
  const result = await refreshTopArtists({
    now: new Date(NOW.getTime() + DAY),
    cachePath,
    fetchWindow: async () => { throw failure(503, 'busy'); }
  });

  assert.equal(result.status, 'partial');
  assert.ok(TOP_ARTIST_WINDOWS.every(({ key }) => result.windows[key].status === 'cached'));
  assert.deepEqual(result.artists.map((artist) => artist.artistName), ['Kept']);
});

for (const statusCode of [401, 403]) {
  test(`a ${statusCode} purges Spotify-derived data and reports the lane unavailable`, async (t) => {
    const { dir, cachePath } = workspace(t);
    await refreshTopArtists({ now: NOW, cachePath, fetchWindow: async () => page('Private') });
    for (const name of ['artists.json', 'expanded-artists.json', 'seatgeek-performers.json', 'artist-tags.json', 'framework-artists.json']) {
      writeFileSync(join(dir, name), '{}');
    }

    const result = await refreshTopArtists({
      now: new Date(NOW.getTime() + DAY),
      cachePath,
      fetchWindow: async (range) => {
        if (range === 'short_term') throw failure(statusCode, 'Spotify is not connected.');
        return page('Private');
      }
    });

    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.artists, []);
    assert.match(result.warnings[0], /npm run spotify:connect/);
    assert.ok(TOP_ARTIST_WINDOWS.every(({ key }) => result.windows[key].status === 'unavailable'));
    assert.deepEqual(Object.keys(result.windows.shortTerm), ['status', 'warning', 'fetchedAt', 'expiresAt']);
    for (const name of ['top-artists.json', 'artists.json', 'expanded-artists.json', 'seatgeek-performers.json', 'artist-tags.json']) {
      assert.equal(existsSync(join(dir, name)), false, `${name} should be purged`);
    }
    assert.equal(existsSync(join(dir, 'framework-artists.json')), true, 'non-Spotify data is left alone');
  });
}

test('window health exposes freshness only', async (t) => {
  const { cachePath } = workspace(t);
  assert.deepEqual(readTopArtistsWindowHealth({ cachePath, now: NOW }).shortTerm, { status: 'unavailable', fetchedAt: null, expiresAt: null });

  await refreshTopArtists({ now: NOW, cachePath, fetchWindow: async () => page('Someone') });
  const valid = readTopArtistsWindowHealth({ cachePath, now: new Date(NOW.getTime() + DAY) });
  assert.deepEqual(valid.longTerm, { status: 'cached', fetchedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString() });
  assert.ok(!JSON.stringify(valid).includes('Someone'));

  const expired = readTopArtistsWindowHealth({ cachePath, now: new Date(NOW.getTime() + 7 * DAY) });
  assert.equal(expired.longTerm.status, 'expired');
});
