import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateCandidates } from '../src/candidates.js';
import { normalizeSeatGeekEvent } from '../src/seatgeek.js';
import { normalizeTicketmasterEvent } from '../src/ticketmaster.js';
import {
  FIELD_PROVENANCE,
  SourcePolicyError,
  assertFieldProvenance,
  assertNoRestrictedEvidence,
  buildSemanticCandidateInput,
  buildSemanticRequest
} from '../src/nightlife/semanticInput.js';

const RETRIEVED = new Date('2026-09-20T00:00:00Z');

function ticketmaster(overrides = {}) {
  return normalizeTicketmasterEvent({
    id: 'tm-1',
    name: 'Permitted Title',
    url: 'https://www.ticketmaster.com/event/tm-1',
    dates: { start: { localDate: '2026-09-26', localTime: '22:30:00' } },
    classifications: [{ segment: { name: 'Music' }, genre: { name: 'Dance/Electronic' } }],
    priceRanges: [{ min: 35 }],
    _embedded: {
      venues: [{ name: 'The Venue', city: { name: 'Los Angeles' }, state: { stateCode: 'CA' }, location: { latitude: '34.0983', longitude: '-118.3267' } }],
      attractions: [{ id: 'a1', name: 'Permitted Artist' }]
    },
    ...overrides
  }, RETRIEVED);
}

function seatgeek(title = 'DO NOT SEND THIS TITLE') {
  return normalizeSeatGeekEvent({
    id: 'sg-9',
    title,
    url: 'https://seatgeek.com/e/9',
    type: 'concert',
    datetime_local: '2026-09-26T22:30:00',
    performers: [{ name: 'Permitted Artist' }],
    venue: { name: 'The Venue', city: 'Los Angeles', state: 'CA', location: { lat: 34.0983, lon: -118.3267 } },
    stats: { lowest_price: 40 }
  }, RETRIEVED);
}

// Everything a ranked candidate carries that must never reach the model:
// Spotify-derived matches, EDMTrain lineup provenance, and ranking.
function withPrivateContext(candidate) {
  return {
    ...candidate,
    matchedArtists: [
      { origin: 'similar', name: 'SPOTIFY DERIVED NAME', seedStrength: 0.9, spotifyArtistId: '4abc' },
      { origin: 'tag', name: 'ANOTHER SPOTIFY NAME' }
    ],
    lineupDisplay: { displayTitle: 'EDMTRAIN LINEUP', sourceUrl: 'https://edmtrain.com/x' },
    ranking: { utility: 70, whyYou: 'SPOTIFY DERIVED NAME runs through 3 of your selected playlists.' }
  };
}

test('a SeatGeek-only candidate contributes nothing at all', () => {
  const input = buildSemanticCandidateInput(withPrivateContext(seatgeek()), { ref: 'cand-1' });
  assert.equal(input.restricted, true);
  assert.equal(input.fields.publishedFacts, undefined);
  assert.ok(!JSON.stringify(input).includes('DO NOT SEND'));
  const { payload } = buildSemanticRequest([withPrivateContext(seatgeek())]);
  assert.deepEqual(payload.candidates, [], 'a candidate with nothing permitted is never sent');
});

test('withheld evidence becomes a declared unknown, never a negative value', () => {
  const input = buildSemanticCandidateInput(seatgeek(), { ref: 'cand-1' });
  for (const unknown of ['lineup', 'genre', 'end-time', 'age-policy']) {
    assert.ok(input.fields.knownUnknowns.includes(unknown), unknown);
  }
  for (const value of Object.values(input.fields)) {
    assert.notEqual(value, false, 'absence must not be encoded as a false/negative signal');
  }
});

