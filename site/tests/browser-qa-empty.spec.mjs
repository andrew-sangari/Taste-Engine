import { expect, test } from "@playwright/test";

const FIXED_NOW = "2026-07-12T19:00:00.000Z";

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(process.env.BROWSER_QA !== "1", "Browser QA is opt-in; use npm run test:browser:empty.");
  const origin = new URL(baseURL).origin;
  const blockedExternal = [];
  await page.addInitScript(({ fixedNow }) => {
    const RealDate = Date;
    function FrozenDate(...args) {
      if (new.target) return Reflect.construct(RealDate, args.length ? args : [fixedNow], new.target);
      return new RealDate(fixedNow).toString();
    }
    FrozenDate.prototype = RealDate.prototype;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.now = () => fixedNow;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    globalThis.Date = FrozenDate;
  }, { fixedNow: Date.parse(FIXED_NOW) });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }
    blockedExternal.push(url.origin);
    await route.abort();
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin && !blockedExternal.includes(url.origin)) blockedExternal.push(url.origin);
  });
  page.on("close", () => {
    if (blockedExternal.length) throw new Error(`External request attempted: ${[...new Set(blockedExternal)].join(", ")}`);
  });
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 320, height: 700 }
]) {
  test.describe(`empty fixture ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("renders intentional current and Plan Ahead empty states", async ({ page }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
      await expect(page.locator(".overviewEmpty")).toBeVisible();
      await expect(page.locator(".planAheadEmpty")).toBeVisible();
      await expect(page.getByText("Nothing clears the current bar yet.")).toBeVisible();
      await expect(page.getByText("No later date currently clears the planning bar.")).toBeVisible();
      await expect(page.locator(".sourceHealthGroup")).toHaveCount(4);
      await expect(page.locator(".overviewCard,.eventCard,.movieCard,.seriesCard")).toHaveCount(0);
      expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    });
  });
}
