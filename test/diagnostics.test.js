import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCandidateTrace,
  createBuildReport,
  finalizeBuildReport,
  normalizeProjectionForComparison,
  promptFieldManifest,
  sanitizeDiagnosticValue,
  sanitizePromptContext
} from '../src/diagnostics.js';

test('recursively redacts secrets, raw payloads, private notes, and authenticated URL query material', () => {
  const value = sanitizeDiagnosticValue({
    error: 'Request failed at https://provider.example/event?access_token=secret&x=1',
    nested: { authorization: 'Bearer very-secret', rawPayload: { private: 'do not copy' }, privateNote: 'personal detail', private: 'private detail' },
    sourceUrl: 'https://provider.example/event?client_id=secret',
    safe: { count: 2 }
  });
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /very-secret|access_token=secret|client_id=secret|personal detail|do not copy/);
  assert.match(text, /provider\.example\/event/);
  assert.equal(value.nested.authorization, '[REDACTED]');
  assert.equal(value.nested.rawPayload, '[OMITTED BY DIAGNOSTICS POLICY]');
  assert.equal(value.nested.private, '[OMITTED BY DIAGNOSTICS POLICY]');
});

test('prompt context is an explicit string-only allowlist and manifests fields without values', () => {
  const context = sanitizePromptContext({
    background: ['safe context', { spotify: { artists: ['restricted'] } }],
    decisionPreferences: ['be selective'],
    nested: { seatgeek: { payload: 'restricted' } }
  });
  assert.deepEqual(context, { background: ['safe context'], decisionPreferences: ['be selective'] });
  const manifest = promptFieldManifest({ personalContext: context, candidates: [{ ref: 'candidate-1', deterministicHassle: 2 }] });
  assert.deepEqual(manifest, ['candidates', 'candidates.[].deterministicHassle', 'candidates.[].ref', 'personalContext', 'personalContext.background', 'personalContext.decisionPreferences']);
  assert.doesNotMatch(JSON.stringify(manifest), /spotify|seatgeek|payload/);
});

test('comparison normalization replaces generated timestamps, sorts unordered arrays, and preserves ranked order', () => {
  const normalized = normalizeProjectionForComparison({
    generatedAt: '2026-07-12T01:00:00Z',
    sourceHealth: [{ source: 'b' }, { source: 'a' }],
    events: [{ id: 'rank-1' }, { id: 'rank-2' }]
  });
  assert.equal(normalized.generatedAt, '[TIMESTAMP]');
  assert.deepEqual(normalized.sourceHealth.map((item) => item.source), ['a', 'b']);
  assert.deepEqual(normalized.events.map((item) => item.id), ['rank-1', 'rank-2']);
});

test('candidate traces and build reports contain summarized deterministic evidence only', () => {
  const trace = buildCandidateTrace({
    id: 'fixture:1',
    sourceOccurrences: [{ source: 'seatgeek', sourceEventId: 'private-id', sourceUrl: 'https://seatgeek.example/event?token=secret', startLocal: '2026-07-12T20:00:00', venue: { name: 'Venue' } }],
    performers: [{ name: 'Fixture Artist' }],
    matchedArtists: [{ name: 'Fixture Artist', origin: 'source', matchMethod: 'exact-name', primary: true }],
    ranking: { playlistAffinity: 40, topItemsAffinity: 30, corroborationBonus: 3, directAffinity: 43, artistFit: 43, hassleScore: 4, hassleReasons: ['unknown coordinates'], urgency: 'watch', utility: 35, confidence: 'high', excluded: false, whyYou: 'Fixture evidence.' }
  }, { currentOverviewIds: ['fixture:1'] });
  const report = finalizeBuildReport(createBuildReport({ now: '2026-07-12T12:00:00-07:00', timezone: 'America/Los_Angeles' }));
  const text = JSON.stringify(trace);
  assert.doesNotMatch(text, /private-id|token=secret/);
  assert.equal(trace.eligibility.currentOverview, true);
  assert.equal(report.redaction.applied, true);
  assert.equal(report.timezone, 'America/Los_Angeles');
});
