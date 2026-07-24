import { normalizeArtistName } from "./deterministic-engine.js";

// A source-safe hosted equivalent of src/tasteProfile.js. It remains local to
// the Worker so the projection never needs raw Spotify evidence.
export function buildHostedTasteProfile(snapshot: Record<string, unknown>, feedback: Record<string, unknown> | null = null) {
  const artists = Array.isArray(snapshot.artists) ? snapshot.artists as Array<Record<string, unknown>> : [];
  const maxSeed = Math.max(0, ...artists.map((artist) => finite(artist.seedStrength)));
  const now = new Date(String(snapshot.generatedAt ?? Date.now()));
  const signals = artists.map((artist) => ({ artist, score: contribution(artist, maxSeed, record(snapshot.topItems), now) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || normalizeArtistName(left.artist.name).localeCompare(normalizeArtistName(right.artist.name)));
  const maxScore = Math.max(1, ...signals.map((row) => row.score));
  const origins: Record<string, number> = {};
  for (const artist of artists) {
    const origin = publicOrigin(artist.origin);
    origins[origin] = (origins[origin] ?? 0) + 1;
  }
  return {
    generatedAt: String(snapshot.generatedAt ?? ""),
    seedSummary: {
      playlistCount: count(snapshot.playlistCount), sourceArtistCount: count(snapshot.sourceArtistCount),
      topArtistCount: count(snapshot.topArtistCount), artistCount: count(snapshot.artistCount),
    },
    topArtists: signals.slice(0, 12).map(({ artist, score }) => ({
      name: String(artist.name ?? ""), relativeSignal: Math.round(score / maxScore * 100), signalContribution: Math.round(score),
      playlistDiversity: count(artist.playlistDiversity), seedTrackCount: count(artist.trackCount),
      origin: publicOrigin(artist.origin), signalKind: direct(artist.origin) ? "direct" : "inferred", labels: labels(artist),
    })),
    topTags: Array.isArray(snapshot.topTags) ? snapshot.topTags.slice(0, 8).map(String) : [],
    expansionByOrigin: origins,
    feedback,
  };
}

function contribution(artist: Record<string, unknown>, maxSeed: number, topItems: Record<string, unknown>, now: Date) {
  const playlist = maxSeed ? finite(artist.seedStrength) / maxSeed * 60 : 0;
  const top = topContribution(record(artist.topEvidence), topItems, now);
  return direct(artist.origin) ? Math.max(playlist, top) : Math.max(playlist * .55, top);
}
function topContribution(evidence: Record<string, unknown>, topItems: Record<string, unknown>, now: Date) {
  const windows = [["shortTerm", .4, evidence.shortTermRank], ["mediumTerm", .35, evidence.mediumTermRank], ["longTerm", .25, evidence.longTermRank]]
    .filter(([key]) => usable(record(record(topItems.windows)[String(key)]), now));
  const total = windows.reduce((sum, [, weight]) => sum + Number(weight), 0);
  return total ? windows.reduce((sum, [, weight, rank]) => sum + Number(weight) * rankScore(rank), 0) / total : 0;
}
function usable(window: Record<string, unknown>, now: Date) { const status = String(window.status ?? ""); const expiry = window.expiresAt ? Date.parse(String(window.expiresAt)) : Infinity; return ["fresh", "cached", "active", "partial"].includes(status) && expiry > now.getTime(); }
function rankScore(value: unknown) { const rank = Number(value); return Number.isInteger(rank) && rank > 0 && rank <= 50 ? 60 * (51 - rank) / 50 : 0; }
function direct(origin: unknown) { return !["similar", "tag", "promoter"].includes(String(origin)); }
function publicOrigin(origin: unknown) { return ["source", "similar", "tag", "promoter", "top-items"].includes(String(origin)) ? String(origin) : "source"; }
function labels(artist: Record<string, unknown>) { const output: string[] = []; const top = record(artist.topEvidence); if (Number(top.shortTermRank) <= 10) output.push("Current top artist"); if (Number(top.mediumTermRank) <= 25 && Number(top.longTermRank) <= 25) output.push("Sustained favorite"); if (count(artist.playlistDiversity) >= 2) output.push("Playlist anchor"); if (["similar", "tag", "promoter"].includes(String(artist.origin))) output.push("Adjacent discovery"); if (!output.length && artist.origin === "top-items") output.push("Spotify Top Artist"); return output; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function finite(value: unknown) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
function count(value: unknown) { return Math.round(finite(value)); }
