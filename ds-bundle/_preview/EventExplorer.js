var __dsPreview = (() => {
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
  var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
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

  // ds-raw:__ds_raw__
  var require_ds_raw = __commonJS({
    "ds-raw:__ds_raw__"(exports, module) {
      init_define_import_meta_env();
      module.exports = window.TasteEngineSite;
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
      function jsx2(t, p, k) {
        var c = p && p.children;
        return c === void 0 ? R.createElement(t, np(p, k)) : R.createElement(t, np(p, k), c);
      }
      function jsxs(t, p, k) {
        return R.createElement.apply(R, [t, np(p, k)].concat(p.children));
      }
      module.exports = R;
      module.exports.jsx = jsx2;
      module.exports.jsxs = jsxs;
      module.exports.jsxDEV = function(t, p, k, s) {
        return (s ? jsxs : jsx2)(t, p, k);
      };
      module.exports.Fragment = R.Fragment;
    }
  });

  // .design-sync/previews/EventExplorer.tsx
  var EventExplorer_exports = {};
  __export(EventExplorer_exports, {
    NoResultsForFilter: () => NoResultsForFilter,
    RankedList: () => RankedList
  });
  init_define_import_meta_env();

  // ds-shim:ds
  var ds_exports = {};
  __export(ds_exports, {
    default: () => ds_default
  });
  init_define_import_meta_env();
  __reExport(ds_exports, __toESM(require_ds_raw()));
  var g = window.TasteEngineSite;
  var ds_default = "default" in g ? g.default : g;

  // .design-sync/previews/EventExplorer.tsx
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var DEMO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2362dfc3'/%3E%3Cstop offset='1' stop-color='%23173f36'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)'/%3E%3C/svg%3E";
  var canvas = {
    background: "var(--background, #030504)",
    color: "var(--text-primary, #eceeeb)",
    padding: 24
  };
  var generatedAt = "2026-07-12T12:00:00.000-07:00";
  var events = [
    {
      id: "qa-music-image",
      title: "Short Signal",
      sourceUrl: "https://example.com/synthetic/short-signal",
      sources: ["framework"],
      sourceLinks: [{ source: "framework", url: "https://example.com/synthetic/short-signal" }],
      eventType: "concert",
      startLocal: "2026-07-15T20:00:00-07:00",
      timeTbd: false,
      venue: { name: "The Example Hall", city: "Los Angeles", state: "CA" },
      ticketObservation: { lowestPriceUsd: 45, listingCount: 18 },
      matchedArtists: [{ name: "Short Signal", seedStrength: 0.9, primary: true, origin: "source" }],
      ranking: { artistFit: 92, hassleScore: 3, hassleReasons: ["Easy rail access"], utility: 91, confidence: "confirmed", urgency: "watch", whyYou: "A direct synthetic seed with a compact venue and a clean weeknight fit." },
      visual: { kind: "image", url: DEMO_IMAGE, alt: "A synthetic atmospheric event image", focalPoint: { x: 72, y: 50 }, attribution: "Synthetic local fixture" }
    },
    {
      id: "qa-music-long",
      title: "An Extremely Long Synthetic Festival Billing With Many Words That Must Wrap Without Breaking The Recommendation Card",
      sourceUrl: "https://example.com/synthetic/long-billing",
      sources: ["seatgeek", "framework"],
      sourceLinks: [{ source: "seatgeek", url: "https://example.com/synthetic/long-billing" }, { source: "framework", url: "https://example.com/synthetic/long-billing-framework" }],
      eventType: "concert",
      startLocal: "2026-07-18T21:00:00-07:00",
      timeTbd: false,
      venue: { name: "VenueWithAnUnbrokenSyntheticTokenThatShouldWrapWithoutEscapingItsCard", city: "Los Angeles", state: "CA" },
      ticketObservation: { lowestPriceUsd: null, listingCount: null },
      matchedArtists: [
        { name: "Long Signal", seedStrength: 0.82, primary: true, origin: "similar" },
        { name: "Support Artist One", seedStrength: 0.34, primary: false, origin: "tag" }
      ],
      ranking: { artistFit: 78, hassleScore: 7, hassleReasons: ["Unknown price", "Long venue transfer"], utility: 76, confidence: "likely", urgency: "safe to wait", whyYou: "The bridge is credible, but the unusually long bill and unknown price make this a deliberate rather than automatic yes." },
      localEnhancement: {
        personalFit: { score: 78, label: "Selective", explanation: "A useful adjacent signal with a lot to verify." },
        recommendation: { verdict: "Consider", explanation: "Keep it on the shortlist while the details settle." },
        urgency: { label: "Safe to wait", explanation: "No synthetic scarcity signal is available." },
        hassle: { score: 7, explanation: "The venue token and unknown price are the main friction." }
      },
      visual: { kind: "texture", variant: "music-warehouse-beams", focalPoint: { x: 80, y: 40 } }
    },
    {
      id: "qa-music-none",
      title: "No Visual Set",
      sourceUrl: "https://example.com/synthetic/no-visual",
      sources: ["seatgeek"],
      sourceLinks: [{ source: "seatgeek", url: "https://example.com/synthetic/no-visual" }],
      eventType: "dj set",
      startLocal: "2026-08-04T22:00:00-07:00",
      timeTbd: true,
      venue: { name: "Black Box Example", city: "Los Angeles", state: "CA" },
      ticketObservation: { lowestPriceUsd: null, listingCount: 0 },
      matchedArtists: [{ name: "No Visual Set", seedStrength: 0.66, primary: true, origin: "tag" }],
      ranking: { artistFit: 67, hassleScore: 5, hassleReasons: ["Time TBD"], utility: 64, confidence: "exploratory", urgency: "safe to wait", whyYou: "The fit is promising enough to keep visible even though the event has no declared visual or ticket price." },
      visual: { kind: "none" }
    },
    {
      id: "qa-music-festival",
      title: "Synthetic Night Market + more",
      sourceUrl: "https://example.com/synthetic/night-market",
      sources: ["framework"],
      sourceLinks: [{ source: "framework", url: "https://example.com/synthetic/night-market" }],
      eventType: "festival",
      startLocal: "2026-07-25T18:30:00-07:00",
      timeTbd: false,
      venue: { name: "Synthetic River Park", city: "Los Angeles", state: "CA" },
      ticketObservation: { lowestPriceUsd: 80, listingCount: 24 },
      matchedArtists: [
        { name: "Night Market", seedStrength: 0.74, primary: true, origin: "promoter" },
        { name: "More Synthetic Artists", seedStrength: 0.3, primary: false, origin: "promoter" }
      ],
      ranking: { artistFit: 72, hassleScore: 6, hassleReasons: ["Festival footprint"], utility: 70, confidence: "exploratory", urgency: "watch", whyYou: "A promoter-followed festival shape with enough direct signal to inspect the lineup." },
      visual: { kind: "texture", variant: "music-crowd-silhouette" }
    }
  ];
  function RankedList() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.EventExplorer, { events, generatedAt }) });
  }
  function NoResultsForFilter() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.EventExplorer, { events: events.filter((e) => e.eventType === "nonexistent-type"), generatedAt }) });
  }
  return __toCommonJS(EventExplorer_exports);
})();
