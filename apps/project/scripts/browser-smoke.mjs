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
    const fixedNow = "2026-11-04T04:00:00Z";
    const RealDate = Date;
    class SmokeDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return new RealDate(fixedNow).getTime(); }
    }
    window.Date = SmokeDate;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new SmokeDate());
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
    const who = item => ["attend", "decide", "confirm"].includes(item.need_kind) ? "you" : "agent";
    const deleted = new Set();
    const today = {
      today: open.filter(item => ["t1", "t2"].includes(item.key)).map(item => ({ ...item, carried: false, who: who(item) })),
      pool: open.filter(item => ["t3", "t5", "t6"].includes(item.key)).map(item => item.key === "t6"
        ? { ...item, checks: { count: 2, last_at: new Date().toISOString(), last_note: "合成检查结论", today: true } }
        : item),
      done: tasks.filter(item => item.done_at),
    };
    const visible = name => today[name].filter(item => !deleted.has(item.key));
    const checked = [...visible("today"), ...visible("pool")].filter(item => item.checks?.today).length;
    const todayResponse = () => ({
      today: visible("today"),
      pool: visible("pool"),
      done: visible("done"),
      deleted: tasks.filter(item => deleted.has(item.key) && !item.done_at).map(item => ({
        project: item.project, key: item.key, title: item.title, deleted_at: new Date().toISOString(),
      })),
      counts: { today: visible("today").length, pool: visible("pool").length, done: visible("done").length,
        deleted: tasks.filter(item => deleted.has(item.key) && !item.done_at).length, checked },
      date: day,
    });
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
      if (url.pathname === "/api/today" && method === "GET") return json(todayResponse());
      if (["/api/today/pick", "/api/today/unpick", "/api/today/done", "/api/today/delete"].includes(url.pathname) && method === "POST") {
        const body = JSON.parse(init.body || "{}");
        const index = today.today.findIndex(item => item.project === body.project && item.key === body.key);
        const poolIndex = today.pool.findIndex(item => item.project === body.project && item.key === body.key);
        if (url.pathname.endsWith("/pick") && poolIndex >= 0) {
          const [item] = today.pool.splice(poolIndex, 1);
          today.today.push({ ...item, carried: false, who: who(item) });
        } else if (url.pathname.endsWith("/unpick") && index >= 0) {
          const [item] = today.today.splice(index, 1);
          today.pool.push(item);
        } else if (url.pathname.endsWith("/done") && index >= 0) {
          const [item] = today.today.splice(index, 1);
          today.done.push(item);
        } else if (url.pathname.endsWith("/delete") && poolIndex >= 0) {
          const [item] = today.pool.splice(poolIndex, 1);
          deleted.add(item.key);
        }
        return json({ written: 1 });
      }
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
      if (url.pathname === "/api/journal") {
        const todayDate = new Date(`${day}T00:00:00Z`);
        const monday = shift(-((todayDate.getUTCDay() + 6) % 7));
        const requested = url.searchParams.get("week");
        const start = requested || monday;
        const startOffset = Date.parse(`${start}T00:00:00Z`) / 86400000 - Date.parse(`${day}T00:00:00Z`) / 86400000;
        const journalDays = Array.from({ length: 7 }, (_, index) => {
          const date = shift(startOffset + index);
          const current = date === day && !requested;
          const completed = current ? Array.from({ length: 4 }, (_, index) => ({ project: "alpha", title: `完成示例 ${index + 1}`, summary: null, at: new Date().toISOString() })) : [];
          return { date, count: current ? completed.length + 2 : 0, counts: { completed: completed.length, changed: current ? 2 : 0 },
            released: current ? [{ project: "alpha", title: "示例上线", summary: null, at: null }] : [], completed,
            checked: current ? [{ project: "alpha", title: "已检查的示例", summary: null, at: new Date().toISOString(), note: "检查结论" }] : [],
            other: current ? [{ project: "alpha", title: "示例改动", summary: null, at: null }] : [] };
        });
        return json({ as_of: new Date().toISOString(), week: { start, end: shift(startOffset + 6) },
          summary: { completed: requested ? 0 : 4, released: requested ? 0 : 1, checked: requested ? 0 : 1 }, days: journalDays, truncated: false });
      }
      if (url.pathname === "/api/auth/logout" && method === "POST") return json({ ok: true });
      return json({ error: "not_found" }, 404);
    };
  };
}

