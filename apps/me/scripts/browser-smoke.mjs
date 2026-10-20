import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../../health/scripts/browser-cdp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const port = Number(process.env.ME_SMOKE_PORT || 8796);
const origin = `http://127.0.0.1:${port}`;
const artifacts = process.env.ME_SMOKE_ARTIFACTS || "/tmp/me-browser-smoke";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare, Response: WorkerResponse } = wranglerRequire("miniflare");

const DESKTOP_MEMORY =
  '桌面写作偏好，保留原文：<b data-injected="memory-desktop">不是 HTML</b>';
const MOBILE_MEMORY =
  '移动写作偏好，保留原文：<script>window.__meRawHtml=1</script>';
const DESKTOP_PROFILE =
  '桌面角色：<img src="x" onerror="window.__meRawHtml=1">';
const MOBILE_PROFILE =
  '移动位置：<b data-injected="profile-mobile">纯文本</b>';
const DESKTOP_TIMELINE =
  '桌面创业经历：<b data-injected="timeline-desktop">标题</b>';
const MOBILE_TIMELINE =
  '移动工作经历：<img src="x" onerror="window.__meRawHtml=1">';
const DESKTOP_TIMELINE_FINAL = "桌面经历已确认";
const MOBILE_TIMELINE_FINAL = "移动经历已确认";
const DESKTOP_IMPORT = "桌面导入偏好一\n桌面导入偏好二";
const MOBILE_IMPORT = "移动导入笔记一\n移动导入笔记二";
const SYNTHETIC_SECRET = `ghp_${"browser".repeat(8)}`;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

