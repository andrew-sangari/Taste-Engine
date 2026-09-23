import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateCandidates } from '../src/candidates.js';
import {
  buildEventEvidence,
  serializeEventEvidenceForDisplay,
  serializeEventEvidenceForModel
} from '../src/eventEvidence.js';
import { normalizeFrameworkEvent } from '../src/framework.js';
import { normalizeInsomniacEvent } from '../src/insomniac.js';
import { buildSemanticEventInsight } from '../src/nightlife/cardInsight.js';
import { normalizeSeatGeekEvent } from '../src/seatgeek.js';
import { normalizeTicketmasterEvent } from '../src/ticketmaster.js';
import { meaningfulClassifications } from '../src/eventEvidence.js';

const RETRIEVED = '2026-09-19T12:00:00Z';

test('Ticketmaster normalizes field-level evidence without making descriptive copy model input', () => {
  const event = normalizeTicketmasterEvent({
    id: 'tm-evidence',
    name: 'Evidence Night',
    url: 'https://ticketmaster.example/evidence',
    info: '<p>A source description that stays outside model input.</p>',
    dates: {
      start: { localDate: '2026-10-02', localTime: '21:00:00' },
      end: { localDate: '2026-10-03', localTime: '01:00:00' }
    },
    classifications: [{ segment: { name: 'Music' }, genre: { name: 'Dance/Electronic' }, subGenre: { name: 'House' } }],
    _embedded: {
      attractions: [{ id: 'artist-1', name: 'Example Artist' }],
      venues: [{ id: 'venue-1', name: 'Example Hall', city: { name: 'Los Angeles' }, state: { stateCode: 'CA' } }]
    }
  }, RETRIEVED);
  const evidence = buildEventEvidence(event);
  const model = serializeEventEvidenceForModel(evidence);
  const display = serializeEventEvidenceForDisplay(evidence);

  assert.deepEqual(model.publishedFacts.classification, ['Music', 'Dance/Electronic', 'House']);
  assert.equal(model.publishedFacts.endTime, '2026-10-03T01:00:00');
  assert.equal(model.publishedFacts.description, undefined);
  assert.ok(model.knownUnknowns.includes('description'));
  assert.match(display.facts.description.value, /source description/i);
});

test('Framework title parsing does not masquerade as an explicit model-eligible lineup', () => {
  const event = normalizeFrameworkEvent({
    id: 'fw-thin',
    title: 'Framework presents Parsed Artist',
    url: 'https://framework.example/thin',
    start_date: '2026-10-02 21:00:00',
    venue: { venue: 'Example Room', city: 'Los Angeles', stateprovince: 'CA' }
  }, RETRIEVED);
  const model = serializeEventEvidenceForModel(buildEventEvidence(event));
  assert.equal(model.publishedFacts.namedLineup, undefined);
  assert.ok(model.knownUnknowns.includes('namedLineup'));
});

test('a merged SeatGeek occurrence cannot contaminate independently permitted event facts', () => {
  const seatGeek = normalizeSeatGeekEvent({
    id: 'sg-merge', title: 'Evidence Night', url: 'https://seatgeek.example/evidence', type: 'concert',
    datetime_local: '2026-10-02T21:00:00',
    performers: [{ name: 'Example Artist' }],
    venue: { name: 'Example Hall', city: 'Los Angeles', state: 'CA', location: { lat: 34.05, lon: -118.25 } },
    stats: { lowest_price: 40 }
  }, RETRIEVED);
  const ticketmaster = normalizeTicketmasterEvent({
    id: 'tm-merge', name: 'Evidence Night', url: 'https://ticketmaster.example/evidence',
    dates: { start: { localDate: '2026-10-02', localTime: '21:00:00' } },
    classifications: [{ genre: { name: 'Dance/Electronic' } }],
    _embedded: { attractions: [{ name: 'Example Artist' }], venues: [{ name: 'Example Hall', city: { name: 'Los Angeles' }, state: { stateCode: 'CA' }, location: { latitude: 34.05, longitude: -118.25 } }] }
  }, RETRIEVED);
  const [merged] = deduplicateCandidates([seatGeek, ticketmaster]);
  const model = serializeEventEvidenceForModel(buildEventEvidence(merged));
  assert.deepEqual(model.publishedFacts.classification, ['Dance/Electronic']);
  assert.doesNotMatch(JSON.stringify(model), /seatgeek/i);
});

