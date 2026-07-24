import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTasteProfile } from '../src/tasteProfile.js';

const FORBIDDEN_KEYS = [
  'playlistName', 'playlistId', 'playlists', 'sampleTracks', 'notes', 'evidence',
  'discoveryEvidence', 'topEvidence', 'shortTermRank', 'mediumTermRank', 'longTermRank',
  'weight', 'popularity', 'followers', 'spotifyArtistId', 'genres'
];

function snapshot() {
  return {
    generatedAt: '2026-07-12T00:00:00.000Z',
    playlistCount: 2,
    sourceArtistCount: 60,
    topArtistCount: 16,
    artistCount: 490,
    topTags: ['electronic', 'house', 'pop'],
    artists: [
      {
        spotifyArtistId: 'SECRET-ID', name: 'Prospa', seedStrength: 9, playlistDiversity: 2, trackCount: 19,
        genres: ['SECRET-GENRE'], sampleTracks: ['SECRET-TRACK'],
        evidence: [{ playlistId: 'SECRET-PL', playlistName: 'SECRET-PLAYLIST', weight: 4 }],
        topEvidence: { shortTermRank: 3, mediumTermRank: 1, longTermRank: 20 }
      },
      { name: 'Biscits', seedStrength: 8.4, playlistDiversity: 0, trackCount: 0, origin: 'similar', discoveryEvidence: [{ type: 'lastfm-similar', sourceArtist: 'Cloonee' }] },
      { name: 'Zed Artist', seedStrength: 8.4, playlistDiversity: 1, trackCount: 4 },
      { name: 'No Signal', seedStrength: 0, playlistDiversity: 0, trackCount: 0 }
    ]
  };
}

test('builds an allowlisted profile with relative signal and coarse evidence labels', () => {
  const profile = buildTasteProfile(snapshot(), {
    feedbackState: { outcomesByStatus: { 'attended-worth-it': 2, 'skipped-still-interested': 1 } }
  });
  assert.equal(profile.seedSummary.playlistCount, 2);
  assert.equal(profile.topArtists[0].name, 'Prospa');
  assert.equal(profile.topArtists[0].relativeSignal, 100);
  assert.equal(profile.topArtists[0].signalKind, 'direct');
  assert.deepEqual(profile.topArtists[0].evidenceLabels, ['Current top artist', 'Sustained favorite', 'Playlist anchor']);
  // Direct playlist contribution outranks bounded inferred discovery.
  assert.deepEqual(profile.topArtists.slice(1).map((artist) => artist.name), ['Zed Artist', 'Biscits']);
  assert.equal(profile.topArtists[1].relativeSignal, 93);
  assert.deepEqual(profile.topArtists[1].evidenceLabels, []);
  assert.deepEqual(profile.topArtists[2].evidenceLabels, ['Adjacent discovery']);
  assert.equal(profile.topArtists[2].signalKind, 'inferred');
  assert.deepEqual(profile.topTags, ['electronic', 'house', 'pop']);
  assert.equal(profile.expansionByOrigin.source, 3);
  assert.equal(profile.expansionByOrigin.similar, 1);
  assert.deepEqual(profile.feedback, {
    statusCounts: { 'attended-worth-it': 2, 'skipped-still-interested': 1 },
    attendedCount: 2
  });
});

test('does not retain expired Top Artists contribution after the snapshot ages', () => {
  const input = snapshot();
  input.artists = [{
    name: 'Windowed favorite', seedStrength: 0, playlistDiversity: 0, trackCount: 0,
    origin: 'top-items', topEvidence: { shortTermRank: 1 }
  }];
  input.topItems = { windows: { shortTerm: { status: 'cached', expiresAt: '2026-07-11T00:00:00.000Z' } } };
  const profile = buildTasteProfile(input, { now: new Date('2026-07-12T00:00:00.000Z') });
  assert.deepEqual(profile.topArtists, []);
});

test('never leaks private fields anywhere in the profile tree', () => {
  const profile = buildTasteProfile(snapshot(), { feedbackState: { outcomesByStatus: {} } });
  const seen = [];
  walk(profile, seen);
  for (const key of seen) assert.ok(!FORBIDDEN_KEYS.includes(key), `forbidden key exported: ${key}`);
  const serialized = JSON.stringify(profile);
  assert.doesNotMatch(serialized, /SECRET/);
});

test('missing snapshot or feedback state degrades to null pieces', () => {
  assert.equal(buildTasteProfile(null), null);
  assert.equal(buildTasteProfile({}), null);
  const profile = buildTasteProfile(snapshot());
  assert.equal(profile.feedback, null);
});

function walk(value, keys) {
  if (Array.isArray(value)) return value.forEach((item) => walk(item, keys));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    walk(child, keys);
  }
}
