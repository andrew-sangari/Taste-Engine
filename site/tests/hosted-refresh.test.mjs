import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHostedArtistSeed,
  mergeHostedTopArtists,
} from "../server/hosted-refresh-contract.ts";
import {
  deduplicateCandidates,
  rankCandidates,
} from "../server/deterministic-engine.js";
import { readHostedPipelineConfig } from "../server/hosted-config.ts";
import { buildHostedMusicVector } from "../server/hosted-advisory.ts";
import { runOllamaCloudStructuredPass } from "../server/ollama-cloud.ts";
import {
  getLastfmSimilarArtists,
  LastfmNotConfiguredError,
} from "../server/lastfm.ts";

test("hosted artist seed merges playlist evidence deterministically", () => {
  const artists = buildHostedArtistSeed([
    {
      playlistId: "playlist-a",
      playlistName: "A",
      weight: 2,
      artists: [{
        id: "artist-1",
        name: "One",
        genres: ["house"],
        trackCount: 3,
        sampleTracks: ["First"],
      }],
    },
    {
      playlistId: "playlist-b",
      playlistName: "B",
      weight: 1,
      artists: [{
        id: "artist-1",
        name: "One",
        genres: ["electronic"],
        trackCount: 2,
        sampleTracks: ["Second"],
      }, {
        id: "artist-2",
        name: "Two",
        genres: [],
        trackCount: 1,
        sampleTracks: [],
      }],
    },
  ]);

  assert.deepEqual(artists.map((artist) => artist.spotifyArtistId), ["artist-1", "artist-2"]);
  assert.equal(artists[0].playlistDiversity, 3);
  assert.equal(artists[0].weightedTrackCount, 8);
  assert.equal(artists[0].trackCount, 5);
  assert.deepEqual(artists[0].genres, ["electronic", "house"]);
  assert.deepEqual(artists[0].sampleTracks, ["First", "Second"]);
  assert.equal(artists[0].origin, "source");
});

test("hosted seed retains Top Artists that are absent from selected playlists", () => {
  const artists = buildHostedArtistSeed([]);
  mergeHostedTopArtists(artists, [{
    artistId: "top-only",
    artistName: "Top Only",
    shortTermRank: 4,
    mediumTermRank: null,
    longTermRank: null,
  }]);
  assert.equal(artists.length, 1);
  assert.equal(artists[0].origin, "top-items");
  assert.deepEqual(artists[0].discoveryEvidence, [{ type: "spotify-top-items" }]);
  assert.deepEqual(artists[0].topEvidence, {
    shortTermRank: 4,
    mediumTermRank: null,
    longTermRank: null,
  });
});

test("bundled hosted engine preserves cross-source deduplication and ranking", () => {
  const when = new Date("2026-08-01T00:00:00.000Z");
  const base = {
    type: "concert",
    startLocal: "2026-08-15T20:00:00",
    title: "Test Artist Live",
    venue: { name: "The Venue", city: "Los Angeles", lat: 34.05, lon: -118.24 },
    performers: [{ name: "Test Artist", primary: true }],
    ticketObservation: { listingCount: 20, lowestPriceUsd: 40 },
  };
  const seatgeek = { ...base, id: "seatgeek:1", source: "seatgeek", sourceEventId: "1", sourceUrl: "https://example.com/seatgeek" };
  const ticketmaster = { ...base, id: "ticketmaster:1", source: "ticketmaster", sourceEventId: "1", sourceUrl: "https://example.com/ticketmaster" };
  const merged = deduplicateCandidates([seatgeek, ticketmaster]);
  assert.equal(merged.length, 1);
  assert.deepEqual(new Set(merged[0].sourceOccurrences.map((item) => item.source)), new Set(["seatgeek", "ticketmaster"]));
  const ranked = rankCandidates(merged, {
    artists: [{ spotifyArtistId: "artist", name: "Test Artist", seedStrength: 10, evidence: [{ playlistId: "p", trackCount: 3 }] }],
    topItems: { windows: {} },
  }, {
    home: { label: "Los Angeles", lat: 34.0522, lon: -118.2437 },
    pinnedArtists: [],
    excludedArtists: [],
    excludedVenues: [],
    maxTicketPriceUsd: 120,
  }, when);
  assert.equal(ranked[0].matchedArtists[0].name, "Test Artist");
  assert.ok(ranked[0].ranking.utility > 0);
});