async function buildWorker() {
  const output = await mkdtemp(join(tmpdir(), "me-worker-browser-"));
  try {
    execFileSync(join(root, "node_modules", ".bin", "wrangler"), [
      "deploy", "--config", "wrangler.test.toml", "--dry-run", "--outdir", output,
    ], {
      cwd: root,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { output, source: await readFile(join(output, "index.js"), "utf8") };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    const stderr = error.stderr?.toString().trim();
    throw new Error(`Wrangler bundle failed${stderr ? `: ${stderr}` : ""}`, { cause: error });
  }
}

async function applyMigrations(db) {
  const directory = join(root, "migrations");
  for (const name of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) {
    // Match services/mcp test/runtime.mjs so integration catches unsplittable SQL.
    const sql = (await readFile(join(directory, name), "utf8")).replace(/--[^\n]*/g, "");
    const statements = sql.split(";").map(statement => statement.trim()).filter(Boolean);
    await db.batch(statements.map(statement => db.prepare(statement)));
  }
}

function centralFixture() {
  const refs = new Map();
  const state = { exchanges: 0, sessions: 0, logouts: 0 };
  return {
    state,
    async fetch(request) {
      if (request.headers.get("Authorization") !== `Basic ${btoa("me:me-browser-secret")}`) {
        return new Response("", { status: 401 });
      }
      const path = new URL(request.url).pathname;
      const body = await request.json();
      if (path === "/internal/exchange") {
        state.exchanges++;
        const ref = randomUUID();
        refs.set(ref, { active: true, subject: "kdp-owner", expires_at: Date.now() + 30 * 86400_000 });
        return Response.json({ ...refs.get(ref), session_ref: ref });
      }
      if (path === "/internal/session") {
        state.sessions++;
        return Response.json(refs.get(body.session_ref) ?? { active: false });
      }
      if (path === "/internal/logout") {
        state.logouts++;
        if (refs.has(body.session_ref)) refs.get(body.session_ref).active = false;
        return Response.json({ ok: true });
      }
      return new Response("", { status: 404 });
    },
  };
}

async function assetResponse(request) {
  const pathname = new URL(request.url).pathname;
  const candidate = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!/^[a-zA-Z0-9_./-]+$/.test(candidate) || candidate.includes("..")) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const body = await readFile(join(dist, candidate));
    return new Response(body, {
      headers: {
        "Content-Type": contentTypes.get(extname(candidate)) || "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function driverSource() {
  return `
    export default {
      async fetch(request, env) {
        if (new URL(request.url).pathname !== "/rpc") return new Response("Not found", { status: 404 });
        const body = await request.json();
        const reply = await env.ME.execute(body);
        return Response.json(reply, { status: reply.ok ? 200 : reply.status });
      }
    };
  `;
}

async function createRuntime(workerSource, auth) {
  const values = Object.fromEntries(Object.entries({
    ENVIRONMENT: "test",
    SSO_ENABLED: "1",
    AUTH_CLIENT_ID: "me",
    AUTH_CLIENT_SECRET: "me-browser-secret",
    AUTH_ORIGIN: origin,
  }).map(([key, value]) => [key, { type: "json", value }]));
  const runtime = new Miniflare({
    workers: [{
      config: {
        name: "me",
        compatibilityDate: "2026-09-16",
        compatibilityFlags: ["nodejs_compat"],
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: workerSource } },
        },
        exports: {
          MeMcp: { type: "worker" },
          MeImportsBackup: { type: "worker" },
        },
        env: {
          DB: { type: "d1", name: "me-browser" },
          IMPORTS: { type: "r2", name: "me-browser-imports" },
          ASSETS: { type: "fetcher", handler: assetResponse },
          AUTH: { type: "fetcher", handler: auth.fetch },
          ...values,
        },
      },
    }, {
      config: {
        name: "me-driver",
        compatibilityDate: "2026-09-16",
        compatibilityFlags: ["nodejs_compat"],
        manifest: {
          mainModule: "driver.js",
          modules: { "driver.js": { type: "esm", contents: driverSource() } },
        },
        env: {
          ME: { type: "worker", worker: "me", exportName: "MeMcp" },
        },
      },
    }],
  });
  await runtime.ready;
  const db = await runtime.getD1Database("DB", "me");
  await applyMigrations(db);
  return {
    runtime,
    db,
    bucket: await runtime.getR2Bucket("IMPORTS", "me"),
    worker: await runtime.getWorker("me"),
    driver: await runtime.getWorker("me-driver"),
  };
}

async function startProxy(worker) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", origin);
      if (url.pathname === "/authorize") {
        assert.equal(request.method, "GET");
        assert.equal(url.searchParams.get("client_id"), "me");
        const redirect = new URL(url.searchParams.get("redirect_uri") || "");
        assert.equal(redirect.href, `${origin}/api/auth/callback`);
        assert.ok(url.searchParams.get("state"));
        redirect.searchParams.set("code", `synthetic-${randomUUID()}`);
        redirect.searchParams.set("state", url.searchParams.get("state"));
        response.writeHead(302, {
          Location: redirect.href,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        response.end();
        return;
      }

      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (!value || ["host", "connection", "content-length", "transfer-encoding"].includes(key)) continue;
        if (Array.isArray(value)) for (const item of value) headers.append(key, item);
        else headers.set(key, value);
      }
      const method = request.method || "GET";
      const proxied = new Request(`${origin}${url.pathname}${url.search}`, {
        method,
        headers,
        body: ["GET", "HEAD"].includes(method) ? undefined : Buffer.concat(chunks),
        redirect: "manual",
      });
      const result = await worker.fetch(proxied);
      const outgoing = {};
      for (const [key, value] of result.headers) {
        if (key !== "set-cookie") outgoing[key] = value;
      }
      const cookies = result.headers.getSetCookie();
      if (cookies.length) outgoing["set-cookie"] = cookies;
      response.writeHead(result.status, outgoing);
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
      }
      response.end("Browser fixture proxy error");
      if (process.env.ME_SMOKE_DEBUG === "1") console.error(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

async function text(page, selector) {
  return page.evaluate(selector => document.querySelector(selector)?.textContent || "", selector);
}

async function waitText(page, expected, timeout = 15000) {
  await page.waitForFunction(value => document.body.innerText.includes(value), expected, { timeout });
}

async function clickText(page, label) {
  const result = await page.evaluate(label => {
    const matches = [...document.querySelectorAll("a,button")]
      .filter(element => element.getClientRects().length)
      .filter(element => element.textContent.trim() === label);
    if (matches.length !== 1) return { count: matches.length };
    matches[0].scrollIntoView({ block: "center", behavior: "instant" });
    matches[0].click();
    return { count: 1 };
  }, label);
  assert.equal(result.count, 1, `expected one visible control labelled ${label}`);
}

async function clickInRecord(page, contains, label) {
  const result = await page.evaluate(({ contains, label }) => {
    const records = [...document.querySelectorAll("article.record")]
      .filter(record => record.getClientRects().length)
      .filter(record => record.textContent.includes(contains));
    if (records.length !== 1) return { records: records.length };
    const buttons = [...records[0].querySelectorAll("button")]
      .filter(button => button.getClientRects().length)
      .filter(button => button.textContent.trim() === label);
    if (buttons.length !== 1) return { records: 1, buttons: buttons.length };
    buttons[0].scrollIntoView({ block: "center", behavior: "instant" });
    buttons[0].click();
    return { records: 1, buttons: 1 };
  }, { contains, label });
  assert.deepEqual(result, { records: 1, buttons: 1 }, `record ${contains}: ${label}`);
}

async function setField(page, selector, value) {
  const result = await page.evaluate(({ selector, value }) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement)) return false;
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { selector, value });
  assert.equal(result, true, `field ${selector}`);
}

