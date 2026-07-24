import { expect, test } from "@playwright/test";

const FIXED_NOW = "2026-07-12T19:00:00.000Z";
const VIEWPORTS = [
  { width: 1440, height: 1000, label: "desktop" },
  { width: 1024, height: 768, label: "compact-desktop" },
  { width: 768, height: 1024, label: "tablet-portrait" },
  { width: 390, height: 844, label: "mobile" },
  { width: 320, height: 700, label: "narrow-mobile" }
];
const blockedExternalByPage = new WeakMap();

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(process.env.BROWSER_QA !== "1", "Browser QA is opt-in; use npm run test:browser.");
  const origin = new URL(baseURL).origin;
  const blockedExternal = [];
  blockedExternalByPage.set(page, blockedExternal);
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
});

test("renders the complete frozen fixture and its source-health states", async ({ page }) => {
  await visit(page);
  await expect(page.getByRole("heading", { name: "One taste engine. Several ways out." })).toBeVisible();
  await expect(page.locator(".overviewGrid > .overviewCard")).toHaveCount(5);
  await expect(page.locator(".planAheadCard")).toHaveCount(3);
  await expect(page.locator(".sourceHealthGroup")).toHaveCount(4);
  await expect(page.getByText("Synthetic Night Market + more")).toBeVisible();
  await expect(page.locator(".overviewCard h3").filter({ hasText: "Synthetic Projection" })).toBeVisible();
  expect(blockedExternalByPage.get(page)).toEqual([]);

  const visualState = await page.locator(".recommendationVisual").evaluateAll((elements) => elements.map((element) => ({
    kind: element.getAttribute("data-kind"),
    hidden: element.getAttribute("aria-hidden"),
    role: element.getAttribute("role"),
    label: element.getAttribute("aria-label"),
    pointerEvents: getComputedStyle(element).pointerEvents
  })));
  expect(visualState.some((visual) => visual.kind === "texture" && visual.hidden === "true" && visual.pointerEvents === "none")).toBeTruthy();
  expect(visualState.some((visual) => visual.kind === "image" && visual.role === "img" && visual.label)).toBeTruthy();
  await page.getByRole("tab", { name: "Music" }).click();
  await expect(page.getByText("From $0")).toHaveCount(0);
  const musicVisualState = await page.locator(".recommendationVisual").evaluateAll((elements) => elements.map((element) => ({
    kind: element.getAttribute("data-kind"),
    hidden: element.getAttribute("aria-hidden"),
    role: element.getAttribute("role"),
    label: element.getAttribute("aria-label")
  })));
  expect(musicVisualState.some((visual) => visual.kind === "none" && visual.hidden === "true")).toBeTruthy();
  expect(musicVisualState.some((visual) => visual.kind === "image" && visual.role === "img" && visual.label)).toBeTruthy();
});