test('unverified Insomniac facts remain outside model input', () => {
  const event = normalizeInsomniacEvent({
    id: 'ins-test', name: 'Fixture Event', startDate: '2026-10-02T22:00:00',
    url: 'https://insomniac.example/fixture', genre: 'House', venue: { name: 'Fixture Venue' }
  }, RETRIEVED);
  const model = serializeEventEvidenceForModel(buildEventEvidence(event));
  assert.deepEqual(model.publishedFacts, {});
});

test('card insight is a useful, source-linked no-op-safe projection that cannot change rank', () => {
  const thin = { id: 'thin', sourceOccurrences: [], ranking: { utility: 88 } };
  assert.equal(buildSemanticEventInsight(thin), null);

  const event = normalizeTicketmasterEvent({
    id: 'tm-card', name: 'Card Event', url: 'https://ticketmaster.example/card',
    dates: { start: { localDate: '2026-10-02', localTime: '21:00:00' } },
    classifications: [{ genre: { name: 'Dance/Electronic' } }],
    _embedded: { attractions: [{ name: 'Example Artist' }], venues: [{ name: 'Example Hall', city: { name: 'Los Angeles' } }] }
  }, RETRIEVED);
  event.ranking = { utility: 88 };
  const insight = buildSemanticEventInsight(event);
  assert.match(insight.summary, /Published classification/);
  assert.equal(insight.whatToExpect.status, 'verified');
  assert.equal(insight.whatToExpect.evidence[0].source, 'Ticketmaster');
  assert.equal(insight.worthChecking.status, 'not known');
  assert.equal(event.ranking.utility, 88);
});

test('an all-day listing publishes no clock time and no end time', () => {
  // The Events Calendar fills a listing with no published time with a
  // 00:00:00-23:59:59 span. Treating that as a schedule would assert a start
  // and an end the promoter never published.
  const allDay = normalizeFrameworkEvent({
    id: 10,
    title: 'All day listing',
    url: 'https://thisisframework.com/event/all-day/',
    all_day: true,
    start_date: '2026-10-14 00:00:00',
    end_date: '2026-10-14 23:59:59',
    venue: {}
  }, new Date('2026-09-20T00:00:00Z'));

  assert.equal(allDay.timeTbd, true);
  assert.ok(!allDay.eventEvidence.permittedFacts.startTime, 'no published start time');
  assert.ok(!allDay.eventEvidence.permittedFacts.endTime, 'no published end time');
});

test('an end-of-day span is rejected even when the feed omits the all-day flag', () => {
  const sentinel = normalizeFrameworkEvent({
    id: 11,
    title: 'Sentinel span',
    url: 'https://thisisframework.com/event/sentinel/',
    start_date: '2026-10-14 00:00:00',
    end_date: '2026-10-14 23:59:59',
    venue: {}
  }, new Date('2026-09-20T00:00:00Z'));
  assert.ok(!sentinel.eventEvidence.permittedFacts.endTime, 'end-of-day span is not a published end');

  // A midnight end on the start's own calendar day is the feed's default, not
  // a published finish.
  const midnight = normalizeFrameworkEvent({
    id: 12,
    title: 'Midnight default',
    url: 'https://thisisframework.com/event/midnight/',
    start_date: '2026-10-14 18:00:00',
    end_date: '2026-10-14 00:00:00',
    venue: {}
  }, new Date('2026-09-20T00:00:00Z'));
  assert.ok(!midnight.eventEvidence.permittedFacts.endTime, 'same-day midnight is not a published end');
  assert.equal(midnight.eventEvidence.permittedFacts.startTime.value, '2026-10-14T18:00:00');

  // A genuinely published late finish survives.
  const real = normalizeFrameworkEvent({
    id: 13,
    title: 'Real late finish',
    url: 'https://thisisframework.com/event/late/',
    start_date: '2026-10-14 21:00:00',
    end_date: '2026-10-15 02:00:00',
    venue: {}
  }, new Date('2026-09-20T00:00:00Z'));
  assert.equal(real.eventEvidence.permittedFacts.endTime.value, '2026-10-15T02:00:00');
});

test('placeholder and promoter-name classifications are not published as facts', () => {
  // A promoter tagging its own calendar with its own name says who published
  // the event, not what the event is.
  assert.deepEqual(meaningfulClassifications(['Framework'], { provider: 'framework' }), []);
  assert.deepEqual(meaningfulClassifications(['Framework', 'House'], { provider: 'framework' }), ['House']);
  // Ticketmaster writes "Undefined" for an unset subgenre.
  assert.deepEqual(meaningfulClassifications(['Music', 'Undefined'], { provider: 'ticketmaster' }), ['Music']);
  assert.deepEqual(meaningfulClassifications(['Music', 'Dance/Electronic'], { provider: 'ticketmaster' }), ['Music', 'Dance/Electronic']);
  assert.deepEqual(meaningfulClassifications(['Other', 'Uncategorized', 'n/a', '']), []);
});

