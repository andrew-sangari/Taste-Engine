import assert from "node:assert/strict";
import test from "node:test";
import { buildHostedProjection } from "../server/hosted-projection.ts";

test("complete hosted pipeline isolates sources and produces a publishable schema-v5 projection", async () => {
  const originalFetch = globalThis.fetch;
  const priorEnv = Object.fromEntries([
    "TASTE_ENGINE_CONFIG_JSON",
    "LASTFM_API_KEY",
    "SEATGEEK_CLIENT_ID",
    "TICKETMASTER_API_KEY",
    "EDMTRAIN_CLIENT_KEY",
    "TMDB_ACCESS_TOKEN",
    "OLLAMA_API_KEY",
    "OLLAMA_MODEL",
  ].map((key) => [key, process.env[key]]));
  process.env.TASTE_ENGINE_CONFIG_JSON = JSON.stringify({
    brief: {
      home: { label: "Los Angeles", lat: 34.0522, lon: -118.2437 },
      upcomingHorizonDays: 30,
      maxSeatGeekPages: 1,
      seatGeekWindowDays: 30,
      seatGeekPerformerArtistLimit: 1,
      frameworkArtistLimit: 1,
      ticketmasterArtistQueryLimit: 1,
      lastFmSeedArtistLimit: 1,
      lastFmSimilarPerArtist: 1,
      lastFmTopTagCount: 1,
      lastFmArtistsPerTag: 1,
      pinnedArtists: [],
      excludedArtists: [],
      excludedVenues: [],
    },
    movies: {
      maxCandidates: 1,
      minimumPopularity: 1,
      highPopularityOverride: 1,
      preferredGenreIds: [878],
      excludedGenreIds: [],
      preferredDirectors: [],
      preferredCinematographers: [],
      preferredCast: [],
      preferredCompanies: [],
      preferredKeywords: [],
      priorityTheaters: [],
    },
    sports: {
      teamId: 119,
      teamName: "Los Angeles Dodgers",
      homeVenueIds: [22],
      maxPitcherStats: 1,
      maxTicketPages: 1,
      rivalries: {},
    },
    personalContext: { background: [], decisionPreferences: [], maxEnhancedEvents: 1, maxEnhancedSports: 1 },
  });
  process.env.LASTFM_API_KEY = "lastfm";
  process.env.SEATGEEK_CLIENT_ID = "seatgeek";
  process.env.TICKETMASTER_API_KEY = "ticketmaster";
  process.env.EDMTRAIN_CLIENT_KEY = "edmtrain";
  process.env.TMDB_ACCESS_TOKEN = "tmdb";
  delete process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_MODEL;

  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "ws.audioscrobbler.com") {
      return json(url.searchParams.get("method") === "artist.getsimilar"
        ? { similarartists: { artist: [{ name: "Adjacent Artist", match: "0.8" }] } }
        : { topartists: { artist: [{ name: "Test Artist", "@attr": { rank: "1" } }] } });
    }
    if (url.hostname === "thisisframework.com" && url.pathname === "/artists/") return new Response("<html></html>");
    if (url.hostname === "thisisframework.com") return json({ events: [], total_pages: 1 });
    if (url.hostname === "www.insomniac.com") return new Response("<html></html>");
    if (url.hostname === "api.seatgeek.com" && url.pathname.endsWith("/performers")) {
      return json({ performers: [{ id: 9, name: "Test Artist", has_upcoming_events: true }] });
    }
    if (url.hostname === "api.seatgeek.com" && url.searchParams.get("taxonomies.name") === "baseball") {
      return json({ events: [], meta: { total: 0 } });
    }
    if (url.hostname === "api.seatgeek.com") {
      return json({ events: [seatGeekConcert()], meta: { total: 1 } });
    }
    if (url.hostname === "app.ticketmaster.com" && url.searchParams.get("classificationName") === "Sports") {
      return json({ _embedded: { events: [] }, page: { totalPages: 0 } });
    }
    if (url.hostname === "app.ticketmaster.com") {
      return json({ _embedded: { events: [ticketmasterConcert()] }, page: { totalPages: 1 } });
    }
    if (url.hostname === "edmtrain.com" && url.pathname.endsWith("/locations")) {
      return json({ locations: [{ id: 1, city: "Los Angeles", state: "California", country: "United States" }] });
    }
    if (url.hostname === "edmtrain.com") return json({ events: [] });
    if (url.hostname === "statsapi.mlb.com" && url.pathname.endsWith("/schedule")) {
      return json({ dates: [{ games: [mlbGame()] }] });
    }
    if (url.hostname === "statsapi.mlb.com" && url.pathname.endsWith("/standings")) {
      return json({ records: [{ teamRecords: [{ team: { id: 137, name: "San Francisco Giants" }, leagueRank: "4", divisionRank: "2", wins: 55, losses: 45, winningPercentage: ".550" }] }] });
    }
    if (url.hostname === "api.themoviedb.org" && url.pathname === "/3/discover/movie") {
      return json({ results: [{ id: 7, title: "Space Test", release_date: "2026-08-20", popularity: 50, vote_average: 8, genre_ids: [878] }], total_pages: 1 });
    }
    if (url.hostname === "api.themoviedb.org") {
      return json({ id: 7, title: "Space Test", release_date: "2026-08-20", popularity: 50, vote_average: 8, genre_ids: [878], genres: [{ id: 878, name: "Science Fiction" }], credits: { crew: [], cast: [] }, keywords: { keywords: [] }, release_dates: { results: [] }, production_companies: [] });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };

  try {
    const result = await buildHostedProjection({
      sourceSnapshot: {
        version: 2,
        generatedAt: "2026-08-01T12:00:00.000Z",
        playlistCount: 1,
        sourceArtistCount: 1,
        topArtistCount: 0,
        artistCount: 1,
        topItems: { status: "unavailable", windows: {}, warnings: [] },
        warnings: [],
        artists: [{
          spotifyArtistId: "spotify-1",
          name: "Test Artist",
          seedStrength: 10,
          playlistDiversity: 1,
          trackCount: 3,
          genres: ["house"],
          evidence: [{ playlistId: "p", playlistName: "P", weight: 1, trackCount: 3 }],
          origin: "source",
          discoveryEvidence: [],
        }],
      },
      initialSourceHealth: [
        { source: "spotify-playlists", status: "active", itemCount: 1, warningCount: 0 },
        { source: "spotify-top-artists", status: "partial", itemCount: 0, warningCount: 1 },
      ],
      previousProjection: null,
      generatedAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    assert.deepEqual(result.publicationBlockers, []);
    assert.equal(result.projection.schemaVersion, 5);
    assert.equal(result.projection.events.length, 1);
    assert.equal(result.projection.sports.length, 1);
    assert.equal(result.projection.movies.length, 1);
    assert.equal(result.projection.events[0].sources.includes("ticketmaster"), true);
    assert.equal(result.projection.eventEnhancement.mode, "deterministic");
    assert.ok(result.sourceHealth.some((source) => source.source === "edmtrain" && source.status === "active"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function seatGeekConcert() {
  return {
    id: 1,
    title: "Test Artist Live",
    type: "concert",
    datetime_local: "2026-08-15T20:00:00",
    datetime_utc: "2026-08-16T03:00:00Z",
    url: "https://example.com/seatgeek",
    venue: { id: 10, name: "The Venue", city: "Los Angeles", state: "CA", location: { lat: 34.05, lon: -118.24 } },
    performers: [{ id: 9, name: "Test Artist", primary: true }],
    stats: { listing_count: 20, lowest_price: 40 },
  };
}

function ticketmasterConcert() {
  return {
    id: "tm-1",
    name: "Test Artist Live",
    url: "https://example.com/ticketmaster",
    dates: { start: { localDate: "2026-08-15", localTime: "20:00:00" }, status: { code: "onsale" } },
    _embedded: {
      venues: [{ id: "v", name: "The Venue", city: { name: "Los Angeles" }, state: { stateCode: "CA" }, location: { latitude: "34.05", longitude: "-118.24" } }],
      attractions: [{ id: "a", name: "Test Artist" }],
    },
  };
}

function mlbGame() {
  return {
    gamePk: 99,
    gameDate: "2026-08-18T02:10:00Z",
    officialDate: "2026-08-17",
    season: "2026",
    venue: { id: 22, name: "Dodger Stadium" },
    teams: {
      home: { team: { id: 119, name: "Los Angeles Dodgers", shortName: "LA Dodgers" } },
      away: { team: { id: 137, name: "San Francisco Giants", shortName: "San Francisco" } },
    },
    status: { detailedState: "Scheduled", startTimeTBD: false },
  };
}
