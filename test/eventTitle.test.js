import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePromoterTitle } from '../src/eventTitle.js';
import { normalizeFrameworkEvent } from '../src/framework.js';

const names = (title, options) => parsePromoterTitle(title, { housePromoters: ['Framework'], ...options }).performers.map((performer) => performer.name);

test('separates performers from presenters and the name of the night', () => {
  const anotr = parsePromoterTitle('unKommon Events & Framework present: ANOTR', { housePromoters: ['Framework'] });
  assert.deepEqual(anotr.performers.map((performer) => performer.name), ['ANOTR']);
  assert.deepEqual(anotr.presenters, ['unKommon Events', 'Framework']);

  const flow = parsePromoterTitle('Franky Rizardo presents FLOW (Extended Set)');
  assert.deepEqual(flow.performers.map((performer) => performer.name), ['Franky Rizardo']);
  assert.equal(flow.eventName, 'FLOW');
  assert.deepEqual(flow.notes, ['Extended Set']);

  assert.deepEqual(names('Framework presents Max Dean B2B Luke Dean'), ['Max Dean', 'Luke Dean']);
  assert.deepEqual(names('Afrojack Presents: CONTROL'), ['Afrojack']);
  assert.deepEqual(names("Black Book Records presents 'Untitled'"), ['Black Book Records']);
});

test('strips decorations and placeholders without inventing artists', () => {
  assert.deepEqual(names('Duke Dumont NYE'), ['Duke Dumont']);
  assert.deepEqual(names('Chris Stussy Halloween'), ['Chris Stussy']);
  assert.deepEqual(names('ZHU (Second Date)'), ['ZHU']);
  assert.deepEqual(names('deadmau5 (Birthday Celebration)'), ['deadmau5']);
  assert.deepEqual(names('Layton Giordani (4 Hour Extended Set)'), ['Layton Giordani']);
  assert.deepEqual(names('Adriatique B2B ???????'), ['Adriatique']);
  assert.deepEqual(names('Sasha & John Digweed'), ['Sasha', 'John Digweed']);
  assert.deepEqual(names('The Soulection Experience: 15 Year Anniversary'), ['The Soulection Experience']);
  assert.deepEqual(names('Lunar New Year: Damian Lazarus & Tripolism'), ['Damian Lazarus', 'Tripolism']);
  assert.deepEqual(names('re:frame Season 2 Passes'), []);
  assert.deepEqual(names('unKommon Events & Framework present: Two-Day Pass'), []);
});

test('known artist names decide ambiguous titles by exact match only', () => {
  assert.deepEqual(names('Above & Beyond', { knownArtistNames: ['Above & Beyond'] }), ['Above & Beyond']);
  assert.deepEqual(names('Above & Beyond'), ['Above', 'Beyond']);
  assert.deepEqual(names('Drumcode presents Adam Beyer', { knownArtistNames: ['Adam Beyer'] }), ['Adam Beyer']);
  assert.deepEqual(names('Day Zero: Damian Lazarus', { knownArtistNames: ['Damian Lazarus'] }), ['Damian Lazarus']);
  const verified = parsePromoterTitle('ANOTR', { knownArtistNames: ['ANOTR'] }).performers[0];
  assert.equal(verified.identityVerified, true);
});

test('Framework events carry the promoter separately from the performers', () => {
  const event = normalizeFrameworkEvent({
    id: 7, title: 'unKommon Events &amp; Framework present: ANOTR', url: 'https://thisisframework.com/event/anotr/',
    start_date: '2026-11-21 18:00:00', venue: { venue: 'Expo Lawn', city: 'Los Angeles' }
  }, '2026-11-01T00:00:00Z');
  assert.deepEqual(event.performers.map((performer) => performer.name), ['ANOTR']);
  assert.deepEqual(event.promoters, ['Framework', 'unKommon Events']);
});
