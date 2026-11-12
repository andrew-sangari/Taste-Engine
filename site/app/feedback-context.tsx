"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  confirmHistoryFeedback,
  dismissHistory,
  emptyStore,
  generateUuid,
  feedbackForSnapshot,
  hasFeedbackForSnapshot,
  learningEnabled,
  planConstraints,
  recordInterest,
  setLearning,
  setPlanConstraints,
  withdrawFeedback,
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
  storageKeyForProfile,
  unexportedRecords,
  upcomingPlanning,
  type HistoryQueueEntry,
  type LocalFeedbackStore,
  type FeedbackReasonCode,
  type FeedbackStatus,
  type FeedbackDetail,
  type SiteFeedbackImportRecord,
  type PlanningInput,
  type PlanConstraints,
  type PlanningItem,
  type PublicFeedbackSnapshot,
  type RecommendationHistoryItem,
} from "./feedback-store";
import { MAX_OPS_PER_PUSH, SignedOutError, mergeRemote, opKey, pendingOps, pullRemote, pushOps, type RemoteFeedbackState } from "./feedback-sync";

type FeedbackContextValue = {
  ready: boolean;
  store: LocalFeedbackStore;
  planningFor: (itemId: string) => PlanningItem | null;
  setIntent: (input: PlanningInput, intent: "saved" | "held", active: boolean) => void;
  notForMe: (snapshot: PublicFeedbackSnapshot, reasons: FeedbackReasonCode[]) => void;
  hasOutcome: (snapshot: PublicFeedbackSnapshot | null) => boolean;
  feedbackFor: (snapshot: PublicFeedbackSnapshot | null) => SiteFeedbackImportRecord | null;
  interested: (snapshot: PublicFeedbackSnapshot, level: "in" | "curious") => void;
  withdraw: (snapshot: PublicFeedbackSnapshot) => void;
  checkIn: (history: RecommendationHistoryItem, status: FeedbackStatus, reasons?: FeedbackReasonCode[], detail?: FeedbackDetail) => void;
  dismiss: (historyId: string) => void;
  queue: HistoryQueueEntry[];
  upcoming: PlanningItem[];
  pendingCount: number;
  unexportedCount: number;
  persistence: "loading" | "hosted" | "device";
  persistenceError: string | null;
  // "saving" while a change is on its way, "retrying" after a failed attempt.
  syncState: "idle" | "saving" | "synced" | "retrying";
  learning: boolean;
  setLearning: (value: boolean) => void;
  // The person's planning limits, or null while they are still the defaults.
  planConstraints: PlanConstraints | null;
  setPlanConstraints: (value: PlanConstraints) => void;
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

export function FeedbackProvider({ projectionItems, recentHistory, todayKey, profileId, allowLegacyStorageMigration, children }: {
  projectionItems: PlanningInput[];
  recentHistory: RecommendationHistoryItem[];
  todayKey: string;
  profileId: string | null;
  allowLegacyStorageMigration: boolean;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [store, setStore] = useState<LocalFeedbackStore>(emptyStore);
  const [persistence, setPersistence] = useState<FeedbackContextValue["persistence"]>("loading");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<FeedbackContextValue["syncState"]>("idle");
  const storageKey = storageKeyForProfile(profileId);

  // Actions may fire twice in one tick (triage records interest and saves
  // the date). Each must build on the other's result, not on the store this
  // render closed over.
  const latestStore = useRef(store);
  useEffect(() => { latestStore.current = store; }, [store]);
  const remote = useRef<RemoteFeedbackState | null>(null);
  const hosted = useRef<boolean | null>(null);
  const running = useRef(false);
  const dirty = useRef(false);
  const unsyncable = useRef(new Set<string>());
  const retry = useRef<{ timer: number | null; attempt: number }>({ timer: null, attempt: 0 });
  const debounce = useRef<number | null>(null);
  const syncRef = useRef<() => Promise<void>>(async () => undefined);

  const commit = useCallback((next: LocalFeedbackStore) => {
    latestStore.current = next;
    setStore(next);
    saveStore(storage(), next, storageKey);
  }, [storageKey]);

  // One sync at a time. Each pass sends what the server lacks, takes back the
  // merged state, and folds it in; a failure leaves the difference in place
  // and schedules another pass, so nothing is ever dropped.
  const sync = useCallback(async () => {
    if (hosted.current === false) return;
    if (running.current) { dirty.current = true; return; }
    running.current = true;
    setSyncState("saving");
    try {
      do {
        dirty.current = false;
        if (!remote.current) remote.current = await pullRemote();
        const ops = pendingOps(latestStore.current, remote.current, unsyncable.current);
        if (ops.length) {
          const sent = ops.slice(0, MAX_OPS_PER_PUSH);
          remote.current = await pushOps(sent);
          // Anything the server still lacks after accepting the push was
          // refused as invalid; stop resending it for this session.
          const stillPending = new Set(pendingOps(latestStore.current, remote.current).map(opKey));
          for (const op of sent) if (stillPending.has(opKey(op))) unsyncable.current.add(opKey(op));
          if (ops.length > sent.length) dirty.current = true;
        }
        const merged = mergeRemote(latestStore.current, remote.current);
        if (merged !== latestStore.current) commit(reconcileWithProjection(merged, projectionItems, new Date().toISOString()));
      } while (dirty.current);
      hosted.current = true;
      retry.current.attempt = 0;
      setPersistence("hosted");
      setPersistenceError(null);
      setSyncState("synced");
    } catch (error) {
      if (error instanceof SignedOutError) {
        hosted.current = false;
        setPersistence("device");
        setPersistenceError(error.message);
        setSyncState("idle");
      } else {
        // Keep the last known mode; a first-load failure falls back to device
        // behaviour but keeps trying.
        if (hosted.current == null) setPersistence("device");
        setPersistenceError("Saved on this device. Syncing will retry automatically.");
        setSyncState("retrying");
        const delay = [2_000, 5_000, 15_000, 60_000][Math.min(retry.current.attempt, 3)];
        retry.current.attempt += 1;
        if (retry.current.timer != null) window.clearTimeout(retry.current.timer);
        retry.current.timer = window.setTimeout(() => { retry.current.timer = null; void syncRef.current(); }, delay);
      }
    } finally {
      running.current = false;
    }
    // Projection data is stable for one build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit]);

  useEffect(() => { syncRef.current = sync; }, [sync]);

  useEffect(() => {
    // The device copy is usable immediately; the hosted state merges in as
    // soon as it arrives.
    const local = reconcileWithProjection(
      loadStore(storage(), storageKey, allowLegacyStorageMigration),
      projectionItems,
      new Date().toISOString(),
    );
    void (async () => {
      await Promise.resolve();
      commit(local);
      setReady(true);
      await sync();
    })();
    const resync = () => {
      if (document.visibilityState === "hidden") return;
      // Another device may have changed things: pull fresh before diffing.
      remote.current = null;
      void sync();
    };
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    const timers = retry.current;
    return () => {
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
      if (timers.timer != null) window.clearTimeout(timers.timer);
      if (debounce.current != null) window.clearTimeout(debounce.current);
    };
    // Projection data is stable for one build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((next: LocalFeedbackStore) => {
    commit(next);
    if (hosted.current === false) return;
    if (debounce.current != null) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => { debounce.current = null; void sync(); }, 250);
  }, [commit, sync]);

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
      setIntent: (input, intent, active) => update(setPlanningIntent(latestStore.current, input, intent, active, new Date().toISOString())),
      notForMe: (snapshot, reasons) => update(recordNotForMe(latestStore.current, snapshot, reasons, { now: new Date().toISOString(), uuid: generateUuid() })),
      hasOutcome: (snapshot) => hasFeedbackForSnapshot(store, snapshot),
      feedbackFor: (snapshot) => feedbackForSnapshot(store, snapshot),
      interested: (snapshot, level) => update(recordInterest(latestStore.current, snapshot, level, { now: new Date().toISOString(), uuid: generateUuid() })),
      withdraw: (snapshot) => update(withdrawFeedback(latestStore.current, snapshot, { now: new Date().toISOString(), uuid: generateUuid() })),
      checkIn: (history, status, reasons = [], detail = {}) => update(confirmHistoryFeedback(latestStore.current, history, status, reasons, { now: new Date().toISOString(), uuid: generateUuid(), ...detail })),
      dismiss: (historyId) => update(dismissHistory(latestStore.current, historyId, new Date().toISOString())),
      queue,
      upcoming: upcomingPlanning(store, todayKey),
      pendingCount: queue.filter((entry) => entry.eligible).length,
      unexportedCount: unexportedRecords(store).length,
      persistence,
      persistenceError,
      syncState,
      learning: learningEnabled(store),
      setLearning: (value) => update(setLearning(latestStore.current, value, new Date().toISOString())),
      planConstraints: planConstraints(store),
      setPlanConstraints: (value) => update(setPlanConstraints(latestStore.current, value, new Date().toISOString())),
      exportNew: () => runExport(false),
      exportAll: () => runExport(true),
      redownloadLast: () => {
        const batch = lastTriggeredBatch(store);
        if (batch) triggerDownload(serializeBatch(store, batch));
      },
      hasTriggeredBatch: lastTriggeredBatch(store) != null,
    };
  }, [persistence, persistenceError, ready, recentHistory, store, syncState, todayKey, update]);

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}
