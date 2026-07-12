import { readFile } from 'node:fs/promises';

export async function loadBriefConfig(path) {
  let input;
  try {
    input = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Brief config not found at ${path}. Copy config/brief.example.json to config/brief.json first.`);
    }
    throw new Error(`Could not read brief config at ${path}: ${error.message}`);
  }
  return normalizeBriefConfig(input);
}

export function normalizeBriefConfig(input = {}) {
  const home = input.home ?? {};
  const lat = finiteNumber(home.lat, 'home.lat');
  const lon = finiteNumber(home.lon, 'home.lon');
  const radius = positiveNumber(input.searchRadiusMiles ?? 60, 'searchRadiusMiles');
  const upcomingHorizonDays = positiveInteger(input.upcomingHorizonDays ?? 180, 'upcomingHorizonDays');
  const maxSeatGeekPages = positiveInteger(input.maxSeatGeekPages ?? 5, 'maxSeatGeekPages');
  const seatGeekWindowDays = positiveInteger(input.seatGeekWindowDays ?? 14, 'seatGeekWindowDays');
  const seatGeekPerformerArtistLimit = positiveInteger(input.seatGeekPerformerArtistLimit ?? 250, 'seatGeekPerformerArtistLimit');
  const frameworkArtistLimit = positiveInteger(input.frameworkArtistLimit ?? 200, 'frameworkArtistLimit');
  const ticketmasterArtistQueryLimit = positiveInteger(input.ticketmasterArtistQueryLimit ?? 200, 'ticketmasterArtistQueryLimit');
  const lastFmSeedArtistLimit = positiveInteger(input.lastFmSeedArtistLimit ?? 40, 'lastFmSeedArtistLimit');
  const lastFmSimilarPerArtist = positiveInteger(input.lastFmSimilarPerArtist ?? 6, 'lastFmSimilarPerArtist');
  const lastFmTopTagCount = positiveInteger(input.lastFmTopTagCount ?? 5, 'lastFmTopTagCount');
  const lastFmArtistsPerTag = positiveInteger(input.lastFmArtistsPerTag ?? 25, 'lastFmArtistsPerTag');
  const maxTicketPriceUsd = positiveNumber(input.maxTicketPriceUsd ?? 120, 'maxTicketPriceUsd');
  const minimumUtility = finiteNumber(input.minimumUtility ?? 28, 'minimumUtility');
  const overviewPlanAheadMinScore = finiteNumber(input.overviewPlanAheadMinScore ?? 55, 'overviewPlanAheadMinScore');

  return {
    timezone: String(input.timezone ?? 'America/Los_Angeles'),
    home: { label: String(home.label ?? 'Home'), lat, lon },
    searchRadiusMiles: radius,
    upcomingHorizonDays,
    maxSeatGeekPages,
    seatGeekWindowDays,
    seatGeekPerformerArtistLimit,
    frameworkArtistLimit,
    ticketmasterArtistQueryLimit,
    lastFmSeedArtistLimit,
    lastFmSimilarPerArtist,
    lastFmTopTagCount,
    lastFmArtistsPerTag,
    maxTicketPriceUsd,
    minimumUtility,
    overviewPlanAheadMinScore,
    pinnedArtists: normalizeNames(input.pinnedArtists),
    excludedArtists: normalizeNames(input.excludedArtists),
    excludedVenues: normalizeNames(input.excludedVenues)
  };
}

function normalizeNames(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))];
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a finite number`);
  return number;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) throw new Error(`${name} must be greater than zero`);
  return number;
}

function positiveInteger(value, name) {
  const number = positiveNumber(value, name);
  if (!Number.isInteger(number)) throw new Error(`${name} must be an integer`);
  return number;
}
