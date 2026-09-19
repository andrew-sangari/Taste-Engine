export type HostedPipelineConfig = {
  brief: Record<string, unknown> & {
    timezone: string;
    home: { label: string; lat: number; lon: number };
    searchRadiusMiles: number;
    upcomingHorizonDays: number;
    maxSeatGeekPages: number;
    seatGeekWindowDays: number;
    seatGeekPerformerArtistLimit: number;
    frameworkArtistLimit: number;
    ticketmasterArtistQueryLimit: number;
    lastFmSeedArtistLimit: number;
    lastFmSimilarPerArtist: number;
    lastFmTopTagCount: number;
    lastFmArtistsPerTag: number;
    maxTicketPriceUsd: number;
    minimumUtility: number;
    overviewPlanAheadMinScore: number;
    pinnedArtists: string[];
    excludedArtists: string[];
    excludedVenues: string[];
    edmtrain: { enabled: boolean; city: string; state: string };
  };
  movies: Record<string, unknown> & {
    maxCandidates: number;
    priorityTheaters: unknown[];
  };
  sports: Record<string, unknown> & {
    enabled: boolean;
    teamId: number;
    teamName: string;
    homeOnly: boolean;
    homeVenueIds: Array<string | number>;
    featuredInterestThreshold: number;
    maxPitcherStats: number;
    maxTicketPages: number;
    rivalries: Record<string, unknown>;
  };
  personalContext: {
    version?: number;
    background: string[];
    decisionPreferences: string[];
    maxEnhancedEvents: number;
    maxEnhancedSports: number;
  };
};

const SHARED_SECTION_KEYS = {
  brief: [
    "timezone",
    "home",
    "searchRadiusMiles",
    "upcomingHorizonDays",
    "maxSeatGeekPages",
    "seatGeekWindowDays",
    "seatGeekPerformerArtistLimit",
    "frameworkArtistLimit",
    "ticketmasterArtistQueryLimit",
    "lastFmSeedArtistLimit",
    "lastFmSimilarPerArtist",
    "lastFmTopTagCount",
    "lastFmArtistsPerTag",
    "edmtrain",
  ],
  movies: ["maxCandidates"],
  sports: ["maxPitcherStats", "maxTicketPages"],
  personalContext: ["version", "maxEnhancedEvents", "maxEnhancedSports"],
} as const;

export function readHostedPipelineConfig(profile?: ProfileScope): HostedPipelineConfig {
  const raw = process.env.TASTE_ENGINE_CONFIG_JSON;
  if (!raw) throw new HostedConfigError("TASTE_ENGINE_CONFIG_JSON is not configured.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HostedConfigError("TASTE_ENGINE_CONFIG_JSON is invalid JSON.");
  }
  if (!isRecord(parsed)) throw new HostedConfigError("Hosted configuration must be an object.");
  const selected = selectProfileConfig(parsed, profile);
  const briefInput = record(selected.brief);
  const movieInput = record(selected.movies);
  const sportsInput = record(selected.sports);
  const personalInput = record(selected.personalContext);
  const home = record(briefInput.home);
  const brief = {
    ...briefInput,
    timezone: text(briefInput.timezone, "America/Los_Angeles"),
    home: {
      label: text(home.label, "Los Angeles"),
      lat: finite(home.lat, "brief.home.lat"),
      lon: finite(home.lon, "brief.home.lon"),
    },
    searchRadiusMiles: positive(briefInput.searchRadiusMiles, 60),
    upcomingHorizonDays: integer(briefInput.upcomingHorizonDays, 180),
    maxSeatGeekPages: integer(briefInput.maxSeatGeekPages, 5),
    seatGeekWindowDays: integer(briefInput.seatGeekWindowDays, 14),
    seatGeekPerformerArtistLimit: integer(briefInput.seatGeekPerformerArtistLimit, 250),
    frameworkArtistLimit: integer(briefInput.frameworkArtistLimit, 200),
    ticketmasterArtistQueryLimit: integer(briefInput.ticketmasterArtistQueryLimit, 200),
    lastFmSeedArtistLimit: integer(briefInput.lastFmSeedArtistLimit, 40),
    lastFmSimilarPerArtist: integer(briefInput.lastFmSimilarPerArtist, 6),
    lastFmTopTagCount: integer(briefInput.lastFmTopTagCount, 5),
    lastFmArtistsPerTag: integer(briefInput.lastFmArtistsPerTag, 25),
    maxTicketPriceUsd: positive(briefInput.maxTicketPriceUsd, 120),
    minimumUtility: finiteOr(briefInput.minimumUtility, 28),
    overviewPlanAheadMinScore: finiteOr(briefInput.overviewPlanAheadMinScore, 55),
    pinnedArtists: names(briefInput.pinnedArtists),
    excludedArtists: names(briefInput.excludedArtists),
    excludedVenues: names(briefInput.excludedVenues),
    edmtrain: {
      enabled: record(briefInput.edmtrain).enabled !== false,
      city: text(record(briefInput.edmtrain).city, "Los Angeles"),
      state: text(record(briefInput.edmtrain).state, "California"),
    },
  };
  return {
    brief,
    movies: {
      ...movieInput,
      maxCandidates: integer(movieInput.maxCandidates, 20),
      priorityTheaters: Array.isArray(movieInput.priorityTheaters) ? movieInput.priorityTheaters : [],
    },
    sports: {
      ...sportsInput,
      enabled: sportsInput.enabled !== false,
      teamId: integer(sportsInput.teamId, 119),
      teamName: text(sportsInput.teamName, "Los Angeles Dodgers"),
      homeOnly: sportsInput.homeOnly !== false,
      homeVenueIds: Array.isArray(sportsInput.homeVenueIds) ? sportsInput.homeVenueIds as Array<string | number> : [],
      featuredInterestThreshold: finiteOr(sportsInput.featuredInterestThreshold, 55),
      maxPitcherStats: integer(sportsInput.maxPitcherStats, 48),
      maxTicketPages: integer(sportsInput.maxTicketPages, 3),
      rivalries: record(sportsInput.rivalries),
    },
    personalContext: {
      version: Number.isInteger(personalInput.version) ? Number(personalInput.version) : undefined,
      background: names(personalInput.background),
      decisionPreferences: names(personalInput.decisionPreferences),
      maxEnhancedEvents: integer(personalInput.maxEnhancedEvents, 16),
      maxEnhancedSports: integer(personalInput.maxEnhancedSports, 12),
    },
  };
}

