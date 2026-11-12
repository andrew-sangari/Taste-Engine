import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [resolve(root, "server/deterministic-engine-entry.js")],
  outfile: resolve(root, "server/deterministic-engine.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  // The Worker runs with nodejs_compat, so node: builtins stay as imports
  // rather than being inlined into the neutral bundle.
  external: ["node:crypto"],
  target: "es2022",
  banner: { js: "// Generated from deterministic Taste Engine modules. Do not edit directly.\n" },
});

// The browser gets its own small bundle of the same source modules: the
// feedback overlay, the shortlist builder and the review. One implementation,
// two generated copies, so what the page shows live is the policy itself.
await build({
  entryPoints: [resolve(root, "app/engine-client-entry.js")],
  outfile: resolve(root, "app/engine-client.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  banner: { js: "// Generated from deterministic Taste Engine modules. Do not edit directly.\n" },
});
