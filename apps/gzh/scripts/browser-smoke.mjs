import assert from "node:assert/strict";
import { launchBrowser } from "../../health/scripts/browser-cdp.mjs";

/**
 * GZH 本地浏览器冒烟：构建产物 + `wrangler dev` 已在 --port 8788 运行。
 * 覆盖：dev OTP 登录、桌面/移动看板与预览、阅读解锁、退出（真实 worker + D1 local）。
 * 运行：node scripts/browser-smoke.mjs（需 dist/ 与本地 Worker 已启动）。
 */

const BASE = process.env.GZH_SMOKE_BASE || "http://127.0.0.1:8788";
const ARTIFACTS = process.env.GZH_SMOKE_ARTIFACTS || "/tmp/gzh-browser-smoke";
const EMAIL = process.env.GZH_SMOKE_EMAIL || "owner@example.test";

async function expectNoFailures(page, label) {
  const failures = page.diagnostics.filter(
    (event) =>
      event.method === "Runtime.exceptionThrown" ||
      (event.method === "Runtime.consoleAPICalled" &&
        ["error", "warning"].includes(event.params.type)),
  );
  assert.deepEqual(failures, [], `${label}: no runtime exceptions or console errors`);
}

async function typeText(page, selector, value) {
  await page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { selector, value },
  );
}

async function checkLayout(page, name) {
  const metrics = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(metrics.scrollWidth <= metrics.width + 1, `${name}: no horizontal overflow`);
  await page.screenshot({ path: `${name}.png` });
}

const browser = await launchBrowser(ARTIFACTS);
try {
  const page = browser.page;
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await page.goto(`${BASE}/login`);
  await page.waitForFunction(
    () => document.body.innerText.includes("统一登录") || document.body.innerText.includes("发送验证码"),
  );
  await expectNoFailures(page, "login page");
  console.log("[smoke] login page renders");

  await typeText(page, "#email", EMAIL);
  await page.click("#send");
  await page.waitForFunction(() => /本地开发码：\d{6}/.test(document.body.innerText), undefined, { timeout: 15_000 });
  const code = await page.evaluate(() => document.body.innerText.match(/本地开发码：(\d{6})/)?.[1] ?? "");
  assert.match(code, /^\d{6}$/, "dev OTP surfaced");
  console.log("[smoke] dev OTP received");

  await typeText(page, "#code", code);
  await page.waitForFunction(() => document.body.innerText.includes("待审队列"), undefined, { timeout: 15_000 });
  await expectNoFailures(page, "desk after OTP login");
  console.log("[smoke] OTP login → desk passed");

  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }],
    ["mobile", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }],
  ]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", viewport);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.slot-board .article-main[href^="/p/"]');
    await checkLayout(page, `${name}-desk`);
    const href = await page.evaluate(
      () => document.querySelector('.slot-board .article-main[href^="/p/"]').getAttribute("href"),
    );
    await page.goto(new URL(href, BASE).href);
    await page.waitForFunction(() => Boolean(document.querySelector("#preview-article")?.shadowRoot?.querySelector("article")));
    await page.waitForFunction(() => {
      const dock = document.querySelector(".dock-review");
      const buttons = dock?.querySelectorAll(".dock-actions button");
      return dock?.classList.contains("is-locked") && buttons?.length === 3 && [...buttons].every((button) => button.disabled);
    });
    await checkLayout(page, `${name}-preview-locked`);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForFunction(() => {
      const dock = document.querySelector(".dock-review");
      const buttons = dock?.querySelectorAll(".dock-actions button");
      return dock && !dock.classList.contains("is-locked") && buttons?.length === 3 && [...buttons].every((button) => !button.disabled);
    });
    await checkLayout(page, `${name}-preview-unlocked`);
    await expectNoFailures(page, `${name} desk and preview`);
    console.log(`[smoke] ${name} desk → preview → read unlock passed`);
  }

  await page.goto(`${BASE}/`);
  await page.waitForSelector(".mast-actions .ghost-link");
  await page.click(".mast-actions .ghost-link");
  await page.waitForFunction(() => location.pathname.startsWith("/login"), undefined, { timeout: 10_000 });
  await expectNoFailures(page, "logout");
  console.log("[smoke] logout passed");
  console.log("[smoke] all passed");
} catch (error) {
  await browser.page.saveDiagnostics(error);
  throw error;
} finally {
  await browser.close();
}
