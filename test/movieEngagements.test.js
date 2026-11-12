import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_ENGAGEMENT_EXPIRY_DAYS,
  ENGAGEMENT_FORMATS,
  applyEngagements,
  engagementSourceHealth,
  normalizeEngagements
} from '../src/movieEngagements.js';
import { normalizeTmdbMovie } from '../src/tmdb.js';

// 2026-11-11 10:00 in Los Angeles.
const NOW = new Date('2026-11-11T18:00:00Z');
const PRIORITY_THEATERS = [
  { name: 'Grand Fictional IMAX', formats: ['IMAX', 'IMAX 70mm'] },
  { name: 'Lumière Palace Cinema', formats: ['Dolby Cinema'] }
];
const OPTIONS = { now: NOW, priorityTheaters: PRIORITY_THEATERS };

function entry(overrides = {}) {
  return {
    tmdbId: 101,
    title: 'Orbital Dawn',
    theater: 'Grand Fictional IMAX',
    format: 'IMAX',
    startDate: '2026-11-20',
    endDate: '2026-11-26',
    sourceUrl: 'https://example.com/showtimes/orbital-dawn',
    confirmedAt: '2026-11-10',
    ...overrides
  };
}

function film(id, title, releaseDate = '2026-11-20') {
  return normalizeTmdbMovie({ id, title, release_date: releaseDate }, NOW);
}

test('accepts a complete reviewed confirmation and canonicalizes it', () => {
  const result = normalizeEngagements([entry({
    tmdbId: 'tmdb:101',
    theater: '  grand   fictional imax ',
    format: 'imax 70mm',
    showtimes: ['2026-11-21T19:00:00', '2026-11-20T19:00', '2026-11-20T19:00'],
    note: '  One-week   run. '
  })], OPTIONS);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.expired, []);
  assert.equal(result.configured, true);
  assert.deepEqual(result.engagements, [{
    index: 0,
    tmdbId: '101',
    title: 'Orbital Dawn',
    year: null,
    theater: 'Grand Fictional IMAX',
    format: 'IMAX 70mm',
    premium: true,
    priorityTheater: true,
    startDate: '2026-11-20',
    endDate: '2026-11-26',
    showtimes: ['2026-11-20T19:00', '2026-11-21T19:00'],
    sourceUrl: 'https://example.com/showtimes/orbital-dawn',
    confirmedAt: '2026-11-10',
    expiresAt: '2026-11-26',
    note: 'One-week run.'
  }]);
});

test('rejects entries without a usable https source URL', () => {
  const result = normalizeEngagements([
    entry({ sourceUrl: undefined }),
    entry({ sourceUrl: '' }),
    entry({ sourceUrl: 'http://example.com/showtimes' }),
    entry({ sourceUrl: 'not a url' }),
    entry({ sourceUrl: 'https://user:secret@example.com/showtimes' })
  ], OPTIONS);
  assert.equal(result.engagements.length, 0);
  assert.deepEqual(result.rejected.map((item) => item.index), [0, 1, 2, 3, 4]);
  assert.ok(result.rejected.every((item) => /sourceUrl/.test(item.reason)));
});

