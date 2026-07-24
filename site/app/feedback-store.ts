// Device-local planning and feedback state. Planning intent is deliberately
// separate from taste evidence: saves/holds help make plans, while only an
// attended outcome or explicit "Not for me" creates a journal envelope.

export type FeedbackVertical = "music" | "sports";
export type PlanningVertical = FeedbackVertical | "movies";

export type PublicFeedbackSnapshot = {
  feedbackSnapshotId: string;
  canonicalEventId: string;
  eventDateLocal: string;
  eventTitleSnapshot: string;
  vertical: FeedbackVertical;
};

export type RecommendationHistoryItem = {
  historyId: string;
  canonicalEventId: string;
  feedbackSnapshotId: string | null;
  vertical: PlanningVertical;
  title: string;
  dateLocal: string;
  locationLabel: string | null;
  firstShownAt: string;
  lastShownAt: string;
  surfaces: Array<"overview" | "plan-ahead" | "shortlist">;
  bestRank: number | null;
};

export type PlanningSnapshot = {
  itemId: string;
  title: string;
  dateLocal: string;
  vertical: PlanningVertical;
  locationLabel: string | null;
};

export type PlanningItem = {
  itemId: string;
  saved: boolean;
  held: boolean;
  capturedSnapshot: PlanningSnapshot;
  currentSnapshot: PlanningSnapshot;
  capturedFeedbackSnapshot: PublicFeedbackSnapshot | null;
  currentFeedbackSnapshot: PublicFeedbackSnapshot | null;
  presentInProjection: boolean;
  createdAt: string;
  updatedAt: string;
  lastReconciledAt: string | null;
};

export const FEEDBACK_STATUSES = [
  "attended-worth-it",
  "attended-not-worth-it",
  "skipped-still-interested",
  "skipped-no-longer-interested",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type SiteFeedbackImportRecord = {
  schemaVersion: 1;
  source: "taste-engine-site";
  feedbackId: string;
  feedbackSnapshotId: string;
  canonicalEventId: string;
  eventDateLocal: string;
  eventTitleSnapshot: string;
  status: FeedbackStatus;
  rating: number | null;
  signalTags: string[];
  notes: null;
  recordedAt: string;
};

export type BrowserFeedbackRecord = {
  record: SiteFeedbackImportRecord;
  firstExportTriggeredAt: string | null;
  exportBatchId: string | null;
};

export type ExportBatch = {
  exportBatchId: string;
  feedbackIds: string[];
  preparedAt: string;
  downloadTriggeredAt: string | null;
};

export type HistoryResponse = {
  historyId: string;
  state: "dismissed" | "resolved";
  feedbackId: string | null;
  respondedAt: string;
};

export type LocalFeedbackStore = {
  version: 2;
  planning: Record<string, PlanningItem>;
  historyResponses: Record<string, HistoryResponse>;
  records: Record<string, BrowserFeedbackRecord>;
  exportBatches: Record<string, ExportBatch>;
};

export const STORAGE_KEY = "taste-engine.feedback.v2";
export const LEGACY_STORAGE_KEY = "taste-engine.feedback.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function emptyStore(): LocalFeedbackStore {
  return { version: 2, planning: {}, historyResponses: {}, records: {}, exportBatches: {} };
}

export function loadStore(storage: StorageLike | null | undefined): LocalFeedbackStore {
  try {
    const current = storage?.getItem(STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      if (parsed?.version !== 2) return emptyStore();
      return {
        version: 2,
        planning: asRecord(parsed.planning),
        historyResponses: asRecord(parsed.historyResponses),
        records: asRecord(parsed.records),
        exportBatches: asRecord(parsed.exportBatches),
      };
    }
    const legacy = storage?.getItem(LEGACY_STORAGE_KEY);
    return legacy ? migrateLegacyStore(JSON.parse(legacy)) : emptyStore();
  } catch {
    return emptyStore();
  }
}

