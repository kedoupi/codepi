// Rhythm 浏览器冒烟：合成 SSO + 本地 Worker/D1 + 假的 STATUS_READ。
// 只用合成数据；不访问真实上游、不写生产资源。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchBrowser } from "../../health/scripts/browser-cdp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const requestedPort = resolveSmokePort(process.env.RHYTHM_SMOKE_PORT);
const artifacts = process.env.RHYTHM_SMOKE_ARTIFACTS || "/tmp/rhythm-browser-smoke";
let origin;

function resolveSmokePort(value) {
  if (value == null || value === "") return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`RHYTHM_SMOKE_PORT must be an integer from 0 to 65535; received ${JSON.stringify(value)}`);
  }
  return port;
}

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare } = wranglerRequire("miniflare");

// Local synthetic SSO credential for the browser fixture only.
const BROWSER_SSO_SECRET = "rhythm-browser-secret";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function shanghaiDate(now = Date.now()) {
  const local = new Date(now + 8 * 60 * 60 * 1000);
  const pad = value => String(value).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

function shanghaiMinute(now = Date.now()) {
  const local = new Date(now + 8 * 60 * 60 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

async function buildWorker() {
  const output = await mkdtemp(join(tmpdir(), "rhythm-worker-browser-"));
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
      if (request.headers.get("Authorization") !== `Basic ${btoa("rhythm:" + BROWSER_SSO_SECRET)}`) {
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

/**
 * Synthetic upstream, generated per requested day: ordinary workdays, home-only rest days and one
 * workday that starts 100 minutes late (so the trends page has an anomaly). No real host, device or network name.
 */
function statusReadFixture() {
  const state = { fail: false, empty: false, calls: [] };
  const now = Date.now();
  const today = shanghaiDate(now);
  const currentMinute = Math.max(0, Math.min(1439, shanghaiMinute(now)));
  const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
  const isWorkday = date => weekday(date) >= 1 && weekday(date) <= 5;
  const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
  const lateDay = [1, 2, 3, 4, 5, 6, 7].map(days => addDays(today, -days)).find(isWorkday);
  const stamp = (day, minute) => new Date(Date.parse(`${day}T00:00:00+08:00`) + minute * 60_000).toISOString();

  function dayRows(day, resource) {
    const isToday = day === today;
    const limit = isToday ? currentMinute : 1439;
    const activityLimit = isToday ? Math.max(0, currentMinute - 9) : 1439;
    const shift = day === lateDay ? 100 : 0;
    const jitter = (Number(day.slice(-2)) % 4) * 5;
    const rows = [];
    if (resource === "activity_samples") {
      if (!isWorkday(day)) {
        for (let minute = 600; minute <= Math.min(660, activityLimit); minute += 1) {
          rows.push({ sampled_at: stamp(day, minute), net: "home", idle_sec: 30, locked: 0, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" });
        }
        return rows;
      }
      for (let minute = 0; minute <= Math.min(450 + shift, activityLimit); minute += 1) {
        rows.push({ sampled_at: stamp(day, minute), net: "home", idle_sec: 900, locked: 0 });
      }
      for (let minute = 520 + shift + jitter + (day === lateDay ? 100 : 0); minute <= Math.min(1085, activityLimit); minute += 1) {
        if (minute === 720) {
          rows.push({ sampled_at: stamp(day, minute), net: "other", ssid: "示例网络", idle_sec: 30, locked: 0, key_idle_sec: 20, pointer_idle_sec: 40 });
          continue;
        }
        rows.push({
          sampled_at: stamp(day, minute), net: "office", idle_sec: 30, locked: 0,
          key_idle_sec: 20, pointer_idle_sec: 40,
          app_name: minute % 3 === 0 ? "示例沟通" : "示例编辑器",
        });
      }
      if (isToday && currentMinute < 520) {
        for (let minute = Math.max(0, currentMinute - 30); minute <= activityLimit; minute += 1) {
          rows.push({
            sampled_at: stamp(day, minute), net: "office", idle_sec: 30, locked: 0,
            key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器",
          });
        }
      }
      for (let minute = 1170; minute <= Math.min(1439, activityLimit); minute += 1) {
        rows.push({ sampled_at: stamp(day, minute), net: "home", idle_sec: 900, locked: 0 });
      }
      return rows;
    }
    if (resource === "snapshots") {
      const homeAllDay = !isWorkday(day);
      for (let minute = 0; minute <= limit; minute += 10) {
        if (!homeAllDay && minute > 420 + shift && minute < 1170) continue;
        const room = minute < 1170 ? "卧室" : "客厅";
        rows.push({ source_id: "home-scanner", device_id: "dev-a", observed_at: stamp(day, minute), status: "online", room });
        rows.push({ source_id: "home-scanner", device_id: "dev-b", observed_at: stamp(day, minute), status: "offline", room: null });
      }
      return rows;
    }
    if (resource === "events") {
      if (isWorkday(day)) {
        rows.push({ source_id: "home-scanner", device_id: "dev-a", event_at: stamp(day, 421 + shift), status: "offline" });
        rows.push({ source_id: "home-scanner", device_id: "dev-b", event_at: stamp(day, 421 + shift), status: "online" });
        rows.push({ source_id: "home-scanner", device_id: "dev-b", event_at: stamp(day, 422 + shift), status: "offline" });
        rows.push({ source_id: "home-scanner", device_id: "dev-a", event_at: stamp(day, 1170), status: "online" });
        rows.push({ source_id: "home-scanner", device_id: "dev-b", event_at: stamp(day, 1170), status: "offline" });
        if (isToday && currentMinute < 520) {
          rows.push({ source_id: "home-scanner", device_id: "dev-a", event_at: stamp(day, activityLimit), status: "offline" });
          rows.push({ source_id: "home-scanner", device_id: "dev-b", event_at: stamp(day, activityLimit), status: "offline" });
        }
      }
      return rows;
    }
    if (resource === "heartbeats") {
      for (let minute = 0; minute <= Math.min(1430, limit); minute += 10) {
        rows.push({ source_id: "home-scanner", observed_at: stamp(day, minute), scan_ok: 1, device_count: 2 });
      }
      return rows;
    }
    return rows;
  }

  const rowsFor = url => {
    const resource = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    if (resource === "devices") {
      return [
        { source_id: "home-scanner", device_id: "dev-a", name: "示例手机", vendor: "示例厂商", room: "卧室", current_status: "online" },
        { source_id: "home-scanner", device_id: "dev-b", name: "示例手机备用频段", vendor: "示例厂商", room: "卧室", current_status: "offline" },
      ];
    }
    const from = Date.parse(url.searchParams.get("from") || "");
    const to = Date.parse(url.searchParams.get("to") || "");
    assert.ok(Number.isFinite(from) && Number.isFinite(to), `${resource}: time-series reads carry from/to`);
    const rows = [];
    for (let day = shanghaiDate(from); day <= shanghaiDate(to) && day <= today; day = addDays(day, 1)) {
      rows.push(...dayRows(day, resource));
    }
    const at = row => Date.parse(row.sampled_at ?? row.observed_at ?? row.event_at);
    return rows.filter(row => at(row) >= from && at(row) <= to);
  };
  return {
    state,
    lateDay,
    async fetch(request) {
      const url = new URL(request.url);
      state.calls.push(url.pathname);
      if (state.empty) return Response.json({ ok: true, resource: url.pathname, rows: [] });
      if (state.fail) return new Response("synthetic upstream outage", { status: 503 });
      return Response.json({ ok: true, resource: url.pathname, rows: rowsFor(url) });
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

async function createRuntime(workerSource, auth, upstream) {
  const values = Object.fromEntries(Object.entries({
    ENVIRONMENT: "test",
    SSO_ENABLED: "1",
    AUTH_CLIENT_ID: "rhythm",
    AUTH_CLIENT_SECRET: BROWSER_SSO_SECRET,
    AUTH_ORIGIN: origin,
  }).map(([key, value]) => [key, { type: "json", value }]));
  const runtime = new Miniflare({
    workers: [{
      config: {
        name: "rhythm",
        compatibilityDate: "2026-09-16",
        compatibilityFlags: ["nodejs_compat"],
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: workerSource } },
        },
        env: {
          DB: { type: "d1", name: "rhythm-browser" },
          ASSETS: { type: "fetcher", handler: assetResponse },
          AUTH: { type: "fetcher", handler: auth.fetch },
          STATUS_READ: { type: "fetcher", handler: upstream.fetch },
          ...values,
        },
      },
    }],
  });
  await runtime.ready;
  const db = await runtime.getD1Database("DB", "rhythm");
  await applyMigrations(db);
  return { runtime, db, worker: await runtime.getWorker("rhythm") };
}

async function startProxy(worker, listenPort = requestedPort) {
  let activeWorker = worker;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", origin);
      if (url.pathname === "/authorize") {
        assert.equal(request.method, "GET");
        assert.equal(url.searchParams.get("client_id"), "rhythm");
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
      if (!activeWorker) throw new Error("Browser fixture proxy worker is not ready");
      const result = await activeWorker.fetch(proxied);
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
      if (process.env.RHYTHM_SMOKE_DEBUG === "1") console.error(error);
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(listenPort, "localhost", resolve);
    });
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  const address = server.address();
  assert.ok(address && typeof address === "object", "proxy listener has an address");
  origin = `http://localhost:${address.port}`;
  return { server, setWorker(value) { activeWorker = value; }, origin, port: address.port };
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

async function waitText(page, expected, timeout = 20000) {
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

async function assertVisibleButtons(page, label) {
  const heights = await page.evaluate(() => [...document.querySelectorAll("button")]
    .filter(button => button.getClientRects().length)
    .map(button => ({ label: button.textContent?.trim() ?? "", height: button.getBoundingClientRect().height })));
  assert.ok(heights.length > 0, `${label}: visible buttons exist`);
  assert.ok(heights.every(button => button.height >= 44), `${label}: visible buttons are at least 44px: ${JSON.stringify(heights)}`);
}

async function assertNoRawHtml(page, label) {
  const state = await page.evaluate(() => ({
    injected: document.querySelectorAll("[data-injected], iframe, object, embed").length,
    inlineScripts: [...document.scripts].filter(script => !script.src).length,
    marker: window.__rhythmRawHtml ?? null,
  }));
  assert.equal(state.injected, 0, `${label}: no injected HTML elements`);
  assert.equal(state.inlineScripts, 0, `${label}: no inline scripts from data`);
  assert.equal(state.marker, null, `${label}: data did not execute as HTML`);
}

async function sectionVisible(page, heading) {
  return page.evaluate(text => {
    const match = [...document.querySelectorAll("h2")].find(item => item.textContent.trim() === text);
    return Boolean(match && match.getClientRects().length);
  }, heading);
}

async function setColorScheme(page, value) {
  await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
}

async function assertTheme(page, label, expected) {
  const theme = await page.evaluate(() => ({
    attribute: document.documentElement.dataset.theme ?? null,
    background: getComputedStyle(document.documentElement).backgroundColor,
  }));
  assert.equal(theme.attribute, expected, `${label}: data-theme follows the system`);
  if (expected === "dark") assert.equal(theme.background, "rgb(36, 35, 33)", `${label}: dark background token applied`);
}

/** 整页截图（趋势、设置页较长），用于人工验收。 */
async function fullScreenshot(page, name) {
  const { data } = await page.cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(join(artifacts, name), Buffer.from(data, "base64"));
}

async function screenshot(page, name) {
  await page.screenshot({ path: name });
}

const failureArtifacts = ["failure.txt", "failure-page.json", "failure.png", "capture.json", "console-network.json"];

async function clearStaleDiagnostics() {
  for (const name of failureArtifacts) await rm(join(artifacts, name), { force: true });
}

function expectedUpstreamError(event) {
  if (event.method === "Network.responseReceived") {
    const status = event.params.response?.status ?? event.params.status;
    const url = event.params.response?.url ?? event.params.url ?? "";
    return status === 502 && isRhythmApiPath(url);
  }
  return event.method === "Log.entryAdded"
    && event.params.entry?.level === "error"
    && isRhythmApiPath(event.params.entry?.url ?? "")
    && event.params.entry?.text?.includes("502");
}

function isRhythmApiPath(value) {
  try {
    const pathname = new URL(value).pathname;
    return pathname === "/api/day" || pathname === "/api/work" || pathname === "/api/trends" || pathname === "/api/anomalies" || pathname === "/api/quality" || pathname === "/api/sources" || pathname === "/api/settings";
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  await clearStaleDiagnostics();
  const built = await buildWorker();
  const auth = centralFixture();
  const upstream = statusReadFixture();
  let runtime;
  let server;
  let browser;
  let failure;
  try {
    const proxy = await startProxy(null);
    server = proxy.server;
    const fixture = await createRuntime(built.source, auth, upstream);
    proxy.setWorker(fixture.worker);
    runtime = fixture.runtime;
    const { db } = fixture;

    await db.prepare(
      "INSERT OR REPLACE INTO settings (id, subject_device_ids, app_categories, updated_at) VALUES (?,?,?,?)",
    ).bind("default", JSON.stringify(["dev-a", "dev-b"]), JSON.stringify({ "示例编辑器": "AI 编程", "示例沟通": "工作沟通" }), new Date().toISOString()).run();

    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true, source: "rhythm", build: "local", sso_enabled: true, sso_ready: true,
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
    await page.waitForFunction(() => location.pathname === "/" && document.body.innerText.includes("上班通勤（上限）"));
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM kdp_sso_sessions").first()).n, 1,
      "browser completed the real SSO callback and local session write");
    assert.equal(auth.state.exchanges, 1, "one synthetic central exchange");
    await assertLayout(page, "desktop today", 1440);
    await assertNoRawHtml(page, "desktop today");
    await waitText(page, "截至");
    await waitText(page, "工作时段");
    assert.ok(await page.evaluate(() => document.querySelectorAll(".work-block").length > 0), "today has work blocks");
    await screenshot(page, "desktop-today.png");
    const desktopNav = await page.evaluate(() => [...document.querySelectorAll(".desktop-nav a")].map(link => link.textContent?.trim()));
    assert.deepEqual(desktopNav, ["今天", "趋势", "工作", "来源", "设置"], "desktop has five navigation items");

    const morning = await page.evaluate(() => {
      const segment = [...document.querySelectorAll(".timeline-segment")]
        .find(item => item.getAttribute("data-status") && Number(item.style.getPropertyValue("--segment-start")) <= 420
          && Number(item.style.getPropertyValue("--segment-start")) + Number(item.style.getPropertyValue("--segment-minutes")) > 420);
      return { status: segment?.getAttribute("data-status"), title: segment?.getAttribute("title") ?? "" };
    });
    assert.ok(["home", "bedroom", "living_room", "not_arrived"].includes(morning.status), `today morning is at home or not arrived: ${JSON.stringify(morning)}`);
    // 时间线点按明细
    await page.evaluate(() => {
      const segment = document.querySelector(".timeline-segment");
      if (!segment) throw new Error("timeline has at least one segment");
      segment.click();
    });
    await waitText(page, "分钟");
    const geometry = await page.evaluate(() => {
      const timeline = document.querySelector(".timeline");
      const segments = [...document.querySelectorAll(".timeline-segment")];
      if (!timeline || !segments.length) throw new Error("timeline segments exist");
      const startOf = element => Number(element.style.getPropertyValue("--segment-start"));
      const minutesOf = element => Number(element.style.getPropertyValue("--segment-minutes"));
      const noon = segments.find(element => startOf(element) === 720);
      const afterNoon = segments.find(element => startOf(element) === 721);
      const timelineRect = timeline.getBoundingClientRect();
      const contentWidth = document.querySelector("#content")?.getBoundingClientRect().width ?? 0;
      const ratio = element => (element.getBoundingClientRect().left - timelineRect.left) / timelineRect.width;
      if (!noon || !afterNoon) {
        return {
          hasNoon: false,
          position: getComputedStyle(segments[0]).position,
          firstWidth: segments[0].getBoundingClientRect().width,
          timelineWidth: timelineRect.width, contentWidth,
        };
      }
      return {
        hasNoon: true,
        position: getComputedStyle(segments[0]).position,
        firstWidth: segments[0].getBoundingClientRect().width,
        timelineWidth: timelineRect.width, contentWidth,
        noonRatio: ratio(noon),
        noonMinutes: minutesOf(noon),
        afterNoonRatio: ratio(afterNoon),
      };
    });
    assert.equal(geometry.position, "absolute", "timeline segments are positioned by time");
    assert.ok(geometry.firstWidth <= geometry.timelineWidth, "timeline segment stays within the timeline");
    assert.ok(geometry.timelineWidth >= geometry.contentWidth * 0.8, `desktop timeline uses the content width: ${geometry.timelineWidth}/${geometry.contentWidth}`);
    if (shanghaiMinute() > 721) assert.equal(geometry.hasNoon, true, "timeline has noon and following one-minute segments after 12:01");
    if (geometry.hasNoon) {
      assert.ok(Math.abs(geometry.noonRatio - 0.5) <= 0.01, `12:00 segment left=${geometry.noonRatio}`);
      assert.equal(geometry.noonMinutes, 1);
      assert.ok(Math.abs(geometry.afterNoonRatio - 721 / 1440) <= 0.01, `following segment left=${geometry.afterNoonRatio}`);
    }
    const detail = await page.evaluate(() => document.querySelector(".timeline-detail")?.textContent || "");
    assert.match(detail, /卧室|客厅|在家|通勤|公司|其他网络/);
    await screenshot(page, "desktop-timeline-detail.png");

    // 日期切换
    const headingBefore = await page.evaluate(() => document.querySelector(".page-heading h1")?.textContent || "");
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === "前一天");
      if (!button) throw new Error("previous-day control exists");
      button.click();
    });
    await page.waitForFunction(() => document.querySelector(".page-heading h1")?.textContent !== "");
    await page.goto(`${origin}/?date=${upstream.lateDay}`);
    await page.waitForFunction(() => document.querySelectorAll('.timeline-segment[data-status="outside"]').length > 0);
    const outsideDesktop = await page.evaluate(() => document.querySelectorAll('.timeline-segment[data-status="outside"]').length);
    assert.ok(outsideDesktop > 0, "desktop timeline shows inferred outside gap");
    await assertLayout(page, "desktop outside day", 1440);
    await screenshot(page, "desktop-outside-day.png");
    const headingAfter = await page.evaluate(() => document.querySelector(".page-heading h1")?.textContent || "");
    assert.notEqual(headingAfter, headingBefore, "date switching changes the day heading");
    await assertLayout(page, "desktop previous day", 1440);

    // 来源页
    await page.goto(`${origin}/sources`);
    await waitText(page, "每个状态怎么判断");
    await waitText(page, "不采集");
    assert.ok(await page.evaluate(() => Boolean(document.querySelector(".mobile-settings-link"))), "sources links to settings");
    await assertLayout(page, "desktop sources", 1440);
    await assertNoRawHtml(page, "desktop sources");
    await screenshot(page, "desktop-sources.png");

    // 未指定手机
    await db.prepare("DELETE FROM settings WHERE id='default'").run();
    await page.goto(`${origin}/`);
    await waitText(page, "未指定手机");
    await assertLayout(page, "desktop without subject phone", 1440);
    await screenshot(page, "desktop-no-phone.png");
    await db.prepare(
      "INSERT OR REPLACE INTO settings (id, subject_device_ids, app_categories, updated_at) VALUES (?,?,?,?)",
    ).bind("default", JSON.stringify(["dev-a", "dev-b"]), JSON.stringify({ "示例编辑器": "AI 编程" }), new Date().toISOString()).run();

    // 上游失败
    upstream.state.fail = true;
    await page.goto(`${origin}/`);
    await waitText(page, "数据暂不可用");
    const failedText = await page.evaluate(() => document.body.innerText);
    assert.ok(!failedText.includes("上班通勤（上限）"), "upstream failure must not show fabricated numbers");
    await assertLayout(page, "desktop upstream failure", 1440);
    await screenshot(page, "desktop-upstream-failure.png");
    await page.goto(`${origin}/sources`);
    await waitText(page, "数据暂不可用");
    await assertLayout(page, "desktop sources upstream failure", 1440);
    upstream.state.fail = false;

    // 趋势：先按合成历史补算 28 天（异常判断需要之前至少 5 个同类日），再在真实 Worker/D1 上读趋势
    const historyFrom = new Date(Date.parse(`${shanghaiDate()}T00:00:00Z`) - 28 * 86400_000).toISOString().slice(0, 10);
    const noDataDate = new Date(Date.parse(`${historyFrom}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
    const historyTo = new Date(Date.parse(`${shanghaiDate()}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
    const recomputed = await page.evaluate(async ([from, to]) => {
      const response = await fetch(`/api/admin/recompute?from=${from}&to=${to}`, { method: "POST", credentials: "same-origin" });
      return { status: response.status, body: await response.json() };
    }, [historyFrom, historyTo]);
    assert.equal(recomputed.status, 200, "owner can recompute synthetic history");
    assert.equal(recomputed.body.days_recomputed, 28, "28 history days recomputed");
    await page.goto(`${origin}/trend`);
    await waitText(page, "每天各状态各占几小时");
    await waitText(page, "本周和上周");
    for (const heading of ["作息叠图", "通勤（上限）", "每天几点", "在家", "和平时不一样的日子", "数据可信度"]) {
      assert.ok(await sectionVisible(page, heading), `desktop trends shows ${heading}`);
    }
    const trendState = await page.evaluate(() => ({
      bars: document.querySelectorAll("#status-hours .bar").length,
      filled: document.querySelectorAll("#status-hours rect[data-series]").length,
      overlayRows: document.querySelectorAll("#overlay .bar").length,
      anomalies: document.querySelectorAll(".anomaly-list li").length,
      anomalyText: document.querySelector(".anomaly-list")?.textContent ?? "",
    }));
    assert.equal(trendState.bars, 8, "7 days plus the workday average");
    assert.ok(trendState.filled > 0, "recomputed days are drawn, not hatched");
    assert.equal(trendState.overlayRows, 7, "desktop overlay has one row per day");
    assert.equal(trendState.anomalies, 1, "exactly the synthetic late workday is unusual");
    assert.match(trendState.anomalyText, /比平时/, "the late workday reason is in plain language");
    await page.evaluate(() => document.querySelector("#status-hours .bar")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForFunction(() => (document.querySelector("#status-hours .chart-detail")?.textContent ?? "").includes("小时"));
    await assertLayout(page, "desktop trends 7", 1440);
    await assertNoRawHtml(page, "desktop trends");
    await fullScreenshot(page, "desktop-trends-7.png");
    await clickText(page, "近 30 天");
    await page.waitForFunction(() => location.search === "?range=30" && document.querySelectorAll("#status-hours .bar").length === 31);
    await waitText(page, "不足 30 天");
    await assertLayout(page, "desktop trends 30", 1440);
    await fullScreenshot(page, "desktop-trends-30.png");

    // 工作页：桌面范围切换
    await page.goto(`${origin}/work`);
    await waitText(page, "工作时间花在哪");
    await waitText(page, "哪些钟头最出活");
    await assertLayout(page, "desktop work", 1440);
    await clickText(page, "本周");
    await page.waitForFunction(() => document.querySelector('.work-heading [aria-pressed="true"]')?.textContent?.includes("本周"));
    await fullScreenshot(page, "desktop-work-week.png");
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1100, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await page.goto(`${origin}/work`);
    await waitText(page, "工作时间花在哪");
    const work1100 = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(work1100.scrollWidth <= work1100.width + 1, `1100px work page has no horizontal overflow: ${work1100.scrollWidth}/${work1100.width}`);
    await assertLayout(page, "desktop work 1100", 1100);
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    // 设置：保存成功
    await page.goto(`${origin}/settings`);
    await waitText(page, "App 归类");
    assert.ok(await page.evaluate(() => !document.body.innerText.includes("本人手机") && !document.body.innerText.includes("和平时不一样的门槛")), "settings hides retired device and threshold sections");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".category-card").length), 8, "settings shows all eight App categories");
    await clickText(page, "保存设置");
    await waitText(page, "已保存。");
    await waitText(page, "需要重算");
    await assertLayout(page, "desktop settings", 1440);
    await assertNoRawHtml(page, "desktop settings");
    await fullScreenshot(page, "desktop-settings.png");

    // 中等宽度摘要布局
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 768, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await page.goto(`${origin}/`);
    await waitText(page, "上班通勤（上限）");
    await assertLayout(page, "tablet today", 768);
    await page.goto(`${origin}/work`);
    await waitText(page, "工作时间花在哪");
    await assertLayout(page, "tablet work", 768);
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1024, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await page.goto(`${origin}/`);
    await waitText(page, "上班通勤（上限）");
    await assertLayout(page, "narrow desktop today", 1024);
    await page.goto(`${origin}/work`);
    await waitText(page, "工作时间花在哪");
    await assertLayout(page, "narrow desktop work", 1024);
    // 移动端 390px
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await page.goto(`${origin}/`);
    await page.goto(`${origin}/?date=${upstream.lateDay}`);
    await page.waitForFunction(() => document.querySelectorAll('.time-block[data-status="outside"]').length > 0);
    assert.ok(await page.evaluate(() => document.querySelectorAll('.time-block[data-status="outside"]').length > 0), "mobile time blocks show inferred outside gap");
    await assertLayout(page, "mobile outside day", 390);
    await screenshot(page, "mobile-outside-day.png");
    await waitText(page, "上班通勤（上限）");
    await waitText(page, "一天怎么过的");
    await waitText(page, "工作时段");
    assert.ok(await page.evaluate(() => document.querySelectorAll(".work-block").length > 0), "mobile today has work blocks");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".mobile-nav a").length), 4, "mobile has four bottom tabs");
    assert.ok(await page.evaluate(() => Boolean(document.querySelector(".mobile-timeline")) && !document.querySelector(".timeline-panel")?.getClientRects().length), "mobile uses vertical time blocks");
    await assertLayout(page, "mobile today", 390);
    await assertNoRawHtml(page, "mobile today");
    await screenshot(page, "mobile-today.png");

    await page.goto(`${origin}/sources`);
    await waitText(page, "每个状态怎么判断");
    await assertLayout(page, "mobile sources", 390);
    assert.ok(await page.evaluate(() => Boolean(document.querySelector(".mobile-settings-link"))), "mobile sources links to settings");
    await assertNoRawHtml(page, "mobile sources");
    await screenshot(page, "mobile-sources.png");

    await page.goto(`${origin}/work`);
    await waitText(page, "工作时间花在哪");
    await waitText(page, "专注");
    await assertLayout(page, "mobile work", 390);
    await assertVisibleButtons(page, "mobile work");
    upstream.state.empty = true;
    await page.goto(`${origin}/work?date=${noDataDate}`);
    await waitText(page, "工作时间花在哪");
    await waitText(page, "暂无数据");
    assert.ok(await page.evaluate(() => (document.querySelector("#content")?.innerText ?? "").includes("暂无数据")), "mobile work empty mock shows 暂无数据");
    upstream.state.empty = false;
    await page.goto(`${origin}/work`);
    await waitText(page, "工作时间花在哪");
    await clickText(page, "本周");
    await page.waitForFunction(() => document.querySelector('.work-heading [aria-pressed="true"]')?.textContent?.includes("本周"));
    await fullScreenshot(page, "mobile-work-week.png");

    await page.goto(`${origin}/trend`);
    await waitText(page, "每天各状态各占几小时");
    await assertLayout(page, "mobile trends status tab", 390);
    await assertVisibleButtons(page, "mobile trends");
    const trendBody = await page.evaluate(() => document.querySelector("#content")?.innerText ?? "");
    for (const retired of ["起床与回卧室", "在公司用电脑", "工作节奏"]) {
      assert.ok(!trendBody.includes(retired), `mobile trends does not show retired text: ${retired}`);
    }
    assert.ok(await page.evaluate(() => !document.querySelector("#overlay .overlay-chart")?.getClientRects().length), "mobile hides the overlay chart");
    await fullScreenshot(page, "mobile-trends-status.png");
    await clickText(page, "不一样的日子");
    await page.waitForFunction(() => document.querySelector(".trend-sections")?.getAttribute("data-mobile-tab") === "anomalies");
    assert.ok(await sectionVisible(page, "和平时不一样的日子"), "mobile anomaly tab shows anomaly module");
    assert.ok(!(await sectionVisible(page, "每天各状态各占几小时")), "mobile anomaly tab hides status module");
    await clickText(page, "可信度");
    await page.waitForFunction(() => document.querySelector(".trend-sections")?.getAttribute("data-mobile-tab") === "quality");
    await assertLayout(page, "mobile trends quality tab", 390);
    await fullScreenshot(page, "mobile-trends-quality.png");

    await page.goto(`${origin}/settings`);
    await waitText(page, "App 归类");
    assert.ok(await page.evaluate(() => !document.body.innerText.includes("本人手机") && !document.body.innerText.includes("和平时不一样的门槛")), "mobile settings hides retired sections");
    assert.ok(await page.evaluate(() => { const button = document.querySelector(".mobile-settings-back"); return Boolean(button && button.getAttribute("aria-label") === "返回来源" && button.getBoundingClientRect().width >= 44 && button.getBoundingClientRect().height >= 44); }), "mobile settings has a 44px return-to-sources button");
    await assertLayout(page, "mobile settings", 390);
    await fullScreenshot(page, "mobile-settings.png");

    // 深色模式跟随系统
    await setColorScheme(page, "dark");
    await page.goto(`${origin}/trend`);
    await waitText(page, "每天各状态各占几小时");
    await assertTheme(page, "mobile dark trends", "dark");
    await assertLayout(page, "mobile dark trends", 390);
    await fullScreenshot(page, "mobile-trends-dark.png");
    await page.goto(`${origin}/`);
    await waitText(page, "工作时段");
    await assertTheme(page, "mobile dark today", "dark");
    await assertLayout(page, "mobile dark today", 390);
    assert.ok(await page.evaluate(() => document.querySelectorAll(".work-block").length > 0), "mobile dark today has work blocks");
    await page.goto(`${origin}/?date=${upstream.lateDay}`);
    await page.waitForFunction(() => document.querySelectorAll('.time-block[data-status="outside"]').length > 0);
    await assertTheme(page, "mobile dark outside", "dark");
    assert.ok(await page.evaluate(() => document.querySelectorAll('.time-block[data-status="outside"]').length > 0), "mobile dark time blocks show inferred outside gap");
    await fullScreenshot(page, "mobile-outside-dark.png");
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await page.goto(`${origin}/trend`);
    await waitText(page, "每天各状态各占几小时");
    await assertTheme(page, "desktop dark trends", "dark");
    await fullScreenshot(page, "desktop-trends-dark.png");
    await page.goto(`${origin}/?date=${upstream.lateDay}`);
    await page.waitForFunction(() => document.querySelectorAll('.timeline-segment[data-status="outside"]').length > 0);
    await assertTheme(page, "desktop dark outside", "dark");
    assert.ok(await page.evaluate(() => document.querySelectorAll('.timeline-segment[data-status="outside"]').length > 0), "desktop dark timeline shows inferred outside gap");
    await fullScreenshot(page, "desktop-outside-dark.png");
    await page.goto(`${origin}/settings`);
    await waitText(page, "App 归类");
    await fullScreenshot(page, "desktop-settings-dark.png");
    await setColorScheme(page, "light");
    await page.goto(`${origin}/`);
    await waitText(page, "上班通勤（上限）");
    await assertTheme(page, "desktop light today", "light");

    const expectedStatuses = browser.page.diagnostics.filter(event =>
      event.method === "Network.responseReceived" && expectedUpstreamError(event));
    assert.equal(expectedStatuses.length, 2, "day and sources upstream failures used the real endpoints");
    const failures = browser.page.diagnostics.filter(event => {
      if (event.method === "Runtime.exceptionThrown") return true;
      if (event.method === "Log.entryAdded") {
        if (expectedUpstreamError(event)) return false;
        return ["error", "warning"].includes(event.params.entry.level);
      }
      if (event.method === "Runtime.consoleAPICalled") {
        return ["error", "warning"].includes(event.params.type);
      }
      if (event.method === "Network.loadingFailed") return true;
      if (event.method === "Network.responseReceived") {
        const status = event.params.response?.status ?? event.params.status;
        if (status >= 400 && !expectedUpstreamError(event)) return true;
      }
      return false;
    });
    assert.deepEqual(failures, [], "no unexpected console, runtime or network errors");

    await writeFile(join(artifacts, "console-network.json"),
      JSON.stringify(browser.page.diagnostics, null, 2));
    await writeFile(join(artifacts, "acceptance.json"), JSON.stringify({
      origin,
      viewports: ["1440x1000 desktop", "390x844 mobile"],
      color_schemes: ["light", "dark"],
      history_days: 28,
      late_day: upstream.lateDay,
      sso: auth.state,
      upstream_calls: [...new Set(upstream.state.calls)],
      expected_upstream_errors: expectedStatuses.length,
      shanghai_today: shanghaiDate(),
      shanghai_minute: shanghaiMinute(),
    }, null, 2));
    await writeFile(join(artifacts, "final-page.json"), JSON.stringify(await page.snapshot(), null, 2));
    for (const name of failureArtifacts.filter(name => name !== "console-network.json")) {
      await rm(join(artifacts, name), { force: true });
    }
    process.stdout.write("Rhythm browser smoke passed (today, sources, trends, settings; desktop + 390px mobile; light + dark; real Worker/D1; synthetic SSO and STATUS_READ)\n");
  } catch (error) {
    failure = error;
    if (browser) await browser.page.saveDiagnostics(error);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) await closeServer(server);
    if (runtime) await runtime.dispose();
    if (failure) {
      process.stderr.write(`Rhythm browser smoke failed; diagnostics: ${artifacts}\n`);
    }
    await rm(built.output, { recursive: true, force: true });
  }
}

export { closeServer, resolveSmokePort, startProxy };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