test('the payload holds only permitted event facts: no Spotify, EDMTrain, ranking or discovery tier', () => {
  const { payload } = buildSemanticRequest([withPrivateContext(ticketmaster())]);
  const serialized = JSON.stringify(payload);
  assert.equal(payload.candidates.length, 1);
  assert.deepEqual(Object.keys(payload.candidates[0]), ['event']);
  assert.deepEqual(Object.keys(payload.candidates[0].event).sort(), ['missing', 'published', 'ref']);
  assert.ok(!/SPOTIFY DERIVED NAME|ANOTHER SPOTIFY NAME|playlists/.test(serialized));
  assert.ok(!/EDMTRAIN LINEUP|edmtrain/i.test(serialized));
  assert.ok(!/seedStrength|spotifyArtistId|utility|whyYou/.test(serialized));
  assert.ok(!/\b(?:similar|promoter)\b/.test(serialized));
  // Price is ticket-observation data, not event evidence.
  assert.ok(!/35/.test(JSON.stringify(payload.candidates[0].event.published)));
  assert.equal(payload.candidates[0].event.published.title, 'Permitted Title');
});

test('a merged SeatGeek occurrence cannot put its title or venue into model input', () => {
  const [merged] = deduplicateCandidates([seatgeek('Permitted Title (SEATGEEK ONLY)'), ticketmaster()]);
  const input = buildSemanticCandidateInput(merged, { ref: 'cand-1' });
  assert.equal(input.restricted, false);
  assert.equal(input.fields.publishedFacts.title, 'Permitted Title');
  assert.doesNotMatch(JSON.stringify(input), /SEATGEEK ONLY|seatgeek/i);
});

test('a canonical title that did not come from a permitted fact is never sent', () => {
  // The published row picks its title by source priority, which can be
  // SeatGeek's. The model input reads evidence facts only, never that field.
  const input = buildSemanticCandidateInput({ ...ticketmaster(), title: 'CANONICAL FROM ELSEWHERE' }, { ref: 'cand-1' });
  assert.doesNotMatch(JSON.stringify(input), /CANONICAL FROM ELSEWHERE/);
});

test('the transmission guard rejects a restricted key or value', () => {
  assert.throws(() => assertNoRestrictedEvidence({ candidate: { spotifyArtistId: '4abc' } }), SourcePolicyError);
  assert.throws(() => assertNoRestrictedEvidence({ candidate: { url: 'https://seatgeek.com/e/1' } }), SourcePolicyError);
  assert.throws(() => assertNoRestrictedEvidence({ nested: [{ personalContext: 'note' }] }), SourcePolicyError);
  assert.throws(() => assertNoRestrictedEvidence({ event: { matchedArtists: [] } }), SourcePolicyError);
  assert.throws(() => assertNoRestrictedEvidence({ event: { topTags: ['house'] } }), SourcePolicyError);
  assert.doesNotThrow(() => assertNoRestrictedEvidence({ event: { published: { title: 'The Show' } } }));
});

test('a field without declared provenance cannot be serialized', () => {
  // A field added to the serializer without a provenance entry must fail loudly
  // rather than quietly shipping whatever it holds.
  assert.throws(() => assertFieldProvenance({ ref: 'cand-1', spotifyRank: 3 }), SourcePolicyError);
  assert.throws(() => assertFieldProvenance({ ref: 'cand-1', venueName: 'The Venue' }), SourcePolicyError);
  assert.doesNotThrow(() => assertFieldProvenance({ ref: 'cand-1', publishedFacts: {}, knownUnknowns: [] }));
});

test('every field the serializer emits has declared provenance', () => {
  for (const candidate of [ticketmaster(), seatgeek()]) {
    const { fields } = buildSemanticCandidateInput(withPrivateContext(candidate), { ref: 'cand-1' });
    for (const key of Object.keys(fields)) assert.ok(FIELD_PROVENANCE[key], `${key} must declare provenance`);
  }
});

test('an unnamed candidate ref is rejected', () => {
  assert.throws(() => buildSemanticCandidateInput(ticketmaster(), { ref: '' }), SourcePolicyError);
});