test("renders a compact decision score with expandable factors and shared light fields", async ({ page }) => {
  await visit(page);
  await expect(page.locator(".ghostRank")).toHaveCount(8);
  const score = page.locator(".recommendationScore").first();
  await expect(score).toHaveCount(1);
  await expect(score.locator("summary")).toContainText("Decision points");
  await expect(score).not.toHaveAttribute("open", "");
  await score.locator("summary").click();
  await expect(score).toHaveAttribute("open", "");
  await expect(score.locator(".recommendationScoreFactors")).toContainText("Fit");
  await expect(score.locator(".recommendationScoreFactors")).toContainText("Friction");
  await expect(score.locator(".recommendationScoreFactors")).toContainText("Urgency");
  await expect(score.locator(".recommendationScoreFactors")).toContainText("Confidence");
  await expect(score.locator(".recommendationScoreFactors")).toContainText("Status");
  await expect(page.locator(".sourceHealthList.board")).toHaveCount(1);
  await expect(page.locator(".srcRow")).toHaveCount(12);
  await expect(page.locator(".srcNote").filter({ hasText: /active|partial|unavailable|not configured/i }).first()).toHaveCount(1);
  await expect(page.locator(".methodStep")).toHaveCount(4);

  const overviewTexture = page.locator('.recommendationVisual[data-kind="texture"][data-variant^="music-"]').first();
  await expect(overviewTexture).toHaveCount(1);
  expect(await overviewTexture.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("visual-music.svg");

  await page.getByRole("tab", { name: "Sports" }).click();
  const sportsTexture = page.locator('.recommendationVisual[data-kind="texture"][data-variant^="sports-"]').first();
  await expect(sportsTexture).toHaveCount(1);
  expect(await sportsTexture.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("visual-sports.svg");
});

test("applies, clears, and visibly reruns vertical filters", async ({ page }) => {
  await visit(page);
  await page.getByRole("tab", { name: "Music" }).click();
  const type = page.getByRole("combobox", { name: "Music event type" });
  await type.selectOption("festival");
  await expect(type).toHaveValue("festival");
  await expect(page.locator(".eventSignals > span:first-child").filter({ hasText: "festival" }).first()).toBeVisible();
  const clear = page.getByRole("button", { name: "Clear filters" });
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(type).toHaveValue("all");

  await page.getByRole("tab", { name: "Sports" }).click();
  const sort = page.getByRole("combobox", { name: "Sports sort order" });
  await sort.selectOption("date");
  await expect(sort).toHaveValue("date");
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
});

test("ranks Taste signals by contribution with differentiated bars", async ({ page }) => {
  await visit(page);
  await page.getByRole("tab", { name: "Taste" }).click();
  const rows = page.locator(".tasteArtistRow");
  await expect(rows.first()).toBeVisible();
  const widths = await rows.evaluateAll((items) => items.slice(0, 6).map((item) => Number.parseFloat(getComputedStyle(item.querySelector(".tasteArtistTrack span")).width)));
  expect(new Set(widths).size).toBeGreaterThan(1);
  await expect(rows.filter({ hasText: /Direct taste · Adjacent discovery/i })).toHaveCount(0);
});

test("switches all tabs and preserves the ARIA tab contract", async ({ page }) => {
  await visit(page);
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(5);
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);

  for (const [label, panel] of [["Overview", "panel-overview"], ["Music", "panel-music"], ["Movies", "panel-movies"], ["Sports", "panel-sports"], ["Taste", "panel-taste"]]) {
    const tab = page.getByRole("tab", { name: label });
    await expect(tab).toHaveCount(1);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`#${panel}`)).toBeVisible();
    await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    expect(new URL(page.url()).hash).toBe(`#${label.toLowerCase()}`);
  }
});