test("hosted private configuration is normalized from one secret", () => {
  const previous = process.env.TASTE_ENGINE_CONFIG_JSON;
  process.env.TASTE_ENGINE_CONFIG_JSON = JSON.stringify({
    brief: { home: { lat: 34.05, lon: -118.24 }, pinnedArtists: ["One", "One"] },
    movies: { priorityTheaters: [{ name: "Theater" }] },
    sports: { teamId: 119 },
    personalContext: { background: ["LA"] },
  });
  try {
    const config = readHostedPipelineConfig();
    assert.equal(config.brief.upcomingHorizonDays, 180);
    assert.deepEqual(config.brief.pinnedArtists, ["One"]);
    assert.equal(config.sports.teamName, "Los Angeles Dodgers");
    assert.equal(config.movies.priorityTheaters.length, 1);
  } finally {
    if (previous === undefined) delete process.env.TASTE_ENGINE_CONFIG_JSON;
    else process.env.TASTE_ENGINE_CONFIG_JSON = previous;
  }
});

test("hosted Ollama serializer excludes Spotify evidence and SeatGeek-only identity", () => {
  const source = {
    id: "event-1",
    startLocal: "2026-08-15T20:00:00",
    sourceOccurrences: [{
      source: "seatgeek",
      title: "Private SeatGeek Title",
      venue: { name: "Private SeatGeek Venue", city: "Los Angeles" },
      performerNames: ["Private SeatGeek Artist"],
      url: "https://seatgeek.example/private",
      lowestPriceUsd: 40,
    }],
    matchedArtists: [{
      name: "Spotify Artist",
      spotifyArtistId: "spotify-private-id",
      seedStrength: 99,
      origin: "source",
    }],
    ranking: { artistFit: 80, utility: 70, urgency: "watch", hassleScore: 2 },
  };
  const restricted = buildHostedMusicVector(source, 0);
  const serialized = JSON.stringify(restricted);
  assert.equal(restricted.restrictedSource, true);
  assert.equal(restricted.eventTitle, null);
  assert.equal(restricted.venueName, null);
  assert.doesNotMatch(serialized, /Private SeatGeek|Spotify Artist|spotify-private-id|seatgeek\.example|lowestPriceUsd/);

  const merged = buildHostedMusicVector({
    ...source,
    sourceOccurrences: [
      ...source.sourceOccurrences,
      {
        source: "ticketmaster",
        title: "Allowed Ticketmaster Title",
        venue: { name: "Allowed Venue", city: "Los Angeles" },
        performerNames: ["Allowed Artist"],
      },
    ],
  }, 1);
  assert.equal(merged.restrictedSource, false);
  assert.equal(merged.eventTitle, "Allowed Ticketmaster Title");
  assert.equal(merged.venueName, "Allowed Venue");
});

test("hosted Ollama transport uses reliable JSON mode and carries the validation schema", async () => {
  const prior = {
    key: process.env.OLLAMA_API_KEY,
    model: process.env.OLLAMA_MODEL,
    fetch: globalThis.fetch,
  };
  process.env.OLLAMA_API_KEY = "test-key";
  process.env.OLLAMA_MODEL = "test-model";
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init.body));
    assert.equal(request.format, "json");
    assert.match(request.messages[0].content, /"required":\["ok"\]/);
    return new Response(JSON.stringify({ message: { content: "```json\n{\"ok\":true}\n```" } }), { status: 200 });
  };
  try {
    const output = await runOllamaCloudStructuredPass({
      system: "Return the requested shape.",
      user: { request: "test" },
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    });
    assert.deepEqual(output, { ok: true });
  } finally {
    if (prior.key === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = prior.key;
    if (prior.model === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = prior.model;
    globalThis.fetch = prior.fetch;
  }
});

test("Last.fm parsing is bounded and excludes empty matches", async () => {
  const priorKey = process.env.LASTFM_API_KEY;
  process.env.LASTFM_API_KEY = "test-key";
  try {
    const artists = await getLastfmSimilarArtists("Seed Artist", {
      limit: 99,
      fetchImpl: async (url) => {
        assert.equal(url.searchParams.get("limit"), "20");
        assert.equal(url.searchParams.get("artist"), "Seed Artist");
        return new Response(JSON.stringify({
          similarartists: {
            artist: [
              { name: "Strong Match", match: "1.8" },
              { name: "Weak Match", match: "0.25" },
              { name: "", match: "0.9" },
              { name: "No Match", match: "bad" },
            ],
          },
        }), { status: 200 });
      },
    });
    assert.deepEqual(artists, [
      { name: "Strong Match", match: 1, sourceArtist: "Seed Artist" },
      { name: "Weak Match", match: 0.25, sourceArtist: "Seed Artist" },
    ]);
  } finally {
    if (priorKey === undefined) delete process.env.LASTFM_API_KEY;
    else process.env.LASTFM_API_KEY = priorKey;
  }
});

test("Last.fm remains independently optional", async () => {
  const priorKey = process.env.LASTFM_API_KEY;
  delete process.env.LASTFM_API_KEY;
  try {
    await assert.rejects(
      getLastfmSimilarArtists("Seed Artist"),
      LastfmNotConfiguredError,
    );
  } finally {
    if (priorKey !== undefined) process.env.LASTFM_API_KEY = priorKey;
  }
});
