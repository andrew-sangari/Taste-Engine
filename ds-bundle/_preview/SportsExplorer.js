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

  // .design-sync/previews/SportsExplorer.tsx
  var SportsExplorer_exports = {};
  __export(SportsExplorer_exports, {
    NoGamesForFilter: () => NoGamesForFilter,
    SeriesGrid: () => SeriesGrid
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

  // .design-sync/previews/SportsExplorer.tsx
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var canvas = {
    background: "var(--background, #030504)",
    color: "var(--text-primary, #eceeeb)",
    padding: 24
  };
  var generatedAt = "2026-07-12T12:00:00.000-07:00";
  var games = [
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
      sourceLinks: [{ source: "mlb", url: "https://example.com/synthetic/rivalry-1" }, { source: "seatgeek", url: "https://example.com/synthetic/rivalry-1-tickets" }],
      ranking: { interestScore: 91, utility: 90, hassleScore: 4, urgency: "watch", confidence: "confirmed", whyYou: "High-leverage rivalry context with a clean night-game shape." },
      visual: { kind: "texture", variant: "sports-stadium-lights" }
    },
    {
      id: "qa-sports-rivalry-2",
      sourceUrl: "https://example.com/synthetic/rivalry-2",
      startLocal: "2026-07-17T19:10:00-07:00",
      timeTbd: false,
      venue: { name: "Synthetic Stadium", city: "Los Angeles", state: "CA" },
      homeTeam: { name: "Synthetic Dodgers", shortName: "Dodgers", abbreviation: "SYN" },
      awayTeam: { name: "Synthetic Giants", shortName: "Giants", abbreviation: "SGI" },
      series: { id: "qa-series-rivalry", gameNumber: 2, gameCount: 3 },
      sportsContext: { rivalryTier: "high", playoffLeverage: "medium", probablePitchers: { home: null, away: null, confirmed: false } },
      tags: ["rivalry", "pitchers TBD"],
      ticketObservations: [],
      sourceLinks: [{ source: "mlb", url: "https://example.com/synthetic/rivalry-2" }],
      ranking: { interestScore: 62, utility: 60, hassleScore: 4, urgency: "unknown", confidence: "confirmed", whyYou: "The series remains interesting even while ticket coverage is unknown." },
      visual: { kind: "texture", variant: "sports-field-lines" }
    },
    {
      id: "qa-sports-high-leverage",
      sourceUrl: "https://example.com/synthetic/high-leverage",
      startLocal: "2026-07-22T18:40:00-07:00",
      timeTbd: false,
      venue: { name: "Synthetic Stadium", city: "Los Angeles", state: "CA" },
      homeTeam: { name: "Synthetic Dodgers", shortName: "Dodgers", abbreviation: "SYN" },
      awayTeam: { name: "Synthetic Yankees", shortName: "Yankees", abbreviation: "SYN" },
      series: { id: "qa-series-high-leverage", gameNumber: 1, gameCount: 1 },
      sportsContext: { rivalryTier: "medium", playoffLeverage: "high", probablePitchers: { home: { name: "C. Example", era: 2.4 }, away: { name: "D. Example", era: 2.9 }, confirmed: true } },
      tags: ["high leverage", "early start"],
      ticketObservations: [{ source: "seatgeek", url: "https://example.com/synthetic/high-leverage-tickets", lowestPriceUsd: 95, status: "available" }],
      sourceLinks: [{ source: "mlb", url: "https://example.com/synthetic/high-leverage" }, { source: "seatgeek", url: "https://example.com/synthetic/high-leverage-tickets" }],
      ranking: { interestScore: 88, utility: 86, hassleScore: 5, urgency: "buy now", confidence: "confirmed", whyYou: "A high-leverage game with a specific reason to leave the house." },
      localEnhancement: { recommendation: { verdict: "Prioritize", explanation: "The leverage is the point of this date." } },
      visual: { kind: "texture", variant: "sports-scoreboard-glow" }
    },
    {
      id: "qa-sports-default",
      sourceUrl: "https://example.com/synthetic/default-game",
      startLocal: "2026-08-04T18:10:00-07:00",
      timeTbd: false,
      venue: { name: "Synthetic Stadium", city: "Los Angeles", state: "CA" },
      homeTeam: { name: "Synthetic Dodgers", shortName: "Dodgers", abbreviation: "SYN" },
      awayTeam: { name: "Synthetic Mariners", shortName: "Mariners", abbreviation: "SMA" },
      series: { id: "qa-series-default", gameNumber: 1, gameCount: 1 },
      sportsContext: { rivalryTier: "none", playoffLeverage: "low", probablePitchers: { home: null, away: null, confirmed: false } },
      tags: [],
      ticketObservations: [],
      sourceLinks: [{ source: "mlb", url: "https://example.com/synthetic/default-game" }],
      ranking: { interestScore: 52, utility: 50, hassleScore: 3, urgency: "unknown", confidence: "confirmed", whyYou: "A default texture case with no ticket price signal." },
      visual: { kind: "texture", variant: "sports-field-lines" }
    }
  ];
  function SeriesGrid() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.SportsExplorer, { games, generatedAt, featuredThreshold: 70 }) });
  }
  function NoGamesForFilter() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.SportsExplorer, { games: [], generatedAt, featuredThreshold: 70 }) });
  }
  return __toCommonJS(SportsExplorer_exports);
})();
