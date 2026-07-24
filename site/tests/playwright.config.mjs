import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const browserCandidates = [
  process.env.BROWSER_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const browserPath = browserCandidates.find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: ".",
  testMatch: "browser-qa*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01
    }
  },
  reporter: "list",
  snapshotPathTemplate: "{testDir}/snapshots/{testFileName}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    colorScheme: "dark",
    contextOptions: {
      reducedMotion: "reduce",
      serviceWorkers: "block"
    },
    launchOptions: {
      executablePath: browserPath,
      args: ["--disable-gpu", "--disable-dev-shm-usage"]
    }
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe"
  }
});