async function assertJournalInteractions(page) {
  const currentUrl = await page.evaluate(() => location.href);
  const currentWeek = await page.evaluate(() => document.querySelector(".journal-week")?.textContent.trim() || "");
  const todayDate = await page.evaluate(() => document.querySelector(".journal-day-cell.is-today time")?.getAttribute("datetime"));
  assert.ok(todayDate, "journal today date");
  assert.ok(await page.evaluate(date => [...document.querySelectorAll(".journal-day")].filter(day => day.id < `journal-day-${date}`).every(day => !day.open), todayDate), "past journal days are folded");
  assert.equal(await page.evaluate(date => document.querySelector(`#journal-day-${date}`)?.open, todayDate), true, "today journal day is open");
  assert.equal(await page.evaluate(date => document.querySelector(`#journal-day-${date}`)?.querySelectorAll(".journal-done").length, todayDate), 3, "journal completion preview has three items");
  assert.ok(await page.evaluate(date => document.querySelector(`#journal-day-${date}`)?.innerText.includes("另 1 件"), todayDate), "journal remaining completion label");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".activity, .activity-bar, svg.activity").length), 0, "old activity chart removed");
  await page.evaluate(() => [...document.querySelectorAll(".journal-week-nav button")].find(button => button.textContent === "上一周")?.click());
  await page.waitForFunction(() => location.search.includes("week="));
  const requestedWeek = await page.evaluate(() => new URL(location.href).searchParams.get("week"));
  assert.ok(requestedWeek, "previous week query is present");
  const previousStart = new Date(Date.parse(`${currentWeek.split(" 至 ")[0]}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const expectedEnd = new Date(Date.parse(`${previousStart}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
  await page.waitForFunction(expected => document.querySelector(".journal-week")?.textContent.trim() === expected, `${previousStart} 至 ${expectedEnd}`);
  await page.waitForFunction(() => !document.querySelector("body")?.innerText.includes("完成示例 1"));
  assert.notEqual(await page.evaluate(() => location.href), currentUrl, "previous week URL changes");
  await page.evaluate(() => history.back());
  await page.waitForFunction(expected => document.querySelector(".journal-week")?.textContent.trim() === expected, currentWeek);
  await page.waitForFunction(() => document.querySelector("body")?.innerText.includes("完成示例 1"));
  assert.equal(await page.evaluate(() => location.href), currentUrl, "browser back restores current URL");
  const targetDate = await page.evaluate(date => [...document.querySelectorAll(".journal-day-cell:not(.is-future)")].find(cell => cell.querySelector("time")?.getAttribute("datetime") !== date)?.querySelector("time")?.getAttribute("datetime"), todayDate);
  assert.ok(targetDate, "past journal day target");
  await page.evaluate(date => document.querySelector(`.journal-day-cell time[datetime="${date}"]`)?.closest("button")?.click(), targetDate);
  await page.waitForFunction(date => document.querySelector(`#journal-day-${date}`)?.open === true, targetDate);
}

async function assertNoOverflow(page, label, width) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.equal(dimensions.viewport, width, `${label}: viewport width`);
  assert.ok(dimensions.scrollWidth <= width, `${label}: horizontal overflow ${dimensions.scrollWidth}`);
}

