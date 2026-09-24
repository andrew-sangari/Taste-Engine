import assert from 'node:assert/strict';
import test from 'node:test';
import { ageRestrictionFromText, buildEventEvidence, serializeEventEvidenceForModel } from '../src/eventEvidence.js';
import { buildSemanticEventInsight } from '../src/nightlife/cardInsight.js';
import { enrichSemanticEventCards } from '../src/nightlife/cardEnrichment.js';
import { createDecisionInferenceProvider } from '../src/nightlife/inference.js';
import { evaluateInsightCases } from '../src/nightlife/insightEvaluation.js';
import { assessPersonalRelevance, preferenceSignalsFor } from '../src/nightlife/personalRelevance.js';
import { toDisplayEvent } from '../src/projection.js';
import { normalizeTicketmasterEvent } from '../src/ticketmaster.js';
import { buildInsightCases } from './fixtures/nightlife/insight-cases.js';

test('every targeted insight case meets its gold labels with no grounding violation', () => {
  const report = evaluateInsightCases(buildInsightCases());
  const failing = report.cases.filter((item) => !item.pass)
    .map((item) => `${item.id}: ${[...item.goldFailures, ...item.violations.map((violation) => `${violation.kind} — ${violation.text}`)].join('; ')}`);
  assert.deepEqual(failing, []);
  assert.equal(report.metrics.violations, 0);
  // Model-derived and personal value are counted apart from source extraction.
  assert.ok(report.metrics.cardsWithModelDerivedClaim >= 2);
  assert.ok(report.metrics.cardsWithPersonalClaim >= 3);
  assert.ok(report.metrics.claims.documented > report.metrics.claims.modelDerived);
});

test('a title-only age restriction is never read as an unrestricted event', () => {
  const [josh] = buildInsightCases().filter((item) => item.id === 'title-age-restriction-without-policy-field');
  const insight = buildSemanticEventInsight(josh.candidate, null);
  const text = JSON.stringify(insight);
  assert.doesNotMatch(text, /no additional entry restriction/i);
  assert.doesNotMatch(text, /all ages/i);
  // The 21+ lives only in SeatGeek's title, which is not event evidence, so it
  // must not become a model-eligible age fact either.
  const model = serializeEventEvidenceForModel(buildEventEvidence(josh.candidate));
  assert.equal(model.publishedFacts.agePolicy, undefined);
});

test('a permitted title that states an age limit becomes provenance-marked age evidence', () => {
  const event = normalizeTicketmasterEvent({
    id: 'tm-21', name: 'Warehouse Night (21+)', url: 'https://www.ticketmaster.com/event/tm-21',
    dates: { start: { localDate: '2026-10-03', localTime: '22:00:00' } },
    _embedded: { venues: [{ name: 'Room', city: { name: 'Los Angeles' } }] }
  }, new Date('2026-09-20T00:00:00Z'));
  const evidence = buildEventEvidence(event);
  assert.equal(evidence.permittedFacts.agePolicy.value, '21+');
  assert.equal(evidence.permittedFacts.agePolicy.derivedFrom, 'title');
  assert.ok(!evidence.withheldOrMissing.includes('agePolicy'));
  // The displayed title already says 21+, so the card does not repeat it.
  assert.doesNotMatch(JSON.stringify(buildSemanticEventInsight(event)), /21\+/);
});

test('age markers are recognized narrowly', () => {
  assert.equal(ageRestrictionFromText('Josh Baker (21+)'), '21+');
  assert.equal(ageRestrictionFromText('Night Market 18 & Over'), '18+');
  assert.equal(ageRestrictionFromText('All-Ages Matinee'), 'All ages');
  assert.equal(ageRestrictionFromText('Blink-182'), null);
  assert.equal(ageRestrictionFromText('Room 218+'), null);
  assert.equal(ageRestrictionFromText('Josh Baker'), null);
});

test('an adjacent discovery path is never treated as a personal preference', () => {
  const candidate = { matchedArtists: [{ name: 'Neighbour', origin: 'similar' }, { name: 'Roster', origin: 'promoter' }, { name: 'Tagged', origin: 'tag' }] };
  assert.deepEqual(preferenceSignalsFor(candidate).directArtists, []);
  const facts = { classification: { value: ['Music', 'Festival'], provider: 'ticketmaster', sourceUrl: 'https://www.ticketmaster.com/e/1' } };
  assert.deepEqual(assessPersonalRelevance({ candidate, facts }), []);
});

