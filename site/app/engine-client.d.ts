import type { FeedbackKeys, SiteFeedbackImportRecord } from "./feedback-store";
import type { OverviewItem } from "./overview-explorer";

export type FeedbackSignals = { policyVersion: number; taste: Map<string, unknown>; friction: Map<string, unknown>; countedRecords: number };
export type LearnedSignal = { kind: "taste" | "friction"; category: string; label: string; direction: "up" | "down"; strength: number; delta: number; outcomes: number; lastDate: string | null };
export type FeedbackReview = {
  policyVersion: number;
  countedOutcomeCount: number;
  learned: LearnedSignal[];
  candidateCount: number;
  adjustedCandidateCount: number;
  largestAdjustment: number;
  maxTotalAdjustment: number;
  movements: Array<{ id: string; vertical: string; title: string; scoreDelta: number; scoreBefore: number; scoreAfter: number; rankBefore: number | null; rankAfter: number | null; reasons: Array<{ label: string; category: string; delta: number }> }>;
  shortlist: { current: { added: string[]; removed: string[] }; planAhead: { added: string[]; removed: string[] } };
  shortlistChanged: boolean;
  digest: string;
};

export const FEEDBACK_POLICY: { version: number; maxTotalAdjustment: number; maxFriction: number };
export function deriveFeedbackSignals(records: SiteFeedbackImportRecord[], options?: { now?: Date | string }): FeedbackSignals;
export function applyFeedbackOverlay<T>(rows: T[], vertical: "music" | "sports", signals: FeedbackSignals): { rows: T[]; audit: { adjustedCount: number; totalAbsoluteAdjustment: number } };
export function describeLearning(signals: FeedbackSignals, options?: { limit?: number }): LearnedSignal[];
export function feedbackKeysFor(item: unknown, vertical?: "music" | "sports"): FeedbackKeys;
export function buildFeedbackReview(input: { projection: { events: unknown[]; sports: unknown[]; generatedAt?: string; horizon?: { days: number } }; records: SiteFeedbackImportRecord[]; now?: Date | string; currentMinScore?: number; planAheadMinScore?: number }): FeedbackReview;
export function buildOverviewBuckets(events: unknown[], sports: unknown[], options?: { now?: Date | string; currentDays?: number; currentMinScore?: number; planAheadMinScore?: number; planAheadLimit?: number; horizonDays?: number | null }): { current: OverviewItem[]; planAhead: OverviewItem[] };

// Decision plans (src/decisionPlan.js)
export type PlanConstraintsInput = { windowDays: number; nightsPerWeek: number; budgetUsd: number | null; avoidBackToBack: boolean; includeTrips: boolean };
export type PlanCandidate = {
  id: string; vertical: "music" | "sports"; league?: string | null; title: string; startLocal: string; days: string[];
  score: number; hassle: number; priceUsd: number | null; venue: string | null; tier: string | null; isTrip: boolean; isNew: boolean;
};
export type PlanPick = PlanCandidate & { pinned: boolean; why: string };
export type DecisionPlan = {
  lens: "best" | "easy" | "mix"; label: string; tagline: string; alsoLenses: string[]; picks: PlanPick[];
  totals: { score: number; value: number; nights: number; knownCostUsd: number; unpricedCount: number; hassle: number; averageHassle: number; verticals: { music: number; sports: number }; newCount: number };
  gaveUp: Array<{ id: string; title: string; startLocal: string; score: number; reason: { kind: string; withId?: string; text: string } }>;
  versusBest: { score: number; knownCostUsd: number; hassle: number; nights: number } | null;
  exact: boolean;
};
export type DecisionPlanResult = {
  policyVersion: number; window: { startDate: string; endDate: string; days: number }; constraints: PlanConstraintsInput;
  consideredCount: number; worthwhileCount: number; pinned: string[]; pinnedConflicts: Array<{ ids: string[]; day: string }>;
  plans: DecisionPlan[]; empty: boolean;
};
export const DEFAULT_PLAN_CONSTRAINTS: PlanConstraintsInput;
export const PLAN_POLICY: { version: number };
export function normalizePlanConstraints(input: unknown): PlanConstraintsInput;
export function planCandidates(input: { events: unknown[]; sports: unknown[]; now: string | Date; windowDays: number }): PlanCandidate[];
export function buildDecisionPlans(input: { candidates: PlanCandidate[]; constraints: PlanConstraintsInput; pinnedIds?: string[]; excludedIds?: string[]; now: string | Date }): DecisionPlanResult;

// Evidence graph (src/evidenceGraph.js)
export type EvidenceGraph = { policyVersion: number; nodes: Array<{ id: string; kind: string; label: string; relation?: string }>; edges: Array<{ from: string; to: string; kind: string; weight: number; evidence?: string }>; index: unknown };
export type ConnectionPath = { strength: number; kind: string; hops: Array<{ nodeId: string; label: string; nodeKind: string; via: string | null }>; text: string };
export type Scene = {
  id: string; label: string; basis: string; artists: Array<{ name: string; relation: string; known?: boolean }>;
  events: Array<{ id: string; title: string; startLocal: string; score: number }>; venues: string[]; promoters: string[];
  bridges: Array<{ from: string; to: string; via: string; strength?: number }>; knownCount: number; newCount: number; strength: number;
};
export type ConstellationNode = { id: string; kind: string; label: string; ring: 0 | 1 | 2 | 3; angle: number; weight: number; relation?: string; eventId?: string };
export type ConstellationView = { nodes: ConstellationNode[]; links: Array<{ from: string; to: string; kind: string; weight: number }> };
export const GRAPH_POLICY: { version: number };
export function buildEvidenceGraph(input: { events: unknown[]; sports?: unknown[]; tasteProfile?: unknown; signals?: FeedbackSignals | null; now?: string | Date | null }): EvidenceGraph;
export function connectionPaths(graph: EvidenceGraph, eventId: string, options?: { maxPaths?: number; maxHops?: number }): ConnectionPath[];
export function findScenes(graph: EvidenceGraph, options?: { minEvents?: number; maxScenes?: number }): Scene[];
export function constellation(graph: EvidenceGraph, options?: { maxEvents?: number; includeGames?: boolean }): ConstellationView;
export function describeNode(graph: EvidenceGraph, nodeId: string): { label: string; kind: string; summary: string; events: Array<{ id: string; title: string; startLocal: string }> } | null;