test('rejects malformed entries with a reason instead of throwing', () => {
  const cases = [
    ['not an object', /must be an object/],
    [entry({ title: '  ' }), /title is required/],
    [entry({ format: 'ScreenX' }), /format must be one of/],
    [entry({ theater: '' }), /theater is required/],
    [entry({ startDate: '2026-02-30' }), /startDate/],
    [entry({ startDate: '11/20/2026' }), /startDate/],
    [entry({ endDate: '2026-11-19' }), /endDate is before startDate/],
    [entry({ showtimes: '2026-11-20T19:00' }), /showtimes must be an array/],
    [entry({ showtimes: ['2026-11-20T19:00Z'] }), /local ISO/],
    [entry({ showtimes: ['2026-11-20 7pm'] }), /local ISO/],
    [entry({ showtimes: ['2026-11-27T19:00'] }), /outside startDate\/endDate/],
    [entry({ confirmedAt: undefined }), /confirmedAt is required/],
    [entry({ confirmedAt: '2026-11-10T09:00:00' }), /confirmedAt is required/],
    [entry({ confirmedAt: '2026-11-12' }), /in the future/],
    [entry({ expiresAt: 'next week' }), /expiresAt/],
    [entry({ tmdbId: 'abc' }), /tmdbId/],
    [entry({ year: 26 }), /year/],
    [entry({ note: 42 }), /note must be text/],
    [entry({ allowOtherTheater: 'yes' }), /allowOtherTheater/],
    [entry({ enddate: '2026-11-26' }), /unknown field "enddate"/]
  ];
  const result = normalizeEngagements(cases.map(([value]) => value), OPTIONS);
  assert.equal(result.engagements.length, 0);
  assert.equal(result.rejected.length, cases.length);
  cases.forEach(([, pattern], index) => {
    assert.equal(result.rejected[index].index, index);
    assert.match(result.rejected[index].reason, pattern);
  });
});

test('every documented format is accepted and only Standard is non-premium', () => {
  const result = normalizeEngagements(ENGAGEMENT_FORMATS.map((format, index) => entry({ format, startDate: `2026-11-2${index}` })), {
    now: NOW,
    priorityTheaters: ['Grand Fictional IMAX']
  });
  assert.deepEqual(result.engagements.map((item) => item.format), ['IMAX', 'IMAX 70mm', '70mm', '35mm', 'Dolby Cinema', 'Standard']);
  assert.deepEqual(result.engagements.filter((item) => !item.premium).map((item) => item.format), ['Standard']);
});

test('a missing file is no confirmations, and a malformed file is an explicit error', () => {
  for (const missing of [undefined, null]) {
    const result = normalizeEngagements(missing, OPTIONS);
    assert.deepEqual(result, { configured: false, engagements: [], rejected: [], expired: [], warnings: [], error: null });
  }
  assert.equal(normalizeEngagements({ engagements: [entry()] }, OPTIONS).engagements.length, 1);
  const malformed = normalizeEngagements({ confirmations: [] }, OPTIONS);
  assert.equal(malformed.configured, true);
  assert.match(malformed.error, /"engagements" array/);
  assert.throws(() => normalizeEngagements([], { now: 'not a date' }), /valid date/);
});

test('rejects exact duplicates of an earlier entry', () => {
  const result = normalizeEngagements([entry(), entry({ note: 'same run again' }), entry({ format: 'IMAX 70mm' })], OPTIONS);
  assert.deepEqual(result.engagements.map((item) => item.index), [0, 2]);
  assert.deepEqual(result.rejected, [{ index: 1, title: 'Orbital Dawn', reason: 'duplicate of entry 0' }]);
});

test('expiry defaults to endDate, else confirmedAt plus 21 days', () => {
  assert.equal(DEFAULT_ENGAGEMENT_EXPIRY_DAYS, 21);
  const result = normalizeEngagements([
    entry({ startDate: '2026-11-01', endDate: '2026-11-11' }),
    entry({ startDate: '2026-11-01', endDate: '2026-11-10' }),
    entry({ startDate: '2026-10-25', endDate: undefined, confirmedAt: '2026-10-21' }),
    entry({ startDate: '2026-10-24', endDate: undefined, confirmedAt: '2026-10-20' })
  ], OPTIONS);
  // Entry 0 ends today and is still live; entry 2 expires today (Oct 21 + 21 days).
  assert.deepEqual(result.engagements.map((item) => [item.index, item.expiresAt]), [[0, '2026-11-11'], [2, '2026-11-11']]);
  assert.deepEqual(result.expired, [
    { index: 1, title: 'Orbital Dawn', theater: 'Grand Fictional IMAX', format: 'IMAX', expiresAt: '2026-11-10', reason: 'confirmation expired' },
    { index: 3, title: 'Orbital Dawn', theater: 'Grand Fictional IMAX', format: 'IMAX', expiresAt: '2026-11-10', reason: 'confirmation expired' }
  ]);
  assert.deepEqual(result.rejected, []);
});