function selectProfileConfig(input: Record<string, unknown>, profile?: ProfileScope): Record<string, unknown> {
  const profiles = record(input.profiles);
  const versioned = input.version === 2 || Object.keys(profiles).length > 0;
  if (!versioned) {
    if (profile && !profile.legacyDefault) {
      throw new HostedConfigError("This profile needs an explicit entry in TASTE_ENGINE_CONFIG_JSON.");
    }
    return input;
  }
  if (!profile) throw new HostedConfigError("Profile identity is required for version 2 hosted configuration.");
  const profileInput = record(profiles[profile.id]);
  if (!Object.keys(profileInput).length) {
    throw new HostedConfigError(`Hosted configuration is missing profile ${profile.id}.`);
  }
  const shared = record(input.shared);
  return {
    brief: mergeSection(sharedSection("brief", shared.brief), profileInput.brief, ["home", "edmtrain"]),
    movies: mergeSection(sharedSection("movies", shared.movies), profileInput.movies),
    sports: mergeSection(sharedSection("sports", shared.sports), profileInput.sports, ["rivalries"]),
    personalContext: mergeSection(sharedSection("personalContext", shared.personalContext), profileInput.personalContext),
  };
}

function sharedSection(
  name: keyof typeof SHARED_SECTION_KEYS,
  value: unknown,
): Record<string, unknown> {
  const input = record(value);
  const allowed = new Set<string>(SHARED_SECTION_KEYS[name]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new HostedConfigError(`shared.${name}.${key} must be configured inside each profile.`);
    }
  }
  return input;
}

function mergeSection(shared: unknown, profile: unknown, nestedKeys: string[] = []): Record<string, unknown> {
  const base = record(shared);
  const override = record(profile);
  const output = { ...base, ...override };
  for (const key of nestedKeys) output[key] = { ...record(base[key]), ...record(override[key]) };
  return output;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, fallback: string): string {
  const output = String(value ?? "").trim();
  return output || fallback;
}

function names(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function finite(value: unknown, label: string): number {
  const output = Number(value);
  if (!Number.isFinite(output)) throw new HostedConfigError(`${label} must be numeric.`);
  return output;
}

function finiteOr(value: unknown, fallback: number): number {
  const output = Number(value);
  return Number.isFinite(output) ? output : fallback;
}

function positive(value: unknown, fallback: number): number {
  const output = finiteOr(value, fallback);
  return output > 0 ? output : fallback;
}

function integer(value: unknown, fallback: number): number {
  const output = Number(value);
  return Number.isInteger(output) && output > 0 ? output : fallback;
}

export class HostedConfigError extends Error {}
import type { ProfileScope } from "./profiles";
