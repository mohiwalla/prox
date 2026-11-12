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
  // Registered first, so every specific mock below takes precedence. Anything
  // that falls through here would have changed a real account or the proxy config.
  const escaped = [];
  const guard = (route) => {
    if (route.request().method() === "GET") return route.fallback();
    escaped.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  };
  await page.route("**/dashboard/api/account/**", guard);
  await page.route("**/dashboard/api/logs/activity/enable", guard);
  const until = async (check) => {
    for (let i = 0; i < 60 && !check(); i++) await page.waitForTimeout(50);
  };
  // Record a mutating endpoint's JSON bodies and answer with a fixture.
  const mock = async (pattern, json) => {
    const bodies = [];
    await page.route(pattern, (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ json });
    });
    return bodies;
  };
  const url = process.env.DASHBOARD_URL || "http://localhost:8318/dashboard/";
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
  // The per-account breakdown is always visible: no accordion to open.
  assert.equal(await page.locator("[data-pool] details").count(), 0);
  assert.equal(
    await page.locator('[data-pool="codex"] .mini-account').first().isVisible(),
    true,
  );
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
  // Chart choices persist across a reload.
  const chosenWindow = await page.locator("#window-antigravity").inputValue();
  await page.locator("#forecast").selectOption("off");
  await page.reload();
  await page.locator("[data-pool]").first().waitFor();
  assert.equal(
    await page.locator("[data-pool]").count(),
    1,
    "Provider filter persists",
  );
  assert.equal(
    await page.locator("#window-antigravity").inputValue(),
    chosenWindow,
  );
  assert.equal(await page.locator("#forecast").inputValue(), "off");
  await page.locator("#forecast").selectOption("on");
  // A provider with a single quota window shows a label instead of a select.
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll("[data-pool]")].every((pool) => {
        const n = dashboard.state.data.accounts
          .filter((a) => a.provider === pool.dataset.pool)
          .flatMap((a) => a.windows.map((w) => w.id));
        return new Set(n).size > 1
          ? !!pool.querySelector("select[data-window]")
          : !!pool.querySelector(".pool-window");
      }),
    ),
    true,
  );
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
  await page.locator("#add-login").focus();
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
  await page.locator("#add-login").click();
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
  await page.locator("#add-login").click();
  await page.locator("#oauth-close").click();
  // Add login lists every CLIProxyAPI sign-in as radio cards.
  await page.locator("#add-login").click();
  assert.equal(await page.locator(".provider-option").count(), 8);
  await page.locator('.provider-option:has(input[value="xai"])').click();
  assert.equal(
    await page.locator("#oauth-providers input:checked").inputValue(),
    "xai",
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator("#oauth-providers input:checked").inputValue(),
    "kimi",
  );
  await page.locator("#oauth-choose [data-dialog-cancel]").click();
  await page.waitForFunction(
    () => !document.querySelector("#oauth-dialog").open,
  );
  // Toasts are rich-colored and their text is not selectable.
  await page.evaluate(() => notify("Test", "success"));
  assert.equal(
    await page
      .locator('[data-sonner-toast][data-type="success"]')
      .evaluate((el) => getComputedStyle(el).userSelect),
    "none",
  );
  // Account row menu: keyboard open, arrow focus, Escape returns focus.
  await page.locator('[data-page="accounts"]').click();
  await page.locator(".account-row").first().waitFor();
  const accountIds = await page.evaluate(() =>
    dashboard.state.data.accounts.map((a) => a.id),
  );
  const rowMenu = (i) =>
    page.locator(".account-row").nth(i).locator('[aria-haspopup="menu"]');
  const menu = page.locator('[role="menu"]');
  const menuItem = (name) =>
    menu.locator('[role="menuitem"]').filter({ hasText: name });
  await rowMenu(0).focus();
  await page.keyboard.press("Enter");
  await menu.waitFor();
  for (const name of ["Sign in again", "Reset cooldown", "Remove account"])
    assert.equal(await menuItem(name).count(), 1, `Menu has ${name}`);
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute("role")),
    "menuitem",
    "Arrow keys move focus into the menu",
  );
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(
    await rowMenu(0).evaluate((b) => document.activeElement === b),
    true,
    "Escape returns focus to the menu trigger",
  );

  // Reset cooldown is offered for a cooling-down account and posts its id.
  const cooldownBodies = await mock("**/dashboard/api/account/cooldown", {
    status: "ok",
  });
  await page.evaluate(() => {
    // Browser-only fixture; the next snapshot restores the real state.
    const a = dashboard.state.data.accounts[0];
    a.unavailable = true;
    a.cooldowns = [{ reason: "quota", model_key: "test" }];
    a.cooldown_until = Date.now() / 1000 + 600;
    dashboard.render();
  });
  await rowMenu(0).click();
  await menuItem("Reset cooldown").click();
  await until(() => cooldownBodies.length);
  assert.deepEqual(cooldownBodies, [{ id: accountIds[0] }]);

  // Sign in again opens the OAuth dialog directly in its flow step.
  const reloginUrl = "https://auth.example.test/authorize?state=test-state";
  const reloginBodies = await mock("**/dashboard/api/account/relogin", {
    url: reloginUrl,
    state: "test-state",
  });
  await mock("**/dashboard/api/oauth/status", { status: "wait" });
  await mock("**/dashboard/api/oauth/cancel", { status: "ok" });
  await rowMenu(0).click();
  await menuItem("Sign in again").click();
  await page.locator("#oauth-flow:not([hidden])").waitFor();
  // The link step shows "Preparing sign-in link…" until the URL arrives.
  await page.waitForFunction(
    (url) => document.querySelector("#oauth-link")?.textContent === url,
    reloginUrl,
  );
  assert.deepEqual(reloginBodies, [{ id: accountIds[0] }]);
  assert.equal(await page.locator("#oauth-link").textContent(), reloginUrl);
  assert.equal(
    (await page.locator("#oauth-title").textContent()).trim(),
    "Sign in again",
  );
  await page.locator("#oauth-close").click();
  await page.waitForFunction(
    () => !document.querySelector("#oauth-dialog").open,
  );

  // Accounts that need it get an inline Sign in again button too.
  await page.evaluate(() => {
    dashboard.state.data.accounts.at(-1).requires_sign_in = true;
    dashboard.render();
  });
  assert.equal(
    await page
      .locator(".account-row")
      .last()
      .getByRole("button", { name: "Sign in again", exact: true })
      .isVisible(),
    true,
  );

  // Remove asks for confirmation; Cancel sends nothing, Remove posts the id.
  const removeBodies = await mock("**/dashboard/api/account/remove", {
    status: "ok",
  });
  const confirm = page.locator('[role="alertdialog"]').or(
    page.locator("dialog[open]").filter({
      has: page.getByRole("button", { name: "Remove", exact: true }),
    }),
  );
  const lastRow = counts.accounts - 1;
  await rowMenu(lastRow).click();
  await menuItem("Remove account").click();
  await confirm.first().waitFor();
  await confirm.first().getByRole("button", { name: "Cancel" }).click();
  await confirm.first().waitFor({ state: "hidden" });
  assert.deepEqual(removeBodies, [], "Cancel does not remove the account");
  await rowMenu(lastRow).click();
  await menuItem("Remove account").click();
  await confirm.first().waitFor();
  await confirm
    .first()
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await until(() => removeBodies.length);
  assert.deepEqual(removeBodies, [{ id: accountIds[lastRow] }]);
  await page.evaluate(() => load());

  // Logs page: Errors list and viewer, Activity enabled and disabled states.
  const errorName = "error-2026-11-13T01-00-00-test.log";
  await page.route("**/dashboard/api/logs/errors", (route) =>
    route.fulfill({
      json: {
        files: [
          {
            name: errorName,
            size: 2048,
            modified: Math.floor(Date.now() / 1000),
          },
        ],
      },
    }),
  );
  await page.route("**/dashboard/api/logs/errors/file*", (route) =>
    route.fulfill({
      json: {
        name: errorName,
        text: "POST /v1/responses\n429 Too Many Requests",
        truncated: false,
      },
    }),
  );
  let activityEnabled = true;
  await page.route("**/dashboard/api/logs/activity*", (route) =>
    route.fulfill({
      json: activityEnabled
        ? {
            enabled: true,
            lines: ["activity line one", "activity line two"],
            latest: Math.floor(Date.now() / 1000),
          }
        : { enabled: false, lines: [] },
    }),
  );
  const enableBodies = await mock("**/dashboard/api/logs/activity/enable", {
    enabled: true,
  });
  const logsTab = (name) =>
    page.locator("#page-body .segmented button").filter({ hasText: name });
  await page.locator('[data-page="logs"]').click();
  await page.waitForFunction(
    () => document.querySelector("#page-title").textContent.trim() === "Logs",
  );
  await logsTab("Errors").click();
  const errorItem = page
    .locator(`[data-log-name="${errorName}"]`)
    .or(page.locator("#page-body button", { hasText: errorName }))
    .first();
  await errorItem.click();
  await page
    .locator("#page-body pre", { hasText: "429 Too Many Requests" })
    .waitFor();
  await logsTab("Activity").click();
  await page
    .locator("#page-body pre", { hasText: "activity line two" })
    .waitFor();
  activityEnabled = false;
  await logsTab("Errors").click();
  await logsTab("Activity").click();
  const enable = page.getByRole("button", { name: "Enable activity log" });
  await enable.waitFor();
  activityEnabled = true;
  await enable.click();
  await page
    .locator("#page-body pre", { hasText: "activity line two" })
    .waitFor();
  assert.equal(enableBodies.length, 1, "Enable posts once, on click only");
  await page.unroute("**/dashboard/api/logs/activity*");
  await page.unroute("**/dashboard/api/logs/errors");
  await page.unroute("**/dashboard/api/logs/errors/file*");

  // One-time setup info lives in the README, not the sidebar.
  assert.equal(await page.locator('[data-page="connection"]').count(), 0);
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

  // Read a sample, then fetch a new snapshot with exactly the same live nodes.
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  const quietRefresh = await page.evaluate(async () => {
    const plot = document.querySelector('[data-chart="codex"]');
    const select = document.querySelector("#window-antigravity");
    const button = document.querySelector('[data-filter="all"]');
    const tooltip = plot.querySelector(".chart-tooltip");
    const breakdown = document.querySelector(
      '[data-pool="codex"] .mini-account',
    );
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
      breakdownPreserved: breakdown.isConnected && breakdown.checkVisibility(),
      // Torph morphs real text changes (ages, values); nothing else may move.
      quiet:
        document
          .getAnimations()
          .filter(
            (a) =>
              !(
                a.effect?.target?.hasAttribute?.("torph-item") ||
                a.effect?.target?.closest?.("[torph-root]")
              ),
          ).length === 0,
    };
  });
  assert.deepEqual(quietRefresh, {
    inspectionPreserved: true,
    selectPreserved: true,
    buttonPreserved: true,
    breakdownPreserved: true,
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
  const add = page.locator("#add-login");
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
  assert.deepEqual(escaped, [], "No real account or config mutation escaped");
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
        "add login providers and toasts",
        "persisted chart choices",
        "breakdown visible without interaction",
        "account menu keyboard and focus return",
        "reset cooldown (mocked)",
        "sign in again opens flow step (mocked)",
        "inline sign in again",
        "remove with confirmation (mocked)",
        "logs: errors viewer and activity states (mocked)",
        "no mutation reached the real proxy",
        "no connection page",
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