export function saveStore(storage: StorageLike | null | undefined, store: LocalFeedbackStore): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export type PlanningInput = {
  planningSnapshot: PlanningSnapshot;
  feedbackSnapshot: PublicFeedbackSnapshot | null;
};

export function setPlanningIntent(
  store: LocalFeedbackStore,
  input: PlanningInput,
  intent: "saved" | "held",
  active: boolean,
  now: string,
): LocalFeedbackStore {
  const itemId = input.planningSnapshot.itemId;
  const existing = store.planning[itemId];
  const item: PlanningItem = existing
    ? {
      ...existing,
      [intent]: active,
      currentSnapshot: input.planningSnapshot,
      currentFeedbackSnapshot: input.feedbackSnapshot ?? existing.currentFeedbackSnapshot,
      presentInProjection: true,
      updatedAt: now,
    }
    : {
      itemId,
      saved: intent === "saved" ? active : false,
      held: intent === "held" ? active : false,
      capturedSnapshot: input.planningSnapshot,
      currentSnapshot: input.planningSnapshot,
      capturedFeedbackSnapshot: input.feedbackSnapshot,
      currentFeedbackSnapshot: input.feedbackSnapshot,
      presentInProjection: true,
      createdAt: now,
      updatedAt: now,
      lastReconciledAt: null,
    };
  const planning = { ...store.planning };
  if (!item.saved && !item.held) delete planning[itemId];
  else planning[itemId] = item;
  return { ...store, planning };
}

export function clearPlanning(store: LocalFeedbackStore, itemId: string): LocalFeedbackStore {
  if (!store.planning[itemId]) return store;
  const planning = { ...store.planning };
  delete planning[itemId];
  return { ...store, planning };
}

export function reconcileWithProjection(store: LocalFeedbackStore, projectionItems: PlanningInput[], now: string): LocalFeedbackStore {
  const byId = new Map(projectionItems.map((item) => [item.planningSnapshot.itemId, item]));
  const planning: Record<string, PlanningItem> = {};
  for (const [itemId, item] of Object.entries(store.planning)) {
    const current = byId.get(itemId);
    planning[itemId] = current
      ? {
        ...item,
        currentSnapshot: current.planningSnapshot,
        currentFeedbackSnapshot: current.feedbackSnapshot ?? item.currentFeedbackSnapshot,
        presentInProjection: true,
        lastReconciledAt: now,
      }
      : { ...item, presentInProjection: false, lastReconciledAt: now };
  }
  return { ...store, planning };
}

export type HistoryQueueEntry = {
  history: RecommendationHistoryItem;
  eligible: boolean;
  planned: boolean;
};

export function recentRecommendationQueue(
  store: LocalFeedbackStore,
  history: RecommendationHistoryItem[],
  todayKey: string,
): HistoryQueueEntry[] {
  return history
    .filter((item) => item.dateLocal < todayKey && !store.historyResponses[item.historyId] && !feedbackForHistory(store, item))
    .map((item) => ({
      history: item,
      eligible: (item.vertical === "music" || item.vertical === "sports") && Boolean(item.feedbackSnapshotId),
      planned: isPlanned(store, item),
    }))
    .sort((left, right) => Number(right.planned) - Number(left.planned)
      || historySurfacePriority(left.history.surfaces) - historySurfacePriority(right.history.surfaces)
      || right.history.dateLocal.localeCompare(left.history.dateLocal)
      || (left.history.bestRank ?? Number.MAX_SAFE_INTEGER) - (right.history.bestRank ?? Number.MAX_SAFE_INTEGER)
      || left.history.historyId.localeCompare(right.history.historyId));
}

export function upcomingPlanning(store: LocalFeedbackStore, todayKey: string): PlanningItem[] {
  return Object.values(store.planning)
    .filter((item) => (item.saved || item.held) && item.currentSnapshot.dateLocal >= todayKey)
    .sort((left, right) => left.currentSnapshot.dateLocal.localeCompare(right.currentSnapshot.dateLocal)
      || left.currentSnapshot.title.localeCompare(right.currentSnapshot.title));
}

