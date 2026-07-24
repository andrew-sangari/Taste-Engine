import productionProjection from "./upcoming.json";
import fullQaProjection from "../../tests/fixtures/qa-projection.json";
import emptyQaProjection from "../../tests/fixtures/qa-empty-plan-ahead.json";
import { readActiveProjection } from "../../server/persistence";

export async function loadProjection() {
  switch (process.env.TASTE_ENGINE_QA_FIXTURE) {
    case "full":
      return fullQaProjection;
    case "empty":
      return emptyQaProjection;
    default: {
      try {
        const hostedProjection = await readActiveProjection();
        return hostedProjection && isProjection(hostedProjection)
          ? hostedProjection as typeof productionProjection
          : productionProjection;
      } catch {
        // Local builds and a newly provisioned database intentionally fall
        // back to the last validated bundled snapshot.
        return productionProjection;
      }
    }
  }
}

function isProjection(value: unknown): value is typeof productionProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return typeof input.generatedAt === "string" && Array.isArray(input.events);
}
