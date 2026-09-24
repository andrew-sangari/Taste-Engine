import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_PROVENANCE,
  SourcePolicyError,
  assertFieldProvenance,
  assertNoRestrictedEvidence,
  buildSemanticCandidateInput,
  buildSemanticRequest,
  coarseArea,
  serializeContext
} from '../src/nightlife/semanticInput.js';
import { normalizeNightlifeContext } from '../src/nightlife/context.js';

function candidate(overrides = {}) {
  return {
    id: 'ticketmaster:abc',
    title: 'Permitted Title',
    startLocal: '2026-09-26T22:30:00',
    timeTbd: false,
    venue: { name: 'The Venue', city: 'Los Angeles', lat: 34.0983, lon: -118.3267 },
    performers: [{ name: 'Someone' }],
    matchedArtists: [
      { origin: 'similar', name: 'SPOTIFY DERIVED NAME', seedStrength: 0.9, spotifyArtistId: '4abc' },
      { origin: 'tag', name: 'ANOTHER SPOTIFY NAME' }
    ],
    ticketObservation: { lowestPriceUsd: 35 },
    lineupDisplay: { displayTitle: 'EDMTRAIN LINEUP', sourceUrl: 'https://edmtrain.com/x' },
    sourceOccurrences: [{
      source: 'ticketmaster',
      sourceEventId: 'tm-1',
      sourceUrl: 'https://ticketmaster.com/e/1',
      title: 'Permitted Title',
      startLocal: '2026-09-26T22:30:00',
      venue: { name: 'The Venue', city: 'Los Angeles', lat: 34.0983, lon: -118.3267 },
      performerNames: ['Permitted Artist']
    }],
    ranking: { utility: 70 },
    ...overrides
  };
}

function seatgeekOnly() {
  return candidate({
    id: 'seatgeek:9',
    title: 'DO NOT SEND THIS TITLE',
    sourceOccurrences: [{
      source: 'seatgeek',
      sourceEventId: 'sg-9',
      sourceUrl: 'https://seatgeek.com/e/9',
      title: 'DO NOT SEND THIS TITLE',
      venue: { name: 'DO NOT SEND VENUE', city: 'Los Angeles', lat: 34.05, lon: -118.24 },
      performerNames: ['DO NOT SEND ARTIST']
    }]
  });
}

const context = normalizeNightlifeContext({
  goal: 'Late electronic night, start on the Westside',
  date: '2026-09-26',
  earliestStart: '21:00',
  latestReturn: '03:00',
  startArea: 'Westside',
  transport: 'drive',
  preferredMusic: ['house', 'techno'],
  lateNightIntent: 'out late'
});

test('a SeatGeek-only candidate contributes only coarse derived timing', () => {
  const input = buildSemanticCandidateInput(seatgeekOnly(), { ref: 'cand-1', now: new Date('2026-09-20T00:00:00') });
  assert.equal(input.restricted, true);
  const serialized = JSON.stringify(input.fields);
  assert.ok(!serialized.includes('DO NOT SEND'), 'no restricted payload field may be serialized');
  assert.equal(input.fields.eventTitle, undefined);
  assert.equal(input.fields.venueName, undefined);
  assert.equal(input.fields.startClock, undefined);
  assert.equal(input.fields.advertisedPriceUsd, undefined);
  // Coarse timing is derived, not quoted, and matches the existing advisory line.
  assert.equal(input.fields.dayOfWeek, 'Saturday');
  assert.equal(input.fields.startPeriod, 'late');
});

test('withheld evidence becomes a declared unknown, never a negative value', () => {
  const input = buildSemanticCandidateInput(seatgeekOnly(), { ref: 'cand-1' });
  assert.ok(input.fields.knownUnknowns.includes('lineup'));
  assert.ok(input.fields.knownUnknowns.includes('genre'));
  assert.ok(input.fields.knownUnknowns.includes('neighborhood'));
  for (const value of Object.values(input.fields)) {
    assert.notEqual(value, false, 'absence must not be encoded as a false/negative signal');
  }
});

test('Spotify-derived and EDMTrain evidence never reaches the payload', () => {
  const { payload } = buildSemanticRequest([candidate()], context, { now: new Date('2026-09-20T00:00:00') });
  const serialized = JSON.stringify(payload);
  assert.ok(!/SPOTIFY DERIVED NAME|ANOTHER SPOTIFY NAME/.test(serialized));
  assert.ok(!/EDMTRAIN LINEUP|edmtrain/i.test(serialized));
  assert.ok(!/seedStrength|spotifyArtistId/.test(serialized));
  // Not even the discovery tier crosses the boundary: the characterization
  // must not vary with who the event is for.
  assert.equal(payload.candidates[0].adjacentEvidence, undefined);
  assert.ok(!/\b(?:similar|promoter)\b/.test(JSON.stringify(payload.candidates[0])));
});