async function setLabel(page, label, value) {
  const result = await page.evaluate(({ label, value }) => {
    const labels = [...document.querySelectorAll("label")]
      .filter(element => element.getClientRects().length)
      .filter(element => element.textContent.trim().includes(label));
    if (labels.length !== 1) return { labels: labels.length };
    const element = labels[0].querySelector("input,textarea,select");
    if (!element) return { labels: 1, fields: 0 };
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { labels: 1, fields: 1 };
  }, { label, value });
  assert.deepEqual(result, { labels: 1, fields: 1 }, `field labelled ${label}`);
}

async function assertLayout(page, label, width) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    fontToken: getComputedStyle(document.documentElement).getPropertyValue("--kdp-font").trim(),
    sidebar: document.querySelector(".sidebar")
      ? getComputedStyle(document.querySelector(".sidebar")).position
      : null,
  }));
  assert.equal(dimensions.width, width, `${label}: viewport width`);
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1,
    `${label}: horizontal overflow ${dimensions.scrollWidth}`);
  assert.ok(dimensions.fontToken, `${label}: shared visual token loaded`);
  if (dimensions.sidebar) {
    assert.equal(dimensions.sidebar, width <= 640 ? "static" : "fixed", `${label}: responsive sidebar`);
  }
}

async function assertNoRawHtml(page, label) {
  const state = await page.evaluate(() => ({
    injected: document.querySelectorAll(
      '[data-injected], img[src="x"], iframe, object, embed',
    ).length,
    inlineScripts: [...document.scripts].filter(script => !script.src).length,
    marker: window.__meRawHtml ?? null,
  }));
  assert.equal(state.injected, 0, `${label}: no injected HTML elements`);
  assert.equal(state.inlineScripts, 0, `${label}: no inline scripts from data`);
  assert.equal(state.marker, null, `${label}: data did not execute as HTML`);
}

async function screenshot(page, name) {
  await page.screenshot({ path: name });
}

const failureArtifacts = ["failure.txt", "failure-page.json", "failure.png", "capture.json", "console-network.json"];

async function clearStaleDiagnostics() {
  for (const name of failureArtifacts) await rm(join(artifacts, name), { force: true });
}

function expectedImportError(event) {
  if (event.method === "Network.responseReceived") {
    return (event.params.response?.status ?? event.params.status) === 400
      && (event.params.response?.url ?? event.params.url)?.endsWith("/api/imports/paste");
  }
  return event.method === "Log.entryAdded"
    && event.params.entry?.level === "error"
    && event.params.entry?.url?.endsWith("/api/imports/paste")
    && event.params.entry?.text?.includes("400");
}

async function rpc(driver, operation, args = {}, client = "browser-desktop-ai") {
  const response = await driver.fetch("https://me-driver.internal/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: "kdp-owner",
      client,
      clientName: "Browser synthetic AI",
      operation,
      args,
    }),
  });
  const reply = await response.json();
  assert.equal(reply.ok, true, `${operation}: ${reply.error || "unknown error"}`);
  return reply.data;
}

