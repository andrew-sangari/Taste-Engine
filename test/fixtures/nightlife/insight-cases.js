/**
 * Targeted cases for the card-insight evaluation.
 *
 * Each case is built from provider-shaped payloads run through the real
 * adapters and merge step, so the evaluation exercises the same normalization,
 * evidence merging and permissions that production does. Assessments are
 * fixed Jev outputs in the validated domain shape, so the cases measure what
 * our composition does with a characterization, not what the model says.
 *
 * Gold labels say what a correct card must and must not do. They are written
 * from the evidence, not from the composer's current output.
 */
import { deduplicateCandidates } from '../../../src/candidates.js';
import { normalizeFrameworkEvent } from '../../../src/framework.js';
import { normalizeInsomniacEvent } from '../../../src/insomniac.js';
import { normalizeSeatGeekEvent } from '../../../src/seatgeek.js';
import { normalizeTicketmasterEvent } from '../../../src/ticketmaster.js';

const RETRIEVED = new Date('2026-09-20T12:00:00Z');
const VENUE = { name: 'Example Hall', city: { name: 'Los Angeles' }, state: { stateCode: 'CA' }, location: { latitude: '34.04', longitude: '-118.24' } };

function ticketmaster({ id, name, date = '2026-10-03', time = '22:00:00', end = null, genre = 'Dance/Electronic', subGenre = null, type = null, eventStyle = null, attractions = ['Example Artist'], ageRestrictions = null }) {
  const typeLevel = eventStyle
    ? { type: { name: 'Event Style' }, subType: { name: eventStyle } }
    : type ? { type: { name: type }, subType: { name: 'Musician' } } : {};
  return normalizeTicketmasterEvent({
    id,
    name,
    url: `https://www.ticketmaster.com/event/${id}`,
    dates: { start: { localDate: date, localTime: time }, ...(end ? { end: { localDate: end.date, localTime: end.time } } : {}) },
    classifications: genre ? [{ segment: { name: 'Music' }, genre: { name: genre }, ...(subGenre ? { subGenre: { name: subGenre } } : {}), ...typeLevel }] : [],
    ...(ageRestrictions ? { ageRestrictions } : {}),
    _embedded: { venues: [VENUE], attractions: attractions.map((attraction, index) => ({ id: `${id}-a${index}`, name: attraction })) }
  }, RETRIEVED);
}

function framework({ id, title, start = '2026-10-03 22:00:00', end = null, allDay = false, categories = [] }) {
  return normalizeFrameworkEvent({
    id,
    title,
    url: `https://thisisframework.com/event/${id}/`,
    start_date: start,
    ...(end ? { end_date: end } : {}),
    ...(allDay ? { all_day: true } : {}),
    categories: categories.map((name) => ({ name })),
    venue: { venue: 'Example Hall', city: 'Los Angeles', stateprovince: 'CA', address: '1 Example St' }
  }, RETRIEVED);
}

function seatgeek({ id, title, datetime = '2026-10-03T22:00:00', performers = ['Example Artist'] }) {
  return normalizeSeatGeekEvent({
    id,
    title,
    url: `https://seatgeek.com/e/${id}`,
    type: 'concert',
    datetime_local: datetime,
    performers: performers.map((name) => ({ name })),
    venue: { name: 'Example Hall', city: 'Los Angeles', state: 'CA', location: { lat: 34.04, lon: -118.24 } },
    stats: { lowest_price: 40 }
  }, RETRIEVED);
}

function merged(...events) {
  const [candidate] = deduplicateCandidates(events);
  return candidate;
}

function withTaste(candidate, matchedArtists, utility = 50) {
  return { ...candidate, matchedArtists, ranking: { utility, artistFit: utility } };
}

const direct = (name) => ({ name, origin: 'source', matchMethod: 'exact-name', primary: true });
const adjacent = (name, origin = 'similar') => ({ name, origin, matchMethod: 'exact-name', primary: true });