test('explicit expiresAt, a finished run, and passed showtimes all expire', () => {
  const result = normalizeEngagements([
    // Explicit expiry earlier than the run end: the confirmation needs re-review.
    entry({ startDate: '2026-11-01', endDate: '2026-11-30', expiresAt: '2026-11-09' }),
    // Explicit expiry later than the run end cannot keep a finished run alive.
    entry({ startDate: '2026-11-02', endDate: '2026-11-08', expiresAt: '2026-12-31' }),
    // Timestamp expiry one hour ago, and one hour ahead.
    entry({ startDate: '2026-11-03', expiresAt: '2026-11-11T17:00:00Z' }),
    entry({ startDate: '2026-11-04', expiresAt: '2026-11-11T11:00:00-08:00' }),
    // One-night screening with no end date: over once its showtime has passed.
    entry({ startDate: '2026-11-10', endDate: undefined, showtimes: ['2026-11-10T19:00'] }),
    // Same day, later tonight: still live.
    entry({ startDate: '2026-11-11', endDate: undefined, showtimes: ['2026-11-11T19:00'] })
  ], OPTIONS);
  assert.deepEqual(result.expired.map((item) => [item.index, item.reason]), [
    [0, 'confirmation expired'],
    [1, 'run ended'],
    [2, 'confirmation expired'],
    [4, 'published showtimes have passed']
  ]);
  assert.deepEqual(result.engagements.map((item) => item.index), [3, 5]);
  assert.equal(result.engagements[0].expiresAt, '2026-11-11T19:00:00.000Z');
});

test('theater must be a configured priority theater unless explicitly allowed', () => {
  const result = normalizeEngagements([
    entry({ theater: 'LUMIERE PALACE cinema', format: 'Dolby Cinema' }),
    entry({ theater: 'Grand Fictional' }),
    entry({ theater: 'Neighborhood Rep House', format: '35mm' }),
    entry({ theater: 'Neighborhood Rep House', format: '35mm', allowOtherTheater: true }),
    entry({ theater: 'Neighborhood Rep House', format: '70mm', allowOtherTheater: false })
  ], OPTIONS);
  assert.deepEqual(result.rejected.map((item) => item.index), [1, 2, 4]);
  assert.ok(result.rejected.every((item) => /not a configured priority theater/.test(item.reason)));
  assert.deepEqual(result.engagements.map((item) => [item.theater, item.priorityTheater]), [
    ['Lumière Palace Cinema', true],
    ['Neighborhood Rep House', false]
  ]);
  // With no allowlist supplied, validation fails closed.
  const closed = normalizeEngagements([entry(), entry({ theater: 'Anywhere', allowOtherTheater: true, startDate: '2026-11-21' })], { now: NOW });
  assert.deepEqual(closed.engagements.map((item) => item.theater), ['Anywhere']);
  assert.equal(closed.rejected.length, 1);
});

test('a premium format the theater is not configured for is kept but flagged', () => {
  const result = normalizeEngagements([
    entry({ format: 'Dolby Cinema' }),
    entry({ format: 'Standard', startDate: '2026-11-21' })
  ], OPTIONS);
  assert.equal(result.engagements.length, 2);
  assert.deepEqual(result.warnings, [{ index: 0, title: 'Orbital Dawn', reason: 'Dolby Cinema is not among the formats configured for this priority theater' }]);
});

