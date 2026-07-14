/* @ds-bundle: {"namespace":"TasteEngineSite","components":[{"name":"CardActions","sourcePath":"components/general/CardActions/CardActions.jsx"},{"name":"ChangesStrip","sourcePath":"components/general/ChangesStrip/ChangesStrip.jsx"},{"name":"EventExplorer","sourcePath":"components/general/EventExplorer/EventExplorer.jsx"},{"name":"FilterDisclosure","sourcePath":"components/general/FilterDisclosure/FilterDisclosure.jsx"},{"name":"MovieExplorer","sourcePath":"components/general/MovieExplorer/MovieExplorer.jsx"},{"name":"OverviewExplorer","sourcePath":"components/general/OverviewExplorer/OverviewExplorer.jsx"},{"name":"RecommendationVisual","sourcePath":"components/general/RecommendationVisual/RecommendationVisual.jsx"},{"name":"SportsExplorer","sourcePath":"components/general/SportsExplorer/SportsExplorer.jsx"},{"name":"TasteExplorer","sourcePath":"components/general/TasteExplorer/TasteExplorer.jsx"},{"name":"VerticalShell","sourcePath":"components/general/VerticalShell/VerticalShell.jsx"}],"sourceHashes":{"components/general/CardActions/CardActions.jsx":"53046c199c35","components/general/CardActions/CardActions.d.ts":"056a2701fc8d","components/general/CardActions/CardActions.prompt.md":"ced0c152fbc7","components/general/ChangesStrip/ChangesStrip.jsx":"a54f2da41a8c","components/general/ChangesStrip/ChangesStrip.d.ts":"29806b38d23d","components/general/ChangesStrip/ChangesStrip.prompt.md":"5357a443f1f5","components/general/EventExplorer/EventExplorer.jsx":"72e44cb64869","components/general/EventExplorer/EventExplorer.d.ts":"710647cb5dac","components/general/EventExplorer/EventExplorer.prompt.md":"169848949593","components/general/FilterDisclosure/FilterDisclosure.jsx":"2501efb2fd13","components/general/FilterDisclosure/FilterDisclosure.d.ts":"237234fd1a15","components/general/FilterDisclosure/FilterDisclosure.prompt.md":"a5b55338fcfa","components/general/MovieExplorer/MovieExplorer.jsx":"dcb2c369431a","components/general/MovieExplorer/MovieExplorer.d.ts":"3475d88daa9c","components/general/MovieExplorer/MovieExplorer.prompt.md":"27a2e2d984d8","components/general/OverviewExplorer/OverviewExplorer.jsx":"ead96db0ba34","components/general/OverviewExplorer/OverviewExplorer.d.ts":"c195a6a0cad0","components/general/OverviewExplorer/OverviewExplorer.prompt.md":"42c28f171bf7","components/general/RecommendationVisual/RecommendationVisual.jsx":"f81f5af1beb8","components/general/RecommendationVisual/RecommendationVisual.d.ts":"3d53ca83a1d2","components/general/RecommendationVisual/RecommendationVisual.prompt.md":"8d70c86835c5","components/general/SportsExplorer/SportsExplorer.jsx":"e0293aea041e","components/general/SportsExplorer/SportsExplorer.d.ts":"3a9a9f82f767","components/general/SportsExplorer/SportsExplorer.prompt.md":"57d4d4ac0f05","components/general/TasteExplorer/TasteExplorer.jsx":"3ce4991161af","components/general/TasteExplorer/TasteExplorer.d.ts":"884e8c31a7a1","components/general/TasteExplorer/TasteExplorer.prompt.md":"78369e399535","components/general/VerticalShell/VerticalShell.jsx":"0fae9e7aac64","components/general/VerticalShell/VerticalShell.d.ts":"6eef8310346f","components/general/VerticalShell/VerticalShell.prompt.md":"4b5e65adcaac"},"inlinedExternals":[],"builtBy":"cc-design-sync"} */
var TasteEngineSite = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <define:import.meta.env>
  var init_define_import_meta_env = __esm({
    "<define:import.meta.env>"() {
    }
  });

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      init_define_import_meta_env();
      var R = window.React;
      function np(p, k) {
        var o = {};
        for (var x in p) if (x !== "children") o[x] = p[x];
        if (k !== void 0) o.key = k;
        return o;
      }
      function jsx12(t, p, k) {
        var c = p && p.children;
        return c === void 0 ? R.createElement(t, np(p, k)) : R.createElement(t, np(p, k), c);
      }
      function jsxs10(t, p, k) {
        return R.createElement.apply(R, [t, np(p, k)].concat(p.children));
      }
      module.exports = R;
      module.exports.jsx = jsx12;
      module.exports.jsxs = jsxs10;
      module.exports.jsxDEV = function(t, p, k, s) {
        return (s ? jsxs10 : jsx12)(t, p, k);
      };
      module.exports.Fragment = R.Fragment;
    }
  });

  // ds-bundle/.pkg-entry.mjs
  var pkg_entry_exports = {};
  __export(pkg_entry_exports, {
    CardActions: () => CardActions,
    ChangesStrip: () => ChangesStrip,
    EventExplorer: () => EventExplorer,
    FeedbackProvider: () => FeedbackProvider,
    FilterDisclosure: () => FilterDisclosure,
    MovieExplorer: () => MovieExplorer,
    OverviewExplorer: () => OverviewExplorer,
    RecommendationVisual: () => RecommendationVisual,
    SportsExplorer: () => SportsExplorer,
    TasteExplorer: () => TasteExplorer,
    VerticalShell: () => VerticalShell,
    calendarInputFrom: () => calendarInputFrom,
    planningInputFrom: () => planningInputFrom,
    useFeedback: () => useFeedback
  });
  init_define_import_meta_env();

  // site/app/card-actions.tsx
  init_define_import_meta_env();
  var import_react2 = __toESM(require_react_shim(), 1);

  // site/app/ics.ts
  init_define_import_meta_env();
  function buildCalendarEvent(input, options = {}) {
    const timezone = options.timezone ?? "America/Los_Angeles";
    const now = options.now ?? /* @__PURE__ */ new Date();
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Taste Engine//Hold the Date//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${sanitizeUid(input.uid)}@taste-engine`,
      `DTSTAMP:${utcStamp(now)}`,
      "STATUS:TENTATIVE"
    ];
    const timed = !input.allDay && parseLocalDateTime(input.startLocal);
    if (timed) {
      lines.push(`DTSTART;TZID=${timezone}:${timed}`);
    } else {
      const day = parseLocalDate(input.dateLocal ?? input.startLocal?.slice(0, 10) ?? null);
      if (!day) return null;
      lines.push(`DTSTART;VALUE=DATE:${day}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(day)}`);
    }
    lines.push(`SUMMARY:${escapeText(input.title)}`);
    if (input.locationLabel) lines.push(`LOCATION:${escapeText(input.locationLabel)}`);
    if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
    const url = safeUrl(input.url);
    if (url) lines.push(`URL:${url}`);
    lines.push("END:VEVENT", "END:VCALENDAR");
    return lines.map(foldLine).join("\r\n") + "\r\n";
  }
  function calendarFilename(title) {
    const base = title.normalize("NFKD").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return `${base || "taste-engine-event"}.ics`;
  }
  function parseLocalDateTime(value) {
    const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return null;
    return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6] ?? "00"}`;
  }
  function parseLocalDate(value) {
    const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[1]}${match[2]}${match[3]}` : null;
  }
  function nextDay(yyyymmdd) {
    const year = Number(yyyymmdd.slice(0, 4));
    const month = Number(yyyymmdd.slice(4, 6));
    const day = Number(yyyymmdd.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day + 1));
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  }
  function utcStamp(now) {
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  }
  function pad(value) {
    return String(value).padStart(2, "0");
  }
  function sanitizeUid(value) {
    return String(value).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "event";
  }
  function escapeText(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  }
  function safeUrl(value) {
    const text = String(value ?? "").trim();
    if (!/^https?:\/\//i.test(text)) return null;
    return text;
  }
  function foldLine(line) {
    const encoder = new TextEncoder();
    if (encoder.encode(line).length <= 75) return line;
    const parts = [];
    let current = "";
    let currentOctets = 0;
    let limit = 75;
    for (const char of line) {
      const octets = encoder.encode(char).length;
      if (currentOctets + octets > limit) {
        parts.push(current);
        current = " ";
        currentOctets = 1;
        limit = 75;
      }
      current += char;
      currentOctets += octets;
    }
    if (current) parts.push(current);
    return parts.join("\r\n");
  }

  // site/app/feedback-context.tsx
  init_define_import_meta_env();
  var import_react = __toESM(require_react_shim(), 1);

  // site/app/feedback-store.ts
  init_define_import_meta_env();
  var STORAGE_KEY = "taste-engine.feedback.v2";
  var LEGACY_STORAGE_KEY = "taste-engine.feedback.v1";
  function emptyStore() {
    return { version: 2, planning: {}, historyResponses: {}, records: {}, exportBatches: {} };
  }
  function loadStore(storage2) {
    try {
      const current = storage2?.getItem(STORAGE_KEY);
      if (current) {
        const parsed = JSON.parse(current);
        if (parsed?.version !== 2) return emptyStore();
        return {
          version: 2,
          planning: asRecord(parsed.planning),
          historyResponses: asRecord(parsed.historyResponses),
          records: asRecord(parsed.records),
          exportBatches: asRecord(parsed.exportBatches)
        };
      }
      const legacy = storage2?.getItem(LEGACY_STORAGE_KEY);
      return legacy ? migrateLegacyStore(JSON.parse(legacy)) : emptyStore();
    } catch {
      return emptyStore();
    }
  }
  function saveStore(storage2, store) {
    try {
      storage2?.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch {
      return false;
    }
  }
  function setPlanningIntent(store, input, intent, active, now) {
    const itemId = input.planningSnapshot.itemId;
    const existing = store.planning[itemId];
    const item = existing ? {
      ...existing,
      [intent]: active,
      currentSnapshot: input.planningSnapshot,
      currentFeedbackSnapshot: input.feedbackSnapshot ?? existing.currentFeedbackSnapshot,
      presentInProjection: true,
      updatedAt: now
    } : {
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
      lastReconciledAt: null
    };
    const planning = { ...store.planning };
    if (!item.saved && !item.held) delete planning[itemId];
    else planning[itemId] = item;
    return { ...store, planning };
  }
  function reconcileWithProjection(store, projectionItems, now) {
    const byId = new Map(projectionItems.map((item) => [item.planningSnapshot.itemId, item]));
    const planning = {};
    for (const [itemId, item] of Object.entries(store.planning)) {
      const current = byId.get(itemId);
      planning[itemId] = current ? {
        ...item,
        currentSnapshot: current.planningSnapshot,
        currentFeedbackSnapshot: current.feedbackSnapshot ?? item.currentFeedbackSnapshot,
        presentInProjection: true,
        lastReconciledAt: now
      } : { ...item, presentInProjection: false, lastReconciledAt: now };
    }
    return { ...store, planning };
  }
  function recentRecommendationQueue(store, history, todayKey) {
    return history.filter((item) => item.dateLocal < todayKey && !store.historyResponses[item.historyId] && !feedbackForHistory(store, item)).map((item) => ({
      history: item,
      eligible: (item.vertical === "music" || item.vertical === "sports") && Boolean(item.feedbackSnapshotId),
      planned: isPlanned(store, item)
    })).sort((left, right) => Number(right.planned) - Number(left.planned) || historySurfacePriority(left.history.surfaces) - historySurfacePriority(right.history.surfaces) || right.history.dateLocal.localeCompare(left.history.dateLocal) || (left.history.bestRank ?? Number.MAX_SAFE_INTEGER) - (right.history.bestRank ?? Number.MAX_SAFE_INTEGER) || left.history.historyId.localeCompare(right.history.historyId));
  }
  function upcomingPlanning(store, todayKey) {
    return Object.values(store.planning).filter((item) => (item.saved || item.held) && item.currentSnapshot.dateLocal >= todayKey).sort((left, right) => left.currentSnapshot.dateLocal.localeCompare(right.currentSnapshot.dateLocal) || left.currentSnapshot.title.localeCompare(right.currentSnapshot.title));
  }
  function dismissHistory(store, historyId, now) {
    if (store.historyResponses[historyId]) return store;
    return {
      ...store,
      historyResponses: {
        ...store.historyResponses,
        [historyId]: { historyId, state: "dismissed", feedbackId: null, respondedAt: now }
      }
    };
  }
  function confirmHistoryFeedback(store, history, status, { now, uuid }) {
    if (store.historyResponses[history.historyId] || !history.feedbackSnapshotId || history.vertical === "movies") return store;
    const result = createFeedbackRecord(store, {
      feedbackSnapshotId: history.feedbackSnapshotId,
      canonicalEventId: history.canonicalEventId,
      eventDateLocal: history.dateLocal,
      eventTitleSnapshot: history.title,
      vertical: history.vertical
    }, status, { now, uuid });
    const feedbackId = feedbackForHistory(result, history)?.record.feedbackId ?? null;
    return {
      ...result,
      historyResponses: {
        ...result.historyResponses,
        [history.historyId]: { historyId: history.historyId, state: "resolved", feedbackId, respondedAt: now }
      }
    };
  }
  function recordNotForMe(store, snapshot, options) {
    return createFeedbackRecord(store, snapshot, "skipped-no-longer-interested", options);
  }
  function hasFeedbackForSnapshot(store, snapshot) {
    if (!snapshot) return false;
    return Object.values(store.records).some(({ record }) => record.feedbackSnapshotId === snapshot.feedbackSnapshotId || record.canonicalEventId === snapshot.canonicalEventId && record.eventDateLocal === snapshot.eventDateLocal);
  }
  function createFeedbackRecord(store, snapshot, status, { now, uuid }) {
    if (hasFeedbackForSnapshot(store, snapshot)) return store;
    const feedbackId = `site-${uuid}`;
    const record = {
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
      recordedAt: now
    };
    return { ...store, records: { ...store.records, [feedbackId]: { record, firstExportTriggeredAt: null, exportBatchId: null } } };
  }
  function feedbackForHistory(store, item) {
    return Object.values(store.records).find(({ record }) => record.feedbackSnapshotId === item.feedbackSnapshotId || record.canonicalEventId === item.canonicalEventId && record.eventDateLocal === item.dateLocal) ?? null;
  }
  function isPlanned(store, item) {
    return Object.values(store.planning).some((planning) => (planning.itemId === item.canonicalEventId || planning.currentFeedbackSnapshot?.canonicalEventId === item.canonicalEventId) && planning.currentSnapshot.dateLocal === item.dateLocal && (planning.saved || planning.held));
  }
  function historySurfacePriority(surfaces) {
    if (surfaces.includes("overview")) return 0;
    if (surfaces.includes("plan-ahead")) return 1;
    return 2;
  }
  function unexportedRecords(store) {
    return sortRecords(Object.values(store.records).filter((entry) => entry.firstExportTriggeredAt == null));
  }
  function prepareExportBatch(store, { now, uuid, all = false }) {
    const entries = all ? sortRecords(Object.values(store.records)) : unexportedRecords(store);
    if (!entries.length) return { store, batch: null, jsonl: "" };
    const batch = {
      exportBatchId: `batch-${uuid}`,
      feedbackIds: entries.map((entry) => entry.record.feedbackId),
      preparedAt: now,
      downloadTriggeredAt: null
    };
    return {
      store: { ...store, exportBatches: { ...store.exportBatches, [batch.exportBatchId]: batch } },
      batch,
      jsonl: serializeRecords(entries.map((entry) => entry.record))
    };
  }
  function markBatchDownloadTriggered(store, batchId, now) {
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
      exportBatches: { ...store.exportBatches, [batchId]: { ...batch, downloadTriggeredAt: now } }
    };
  }
  function lastTriggeredBatch(store) {
    return Object.values(store.exportBatches).filter((batch) => batch.downloadTriggeredAt != null).sort((left, right) => String(right.downloadTriggeredAt).localeCompare(String(left.downloadTriggeredAt)))[0] ?? null;
  }
  function serializeBatch(store, batch) {
    const records = batch.feedbackIds.map((feedbackId) => store.records[feedbackId]?.record).filter((record) => Boolean(record));
    return serializeRecords(records);
  }
  function serializeRecords(records) {
    return [...records].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.feedbackId.localeCompare(right.feedbackId)).map((record) => JSON.stringify(record)).join("\n") + "\n";
  }
  function generateUuid() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch {
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function migrateLegacyStore(input) {
    if (!input || input.version !== 1) return emptyStore();
    const planning = {};
    for (const [itemId, item] of Object.entries(asRecord(input.planning))) {
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
        lastReconciledAt: item.lastReconciledAt ?? null
      };
    }
    return {
      version: 2,
      planning,
      historyResponses: {},
      records: asRecord(input.records),
      exportBatches: asRecord(input.exportBatches)
    };
  }
  function sortRecords(entries) {
    return [...entries].sort((left, right) => left.record.recordedAt.localeCompare(right.record.recordedAt) || left.record.feedbackId.localeCompare(right.record.feedbackId));
  }
  function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  // site/app/feedback-context.tsx
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var FeedbackContext = (0, import_react.createContext)(null);
  function useFeedback() {
    return (0, import_react.useContext)(FeedbackContext);
  }
  function storage() {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  }
  function FeedbackProvider({ projectionItems, recentHistory, todayKey, children }) {
    const [ready, setReady] = (0, import_react.useState)(false);
    const [store, setStore] = (0, import_react.useState)(emptyStore);
    (0, import_react.useEffect)(() => {
      const loaded = reconcileWithProjection(loadStore(storage()), projectionItems, (/* @__PURE__ */ new Date()).toISOString());
      setStore(loaded);
      saveStore(storage(), loaded);
      setReady(true);
    }, []);
    const update = (0, import_react.useCallback)((next) => {
      setStore(next);
      saveStore(storage(), next);
    }, []);
    const value = (0, import_react.useMemo)(() => {
      const queue = recentRecommendationQueue(store, recentHistory, todayKey);
      const triggerDownload = (jsonl) => {
        const blob = new Blob([jsonl], { type: "application/jsonl" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `feedback-inbox-${todayKey}.jsonl`;
        anchor.click();
        URL.revokeObjectURL(url);
      };
      const runExport = (all) => {
        const prepared = prepareExportBatch(store, { now: (/* @__PURE__ */ new Date()).toISOString(), uuid: generateUuid(), all });
        if (!prepared.batch) return;
        triggerDownload(prepared.jsonl);
        update(markBatchDownloadTriggered(prepared.store, prepared.batch.exportBatchId, (/* @__PURE__ */ new Date()).toISOString()));
      };
      return {
        ready,
        store,
        planningFor: (itemId) => store.planning[itemId] ?? null,
        setIntent: (input, intent, active) => update(setPlanningIntent(store, input, intent, active, (/* @__PURE__ */ new Date()).toISOString())),
        notForMe: (snapshot) => update(recordNotForMe(store, snapshot, { now: (/* @__PURE__ */ new Date()).toISOString(), uuid: generateUuid() })),
        hasOutcome: (snapshot) => hasFeedbackForSnapshot(store, snapshot),
        checkIn: (history, status) => update(confirmHistoryFeedback(store, history, status, { now: (/* @__PURE__ */ new Date()).toISOString(), uuid: generateUuid() })),
        dismiss: (historyId) => update(dismissHistory(store, historyId, (/* @__PURE__ */ new Date()).toISOString())),
        queue,
        upcoming: upcomingPlanning(store, todayKey),
        pendingCount: queue.filter((entry) => entry.eligible).length,
        unexportedCount: unexportedRecords(store).length,
        exportNew: () => runExport(false),
        exportAll: () => runExport(true),
        redownloadLast: () => {
          const batch = lastTriggeredBatch(store);
          if (batch) triggerDownload(serializeBatch(store, batch));
        },
        hasTriggeredBatch: lastTriggeredBatch(store) != null
      };
    }, [ready, recentHistory, store, todayKey, update]);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FeedbackContext.Provider, { value, children });
  }

  // site/app/card-actions.tsx
  var import_jsx_runtime2 = __toESM(require_react_shim(), 1);
  function CardActions({ layout, planning, calendarEvent }) {
    const feedback = useFeedback();
    const [confirmingNegative, setConfirmingNegative] = (0, import_react2.useState)(false);
    const item = planning && feedback?.ready ? feedback.planningFor(planning.planningSnapshot.itemId) : null;
    const saved = item?.saved ?? false;
    const held = item?.held ?? false;
    const outcomeRecorded = feedback?.hasOutcome(planning?.feedbackSnapshot ?? null) ?? false;
    const canPlan = Boolean(planning?.planningSnapshot.dateLocal) && feedback?.ready;
    const holdDate = () => {
      if (planning && feedback?.ready) feedback.setIntent(planning, "held", true);
      if (!calendarEvent) return;
      const ics = buildCalendarEvent(calendarEvent);
      if (!ics) return;
      const blob = new Blob([ics], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = calendarFilename(calendarEvent.title);
      anchor.click();
      URL.revokeObjectURL(url);
    };
    if (!planning && !calendarEvent) return null;
    const stateLabel = outcomeRecorded ? "Feedback added" : saved && held ? "Saved \xB7 Held" : saved ? "Saved" : held ? "Held" : null;
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: `cardActions cardActions-${layout}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("summary", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "Plan" }),
        stateLabel ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: stateLabel }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cardActionsMenu", children: [
        planning ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_jsx_runtime2.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            "aria-pressed": saved,
            className: saved ? "cardAction actionActive" : "cardAction",
            disabled: !canPlan,
            onClick: () => feedback?.setIntent(planning, "saved", !saved),
            type: "button",
            children: saved ? "Saved" : "Save"
          }
        ) }) : null,
        calendarEvent ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { "aria-pressed": held, className: held ? "cardAction actionActive" : "cardAction", onClick: holdDate, type: "button", children: held ? "Held" : "Hold date" }) : null,
        planning?.feedbackSnapshot && !outcomeRecorded && !confirmingNegative ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "cardAction cardActionQuiet", onClick: () => setConfirmingNegative(true), type: "button", children: "Not for me" }) : null,
        planning?.feedbackSnapshot && confirmingNegative ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "cardActionConfirm", role: "group", "aria-label": "Confirm Not for me", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "Create negative taste feedback?" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { onClick: () => {
            feedback?.notForMe(planning.feedbackSnapshot);
            setConfirmingNegative(false);
          }, type: "button", children: "Confirm" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { onClick: () => setConfirmingNegative(false), type: "button", children: "Cancel" })
        ] }) : null,
        outcomeRecorded ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "cardActionResolved", children: "Taste feedback recorded" }) : null
      ] })
    ] });
  }
  function planningInputFrom(vertical, item) {
    const dateLocal = (item.startLocal ?? item.releaseDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) return null;
    return {
      planningSnapshot: {
        itemId: item.id,
        title: item.title,
        dateLocal,
        vertical,
        locationLabel: locationLabel(item.venue)
      },
      feedbackSnapshot: vertical === "movies" ? null : item.feedbackSnapshot ?? null
    };
  }
  function calendarInputFrom(item) {
    const startLocal = item.startLocal ?? null;
    const dateLocal = (startLocal ?? item.releaseDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) return null;
    const timed = Boolean(startLocal && !item.timeTbd && /T\d{2}:\d{2}/.test(startLocal));
    return {
      uid: item.id,
      title: item.title,
      startLocal: timed ? startLocal : null,
      dateLocal,
      allDay: !timed,
      locationLabel: locationLabel(item.venue),
      description: item.description ?? null,
      url: item.sourceUrl ?? null
    };
  }
  function locationLabel(venue) {
    if (!venue) return null;
    return [venue.name, venue.city].filter(Boolean).join(" \xB7 ") || null;
  }

  // site/app/changes-strip.tsx
  init_define_import_meta_env();
  var import_jsx_runtime3 = __toESM(require_react_shim(), 1);
  function ChangesStrip({ changes }) {
    if (!changes) return null;
    const shortlistedIn = [...changes.overview.added, ...changes.newlyShortlisted];
    const parts = [
      countPhrase(shortlistedIn.length + changes.planAhead.added.length, "newly shortlisted"),
      countPhrase(changes.overview.removed.length + changes.planAhead.removed.length, "left the shortlist"),
      ...changes.urgencyUpgrades.slice(0, 2).map((item) => `${item.title} moved to ${capitalize(item.after)}`)
    ].filter(Boolean);
    if (!parts.length && !changes.overview.reordered) return null;
    const since = changes.previousGeneratedAt ? new Date(changes.previousGeneratedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }) : "the previous refresh";
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "changesStrip", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { children: [
        "Since ",
        since,
        ": ",
        parts.length ? parts.join(" \xB7 ") : "shortlist order changed"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "changesDetail", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ChangeList, { items: shortlistedIn, label: "Newly shortlisted" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ChangeList, { items: changes.planAhead.added, label: "Added to Plan Ahead" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ChangeList, { items: [...changes.overview.removed, ...changes.planAhead.removed], label: "Left the shortlist" }),
        changes.urgencyUpgrades.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Urgency" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { children: changes.urgencyUpgrades.map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { children: [
            item.title,
            ": ",
            item.before,
            " \u2192 ",
            item.after
          ] }, item.id)) })
        ] }) : null
      ] })
    ] });
  }
  function ChangeList({ items, label }) {
    if (!items.length) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("li", { children: item.title }, `${item.vertical}:${item.id}`)) })
    ] });
  }
  function countPhrase(count, label) {
    return count ? `${count} ${label}` : "";
  }
  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  // site/app/event-explorer.tsx
  init_define_import_meta_env();
  var import_react4 = __toESM(require_react_shim(), 1);

  // site/app/advisories.ts
  init_define_import_meta_env();
  var NO_INFORMATION_ADVISORY = /\b(cannot|can't|impossible to|unable to|insufficient|no specific|not enough|lack(?:s|ing)? (?:of )?(?:artist|venue|genre|presentation|specific)|not provided|no .{0,24}(?:data|detail|information)s? provided)\b/i;
  function isGroundedAdvisory(entry) {
    return Boolean(entry?.explanation) && !NO_INFORMATION_ADVISORY.test(entry.explanation);
  }

  // site/app/filter-disclosure.tsx
  init_define_import_meta_env();
  var import_react3 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime4 = __toESM(require_react_shim(), 1);
  function FilterDisclosure({ children, count = 0 }) {
    const [open, setOpen] = (0, import_react3.useState)(false);
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: `filterDisclosure ${open ? "isOpen" : ""}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { "aria-expanded": open, className: "filterDisclosureToggle", onClick: () => setOpen((value) => !value), type: "button", children: [
        "Filters",
        count ? ` (${count})` : "",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": "true", children: "\uFF0B" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "filterDisclosureBody", children })
    ] });
  }

  // site/app/recommendation-visual.tsx
  init_define_import_meta_env();
  var import_jsx_runtime5 = __toESM(require_react_shim(), 1);
  function RecommendationVisual({ visual, className = "" }) {
    const value = visual ?? { kind: "none" };
    const focalPoint = normalizeFocalPoint(value.focalPoint);
    const style = {
      backgroundPosition: `${focalPoint.x}% ${focalPoint.y}%`
    };
    if (value.kind === "image" && value.url) {
      style.backgroundImage = `url("${String(value.url).replaceAll('"', "%22")}")`;
    }
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "div",
      {
        "aria-hidden": value.kind !== "image" || !value.alt ? true : void 0,
        "aria-label": value.kind === "image" ? value.alt : void 0,
        className: `recommendationVisual ${className}`.trim(),
        "data-attribution": value.attribution ?? void 0,
        "data-kind": value.kind,
        "data-variant": value.variant ?? "none",
        role: value.kind === "image" && value.alt ? "img" : void 0,
        style
      }
    );
  }
  function normalizeFocalPoint(value) {
    return {
      x: clamp(value?.x),
      y: clamp(value?.y)
    };
  }
  function clamp(value) {
    if (value == null || value === "") return 50;
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 50;
  }

  // site/app/event-explorer.tsx
  var import_jsx_runtime6 = __toESM(require_react_shim(), 1);
  function EventExplorer({ events, generatedAt }) {
    const [windowFilter, setWindowFilter] = (0, import_react4.useState)("soon");
    const [eventType, setEventType] = (0, import_react4.useState)("all");
    const [provider, setProvider] = (0, import_react4.useState)("all");
    const [sortMode, setSortMode] = (0, import_react4.useState)("fit");
    const [lowHassleOnly, setLowHassleOnly] = (0, import_react4.useState)(false);
    const [urgentOnly, setUrgentOnly] = (0, import_react4.useState)(false);
    const [showAll, setShowAll] = (0, import_react4.useState)(false);
    const generated = (0, import_react4.useMemo)(() => new Date(generatedAt), [generatedAt]);
    const filtered = (0, import_react4.useMemo)(() => {
      const result = events.filter((event) => {
        const start = event.startLocal ? new Date(event.startLocal) : null;
        const daysAway = start ? (start.getTime() - generated.getTime()) / 864e5 : Number.POSITIVE_INFINITY;
        if (windowFilter === "soon" && daysAway > 30) return false;
        if (windowFilter === "later" && daysAway <= 30) return false;
        if (eventType !== "all" && (event.eventType ?? "concert") !== eventType) return false;
        if (provider !== "all" && !(event.sources ?? []).includes(provider)) return false;
        if (lowHassleOnly && event.ranking.hassleScore > 4) return false;
        if (urgentOnly && !["buy now", "watch"].includes(event.ranking.urgency)) return false;
        return true;
      });
      return result.sort(eventComparator(sortMode));
    }, [eventType, events, generated, lowHassleOnly, provider, sortMode, urgentOnly, windowFilter]);
    const groups = (0, import_react4.useMemo)(() => collateEvents(filtered), [filtered]);
    const visibleGroups = showAll ? groups : groups.slice(0, 8);
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "explorer", "aria-label": "Ranked upcoming concerts", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "filterBar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dateFilterGroup", "aria-label": "Date range filter", children: [["all", "All dates"], ["soon", "Next 30 days"], ["later", "Later"]].map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { "aria-pressed": windowFilter === value, className: windowFilter === value ? "filterActive" : "", onClick: () => {
          setWindowFilter(value);
          setShowAll(false);
        }, type: "button", children: label }, value)) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(FilterDisclosure, { count: [eventType !== "all", provider !== "all", sortMode !== "fit", urgentOnly, lowHassleOnly].filter(Boolean).length, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "selectControl", children: [
            "Type",
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": "Music event type", onChange: (event) => setEventType(event.target.value), value: eventType, children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "all", children: "All" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "concert", children: "Concerts" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "festival", children: "Festivals" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "dj set", children: "DJ sets" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "selectControl", children: [
            "Provider",
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": "Music event provider", onChange: (event) => setProvider(event.target.value), value: provider, children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "all", children: "All" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "seatgeek", children: "SeatGeek" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "ticketmaster", children: "Ticketmaster" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "framework", children: "Framework" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "insomniac", children: "Insomniac" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "selectControl", children: [
            "Sort",
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": "Music event sort order", onChange: (event) => setSortMode(event.target.value), value: sortMode, children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "fit", children: "Personal fit" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "date", children: "Date" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "urgency", children: "Urgency" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "hassle", children: "Lowest hassle" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "hassleToggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { checked: urgentOnly, onChange: (event) => setUrgentOnly(event.target.checked), type: "checkbox" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: "Urgent" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "hassleToggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { checked: lowHassleOnly, onChange: (event) => setLowHassleOnly(event.target.checked), type: "checkbox" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: "Low hassle" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "resultCount", children: [
          showAll ? groups.length : Math.min(groups.length, 8),
          " of ",
          groups.length,
          " entries \xB7 ",
          filtered.length,
          " dates"
        ] })
      ] }),
      groups.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "eventGrid", children: visibleGroups.map((group, index) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(EventCard, { event: group[0], featured: index === 0 && sortMode === "fit", occurrences: group }, groupKey(group[0]))) }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "emptyState", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "eyebrow", children: "Good filter" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: "Nothing clears that bar yet." }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: "That is a useful answer. Try widening timing, type, urgency, or hassle." })
      ] }),
      groups.length > 8 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { className: "showMore", onClick: () => setShowAll((value) => !value), type: "button", children: showAll ? "Show top 8" : `Show all ${groups.length}` }) : null
    ] });
  }
  function EventCard({ event, featured, occurrences }) {
    const date = event.startLocal ? new Date(event.startLocal) : null;
    const price = event.ticketObservation.lowestPriceUsd;
    const urgencyClass = event.ranking.urgency === "buy now" ? "urgent" : "";
    const origin = event.matchedArtists[0]?.origin ?? "source";
    const originLabel = origin === "similar" ? "Similar artist" : origin === "tag" ? "Genre discovery" : origin === "promoter" ? "Promoter pick" : "In your rotation";
    const enhancement = event.localEnhancement;
    const lineup = event.lineupDisplay;
    const displayTitle = lineup?.displayTitle || event.title;
    const lineupPreview = lineup?.orderedArtists.filter((artist) => artist.relation !== "unknown" && !displayTitle.toLocaleLowerCase().includes(artist.displayName.toLocaleLowerCase())).slice(0, 3) ?? [];
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("article", { className: `eventCard ${featured ? "eventFeatured" : "eventCompact"}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RecommendationVisual, { className: "eventVisual", visual: event.visual }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "eventTopline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "eventDate", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: date ? date.toLocaleDateString("en-US", { month: "short" }).toUpperCase() : "TBD" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: date ? date.getDate() : "\u2014" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "eventSignals", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: event.eventType ?? "concert" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: `origin-${origin}`, children: originLabel }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: urgencyClass, children: event.ranking.urgency })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "eventBody", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "eventPlace", children: [
          event.venue.name,
          " \xB7 ",
          event.venue.city,
          " ",
          event.sources?.length ? `\xB7 ${event.sources.map(providerLabel).join(" + ")}` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: displayTitle }),
        lineupPreview.length ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "lineupPreview", children: [
          "Taste matches in the lineup: ",
          lineupPreview.map((artist) => artist.displayName).join(" \xB7 ")
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "eventWhy", children: event.ranking.whyYou }),
        enhancement ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(LocalTake, { enhancement }) : null,
        lineup && lineup.totalArtists > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(LineupDetails, { lineup }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "scoreBlock", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "scoreLabel", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: "Deterministic fit" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: event.ranking.artistFit })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "scoreTrack", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { width: `${event.ranking.artistFit}%` } }) })
      ] }),
      occurrences.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("details", { className: "occurrenceList", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("summary", { children: [
          "View all ",
          occurrences.length,
          " dates"
        ] }),
        collateOccurrenceRows(occurrences).map((row) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "occurrenceRow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: row.date ? row.date.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" }) : "Date TBD" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: row.venue }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "occurrenceLinks", children: row.links.map((link) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("a", { href: link.url, rel: "noreferrer", target: "_blank", children: [
            providerLabel(link.source),
            " \u2197"
          ] }, `${link.source}|${link.url}`)) })
        ] }, row.key))
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "eventFooter", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
          date && !event.timeTbd ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "signalAbsent", children: "Time TBD" }),
          price == null ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
            "From $",
            price
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          CardActions,
          {
            calendarEvent: calendarInputFrom({ ...event, title: displayTitle, description: event.ranking.whyYou }),
            layout: "music",
            planning: planningInputFrom("music", { ...event, title: displayTitle })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("a", { href: event.sourceUrl, rel: "noreferrer", target: "_blank", children: [
          "View tickets ",
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": "true", children: "\u2197" })
        ] })
      ] })
    ] });
  }
  function LineupDetails({ lineup }) {
    const groups = /* @__PURE__ */ new Map();
    for (const artist of lineup.orderedArtists) groups.set(artist.billingGroupIndex, [...groups.get(artist.billingGroupIndex) ?? [], artist]);
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("details", { className: "lineupDetails", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("summary", { children: [
        "View lineup (",
        lineup.totalArtists,
        ")"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "lineupGroups", children: [
        [...groups.entries()].map(([index, artists]) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: artists.map((artist) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: `lineup-${artist.relation}`, children: artist.displayName }, artist.lineupEntryId)).reduce((items, artist, artistIndex) => artistIndex ? [...items, /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("b", { "aria-hidden": "true", children: " B2B " }, `sep-${index}-${artistIndex}`), artist] : [artist], []) }, index)),
        lineup.ages ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "lineupAges", children: [
          "Ages: ",
          lineup.ages
        ] }) : null,
        lineup.sourceUrl ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("a", { href: lineup.sourceUrl, rel: "noreferrer", target: "_blank", children: "Lineup via EDMTrain \u2197" }) : null
      ] })
    ] });
  }
  function LocalTake({ enhancement }) {
    const recommendation = enhancement.recommendation ?? enhancement.personalFit;
    const showLead = isGroundedAdvisory(recommendation);
    const details = [enhancement.personalFit, enhancement.urgency, enhancement.hassle].filter((entry) => entry && !NO_INFORMATION_ADVISORY.test(entry.explanation));
    if (!showLead && !details.length) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "localTake", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "eyebrow", children: "Taste Engine note" }),
      showLead && recommendation ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "localTakeLead", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: "verdict" in recommendation ? recommendation.verdict : recommendation.label }),
        " ",
        recommendation.explanation
      ] }) : null,
      details.length ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("summary", { children: "View fit and friction" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
          enhancement.personalFit && details.includes(enhancement.personalFit) ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("strong", { children: [
              "Fit ",
              enhancement.personalFit.score
            ] }),
            enhancement.personalFit.explanation
          ] }) : null,
          enhancement.urgency && details.includes(enhancement.urgency) ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: enhancement.urgency.label }),
            enhancement.urgency.explanation
          ] }) : null,
          enhancement.hassle && details.includes(enhancement.hassle) ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("strong", { children: [
              "Hassle ",
              enhancement.hassle.score,
              "/10"
            ] }),
            enhancement.hassle.explanation
          ] }) : null
        ] })
      ] }) : null
    ] });
  }
  function collateEvents(events) {
    const groups = /* @__PURE__ */ new Map();
    for (const event of events) {
      const key = groupKey(event);
      groups.set(key, [...groups.get(key) ?? [], event]);
    }
    return [...groups.values()];
  }
  function groupKey(event) {
    if ((event.eventType ?? "concert") === "festival") return event.id;
    const primary = event.matchedArtists.find((artist) => artist.primary) ?? event.matchedArtists[0];
    return primary ? `artist:${primary.name.toLocaleLowerCase()}` : `event:${event.id}`;
  }
  function collateOccurrenceRows(occurrences) {
    const rows = /* @__PURE__ */ new Map();
    for (const occurrence of occurrences) {
      const date = occurrence.startLocal ? new Date(occurrence.startLocal) : null;
      const dateKey = occurrence.startLocal ? String(occurrence.startLocal).slice(0, 10) : "tbd";
      const venue = occurrence.venue.name || occurrence.venue.city || "Venue TBD";
      const key = `${dateKey}|${venue.toLocaleLowerCase()}`;
      const row = rows.get(key) ?? { key, date, venue, links: [] };
      const links = occurrence.sourceLinks?.length ? occurrence.sourceLinks : [{ source: occurrence.sources?.[0] ?? "source", url: occurrence.sourceUrl }];
      for (const link of links) {
        if (link.url && !row.links.some((existing) => existing.source === link.source && existing.url === link.url)) row.links.push(link);
      }
      rows.set(key, row);
    }
    return [...rows.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  }
  function providerLabel(value) {
    return { seatgeek: "SeatGeek", ticketmaster: "Ticketmaster", framework: "Framework", insomniac: "Insomniac", source: "Source" }[value] ?? value;
  }
  function eventComparator(mode) {
    const urgency = (value) => ({ "buy now": 0, watch: 1, "safe to wait": 2 })[value] ?? 3;
    return (left, right) => {
      if (mode === "date") return String(left.startLocal).localeCompare(String(right.startLocal));
      if (mode === "urgency") return urgency(left.ranking.urgency) - urgency(right.ranking.urgency) || String(left.startLocal).localeCompare(String(right.startLocal));
      if (mode === "hassle") return left.ranking.hassleScore - right.ranking.hassleScore || right.ranking.artistFit - left.ranking.artistFit;
      return right.ranking.utility - left.ranking.utility || String(left.startLocal).localeCompare(String(right.startLocal));
    };
  }

  // site/app/movie-explorer.tsx
  init_define_import_meta_env();
  var import_react5 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime7 = __toESM(require_react_shim(), 1);
  function MovieExplorer({ movies, tmdbStatus, generatedAt }) {
    const [windowFilter, setWindowFilter] = (0, import_react5.useState)("soon");
    const [showAll, setShowAll] = (0, import_react5.useState)(false);
    const generated = (0, import_react5.useMemo)(() => new Date(generatedAt), [generatedAt]);
    const visibleMovies = (0, import_react5.useMemo)(() => movies.filter((movie) => {
      const date = movie.releaseDate ? /* @__PURE__ */ new Date(`${movie.releaseDate}T12:00:00`) : null;
      const daysAway = date ? (date.getTime() - generated.getTime()) / 864e5 : Number.POSITIVE_INFINITY;
      if (windowFilter === "soon" && daysAway > 30) return false;
      if (windowFilter === "later" && daysAway <= 30) return false;
      return true;
    }).sort((left, right) => Number(Boolean(right.premiumFormatConfirmed)) - Number(Boolean(left.premiumFormatConfirmed)) || tierRank(left.tasteTier) - tierRank(right.tasteTier) || String(left.releaseDate).localeCompare(String(right.releaseDate))), [generated, movies, windowFilter]);
    const displayedMovies = showAll ? visibleMovies : visibleMovies.slice(0, 6);
    const groups = [
      { key: "confirmed", label: "Confirmed locally", items: displayedMovies.filter((movie) => movie.premiumFormatConfirmed) },
      { key: "release", label: "Release watch", items: displayedMovies.filter((movie) => !movie.premiumFormatConfirmed && movie.releaseDate) },
      { key: "long", label: "Long lead", items: displayedMovies.filter((movie) => !movie.premiumFormatConfirmed && !movie.releaseDate) }
    ].filter((group) => group.items.length);
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "movieSection", id: "movies", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "movieIntro", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "eyebrow", children: "Second vertical \xB7 movies" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("h2", { children: [
            "Theatrical candidates.",
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("br", {}),
            "Format decides."
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "TMDB narrows upcoming releases against a film profile. A movie remains provisional until local discovery confirms the theater, presentation, and how quickly that premium run may disappear." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "movieControls", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "dateFilterGroup", "aria-label": "Movie date filter", children: [["all", "All dates"], ["soon", "Next 30 days"], ["later", "Later"]].map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { "aria-pressed": windowFilter === value, className: windowFilter === value ? "filterActive" : "", onClick: () => {
          setWindowFilter(value);
          setShowAll(false);
        }, type: "button", children: label }, value)) }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "resultCount", children: [
          showAll ? visibleMovies.length : Math.min(visibleMovies.length, 6),
          " of ",
          visibleMovies.length,
          " candidates"
        ] })
      ] }),
      groups.length ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "movieGroups", children: groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "movieGroup", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "movieGroupHeader", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "eyebrow", children: group.label }) }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "movieGrid", children: group.items.map((movie) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(MovieCard, { movie }, movie.id)) })
      ] }, group.key)) }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "movieEmpty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "eyebrow", children: [
          "Source status \xB7 ",
          tmdbStatus
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: "No movie cards are being guessed into the list." }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "Once TMDB is connected, only the refined film-profile shortlist will render here." })
      ] }),
      visibleMovies.length > 6 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { className: "showMore", onClick: () => setShowAll((value) => !value), type: "button", children: showAll ? "Show first 6" : `Show all ${visibleMovies.length} candidates` }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "tmdbAttribution", children: "This product uses the TMDB API but is not endorsed or certified by TMDB." })
    ] });
  }
  function tierRank(tier) {
    return tier === "strong" ? 0 : tier === "potential" || tier == null ? 1 : 2;
  }
  var TIER_LABELS = { strong: "Strong fit", potential: "Potential fit", stretch: "Stretch" };
  function MovieCard({ movie }) {
    const date = movie.releaseDate ? /* @__PURE__ */ new Date(`${movie.releaseDate}T12:00:00`) : null;
    const formatLabel = movie.premiumFormatConfirmed && movie.format ? movie.format : "Format watch";
    const tier = movie.premiumFormatConfirmed ? "strong" : movie.tasteTier ?? "potential";
    const tasteTier = TIER_LABELS[tier];
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("article", { className: `movieCard ${movie.premiumFormatConfirmed ? "movieConfirmed" : ""}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(RecommendationVisual, { className: "movieMedia", visual: movie.visual }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "movieCardContent", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "movieMeta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Date TBD" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: formatLabel })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: movie.title }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "movieCredits", children: [
          movie.directors.length ? `Directed by ${movie.directors.join(", ")}` : "Director metadata pending",
          movie.runtimeMinutes ? ` \xB7 ${movie.runtimeMinutes} min` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: movie.reasons[0] ?? movie.overview }),
        movie.theater ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "movieTheater", children: [
          movie.theater,
          movie.format ? ` \xB7 ${movie.format}` : ""
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "movieScore", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: "Taste tier" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { className: `tier-${tier}`, children: tasteTier })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "movieCardFooter", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            CardActions,
            {
              calendarEvent: calendarInputFrom({ ...movie, startLocal: null, description: movie.reasons[0] ?? movie.overview }),
              layout: "movie",
              planning: planningInputFrom("movies", movie)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("a", { href: movie.sourceUrl, rel: "noreferrer", target: "_blank", children: [
            "Details ",
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { "aria-hidden": "true", children: "\u2192" })
          ] })
        ] })
      ] })
    ] });
  }

  // site/app/overview-explorer.tsx
  init_define_import_meta_env();
  var import_jsx_runtime8 = __toESM(require_react_shim(), 1);
  function OverviewExplorer({ overview, planAhead, generatedAt, projectionGeneratedAt, editorial, dateAwareRefresh = false, changesSinceRefresh = null }) {
    const liveEditorial = editorial ? {
      ...editorial,
      lead: dateAwareRefresh ? dropStaleSentences(editorial.lead) : editorial.lead,
      skipCall: dateAwareRefresh ? dropStaleSentences(editorial.skipCall) : editorial.skipCall
    } : void 0;
    const headline = formatEditorialHeadline(liveEditorial?.headline ?? (overview.length ? "Worth making a plan for." : "Don't waste your time this weekend."));
    const lead = formatEditorialCopy(liveEditorial?.lead || "The short list is intentionally small; the verticals retain the full evidence when you want to explore.");
    const asOfDate = new Date(projectionGeneratedAt ?? generatedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" });
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "overviewSection", "aria-label": "Current music and sports shortlist", id: "overview-feed", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "overviewIntro", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "eyebrow", children: [
            "Current call \xB7 next 14 days \xB7 ",
            dateAwareRefresh ? "as of" : "refreshed",
            " ",
            asOfDate
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h2", { children: headline })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "overviewVerdictCopy", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: lead }),
          liveEditorial?.skipCall ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "overviewSkip", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("strong", { children: "Skip call" }),
            " ",
            formatEditorialCopy(liveEditorial.skipCall)
          ] }) : null
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(ChangesStrip, { changes: changesSinceRefresh }),
      overview.length ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "overviewGrid", children: overview.slice(0, 5).map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(OverviewCard, { item, index }, item.id)) }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "overviewEmpty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "eyebrow", children: "Current window" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: liveEditorial?.verdict === "do not waste your time" ? "Don't waste your time this weekend." : "Nothing clears the current bar yet." }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: liveEditorial?.skipCall ?? "The full vertical views remain available when you want to inspect the evidence." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "planAhead", "aria-label": "Plan ahead recommendations", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "planAheadIntro", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "eyebrow", children: "Plan ahead" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: "Exceptional longer-lead dates, kept separate from the current call." })
        ] }),
        planAhead.length ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "planAheadGrid", children: planAhead.slice(0, 3).map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(OverviewCard, { item, index, planAhead: true }, item.id)) }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "planAheadEmpty", children: "No later date currently clears the planning bar." })
      ] }),
      dateAwareRefresh ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "overviewRefreshNote", children: "Past dates are hidden automatically as the calendar moves forward. Refresh the projection when you want new source coverage." }) : null
    ] });
  }
  var STALE_REFERENCE = /\b(today|tonight|this (?:morning|afternoon|evening|weekend|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|immediate(?:ly)? option)\b/i;
  function dropStaleSentences(copy) {
    if (!copy) return copy ?? "";
    const sentences = copy.match(/[^.!?]+[.!?]*\s*/g) ?? [copy];
    return sentences.filter((sentence) => !STALE_REFERENCE.test(sentence)).join("").trim();
  }
  function OverviewCard({ item, index, planAhead = false }) {
    const verticalLabel = item.vertical === "sports" ? "Sports" : item.vertical === "movies" ? "Movies" : "Music";
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("article", { className: `overviewCard overviewRank-${index + 1} ${index === 0 && !planAhead ? `overviewFeatured overviewFeatured-${item.vertical}` : ""} ${planAhead ? "planAheadCard" : ""}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(RecommendationVisual, { className: "overviewVisual", visual: item.visual }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: `verticalBadge overviewCardBadge vertical-${item.vertical}`, children: verticalLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "feature-card__content overviewCardContent", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "overviewTopline", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "overviewNumber", children: String(index + 1).padStart(2, "0") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "overviewDate", children: formatLocalDate(item.startLocal) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: formatEditorialTitle(item.title) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "overviewPlace", children: [
          item.venue?.name ?? "Venue TBD",
          " \xB7 ",
          item.venue?.city ?? "Los Angeles"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "overviewReason", children: item.reason }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "overviewUtility", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "overviewUtilitySignals", "aria-label": "Recommendation signals", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: item.call ?? callLabel(item.score) }),
            item.hassleScore == null ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
              "Hassle ",
              item.hassleScore,
              "/10"
            ] }),
            item.urgency ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: item.urgency }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("a", { className: "overviewUtilityCta", href: `#${item.vertical}`, children: [
            "View in ",
            verticalLabel,
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { "aria-hidden": "true", children: "\u2192" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            CardActions,
            {
              calendarEvent: calendarInputFrom({ ...item, description: item.reason }),
              layout: "overview",
              planning: item.vertical === "movies" ? null : planningInputFrom(item.vertical, item)
            }
          )
        ] })
      ] })
    ] });
  }
  function formatEditorialTitle(title) {
    return title.replace(/\bJOJI\b/gi, "Joji");
  }
  function formatEditorialCopy(copy) {
    return copy.replace(/\bJOJI\b/gi, "Joji");
  }
  function formatEditorialHeadline(headline) {
    const normalized = headline.trim();
    if (!normalized) return normalized;
    const proper = /* @__PURE__ */ new Map([
      ["joji", "Joji"],
      ["tmdb", "TMDB"],
      ["mlb", "MLB"],
      ["dodgers", "Dodgers"],
      ["framework", "Framework"],
      ["ticketmaster", "Ticketmaster"],
      ["seatgeek", "SeatGeek"],
      ["ollama", "Ollama"],
      ["gemma", "Gemma"],
      ["last.fm", "Last.fm"]
    ]);
    return normalized.split(/(\s+)/).map((token, index) => {
      if (/^\s+$/.test(token)) return token;
      const match = token.match(/^([^A-Za-z0-9]*)([A-Za-z0-9.'’-]+)([^A-Za-z0-9]*)$/);
      if (!match) return token;
      const [, prefix, core, suffix] = match;
      const known = proper.get(core.toLowerCase());
      if (known) return `${prefix}${known}${suffix}`;
      const sentenceCore = core.toLowerCase();
      const rendered = index === 0 ? sentenceCore.charAt(0).toUpperCase() + sentenceCore.slice(1) : sentenceCore;
      return `${prefix}${rendered}${suffix}`;
    }).join("");
  }
  function formatLocalDate(value) {
    if (!value) return "Date TBD";
    const dateKey = value.slice(0, 10);
    const stableDate = /* @__PURE__ */ new Date(`${dateKey}T12:00:00Z`);
    return stableDate.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  }
  function callLabel(score) {
    if (score >= 75) return "Strong fit";
    if (score >= 55) return "Selective";
    if (score >= 40) return "Wildcard";
    return "Watch";
  }

  // site/app/sports-explorer.tsx
  init_define_import_meta_env();
  var import_react6 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime9 = __toESM(require_react_shim(), 1);
  function SportsExplorer({ games, generatedAt, featuredThreshold = 70 }) {
    const [windowFilter, setWindowFilter] = (0, import_react6.useState)("all");
    const [sortMode, setSortMode] = (0, import_react6.useState)("interest");
    const [ticketFilter, setTicketFilter] = (0, import_react6.useState)("all");
    const [rivalryOnly, setRivalryOnly] = (0, import_react6.useState)(false);
    const [showAll, setShowAll] = (0, import_react6.useState)(false);
    const generated = (0, import_react6.useMemo)(() => new Date(generatedAt), [generatedAt]);
    const filtered = (0, import_react6.useMemo)(() => games.filter((game) => {
      const date = game.startLocal ? new Date(game.startLocal) : null;
      const daysAway = date ? (date.getTime() - generated.getTime()) / 864e5 : Number.POSITIVE_INFINITY;
      if (windowFilter === "soon" && daysAway > 30) return false;
      if (windowFilter === "later" && daysAway <= 30) return false;
      if (ticketFilter === "ticketed" && !game.ticketObservations.length) return false;
      if (ticketFilter === "unknown" && game.ticketObservations.length) return false;
      if (rivalryOnly && game.sportsContext.rivalryTier === "none") return false;
      return true;
    }).sort(gameComparator(sortMode)), [games, generated, rivalryOnly, sortMode, ticketFilter, windowFilter]);
    const series = (0, import_react6.useMemo)(() => groupSeries(filtered), [filtered]);
    const visibleSeries = showAll ? series : series.slice(0, 3);
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "sportsSection", "aria-label": "Dodgers sports schedule", id: "sports-feed", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "sportsIntro", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "eyebrow", children: "Third vertical \xB7 Dodgers" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: "Best games to attend." })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: "MLB defines the game. Standings, rivalries, pitching, timing, and hassle decide whether this particular date is worth the trip. Ticket links are additive; missing ticket coverage stays visible as unknown." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "sportsControls", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dateFilterGroup", "aria-label": "Sports date filter", children: [["all", "All dates"], ["soon", "Next 30 days"], ["later", "Later"]].map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { "aria-pressed": windowFilter === value, className: windowFilter === value ? "filterActive" : "", onClick: () => {
          setWindowFilter(value);
          setShowAll(false);
        }, type: "button", children: label }, value)) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(FilterDisclosure, { count: [sortMode !== "interest", ticketFilter !== "all", rivalryOnly].filter(Boolean).length, children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "selectControl", children: [
            "Sort",
            /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("select", { "aria-label": "Sports sort order", onChange: (event) => setSortMode(event.target.value), value: sortMode, children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "interest", children: "Interest" }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "date", children: "Date" }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "hassle", children: "Lowest hassle" }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "urgency", children: "Ticket urgency" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "selectControl", children: [
            "Tickets",
            /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("select", { "aria-label": "Sports ticket coverage", onChange: (event) => setTicketFilter(event.target.value), value: ticketFilter, children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "all", children: "All" }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "ticketed", children: "Ticket link" }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "unknown", children: "Unknown" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "hassleToggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("input", { checked: rivalryOnly, onChange: (event) => setRivalryOnly(event.target.checked), type: "checkbox" }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: "Rivalries" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "resultCount", children: [
          showAll ? series.length : Math.min(series.length, 3),
          " of ",
          series.length,
          " series \xB7 ",
          filtered.length,
          " games"
        ] })
      ] }),
      series.length ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "sportsSeriesGrid", children: visibleSeries.map((group, index) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(SeriesCard, { games: group, isFeatured: index === 0, featuredThreshold }, group[0].series.id ?? group[0].id)) }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "sportsEmpty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "eyebrow", children: "Source status" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "No Dodgers games match this filter." }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: "Try widening the date, rivalry, or ticket view." })
      ] }),
      series.length > 3 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { className: "showMore", onClick: () => setShowAll((value) => !value), type: "button", children: showAll ? "Show top 3 series" : `Show all ${series.length} series` }) : null
    ] });
  }
  function SeriesCard({ games, featuredThreshold, isFeatured }) {
    const featured = games.filter((game) => game.ranking.interestScore >= featuredThreshold);
    const shown = featured.length ? featured : games.slice(0, 1);
    const opponent = friendlyOpponentName(games[0].awayTeam);
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("article", { className: `seriesCard ${isFeatured ? "seriesFeatured" : "seriesCompact"}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(RecommendationVisual, { className: "seriesVisual", visual: games[0].visual }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "seriesHeader", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "eyebrow", children: games[0].series.gameCount ? `${games[0].series.gameCount}-game series` : "Dodgers home series" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: opponent }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: games[0].tags.slice(0, 3).join(" \xB7 ") || "Regular-season home games" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("strong", { children: Math.max(...games.map((game) => game.ranking.interestScore)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "seriesGames", children: shown.map((game) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(GameRow, { game }, game.id)) }),
      games.length > shown.length ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("details", { className: "seriesDetails", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("summary", { children: [
          "View all ",
          games.length,
          " games"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "seriesGames", children: games.filter((game) => !shown.some((shownGame) => shownGame.id === game.id)).map((game) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(GameRow, { game }, game.id)) })
      ] }) : null
    ] });
  }
  function GameRow({ game }) {
    const date = game.startLocal ? new Date(game.startLocal) : null;
    const pitchers = game.sportsContext.probablePitchers;
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "gameRow", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "gameDate", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: date ? date.toLocaleDateString("en-US", { weekday: "short", month: "short" }) : "TBD" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("strong", { children: date ? date.getDate() : "\u2014" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "gameMatchup", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("strong", { children: [
          game.awayTeam.abbreviation,
          " at ",
          game.homeTeam.abbreviation
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { children: [
          date && !game.timeTbd ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "Time TBD",
          pitchers.confirmed ? ` \xB7 ${pitchers.away?.name ?? "TBD"} / ${pitchers.home?.name ?? "TBD"}` : ""
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "gameSignals", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { children: [
          game.ranking.interestScore,
          " interest"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { children: [
          "hassle ",
          game.ranking.hassleScore,
          "/10"
        ] }),
        game.ticketObservations.length ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: game.ranking.urgency }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "signalAbsent", children: "tickets unknown" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "gameLinks", children: game.sourceLinks.map((link) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("a", { href: link.url, rel: "noreferrer", target: "_blank", children: [
        providerLabel2(link.source),
        " \u2197"
      ] }, `${link.source}|${link.url}`)) }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        CardActions,
        {
          calendarEvent: calendarInputFrom({ ...game, title: gameTitle(game), description: game.ranking.whyYou }),
          layout: "sports",
          planning: planningInputFrom("sports", { ...game, title: gameTitle(game) })
        }
      ),
      game.localEnhancement?.recommendation && isGroundedAdvisory(game.localEnhancement.recommendation) ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "gameAdvisory", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("strong", { children: game.localEnhancement.recommendation.verdict }),
        " ",
        game.localEnhancement.recommendation.explanation
      ] }) : null
    ] });
  }
  function gameTitle(game) {
    return `Dodgers vs. ${friendlyOpponentName(game.awayTeam)}`;
  }
  function groupSeries(games) {
    const groups = /* @__PURE__ */ new Map();
    for (const game of games) {
      const key = game.series.id ?? game.id;
      groups.set(key, [...groups.get(key) ?? [], game]);
    }
    return [...groups.values()];
  }
  function gameComparator(mode) {
    const urgency = (value) => ({ "buy now": 0, watch: 1, "safe to wait": 2, unknown: 3, "likely unavailable": 4 })[value] ?? 5;
    return (left, right) => {
      if (mode === "date") return String(left.startLocal).localeCompare(String(right.startLocal));
      if (mode === "hassle") return left.ranking.hassleScore - right.ranking.hassleScore || right.ranking.interestScore - left.ranking.interestScore;
      if (mode === "urgency") return urgency(left.ranking.urgency) - urgency(right.ranking.urgency) || String(left.startLocal).localeCompare(String(right.startLocal));
      return right.ranking.interestScore - left.ranking.interestScore || String(left.startLocal).localeCompare(String(right.startLocal));
    };
  }
  function providerLabel2(value) {
    return { mlb: "MLB", seatgeek: "SeatGeek", ticketmaster: "Ticketmaster" }[value] ?? value;
  }
  function friendlyOpponentName(team) {
    const name = `${team.name} ${team.shortName}`;
    const known = ["Diamondbacks", "Padres", "Giants", "Yankees", "Mets", "Cubs", "Cardinals", "Astros", "Red Sox", "Braves", "Phillies", "Brewers", "Marlins", "Nationals", "Reds", "Pirates", "Rockies", "Tigers", "Twins", "White Sox", "Guardians", "Rays", "Blue Jays", "Orioles", "Royals", "Angels", "Athletics", "Mariners", "Rangers"];
    return known.find((label) => name.toLocaleLowerCase().includes(label.toLocaleLowerCase())) ?? team.shortName.replace(/^Arizona$/i, "Diamondbacks");
  }

  // site/app/taste-explorer.tsx
  init_define_import_meta_env();
  var import_react7 = __toESM(require_react_shim(), 1);
  var import_jsx_runtime10 = __toESM(require_react_shim(), 1);
  var STATUS_LABELS = {
    "attended-worth-it": "Went \u2014 worth it",
    "attended-not-worth-it": "Went \u2014 not worth it",
    "skipped-still-interested": "Still interested",
    "skipped-no-longer-interested": "Not for me"
  };
  var ORIGIN_LABELS = {
    source: "Direct playlist evidence",
    "top-items": "Spotify top artists",
    similar: "Similar-artist discovery",
    tag: "Tag-cluster discovery",
    promoter: "Promoter calendars"
  };
  function TasteExplorer({ profile }) {
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tasteSection", "aria-label": "Taste profile and feedback", id: "taste-feed", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteIntro", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "eyebrow", children: "Your timeline" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h2", { children: "Plans, recommendations, and outcomes." })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: "Make plans now, then answer only the check-ins that carry a real taste signal. Missing an event is never treated as dislike." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(UpcomingSaves, {}),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(RecentRecommendations, {}),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tasteBlock", "aria-labelledby": "taste-profile-title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteBlockHeading", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "eyebrow", children: "Taste profile" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { id: "taste-profile-title", children: "What the engine has learned." })
        ] }),
        profile ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ProfilePanels, { profile }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ImportedHistory, { profile })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteEmpty", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "The taste profile ships with the next refresh." }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: "Planning and recent recommendation check-ins still work on this device." })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(FeedbackSync, {})
    ] });
  }
  function UpcomingSaves() {
    const feedback = useFeedback();
    const upcoming = feedback?.upcoming ?? [];
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tasteBlock", "aria-labelledby": "upcoming-saves-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteBlockHeading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "eyebrow", children: "Upcoming saves" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { id: "upcoming-saves-title", children: "Dates you meant to keep." })
      ] }),
      upcoming.length ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "timelineList", children: upcoming.map((item) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("article", { className: "timelineRow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: item.currentSnapshot.title }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { children: [
            item.currentSnapshot.dateLocal,
            item.currentSnapshot.locationLabel ? ` \xB7 ${item.currentSnapshot.locationLabel}` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: item.saved && item.held ? "Saved \xB7 calendar held" : item.held ? "Calendar held" : "Saved" })
      ] }, item.itemId)) }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tasteQuietEmpty", children: "Nothing saved or held right now." })
    ] });
  }
  function RecentRecommendations() {
    const feedback = useFeedback();
    const queue = feedback?.queue ?? [];
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tasteBlock", "aria-labelledby": "recent-recommendations-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteBlockHeading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "eyebrow", children: "Recent recommendations" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { id: "recent-recommendations-title", children: "Did any of these happen?" })
      ] }),
      queue.length ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "timelineList", children: queue.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(RecentRecommendation, { entry }, entry.history.historyId)) }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tasteQuietEmpty", children: "No recent recommendations are waiting for you." })
    ] });
  }
  function RecentRecommendation({ entry }) {
    const feedback = useFeedback();
    const [step, setStep] = (0, import_react7.useState)("attendance");
    const [confirmingNegative, setConfirmingNegative] = (0, import_react7.useState)(false);
    const item = entry.history;
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("article", { className: "timelineRow recentRecommendation", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "timelineCopy", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { className: "timelineMeta", children: [
          item.vertical,
          " \xB7 ",
          item.dateLocal,
          entry.planned ? " \xB7 saved or held" : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: item.title }),
        item.locationLabel ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: item.locationLabel }) : null
      ] }),
      !entry.eligible ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "checkInPrompt", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: item.vertical === "movies" ? "Movie history only for now." : "No feedback snapshot is available." }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => feedback?.dismiss(item.historyId), type: "button", children: "Dismiss" })
      ] }) : step === "attendance" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "checkInPrompt", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: "Did you go?" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "checkInOptions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => setStep("worth"), type: "button", children: "Yes" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => feedback?.dismiss(item.historyId), type: "button", children: "No" }),
          !confirmingNegative ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "quietAction", onClick: () => setConfirmingNegative(true), type: "button", children: "Not for me" }) : null
        ] }),
        confirmingNegative ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "inlineConfirmation", role: "group", "aria-label": "Confirm Not for me", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: "Create negative taste feedback?" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => feedback?.checkIn(item, "skipped-no-longer-interested"), type: "button", children: "Confirm" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => setConfirmingNegative(false), type: "button", children: "Cancel" })
        ] }) : null
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "checkInPrompt", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: "Was it worth it?" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "checkInOptions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => feedback?.checkIn(item, "attended-worth-it"), type: "button", children: "Yes" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => feedback?.checkIn(item, "attended-not-worth-it"), type: "button", children: "No" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "quietAction", onClick: () => setStep("attendance"), type: "button", children: "Back" })
        ] })
      ] })
    ] });
  }
  function ProfilePanels({ profile }) {
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { className: "tasteSummaryLine", children: [
        profile.seedSummary.playlistCount,
        " source playlists \xB7 ",
        profile.seedSummary.sourceArtistCount,
        " seeded artists \xB7 ",
        profile.seedSummary.topArtistCount,
        " top-artist signals \xB7 ",
        profile.seedSummary.artistCount,
        " artists after expansion"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteColumns", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteArtists", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "eyebrow", children: "Strongest signals" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tasteScaleNote", children: "Relative signal within the current Taste Engine seed." }),
          profile.topArtists.map((artist) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteArtistRow", children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteArtistName", children: [
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: artist.name }),
              artist.evidenceLabels.length ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: artist.evidenceLabels.join(" \xB7 ") }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "tasteArtistTrack", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { width: `${artist.relativeSignal}%` } }) })
          ] }, artist.name))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteMeta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "eyebrow", children: "Taste clusters" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "tasteTags", children: profile.topTags.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: tag }, tag)) }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "eyebrow", children: "Where candidates come from" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { className: "tasteOrigins", children: Object.entries(profile.expansionByOrigin).map(([origin, count]) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("li", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: count }),
            " ",
            ORIGIN_LABELS[origin] ?? origin
          ] }, origin)) })
        ] })
      ] })
    ] });
  }
  function ImportedHistory({ profile }) {
    const counts = Object.entries(profile.feedback?.statusCounts ?? {}).filter(([, count]) => count > 0);
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("details", { className: "importedHistory", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("summary", { children: "Imported outcome history" }),
      counts.length ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { children: counts.map(([status, count]) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("li", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: count }),
        " ",
        STATUS_LABELS[status] ?? status
      ] }, status)) }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: "No imported outcomes yet." })
    ] });
  }
  function FeedbackSync() {
    const feedback = useFeedback();
    const unexported = feedback?.unexportedCount ?? 0;
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tasteBlock feedbackSync", "aria-labelledby": "feedback-sync-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tasteBlockHeading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "eyebrow", children: "Feedback sync" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { id: "feedback-sync-title", children: "Ready for the next refresh." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: unexported ? `${unexported} new outcome${unexported === 1 ? "" : "s"} ready to export.` : "Everything recorded on this device has been exported." }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "checkInOptions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { disabled: !unexported, onClick: () => feedback?.exportNew(), type: "button", children: "Export feedback" }),
        feedback?.hasTriggeredBatch ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { onClick: () => feedback.redownloadLast(), type: "button", children: "Re-download last" }) : null,
        feedback?.hasTriggeredBatch ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "quietAction", onClick: () => feedback.exportAll(), type: "button", children: "Export all" }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("small", { children: "Downloaded feedback is picked up automatically during a configured personal refresh." })
    ] });
  }

  // site/app/vertical-shell.tsx
  init_define_import_meta_env();
  var import_react8 = __toESM(require_react_shim(), 1);

  // site/app/date-aware.ts
  init_define_import_meta_env();
  var SITE_TIME_ZONE = "America/Los_Angeles";
  function localDateKey(value, timeZone = SITE_TIME_ZONE) {
    if (value == null || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }
  function currentLocalDateKey(value = /* @__PURE__ */ new Date(), timeZone = SITE_TIME_ZONE) {
    return localDateKey(value, timeZone) ?? "9999-12-31";
  }
  function projectionDateKey(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? null;
  }
  function isCurrentOrFuture(value, todayKey) {
    const dateKey = projectionDateKey(value);
    return dateKey == null || dateKey >= todayKey;
  }
  function isDateAwareRefreshNeeded(generatedAt, todayKey) {
    const generatedKey = localDateKey(generatedAt);
    return Boolean(generatedKey && todayKey > generatedKey);
  }

  // site/app/vertical-shell.tsx
  var import_jsx_runtime11 = __toESM(require_react_shim(), 1);
  var TABS = [["overview", "Overview"], ["music", "Music"], ["movies", "Movies"], ["sports", "Sports"], ["taste", "Taste"]];
  function VerticalShell({ overview, overviewPlanAhead, events, movies, sports, recentHistory, generatedAt, tmdbStatus, featuredInterestThreshold, editorial, tasteProfile, changesSinceRefresh }) {
    const [active, setActive] = (0, import_react8.useState)("overview");
    const [currentAsOf, setCurrentAsOf] = (0, import_react8.useState)(null);
    const tabRefs = (0, import_react8.useRef)([]);
    (0, import_react8.useEffect)(() => {
      const setFromHash = () => {
        const next = window.location.hash.slice(1);
        if (["overview", "music", "movies", "sports", "taste"].includes(next)) setActive(next);
      };
      setFromHash();
      window.addEventListener("hashchange", setFromHash);
      window.addEventListener("popstate", setFromHash);
      return () => {
        window.removeEventListener("hashchange", setFromHash);
        window.removeEventListener("popstate", setFromHash);
      };
    }, []);
    (0, import_react8.useEffect)(() => {
      const updateClock = () => setCurrentAsOf((/* @__PURE__ */ new Date()).toISOString());
      updateClock();
      const interval = window.setInterval(updateClock, 6e4);
      return () => window.clearInterval(interval);
    }, []);
    const asOf = currentAsOf ?? generatedAt;
    const todayKey = currentLocalDateKey(asOf);
    const visibleEvents = events.filter((event) => isCurrentOrFuture(event.startLocal, todayKey));
    const visibleMovies = movies.filter((movie) => isCurrentOrFuture(movie.releaseDate, todayKey));
    const visibleSports = sports.filter((game) => isCurrentOrFuture(game.startLocal, todayKey));
    const visibleOverview = overview.filter((item) => isCurrentOrFuture(item.startLocal, todayKey));
    const visiblePlanAhead = (overviewPlanAhead ?? []).filter((item) => isCurrentOrFuture(item.startLocal, todayKey));
    const dateAwareRefresh = isDateAwareRefreshNeeded(generatedAt, todayKey);
    const projectionItems = (0, import_react8.useMemo)(() => [
      ...events.map((event) => planningInputFrom("music", event)),
      ...sports.map((game) => planningInputFrom("sports", { ...game, title: sportsTitle(game) })),
      ...movies.map((movie) => planningInputFrom("movies", movie))
    ].filter((item) => item != null), [events, movies, sports]);
    const select = (next, focus = false) => {
      setActive(next);
      if (window.location.hash !== `#${next}`) window.history.pushState(null, "", `#${next}`);
      if (focus) window.setTimeout(() => tabRefs.current[TABS.findIndex(([value]) => value === next)]?.focus({ preventScroll: true }), 0);
    };
    const move = (current, direction) => {
      const index = TABS.findIndex(([value]) => value === current);
      const nextIndex = direction === "first" ? 0 : direction === "last" ? TABS.length - 1 : (index + (direction === "next" ? 1 : -1) + TABS.length) % TABS.length;
      select(TABS[nextIndex][0], true);
    };
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(FeedbackProvider, { projectionItems, recentHistory, todayKey, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "verticalShell", "aria-label": "Taste Engine verticals", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "verticalTabs", role: "tablist", "aria-label": "Taste Engine verticals", children: TABS.map(([value, label], index) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
        TabButton,
        {
          active: active === value,
          label,
          onKeyDown: (event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              move(value, "next");
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(value, "previous");
            }
            if (event.key === "Home") {
              event.preventDefault();
              move(value, "first");
            }
            if (event.key === "End") {
              event.preventDefault();
              move(value, "last");
            }
          },
          onSelect: () => select(value),
          refCallback: (element) => {
            tabRefs.current[index] = element;
          },
          value
        },
        value
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { "aria-labelledby": `tab-${active}`, id: `panel-${active}`, role: "tabpanel", tabIndex: 0, children: [
        active === "overview" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(OverviewExplorer, { changesSinceRefresh, dateAwareRefresh, editorial, generatedAt: asOf, overview: visibleOverview, planAhead: visiblePlanAhead, projectionGeneratedAt: generatedAt }) : null,
        active === "music" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(EventExplorer, { events: visibleEvents, generatedAt: asOf }) : null,
        active === "movies" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(MovieExplorer, { generatedAt: asOf, movies: visibleMovies, tmdbStatus }) : null,
        active === "sports" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(SportsExplorer, { featuredThreshold: featuredInterestThreshold, games: visibleSports, generatedAt: asOf }) : null,
        active === "taste" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(TasteExplorer, { profile: tasteProfile ?? null }) : null
      ] })
    ] }) });
  }
  function TabButton({ value, label, active, onSelect, onKeyDown, refCallback }) {
    const feedback = useFeedback();
    const pending = value === "taste" ? feedback?.pendingCount ?? 0 : 0;
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
      "button",
      {
        "aria-controls": `panel-${value}`,
        "aria-label": pending ? `${label}, ${pending} pending check-in${pending === 1 ? "" : "s"}` : void 0,
        "aria-selected": active,
        className: active ? "verticalTab tabActive" : "verticalTab",
        id: `tab-${value}`,
        onClick: onSelect,
        onKeyDown,
        ref: refCallback,
        role: "tab",
        tabIndex: active ? 0 : -1,
        type: "button",
        children: [
          label,
          pending ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { "aria-hidden": "true", className: "tabBadge", children: pending }) : null
        ]
      }
    );
  }
  function sportsTitle(game) {
    const opponent = game.awayTeam?.shortName ?? game.awayTeam?.name ?? "opponent";
    return `Dodgers vs. ${opponent}`;
  }
  return __toCommonJS(pkg_entry_exports);
})();
window.TasteEngineSite=TasteEngineSite.__dsMainNs?Object.assign({},TasteEngineSite,TasteEngineSite.__dsMainNs,{__dsMainNs:undefined}):TasteEngineSite;