test('a card claims a published end time only when one was actually published', () => {
  const allDay = normalizeFrameworkEvent({
    id: 14,
    title: 'All day listing',
    url: 'https://thisisframework.com/event/all-day-2/',
    all_day: true,
    start_date: '2026-10-14 00:00:00',
    end_date: '2026-10-14 23:59:59',
    venue: { venue: 'A Room', city: 'Los Angeles' }
  }, new Date('2026-09-20T00:00:00Z'));
  const insight = buildSemanticEventInsight({ ...allDay, eventEvidence: allDay.eventEvidence }, null);
  const planning = insight?.worthPlanning?.text ?? '';
  assert.ok(!/published end time/i.test(planning), `must not claim an end time: ${planning}`);
});

test('a classification that only restates the vertical is not rendered as insight', () => {
  // "Music" on a music card, or a taxonomy label naming the taxonomy, is
  // filler. A truthful no-op reads better than repetitive noise.
  const generic = buildSemanticEventInsight({
    eventEvidence: {
      eventRef: 'ticketmaster:1',
      permittedFacts: {
        classification: {
          value: ['Music', 'Event Style'],
          field: 'classification',
          provider: 'ticketmaster',
          sourceUrl: 'https://ticketmaster.com/e/1',
          retrievedAt: '2026-09-20T00:00:00.000Z',
          assertionKind: 'published-fact',
          confidence: 'verified',
          permission: { internalUse: true, display: true, modelInput: true, persist: true }
        }
      },
      withheldOrMissing: []
    }
  }, null);
  assert.equal(generic, null);

  const informative = buildSemanticEventInsight({
    eventEvidence: {
      eventRef: 'ticketmaster:2',
      permittedFacts: {
        classification: {
          value: ['Music', 'Dance/Electronic'],
          field: 'classification',
          provider: 'ticketmaster',
          sourceUrl: 'https://ticketmaster.com/e/2',
          retrievedAt: '2026-09-20T00:00:00.000Z',
          assertionKind: 'published-fact',
          confidence: 'verified',
          permission: { internalUse: true, display: true, modelInput: true, persist: true }
        }
      },
      withheldOrMissing: []
    }
  }, null);
  assert.match(informative.whatToExpect.text, /Dance\/Electronic/);
  assert.ok(!/Music · Event Style/.test(informative.whatToExpect.text));
});

test('a representative permitted event composes at least one question end to end', async () => {
  // The serializer and the question composer are separate modules. If they
  // drift, every request goes out with an empty question set and the route
  // answers 422. This walks the exact production path from a normalized
  // Ticketmaster event to the composed question set.
  const { normalizeTicketmasterEvent } = await import('../src/ticketmaster.js');
  const { buildSemanticRequest } = await import('../src/nightlife/semanticInput.js');
  const { buildQuestionSet } = await import('../src/nightlife/questions.js');
  const event = normalizeTicketmasterEvent({
    id: 'drift-guard',
    name: 'Drift Guard Night',
    url: 'https://www.ticketmaster.com/event/drift-guard',
    dates: { start: { localDate: '2026-10-03', localTime: '22:00:00' }, status: { code: 'onsale' } },
    classifications: [{ segment: { name: 'Music' }, genre: { name: 'Dance/Electronic' }, subGenre: { name: 'House' } }],
    _embedded: {
      venues: [{ id: 'v', name: 'Hall', city: { name: 'Los Angeles' }, state: { stateCode: 'CA' } }],
      attractions: [{ id: 'a', name: 'Artist' }]
    }
  }, new Date('2026-09-23T00:00:00Z'));
  event.ranking = { utility: 60 };
  const { inputs } = buildSemanticRequest([event], {}, { now: new Date('2026-09-23T00:00:00Z') });
  const questions = buildQuestionSet({ input: inputs[0] });
  assert.ok(Object.keys(inputs[0].fields.publishedFacts ?? {}).length > 0, 'serializer must emit model-transmittable facts');
  assert.ok(Object.keys(questions).length > 0, 'composer must ask at least one question of them');
});