export function dismissHistory(store: LocalFeedbackStore, historyId: string, now: string): LocalFeedbackStore {
  if (store.historyResponses[historyId]) return store;
  return {
    ...store,
    historyResponses: {
      ...store.historyResponses,
      [historyId]: { historyId, state: "dismissed", feedbackId: null, respondedAt: now },
    },
  };
}

export function confirmHistoryFeedback(
  store: LocalFeedbackStore,
  history: RecommendationHistoryItem,
  status: "attended-worth-it" | "attended-not-worth-it" | "skipped-no-longer-interested",
  { now, uuid }: { now: string; uuid: string },
): LocalFeedbackStore {
  if (store.historyResponses[history.historyId] || !history.feedbackSnapshotId || history.vertical === "movies") return store;
  const result = createFeedbackRecord(store, {
    feedbackSnapshotId: history.feedbackSnapshotId,
    canonicalEventId: history.canonicalEventId,
    eventDateLocal: history.dateLocal,
    eventTitleSnapshot: history.title,
    vertical: history.vertical,
  }, status, { now, uuid });
  const feedbackId = feedbackForHistory(result, history)?.record.feedbackId ?? null;
  return {
    ...result,
    historyResponses: {
      ...result.historyResponses,
      [history.historyId]: { historyId: history.historyId, state: "resolved", feedbackId, respondedAt: now },
    },
  };
}

export function recordNotForMe(
  store: LocalFeedbackStore,
  snapshot: PublicFeedbackSnapshot,
  options: { now: string; uuid: string },
): LocalFeedbackStore {
  return createFeedbackRecord(store, snapshot, "skipped-no-longer-interested", options);
}

export function hasFeedbackForSnapshot(store: LocalFeedbackStore, snapshot: PublicFeedbackSnapshot | null): boolean {
  if (!snapshot) return false;
  return Object.values(store.records).some(({ record }) => record.feedbackSnapshotId === snapshot.feedbackSnapshotId
    || (record.canonicalEventId === snapshot.canonicalEventId && record.eventDateLocal === snapshot.eventDateLocal));
}

function createFeedbackRecord(
  store: LocalFeedbackStore,
  snapshot: PublicFeedbackSnapshot,
  status: FeedbackStatus,
  { now, uuid }: { now: string; uuid: string },
): LocalFeedbackStore {
  if (hasFeedbackForSnapshot(store, snapshot)) return store;
  const feedbackId = `site-${uuid}`;
  const record: SiteFeedbackImportRecord = {
    schemaVersion: 1,
    source: "taste-engine-site",
    feedbackId,
    feedbackSnapshotId: snapshot.feedbackSnapshotId,
    canonicalEventId: snapshot.canonicalEventId,
    eventDateLocal: snapshot.eventDateLocal,
    eventTitleSnapshot: snapshot.eventTitleSnapshot,
    status,
    rating: null,
    signalTags: [],
    notes: null,
    recordedAt: now,
  };
  return { ...store, records: { ...store.records, [feedbackId]: { record, firstExportTriggeredAt: null, exportBatchId: null } } };
}

function feedbackForHistory(store: LocalFeedbackStore, item: RecommendationHistoryItem): BrowserFeedbackRecord | null {
  return Object.values(store.records).find(({ record }) => record.feedbackSnapshotId === item.feedbackSnapshotId
    || (record.canonicalEventId === item.canonicalEventId && record.eventDateLocal === item.dateLocal)) ?? null;
}

function isPlanned(store: LocalFeedbackStore, item: RecommendationHistoryItem): boolean {
  return Object.values(store.planning).some((planning) => (planning.itemId === item.canonicalEventId
    || planning.currentFeedbackSnapshot?.canonicalEventId === item.canonicalEventId)
    && planning.currentSnapshot.dateLocal === item.dateLocal && (planning.saved || planning.held));
}

function historySurfacePriority(surfaces: RecommendationHistoryItem["surfaces"]): number {
  if (surfaces.includes("overview")) return 0;
  if (surfaces.includes("plan-ahead")) return 1;
  return 2;
}

