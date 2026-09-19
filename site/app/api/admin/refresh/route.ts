import { runHostedRefresh, HostedRefreshConflictError } from "../../../../server/hosted-refresh";
import { hasRefreshAuthorization } from "../../../../server/persistence";
import { listConnectedProfiles, ProfileAccessError, readProfile, type ProfileScope } from "../../../../server/profiles";
import { releasePublicationReady } from "../../../../server/release";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasRefreshAuthorization(request)) {
    return Response.json({ error: "Unauthorized." }, {
      status: 401,
      headers: { "www-authenticate": "Bearer", "cache-control": "no-store" },
    });
  }
  if (!releasePublicationReady()) {
    return Response.json({ error: "This source artifact is not eligible to publish." }, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }
  const body = await request.json().catch(() => ({})) as { profileId?: unknown };
  const requestedProfileId = String(body.profileId ?? "").trim();
  let profiles: ProfileScope[];
  try {
    profiles = requestedProfileId
      ? [await readProfile(requestedProfileId)].filter((profile) => profile != null)
      : await listConnectedProfiles();
  } catch (error) {
    if (error instanceof ProfileAccessError) {
      return Response.json({ error: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
  if (!profiles.length) {
    return Response.json({
      status: "blocked",
      projectionPublished: false,
      publicationBlockers: [requestedProfileId ? "The requested profile was not found." : "No enabled Spotify profiles are connected."],
      profiles: [],
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  const summaries: Array<Awaited<ReturnType<typeof runHostedRefresh>>> = [];
  let retryableConflict = false;
  for (const profile of profiles) {
    try {
      summaries.push(await runHostedRefresh(profile));
    } catch (error) {
      retryableConflict ||= error instanceof HostedRefreshConflictError;
      const failedAt = new Date().toISOString();
      summaries.push({
        profileId: profile.id,
        runId: `failed-${crypto.randomUUID()}`,
        status: "blocked",
        startedAt: failedAt,
        completedAt: failedAt,
        tasteSnapshotId: null,
        sourceHealth: [],
        directArtistCount: 0,
        expandedArtistCount: 0,
        projectionPublished: false,
        publicationBlockers: [error instanceof HostedRefreshConflictError
          ? "A refresh is already running; the previous projection was preserved."
          : "This profile refresh failed; the previous projection was preserved."],
      });
    }
  }
  const publishedProfileCount = summaries.filter((summary) => summary.projectionPublished).length;
  const projectionPublished = publishedProfileCount === summaries.length;
  const partialSuccess = publishedProfileCount > 0 && !projectionPublished;
  const publicationBlockers = summaries.flatMap((summary) => summary.publicationBlockers.map((message) => `${summary.profileId}: ${message}`));
  return Response.json({
    status: projectionPublished
      ? (summaries.some((summary) => summary.status === "partial") ? "partial" : "completed")
      : partialSuccess ? "partial" : "blocked",
    projectionPublished,
    publishedProfileCount,
    failedProfileCount: summaries.length - publishedProfileCount,
    retryable: retryableConflict && publishedProfileCount === 0,
    publicationBlockers,
    profiles: summaries,
  }, {
    status: retryableConflict && publishedProfileCount === 0 ? 409 : 200,
    headers: {
      "cache-control": "no-store",
      ...(retryableConflict ? { "retry-after": "60" } : {}),
    },
  });
}
