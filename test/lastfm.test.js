import test from 'node:test';
import assert from 'node:assert/strict';
import { getSimilarArtists, getTopArtistsForTag } from '../src/lastfm.js';
import { buildExpandedArtistSnapshot, topRecurringTags } from '../src/tasteExpansion.js';

test('parses Last.fm similar and tag artist responses', async () => {
  const fetchImpl = async (url) => {
    const method = url.searchParams.get('method');
    if (method === 'artist.getsimilar') {
      return new Response(JSON.stringify({ similarartists: { artist: [{ name: 'Neighbor', match: '0.9' }] } }));
    }
    return new Response(JSON.stringify({ topartists: { artist: [{ name: 'Tag Star', '@attr': { rank: '2' } }] } }));
  };
  assert.deepEqual(await getSimilarArtists('Seed', { apiKey: 'key', fetchImpl }), [
    { name: 'Neighbor', mbid: null, url: null, match: 0.9 }
  ]);
  assert.equal((await getTopArtistsForTag('house', { apiKey: 'key', fetchImpl }))[0].rank, 2);
});

test('selects recurring usable tags and preserves discovery tiers', async () => {
  const snapshot = {
    generatedAt: '2026-07-10T00:00:00.000Z',
    playlistCount: 1,
    artists: [
      { spotifyArtistId: 'one', name: 'Seed One', seedStrength: 10, genres: ['house', 'seen live'], evidence: [{}] },
      { spotifyArtistId: 'two', name: 'Seed Two', seedStrength: 5, genres: ['house', 'techno'], evidence: [{}] }
    ]
  };
  assert.equal(topRecurringTags(snapshot, 1)[0].name, 'house');
  const fetchImpl = async (url) => {
    if (url.searchParams.get('method') === 'artist.getsimilar') {
      return new Response(JSON.stringify({ similarartists: { artist: [{ name: 'Neighbor', match: '0.8' }] } }));
    }
    return new Response(JSON.stringify({ topartists: { artist: [{ name: 'Tag Star', '@attr': { rank: '1' } }] } }));
  };
  const expanded = await buildExpandedArtistSnapshot(snapshot, {
    lastFmSeedArtistLimit: 2,
    lastFmSimilarPerArtist: 2,
    lastFmTopTagCount: 1,
    lastFmArtistsPerTag: 2
  }, { apiKey: 'key', fetchImpl, generatedAt: '2026-07-10T00:00:00.000Z' });
  assert.equal(expanded.artists.find((artist) => artist.name === 'Seed One').origin, 'source');
  assert.equal(expanded.artists.find((artist) => artist.name === 'Neighbor').origin, 'similar');
  assert.equal(expanded.artists.find((artist) => artist.name === 'Tag Star').origin, 'tag');
});
