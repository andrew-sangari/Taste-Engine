import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadBriefConfig } from '../src/briefConfig.js';
import { loadEnv } from '../src/env.js';
import { normalizeArtistName, rankCandidates } from '../src/ranking.js';
import {
  eventWithinRadius,
  fetchSeatGeekEventsForPerformers,
  normalizeSeatGeekEvent,
  resolveSeatGeekPerformers
} from '../src/seatgeek.js';

loadEnv();
const query = process.argv.slice(2).join(' ').trim();
if (!query) throw new Error('Usage: npm run debug:artist -- "Artist Name"');

const config = await loadBriefConfig(resolve('config/brief.json'));
const source = JSON.parse(await readFile(resolve('data/taste/artists.json'), 'utf8'));
const expanded = await readJsonIfPresent(resolve('data/taste/expanded-artists.json')) ?? source;
const normalizedQuery = normalizeArtistName(query);
const artist = (expanded.artists ?? []).find((item) => normalizeArtistName(item.name) === normalizedQuery)
  ?? { name: query, spotifyArtistId: null, seedStrength: 1, evidence: [], origin: 'debug' };
const sourceArtist = (source.artists ?? []).find((item) => normalizeArtistName(item.name) === normalizedQuery);
const resolution = await resolveSeatGeekPerformers([artist], { clientId: process.env.SEATGEEK_CLIENT_ID });
const performer = resolution.resolved[0];

console.log(`Spotify seed found: ${sourceArtist ? 'yes' : 'no'}`);
console.log(`SeatGeek performer resolved: ${performer ? 'yes' : 'no'}`);
if (!performer) process.exit(0);
console.log(`Selected performer: ${performer.performerId} (${performer.matchMethod})`);

const now = new Date();
const end = new Date(now);
end.setDate(end.getDate() + config.upcomingHorizonDays);
const startDate = localIsoDate(now, config.timezone);
const endDate = localIsoDate(end, config.timezone);
const events = await fetchSeatGeekEventsForPerformers({
  performerIds: [performer.performerId],
  clientId: process.env.SEATGEEK_CLIENT_ID,
  startDate,
  endDate,
  config,
  maxPages: config.maxSeatGeekPages,
  windowDays: null
});
const regional = events.filter((event) => eventWithinRadius(event, config.home, config.searchRadiusMiles));
const debugSnapshot = {
  artists: [{ ...artist, seatGeekPerformerId: performer.performerId }]
};
const ranked = rankCandidates(regional.map((event) => normalizeSeatGeekEvent(event, now)), debugSnapshot, config, now);
console.log(`Upcoming SeatGeek events: ${events.length}`);
console.log(`LA-region events: ${regional.length}`);
for (const event of ranked) {
  console.log(`- ${event.startLocal ?? 'date TBD'} | ${event.title} | included: ${event.matchedArtists.length > 0 && !event.ranking.excluded ? 'yes' : 'no'}`);
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function localIsoDate(date, timezone) {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}
