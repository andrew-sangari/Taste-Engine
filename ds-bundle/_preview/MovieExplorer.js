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

  // .design-sync/previews/MovieExplorer.tsx
  var MovieExplorer_exports = {};
  __export(MovieExplorer_exports, {
    ConfirmedAndUpcoming: () => ConfirmedAndUpcoming,
    NoTmdbSource: () => NoTmdbSource
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

  // .design-sync/previews/MovieExplorer.tsx
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var DEMO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2362dfc3'/%3E%3Cstop offset='1' stop-color='%23173f36'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)'/%3E%3C/svg%3E";
  var canvas = {
    background: "var(--background, #030504)",
    color: "var(--text-primary, #eceeeb)",
    padding: 24
  };
  var generatedAt = "2026-07-12T12:00:00.000-07:00";
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
      visual: { kind: "image", url: DEMO_IMAGE, alt: "Synthetic Projection poster", focalPoint: { x: 78, y: 50 }, attribution: "Synthetic TMDB-style local fixture" }
    },
    {
      id: "qa-movie-fallback",
      title: "Image Fallback Feature",
      sourceUrl: "https://example.com/synthetic/image-fallback-feature",
      releaseDate: "2026-07-30",
      overview: "This card keeps its title and reason when its declared image is missing.",
      tasteScore: 74,
      reasons: ["Format confirmation remains pending."],
      directors: [],
      runtimeMinutes: null,
      formatStatus: "release watch",
      format: null,
      theater: null,
      premiumFormatConfirmed: false,
      posterUrl: null,
      backdropUrl: "/missing-qa-movie.svg",
      visual: { kind: "image", url: "/missing-qa-movie.svg", alt: "Synthetic fallback feature image" }
    },
    {
      id: "qa-movie-long-lead",
      title: "Long Lead Cinema",
      sourceUrl: "https://example.com/synthetic/long-lead-cinema",
      releaseDate: null,
      overview: "A no-date movie case remains visible without inventing a release date.",
      tasteScore: 63,
      reasons: [],
      directors: ["Pending Director"],
      runtimeMinutes: 99,
      formatStatus: "long lead",
      format: null,
      theater: null,
      premiumFormatConfirmed: false,
      posterUrl: null,
      backdropUrl: null,
      visual: { kind: "texture", variant: "movie-projection-light" }
    }
  ];
  function ConfirmedAndUpcoming() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.MovieExplorer, { movies, tmdbStatus: "active", generatedAt }) });
  }
  function NoTmdbSource() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.MovieExplorer, { movies: [], tmdbStatus: "not configured", generatedAt }) });
  }
  return __toCommonJS(MovieExplorer_exports);
})();