async function importSnapshot(db, bucket) {
  const counts = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM imports) AS imports,
    (SELECT COUNT(*) FROM import_sessions) AS sessions,
    (SELECT COUNT(*) FROM import_chunks) AS chunks`).first();
  const objects = await bucket.list({ prefix: "imports/" });
  return { ...counts, objects: objects.objects.length };
}

async function runImportError(page, db, bucket, before) {
  await setField(page, "form textarea", SYNTHETIC_SECRET);
  await page.waitForFunction(() =>
    !document.querySelector('form button[type="submit"]')?.disabled);
  await clickText(page, "导入到待确认区");
  await waitText(page, "检测到疑似密钥，整次提交未保存。请移除后重试。");
  assert.deepEqual(await importSnapshot(db, bucket), before, "secret import leaves no D1/R2 data");
  await setField(page, "form textarea", "");
}

async function runImportSuccess(page, db, bucket, expectedObjects, content) {
  await setField(page, "form textarea", content);
  await page.waitForFunction(() =>
    !document.querySelector('form button[type="submit"]')?.disabled);
  await clickText(page, "导入到待确认区");
  await waitText(page, "导入完成，内容已进入待确认区。");
  assert.equal((await importSnapshot(db, bucket)).objects, expectedObjects,
    "successful import stores its original in R2");
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  await clearStaleDiagnostics();
  const built = await buildWorker();
  const auth = centralFixture();
  let runtime;
  let server;
  let browser;
  let failure;
  try {
    const fixture = await createRuntime(built.source, auth);
    runtime = fixture.runtime;
    const { db, bucket, driver } = fixture;
    const initial = await importSnapshot(db, bucket);

    const desktopMemory = await rpc(driver, "memory.save", {
      text: DESKTOP_MEMORY, kind: "preference", tags: ["写作", "桌面"],
    });
    const mobileMemory = await rpc(driver, "memory.save", {
      text: MOBILE_MEMORY, kind: "note", tags: ["写作", "移动"],
    }, "browser-mobile-ai");
    await rpc(driver, "entry.propose", {
      type: "profile", key: "role", value: DESKTOP_PROFILE,
    });
    await rpc(driver, "entry.propose", {
      type: "profile", key: "location", value: MOBILE_PROFILE,
    }, "browser-mobile-ai");
    await rpc(driver, "entry.propose", {
      type: "timeline", kind: "startup", title: DESKTOP_TIMELINE, org: "合成组织",
      started_on: "2021", ended_on: "2023",
      body: '桌面经历正文：<script>window.__meRawHtml=1</script>',
    });
    await rpc(driver, "entry.propose", {
      type: "timeline", kind: "work", title: MOBILE_TIMELINE, org: "合成公司",
      started_on: "2024", ended_on: "",
      body: '移动经历正文：<b data-injected="timeline-mobile">纯文本</b>',
    }, "browser-mobile-ai");

    assert.equal((await rpc(driver, "memory.search", { query: "桌面" })).items.length, 0,
      "AI memory starts pending");
    assert.equal((await rpc(driver, "profile.get")).profile.length, 0,
      "AI profile proposal is not active");
    assert.equal((await rpc(driver, "timeline.search", { query: "桌面" })).items.length, 0,
      "AI timeline proposal is not active");

    server = await startProxy(fixture.worker);
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true, source: "me", build: "local", sso_enabled: true, sso_ready: true,
    });

    browser = await launchBrowser(artifacts);
    const page = browser.page;
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await page.goto(`${origin}/login`);
    await waitText(page, "统一登录");
    await assertLayout(page, "desktop login", 1440);
    await screenshot(page, "desktop-login.png");
    await clickText(page, "统一登录");
    await page.waitForFunction(() =>
      location.pathname === "/" && document.body.innerText.includes("由你确认的记忆"));
    await waitText(page, DESKTOP_MEMORY);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM kdp_sso_sessions").first()).n, 1,
      "browser completed the real SSO callback and local session write");
    assert.equal(auth.state.exchanges, 1, "one synthetic central exchange");
    assert.ok(auth.state.sessions > 0, "shared session client was exercised");
    await assertLayout(page, "desktop pending memory", 1440);
    await assertNoRawHtml(page, "desktop pending memory");
    await screenshot(page, "desktop-memory-pending.png");

    await clickInRecord(page, DESKTOP_MEMORY, "确认");
    await waitText(page, "已确认，可供 AI 读取。");
    const desktopFound = await rpc(driver, "memory.search", { query: "桌面" });
    assert.equal(desktopFound.items.length, 1);
    assert.equal(desktopFound.items[0].id, desktopMemory.id);

    await setField(page, 'form.filters input[type="search"]', "桌面");
    await clickText(page, "搜索记忆");
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="记忆列表"]')?.innerText.includes("桌面写作偏好"));
    assert.ok((await text(page, '[aria-label="记忆列表"]')).includes(DESKTOP_MEMORY));
    await assertLayout(page, "desktop memory search", 1440);
    await assertNoRawHtml(page, "desktop memory search");
    await screenshot(page, "desktop-memory-search.png");
    await clickInRecord(page, DESKTOP_MEMORY, "归档");
    await waitText(page, "已归档，AI 将不再读取。");
    assert.equal((await rpc(driver, "memory.search", { query: "桌面" })).items.length, 0,
      "archived memory disappears from AI search");

    await page.goto(`${origin}/profile`);
    await waitText(page, DESKTOP_PROFILE);
    await assertLayout(page, "desktop profile", 1440);
    await assertNoRawHtml(page, "desktop profile");
    await clickInRecord(page, DESKTOP_PROFILE, "确认更新背景");
    await waitText(page, "已保存。");
    const desktopProfile = await rpc(driver, "profile.get");
    assert.equal(desktopProfile.profile.find(item => item.key === "role")?.value, DESKTOP_PROFILE);
    await clickInRecord(page, DESKTOP_PROFILE, "编辑背景");
    await waitText(page, "编辑个人背景");
    await setLabel(page, "内容", "桌面角色已由本人编辑");
    await clickText(page, "保存并生效");
    await waitText(page, "桌面角色已由本人编辑");
    assert.equal((await rpc(driver, "profile.get")).profile
      .find(item => item.key === "role")?.value, "桌面角色已由本人编辑");
    await assertLayout(page, "desktop profile edited", 1440);
    await assertNoRawHtml(page, "desktop profile edited");
    await screenshot(page, "desktop-profile.png");

    await page.goto(`${origin}/timeline`);
    await waitText(page, DESKTOP_TIMELINE);
    await assertLayout(page, "desktop timeline", 1440);
    await assertNoRawHtml(page, "desktop timeline");
    await clickInRecord(page, DESKTOP_TIMELINE, "修改后确认");
    await waitText(page, "保存并确认");
    await setLabel(page, "标题", DESKTOP_TIMELINE_FINAL);
    await setLabel(page, "经历正文",
      '桌面经历已确认：<b data-injected="timeline-body">纯文本</b>');
    await clickText(page, "保存并确认");
    await waitText(page, DESKTOP_TIMELINE_FINAL);
    await clickInRecord(page, DESKTOP_TIMELINE_FINAL, "编辑经历");
    await waitText(page, "保存并生效");
    await setLabel(page, "组织（选填）", "本人确认组织");
    await clickText(page, "保存并生效");
    await waitText(page, "已保存。");
    const desktopTimeline = await rpc(driver, "timeline.search", { query: "桌面经历" });
    assert.equal(desktopTimeline.items.length, 1);
    assert.equal(desktopTimeline.items[0].org, "本人确认组织");
    await setField(page, 'form.filters input[type="search"]', "桌面");
    await clickText(page, "搜索经历");
    await waitText(page, DESKTOP_TIMELINE_FINAL);
    await assertLayout(page, "desktop timeline edited", 1440);
    await assertNoRawHtml(page, "desktop timeline edited");
    await screenshot(page, "desktop-timeline.png");
    await clickInRecord(page, DESKTOP_TIMELINE_FINAL, "归档");
    await waitText(page, "已归档，AI 将不再读取。");
    assert.equal((await rpc(driver, "timeline.search", { query: "桌面经历" })).items.length, 0,
      "archived timeline disappears from AI search");

    await page.goto(`${origin}/imports`);
    await waitText(page, "粘贴导入");
    await assertLayout(page, "desktop imports", 1440);
    const beforeDesktopImport = await importSnapshot(db, bucket);
    await runImportError(page, db, bucket, beforeDesktopImport);
    await waitText(page, "检测到疑似密钥，整次提交未保存。请移除后重试。");
    await runImportSuccess(page, db, bucket, beforeDesktopImport.objects + 1, DESKTOP_IMPORT);
    await waitText(page, "2 条 · 已确认 0 · 待确认 2");
    await clickInRecord(page, "待确认 2", "确认本批待确认内容");
    await waitText(page, "将确认这一批的 2 条待确认记忆。");
    await clickText(page, "确认处理本批");
    await waitText(page, "本批待确认记忆已处理。");
    await waitText(page, "2 条 · 已确认 2 · 待确认 0");
    const desktopImported = await rpc(driver, "memory.search", { query: "桌面导入" });
    assert.equal(desktopImported.items.length, 2);
    assert.ok(desktopImported.items.every(item => item.status === "active"));
    await assertLayout(page, "desktop imports complete", 1440);
    await assertNoRawHtml(page, "desktop imports complete");
    await screenshot(page, "desktop-imports.png");

    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await page.goto(`${origin}/`);
    await waitText(page, MOBILE_MEMORY);
    await assertLayout(page, "mobile pending memory", 390);
    await assertNoRawHtml(page, "mobile pending memory");
    await screenshot(page, "mobile-memory-pending.png");
    await clickInRecord(page, MOBILE_MEMORY, "确认");
    await waitText(page, "已确认，可供 AI 读取。");
    assert.equal((await rpc(driver, "memory.search", { query: "移动" }, "browser-mobile-ai"))
      .items[0].id, mobileMemory.id);
    await setField(page, 'form.filters input[type="search"]', "移动");
    await clickText(page, "搜索记忆");
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="记忆列表"]')?.innerText.includes("移动写作偏好"));
    await assertLayout(page, "mobile memory search", 390);
    await assertNoRawHtml(page, "mobile memory search");
    await screenshot(page, "mobile-memory-search.png");
    await clickInRecord(page, MOBILE_MEMORY, "归档");
    await waitText(page, "已归档，AI 将不再读取。");
    assert.equal((await rpc(driver, "memory.search", { query: "移动" }, "browser-mobile-ai"))
      .items.length, 0, "mobile archive hides memory from AI search");

    await page.goto(`${origin}/profile`);
    await waitText(page, MOBILE_PROFILE);
    await assertLayout(page, "mobile profile", 390);
    await assertNoRawHtml(page, "mobile profile");
    await clickInRecord(page, MOBILE_PROFILE, "修改后确认");
    await waitText(page, "保存并确认");
    await setLabel(page, "确认后的内容", "移动位置已由本人确认");
    await clickText(page, "保存并确认");
    await waitText(page, "移动位置已由本人确认");
    assert.equal((await rpc(driver, "profile.get", {}, "browser-mobile-ai")).profile
      .find(item => item.key === "location")?.value, "移动位置已由本人确认");
    await assertLayout(page, "mobile profile edited", 390);
    await assertNoRawHtml(page, "mobile profile edited");
    await screenshot(page, "mobile-profile.png");

    await page.goto(`${origin}/timeline`);
    await waitText(page, MOBILE_TIMELINE);
    await assertLayout(page, "mobile timeline", 390);
    await assertNoRawHtml(page, "mobile timeline");
    await clickInRecord(page, MOBILE_TIMELINE, "修改后确认");
    await waitText(page, "保存并确认");
    await setLabel(page, "标题", MOBILE_TIMELINE_FINAL);
    await clickText(page, "保存并确认");
    await waitText(page, MOBILE_TIMELINE_FINAL);
    assert.equal((await rpc(driver, "timeline.search", { query: "移动经历" }, "browser-mobile-ai"))
      .items.length, 1);
    await assertLayout(page, "mobile timeline edited", 390);
    await assertNoRawHtml(page, "mobile timeline edited");
    await screenshot(page, "mobile-timeline.png");
    await clickInRecord(page, MOBILE_TIMELINE_FINAL, "归档");
    await waitText(page, "已归档，AI 将不再读取。");
    assert.equal((await rpc(driver, "timeline.search", { query: "移动经历" }, "browser-mobile-ai"))
      .items.length, 0, "mobile archive hides timeline from AI search");

    await page.goto(`${origin}/imports`);
    await waitText(page, "粘贴导入");
    await assertLayout(page, "mobile imports", 390);
    const beforeMobileImport = await importSnapshot(db, bucket);
    await runImportError(page, db, bucket, beforeMobileImport);
    await waitText(page, "检测到疑似密钥，整次提交未保存。请移除后重试。");
    await assertLayout(page, "mobile import error", 390);
    await assertNoRawHtml(page, "mobile import error");
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await screenshot(page, "mobile-import-error.png");
    await runImportSuccess(page, db, bucket, beforeMobileImport.objects + 1, MOBILE_IMPORT);
    await waitText(page, "2 条 · 已确认 0 · 待确认 2");
    await assertLayout(page, "mobile imports complete", 390);
    await assertNoRawHtml(page, "mobile imports complete");
    await screenshot(page, "mobile-imports.png");

    const importRows = await db.prepare(
      "SELECT id,source_client,r2_key,bytes,sha256 FROM imports ORDER BY rowid",
    ).all();
    assert.equal(importRows.results.length, 2, "two completed owner imports");
    assert.ok(importRows.results.every(row => row.source_client === "board"));
    for (const row of importRows.results) {
      assert.equal(row.r2_key, `imports/${row.id}`);
      const object = await bucket.get(row.r2_key);
      assert.ok(object, `R2 original exists for ${row.id}`);
      assert.equal(object.size, row.bytes);
      const bytes = await object.arrayBuffer();
      assert.equal(createHash("sha256").update(Buffer.from(bytes)).digest("hex"), row.sha256);
    }
    const importedCounts = await db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
      FROM memories WHERE import_id IS NOT NULL`).first();
    assert.deepEqual(importedCounts, { total: 4, active: 2, pending: 2 });
    assert.equal((await rpc(driver, "memory.search", { query: "移动导入" })).items.length, 0,
      "unapproved imported memories remain unreadable");
    assert.equal((await rpc(driver, "memory.search", { query: "桌面导入" })).items.length, 2);
    assert.ok(initial.imports === 0 && initial.sessions === 0, "fixture starts empty");

    const expectedStatuses = browser.page.diagnostics.filter(event =>
      event.method === "Network.responseReceived" && expectedImportError(event));
    assert.equal(expectedStatuses.length, 2, "both secret import errors used the real endpoint");
    const expectedLogs = browser.page.diagnostics.filter(event =>
      event.method === "Log.entryAdded" && expectedImportError(event));
    assert.equal(expectedLogs.length, 2, "both expected 400 responses are the only network log errors");
    const failures = browser.page.diagnostics.filter(event => {
      if (event.method === "Runtime.exceptionThrown") return true;
      if (event.method === "Log.entryAdded") {
        if (expectedImportError(event)) return false;
        return ["error", "warning"].includes(event.params.entry.level);
      }
      if (event.method === "Runtime.consoleAPICalled") {
        return ["error", "warning"].includes(event.params.type);
      }
      if (event.method === "Network.loadingFailed") return true;
      if (event.method === "Network.responseReceived") {
        const status = event.params.response?.status ?? event.params.status;
        if (status >= 400 && !expectedImportError(event)) return true;
      }
      return false;
    });
    assert.deepEqual(failures, [], "no unexpected console, runtime or network errors");

    await writeFile(join(artifacts, "console-network.json"),
      JSON.stringify(browser.page.diagnostics, null, 2));
    await writeFile(join(artifacts, "acceptance.json"), JSON.stringify({
      origin,
      viewports: ["1440x1000 desktop", "390x844 mobile"],
      sso: auth.state,
      memory_ids: [desktopMemory.id, mobileMemory.id],
      imports: importRows.results.map(row => ({
        id: row.id, source_client: row.source_client, bytes: row.bytes, sha256: row.sha256,
      })),
      imported_memories: importedCounts,
      expected_import_errors: expectedStatuses.length,
    }, null, 2));
    await writeFile(join(artifacts, "final-page.json"), JSON.stringify(await page.snapshot(), null, 2));
    for (const name of failureArtifacts.filter(name => name !== "console-network.json")) {
      await rm(join(artifacts, name), { force: true });
    }
    process.stdout.write("Me browser smoke passed (desktop + 390px mobile; real Worker/D1/R2)\n");
  } catch (error) {
    failure = error;
    if (browser) await browser.page.saveDiagnostics(error);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) await closeServer(server);
    if (runtime) await runtime.dispose();
    if (failure) {
      process.stderr.write(`Me browser smoke failed; diagnostics: ${artifacts}\n`);
    }
    await rm(built.output, { recursive: true, force: true });
  }
}

await main();