test('joins by TMDB id first, then by exact normalized title and optional year', () => {
  const movies = [
    film(101, 'Orbital Dawn'),
    film(202, 'Amélie & the Machine: Part II'),
    film(303, 'Echo', '2026-12-04'),
    film(404, 'Echo', '2027-01-15'),
    film(505, 'Quiet Harbor')
  ];
  const result = applyEngagements(movies, [
    // Id wins even though the typed title is wrong.
    entry({ tmdbId: 101, title: 'Orbital Dwan' }),
    entry({ tmdbId: undefined, title: 'amelie and the machine - part ii', theater: 'Lumière Palace Cinema', format: 'Dolby Cinema' }),
    entry({ tmdbId: undefined, title: 'Echo', year: 2027, startDate: '2027-01-15', endDate: '2027-01-21' }),
    // Ambiguous without a year, never guessed.
    entry({ tmdbId: undefined, title: 'Echo', startDate: '2026-12-04', endDate: '2026-12-10' }),
    // An id that is not on the shortlist does not fall back to the title.
    entry({ tmdbId: 999, title: 'Quiet Harbor' }),
    // Near-miss titles are not fuzzy-matched.
    entry({ tmdbId: undefined, title: 'Quiet Harbour' }),
    entry({ tmdbId: undefined, title: 'Quiet Harbor', year: 2025 })
  ], OPTIONS);
  assert.deepEqual(result.movies.map((movie) => movie.formatStatus), ['confirmed', 'confirmed', 'verification pending', 'confirmed', 'verification pending']);
  assert.equal(result.movies[1].theater, 'Lumière Palace Cinema');
  assert.equal(result.movies[3].nextScreening, '2027-01-15');
  assert.deepEqual(result.unmatched.map((item) => [item.index, item.reason]), [
    [3, 'title matches more than one shortlisted film; add tmdbId or year'],
    [4, 'no shortlisted film has this TMDB id'],
    [5, 'no shortlisted film has this exact title'],
    [6, 'no shortlisted film has this exact title and year']
  ]);
  assert.equal(result.appliedCount, 3);
  assert.equal(result.confirmedMovieCount, 3);
});

test('a confirmed film becomes actionable with display-safe engagements, soonest first', () => {
  const movies = [film(101, 'Orbital Dawn')];
  const result = applyEngagements(movies, { engagements: [
    entry({ format: 'Standard', theater: 'Corner Twin', allowOtherTheater: true, startDate: '2026-11-13', endDate: undefined }),
    entry({ format: 'IMAX 70mm', startDate: '2026-11-20', endDate: '2026-11-26', showtimes: ['2026-11-21T13:00', '2026-11-20T19:30'], note: 'Reserved seating.' }),
    entry({ format: 'IMAX', startDate: '2026-11-20', endDate: '2026-11-26' })
  ] }, OPTIONS);
  const [movie] = result.movies;
  assert.notEqual(movie, movies[0]);
  assert.equal(movie.actionable, true);
  assert.equal(movie.formatStatus, 'confirmed');
  assert.equal(movie.premiumFormatConfirmed, true);
  // Headline is the soonest premium engagement, not the earlier standard run.
  assert.equal(movie.format, 'IMAX 70mm');
  assert.equal(movie.theater, 'Grand Fictional IMAX');
  assert.equal(movie.nextScreening, '2026-11-20');
  assert.deepEqual(movie.engagements.map((item) => [item.format, item.nextScreening, item.nextScreeningBasis, item.nextShowtime]), [
    ['Standard', '2026-11-13', 'run-start', null],
    ['IMAX 70mm', '2026-11-20', 'showtime', '2026-11-20T19:30'],
    ['IMAX', '2026-11-20', 'run-start', null]
  ]);
  assert.deepEqual(movie.engagements[1], {
    theater: 'Grand Fictional IMAX',
    format: 'IMAX 70mm',
    premium: true,
    priorityTheater: true,
    startDate: '2026-11-20',
    endDate: '2026-11-26',
    showtimes: ['2026-11-20T19:30', '2026-11-21T13:00'],
    nextScreening: '2026-11-20',
    nextShowtime: '2026-11-20T19:30',
    nextScreeningBasis: 'showtime',
    sourceUrl: 'https://example.com/showtimes/orbital-dawn',
    confirmedAt: '2026-11-10',
    expiresAt: '2026-11-26',
    note: 'Reserved seating.'
  });
  // TMDB facts are preserved.
  assert.equal(movie.id, 'tmdb:101');
  assert.equal(movie.releaseDate, '2026-11-20');
  assert.equal(movie.sourceUrl, 'https://www.themoviedb.org/movie/101');
});

