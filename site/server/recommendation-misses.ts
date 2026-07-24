import { getD1 } from "../db";

export const MISS_CLASSIFICATIONS = [
  "retrieval",
  "normalization",
  "matching",
  "deduplication",
  "ranking",
  "absent-taste-signal",
  "resolved",
] as const;

export type MissClassification = (typeof MISS_CLASSIFICATIONS)[number];

export async function createRecommendationMiss(ownerEmail: string, input: unknown) {
  const value = record(input);
  const eventUrl = optionalUrl(value.eventUrl);
  const eventDetails = optionalText(value.eventDetails, 2_000);
  if (!eventUrl && !eventDetails) throw new RecommendationMissInputError("Add an event URL or a short description.");
  const missId = `miss-${crypto.randomUUID()}`;
  const submittedAt = new Date().toISOString();
  await getD1().prepare(`
    INSERT INTO recommendation_misses
      (miss_id, owner_email, event_url, event_details, submitted_at, resolution_stage)
    VALUES (?1, ?2, ?3, ?4, ?5, 'untriaged')
  `).bind(missId, ownerEmail, eventUrl, eventDetails, submittedAt).run();
  return { missId, submittedAt };
}

export async function classifyRecommendationMiss(ownerEmail: string, input: unknown) {
  const value = record(input);
  const missId = requiredText(value.missId, 200, "Miss id");
  const classification = String(value.classification ?? "");
  if (!(MISS_CLASSIFICATIONS as readonly string[]).includes(classification)) {
    throw new RecommendationMissInputError("Choose a supported review classification.");
  }
  const resolutionNote = optionalText(value.resolutionNote, 2_000);
  const resolvedAt = classification === "resolved" ? new Date().toISOString() : null;
  const result = await getD1().prepare(`
    UPDATE recommendation_misses
    SET resolution_stage = ?1, resolution_note = ?2, resolved_at = ?3
    WHERE miss_id = ?4 AND owner_email = ?5
  `).bind(classification, resolutionNote, resolvedAt, missId, ownerEmail).run();
  if (!result.meta.changes) throw new RecommendationMissInputError("That miss was not found for this owner.");
  return { missId, classification, resolvedAt };
}

// This is deliberately a review queue, not an adapter trigger. Three owner
// submissions from the same host in 90 days merely create an evidence-backed
// source-review candidate for a human to inspect.
export async function sourceReviewCandidates(ownerEmail: string, now = new Date()) {
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const result = await getD1().prepare(`
    SELECT event_url, submitted_at
    FROM recommendation_misses
    WHERE owner_email = ?1
      AND submitted_at >= ?2
      AND resolution_stage = 'retrieval'
      AND event_url IS NOT NULL
    ORDER BY submitted_at DESC
  `).bind(ownerEmail, since).all<{ event_url: string; submitted_at: string }>();
  const groups = new Map<string, Array<{ eventUrl: string; submittedAt: string }>>();
  for (const row of result.results ?? []) {
    const host = sourceHost(row.event_url);
    if (!host) continue;
    groups.set(host, [...(groups.get(host) ?? []), { eventUrl: row.event_url, submittedAt: row.submitted_at }]);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.length >= 3)
    .map(([host, entries]) => ({ host, count: entries.length, supportingUrls: entries.map((entry) => entry.eventUrl).slice(0, 10) }))
    .sort((left, right) => right.count - left.count || left.host.localeCompare(right.host));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalText(value: unknown, limit: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new RecommendationMissInputError("Event details must be plain text.");
  const normalized = value.trim();
  if (!normalized || normalized.length > limit) throw new RecommendationMissInputError(`Event details must be at most ${limit} characters.`);
  return normalized;
}

function requiredText(value: unknown, limit: number, label: string): string {
  const text = optionalText(value, limit);
  if (!text) throw new RecommendationMissInputError(`${label} is required.`);
  return text;
}

function optionalUrl(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2_000) throw new RecommendationMissInputError("Event URL must be a valid http(s) URL.");
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("unsupported protocol");
    return url.toString();
  } catch {
    throw new RecommendationMissInputError("Event URL must be a valid http(s) URL.");
  }
}

function sourceHost(value: string): string | null {
  try { return new URL(value).hostname.toLowerCase(); }
  catch { return null; }
}

export class RecommendationMissInputError extends Error {}
