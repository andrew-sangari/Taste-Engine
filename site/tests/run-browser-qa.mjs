import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const fixture = process.argv[2] === "empty" ? "empty" : "full";
const spec = fixture === "empty" ? "tests/browser-qa-empty.spec.mjs" : "tests/browser-qa.spec.mjs";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const env = { ...process.env, BROWSER_QA: "1", TASTE_ENGINE_QA_FIXTURE: fixture };

await run(npm, ["run", "build"], { cwd: siteRoot, env });
await run(process.execPath, [
  resolve(siteRoot, "node_modules/@playwright/test/cli.js"),
  "test",
  "--config",
  "tests/playwright.config.mjs",
  spec,
  ...process.argv.slice(3)
], { cwd: siteRoot, env });

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}
