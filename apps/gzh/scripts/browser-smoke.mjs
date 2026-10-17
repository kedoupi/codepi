import assert from "node:assert/strict";
import { launchBrowser } from "../../oura/scripts/browser-cdp.mjs";

/**
 * GZH 本地浏览器冒烟：构建产物 + `wrangler pages dev` 已在 --port 8788 运行。
 * 覆盖：登录页渲染、dev OTP 完整登录 → 看板 → 退出（真实 worker + D1 local）。
 * 运行：node scripts/browser-smoke.mjs（需 dist/ 与 pages dev 已启动）。
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

const browser = await launchBrowser(ARTIFACTS);
try {
  const page = browser.page;
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