function assessment(experienceCharacter, band = 'moderate') {
  return {
    experienceCharacter,
    musicCharacter: 'electronic_dance',
    certainty: { experienceCharacter: band, musicCharacter: 'high' }
  };
}

export function buildInsightCases() {
  return [
    {
      id: 'familiar-artist-unfamiliar-format',
      description: 'A direct artist, and Jev characterizes the published genre and late start as a dance-floor set.',
      candidate: withTaste(ticketmaster({ id: 'tm-sidepiece', name: 'SIDEPIECE w/ Maesic', attractions: ['Sidepiece'] }), [direct('Sidepiece')]),
      assessment: assessment('dance_floor'),
      gold: {
        enrich: true,
        personal: true,
        modelContributes: true,
        mustMatch: [{ kind: 'whyItMayFit', pattern: 'dance-floor set from Sidepiece' }],
        mustNotMatch: ['never seen', 'new to you', 'first time']
      }
    },
    {
      id: 'adjacent-style-no-novelty-proof',
      description: 'The same characterization reached through a similar-artist path: no personal claim, and no novelty claim.',
      candidate: withTaste(ticketmaster({ id: 'tm-adjacent', name: 'Adjacent Night', attractions: ['Neighbour Act'] }), [adjacent('Neighbour Act')]),
      assessment: assessment('dance_floor'),
      gold: {
        enrich: true,
        personal: false,
        modelContributes: true,
        mustMatch: [{ kind: 'whatToExpect', pattern: 'dance-floor night' }],
        mustNotMatch: ['new to you', 'novel', 'outside your', 'your listening', 'fits your']
      }
    },
    {
      id: 'title-age-restriction-without-policy-field',
      description: 'The displayed title (from SeatGeek) says 21+; the permitted Framework title does not; no structured policy exists.',
      candidate: withTaste(merged(
        seatgeek({ id: 'sg-josh', title: 'Josh Baker (21+)', datetime: '2026-11-21T18:00:00', performers: ['Josh Baker'] }),
        framework({ id: 'fw-josh', title: 'Josh Baker', start: '2026-11-21 18:00:00', end: '2026-11-22 00:00:00' })
      ), [adjacent('Josh Baker', 'promoter')]),
      assessment: null,
      gold: {
        enrich: true,
        personal: false,
        modelContributes: false,
        mustNotMatch: ['no additional entry restriction', 'no .*restriction', 'all ages', 'unrestricted']
      }
    },
    {
      id: 'permitted-title-age-restriction',
      description: 'Framework\'s own title states 21+ while the card shows Ticketmaster\'s title without it.',
      candidate: withTaste(merged(
        ticketmaster({ id: 'tm-age', name: 'Late Room', date: '2026-10-09', time: '22:00:00', attractions: ['Room Artist'] }),
        framework({ id: 'fw-age', title: 'Late Room (21+)', start: '2026-10-09 22:00:00' })
      ), []),
      assessment: null,
      gold: {
        enrich: true,
        personal: false,
        modelContributes: false,
        mustMatch: [{ kind: 'worthChecking', pattern: "Framework's listing marks this 21\\+" }]
      }
    },
    {
      id: 'title-and-policy-disagree',
      description: 'A structured policy says all ages while a permitted title says 21+.',
      candidate: withTaste(merged(
        ticketmaster({ id: 'tm-conflict', name: 'Split Policy', date: '2026-10-10', time: '20:00:00', attractions: ['Split Artist'], ageRestrictions: { legalAge: 'All Ages' } }),
        framework({ id: 'fw-conflict', title: 'Split Policy (21+)', start: '2026-10-10 20:00:00' })
      ), []),
      assessment: null,
      gold: {
        enrich: true,
        personal: false,
        modelContributes: false,
        mustMatch: [{ kind: 'worthChecking', pattern: 'says 21\\+.*says All Ages|says All Ages.*says 21\\+' }],
        mustNotMatch: ['lists entry as All Ages\\.']
      }
    },
    {
      id: 'late-start-without-end',
      description: 'A 10:30 PM start with no published end: the finish is unknown, not late.',
      candidate: withTaste(ticketmaster({ id: 'tm-late', name: 'Late Start', time: '22:30:00', genre: 'Hip-Hop/Rap', attractions: ['Late Artist'] }), []),
      assessment: null,
      gold: {
        enrich: true,
        personal: false,
        modelContributes: false,
        mustMatch: [{ kind: 'worthChecking', pattern: 'no end time is published' }],
        mustNotMatch: ['runs late', 'until [0-9]', 'late way home', 'after-hours']
      }
    },
    {
      id: 'misleading-provider-classification',
      description: 'Ticketmaster attaches the subgenre Amapiano and the attraction type Musician to a house DJ.',
      candidate: withTaste(ticketmaster({ id: 'tm-amapiano', name: 'House DJ', time: '20:00:00', subGenre: 'Amapiano', type: 'Individual', attractions: ['House DJ'] }), []),
      assessment: null,
      gold: {
        enrich: true,
        personal: false,
        modelContributes: false,
        mustMatch: [{ kind: 'whatToExpect', pattern: 'Dance/Electronic' }],
        mustNotMatch: ['Amapiano', 'Musician', 'Individual']
      }
    },
    {
      id: 'conflicting-start-times',
      description: 'Ticketmaster and Framework publish different start times for the same night.',
      candidate: withTaste(merged(
        ticketmaster({ id: 'tm-time', name: 'Timing Night', date: '2026-10-17', time: '20:00:00', attractions: ['Timing Artist'] }),
        framework({ id: 'fw-time', title: 'Timing Night', start: '2026-10-17 21:00:00', end: '2026-10-18 02:00:00' })
      ), []),
      assessment: null,
      gold: {
        enrich: true,
        personal: false,
        modelContributes: false,
        mustMatch: [
          { kind: 'worthChecking', pattern: '8 PM.*9 PM|9 PM.*8 PM' },
          // A window pairs one provider's own start and end, never one source's
          // start with another's finish.
          { kind: 'worthPlanning', pattern: 'Framework lists a 9 PM – 2 AM window' }
        ]
      }
    },
    {
      id: 'rich-evidence-festival-personalization',
      description: 'A documented festival bill that includes an artist from the user\'s listening.',
      candidate: withTaste(ticketmaster({
        id: 'tm-festival',
        name: 'Escape',
        date: '2026-10-30',
        time: '16:00:00',
        // Ticketmaster's real shape for a festival: no genre, and the event
        // type in the attraction type/subType slot.
        genre: 'Undefined',
        eventStyle: 'Festival',
        attractions: ['Escape', 'Zedd', 'Cloonee', 'Richie Hawtin', 'Getter']
      }), [direct('Cloonee')]),
      assessment: assessment('festival_multi_stage', 'high'),
      gold: {
        enrich: true,
        personal: true,
        modelContributes: false,
        mustMatch: [{ kind: 'whyItMayFit', pattern: 'Cloonee, already in your listening, is one of 5 named acts' }]
      }
    },
    {
      id: 'taste-tag-genre-match',
      description: 'No artist match, but the published genre matches a recurring taste-profile tag.',
      candidate: withTaste(ticketmaster({ id: 'tm-tag', name: 'Tag Night', time: '20:00:00', attractions: ['Unmatched Act'] }), []),
      assessment: null,
      preferences: { topTags: ['electronic'] },
      gold: {
        enrich: true,
        personal: true,
        modelContributes: false,
        mustMatch: [{ kind: 'whyItMayFit', pattern: 'recurring tags in your taste profile' }]
      }
    },
    {
      id: 'genre-without-tag-signal',
      description: 'The same event with an empty taste-profile tag list: a genre alone is not a preference.',
      candidate: withTaste(ticketmaster({ id: 'tm-notag', name: 'Tag Night', time: '20:00:00', attractions: ['Unmatched Act'] }), []),
      assessment: assessment('dance_floor', 'high'),
      preferences: { topTags: [] },
      gold: {
        enrich: true,
        personal: false,
        modelContributes: true,
        mustNotMatch: ['your taste', 'your listening', 'you like', 'you enjoy']
      }
    },
    {
      id: 'low-certainty-characterization',
      description: 'A direct artist, but Jev is not confident: no model-derived or personal claim.',
      candidate: withTaste(ticketmaster({ id: 'tm-low', name: 'Unsure Night', time: '20:00:00', attractions: ['Known Artist'] }), [direct('Known Artist')]),
      assessment: assessment('dance_floor', 'low'),
      gold: { enrich: true, personal: false, modelContributes: false, mustNotMatch: ['dance-floor'] }
    },
    {
      id: 'characterization-from-start-time-only',
      description: 'Jev returns dance_floor for an event whose only transmitted facts are title, start and venue.',
      candidate: withTaste(framework({ id: 'fw-thin', title: 'Thin Listing', start: '2026-10-24 22:00:00' }), [direct('Thin Artist')]),
      assessment: assessment('dance_floor', 'high'),
      gold: { enrich: false, personal: false, modelContributes: false }
    },
    {
      id: 'default-concert-characterization',
      description: 'A direct artist characterized as a standard live performance: not an experiential distinction.',
      candidate: withTaste(ticketmaster({ id: 'tm-live', name: 'Tour Stop', time: '20:00:00', genre: 'Pop', attractions: ['Pop Artist'] }), [direct('Pop Artist')]),
      assessment: assessment('live_performance', 'high'),
      gold: { enrich: true, personal: false, modelContributes: false, mustNotMatch: ['your listening', 'live performance'] }
    },
    {
      id: 'seatgeek-only-restricted',
      description: 'SeatGeek-only material is never event evidence.',
      candidate: withTaste(seatgeek({ id: 'sg-only', title: 'Restricted Night (21+)' }), [direct('Example Artist')]),
      assessment: assessment('dance_floor', 'high'),
      gold: { enrich: false, personal: false, modelContributes: false }
    },
    {
      id: 'evidence-sparse-framework',
      description: 'A Framework listing with only a title, an early start and a venue.',
      candidate: withTaste(framework({ id: 'fw-sparse', title: 'Sparse Listing', start: '2026-10-25 19:00:00' }), []),
      assessment: null,
      gold: { enrich: false, personal: false, modelContributes: false }
    },
    {
      id: 'all-day-placeholder',
      description: 'An all-day 00:00–23:59 placeholder is not a published schedule.',
      candidate: withTaste(framework({ id: 'fw-allday', title: 'All Day Listing', start: '2026-10-14 00:00:00', end: '2026-10-14 23:59:59', allDay: true }), []),
      assessment: null,
      gold: { enrich: false, personal: false, modelContributes: false, mustNotMatch: ['window', 'end time'] }
    },
    {
      id: 'promoter-name-classification',
      description: 'Framework tags its own calendar with its own name; that is not a classification.',
      candidate: withTaste(framework({ id: 'fw-promoter', title: 'Promoter Tagged', start: '2026-10-26 19:00:00', categories: ['Framework'] }), []),
      assessment: null,
      gold: { enrich: false, personal: false, modelContributes: false, mustNotMatch: ['Framework classifies'] }
    },
    {
      id: 'unverified-insomniac',
      description: 'Insomniac stays outside permitted evidence until its extractor is repaired.',
      candidate: withTaste(normalizeInsomniacEvent({
        id: 'ins-1', name: 'Insomniac Night', startDate: '2026-10-03T22:00:00',
        url: 'https://www.insomniac.com/events/ins-1', genre: 'House', venue: { name: 'Example Hall' }
      }, RETRIEVED), [direct('Example Artist')]),
      assessment: assessment('dance_floor', 'high'),
      gold: { enrich: false, personal: false, modelContributes: false }
    }
  ];
}
