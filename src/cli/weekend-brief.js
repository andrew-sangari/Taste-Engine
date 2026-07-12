import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadBriefConfig } from '../briefConfig.js';
import { createWeekendBrief, renderBriefMarkdown } from '../brief.js';
import { loadEnv } from '../env.js';
import { rankCandidates } from '../ranking.js';
import { fetchSeatGeekWeekendEvents, normalizeSeatGeekEvent } from '../seatgeek.js';

loadEnv();

const options = parseArgs(process.argv.slice(2));
const artistPath = resolve(options.artists ?? 'data/taste/artists.json');
const configPath = resolve(options.config ?? 'config/brief.json');

try {
  const config = await loadBriefConfig(configPath);
  const artists = JSON.parse(await readFile(artistPath, 'utf8'));
  const { startDate, endDate } = weekendWindow(options.start, options.end);
  const events = await fetchSeatGeekWeekendEvents({
    clientId: process.env.SEATGEEK_CLIENT_ID,
    startDate,
    endDate,
    config
  });
  const candidates = events.filter((event) => event.type === 'concert').map((event) => normalizeSeatGeekEvent(event));
  const rankedCandidates = rankCandidates(candidates, artists, config);
  const brief = createWeekendBrief({ startDate, endDate, rankedCandidates, minimumUtility: config.minimumUtility });
  const outputBase = resolve(options.output ?? `data/briefs/${startDate}-weekend`);
  await mkdir(dirname(outputBase), { recursive: true });
  await writeFile(`${outputBase}.json`, `${JSON.stringify(brief, null, 2)}\n`);
  await writeFile(`${outputBase}.md`, renderBriefMarkdown(brief));
  console.log(`Wrote ${brief.recommendations.length} recommendation(s) to ${outputBase}.{json,md}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function weekendWindow(startOverride, endOverride) {
  if (Boolean(startOverride) !== Boolean(endOverride)) throw new Error('Use --start and --end together.');
  if (startOverride && endOverride) return { startDate: startOverride, endDate: endOverride };
  const today = new Date();
  const friday = new Date(today);
  friday.setHours(0, 0, 0, 0);
  friday.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7));
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);
  return { startDate: isoDate(friday), endDate: isoDate(sunday) };
}

function isoDate(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function parseArgs(args) {
  const options = {};
  const supported = new Set(['--artists', '--config', '--output', '--start', '--end']);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!supported.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = args[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}
