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

  // .design-sync/previews/VerticalShell.tsx
  var VerticalShell_exports = {};
  __export(VerticalShell_exports, {
    Default: () => Default
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

  // .design-sync/previews/VerticalShell.tsx
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var DEMO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2362dfc3'/%3E%3Cstop offset='1' stop-color='%23173f36'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)'/%3E%3C/svg%3E";
  var canvas = {
    background: "var(--background, #030504)",
    color: "var(--text-primary, #eceeeb)",
    padding: 24
  };
  var generatedAt = "2026-07-12T12:00:00.000-07:00";
  var overview = [
    {
      vertical: "music",
      id: "qa-music-image",
      title: "Short Signal",
      sourceUrl: "https://example.com/synthetic/short-signal",
      startLocal: "2026-07-15T20:00:00-07:00",
      venue: { name: "The Example Hall", city: "Los Angeles" },
      score: 92,
      interestScore: null,
      hassleScore: 3,
      urgency: "watch",
      confidence: "confirmed",
      reason: "A direct synthetic seed with a compact weeknight fit.",
      call: "Strong fit",
      bucket: "current",
      visual: { kind: "image", url: DEMO_IMAGE, alt: "Short Signal atmosphere" }
    },
    {
      vertical: "sports",
      id: "qa-sports-rivalry-1",
      title: "Giants",
      sourceUrl: "https://example.com/synthetic/rivalry-1",
      startLocal: "2026-07-16T19:10:00-07:00",
      venue: { name: "Synthetic Stadium", city: "Los Angeles" },
      score: 91,
      interestScore: 91,
      hassleScore: 4,
      urgency: "watch",
      confidence: "confirmed",
      reason: "High-leverage rivalry context with a clean night-game shape.",
      call: "Prioritize",
      bucket: "current",
      visual: { kind: "texture", variant: "sports-stadium-lights" }
    }
  ];
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
      visual: { kind: "image", url: DEMO_IMAGE, alt: "A synthetic atmospheric event image" }
    }
  ];
  var movies = [
    {
      id: "qa-movie-confirmed",
      title: "Synthetic Projection",
      sourceUrl: "https://example.com/synthetic/synthetic-projection",
      releaseDate: "2026-07-20",
      overview: "A synthetic theatrical description used only for browser QA.",
      tasteScore: 88,
      reasons: ["The local fixture confirms a premium presentation."],
      directors: ["Example Director"],
      runtimeMinutes: 124,
      formatStatus: "confirmed locally",
      format: "IMAX",
      theater: "Synthetic Cinema",
      premiumFormatConfirmed: true,
      posterUrl: DEMO_IMAGE,
      backdropUrl: DEMO_IMAGE,
      visual: { kind: "image", url: DEMO_IMAGE, alt: "Synthetic Projection poster" }
    }
  ];
  var sports = [
    {
      id: "qa-sports-rivalry-1",
      sourceUrl: "https://example.com/synthetic/rivalry-1",
      startLocal: "2026-07-16T19:10:00-07:00",
      timeTbd: false,
      venue: { name: "Synthetic Stadium", city: "Los Angeles", state: "CA" },
      homeTeam: { name: "Synthetic Dodgers", shortName: "Dodgers", abbreviation: "SYN" },
      awayTeam: { name: "Synthetic Giants", shortName: "Giants", abbreviation: "SGI" },
      series: { id: "qa-series-rivalry", gameNumber: 1, gameCount: 3 },
      sportsContext: { rivalryTier: "high", playoffLeverage: "medium", probablePitchers: { home: { name: "A. Example", era: 2.8 }, away: { name: "B. Example", era: 3.1 }, confirmed: true } },
      tags: ["rivalry", "weeknight", "confirmed pitchers"],
      ticketObservations: [{ source: "seatgeek", url: "https://example.com/synthetic/rivalry-1-tickets", lowestPriceUsd: 65, status: "available" }],
      sourceLinks: [{ source: "mlb", url: "https://example.com/synthetic/rivalry-1" }],
      ranking: { interestScore: 91, utility: 90, hassleScore: 4, urgency: "watch", confidence: "confirmed", whyYou: "High-leverage rivalry context with a clean night-game shape." },
      visual: { kind: "texture", variant: "sports-stadium-lights" }
    }
  ];
  var recentHistory = [
    {
      historyId: "rh-qa-past-music",
      canonicalEventId: "qa-past-music",
      feedbackSnapshotId: "fs-qa-past-music",
      vertical: "music",
      title: "Past Synthetic Set",
      dateLocal: "2026-07-01",
      locationLabel: "Synthetic Hall · Los Angeles",
      firstShownAt: "2026-06-20T19:00:00.000Z",
      lastShownAt: "2026-06-30T19:00:00.000Z",
      surfaces: ["overview", "shortlist"],
      bestRank: 1
    }
  ];
  var editorial = {
    headline: "A few synthetic options clear the bar.",
    verdict: "selective",
    lead: "The fixture keeps the current call small while leaving the longer evidence available in each vertical.",
    skipCall: "Do not confuse a complete-looking card with confirmed availability."
  };
  function Default() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ds_exports.VerticalShell,
      {
        overview,
        overviewPlanAhead: [],
        events,
        movies,
        sports,
        recentHistory,
        generatedAt,
        tmdbStatus: "active",
        featuredInterestThreshold: 70,
        editorial,
        tasteProfile: null,
        changesSinceRefresh: null
      }
    ) });
  }
  return __toCommonJS(VerticalShell_exports);
})();