async function visit(page, url, text) {
  await page.goto(url);
  if (new URL(url).pathname === "/log") await page.waitForFunction(() => document.querySelectorAll(".journal-day-cell").length === 7);
  else await page.waitForFunction(expected => document.body.innerText.includes(expected), text);
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
    await visit(page, `${origin}/`, "今天");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".today-column").length), 3, "three today columns");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".today-group").length), 2, "your and agent groups");
    const columnBoxes = await page.evaluate(() => [...document.querySelectorAll(".today-column")].map(column => {
      const box = column.getBoundingClientRect();
      return { left: box.left, top: box.top };
    }));
    assert.ok(columnBoxes[0].left < columnBoxes[1].left && columnBoxes[1].left < columnBoxes[2].left, "today columns increase left-to-right");
    assert.equal(new Set(columnBoxes.map(box => box.top)).size, 1, "today columns share a top edge");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".pool-groups details").length), 3, "pool categories");
    assert.ok(await page.evaluate(() => document.body.innerText.includes("查过 2 次 · 最近")), "desktop checked hint");
    assert.equal(await page.evaluate(() => document.querySelector('[role="tablist"]')), null, "desktop hides tablist semantics");
    assert.equal(await page.evaluate(() => document.querySelector('[role="tabpanel"]')), null, "desktop hides tabpanel semantics");
    await assertNoOverflow(page, "desktop today", 1440);
    await page.screenshot({ path: "desktop-today.png" });

    await page.evaluate(() => [...document.querySelectorAll(".pool-list li")].find(item => item.textContent?.includes("授权示例上线"))?.querySelector("button")?.click());
    await page.waitForFunction(() => document.querySelector(".main-today-column")?.innerText.includes("授权示例上线"));
    await page.evaluate(() => [...document.querySelectorAll(".pool-list li")].find(item => item.textContent?.includes("修复示例缺陷"))?.querySelector('button[aria-label^="删除池子任务"]')?.click());
    await page.waitForFunction(() => !document.querySelector("#today-panel-pool")?.innerText.includes("修复示例缺陷"));
    await page.evaluate(() => [...document.querySelectorAll(".today-card")].find(card => card.textContent?.includes("续费示例服务器"))?.querySelector("button")?.click());
    await page.waitForFunction(() => !document.querySelector(".main-today-column")?.innerText.includes("续费示例服务器"));
    await page.evaluate(() => [...document.querySelectorAll(".today-card")].find(card => card.textContent?.includes("选择示例方案"))?.querySelector("button.primary")?.click());
    await page.waitForFunction(() => document.querySelector(".done-today-list")?.innerText.includes("选择示例方案"));

    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
    await visit(page, `${origin}/`, "今天");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".today-column").length), 3, "three today columns at 1024px");
    await assertNoOverflow(page, "1024px today", 1024);
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await visit(page, `${origin}/log`, "工作日报");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".journal-day-cell").length), 7, "seven journal days");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".journal-day-cell.is-today").length), 1, "journal today outline");
    assert.ok(await page.evaluate(() => document.querySelector(".journal-day-cell.is-future")), "journal future day style");
    await assertJournalInteractions(page);
    await assertNoOverflow(page, "desktop journal", 1440);
    await page.screenshot({ path: "desktop-journal.png" });

    await visit(page, `${origin}/board?task=alpha%2Ft1`, "今天");
    await page.waitForFunction(() => document.querySelector(".drawer")?.innerText.includes("示例建议"));
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".nav a")].map(link => link.textContent?.trim())), ["今天", "动态"], "desktop navigation has two items");
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await page.waitForFunction(() => !document.querySelector(".drawer"));
    await assertNoOverflow(page, "desktop board redirect", 1440);

    await visit(page, `${origin}/p/alpha`, "项目卡");
    assert.ok(await page.evaluate(() => document.body.innerText.includes("agent-team merge")), "adapter merge command");

    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const [path, text, shot] of [["/", "今天", "mobile-today.png"], ["/p/alpha", "推送与设置", "mobile-project.png"], ["/log", "工作日报", "mobile-log.png"], ["/board?task=alpha%2Ft1", "今天", "mobile-board-redirect.png"]]) {
      await visit(page, `${origin}${path}`, text);
      await assertNoOverflow(page, `mobile ${path}`, 390);
      if (path === "/") {
        assert.equal(await page.evaluate(() => document.querySelectorAll(".today-tabs button").length), 3, "mobile today tabs");
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".tabbar")).display), "grid", "mobile global navigation");
        assert.equal(await page.evaluate(() => document.querySelectorAll(".tabbar a").length), 2, "mobile navigation has two items");
        assert.ok(await page.evaluate(() => document.querySelector('[role="tablist"]')), "mobile tablist semantics");
        assert.equal(await page.evaluate(() => document.querySelectorAll('[role="tabpanel"]').length), 3, "mobile tabpanel semantics");
        await page.evaluate(() => [...document.querySelectorAll(".today-tabs button")].find(button => button.textContent === "池子")?.click());
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#today-panel-pool")).display !== "none");
        assert.ok(await page.evaluate(() => document.querySelector("input[aria-label=\"搜索标题或分类\"]")), "pool search");
        await page.evaluate(() => {
          const input = document.querySelector("input[aria-label=\"搜索标题或分类\"]");
          input.value = "授权";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await page.waitForFunction(() => !document.querySelector("#today-panel-pool")?.innerText.includes("示例想法"));
        await page.evaluate(() => [...document.querySelectorAll(".pool-filters .pill")].find(button => button.textContent?.includes("只看需要你"))?.click());
        await page.evaluate(() => [...document.querySelectorAll(".pool-filters .pill")].find(button => button.textContent?.includes("7 天内到期"))?.click());
        assert.ok(await page.evaluate(() => document.querySelector(".pool-clear")), "pool filter clear control");
        await page.evaluate(() => document.querySelector(".pool-clear")?.click());
        await page.waitForFunction(() => document.querySelector("#today-panel-pool")?.innerText.includes("示例想法"));
        await page.evaluate(() => [...document.querySelectorAll(".pool-list li")].find(item => item.textContent?.includes("示例想法"))?.querySelector('button[aria-label^="删除池子任务"]')?.click());
        await page.waitForFunction(() => !document.querySelector("#today-panel-pool")?.innerText.includes("示例想法"));
      } else if (path === "/log") {
        assert.equal(await page.evaluate(() => document.querySelectorAll(".journal-day-cell").length), 7, "mobile seven journal days");
        await assertJournalInteractions(page);
      } else if (path.startsWith("/board")) {
        assert.ok(await page.evaluate(() => document.querySelector(".drawer")), "board link opens task drawer on today");
      } else {
        assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector(".tabbar")).display !== "none"), "mobile tab bar");
      }
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