export function unexportedRecords(store: LocalFeedbackStore): BrowserFeedbackRecord[] {
  return sortRecords(Object.values(store.records).filter((entry) => entry.firstExportTriggeredAt == null));
}

export function prepareExportBatch(
  store: LocalFeedbackStore,
  { now, uuid, all = false }: { now: string; uuid: string; all?: boolean },
): { store: LocalFeedbackStore; batch: ExportBatch | null; jsonl: string } {
  const entries = all ? sortRecords(Object.values(store.records)) : unexportedRecords(store);
  if (!entries.length) return { store, batch: null, jsonl: "" };
  const batch: ExportBatch = {
    exportBatchId: `batch-${uuid}`,
    feedbackIds: entries.map((entry) => entry.record.feedbackId),
    preparedAt: now,
    downloadTriggeredAt: null,
  };
  return {
    store: { ...store, exportBatches: { ...store.exportBatches, [batch.exportBatchId]: batch } },
    batch,
    jsonl: serializeRecords(entries.map((entry) => entry.record)),
  };
}

export function markBatchDownloadTriggered(store: LocalFeedbackStore, batchId: string, now: string): LocalFeedbackStore {
  const batch = store.exportBatches[batchId];
  if (!batch) return store;
  const records = { ...store.records };
  for (const feedbackId of batch.feedbackIds) {
    const entry = records[feedbackId];
    if (entry && entry.firstExportTriggeredAt == null) records[feedbackId] = { ...entry, firstExportTriggeredAt: now, exportBatchId: batchId };
  }
  return {
    ...store,
    records,
    exportBatches: { ...store.exportBatches, [batchId]: { ...batch, downloadTriggeredAt: now } },
  };
}

export function lastTriggeredBatch(store: LocalFeedbackStore): ExportBatch | null {
  return Object.values(store.exportBatches)
    .filter((batch) => batch.downloadTriggeredAt != null)
    .sort((left, right) => String(right.downloadTriggeredAt).localeCompare(String(left.downloadTriggeredAt)))[0] ?? null;
}

export function serializeBatch(store: LocalFeedbackStore, batch: ExportBatch): string {
  const records = batch.feedbackIds.map((feedbackId) => store.records[feedbackId]?.record)
    .filter((record): record is SiteFeedbackImportRecord => Boolean(record));
  return serializeRecords(records);
}

export function serializeRecords(records: SiteFeedbackImportRecord[]): string {
  return [...records]
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.feedbackId.localeCompare(right.feedbackId))
    .map((record) => JSON.stringify(record)).join("\n") + "\n";
}

export function generateUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function migrateLegacyStore(input: any): LocalFeedbackStore {
  if (!input || input.version !== 1) return emptyStore();
  const planning: Record<string, PlanningItem> = {};
  for (const [itemId, item] of Object.entries(asRecord<any>(input.planning))) {
    if (item?.state !== "saved" || item.resolvedFeedbackId) continue;
    planning[itemId] = {
      itemId,
      saved: true,
      held: false,
      capturedSnapshot: item.capturedSnapshot,
      currentSnapshot: item.currentSnapshot,
      capturedFeedbackSnapshot: item.capturedFeedbackSnapshot ?? null,
      currentFeedbackSnapshot: item.currentFeedbackSnapshot ?? null,
      presentInProjection: item.presentInProjection !== false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      lastReconciledAt: item.lastReconciledAt ?? null,
    };
  }
  return {
    version: 2,
    planning,
    historyResponses: {},
    records: asRecord(input.records),
    exportBatches: asRecord(input.exportBatches),
  };
}

function sortRecords(entries: BrowserFeedbackRecord[]): BrowserFeedbackRecord[] {
  return [...entries].sort((left, right) => left.record.recordedAt.localeCompare(right.record.recordedAt)
    || left.record.feedbackId.localeCompare(right.record.feedbackId));
}

function asRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, T> : {};
}
