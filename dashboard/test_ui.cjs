const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");
const artifacts = path.join(__dirname, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const assert = require("assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url =
    process.env.DASHBOARD_URL ||
    "https://batman.tailc343ff.ts.net:8317/dashboard/";
  if (process.env.DASHBOARD_SOURCE)
    await page.route(url, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: fs.readFileSync(path.join(__dirname, "index.html"), "utf8"),
      }),
    );
  await page.goto(url);
  await page
    .getByLabel("Management key", { exact: true })
    .fill(
      JSON.parse(
        fs.readFileSync(
          path.join(os.homedir(), "cliproxyapi", "credentials.json"),
        ),
      ).management_key,
    );
  await page
    .getByRole("button", { name: "Open dashboard", exact: true })
    .click();
  await page.locator('[data-pool="codex"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator("[data-pool]").count(), 2);
  const counts = await page.evaluate(() => ({
    accounts: dashboard.state.data.accounts.length,
    measured: dashboard.state.data.accounts.filter((a) => a.windows.length)
      .length,
    windows: dashboard.state.data.accounts.reduce(
      (n, a) => n + a.windows.length,
      0,
    ),
  }));
  assert.equal(
    await page.locator("#page-meta").textContent(),
    `${counts.accounts} accounts · ${counts.measured} quotas loaded`,
  );
  assert.equal(
    await page.evaluate(() => document.cookie.includes("batman_dashboard")),
    false,
  );
  assert.equal(
    await page.evaluate(() => document.fonts.check("14px Geist")),
    true,
  );
  await page.screenshot({
    path: path.join(artifacts, "dashboard-desktop.png"),
    fullPage: true,
  });
  const chart = page.locator('[data-chart="codex"]');
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await chart.locator(".chart-tooltip").isVisible(), true);
  await page.locator("#page-title").click();
  await page.locator('[data-filter="antigravity"]').click();
  assert.equal(await page.locator("[data-pool]").count(), 1);
  await page.locator("#window-antigravity").selectOption({ index: 1 });
  await page.locator('[data-filter="all"]').click();
  await page.locator('[data-burn="1"]').click();
  assert.equal(
    await page.locator('[data-burn="1"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-view="drain"]').click();
  assert.ok(await page.locator(".pool .rate-card").count());
  assert.equal(await page.locator("[data-chart]").count(), 0);
  await page.locator('[data-view="remaining"]').click();

  // Roving focus: one tab stop per group, arrows move and activate.
  await page.locator("#refresh").focus();
  await page.keyboard.press("Tab");
  const tabStop = await page.evaluate(() => {
    const group = document.querySelector(".provider-tabs");
    const buttons = [...group.querySelectorAll("button")];
    const scroller = getComputedStyle(group);
    const clipped =
      scroller.overflowX !== "visible" || scroller.overflowY !== "visible";
    return {
      focused: document.activeElement.dataset.filter,
      active: group.querySelector("button.active").dataset.filter,
      others: buttons
        .filter((b) => !b.classList.contains("active"))
        .map((b) => b.getAttribute("tabindex")),
      ring: getComputedStyle(document.activeElement).boxShadow,
      padded:
        !clipped ||
        ["Top", "Right", "Bottom", "Left"].every(
          (side) => parseFloat(scroller["padding" + side]) >= 3,
        ),
    };
  });
  assert.equal(tabStop.focused, tabStop.active);
  assert.ok(tabStop.others.length && tabStop.others.every((t) => t === "-1"));
  assert.ok(tabStop.ring && tabStop.ring !== "none", "Focus ring is visible");
  assert.ok(tabStop.padded, "Provider tab focus ring is not clipped");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.closest(".provider-tabs")),
    null,
    "Tab leaves the provider group after one stop",
  );
  const arrowCheck = async (selector, attr, key, expected) => {
    await page.keyboard.press(key);
    const result = await page.evaluate(
      ([selector, attr]) => {
        const focused = document.activeElement;
        return {
          focused: focused.getAttribute(attr),
          pressed: focused.getAttribute("aria-pressed"),
          active: focused.classList.contains("active"),
          tabindex: focused.getAttribute("tabindex"),
          inGroup: !!focused.closest(selector),
        };
      },
      [selector, attr],
    );
    assert.deepEqual(
      result,
      {
        focused: expected,
        pressed: "true",
        active: true,
        tabindex: "0",
        inGroup: true,
      },
      `${key} in ${selector}`,
    );
  };
  await page.locator(".provider-tabs button.active").focus();
  await arrowCheck(".provider-tabs", "data-filter", "ArrowRight", "codex");
  assert.equal(await page.locator("[data-pool]").count(), 1);
  await arrowCheck(".provider-tabs", "data-filter", "End", "antigravity");
  await arrowCheck(".provider-tabs", "data-filter", "Home", "all");
  assert.equal(await page.locator("[data-pool]").count(), 2);
  const burnGroup = ".segmented:has([data-burn])";
  await page.locator(`${burnGroup} button.active`).focus();
  assert.ok(
    (
      await page
        .locator(`${burnGroup} button:not(.active)`)
        .evaluateAll((bs) => bs.map((b) => b.getAttribute("tabindex")))
    ).every((t) => t === "-1"),
  );
  await arrowCheck(burnGroup, "data-burn", "Home", "1");
  await arrowCheck(burnGroup, "data-burn", "ArrowRight", "3");
  await arrowCheck(burnGroup, "data-burn", "End", "6");
  await arrowCheck(burnGroup, "data-burn", "ArrowLeft", "3");

  await page.locator('[data-page="accounts"]').click();
  await page.locator(".account-row").first().waitFor();
  assert.equal(await page.locator(".account-row").count(), counts.accounts);
  assert.equal(await page.locator("#toggle-emails").count(), 0);
  const labels = await page.evaluate(() => {
    const names = { codex: "Codex", antigravity: "Antigravity" };
    return {
      expected: dashboard.state.data.accounts.map(
        (a, i) => a.email || `${names[a.provider]} account ${i + 1}`,
      ),
      shown: [...document.querySelectorAll(".account-row .account-label")].map(
        (el) => el.textContent.trim(),
      ),
    };
  });
  assert.deepEqual(labels.shown, labels.expected, "Emails shown by default");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  assert.equal(
    await page.locator("#oauth-dialog").evaluate((d) => d.open),
    true,
  );
  const footerAlignment = await page.evaluate(() => {
    const footer = document.querySelector("#oauth-choose .dialog-footer");
    const last = [...footer.querySelectorAll("button")].at(-1);
    return Math.abs(
      footer.getBoundingClientRect().right - last.getBoundingClientRect().right,
    );
  });
  assert.ok(footerAlignment <= 1, "Dialog footer actions align right");
  await page.locator("#oauth-choose [data-dialog-cancel]").click();
  assert.equal(
    await page.locator("#oauth-dialog").evaluate((d) => d.open),
    false,
  );
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.locator("#oauth-close").click();
  // OAuth page: one card per supported provider; Sign in preselects it.
  await page.locator('[data-page="oauth"]').click();
  await page.locator(".oauth-card").first().waitFor();
  assert.equal(await page.locator(".oauth-card").count(), 2);
  await page.locator('[data-add="antigravity"]').click();
  assert.equal(
    await page.locator("#oauth-provider").inputValue(),
    "antigravity",
  );
  await page.locator("#oauth-choose [data-dialog-cancel]").click();
  await page.waitForFunction(
    () => !document.querySelector("#oauth-dialog").open,
  );
  // Toasts are rich-colored and their text is not selectable.
  await page.evaluate(() => notify("Test", "success"));
  assert.equal(
    await page
      .locator('.toast[data-type="success"]')
      .evaluate((el) => getComputedStyle(el).userSelect),
    "none",
  );
  await page.locator('[data-page="connection"]').click();
  await page.locator(".codebox").waitFor();
  assert.ok((await page.locator(".codebox").textContent()).includes("/v1"));
  await page.locator('[data-page="quotas"]').click();
  await page.locator("[data-pool]").first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => dashboard.render());
  await page.screenshot({
    path: path.join(artifacts, "dashboard-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator("#menu").click();
  await page.locator('[data-page="accounts"]').click();
  await page.locator(".account-row").first().waitFor();
  assert.equal(await page.locator(".account-row").count(), counts.accounts);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: path.join(artifacts, "dashboard-mobile-accounts.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const calculations = await page.evaluate(() => {
    const api = window.dashboard,
      original = api.state.data,
      now = Date.now() / 1000;
    api.state.burn = 3;
    api.state.forecast = true;
    api.state.data = {
      now,
      history: [
        { account: "test", metric: "m", ts: now - 1800, remaining: 70 },
        { account: "test", metric: "m", ts: now - 1200, remaining: 100 },
        { account: "test", metric: "m", ts: now - 600, remaining: 95 },
      ],
    };
    const rate = api.drainFor({ id: "test" }, "m", now);
    api.state.data.history = [
      { account: "test", metric: "m", ts: now - 10, remaining: 50 },
    ];
    const unknown = api.drainFor({ id: "test" }, "m", now);
    const forecast = api.forecastPoints(
      [
        {
          a: { id: "test", quota_at: now },
          w: { remaining: 50, reset_at: now + 3600 },
        },
      ],
      "m",
      now,
      now + 7200,
    );
    api.state.data = original;
    return { rate, unknown, forecastCount: forecast.length };
  });
  assert.equal(calculations.rate, 30);
  assert.equal(calculations.unknown, null);
  assert.equal(calculations.forecastCount, 0);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(180);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }

  // Exercise motion with the actual controls and browser animations enabled.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-page="quotas"]').click();
  await page.locator("[data-pool]").first().waitFor();
  await page.waitForTimeout(240);
  const settle = () =>
    page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    );
  await page.locator('[data-filter="codex"]').click();
  assert.ok(
    await page.evaluate(() =>
      document
        .getAnimations()
        .some(
          (a) =>
            a.playState === "running" &&
            a.effect.getComputedTiming().duration > 0,
        ),
    ),
    "Pointer selection starts a transition",
  );
  // Reverse rapidly: the final selection must win without a delayed swap.
  await page.locator('[data-filter="antigravity"]').click({ force: true });
  await page.locator('[data-filter="all"]').click({ force: true });
  await settle();
  assert.equal(
    await page.locator('[data-filter="all"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator("[data-pool]").count(), 2);
  const indicators = await page.evaluate(() =>
    [...document.querySelectorAll(".provider-tabs, .segmented")].every((g) => {
      const active = g.querySelector("button.active");
      const expected = active.offsetLeft;
      const clip = getComputedStyle(g, "::before").clipPath;
      return (
        clip !== "none" &&
        Number.isFinite(expected) &&
        g.dataset.motionIndicator === "ready"
      );
    }),
  );
  assert.ok(indicators, "Selection indicators settle on their active controls");

  const summary = page.locator('[data-pool="codex"] summary');
  await summary.click();
  await settle();
  assert.equal(
    await page.locator('[data-pool="codex"] details').getAttribute("open"),
    "",
  );
  // Read a sample, then fetch a new snapshot with exactly the same live nodes.
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  const quietRefresh = await page.evaluate(async () => {
    const plot = document.querySelector('[data-chart="codex"]');
    const select = document.querySelector("#window-codex");
    const button = document.querySelector('[data-filter="all"]');
    const tooltip = plot.querySelector(".chart-tooltip");
    const inspected = tooltip.textContent;
    await load();
    const inspectionPreserved =
      tooltip.isConnected &&
      !tooltip.hidden &&
      tooltip.textContent === inspected &&
      document.activeElement === plot;
    select.focus();
    // Let the select's own focus-ring transition finish; only refresh motion counts.
    await new Promise((r) => setTimeout(r, 300));
    await load();
    return {
      inspectionPreserved,
      selectPreserved: select.isConnected && document.activeElement === select,
      buttonPreserved: button.isConnected,
      disclosurePreserved: document.querySelector('[data-pool="codex"] details')
        .open,
      quiet: document.getAnimations().length === 0,
    };
  });
  assert.deepEqual(quietRefresh, {
    inspectionPreserved: true,
    selectPreserved: true,
    buttonPreserved: true,
    disclosurePreserved: true,
    quiet: true,
  });

  // Keyboard activation animates like pointer activation, including the indicator.
  await page.locator('[data-filter="codex"]').focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("[data-pool]").count(), 1);
  assert.ok(
    await page.evaluate(() =>
      document
        .getAnimations()
        .some((a) => a.transitionProperty === "clip-path"),
    ),
  );
  await page.locator('[data-filter="all"]').click();
  await settle();
  const timestampInspection = await page.evaluate(() => {
    const plot = document.querySelector('[data-chart="codex"]');
    const chart = dashboard.state.charts.codex;
    const original = { points: chart.points, forecast: chart.forecast };
    const now = dashboard.state.data.now;
    chart.points = [1800, 1200, 600].map((ago) => ({
      ts: now - ago,
      value: 50,
    }));
    chart.forecast = [];
    inspectChart(plot, chart.points[1]);
    // The first sample falls off the range as a new sample arrives.
    chart.points = [...chart.points.slice(1), { ts: now, value: 50 }];
    plot.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    const correct = Number(plot.dataset.inspectedAt) === now - 600;
    Object.assign(chart, original);
    clearChart(plot);
    return correct;
  });
  assert.ok(
    timestampInspection,
    "Chart inspection follows the sample timestamp after history shifts",
  );

  // Hold one response while changing range again: only the latest range may
  // render, and it must animate after its own snapshot arrives.
  const snapshot = await page.evaluate(() => dashboard.state.data);
  const requests = [];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const snapshotRoute = "**/dashboard/api/snapshot?hours=*";
  await page.route(snapshotRoute, async (route) => {
    const hours = Number(
      new URL(route.request().url()).searchParams.get("hours"),
    );
    requests.push(hours);
    if (hours === 168) await held;
    await route.fulfill({ json: { ...snapshot, testHours: hours } });
  });
  await page.locator('[data-hours="168"]').click();
  await page.waitForFunction(() => dashboard.state.loadBusy);
  await page.locator('[data-hours="336"]').click();
  assert.equal(
    await page.evaluate(() => {
      const c = dashboard.state.charts.codex;
      return Math.round((c.end - c.start) / 3600);
    }),
    24,
    "The chart keeps the previous range while new history loads",
  );
  release();
  await page.waitForFunction(
    () => dashboard.state.data.testHours === 336 && !dashboard.state.loadBusy,
  );
  assert.deepEqual(requests, [168, 336]);
  assert.equal(
    await page.evaluate(() => {
      const c = dashboard.state.charts.codex;
      return Math.round((c.end - c.start) / 3600);
    }),
    336,
  );
  await page.unroute(snapshotRoute);
  await page.locator('[data-hours="24"]').click();
  await page.waitForFunction(
    () =>
      !dashboard.state.loadBusy &&
      Math.round(
        (dashboard.state.charts.codex.end -
          dashboard.state.charts.codex.start) /
          3600,
      ) === 24,
  );
  await settle();
  await page.locator('[data-page="accounts"]').click();
  await page.locator(".account-row").first().waitFor();
  await settle();
  const focusAfterRemoval = await page.evaluate(() => {
    const original = dashboard.state.data.accounts;
    const button = document.querySelector(
      ".account-row:last-child [data-pause]",
    );
    button.focus();
    // Browser-only fixture; no real account is changed.
    dashboard.state.data.accounts = original.slice(1);
    dashboard.render();
    const removal = button.isConnected && document.activeElement === button;
    dashboard.state.data.accounts = [...original].reverse();
    dashboard.render();
    const reorder = button.isConnected && document.activeElement === button;
    dashboard.state.data.accounts = original;
    dashboard.render();
    return { removal, reorder };
  });
  assert.deepEqual(focusAfterRemoval, { removal: true, reorder: true });
  const add = page.getByRole("button", { name: "Add account", exact: true });
  await add.click();
  assert.ok(
    await page
      .locator("#oauth-dialog")
      .evaluate((d) => d.getAnimations().length > 0),
  );
  await settle();
  await page.locator("#oauth-close").click();
  assert.equal(
    await page.locator("#oauth-dialog").evaluate((d) => d.open),
    false,
  );
  await settle();
  assert.equal(await add.evaluate((b) => document.activeElement === b), true);
  // Cancel an entrance with Escape, then reopen before the exit settles.
  await add.click();
  await page.keyboard.press("Escape");
  await add.click();
  await settle();
  assert.equal(
    await page.locator("#oauth-dialog").evaluate((d) => d.open),
    true,
  );
  await page.keyboard.press("Escape");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('[data-page="quotas"]').click();
  await page.locator("[data-pool]").first().waitFor();
  await page.locator('[data-filter="antigravity"]').click();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.locator('[data-filter="all"]').click();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  // Original SVGL marks are referenced everywhere provider identity appears.
  assert.ok(
    await page.locator('.provider-icon use[href="#brand-codex"]').count(),
  );
  assert.ok(
    await page.locator('.provider-icon use[href="#brand-antigravity"]').count(),
  );
  await page.screenshot({
    path: path.join(artifacts, "dashboard-motion-desktop.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const cookie = (await context.cookies()).find(
    (c) => c.name === "batman_dashboard",
  );
  assert.ok(cookie.httpOnly && cookie.secure && cookie.sameSite === "Strict");
  console.log(
    JSON.stringify({
      passed: true,
      accounts: counts.accounts,
      quotaWindows: counts.windows,
      checks: [
        "login",
        "protected cookie",
        "live quotas",
        "provider filters",
        "quota window selection",
        "burn lookback",
        "drain view",
        "account list",
        "roving keyboard focus and focus rings",
        "emails shown by default",
        "sign-in dialog and right-aligned footer",
        "oauth page and toasts",
        "connection view",
        "390px layout",
        "mobile navigation",
        "interruptible motion",
        "quiet polling and focus preservation",
        "history timestamp inspection",
        "queued range selection",
        "dialog entrance, exit and focus return",
        "keyboard motion and reduced motion",
        "SVGL provider marks",
      ],
      pageErrors: errors,
    }),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
