import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../../health/scripts/browser-cdp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const artifacts = process.env.PROJECT_SMOKE_ARTIFACTS || "/tmp/project-browser-smoke";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
      const page = ["/", "/login", "/board", "/log"].includes(path) || path.startsWith("/p/");
      const candidate = page ? "index.html" : path.replace(/^\/+/, "");
      const file = join(dist, candidate);
      if (!file.startsWith(dist)) throw new Error("invalid path");
      const body = await readFile(file);
      response.writeHead(200, {
        ...securityHeaders(),
        "Content-Type": contentTypes.get(extname(file)) || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404, securityHeaders());
      response.end("Not found");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("static server did not bind");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** Synthetic workbench API installed into the page before any app script runs. */
function mockScript() {
  return async () => {
    const json = (value, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { "Content-Type": "application/json" },
    });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const shift = n => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    const task = (key, title, status, category, need_kind, due, project = "alpha", done_at = null) =>
      ({ project, key, title, status, category, need_kind, due, done_at });
    const tasks = [
      task("t1", "续费示例服务器（这条标题故意写得很长，用来检查卡片两行截断与窄屏不溢出）", "doing", "基础设施", "attend", shift(2)),
      task("t2", "选择示例方案", "decide", "流程", "decide", shift(0)),
      task("t3", "授权示例上线", "doing", "发布", "authorize", shift(9)),
      task("t4", "确认示例设置", "verify", "流程", "confirm", shift(-1)),
      task("t5", "修复示例缺陷", "bug", "网关", "none", null),
      task("t6", "示例想法", "idea", "流程", "none", null, "beta"),
      task("t7", "已完成的示例", "doing", "流程", "none", null, "alpha", new Date().toISOString()),
    ];
    const open = tasks.filter(item => !item.done_at);
    const projects = [
      { id: "alpha", name: "Alpha", repo: "synthetic/alpha", status: "active", last_push_at: new Date().toISOString(),
        open: 5, need_you: 4, branches: 1, url: "" },
      { id: "beta", name: "Beta", repo: null, status: "active", last_push_at: null, open: 1, need_you: 0, branches: 0, url: "" },
    ];
    const branches = [{ project: "alpha", name: "team/synthetic-work", ahead: 3, last_commit_at: new Date().toISOString(), has_fragment: true }];
    const state = { authenticated: false };
    window.__projectSmoke = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.origin);
      const method = String(init.method || "GET").toUpperCase();
      if (url.origin !== location.origin) return originalFetch(input, init);
      if (url.pathname === "/api/me") {
        return state.authenticated ? json({ ok: true, authenticated: true }) : json({ error: "authentication_required" }, 401);
      }
      if (url.pathname === "/api/projects" && method === "GET") return json({ projects });
      if (url.pathname === "/api/overview") {
        const need = open.filter(item => item.need_kind !== "none").sort((a, b) => (a.due || "9") < (b.due || "9") ? -1 : 1);
        return json({
          as_of: new Date().toISOString(), today: day,
          counts: { open: open.length, need_you: need.length, overdue: 1, due_7d: 3, branches: 1, done_7d: 1 },
          need_you: need, due_soon: need.filter(item => item.due && item.due <= shift(7)),
          dated: open.filter(item => item.due).sort((a, b) => a.due < b.due ? -1 : 1),
          recently_done: tasks.filter(item => item.done_at), branches, projects,
        });
      }
      if (url.pathname === "/api/tasks") {
        const project = url.searchParams.get("project");
        return json({ tasks: tasks.filter(item => !project || item.project === project) });
      }
      if (url.pathname.startsWith("/api/tasks/")) {
        const key = decodeURIComponent(url.pathname.split("/").at(-1));
        const found = tasks.find(item => item.key === key);
        return found ? json({ project: { id: found.project }, task: { ...found, what: "示例说明 <script>不应执行</script>",
          impact: "示例影响", advice: "示例建议", need: "到场", source: "docs/a.md", related: ["docs/b.md"],
          recorded: shift(-3), first_seen: "", last_seen: "" }, handoffs: [] }) : json({ error: "task_not_found" }, 404);
      }
      if (url.pathname === "/api/projects/alpha" && method === "GET") {
        return json({
          project: { id: "alpha", name: "Alpha", repo: "synthetic/alpha", status: "active", rules_path: "AGENTS.md",
            adapter: { isolation: "worktree", commit: "允许", acceptance: ["pnpm check"], merge: "agent-team merge" },
            source_sha: "abbafdf", source_branch: "main", last_push_at: new Date().toISOString(), url: "" },
          counts: { by_status: { decide: 1, doing: 2, bug: 1, verify: 1, idea: 0 }, need_you: 4, done_7d: 1 },
          branches, changelog: [{ date: day, title: "示例变更", summary: null }], handoffs: [],
          token: { created_at: new Date().toISOString(), last_used_at: null },
        });
      }
      if (url.pathname === "/api/log") {
        return json({ items: [{ kind: "change", project: "alpha", date: day, title: "示例变更", summary: null, at: null },
          { kind: "done", project: "alpha", date: day, title: "已完成的示例", summary: null, at: new Date().toISOString() }] });
      }
      if (url.pathname === "/api/auth/logout" && method === "POST") return json({ ok: true });
      return json({ error: "not_found" }, 404);
    };
  };
}

