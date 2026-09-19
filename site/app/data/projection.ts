import productionProjection from "./upcoming.json" with { type: "json" };
import fullQaProjection from "../../tests/fixtures/qa-projection.json" with { type: "json" };
import emptyQaProjection from "../../tests/fixtures/qa-empty-plan-ahead.json" with { type: "json" };
import { readActiveProjection } from "../../server/persistence.ts";
import { deploymentEnvironment } from "../../server/release.ts";

export async function loadProjection(profile?: { id: string; allowBundledFallback: boolean } | null) {
  const fixture = ["local", "test"].includes(deploymentEnvironment())
    ? process.env.TASTE_ENGINE_QA_FIXTURE
    : undefined;
  switch (fixture) {
    case "full":
      return fullQaProjection;
    case "empty":
      return emptyQaProjection;
    default: {
      try {
        if (!profile) return productionProjection;
        const hostedProjection = await readActiveProjection(profile.id);
        if (hostedProjection && isProjection(hostedProjection)) return hostedProjection as typeof productionProjection;
        // A successful D1 read with no active projection is meaningful (for
        // example after Spotify disconnect) and must not resurrect the bundle.
        return null;
      } catch {
        // Local builds and a newly provisioned database intentionally fall
        // back to the last validated bundled snapshot.
        return !profile || profile.allowBundledFallback ? productionProjection : null;
      }
    }
  }
}

function isProjection(value: unknown): value is typeof productionProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return typeof input.generatedAt === "string" && Array.isArray(input.events);
}
