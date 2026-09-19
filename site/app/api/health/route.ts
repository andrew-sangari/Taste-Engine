import { getD1 } from "../../../db/index.ts";
import { releaseMetadata } from "../../../server/release.ts";
import { spotifyTokenEncryptionStatus } from "../../../server/token-crypto.ts";
import { readHostedPipelineConfig } from "../../../server/hosted-config.ts";
import type { ProfileScope } from "../../../server/profiles.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const databaseState = await databaseReadiness();
  const release = releaseMetadata();
  const configuration = configurationReadiness(databaseState.profiles, release.releasable);
  const status = databaseState.public.ready && configuration.ready ? "ready" : "degraded";
  return Response.json({
    status,
    release,
    database: databaseState.public,
    configuration,
  }, {
    status: status === "ready" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}

async function databaseReadiness(): Promise<{
  public: { ready: boolean; profileCount: number | null; activeProjectionCount: number | null };
  profiles: ProfileScope[];
}> {
  try {
    const db = getD1();
    const profileRows = await db.prepare(`
      SELECT profile_id, owner_email, display_name, legacy_default
      FROM profiles
      WHERE enabled = 1
      ORDER BY profile_id
    `).all<{
      profile_id: string;
      owner_email: string;
      display_name: string;
      legacy_default: number;
    }>();
    const row = await db.prepare(`
      SELECT count(*) AS active_projection_count
      FROM recommendation_snapshots
      WHERE profile_id IS NOT NULL AND active = 1
    `).first<{ active_projection_count: number }>();
    const profiles = (profileRows.results ?? []).map((profile) => ({
      id: profile.profile_id,
      email: profile.owner_email,
      displayName: profile.display_name,
      legacyDefault: Boolean(profile.legacy_default),
    }));
    return {
      public: {
        ready: true,
        profileCount: profiles.length,
        activeProjectionCount: Number(row?.active_projection_count ?? 0),
      },
      profiles,
    };
  } catch {
    return {
      public: { ready: false, profileCount: null, activeProjectionCount: null },
      profiles: [],
    };
  }
}

function configurationReadiness(profiles: ProfileScope[], releasable: boolean) {
  const spotifyClient = Boolean(process.env.SPOTIFY_CLIENT_ID);
  const refreshSecret = (process.env.TASTE_REFRESH_SECRET?.length ?? 0) >= 24;
  const trustedProfiles = trustedProfileConfigurationReady(profiles);
  const legacyProfile = legacyProfileConfigurationReady(profiles);
  const profileConfig = hostedProfileConfigurationReady(profiles);
  const spotifyTokenEncryption = spotifyTokenEncryptionStatus();
  const ready = process.env.TASTE_ENGINE_ENV === "production"
    && releasable
    && spotifyClient
    && refreshSecret
    && trustedProfiles
    && legacyProfile
    && profileConfig
    && spotifyTokenEncryption === "configured";
  return {
    ready,
    spotifyClient,
    refreshSecret,
    trustedProfiles,
    legacyProfile,
    profileConfig,
    sourceRelease: releasable,
    spotifyTokenEncryption,
  };
}

function hostedProfileConfigurationReady(profiles: ProfileScope[]): boolean {
  try {
    if (!profiles.length) {
      readHostedPipelineConfig();
      return true;
    }
    for (const profile of profiles) readHostedPipelineConfig(profile);
    return true;
  } catch {
    return false;
  }
}

function trustedProfileConfigurationReady(profiles: ProfileScope[]): boolean {
  const allowed = new Set(String(process.env.TASTE_ALLOWED_PROFILE_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
  return allowed.size > 0 && profiles.every((profile) => allowed.has(profile.email.trim().toLowerCase()));
}

function legacyProfileConfigurationReady(profiles: ProfileScope[]): boolean {
  const configured = String(process.env.TASTE_LEGACY_PROFILE_EMAIL ?? "").trim().toLowerCase();
  if (!configured) return false;
  const legacyProfiles = profiles.filter((profile) => profile.legacyDefault);
  return legacyProfiles.length === 0
    ? true
    : legacyProfiles.length === 1 && legacyProfiles[0].email.trim().toLowerCase() === configured;
}