test('a standard-only confirmation is actionable without claiming a premium format', () => {
  const result = applyEngagements([film(101, 'Orbital Dawn')], [entry({ format: 'Standard' })], OPTIONS);
  assert.equal(result.movies[0].actionable, true);
  assert.equal(result.movies[0].formatStatus, 'confirmed');
  assert.equal(result.movies[0].premiumFormatConfirmed, false);
  assert.equal(result.movies[0].format, 'Standard');
});

test('never invents a showtime: next screening is a date unless a showtime was published', () => {
  const movies = [film(101, 'Orbital Dawn', '2026-11-06')];
  // Run in progress, no showtimes published.
  let [movie] = applyEngagements(movies, [entry({ startDate: '2026-11-06', endDate: '2026-11-19' })], OPTIONS).movies;
  assert.deepEqual(movie.engagements[0].showtimes, []);
  assert.equal(movie.engagements[0].nextShowtime, null);
  assert.equal(movie.engagements[0].nextScreeningBasis, 'run-in-progress');
  assert.equal(movie.nextScreening, '2026-11-11');
  // Earlier published showtimes have passed; the run continues without a known time.
  [movie] = applyEngagements(movies, [entry({ startDate: '2026-11-06', endDate: '2026-11-19', showtimes: ['2026-11-06T19:00', '2026-11-11T09:30'] })], OPTIONS).movies;
  assert.deepEqual(movie.engagements[0].showtimes, []);
  assert.equal(movie.engagements[0].nextShowtime, null);
  assert.equal(movie.nextScreening, '2026-11-11');
  // Only still-upcoming published showtimes are carried, verbatim.
  [movie] = applyEngagements(movies, [entry({ startDate: '2026-11-06', endDate: '2026-11-19', showtimes: ['2026-11-11T09:30', '2026-11-11T10:00', '2026-11-14T22:15'] })], OPTIONS).movies;
  assert.deepEqual(movie.engagements[0].showtimes, ['2026-11-11T10:00', '2026-11-14T22:15']);
  assert.equal(movie.engagements[0].nextShowtime, '2026-11-11T10:00');
  assert.equal(movie.nextScreening, '2026-11-11');
  assert.ok(!JSON.stringify(movie).includes('startLocal'));
});

test('unmatched films are returned untouched as verification pending', () => {
  const movies = [film(101, 'Orbital Dawn'), film(505, 'Quiet Harbor'), film(606, 'Glass Meridian')];
  const before = structuredClone(movies);
  const result = applyEngagements(movies, [
    entry(),
    entry({ tmdbId: 606, startDate: '2026-10-01', endDate: '2026-10-07', confirmedAt: '2026-09-28' }),
    entry({ tmdbId: 505, sourceUrl: '' })
  ], OPTIONS);
  // Inputs are never mutated.
  assert.deepEqual(movies, before);
  // Films with no live confirmation (none, expired, or rejected) are the same objects.
  assert.equal(result.movies[1], movies[1]);
  assert.equal(result.movies[2], movies[2]);
  for (const movie of result.movies.slice(1)) {
    assert.equal(movie.formatStatus, 'verification pending');
    assert.equal(movie.premiumFormatConfirmed, false);
    assert.equal(movie.format, null);
    assert.equal(movie.theater, null);
    assert.ok(!('engagements' in movie) && !('actionable' in movie) && !('nextScreening' in movie));
  }
  assert.equal(result.movies[0].formatStatus, 'confirmed');
  assert.equal(result.expired.length, 1);
  assert.equal(result.rejected.length, 1);

  for (const none of [undefined, null, [], { engagements: [] }]) {
    const untouched = applyEngagements(movies, none, OPTIONS);
    untouched.movies.forEach((movie, index) => assert.equal(movie, movies[index]));
    assert.equal(untouched.appliedCount, 0);
  }
  assert.deepEqual(applyEngagements(undefined, [entry()], OPTIONS).movies, []);
});

