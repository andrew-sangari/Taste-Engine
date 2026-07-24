import { getD1 } from "../db";
import {
  buildHostedArtistSeed,
  mergeHostedTopArtists,
  seedStrength,
  type DirectArtist,
  type HostedPlaylistEvidence,
} from "./hosted-refresh-contract";
import { buildHostedProjection } from "./hosted-projection";
import { readActiveProjection, readFeedbackRecords } from "./persistence";
import {
  getSpotifyPlaylistArtists,
  readPlaylistSelections,
  refreshSpotifyTopArtists,
  SpotifyHttpError,
} from "./spotify";

const LOCK_NAME = "hosted-refresh";
const LOCK_TTL_MS = 45 * 60 * 1000;

type SourceHealth = {
  source: string;
  status: "active" | "partial" | "unavailable" | "not configured";
  itemCount: number;
  warningCount: number;
  details?: Record<string, unknown>;
};

export type HostedRefreshSummary = {
  runId: string;
  status: "completed" | "partial" | "blocked";
  startedAt: string;
  completedAt: string;
  tasteSnapshotId: string | null;
  sourceHealth: SourceHealth[];
  directArtistCount: number;
  expandedArtistCount: number;
  projectionPublished: boolean;
  publicationBlockers: string[];
};

export async function runHostedRefresh(requestedOwnerEmail?: string): Promise<HostedRefreshSummary> {
  const runId = `refresh-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await acquireRefreshLock(runId);

  try {
    await getD1().prepare(`
      INSERT INTO source_runs (run_id, status, started_at)
      VALUES (?1, 'running', ?2)
    `).bind(runId, startedAt).run();

    const ownerEmail = requestedOwnerEmail ?? await singleSpotifyOwner();
    if (!ownerEmail) {
      return finishRun({
        runId,
        startedAt,
        status: "blocked",
        tasteSnapshotId: null,
        sourceHealth: [
          health("spotify-playlists", "unavailable", 0, 1),
          health("spotify-top-artists", "unavailable", 0, 1),
          health("lastfm", process.env.LASTFM_API_KEY ? "unavailable" : "not configured", 0, process.env.LASTFM_API_KEY ? 1 : 0),
        ],
        directArtistCount: 0,
        expandedArtistCount: 0,
        projectionPublished: false,
        publicationBlockers: ["Connect Spotify from the Taste tab before running the hosted refresh."],
      });
    }

    const selections = (await readPlaylistSelections(ownerEmail))
      .filter((playlist: { enabled: boolean }) => playlist.enabled);
    if (!selections.length) {
      return finishRun({
        runId,
        startedAt,
        status: "blocked",
        tasteSnapshotId: null,
        sourceHealth: [
          health("spotify-playlists", "unavailable", 0, 1),
          health("spotify-top-artists", "unavailable", 0, 0),
          health("lastfm", process.env.LASTFM_API_KEY ? "unavailable" : "not configured", 0, process.env.LASTFM_API_KEY ? 1 : 0),
        ],
        directArtistCount: 0,
        expandedArtistCount: 0,
        projectionPublished: false,
        publicationBlockers: ["Select at least one Spotify playlist from the Taste tab."],
      });
    }

    const sourceHealth: SourceHealth[] = [];
    const warnings: string[] = [];
    const directArtists = await buildDirectArtistSeed(ownerEmail, selections, warnings);
    const directArtistCount = directArtists.length;
    if (!directArtistCount && !warnings.length) {
      warnings.push("Selected Spotify playlists yielded no artist evidence.");
    }
    sourceHealth.push(health(
      "spotify-playlists",
      warnings.length || !directArtistCount ? "partial" : "active",
      directArtistCount,
      warnings.length,
      { selectedPlaylists: selections.length },
    ));

    let topArtists: Awaited<ReturnType<typeof refreshSpotifyTopArtists>> | null = null;
    try {
      topArtists = await refreshSpotifyTopArtists(ownerEmail, 50);
      mergeHostedTopArtists(directArtists, topArtists.artists);
      sourceHealth.push(health(
        "spotify-top-artists",
        topArtists.status === "active" ? "active" : "partial",
        topArtists.artists.length,
        topArtists.warnings.length,
        topArtistHealthDetails(topArtists.windows),
      ));
    } catch (error) {
      sourceHealth.push(health("spotify-top-artists", "unavailable", 0, 1));
      warnings.push(safeWarning("Spotify Top Artists", error));
    }

    if (!directArtists.length) {
      return finishRun({
        runId,
        startedAt,
        status: "blocked",
        tasteSnapshotId: null,
        sourceHealth: [
          ...sourceHealth,
          health("lastfm", process.env.LASTFM_API_KEY ? "unavailable" : "not configured", 0, process.env.LASTFM_API_KEY ? 1 : 0),
        ],
        directArtistCount: 0,
        expandedArtistCount: 0,
        projectionPublished: false,
        publicationBlockers: ["Spotify yielded no artist evidence; the previous hosted taste snapshot was preserved."],
      });
    }

    const generatedAt = new Date();
    const sourceSnapshot = {
      version: 2,
      generatedAt: generatedAt.toISOString(),
      source: "hosted-spotify",
      playlistCount: selections.length,
      sourceArtistCount: directArtistCount,
      topArtistCount: topArtists?.artists.length ?? 0,
      artistCount: directArtists.length,
      artists: directArtists.map(serializeDirectArtist),
      topItems: topArtists ? {
        status: topArtists.status,
        generatedAt: topArtists.generatedAt,
        windows: topArtists.windows,
        warnings: topArtists.warnings,
      } : {
        status: "unavailable",
        generatedAt: null,
        windows: {},
        warnings: ["Spotify Top Artists unavailable."],
      },
      warnings,
    };
    const previousProjection = await readActiveProjection();
    const feedbackRecords = await readFeedbackRecords(ownerEmail);
    const hosted = await buildHostedProjection({
      sourceSnapshot,
      initialSourceHealth: sourceHealth,
      previousProjection: previousProjection && typeof previousProjection === "object"
        ? previousProjection as Record<string, unknown>
        : null,
      feedbackRecords,
      generatedAt,
    });
    if (hosted.publicationBlockers.length) {
      return finishRun({
        runId,
        startedAt,
        status: "blocked",
        tasteSnapshotId: null,
        sourceHealth: hosted.sourceHealth,
        directArtistCount,
        expandedArtistCount: Number(hosted.artistSnapshot.artistCount ?? 0),
        projectionPublished: false,
        publicationBlockers: hosted.publicationBlockers,
      });
    }
    const published = await publishHostedState({
      ownerEmail,
      ownerRef: await ownerReference(ownerEmail),
      generatedAt: generatedAt.toISOString(),
      artistSnapshot: hosted.artistSnapshot,
      projection: hosted.projection,
      sourceHealth: hosted.sourceHealth,
    });

    return finishRun({
      runId,
      startedAt,
      status: hosted.sourceHealth.some((source) => source.status === "unavailable" || source.status === "partial") ? "partial" : "completed",
      tasteSnapshotId: published.tasteSnapshotId,
      sourceHealth: hosted.sourceHealth,
      directArtistCount,
      expandedArtistCount: Number(hosted.artistSnapshot.artistCount ?? 0),
      projectionPublished: true,
      publicationBlockers: [],
    });
  } catch (error) {
    const completedAt = new Date().toISOString();
    await getD1().prepare(`
      UPDATE source_runs
      SET status = 'failed', completed_at = ?2, error_summary = ?3
      WHERE run_id = ?1
    `).bind(runId, completedAt, safeWarning("Hosted refresh", error)).run();
    throw error;
  } finally {
    await releaseRefreshLock(runId);
  }
}

async function buildDirectArtistSeed(
  ownerEmail: string,
  selections: Awaited<ReturnType<typeof readPlaylistSelections>>,
  warnings: string[],
): Promise<DirectArtist[]> {
  const evidence: HostedPlaylistEvidence[] = [];
  for (const playlist of selections) {
    try {
      const playlistArtists = await getSpotifyPlaylistArtists(ownerEmail, playlist.id, 250);
      evidence.push({
        playlistId: playlist.id,
        playlistName: playlist.name,
        weight: playlist.weight,
        artists: playlistArtists.map((artist) => ({
          id: artist.id,
          name: artist.name,
          genres: artist.genres,
          trackCount: artist.trackCount,
          sampleTracks: artist.sampleTracks,
        })),
      });
    } catch (error) {
      warnings.push(safeWarning(`Spotify playlist ${playlist.id}`, error));
    }
  }
  return buildHostedArtistSeed(evidence);
}

async function publishHostedState({
  ownerEmail,
  ownerRef,
  generatedAt,
  artistSnapshot,
  projection,
  sourceHealth,
}: {
  ownerEmail: string;
  ownerRef: string;
  generatedAt: string;
  artistSnapshot: Record<string, unknown>;
  projection: Record<string, unknown>;
  sourceHealth: SourceHealth[];
}): Promise<{ tasteSnapshotId: string; projectionSnapshotId: string }> {
  const tastePayload = JSON.stringify({
    version: 2,
    generatedAt,
    ownerRef,
    ...artistSnapshot,
    sourceHealth,
  });
  const projectionPayload = JSON.stringify(projection);
  const tasteSnapshotId = `hosted-taste-${(await sha256Hex(tastePayload)).slice(0, 24)}`;
  const projectionHash = await sha256Hex(projectionPayload);
  const projectionSnapshotId = `projection-${projectionHash.slice(0, 24)}`;
  const createdAt = new Date().toISOString();
  const status = sourceHealth.some((source) => source.status !== "active") ? "partial" : "active";
  const db = getD1();
  await db.batch([
    db.prepare("UPDATE hosted_taste_snapshots SET active = 0 WHERE owner_email = ?1 AND active = 1").bind(ownerEmail),
    db.prepare(`
      INSERT INTO hosted_taste_snapshots
        (snapshot_id, owner_email, generated_at, status, payload_json, active)
      VALUES (?1, ?2, ?3, ?4, ?5, 1)
      ON CONFLICT(snapshot_id) DO UPDATE SET
        generated_at = excluded.generated_at,
        status = excluded.status,
        payload_json = excluded.payload_json,
        active = 1
    `).bind(tasteSnapshotId, ownerEmail, generatedAt, status, tastePayload),
    db.prepare("UPDATE recommendation_snapshots SET active = 0 WHERE active = 1"),
    db.prepare(`
      INSERT INTO recommendation_snapshots
        (snapshot_id, generated_at, payload_json, payload_hash, created_at, active)
      VALUES (?1, ?2, ?3, ?4, ?5, 1)
      ON CONFLICT(snapshot_id) DO UPDATE SET
        generated_at = excluded.generated_at,
        payload_json = excluded.payload_json,
        payload_hash = excluded.payload_hash,
        created_at = excluded.created_at,
        active = 1
    `).bind(
      projectionSnapshotId,
      generatedAt,
      projectionPayload,
      projectionHash,
      createdAt,
    ),
  ]);
  return { tasteSnapshotId, projectionSnapshotId };
}

async function finishRun(
  input: Omit<HostedRefreshSummary, "completedAt">,
): Promise<HostedRefreshSummary> {
  const completedAt = new Date().toISOString();
  const summary = { ...input, completedAt };
  await getD1().prepare(`
    UPDATE source_runs
    SET status = ?2, completed_at = ?3, source_health_json = ?4, error_summary = ?5
    WHERE run_id = ?1
  `).bind(
    input.runId,
    input.status,
    completedAt,
    JSON.stringify(input.sourceHealth),
    input.publicationBlockers.length ? input.publicationBlockers.join(" ") : null,
  ).run();
  return summary;
}

async function acquireRefreshLock(runId: string): Promise<void> {
  const now = Date.now();
  const result = await getD1().prepare(`
    INSERT INTO refresh_locks (lock_name, run_id, expires_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(lock_name) DO UPDATE SET
      run_id = excluded.run_id,
      expires_at = excluded.expires_at
    WHERE refresh_locks.expires_at < ?4
  `).bind(LOCK_NAME, runId, now + LOCK_TTL_MS, now).run();
  if (!result.meta.changes) throw new HostedRefreshConflictError();
}

async function releaseRefreshLock(runId: string): Promise<void> {
  await getD1().prepare("DELETE FROM refresh_locks WHERE lock_name = ?1 AND run_id = ?2")
    .bind(LOCK_NAME, runId)
    .run();
}

async function singleSpotifyOwner(): Promise<string | null> {
  const result = await getD1().prepare(`
    SELECT owner_email
    FROM spotify_tokens
    ORDER BY updated_at DESC
    LIMIT 2
  `).all<{ owner_email: string }>();
  const owners = result.results ?? [];
  if (owners.length > 1) throw new Error("Hosted refresh requires an explicit owner when multiple Spotify users are connected.");
  return owners[0]?.owner_email ?? null;
}

function serializeDirectArtist(artist: DirectArtist) {
  return {
    spotifyArtistId: artist.spotifyArtistId,
    name: artist.name,
    seedStrength: round(seedStrength(artist), 4),
    playlistDiversity: artist.playlistDiversity,
    trackCount: artist.trackCount,
    genres: artist.genres,
    sampleTracks: artist.sampleTracks,
    evidence: artist.evidence,
    origin: artist.origin ?? "source",
    discoveryEvidence: artist.discoveryEvidence ?? [],
    ...(artist.topEvidence ? { topEvidence: artist.topEvidence } : {}),
  };
}

function health(
  source: string,
  status: SourceHealth["status"],
  itemCount: number,
  warningCount: number,
  details?: SourceHealth["details"],
): SourceHealth {
  return { source, status, itemCount, warningCount, ...(details ? { details } : {}) };
}

function topArtistHealthDetails(windows: unknown): Record<string, unknown> {
  const input = windows && typeof windows === "object" ? windows as Record<string, unknown> : {};
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const window = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const status = String(window.status ?? "unavailable");
    summary[key] = status === "active" || status === "fresh" ? "fresh" : status === "cached" ? "cached" : "unavailable";
  }
  return summary;
}

function safeWarning(label: string, error: unknown): string {
  if (error instanceof SpotifyHttpError) return `${label} unavailable (${error.status}).`;
  if (error instanceof Error && error.name === "TimeoutError") return `${label} timed out.`;
  return `${label} unavailable.`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ownerReference(ownerEmail: string): Promise<string> {
  return (await sha256Hex(ownerEmail.toLowerCase())).slice(0, 20);
}

export class HostedRefreshConflictError extends Error {
  constructor() {
    super("A hosted refresh is already running.");
  }
}