test("supports roving keyboard tabs, native activation, hash reload, and history", async ({ page }) => {
  await visit(page, "#overview");
  const overview = page.getByRole("tab", { name: "Overview" });
  await overview.focus();
  await overview.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Music" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Music" }).press("ArrowLeft");
  await expect(overview).toBeFocused();
  await overview.press("End");
  await expect(page.getByRole("tab", { name: "Taste" })).toBeFocused();
  await page.getByRole("tab", { name: "Taste" }).press("Home");
  await expect(overview).toBeFocused();

  const movies = page.getByRole("tab", { name: "Movies" });
  await movies.focus();
  await movies.press("Space");
  await expect(movies).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Sports" }).press("Enter");
  await expect(page.getByRole("tab", { name: "Sports" })).toHaveAttribute("aria-selected", "true");

  await page.goto(`${new URL(page.url()).origin}/#music`, { waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Movies" }).click();
  await page.getByRole("tab", { name: "Sports" }).click();
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Movies" })).toHaveAttribute("aria-selected", "true");
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");
  await page.goForward({ waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Movies" })).toHaveAttribute("aria-selected", "true");
});

test("resolves overview event anchors through direct loads, reloads, and browser history", async ({ page }) => {
  await visit(page);
  const musicLink = page.getByRole("link", { name: "View in Music" }).first();
  await expect(musicLink).toHaveCount(1);
  const href = await musicLink.getAttribute("href");
  expect(href).toMatch(/^#event-/);
  const targetId = href.slice(1);

  await musicLink.click();
  await expect(page.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`[id="${targetId}"]`)).toBeVisible();
  await expect(page.locator(`[id="${targetId}"]`)).toBeFocused();

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`[id="${targetId}"]`)).toBeVisible();
  await page.goForward({ waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

  await page.goto(`${new URL(page.url()).origin}/${href}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`[id="${targetId}"]`)).toBeVisible();
});

test("keeps links, controls, disclosures, and visuals accessible", async ({ page }) => {
  await visit(page);
  expect(blockedExternalByPage.get(page)).toEqual([]);
  const links = await page.locator('a[target="_blank"]').evaluateAll((elements) => elements.map((element) => ({
    href: element.getAttribute("href"),
    rel: element.getAttribute("rel") ?? ""
  })));
  expect(links.length).toBeGreaterThan(0);
  expect(links.every((link) => link.href && link.rel.split(/\s+/).includes("noreferrer"))).toBeTruthy();

  const nestedInteractive = await page.locator("a,button,select,summary,input").evaluateAll((elements) => elements.filter((element) => {
    let parent = element.parentElement;
    while (parent) {
      if (parent.matches("a,button,select,summary,input")) return true;
      parent = parent.parentElement;
    }
    return false;
  }).length);
  expect(nestedInteractive).toBe(0);

  const unavailableStatuses = await page.locator(".sourceStatus").evaluateAll((elements) => elements
    .filter((element) => /unavailable|not configured/i.test(element.textContent ?? ""))
    .every((element) => !element.closest("a,button,select,summary,input")));
  expect(unavailableStatuses).toBeTruthy();

  const sourceSummaries = page.locator(".sourceHealthGroup summary");
  await expect(sourceSummaries).toHaveCount(4);
  const sourceGroups = page.locator("details.sourceHealthGroup");
  await expect(sourceGroups).toHaveCount(4);
  const sourceSummary = sourceSummaries.nth(0);
  await sourceSummary.focus();
  await sourceSummary.press("Enter");
  await expect(sourceSummary).toBeFocused();
  await expect(sourceGroups.nth(0)).not.toHaveAttribute("open", "");
  await sourceSummary.press("Enter");
  await expect(sourceGroups.nth(0)).toHaveAttribute("open", "");

  await page.getByRole("tab", { name: "Music" }).click();
  const fitSummary = page.getByText("View fit and friction");
  await expect(fitSummary).toHaveCount(1);
  await fitSummary.focus();
  await fitSummary.press("Space");
  await expect(fitSummary).toBeFocused();
  await expect(page.locator(".localTake details")).toHaveAttribute("open", "");
  await fitSummary.press("Space");
  await expect(page.locator(".localTake details")).not.toHaveAttribute("open", "");
});

test("keeps card planning actions behind one disclosure in every vertical", async ({ page }) => {
  await visit(page);
  for (const label of ["Overview", "Music", "Movies", "Sports"]) {
    if (label !== "Overview") await page.getByRole("tab", { name: label }).click();
    const disclosure = page.locator("details.cardActions").first();
    await expect(disclosure).toBeVisible();
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(disclosure.locator(".cardActionsMenu button").first()).not.toBeVisible();
    const summary = disclosure.locator("summary");
    await expect(summary).toContainText("Plan");
    await summary.click();
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(disclosure.locator(".cardActionsMenu button").first()).toBeVisible();
    await expect(disclosure.getByRole("button", { name: /pass|skip/i })).toHaveCount(0);
  }
});

test("opens a calendar hold and makes save and hold states explicitly reversible", async ({ page }) => {
  await visit(page);
  const disclosure = page.locator("details.cardActions").first();
  await disclosure.locator("summary").click();

  const save = disclosure.getByRole("button", { name: "Save", exact: true });
  await save.click();
  const removeSave = disclosure.getByRole("button", { name: "Remove save" });
  await expect(removeSave).toHaveAttribute("aria-pressed", "true");
  await removeSave.click();
  await expect(disclosure.getByRole("button", { name: "Save", exact: true })).toHaveAttribute("aria-pressed", "false");

  await page.evaluate(() => {
    window.__tasteEngineCalendarOpen = null;
    window.open = (url, target, features) => {
      window.__tasteEngineCalendarOpen = { url: String(url), target, features };
      return null;
    };
  });
  await disclosure.getByRole("button", { name: "Hold date" }).click();
  const calendarOpen = await page.evaluate(() => window.__tasteEngineCalendarOpen);
  expect(calendarOpen.url).toMatch(/^blob:/);
  expect(calendarOpen.target).toBe("_blank");
  expect(calendarOpen.features).toContain("noopener");

  const removeHold = disclosure.getByRole("button", { name: "Remove hold" });
  await expect(removeHold).toHaveAttribute("aria-pressed", "true");
  await removeHold.click();
  await expect(disclosure.getByRole("button", { name: "Hold date" })).toHaveAttribute("aria-pressed", "false");
});

test("uses a history-driven, two-step feedback flow in the intended section order", async ({ page }) => {
  await visit(page);
  await page.getByRole("tab", { name: "Taste" }).click();
  const headings = page.locator(".tasteBlockHeading .eyebrow");
  await expect(headings).toHaveText([
    "Upcoming saves",
    "Recent recommendations",
    "Hosted engine",
    "Coverage review",
    "Taste profile",
    "Feedback sync",
  ]);
  const row = page.locator(".recentRecommendation").filter({ hasText: "Past Synthetic Set" });
  await expect(row.getByText("Did you go?")).toBeVisible();
  await row.getByRole("button", { name: "Yes" }).click();
  await expect(row.getByText("Was it worth it?")).toBeVisible();
  await row.getByRole("button", { name: "Back" }).click();
  await expect(row.getByText("Did you go?")).toBeVisible();
  await row.getByRole("button", { name: "Yes" }).click();
  await row.getByRole("button", { name: "No" }).click();
  await expect(page.getByText("1 new outcome ready to export.")).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(page.getByText("Past Synthetic Film")).toBeVisible();
});

test.describe("narrow mobile utility row", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the signals separated from their CTA", async ({ page }) => {
    await visit(page);
    const layout = await readLayout(page);
    expect(layout.signals.every((signal) => signal.scrollWidth <= signal.clientWidth + 1), JSON.stringify(layout.signals)).toBeTruthy();
    expect(layout.signals.every((signal) => signal.separatorStarts === 0), JSON.stringify(layout.signals)).toBeTruthy();
    expect(layout.targets.every((target) => target.width >= 44 && target.height >= 44), JSON.stringify(layout.targets)).toBeTruthy();
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.label} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("has bounded card/control geometry and respects reduced motion", async ({ page }) => {
      await visit(page);
      for (const label of ["Overview", "Music", "Movies", "Sports"]) {
        if (label !== "Overview") {
          const tab = page.getByRole("tab", { name: label });
          await expect(tab).toHaveCount(1);
          await tab.click();
        }
        const layout = await readLayout(page);
        expect(layout.document.scrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1);
        expect(layout.cards.every((card) => card.scrollWidth <= card.clientWidth + 1), `${label}: ${JSON.stringify(layout.cards)}`).toBeTruthy();
        expect(layout.cards.every((card) => card.overflows.length === 0), `${label}: ${JSON.stringify(layout.cards)}`).toBeTruthy();
        expect(layout.controls.every((control) => control.left >= -1 && control.right <= layout.viewport.width + 1 && control.width > 0 && control.height > 0), `${label}: ${JSON.stringify(layout.controls)}`).toBeTruthy();
        expect(layout.visuals.every((visual) => visual.pointerEvents === "none")).toBeTruthy();
        expect(layout.reducedMotion).toBe(true);
      }
    });
  });
}

test.describe("stable browser screenshot regions", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("captures desktop editorial regions", async ({ page }) => {
    await visit(page);
    await expect(page.locator(".masthead")).toHaveScreenshot("desktop-masthead.png");
    await expect(page.locator(".projectionHero")).toHaveScreenshot("desktop-hero.png");
    await expect(page.locator(".verticalTabs")).toHaveScreenshot("desktop-tabs.png");
    await expect(page.locator(".overviewIntro")).toHaveScreenshot("desktop-overview-intro.png");
    await expect(page.locator(".overviewFeatured")).toHaveScreenshot("desktop-featured-card.png");
    await expect(page.locator(".overviewGrid")).toHaveScreenshot("desktop-supporting-card-grid.png");
    await expect(page.locator(".planAhead")).toHaveScreenshot("desktop-plan-ahead.png");
    await expect(page.locator(".sourceHealth")).toHaveScreenshot("desktop-source-health.png");
    await expect(page.locator(".method")).toHaveScreenshot("desktop-method.png");
    await expect(page.locator(".sourceNote")).toHaveScreenshot("desktop-taste-health.png");

    await page.getByRole("tab", { name: "Music" }).click();
    await expect(page.locator(".eventFeatured")).toHaveScreenshot("desktop-music-card.png");
    await page.getByRole("tab", { name: "Movies" }).click();
    const movieCards = page.locator(".movieCard");
    const movieCount = await movieCards.count();
    expect(movieCount).toBeGreaterThan(0);
    await expect(movieCards.nth(0)).toHaveScreenshot("desktop-movie-card.png");
    await page.getByRole("tab", { name: "Sports" }).click();
    await expect(page.locator(".seriesFeatured")).toHaveScreenshot("desktop-sports-card.png");
  });
});

test.describe("desktop first-viewport composition", () => {
  test.use({ viewport: { width: 1680, height: 973 } });

  test("keeps the first ranked card fully visible", async ({ page }) => {
    await visit(page);
    const card = await page.locator(".overviewFeatured").boundingBox();
    expect(card).not.toBeNull();
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.y + card.height).toBeLessThanOrEqual(973);
  });
});

test.describe("stable mobile screenshot regions", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("captures mobile utility and disclosure regions", async ({ page }) => {
    await visit(page);
    await expect(page.locator(".verticalTabs")).toHaveScreenshot("mobile-tabs.png");
    await expect(page.locator(".overviewUtility").first()).toHaveScreenshot("mobile-utility-row.png");
    await page.getByRole("tab", { name: "Music" }).click();
    const filterButton = page.getByRole("button", { name: /Filters/ });
    await expect(filterButton).toHaveCount(1);
    await filterButton.click();
    await expect(filterButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".filterBar")).toHaveScreenshot("mobile-filter-disclosure.png");
    await filterButton.click();
    await expect(filterButton).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("tab", { name: "Sports" }).click();
    const seriesDetails = page.locator(".seriesDetails");
    if (await seriesDetails.count()) {
      const summary = seriesDetails.nth(0).locator(":scope > summary");
      await summary.click();
      await expect(summary.locator(".." )).toHaveScreenshot("mobile-expanded-disclosure.png");
    }
  });
});

test.describe("text scaling stress", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps long content bounded at increased root text size", async ({ page }) => {
    await visit(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
    const layout = await readLayout(page);
    expect(layout.document.scrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(layout.cards.every((card) => card.scrollWidth <= card.clientWidth + 1 && card.overflows.length === 0), JSON.stringify(layout.cards)).toBeTruthy();
    expect(layout.controls.every((control) => control.left >= -1 && control.right <= layout.viewport.width + 1), JSON.stringify(layout.controls)).toBeTruthy();
  });
});

async function visit(page, hash = "") {
  await page.goto(`/${hash}`, { waitUntil: "networkidle" });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  await page.addStyleTag({ content: "* { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
  expect(blockedExternalByPage.get(page)).toEqual([]);
}

async function readLayout(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      let parent = element.parentElement;
      while (parent) {
        if (parent instanceof HTMLDetailsElement && !parent.open) {
          const summary = parent.querySelector(":scope > summary");
          if (element !== summary && !summary?.contains(element)) return false;
        }
        parent = parent.parentElement;
      }
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    const cards = [...document.querySelectorAll(".overviewCard,.eventCard,.movieCard,.seriesCard")].map((card) => {
      const cardRect = rect(card);
      const overflows = [...card.querySelectorAll("*")].filter(visible).map((child) => ({ element: child.className || child.parentElement?.className || child.tagName, ...rect(child) })).filter((child) => child.left < cardRect.left - 1 || child.right > cardRect.right + 1 || child.top < cardRect.top - 1 || child.bottom > cardRect.bottom + 1).slice(0, 5);
      return { rect: cardRect, clientWidth: card.clientWidth, scrollWidth: card.scrollWidth, overflows };
    });
    const controls = [...document.querySelectorAll("button,a,select,summary,input")].filter(visible).map((element) => ({ element: element.tagName, ...rect(element) }));
    const signals = [...document.querySelectorAll(".overviewUtilitySignals")].filter(visible).map((group) => {
      const groupRect = rect(group);
      const separatorStarts = [...group.querySelectorAll("span")].slice(1).filter((span) => {
        const separator = getComputedStyle(span, "::before").content;
        return separator && separator !== "none" && separator !== "\"\"" && rect(span).left <= groupRect.left + 1;
      }).length;
      return { clientWidth: group.clientWidth, scrollWidth: group.scrollWidth, separatorStarts };
    });
    const targets = [...document.querySelectorAll(".overviewUtilityCta,.eventFooter > a,.movieCardContent > a,.gameLinks a,.filterDisclosureToggle,.sourceHealthGroup summary,.localTake details summary,.seriesDetails summary,.occurrenceList summary,.recommendationScore summary")].filter(visible).map((element) => rect(element));
    const visuals = [...document.querySelectorAll(".recommendationVisual")].map((element) => ({ pointerEvents: getComputedStyle(element).pointerEvents }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      cards,
      controls,
      signals,
      targets,
      visuals,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
    };
  });
}