test('permitted provider fields are quoted, including an independently sourced price', () => {
  const input = buildSemanticCandidateInput(candidate(), { ref: 'cand-1', startArea: context.startArea, transport: 'drive' });
  assert.equal(input.restricted, false);
  assert.equal(input.fields.eventTitle, 'Permitted Title');
  assert.equal(input.fields.providerContext, 'ticketmaster');
  assert.equal(input.fields.advertisedPriceUsd, 35);
  assert.equal(input.fields.startClock, '22:30');
  assert.equal(input.fields.neighborhood, 'Hollywood');
  assert.ok(Number.isInteger(input.fields.travelMinutesEstimate));
});

test('a price contaminated by a SeatGeek occurrence is withheld', () => {
  const merged = candidate({
    sourceOccurrences: [
      ...candidate().sourceOccurrences,
      { source: 'seatgeek', sourceEventId: 'sg-1', sourceUrl: 'https://seatgeek.com/e/1' }
    ]
  });
  const input = buildSemanticCandidateInput(merged, { ref: 'cand-1' });
  assert.equal(input.restricted, false, 'a merged occurrence may still use Ticketmaster context');
  assert.equal(input.fields.advertisedPriceUsd, undefined);
  assert.ok(input.fields.knownUnknowns.includes('cover-price'));
});

test('the transmission guard rejects a restricted key or value', () => {
  assert.throws(() => assertNoRestrictedEvidence({ candidate: { spotifyArtistId: '4abc' } }), SourcePolicyError);
  assert.throws(() => assertNoRestrictedEvidence({ candidate: { url: 'https://seatgeek.com/e/1' } }), SourcePolicyError);
  assert.throws(() => assertNoRestrictedEvidence({ nested: [{ personalContext: 'note' }] }), SourcePolicyError);
  assert.doesNotThrow(() => assertNoRestrictedEvidence({ candidate: { venueName: 'The Venue' } }));
});

test('a field without declared provenance cannot be serialized', () => {
  // A field added to the serializer without a provenance entry must fail loudly
  // rather than quietly shipping whatever it holds.
  assert.throws(() => assertFieldProvenance({ ref: 'cand-1', spotifyRank: 3 }), SourcePolicyError);
  assert.doesNotThrow(() => assertFieldProvenance({ ref: 'cand-1', venueName: 'The Venue' }));
});

test('every field the serializer emits has declared provenance', () => {
  const permitted = buildSemanticCandidateInput(candidate(), { ref: 'cand-1', startArea: context.startArea });
  const restricted = buildSemanticCandidateInput(seatgeekOnly(), { ref: 'cand-2' });
  for (const fields of [permitted.fields, restricted.fields]) {
    for (const key of Object.keys(fields)) {
      assert.ok(FIELD_PROVENANCE[key], `${key} must declare provenance`);
    }
  }
});

test('an unnamed candidate ref is rejected', () => {
  assert.throws(() => buildSemanticCandidateInput(candidate(), { ref: '' }), SourcePolicyError);
});

test('context serialization carries only the declared decision dimensions', () => {
  const serialized = serializeContext({
    ...context,
    personalNotes: 'private',
    feedbackHistory: [{ id: 'x' }]
  });
  assert.deepEqual(Object.keys(serialized).sort(), [
    'date', 'earliestStart', 'goal', 'latestReturn', 'lateNightIntent',
    'preferredMusic', 'startArea', 'transport'
  ].sort());
  assert.equal(serialized.startArea, 'Westside');
});

test('coarse areas replace coordinates', () => {
  assert.equal(coarseArea({ city: 'Los Angeles', lat: 34.0430, lon: -118.2400 }), 'Downtown / Arts District');
  assert.equal(coarseArea({ city: 'Pomona', lat: 34.06, lon: -117.75 }), 'Pomona');
  assert.equal(coarseArea(null), null);
});

test('a published row that lists SeatGeek at all is treated as restricted', () => {
  // The published projection picks canonical fields by source priority, which
  // puts SeatGeek first, so provenance cannot be recovered from the row.
  const merged = buildSemanticCandidateInput({
    id: 'x',
    title: 'MIGHT BE A SEATGEEK TITLE',
    startLocal: '2026-09-26T22:00:00',
    sources: ['seatgeek', 'ticketmaster'],
    venue: { name: 'MIGHT BE A SEATGEEK VENUE', city: 'Los Angeles' },
    ticketObservation: { lowestPriceUsd: 40 },
    matchedArtists: [{ origin: 'similar' }]
  }, { ref: 'cand-1' });
  assert.equal(merged.restricted, true);
  assert.ok(!JSON.stringify(merged.fields).includes('MIGHT BE'));

  const clean = buildSemanticCandidateInput({
    id: 'y',
    title: 'Framework Night',
    startLocal: '2026-09-26T22:00:00',
    sources: ['framework'],
    venue: { name: 'The Venue', city: 'Los Angeles', lat: 34.043, lon: -118.24 },
    performers: [{ name: 'Artist' }],
    ticketObservation: { lowestPriceUsd: 40 },
    matchedArtists: []
  }, { ref: 'cand-2' });
  assert.equal(clean.restricted, false);
  assert.equal(clean.fields.eventTitle, 'Framework Night');
  assert.equal(clean.fields.advertisedPriceUsd, 40);
});
