"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  confirmHistoryFeedback,
  dismissHistory,
  emptyStore,
  generateUuid,
  hasFeedbackForSnapshot,
  lastTriggeredBatch,
  loadStore,
  markBatchDownloadTriggered,
  prepareExportBatch,
  recentRecommendationQueue,
  reconcileWithProjection,
  recordNotForMe,
  saveStore,
  serializeBatch,
  setPlanningIntent,
  unexportedRecords,
  upcomingPlanning,
  type HistoryQueueEntry,
  type LocalFeedbackStore,
  type FeedbackReasonCode,
  type FeedbackStatus,
  type PlanningInput,
  type PlanningItem,
  type PublicFeedbackSnapshot,
  type RecommendationHistoryItem,
} from "./feedback-store";

type FeedbackContextValue = {
  ready: boolean;
  store: LocalFeedbackStore;
  planningFor: (itemId: string) => PlanningItem | null;
  setIntent: (input: PlanningInput, intent: "saved" | "held", active: boolean) => void;
  notForMe: (snapshot: PublicFeedbackSnapshot, reasons: FeedbackReasonCode[]) => void;
  hasOutcome: (snapshot: PublicFeedbackSnapshot | null) => boolean;
  checkIn: (history: RecommendationHistoryItem, status: FeedbackStatus, reasons?: FeedbackReasonCode[]) => void;
  dismiss: (historyId: string) => void;
  queue: HistoryQueueEntry[];
  upcoming: PlanningItem[];
  pendingCount: number;
  unexportedCount: number;
  persistence: "loading" | "hosted" | "device";
  persistenceError: string | null;
  exportNew: () => void;
  exportAll: () => void;
  redownloadLast: () => void;
  hasTriggeredBatch: boolean;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useFeedback(): FeedbackContextValue | null {
  return useContext(FeedbackContext);
}

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function FeedbackProvider({ projectionItems, recentHistory, todayKey, children }: {
  projectionItems: PlanningInput[];
  recentHistory: RecommendationHistoryItem[];
  todayKey: string;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [store, setStore] = useState<LocalFeedbackStore>(emptyStore);
  const [persistence, setPersistence] = useState<FeedbackContextValue["persistence"]>("loading");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const writeChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    const local = reconcileWithProjection(loadStore(storage()), projectionItems, new Date().toISOString());
    void (async () => {
      try {
        const response = await fetch("/api/feedback/state", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in with ChatGPT for durable sync." : "Durable feedback is temporarily unavailable.");
        const body = await response.json() as { store?: unknown };
        const remote = body.store ? normalizeStore(body.store) : local;
        const loaded = reconcileWithProjection(remote, projectionItems, new Date().toISOString());
        // A hosted v2 blob is migrated immediately after its browser-safe v3
        // normalization, which also backfills its immutable D1 record rows.
        if (!body.store || storeVersion(body.store) !== 3) await persistRemoteStore(loaded);
        if (!active) return;
        setStore(loaded);
        saveStore(storage(), loaded);
        setPersistence("hosted");
        setPersistenceError(null);
      } catch (error) {
        if (!active) return;
        setStore(local);
        saveStore(storage(), local);
        setPersistence("device");
        setPersistenceError(error instanceof Error ? error.message : "Durable feedback is unavailable.");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
    // Projection data is stable for one build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((next: LocalFeedbackStore) => {
    setStore(next);
    saveStore(storage(), next);
    if (persistence === "hosted") {
      writeChain.current = writeChain.current.then(async () => {
        try {
          await persistRemoteStore(next);
          setPersistenceError(null);
        } catch {
          setPersistenceError("This change is saved on this device and will retry after the next page load.");
        }
      });
    }
  }, [persistence]);

  const value = useMemo<FeedbackContextValue>(() => {
    const queue = recentRecommendationQueue(store, recentHistory, todayKey);
    const triggerDownload = (jsonl: string) => {
      const blob = new Blob([jsonl], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `feedback-inbox-${todayKey}.jsonl`;
      anchor.click();
      URL.revokeObjectURL(url);
    };
    const runExport = (all: boolean) => {
      const prepared = prepareExportBatch(store, { now: new Date().toISOString(), uuid: generateUuid(), all });
      if (!prepared.batch) return;
      triggerDownload(prepared.jsonl);
      update(markBatchDownloadTriggered(prepared.store, prepared.batch.exportBatchId, new Date().toISOString()));
    };
    return {
      ready,
      store,
      planningFor: (itemId) => store.planning[itemId] ?? null,
      setIntent: (input, intent, active) => update(setPlanningIntent(store, input, intent, active, new Date().toISOString())),
      notForMe: (snapshot, reasons) => update(recordNotForMe(store, snapshot, reasons, { now: new Date().toISOString(), uuid: generateUuid() })),
      hasOutcome: (snapshot) => hasFeedbackForSnapshot(store, snapshot),
      checkIn: (history, status, reasons = []) => update(confirmHistoryFeedback(store, history, status, reasons, { now: new Date().toISOString(), uuid: generateUuid() })),
      dismiss: (historyId) => update(dismissHistory(store, historyId, new Date().toISOString())),
      queue,
      upcoming: upcomingPlanning(store, todayKey),
      pendingCount: queue.filter((entry) => entry.eligible).length,
      unexportedCount: unexportedRecords(store).length,
      persistence,
      persistenceError,
      exportNew: () => runExport(false),
      exportAll: () => runExport(true),
      redownloadLast: () => {
        const batch = lastTriggeredBatch(store);
        if (batch) triggerDownload(serializeBatch(store, batch));
      },
      hasTriggeredBatch: lastTriggeredBatch(store) != null,
    };
  }, [persistence, persistenceError, ready, recentHistory, store, todayKey, update]);

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

function normalizeStore(value: unknown): LocalFeedbackStore {
  return loadStore({
    getItem: (key) => key === "taste-engine.feedback.v2" ? JSON.stringify(value) : null,
    setItem: () => undefined,
  });
}

function storeVersion(value: unknown): number | null {
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { version?: unknown }).version === "number"
    ? (value as { version: number }).version
    : null;
}

async function persistRemoteStore(store: LocalFeedbackStore): Promise<void> {
  const response = await fetch("/api/feedback/state", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(store),
  });
  if (!response.ok) throw new Error("Durable feedback write failed.");
}
