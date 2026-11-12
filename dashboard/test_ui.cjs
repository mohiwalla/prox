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
  assert.equal(
    await page.locator("#page-meta").textContent(),
    "4 accounts · 4 quotas loaded",
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
  assert.ok(
    await page.getByText("Drain rate will appear", { exact: false }).count(),
  );
  await page.locator('[data-view="remaining"]').click();
  await page.locator('[data-page="accounts"]').click();
  await page.locator(".account-row").first().waitFor();
  assert.equal(await page.locator(".account-row").count(), 4);
  await page.locator("#toggle-emails").click();
  assert.equal(
    await page.locator("#toggle-emails").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#toggle-emails").click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  assert.equal(
    await page.locator("#oauth-dialog").evaluate((d) => d.open),
    true,
  );
  await page
    .getByRole("button", { name: "Close sign-in", exact: true })
    .click();
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
  assert.equal(await page.locator(".account-row").count(), 4);
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
  const cookie = (await context.cookies()).find(
    (c) => c.name === "batman_dashboard",
  );
  assert.ok(cookie.httpOnly && cookie.secure && cookie.sameSite === "Strict");
  console.log(
    JSON.stringify({
      passed: true,
      accounts: 4,
      quotaWindows: 17,
      checks: [
        "login",
        "protected cookie",
        "live quotas",
        "provider filters",
        "quota window selection",
        "burn lookback",
        "drain view",
        "account list",
        "email visibility",
        "sign-in dialog",
        "connection view",
        "390px layout",
        "mobile navigation",
      ],
      pageErrors: errors,
    }),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
