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
  target: "es2022",
  banner: { js: "// Generated from deterministic Taste Engine modules. Do not edit directly.\n" },
});
