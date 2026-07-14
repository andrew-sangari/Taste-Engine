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

  // .design-sync/previews/CardActions.tsx
  var CardActions_exports = {};
  __export(CardActions_exports, {
    MovieNoFeedback: () => MovieNoFeedback,
    MusicEvent: () => MusicEvent
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

  // .design-sync/previews/CardActions.tsx
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var canvas = {
    background: "var(--background, #030504)",
    color: "var(--text-primary, #eceeeb)",
    padding: 24,
    maxWidth: 320
  };
  function MusicEvent() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ds_exports.CardActions,
      {
        layout: "music",
        planning: {
          planningSnapshot: { itemId: "qa-music-image", title: "Short Signal", dateLocal: "2026-07-15", vertical: "music", locationLabel: "The Example Hall · Los Angeles" },
          feedbackSnapshot: { feedbackSnapshotId: "fs-qa-music-image", canonicalEventId: "qa-music-image", eventDateLocal: "2026-07-15", eventTitleSnapshot: "Short Signal", vertical: "music" }
        },
        calendarEvent: {
          uid: "qa-music-image",
          title: "Short Signal",
          startLocal: "2026-07-15T20:00:00-07:00",
          dateLocal: "2026-07-15",
          allDay: false,
          locationLabel: "The Example Hall · Los Angeles",
          description: "A direct synthetic seed with a compact venue and a clean weeknight fit.",
          url: "https://example.com/synthetic/short-signal"
        }
      }
    ) });
  }
  function MovieNoFeedback() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: canvas, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ds_exports.CardActions,
      {
        layout: "movie",
        planning: {
          planningSnapshot: { itemId: "qa-movie-confirmed", title: "Synthetic Projection", dateLocal: "2026-07-20", vertical: "movies", locationLabel: "Synthetic Cinema · Los Angeles" },
          feedbackSnapshot: null
        },
        calendarEvent: {
          uid: "qa-movie-confirmed",
          title: "Synthetic Projection",
          startLocal: null,
          dateLocal: "2026-07-20",
          allDay: true,
          locationLabel: "Synthetic Cinema · Los Angeles",
          description: "The local fixture confirms a premium presentation.",
          url: "https://example.com/synthetic/synthetic-projection"
        }
      }
    ) });
  }
  return __toCommonJS(CardActions_exports);
})();
