// Per-action sync between this device's feedback store and the hosted
// database. State-based and convergent: the device sends whatever it has that
// the server lacks, the server answers with the merged state, and the device
// folds that back in. Nothing is uploaded as a whole, so a failed request
// loses nothing (the difference is simply still there next time) and two
// devices never overwrite each other's unrelated changes.
//
//   records    append-only; union by feedbackId
//   plans      last write wins per item, by the item's own updatedAt
//   responses  one per history item; an answer always beats a skip
//   settings   last write wins per key
import type { BrowserFeedbackRecord, HistoryResponse, LocalFeedbackStore, PlanConstraints, PlanningItem, SiteFeedbackImportRecord } from "./feedback-store";

export type RemoteFeedbackState = {
  records: SiteFeedbackImportRecord[];
  plans: PlanningItem[];
  responses: HistoryResponse[];
  settings: Record<string, { value: unknown; updatedAt: string }>;
  serverTime?: string;
};

export type SyncOp =
  | { type: "record"; record: SiteFeedbackImportRecord }
  | { type: "plan"; item: PlanningItem }
  | { type: "response"; response: HistoryResponse }
  | { type: "setting"; key: "learning"; value: boolean; updatedAt: string }
  | { type: "setting"; key: "planning"; value: PlanConstraints; updatedAt: string };

export const MAX_OPS_PER_PUSH = 200;

export function opKey(op: SyncOp): string {
  if (op.type === "record") return `record:${op.record.feedbackId}`;
  if (op.type === "plan") return `plan:${op.item.itemId}:${op.item.updatedAt}`;
  if (op.type === "response") return `response:${op.response.historyId}:${op.response.state}`;
  return `setting:${op.key}:${op.updatedAt}`;
}

/** Everything this device holds that the server does not yet. */
export function pendingOps(local: LocalFeedbackStore, remote: RemoteFeedbackState, skip: ReadonlySet<string> = new Set()): SyncOp[] {
  const ops: SyncOp[] = [];
  const remoteRecordIds = new Set(remote.records.map((record) => record.feedbackId));
  for (const { record } of Object.values(local.records)) {
    if (!remoteRecordIds.has(record.feedbackId)) ops.push({ type: "record", record });
  }
  const remotePlans = new Map(remote.plans.map((item) => [item.itemId, item]));
  for (const item of Object.values(local.planning)) {
    const existing = remotePlans.get(item.itemId);
    if (!existing || item.updatedAt > existing.updatedAt) ops.push({ type: "plan", item });
  }
  const remoteResponses = new Map(remote.responses.map((response) => [response.historyId, response]));
  for (const response of Object.values(local.historyResponses)) {
    const existing = remoteResponses.get(response.historyId);
    if (!existing || (response.state === "resolved" && existing.state !== "resolved")) ops.push({ type: "response", response });
  }
  const learning = local.settings?.learning;
  const remoteLearning = remote.settings?.learning;
  if (learning && (!remoteLearning || learning.updatedAt > remoteLearning.updatedAt)) {
    ops.push({ type: "setting", key: "learning", value: learning.value, updatedAt: learning.updatedAt });
  }
  const planning = local.settings?.planning;
  const remotePlanning = remote.settings?.planning;
  if (planning && (!remotePlanning || planning.updatedAt > remotePlanning.updatedAt)) {
    ops.push({ type: "setting", key: "planning", value: planning.value, updatedAt: planning.updatedAt });
  }
  return ops.filter((op) => !skip.has(opKey(op)));
}

/** Fold the server's state into the device store. Returns the same object when nothing changes. */
export function mergeRemote(local: LocalFeedbackStore, remote: RemoteFeedbackState): LocalFeedbackStore {
  let changed = false;
  const records: Record<string, BrowserFeedbackRecord> = { ...local.records };
  for (const record of remote.records) {
    if (!record?.feedbackId || records[record.feedbackId]) continue;
    records[record.feedbackId] = { record, firstExportTriggeredAt: null, exportBatchId: null };
    changed = true;
  }
  const planning: Record<string, PlanningItem> = { ...local.planning };
  for (const item of remote.plans) {
    const existing = planning[item.itemId];
    if (!existing || item.updatedAt > existing.updatedAt) {
      planning[item.itemId] = item;
      changed = true;
    }
  }
  const historyResponses: Record<string, HistoryResponse> = { ...local.historyResponses };
  for (const response of remote.responses) {
    const existing = historyResponses[response.historyId];
    if (!existing || (response.state === "resolved" && existing.state !== "resolved")) {
      historyResponses[response.historyId] = response;
      changed = true;
    }
  }
  let settings = local.settings;
  const remoteLearning = remote.settings?.learning;
  if (remoteLearning && typeof remoteLearning.value === "boolean"
    && (!settings?.learning || remoteLearning.updatedAt > settings.learning.updatedAt)) {
    settings = { ...settings, learning: { value: remoteLearning.value, updatedAt: remoteLearning.updatedAt } };
    changed = true;
  }
  const remotePlanning = remote.settings?.planning;
  if (remotePlanning && remotePlanning.value && typeof remotePlanning.value === "object" && !Array.isArray(remotePlanning.value)
    && (!settings?.planning || remotePlanning.updatedAt > settings.planning.updatedAt)) {
    settings = { ...settings, planning: { value: remotePlanning.value as PlanConstraints, updatedAt: remotePlanning.updatedAt } };
    changed = true;
  }
  return changed ? { ...local, records, planning, historyResponses, settings } : local;
}

export class SignedOutError extends Error {}

export async function pullRemote(fetchImpl: typeof fetch = fetch): Promise<RemoteFeedbackState> {
  const response = await fetchImpl("/api/feedback/sync", { cache: "no-store", credentials: "same-origin" });
  if (response.status === 401 || response.status === 403) throw new SignedOutError("Sign in for durable sync.");
  if (!response.ok) throw new Error("Durable feedback is temporarily unavailable.");
  return normalizeRemote(await response.json());
}

export async function pushOps(ops: SyncOp[], fetchImpl: typeof fetch = fetch): Promise<RemoteFeedbackState> {
  const response = await fetchImpl("/api/feedback/sync", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ops }),
  });
  if (response.status === 401 || response.status === 403) throw new SignedOutError("Sign in for durable sync.");
  if (!response.ok) throw new Error("Durable feedback write failed.");
  const body = await response.json() as { state?: unknown };
  return normalizeRemote(body.state);
}

export function normalizeRemote(value: unknown): RemoteFeedbackState {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const list = <T,>(candidate: unknown): T[] => Array.isArray(candidate) ? candidate as T[] : [];
  return {
    records: list<SiteFeedbackImportRecord>(input.records).filter((record) => typeof record?.feedbackId === "string" && typeof record?.recordedAt === "string"),
    plans: list<PlanningItem>(input.plans).filter((item) => typeof item?.itemId === "string" && typeof item?.updatedAt === "string" && item?.currentSnapshot != null),
    responses: list<HistoryResponse>(input.responses).filter((response) => typeof response?.historyId === "string"),
    settings: input.settings && typeof input.settings === "object" ? input.settings as RemoteFeedbackState["settings"] : {},
    serverTime: typeof input.serverTime === "string" ? input.serverTime : undefined,
  };
}