test('preference signals change the card but never the model request or the event-level cache', async () => {
  const [base] = buildInsightCases().filter((item) => item.id === 'familiar-artist-unfamiliar-format');
  const states = [];
  const adapter = {
    name: 'fixture',
    model: 'jev-fixture',
    configured: true,
    describe: () => ({ provider: 'fixture', model: 'jev-fixture', route: 'fixture', configured: true }),
    async evaluate({ state, questions }) {
      states.push(JSON.stringify(state));
      const answers = {};
      for (const [id, question] of Object.entries(questions)) {
        const choice = id === 'event_experience' ? 'dance_floor' : Object.keys(question.criteria).at(-1);
        answers[id] = { type: 'choice', choice, probabilities: { [choice]: 0.8 }, confidence: 0.8 };
      }
      return { answers, usage: { inputTokens: 100 }, latencyMs: 5, model: 'jev-fixture' };
    }
  };
  const provider = createDecisionInferenceProvider({ provider: 'custom', adapter });
  const withTaste = await enrichSemanticEventCards([base.candidate], { provider, preferences: { topTags: ['electronic'] } });
  const withoutTaste = await enrichSemanticEventCards([{ ...base.candidate, matchedArtists: [] }], { provider, preferences: { topTags: [] } });

  assert.equal(states.length, 1, 'the second profile reuses the event-level characterization');
  assert.doesNotMatch(states[0], /Sidepiece"?\s*,\s*"origin|matchedArtists|electronic"\]|topTags|similar|promoter|preference/);
  assert.equal(withTaste.telemetry.callsAttempted, 1);
  assert.equal(withoutTaste.telemetry.cacheHits, 1);
  const personal = withTaste.byId.get(String(base.candidate.id)).whyItMayFit;
  assert.equal(personal.basis, 'calculated-match');
  assert.equal(personal.eventBasis, 'model-characterization');
  assert.equal(personal.status, 'inferred');
  assert.equal(withoutTaste.byId.get(String(base.candidate.id)).whyItMayFit, undefined);
  assert.equal(withTaste.contributions.cardsWithPersonalClaim, 1);
  assert.equal(withTaste.contributions.cardsWithModelDerivedClaim, 1);
  assert.equal(base.candidate.ranking.utility, 50, 'enrichment never touches the canonical score');
});

test('the published row carries the insight and none of the private evidence', () => {
  const [item] = buildInsightCases().filter((entry) => entry.id === 'conflicting-start-times');
  const row = toDisplayEvent({ ...item.candidate, semanticInsight: buildSemanticEventInsight(item.candidate) });
  for (const field of ['eventEvidence', 'nightlifeEvidence', 'semanticAssessment', 'sourceOccurrences']) {
    assert.equal(row[field], undefined, `${field} must stay out of the published projection`);
  }
  assert.ok(row.semanticInsight.claimOrder.length > 0);
  assert.doesNotMatch(JSON.stringify(row), /permission|modelInput|probabilit/);
});

test('every eligible candidate is assessed, and only the spend ceiling can leave any out', async () => {
  const { semanticSourceHealth } = await import('../src/nightlife/cardEnrichment.js');
  const events = Array.from({ length: 30 }, (_, index) => ({
    ...normalizeTicketmasterEvent({
      id: `tm-${index}`, name: `Night ${index}`, url: `https://www.ticketmaster.com/event/tm-${index}`,
      dates: { start: { localDate: '2026-10-03', localTime: '20:00:00' } },
      classifications: [{ segment: { name: 'Music' }, genre: { name: 'Dance/Electronic' } }],
      _embedded: { venues: [{ name: `Room ${index}`, city: { name: 'Los Angeles' } }], attractions: [{ name: `Act ${index}` }] }
    }, new Date('2026-09-20T00:00:00Z')),
    ranking: { utility: index }
  }));
  const adapter = {
    name: 'fixture', model: 'jev-fixture', configured: true,
    describe: () => ({ provider: 'fixture', model: 'jev-fixture', route: 'fixture', configured: true }),
    async evaluate({ questions }) {
      const answers = {};
      for (const [id, question] of Object.entries(questions)) {
        const choice = Object.keys(question.criteria).at(-1);
        answers[id] = { type: 'choice', choice, probabilities: { [choice]: 0.8 }, confidence: 0.8 };
      }
      return { answers, usage: { inputTokens: 100 }, latencyMs: 1, model: 'jev-fixture' };
    }
  };

  const all = await enrichSemanticEventCards(events, { provider: createDecisionInferenceProvider({ provider: 'custom', adapter }) });
  assert.equal(all.assessedCandidateCount, 30, 'no 24-candidate shortlist');
  assert.equal(all.eligibleBeyondBudget, 0);
  assert.equal(semanticSourceHealth(all).status, 'active');

  const capped = await enrichSemanticEventCards(events, { provider: createDecisionInferenceProvider({ provider: 'custom', adapter, maxCandidates: 5 }) });
  assert.equal(capped.assessedCandidateCount, 5);
  assert.equal(capped.eligibleBeyondBudget, 25);
  assert.equal(semanticSourceHealth(capped).details.eligibleBeyondBudget, 25);
});