async function assertNoOverflow(page, label, width) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.equal(dimensions.viewport, width, `${label}: viewport width`);
  assert.ok(dimensions.scrollWidth <= width, `${label}: horizontal overflow ${dimensions.scrollWidth}`);
}

async function visit(page, url, text) {
  await page.goto(url);
  await page.waitForFunction(expected => document.body.innerText.includes(expected), text);
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  const { server, origin } = await startStaticServer();
  const browser = await launchBrowser(artifacts);
  const page = browser.page;
  try {
    await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(${mockScript().toString()})()` });
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await visit(page, `${origin}/login`, "进入项目工作台");
    assert.match(await page.evaluate(() => document.querySelector("a.login-button")?.getAttribute("href") || ""),
      /^\/api\/auth\/login\?return=/, "SSO login link is present");
    await assertNoOverflow(page, "desktop login", 1440);
    await page.screenshot({ path: "desktop-login.png" });

    await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: "window.__projectSmoke.authenticated = true" });
    await visit(page, `${origin}/`, "截止倒计时");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".kpi").length), 4, "four KPI tiles");
    assert.ok(await page.evaluate(() => document.querySelectorAll(".countdown-row").length) >= 4, "countdown rows");
    assert.ok(await page.evaluate(() => document.querySelector(".bar.late")), "overdue bar is drawn");
    await assertNoOverflow(page, "desktop today", 1440);
    await page.screenshot({ path: "desktop-today.png" });

    await page.evaluate(() => [...document.querySelectorAll(".inbox button")].find(b => b.textContent.includes("选择示例方案")).click());
    await page.waitForFunction(() => document.querySelector(".drawer")?.innerText.includes("示例建议"));
    assert.ok(await page.evaluate(() => location.search.includes("task=alpha%2Ft2")), "drawer is in the address");
    assert.ok(await page.evaluate(() => !document.querySelector(".drawer script")), "task text is rendered as text");
    await page.screenshot({ path: "desktop-drawer.png" });
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await page.waitForFunction(() => !document.querySelector(".drawer"));

    await visit(page, `${origin}/board`, "领域 × 状态");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".board .column").length), 6, "six board columns");
    await page.evaluate(() => [...document.querySelectorAll(".pill")].find(b => b.textContent.includes("只看需要你")).click());
    await page.waitForFunction(() => !document.querySelector(".board").innerText.includes("示例想法"));
    await assertNoOverflow(page, "desktop board", 1440);
    await page.screenshot({ path: "desktop-board.png" });

    await visit(page, `${origin}/p/alpha`, "项目卡");
    assert.ok(await page.evaluate(() => document.body.innerText.includes("agent-team merge")), "adapter merge command");
    await visit(page, `${origin}/log`, "每天的变更与完成");

    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const [path, text, shot] of [["/", "截止倒计时", "mobile-today.png"], ["/board", "最近完成", "mobile-board.png"],
      ["/p/alpha", "推送与设置", "mobile-project.png"], ["/log", "动态", "mobile-log.png"]]) {
      await visit(page, `${origin}${path}`, text);
      await assertNoOverflow(page, `mobile ${path}`, 390);
      assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector(".tabbar")).display !== "none"), "mobile tab bar");
      await page.screenshot({ path: shot });
    }
    const failures = page.diagnostics.filter(event =>
      event.method === "Runtime.exceptionThrown" ||
      (event.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(event.params.type)) ||
      (event.method === "Network.responseReceived" && event.params.response.status >= 400 &&
        !(event.params.response.status === 401 && event.params.response.url.endsWith("/api/me"))));
    assert.deepEqual(failures, [], "no runtime errors, console errors or failed requests");
    await writeFile(join(artifacts, "final-page.json"), JSON.stringify(await page.snapshot(), null, 2));
    process.stdout.write("Project browser smoke passed (desktop + 390px mobile)\n");
  } catch (error) {
    await page.saveDiagnostics(error);
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

await main();
