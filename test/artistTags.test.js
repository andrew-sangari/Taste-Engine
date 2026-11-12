import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artistTagKey, MUSICBRAINZ_USER_AGENT, resolveArtistTags } from '../src/artistTags.js';
import { readTagCache, writeTagCache } from '../src/artistTagsCache.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const singleMatch = JSON.parse(readFileSync(new URL('./fixtures/artistTags/musicbrainz-single-match.json', import.meta.url), 'utf8'));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function recorder(handler) {
  const events = [];
  return {
    events,
    requests: () => events.filter((event) => event.type === 'fetch'),
    sleeps: () => events.filter((event) => event.type === 'sleep'),
    fetchImpl: async (url, init) => {
      events.push({ type: 'fetch', url: new URL(String(url)), init });
      return handler(new URL(String(url)), init);
    },
    sleep: async (ms) => { events.push({ type: 'sleep', ms }); }
  };
}

function mbArtist(name, { score = 100, tags = [], aliases } = {}) {
  return { id: `id-${name}-${score}`, score, name, 'sort-name': name, ...(aliases ? { aliases } : {}), ...(tags.length ? { tags } : {}) };
}

test('the module is pure: no node: imports and no file access', () => {
  const source = readFileSync(new URL('../src/artistTags.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]node:/);
  assert.doesNotMatch(source, /\brequire\(|process\.env|readFile|writeFile/);
});

test('MusicBrainz fallback sends the keyless query and identifies itself without personal details', async () => {
  const net = recorder(() => json(singleMatch));
  const result = await resolveArtistTags(['Daft Punk'], { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });

  assert.equal(result.provider, 'musicbrainz');
  assert.equal(result.lookups, 1);
  assert.deepEqual(result.warnings, []);
  const [request] = net.requests();
  assert.equal(`${request.url.origin}${request.url.pathname}`, 'https://musicbrainz.org/ws/2/artist/');
  assert.equal(request.url.searchParams.get('query'), 'artist:"Daft Punk"');
  assert.equal(request.url.searchParams.get('fmt'), 'json');
  assert.equal(request.url.searchParams.get('limit'), '3');
  assert.equal(request.init.headers['user-agent'], 'TasteEngine/0.1 (private personal event importer)');
  assert.equal(MUSICBRAINZ_USER_AGENT, 'TasteEngine/0.1 (private personal event importer)');
  assert.ok(request.init.signal instanceof AbortSignal);
});

test('MusicBrainz tags are taken from the single confident match, sorted by count', async () => {
  const net = recorder(() => json(singleMatch));
  const result = await resolveArtistTags(['Daft Punk'], { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });

  assert.deepEqual(result.tags.get('daft punk'), ['electronic', 'house', 'french', 'dance', 'electro', 'vocoder', 'pop', 'synthpop']);
  assert.deepEqual(result.cache['daft punk'], {
    tags: ['electronic', 'house', 'french', 'dance', 'electro', 'vocoder', 'pop', 'synthpop'],
    provider: 'musicbrainz',
    fetchedAt: NOW.toISOString()
  });
});

test('MusicBrainz match rules: alias accepted, ambiguity, low score and name mismatch rejected', async () => {
  const responses = {
    'artist:"The Alias"': { artists: [mbArtist('Canonical Name', { aliases: [{ name: 'the alias' }], tags: [{ count: 2, name: 'Techno' }] })] },
    'artist:"Twins"': { artists: [mbArtist('Twins', { tags: [{ count: 5, name: 'pop' }] }), mbArtist('Twins', { score: 96, tags: [{ count: 5, name: 'metal' }] })] },
    'artist:"Shared"': { artists: [mbArtist('Shared', { tags: [{ count: 5, name: 'grunge' }] }), mbArtist('Shared', { score: 75, tags: [{ count: 5, name: 'psych' }] })] },
    'artist:"Faint"': { artists: [mbArtist('Faint', { score: 94, tags: [{ count: 5, name: 'rock' }] })] },
    'artist:"Other"': { artists: [mbArtist('Other People', { tags: [{ count: 5, name: 'jazz' }] })] },
    'artist:"Untagged"': { artists: [mbArtist('Untagged')] }
  };
  const net = recorder((url) => json({ created: 'x', count: 1, offset: 0, ...responses[url.searchParams.get('query')] }));
  const result = await resolveArtistTags(['The Alias', 'Twins', 'Shared', 'Faint', 'Other', 'Untagged'], { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });

  assert.deepEqual(result.tags.get('the alias'), ['techno']);
  assert.deepEqual(result.tags.get('twins'), [], 'two confident same-name artists are ambiguous');
  assert.deepEqual(result.tags.get('shared'), ['grunge'], 'a same-name artist below the score floor does not make it ambiguous');
  assert.deepEqual(result.tags.get('faint'), []);
  assert.deepEqual(result.tags.get('other'), []);
  assert.deepEqual(result.tags.get('untagged'), []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.lookups, 6);
});

test('MusicBrainz lookups are sequential and at least 1100 ms apart', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const net = recorder(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return json({ artists: [] });
  });
  await resolveArtistTags(['One', 'Two', 'Three'], { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });

  assert.equal(maxInFlight, 1);
  assert.deepEqual(net.events.map((event) => event.type), ['sleep', 'fetch', 'sleep', 'fetch', 'sleep', 'fetch']);
  assert.ok(net.sleeps().every((event) => event.ms >= 1100));
});

test('special characters in a name are escaped inside the quoted query', async () => {
  const net = recorder(() => json({ artists: [] }));
  await resolveArtistTags(['A "B" \\ C'], { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });
  assert.equal(net.requests()[0].url.searchParams.get('query'), 'artist:"A \\"B\\" \\\\ C"');
});

test('a cached entry within the TTL costs no lookup, including a cached empty result', async () => {
  const net = recorder(() => { throw new Error('no request expected'); });
  const cache = {
    'daft punk': { tags: ['house'], provider: 'lastfm', fetchedAt: '2026-10-01T00:00:00.000Z' },
    nobody: { tags: [], provider: 'musicbrainz', fetchedAt: '2026-11-01T00:00:00.000Z' }
  };
  const result = await resolveArtistTags(['Daft Punk', 'DAFT PUNK', 'Nobody'], { cache, now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });

  assert.equal(result.lookups, 0);
  assert.equal(net.events.length, 0);
  assert.deepEqual(result.tags.get('daft punk'), ['house']);
  assert.deepEqual(result.tags.get('nobody'), []);
  assert.deepEqual(result.cache, cache);
  assert.notEqual(result.cache, cache, 'the input cache object is not mutated or returned');
});

test('an entry older than the TTL is looked up again', async () => {
  const net = recorder(() => json({ artists: [mbArtist('Old One', { tags: [{ count: 1, name: 'new tag' }] })] }));
  const cache = { 'old one': { tags: ['old tag'], provider: 'musicbrainz', fetchedAt: '2026-09-01T00:00:00.000Z' } };
  const result = await resolveArtistTags(['Old One'], { cache, now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep, ttlDays: 60 });

  assert.equal(result.lookups, 1);
  assert.deepEqual(result.tags.get('old one'), ['new tag']);
  assert.equal(result.cache['old one'].fetchedAt, NOW.toISOString());
  assert.deepEqual(cache['old one'].tags, ['old tag']);
});

test('a failing artist records a warning, is not cached, and does not stop the others', async () => {
  const net = recorder((url) => {
    const query = url.searchParams.get('query');
    if (query.includes('Broken')) return json({ error: 'Internal failure' }, 500);
    if (query.includes('Timeout')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    return json({ artists: [mbArtist('Fine', { tags: [{ count: 1, name: 'ok' }] })] });
  });
  const result = await resolveArtistTags(['Broken', 'Timeout', 'Fine'], { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });

  assert.deepEqual(result.tags.get('fine'), ['ok']);
  assert.equal(result.tags.has('broken'), false);
  assert.equal(result.cache.broken, undefined);
  assert.equal(result.cache.timeout, undefined);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /No MusicBrainz tags for Broken: Internal failure/);
  assert.match(result.warnings[1], /No MusicBrainz tags for Timeout/);
  assert.equal(result.lookups, 3);
});

test('a busy MusicBrainz response (503) is retried once after another full interval', async () => {
  let calls = 0;
  const net = recorder(() => {
    calls += 1;
    return calls === 1
      ? json({ error: 'The MusicBrainz web server is currently busy. Please try again later.' }, 503)
      : json({ artists: [mbArtist('Busy', { tags: [{ count: 1, name: 'ok' }] })] });
  });
  const result = await resolveArtistTags(['Busy'], { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });

  assert.deepEqual(net.events.map((event) => event.type), ['sleep', 'fetch', 'sleep', 'fetch']);
  assert.deepEqual(result.tags.get('busy'), ['ok']);
  assert.equal(result.lookups, 1);
  assert.deepEqual(result.warnings, []);
});

test('the lookup budget defers the remainder and falls back to stale tags', async () => {
  const net = recorder(() => json({ artists: [] }));
  const cache = { third: { tags: ['stale'], provider: 'musicbrainz', fetchedAt: '2026-01-01T00:00:00.000Z' } };
  const result = await resolveArtistTags(['First', 'Second', 'Third'], { cache, now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep, maxLookups: 1 });

  assert.equal(result.lookups, 1);
  assert.equal(net.requests().length, 1);
  assert.equal(result.tags.has('second'), false);
  assert.deepEqual(result.tags.get('third'), ['stale']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /2 artist\(s\) were not looked up this run/);
});

test('lookups stop after five consecutive failures instead of timing out on every artist', async () => {
  const net = recorder(() => json({ error: 'down' }, 500));
  const names = Array.from({ length: 9 }, (_, index) => `Artist ${index + 1}`);
  const result = await resolveArtistTags(names, { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });

  assert.equal(result.lookups, 5);
  assert.equal(net.requests().length, 5);
  assert.equal(result.warnings.length, 6);
  assert.match(result.warnings.at(-1), /stopped after 5 consecutive failures; 4 artist\(s\) left unresolved/);
});

test('with a Last.fm key it uses artist.gettoptags, lower-cased and capped at twenty', async () => {
  const net = recorder((url) => {
    assert.equal(`${url.origin}${url.pathname}`, 'https://ws.audioscrobbler.com/2.0/');
    const artist = url.searchParams.get('artist');
    if (artist === 'Many Tags') {
      return json({ toptags: { tag: Array.from({ length: 30 }, (_, index) => ({ name: ` Tag ${index + 1} `, count: 100 - index })) } });
    }
    if (artist === 'One Tag') return json({ toptags: { tag: { name: 'K-Pop', count: 100 } } });
    if (artist === 'Missing') return json({ error: 6, message: 'The artist you supplied could not be found' });
    return json({ error: 29, message: 'Rate limit exceeded' });
  });
  const result = await resolveArtistTags(['Many Tags', 'One Tag', 'Missing', 'Limited'], {
    lastFmApiKey: 'test-key', now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep
  });

  assert.equal(result.provider, 'lastfm');
  const first = net.requests()[0].url;
  assert.equal(first.searchParams.get('method'), 'artist.gettoptags');
  assert.equal(first.searchParams.get('api_key'), 'test-key');
  assert.equal(first.searchParams.get('format'), 'json');
  assert.equal(result.tags.get('many tags').length, 20);
  assert.equal(result.tags.get('many tags')[0], 'tag 1');
  assert.deepEqual(result.tags.get('one tag'), ['k-pop']);
  assert.deepEqual(result.cache.missing, { tags: [], provider: 'lastfm', fetchedAt: NOW.toISOString() });
  assert.equal(result.cache.limited, undefined);
  assert.deepEqual(result.warnings, ['No Last.fm tags for Limited: Rate limit exceeded']);
  assert.equal(net.sleeps().length, 0, 'the one-per-second limit applies to MusicBrainz only');
  assert.ok(!result.warnings.join(' ').includes('test-key'));
});

test('names that normalize to nothing keep a literal key instead of colliding', async () => {
  assert.equal(artistTagKey('  Daft Punk (Live) '), 'daft punk');
  assert.equal(artistTagKey('아이유'), '아이유');
  assert.equal(artistTagKey(''), '');
  const net = recorder((url) => json({ artists: [mbArtist(url.searchParams.get('query') === 'artist:"아이유"' ? '아이유' : '新しい学校', { tags: [{ count: 1, name: 'k-pop' }] })] }));
  const result = await resolveArtistTags(['아이유', '', null], { now: NOW, fetchImpl: net.fetchImpl, sleep: net.sleep });
  assert.equal(result.lookups, 1);
  assert.deepEqual(result.tags.get('아이유'), ['k-pop']);
});

test('the tag cache file round-trips and tolerates a missing or malformed file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-tags-'));
  try {
    const path = join(dir, 'nested', 'artist-tags.json');
    assert.deepEqual(readTagCache(path), {});
    const cache = { 'daft punk': { tags: ['house'], provider: 'musicbrainz', fetchedAt: NOW.toISOString() } };
    assert.equal(writeTagCache(path, cache), path);
    assert.deepEqual(readTagCache(path), cache);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    writeTagCache(path, null);
    assert.deepEqual(readTagCache(path), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