test('accepts a prior normalizeEngagements result and keeps what it reported', () => {
  const movies = [film(101, 'Orbital Dawn')];
  const raw = [
    entry(),
    entry({ sourceUrl: '' }),
    entry({ startDate: '2026-10-01', endDate: '2026-10-07', confirmedAt: '2026-09-28' }),
    entry({ theater: 'Neighborhood Rep House', format: '35mm', allowOtherTheater: true })
  ];
  const direct = applyEngagements(movies, raw, OPTIONS);
  const staged = applyEngagements(movies, normalizeEngagements(raw, OPTIONS), OPTIONS);
  assert.deepEqual(staged, direct);
  assert.equal(staged.movies[0].engagements.length, 2);
  assert.equal(staged.rejected.length, 1);
  assert.equal(staged.expired.length, 1);
  assert.equal(applyEngagements(movies, normalizeEngagements(null, OPTIONS), OPTIONS).configured, false);
});

test('source health reports counts only and makes partial coverage legible', () => {
  const movies = [film(101, 'Orbital Dawn'), film(505, 'Quiet Harbor')];
  const clean = engagementSourceHealth(applyEngagements(movies, [entry()], OPTIONS));
  assert.deepEqual(clean, {
    source: 'movie-engagements',
    status: 'active',
    itemCount: 1,
    warningCount: 0,
    details: {
      confirmedFilms: 1,
      activeEngagements: 1,
      unmatchedEngagements: 0,
      expiredEngagements: 0,
      rejectedEngagements: 0,
      formatConflicts: 0,
      nextExpiry: '2026-11-26'
    }
  });

  const partial = engagementSourceHealth(applyEngagements(movies, [
    entry({ expiresAt: '2026-11-22T08:00:00Z' }),
    entry({ tmdbId: 505, format: 'Dolby Cinema' }),
    entry({ tmdbId: 777 }),
    entry({ sourceUrl: 'http://example.com' }),
    entry({ tmdbId: 505, startDate: '2026-10-01', endDate: '2026-10-07', confirmedAt: '2026-09-28' })
  ], OPTIONS));
  assert.equal(partial.status, 'partial');
  assert.equal(partial.itemCount, 2);
  assert.equal(partial.warningCount, 3);
  assert.deepEqual(partial.details, {
    confirmedFilms: 2,
    activeEngagements: 2,
    unmatchedEngagements: 1,
    expiredEngagements: 1,
    rejectedEngagements: 1,
    formatConflicts: 1,
    nextExpiry: '2026-11-22'
  });
  const published = JSON.stringify(partial);
  assert.ok(!published.includes('example.com') && !published.includes('Orbital') && !published.includes('Grand Fictional'));

  // Expiry alone is routine and does not degrade the source.
  const lapsed = engagementSourceHealth(applyEngagements(movies, [entry({ startDate: '2026-10-01', endDate: '2026-10-07', confirmedAt: '2026-09-28' })], OPTIONS));
  assert.equal(lapsed.status, 'active');
  assert.equal(lapsed.itemCount, 0);
  assert.equal(lapsed.details.expiredEngagements, 1);

  assert.equal(engagementSourceHealth(applyEngagements(movies, null, OPTIONS)).status, 'not configured');
  assert.equal(engagementSourceHealth(applyEngagements(movies, [], OPTIONS)).status, 'active');
  const broken = engagementSourceHealth(applyEngagements(movies, 'oops', OPTIONS));
  assert.equal(broken.status, 'unavailable');
  assert.equal(broken.warningCount, 1);
});

test('the documented example file validates against the example theater list', async () => {
  const example = JSON.parse(await readFile(new URL('../config/movie-engagements.example.json', import.meta.url), 'utf8'));
  const movieConfig = JSON.parse(await readFile(new URL('../config/movies.example.json', import.meta.url), 'utf8'));
  const result = normalizeEngagements(example, { now: new Date('2031-03-02T20:00:00Z'), priorityTheaters: movieConfig.priorityTheaters });
  assert.equal(result.error, null);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.engagements.length, 1);
  // Read today, the fictional example is simply rejected as confirmed in the future.
  assert.equal(normalizeEngagements(example, { now: NOW, priorityTheaters: movieConfig.priorityTheaters }).engagements.length, 0);
});
