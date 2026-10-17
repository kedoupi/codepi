import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, stopChild } from "../../oura/scripts/browser-cdp.mjs";

/**
 * GU 本地浏览器冒烟：构建产物 + `wrangler pages dev` 已在 --port 8791 运行。
 * 覆盖两条路径：
 *   1. SSO 模式的登录页（统一登录链接、无 OTP 表单）；
 *   2. dev OTP 模式的完整登录 → 总览 → 导航 → 退出（走真实 worker + D1 local）。
 * 运行：node scripts/browser-smoke.mjs（需要 dist/ 与 pages dev 已启动）。
 */

const BASE = process.env.GU_SMOKE_BASE || "http://127.0.0.1:8791";
const artifactDir = process.env.GU_SMOKE_ARTIFACTS || "/tmp/gu-browser-smoke";

async function expectNoFailures(page, label) {
  const failures = page.diagnostics.filter(
    (event) =>
      event.method === "Runtime.exceptionThrown" ||
      (event.method === "Runtime.consoleAPICalled" &&
        ["error", "warning"].includes(event.params.type)),
  );
  assert.deepEqual(failures, [], `${label}: no runtime exceptions or console errors`);
}

async function text(page, selector) {
  return page.evaluate((s) => document.querySelector(s)?.textContent ?? "", selector);
}

async function visible(page, selector) {
  return page.evaluate(
    (s) => {
      const el = document.querySelector(s);
      return !!el && el.getClientRects().length > 0;
    },
    selector,
  );
}

async function smokeSsoLogin(browser) {
  await browser.page.goto(`${BASE}/login`);
  await browser.page.waitForFunction(
    () => document.body.innerText.includes("登录投资工作台"),
  );
  const loginHref = await browser.page.evaluate(
    () => document.querySelector("a.primary")?.getAttribute("href") ?? "",
  );
  assert.match(loginHref, /^\/api\/auth\/login\?return=/, "SSO login link present");
  assert.equal(await visible(browser.page, "#send"), false, "no OTP form in SSO mode");
  assert.match(await text(browser.page, "main.login"), /统一登录/);
  await expectNoFailures(browser.page, "sso login page");
}

async function smokeOtpJourney(browser) {
  await browser.page.goto(`${BASE}/login`);
  await browser.page.waitForFunction(
    () => document.body.innerText.includes("发送验证码"),
  );
  await browser.page.click("#send");
  await browser.page.waitForFunction(() =>
    document.querySelector("#login-message")?.textContent.includes("本地开发验证码"),
  );
  const message = await text(browser.page, "#login-message");
  const code = message.match(/(\d{6})/)?.[1];
  assert.ok(code, `dev OTP extracted from: ${message}`);
  await browser.page.evaluate((value) => {
    const input = document.querySelector("#code");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document
      .querySelector("#verify")
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  }, code);
  await browser.page.waitForFunction(() =>
    document.body.innerText.includes("投资总览"),
  );
  await expectNoFailures(browser.page, "otp login → overview");

  for (const [hash, marker] of [
    ["#positions", "当前持仓"],
    ["#reports", "研究与报告"],
    ["#status", "数据状态"],
  ]) {
    await browser.page.evaluate((h) => (location.hash = h), hash);
    await browser.page.waitForFunction((m) => document.body.innerText.includes(m), marker);
  }
  await expectNoFailures(browser.page, "hash navigation");

  await browser.page.click("#logout");
  await browser.page.waitForFunction(() =>
    document.body.innerText.includes("登录投资工作台"),
  );
  await expectNoFailures(browser.page, "logout");
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  const browser = await launchBrowser(artifactDir);
  try {
    const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
    if (health.sso_enabled) {
      await smokeSsoLogin(browser);
    } else {
      await smokeOtpJourney(browser);
    }
    const snapshot = await browser.page.snapshot();
    await writeFile(
      join(artifactDir, "final-page.json"),
      JSON.stringify(snapshot, null, 2),
    );
    process.stdout.write(`GU browser smoke passed (${health.sso_enabled ? "sso" : "otp"} mode)\n`);
  } catch (error) {
    await browser.page.saveDiagnostics(error);
    throw error;
  } finally {
    await delay(50);
    await browser?.close();
  }
}

await main();
