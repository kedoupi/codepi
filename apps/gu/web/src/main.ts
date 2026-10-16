import "./style.css";
import { PRODUCT_BRAND } from "../../../../packages/shared/brand";
import {
  marketChange,
  percent as pct,
  weight,
  ruleCurrent,
  elapsed,
  reportAction,
  reportCategory,
  ruleAction,
} from "./format";
import { calendarPanel, type CalendarView } from "./calendar";
import {
  allocationGap,
  cashBuffer,
  compositionBar,
  eventTimeline,
  positionAnchorId,
  riskRail,
  weightHistory,
  historyDetail,
} from "./charts";
import { applyChartStyles } from "./dom";
import {
  accountAlerts,
  overviewRules,
  proximityRequirement,
} from "./risk-summary";
import { escapeHtml as e, markdown, headings } from "./markdown";
import type { Dashboard, Row } from "../../worker/dashboard-types";
import { humanizeQuoteError, noticeTone } from "./diagnostics";

type Snapshot = { batch_id: string; received_at: string; data: Dashboard };
const app = document.querySelector<HTMLDivElement>("#app")!;
let snapshot: Snapshot | null = null;
let loadVersion = 0;
let ssoMode: boolean | undefined;
let checkingSession = false;
let auth: "unknown" | "authenticated" | "anonymous" = "unknown";
let dataState: "loading" | "ready" | "empty" | "failed" = "loading";
let loading = false;
let notice = "";
let returnHash = "";
let mounted = false;
let renderKey = "";
// 图表 → 持仓联动：点图表后要打标的 ticker，等 DOM 重建完再消费。
let pendingPositionFocus: string | null = null;
let dataRevision = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function focusContent() {
  document.querySelector<HTMLElement>("#content")?.focus({ preventScroll: true });
}
const NAV_ITEMS = [
  ["overview", "总览"],
  ["positions", "持仓与风控"],
  ["reports", "研究与报告"],
  ["status", "数据状态"],
] as const;
let selectedHistory = "";
let calendar: CalendarView | null = null;
let calendarFailed = false;
try {
  sessionStorage.removeItem("gu-hide");
} catch {
  /* Storage may be unavailable; the retired preference is never read. */
}
let reportQuery = "";
let reportKind = "";
let cooldown: ReturnType<typeof setInterval> | undefined;
const number = (v: unknown, digits = 2) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const money = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? `${(v / 10000).toFixed(2)} 万` : "—";
const time = (v: unknown) => {
  const date = new Date(String(v));
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
      }).format(date)
    : "未记录";
};
const signed = (v: unknown) =>
  typeof v === "number" ? `${v > 0 ? "+" : ""}${pct(v)}` : "—";
// 三态：负数红、正数绿、非数值（null / "—"）落中性灰。
// 旧实现在缺失值时也落进 positive 绿色，会把「行情暂时取不到」伪装成上涨。
const tone = (v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "neutral";
  return v < 0 ? "negative" : v > 0 ? "positive" : "neutral";
};
const brand = `<a class="brand" href="#overview" aria-label="${PRODUCT_BRAND} · GU"><span class="brand-mark">k</span><span>kedoupi<small>codepi · 个人投资工作台</small></span></a>`;

function clearSession() {
  returnHash = validHash(location.hash);
  snapshot = null;
  calendar = null;
  auth = "anonymous";
  loading = false;
  notice = "";
  reportQuery = "";
  reportKind = "";
  selectedHistory = "";
  loadVersion++;
  // chrome 已经被 login() 重置，但 renderKey 也需要清掉，否则下一次登录后会跳过
  // 第一次重绘，留下 login() 留下的占位 chrome。
  renderKey = "";
  login();
}

async function api(path: string, body?: unknown, method?: string) {
  const version = loadVersion;
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) {
    if (version === loadVersion) {
      clearSession();
    }
    throw Object.assign(new Error("登录已过期，请重新登录"), { status: 401 });
  }
  let result: Record<string, unknown>;
  try {
    result = (await response.json()) as Record<string, unknown>;
  } catch {
    throw Object.assign(
      new Error(`服务响应无效（HTTP ${response.status}），请稍后重试`),
      { status: response.status },
    );
  }
  if (path === "/api/me" && result.authenticated === false) {
    if (version === loadVersion) clearSession();
    throw Object.assign(new Error("登录已过期，请重新登录"), { status: 401 });
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(String(result.error || `请求失败（HTTP ${response.status}）`)),
      {
        status: response.status,
        retryAfter:
          Number(result.retry_after || response.headers.get("Retry-After")) ||
          0,
      },
    );
  }
  return result;
}

function validHash(hash: string) {
  return /^#(?:overview|positions|status|reports(?:\/[^/#?]+)?)$/.test(hash)
    ? hash
    : "#overview";
}

function login() {
  if (cooldown) clearInterval(cooldown);
  clearTimeout(noticeTimer);
  // login 是另一个 UI 形态，再次登录前必须让 render() 重挂 chrome，
  // 否则同步提示条 / 顶栏副标题都查不到节点。
  mounted = false;
  renderKey = "";
  const destination = `/${returnHash || validHash(location.hash)}`;
  app.innerHTML = `<main class="login">
    <section class="login-story"><div>${brand}</div>
      <div class="login-heading"><p class="muted">为长期持有，留一份清醒的记录。</p><h1>看清持仓。<br>回到自己的规则。</h1>
      <p>持仓、风控与研究，收在同一个地方。<br>每一个判断，都有数据和时间可循。</p></div>
      <div class="login-foot">私人工作台 <span>北京时间</span></div>
    </section>
    <section class="login-panel"><div class="login-form"><span class="seal">仅本人访问</span><h2>登录投资工作台</h2>
      ${
        ssoMode !== false
          ? `<p class="muted">使用 ${PRODUCT_BRAND} 账户统一登录。</p>
      ${new URLSearchParams(location.search).has("auth_error") ? '<p role="alert">登录未完成。请重新登录；服务暂时不可用时，可稍后重试。</p>' : ""}
      <a class="primary" href="/api/auth/login?return=${e(encodeURIComponent(destination))}">统一登录</a>
      <p class="fine">投资工作台登录状态最多保留 7 天。退出将同步退出其他工具。</p>`
          : `
      <p class="muted">验证码将发送至<br><strong>k•••••••••1@gmail.com</strong></p>
      <button id="send" class="primary">发送验证码</button>
      <form id="verify"><label for="code">六位验证码</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required aria-describedby="login-message">
      <button id="enter" class="primary" type="submit">验证并登录</button></form>
      <p id="login-message" role="status" aria-live="polite"></p><p class="fine">验证码 8 分钟内有效，登录状态保留 7 天。</p>`
      }
    </div></section></main>`;
  if (ssoMode !== false) return;
  const send = document.querySelector<HTMLButtonElement>("#send")!;
  const message =
    document.querySelector<HTMLParagraphElement>("#login-message")!;
  const waitToResend = (seconds: number) => {
    if (cooldown) clearInterval(cooldown);
    const until = Date.now() + Math.max(1, seconds) * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      send.textContent = remaining
        ? `${remaining} 秒后重新发送`
        : "重新发送验证码";
      send.disabled = remaining > 0;
      if (!remaining) clearInterval(cooldown);
    };
    tick();
    cooldown = setInterval(tick, 1000);
  };
  send.onclick = async () => {
    send.disabled = true;
    send.textContent = "正在发送…";
    message.textContent = "";
    try {
      const result = await api("/api/auth/request-otp", {});
      message.textContent = result.dev_otp
        ? `本地开发验证码：${result.dev_otp}`
        : "验证码已发送，请查看邮箱。";
      document.querySelector<HTMLInputElement>("#code")!.focus();
      waitToResend(Number(result.retry_after) || 60);
    } catch (error) {
      message.textContent = (error as Error).message;
      const retry = (error as { retryAfter?: number }).retryAfter;
      if (retry) waitToResend(retry);
      else {
        send.disabled = false;
        send.textContent = "重新发送验证码";
      }
    }
  };
  document.querySelector<HTMLFormElement>("#verify")!.onsubmit = async (
    event,
  ) => {
    event.preventDefault();
    const enter = document.querySelector<HTMLButtonElement>("#enter")!;
    enter.disabled = true;
    try {
      await api("/api/auth/verify-otp", {
        code: document.querySelector<HTMLInputElement>("#code")!.value,
      });
      if (cooldown) clearInterval(cooldown);
      auth = "authenticated";
      history.replaceState(
        null,
        "",
        `/${returnHash || validHash(location.hash)}`,
      );
      returnHash = "";
      await load();
    } catch (error) {
      message.textContent = (error as Error).message;
      enter.disabled = false;
    }
  };
}

/**
 * 一次性挂载侧栏 / 顶栏 / 主区 / 页脚的 DOM 骨架。挂载之后再调用 render()
 * 只更新内部元素的属性，#content 也不会整个重建，避免丢失 <details> 展开状态、
 * 滚动位置和 activeElement。实测刷新后 activeElement 会从 SUMMARY 掉到 BODY，
 * 就是因为整个 main 被 innerHTML 重建了一次。
 */
function mountChrome() {
  app.innerHTML = `<div class="workspace"><aside class="sidebar">${brand}
    <nav aria-label="主导航">${NAV_ITEMS.map(
      ([id, title]) =>
        `<a href="#${id}" data-nav="${id}"><span class="nav-dot"></span>${title}</a>`,
    ).join("")}</nav>
    <div class="sidebar-bottom"><span class="private-dot"></span>私人投资记录<p>依据数据，不追逐噪音。</p></div></aside>
    <div class="main"><header class="topbar"><div><span class="site-name">投资工作台</span><span class="muted" id="topbar-subtitle"></span></div>
    <div class="actions"><button id="refresh" title="重新读取网站已同步批次，不采集新行情">刷新数据</button><button id="logout">退出</button></div></header>
    <p id="notice" class="notice" role="status" aria-live="polite" hidden></p>
    <main id="content" tabindex="-1" aria-busy="false"></main>
    <footer>刷新数据只读取网站已同步批次。行情与账户确认时间分别记录，成交以券商凭证为准。</footer></div></div>`;
  document.querySelector<HTMLButtonElement>("#refresh")!.onclick = () => {
    void load();
  };
  document.querySelector<HTMLButtonElement>("#logout")!.onclick = logout;
  mounted = true;
}

/** 退出按钮：原 shell() 内联逻辑提到独立函数，logout 不再依赖 shell 重挂。 */
async function logout() {
  loadVersion++;
  try {
    await api("/api/auth/logout", {});
    snapshot = null;
    calendar = null;
    auth = "anonymous";
    loading = false;
    notice = "";
    loadVersion++;
    returnHash = "#overview";
    history.replaceState(null, "", "/login");
    login();
  } catch {
    loading = false;
    showError("退出未完成，请检查连接后重试。");
  }
}

/** 同步挂载后仍需要刷新的持久节点：导航 active、顶栏副标题、刷新按钮、提示条。 */
function syncChrome(active: string, subtitle: string) {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "[data-nav]",
  )) {
    if (link.dataset.nav === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const sub = document.querySelector<HTMLElement>("#topbar-subtitle");
  if (sub) sub.textContent = subtitle;
  const refresh = document.querySelector<HTMLButtonElement>("#refresh");
  if (refresh) {
    refresh.disabled = loading;
    refresh.textContent = loading ? "刷新中…" : "刷新数据";
  }
  const main = document.querySelector<HTMLElement>("#content");
  if (main) main.setAttribute("aria-busy", String(loading));
  const noticeEl = document.querySelector<HTMLElement>("#notice");
  if (noticeEl) {
    if (!notice) {
      noticeEl.hidden = true;
      noticeEl.textContent = "";
      noticeEl.className = "notice";
    } else {
      noticeEl.hidden = false;
      noticeEl.textContent = notice;
      noticeEl.className = `notice notice-${noticeTone(notice)}`;
    }
  }
}

/** 挂载 + 渲染内容。返回主内容供加载的批次与当前一致时跳过内容重绘。 */
function renderContent(html: string) {
  const main = document.querySelector<HTMLElement>("#content");
  if (!main) return;
  main.innerHTML = html;
  applyChartStyles(app);
  bindContentHandlers();
  // DOM 刚重建完，此刻才有可打标的节点；早于这一步调用会落在旧节点上。
  applyPendingPositionFocus();
}

function showError(message: string) {
  notice = message;
  render();
}

function riskCards(rows: Row[]) {
  return rows
    .map((r) => {
      const state =
        r.triggered === null ? "不适用" : r.triggered ? "已触发" : e(r.level);
      const action = ruleAction(r);
      return `<article class="risk-row ${r.triggered ? "triggered" : r.proximity === "critical" ? "near" : ""}">
    <div><strong>${e(r.item)}</strong><span>${e(r.kind)} · 当前 ${e(ruleCurrent(r))} · 阈值 ${e(r.threshold)}</span></div>
    <div><b>${state}</b><span>相对距离 ${pct(r.distance)}</span></div>
    <p>${e(action)}${proximityRequirement(r.proximity) ? `；${e(proximityRequirement(r.proximity))}` : ""}</p></article>`;
    })
    .join("");
}

function overview() {
  const d = snapshot!.data,
    a = d.account[0],
    report = d.reports[0];
  const relevant = overviewRules(d.risk);
  const targets = Object.fromEntries(
    d.positions.map((p) => [
      String(p.ticker),
      typeof p.target === "number" ? p.target : null,
    ]),
  );
  const cashAfter = (typeof a.cash_after_dca_raw === "number" ? a.cash_after_dca_raw : null) ??
    (typeof a.cash_after_dca === "number" ? a.cash_after_dca : null);
  const cashMinimum = d.positions.find((p) => p.ticker === "现金")?.target;
  const cashBufferDiff =
    typeof cashAfter === "number" && typeof cashMinimum === "number"
      ? cashAfter - cashMinimum
      : null;
  return `<div class="page-heading"><div><p class="muted">守住节奏，持续记录</p><h1>投资总览</h1></div><span class="stamp">行情截至 ${e(a.quote_date)}</span></div>
    ${accountAlerts(a.warnings, d.risk)}
    <p class="freshness">批次生成于 ${e(time(a.generated_at))} · ${e(elapsed(a.generated_at))}。刷新只读取已同步数据。行情阶段：${e(a.quote_status || "未确认")}。</p>
    <div class="data-note"><span>${a.data_mode === "demo" ? "本地演示 · 虚构数据" : Number(a.cash_age_days) > 14 ? "账户待核对" : "账户数据日期"}</span>持仓确认于 ${e(a.holdings_as_of)}；现金记录于 ${e(a.cash_as_of)}。行情更新不会改变账户确认日期。</div>
    <section class="surface attention"><div class="section-title"><h2>当前需要关注</h2><a href="#positions">全部规则</a></div>${relevant.length ? riskCards(relevant) : '<p class="muted">已计算的规则暂无触发或临近状态。</p>'}<p class="fine">组合单日与月度跌幅等历史条件未评估。以下报告保留当时判断。</p></section>
    ${typeof cashAfter === "number" ? `<div class="data-note"><span>月投后现金缓冲估算</span>${typeof a.dca_amount_usd === "number" ? `按本批月投 ${money(a.dca_amount_usd)} 美元估算，` : "按本批月投假设估算，"}执行后现金占比约 ${pct(cashAfter)}，最低保留线 ${pct(cashMinimum)}${cashBufferDiff === null ? "" : `，相差 ${cashBufferDiff >= 0 ? "+" : ""}${(cashBufferDiff * 100).toFixed(1)} 个百分点`}。基于现金记录 ${e(a.cash_as_of)}；估算不表示可以下单，仍须核实买入通道及账户。</div>` : ""}
    <section class="overview-graphics">${compositionBar(d.positions)}</section>
    ${cashBuffer(cashAfter, typeof cashMinimum === "number" ? cashMinimum : null, typeof a.dca_amount_usd === "number" ? a.dca_amount_usd : null, typeof a.total_usd === "number" ? a.total_usd : null, a.cash_as_of)}
    <section class="account-strip"><div><span>估算总资产 · 美元</span><strong>${money(a.total_usd)}</strong></div><div><span>股票市值 · 美元</span><strong>${money(Number(a.stocks_usd) + Number(a.hk_usd))}</strong></div><div><span>现金与基金 · 美元</span><strong>${money(a.cash_usd)}</strong><small>占比 ${pct(a.cash_weight_raw ?? a.cash_weight)}</small></div></section>
    <section class="surface"><div class="section-title"><h2>配置缺口</h2><a href="#positions">查看持仓</a></div>${allocationGap(d.positions)}</section>
    <section class="brief"><div class="brief-label">最近一期报告 · 当时结论<span>${report ? e(reportCategory(report.kind)) : "尚无报告"}</span></div>
      <div><h2>${report ? e(reportAction(report.action)) : "等待第一份报告"}</h2><p>${report ? e(report.headline || "这份历史报告未填写摘要，可打开阅读全文。") : "同步后会在这里展示最新报告与行动。"}</p>
      ${report ? `<a class="text-link" href="#reports/${encodeURIComponent(String(report.id))}">阅读历史报告 <span>${e(report.date)} · 交易日 ${e(report.trading_date || "未记录")}</span></a>` : ""}</div></section>
    ${calendar?.snapshot?.events?.length ? `<section class="surface timeline-card"><div class="section-title"><h2>投资事件</h2><span class="muted">${calendarFailed ? "日历暂时无法读取" : e((calendar?.state && String(calendar.state)) || "未连接")}</span></div>${eventTimeline(calendar.snapshot.events, calendar.last_success?.fetched_at)}</section>` : ""}
    <section class="surface"><div class="section-title"><h2>持仓变化</h2><span class="muted">按持仓档案逐次确认</span></div>${weightHistory(d.history ?? [], targets)}</section>
    <section class="surface market"><div class="section-title"><h2>市场一览</h2><span class="muted">按各标的最近行情展示</span></div>
    <div class="market-grid">${d.market.map((m) => `<div><span>${e(m.name)}</span><strong>${number(m.close)}</strong><b class="${tone(m.change_pct)}">${marketChange(m.change_pct)}</b><small>${m.error ? e(humanizeQuoteError(m.error)) : `${e(m.date)} · ${e(m.quote_status || "阶段未确认")}`}</small></div>`).join("")}</div></section>`;
}

function quoteInfo(p: Row) {
  if (p.quote_time)
    return `已确认价格时刻 ${time(p.quote_time)} · ${String(p.quote_session === "regular" ? "常规时段" : "阶段未确认")}`;
  return `${String(p.quote_date || "估值，待核实")} · 价格时刻未确认${p.market_time_iso ? `；来源市场时间 ${time(p.market_time_iso)}（不等于价格时刻）` : ""}`;
}

function positions() {
  const d = snapshot!.data;
  return `<div class="page-heading"><div><p class="muted">看清配置与边界</p><h1>持仓与风控</h1></div><span class="stamp">计算依据 ${e(d.account[0].framework)}</span></div>
    <section class="surface"><div class="section-title"><h2>当前持仓</h2><span class="muted">金额单位：美元</span></div><div class="table-scroll desktop-positions"><table><thead><tr><th>标的</th><th>股数</th><th>成本 / 现价</th><th>市值</th><th>浮盈亏</th><th>当前 / 配置依据</th><th>行情时间</th></tr></thead><tbody>
    ${d.positions.map((p) => `<tr id="${e(positionAnchorId(String(p.ticker ?? "")))}" class="position-row" data-position="${e(String(p.ticker ?? ""))}"><td><strong>${e(p.ticker)}</strong><small>${e(p.name)}</small></td><td>${number(p.shares, 4)}</td><td>${number(p.avg_cost)} / ${number(p.price)}</td><td>${money(p.value_usd)}</td><td class="${tone(p.pnl_pct)}">${signed(p.pnl_pct)}</td><td>${pct(weight(p))}<small>${p.ticker === "现金" ? "最低保留线" : "目标权重"} ${pct(p.target)}</small></td><td><small>${e(quoteInfo(p))}</small></td></tr>`).join("")}</tbody></table></div>
    <div class="mobile-positions">${d.positions
      .map(
        (
          p,
        ) => `<article id="${e(positionAnchorId(String(p.ticker ?? "")))}" class="position-card" data-position="${e(String(p.ticker ?? ""))}"><div class="position-heading"><strong>${e(p.ticker)}</strong><span>${e(p.name)}</span></div>
      <dl class="position-metrics"><div><dt>市值 · 美元</dt><dd>${money(p.value_usd)}</dd></div><div><dt>浮盈亏</dt><dd class="${tone(p.pnl_pct)}">${signed(p.pnl_pct)}</dd></div><div><dt>当前权重</dt><dd>${pct(weight(p))}</dd></div><div><dt>${p.ticker === "现金" ? "最低保留线" : "目标权重"}</dt><dd>${pct(p.target)}</dd></div></dl>
      <details><summary>持仓与行情详情</summary><p>股数 ${number(p.shares, 4)} · 成本 ${number(p.avg_cost)} · 现价 ${number(p.price)}</p><p>${e(quoteInfo(p))}</p></details></article>`,
      )
      .join("")}</div></section>
    <section class="surface"><div class="section-title"><h2>风控距离</h2><span class="muted">触发状态与距离分别计算</span></div>${riskRail(d.risk)}</section>
    <div class="data-note"><span>未评估</span>完整账户历史尚未补齐，组合单日跌幅与持仓月度跌幅等条件不能据此判定安全。</div>`;
}

function reportList() {
  const all = snapshot!.data.reports;
  const reports = all.filter(
    (r) =>
      (!reportKind || r.kind === reportKind) &&
      `${r.kind} ${r.date} ${r.headline} ${r.body}`
        .toLowerCase()
        .includes(reportQuery.toLowerCase()),
  );
  return `<div class="report-list">${
    reports.length
      ? reports
          .map(
            (
              r,
            ) => `<a class="report-card" href="#reports/${encodeURIComponent(String(r.id))}">
    <div><span class="report-kind">${e(reportCategory(r.kind))}</span><time>${e(r.date)}</time></div><h2>${e(
      r.headline ||
        String(r.body)
          .split("\n")
          .find((l) => l.startsWith("# "))
          ?.replace(/^#+\s*/, "") ||
        r.kind,
    )}</h2>
    <p>交易日 ${e(r.trading_date || "未记录")} <span>当时：${e(reportAction(r.action))}</span></p></a>`,
          )
          .join("")
      : '<p class="empty">没有符合条件的报告。</p>'
  }</div>`;
}

function reportContents(body: string) {
  const sections = headings(body);
  if (sections.length < 3) return "";
  return `<details class="report-contents"><summary>章节目录 · ${sections.length} 节</summary><nav aria-label="报告章节">${sections
    .map((s) => `<button data-section="${s.id}">${e(s.title)}</button>`)
    .join("")}</nav></details>`;
}

function reportsPage(id?: string) {
  const reports = snapshot!.data.reports;
  if (id) {
    const r = reports.find((r) => r.id === id);
    if (!r)
      return '<div class="empty"><h1>未找到这份报告</h1><a href="#reports">返回报告列表</a></div>';
    const body = String(r.body);
    return `<div class="report-heading" id="report-top"><a href="#reports">返回报告列表</a><span>${e(reportCategory(r.kind))} · ${e(r.date)}</span></div>
      <h1 class="report-title">${e(reportCategory(r.kind))}</h1>
      <div class="data-note">归档日 ${e(r.date)} · 对应交易日 ${e(r.trading_date || "未记录")} · 日期来源 ${e(({ front_matter: "报告元数据", generated_time: "生成时间", filename: "文件名" } as Record<string, string>)[String(r.date_source)] || "未记录")}</div>
      ${reportContents(body)}
      <article class="report-body">${markdown(body)}</article><p class="fine source">原始记录：${e(r.path)}。历史报告保留当时的依据与判断。</p><button class="back-top" id="back-top">返回顶部</button>`;
  }
  return `<div class="page-heading"><div><p class="muted">把判断留在时间里</p><h1>研究与报告</h1></div><span class="stamp">${reports.length} 份已同步报告</span></div>
    <div class="filters"><label for="search">搜索报告<input id="search" type="search" placeholder="搜索标的、结论或正文" value="${e(reportQuery)}"></label>
    <label for="kind">报告类型<select id="kind"><option value="">全部类型</option>${[...new Set(reports.map((r) => String(r.kind)))].map((k) => `<option value="${e(k)}" ${k === reportKind ? "selected" : ""}>${e(k)}</option>`).join("")}</select></label></div><div id="report-results">${reportList()}</div>`;
}

function statusPage() {
  const a = snapshot!.data.account[0];
  const facts = [
    ["持仓确认日", a.holdings_as_of],
    ["现金记录时间", a.cash_as_of],
    ["行情截至", a.quote_date],
    ["本批数据生成时间", time(a.generated_at)],
    ["网站同步时间", time(snapshot!.received_at)],
    ["批次经过时间", elapsed(a.generated_at)],
    [
      "价格时刻完整性",
      a.quote_time_complete === true
        ? "全部持仓有明确价格时刻"
        : "未完整记录，行情阶段未确认",
    ],
    [
      "来源市场时间范围",
      a.market_time_min
        ? `${time(a.market_time_min)} — ${time(a.market_time_max)}；不是价格时刻或收盘证明`
        : "旧批次未记录",
    ],
    [
      "各持仓行情日期",
      Array.isArray(a.quote_dates)
        ? `${a.quote_dates.join("、")}${a.quote_date_mixed ? "（日期不一致）" : ""}`
        : "旧批次未记录",
    ],
    ["计算所用规范", a.framework],
    ["数据模式", a.data_mode === "live" ? "联网生成" : "未确认"],
    ["同步批次", snapshot!.batch_id],
  ];
  return `<div class="page-heading"><div><p class="muted">知道数据从哪里来</p><h1>数据状态</h1></div></div>
    <section class="surface"><div class="section-title"><h2>当前批次</h2><span class="muted">时间均以北京时间展示</span></div><dl class="facts">${facts.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl></section>
    <section class="surface"><h2>数据提醒</h2><ul class="warnings">${
      String(a.warnings || "")
        .split(" / ")
        .filter(Boolean)
        .map(
          (w) =>
            `<li><span class="notice-mark notice-mark-${noticeTone(w)}" aria-hidden="true"></span>${e(humanizeQuoteError(w))}</li>`,
        )
        .join("") || "<li>本批数据未提供额外提醒。</li>"
    }</ul></section>
    <div class="overview-grid"><section class="surface"><h2>等待核实</h2><p>港股股数、GOOGL 早期批次、现金更新和成本尾差，需券商凭证或成交确认。页面不会推算补齐。</p></section>
    <div id="calendar-slot">${calendarPanel(calendar, calendarFailed, time)}</div></div>`;
}

/**
 * 渲染主流程：
 *   1. 首次调用挂载 chrome（侧栏 / 顶栏 / 主区 / 页脚）；
 *   2. 每次都同步顶栏副标题、提示条、刷新按钮（这些是常驻节点，不重建）；
 *   3. 只在批次 ID + 当前页变化时才替换 #content，避免同批次重新拉取行情时
 *      整个正文重新 innerHTML 重放动画、丢失 <details> 展开状态。
 *
 * hashchange 也会触发本函数，所以同一个 hash 下多次刷新只有第一次会写主区。
 */
function render() {
  if (auth === "anonymous") {
    login();
    return;
  }
  if (!mounted) mountChrome();
  const [page, rawId] = location.hash.slice(1).split("/");
  let id = "";
  try {
    id = rawId ? decodeURIComponent(rawId) : "";
  } catch {
    /* Unknown links return the list. */
  }
  const active = ["positions", "reports", "status"].includes(page)
    ? page
    : "overview";
  const subtitle = snapshot
    ? `持仓确认 ${String(snapshot.data.account[0].holdings_as_of)}`
    : "";
  syncChrome(active, subtitle);
  const nextKey = JSON.stringify([dataRevision, active, id, snapshot ? "ready" : [dataState, loading, auth]]);
  if (nextKey === renderKey) {
    // 记忆化命中：DOM 没重建，但 pending 仍需消费，否则会漏到下一次重绘。
    applyPendingPositionFocus();
    return;
  }
  renderKey = nextKey;
  if (!snapshot) {
    renderContent(
      `<div class="empty"><span class="seal">${auth === "authenticated" ? "登录成功" : "正在连接"}</span><h1>${dataState === "empty" ? "等待第一批投资数据" : dataState === "failed" ? "数据暂时无法读取" : "正在读取投资数据…"}</h1><p>可用“刷新数据”重试。账户、持仓和报告会在完整批次同步后显示。</p></div>`,
    );
    return;
  }
  const inner =
    active === "positions"
      ? positions()
      : active === "reports"
        ? reportsPage(id)
        : active === "status"
          ? statusPage()
          : overview();
  renderContent(
    (snapshot.data.account[0].data_mode === "demo"
      ? '<div class="notice notice-warning" role="status" aria-live="polite">本地演示：全部金额、行情和报告均为虚构数据，不代表真实账户。</div>'
      : "") + inner,
  );
}

/** 简单的 CSS.escape polyfill；workerd 测试环境不一定有。 */
const cssEscape = (value: string) =>
  window.CSS && typeof window.CSS.escape === "function"
    ? window.CSS.escape(value)
    : value.replace(
        /([\\\"\'\:\;\,\.\#\@\$\(\)\[\]\{\}\*\+\=\<\>\!\?])/g,
        "\\$1",
      );

/** 高亮停留时长：够读完一行数字，又不至于一直挂在页面上。 */
const HIGHLIGHT_HOLD_MS = 6000;
/** 淡出时长，必须与 CSS 里的 transition 时长一致。 */
const HIGHLIGHT_FADE_MS = 600;

let highlightFadeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 跳到持仓页后高亮指定 ticker。
 *
 * 桌面表格行（tr.position-row）和 <=900px 才显示的 position-card 都带
 * [data-position]，两侧同时打标；只滚到当前真正可见的那一个，因为
 * scrollIntoView 对 display:none 的节点是空操作。
 *
 * 高亮停留 HIGHLIGHT_HOLD_MS 后淡出，而不是直接移除 class：直接移除会让
 * 背景和左侧色条在同一帧消失，视觉上像闪烁。淡出期间保留 is-active 并
 * 叠加 is-fading，由 CSS 过渡透明度，最后再摘掉两个 class。
 */
function focusPositionRow(ticker: string) {
  const selector = `[data-position="${cssEscape(ticker)}"]`;
  const targets = Array.from(
    document.querySelectorAll<HTMLElement>(selector),
  );
  if (!targets.length) return;
  clearHighlight();
  targets.forEach((el) => el.classList.add("is-active"));
  // getClientRects().length 为 0 表示被 display:none 挡掉（另一个视图）。
  const visible =
    targets.find((el) => el.getClientRects().length > 0) ?? targets[0];
  visible.scrollIntoView({ behavior: "smooth", block: "center" });
  highlightFadeTimer = setTimeout(() => {
    const fading = Array.from(
      document.querySelectorAll<HTMLElement>(".is-active"),
    );
    if (!fading.length) return;
    fading.forEach((el) => el.classList.add("is-fading"));
    highlightFadeTimer = setTimeout(() => {
      fading.forEach((el) => el.classList.remove("is-active", "is-fading"));
    }, HIGHLIGHT_FADE_MS);
  }, HIGHLIGHT_HOLD_MS);
}

/** 立刻清掉高亮与待执行的淡出计时器（点击其它标的、或 DOM 即将重建时）。 */
function clearHighlight() {
  clearTimeout(highlightFadeTimer);
  highlightFadeTimer = undefined;
  document
    .querySelectorAll<HTMLElement>(".is-active, .is-fading")
    .forEach((el) => el.classList.remove("is-active", "is-fading"));
}

/** 在 renderContent 写完 DOM 后消费，避免高亮落在重绘前的旧节点上。 */
function applyPendingPositionFocus() {
  const ticker = pendingPositionFocus;
  if (!ticker) return;
  pendingPositionFocus = null;
  focusPositionRow(ticker);
}

/** 内容重绘后绑定事件处理器。挂载时（刷新 / 退出 / hashchange）会重新调用。 */
function bindContentHandlers() {
  document
    .querySelector<HTMLButtonElement>("#back-top")
    ?.addEventListener("click", () => {
      window.scrollTo(0, 0);
      document
        .querySelector<HTMLElement>("#content")
        ?.focus({ preventScroll: true });
    });
  // 资产构成 / 持仓联动：点段或图例项 → 跳到持仓页并高亮对应行。
  // 只绑总览的图表节点：持仓行本身也带 data-position，不能变成跳转按钮。
  document
    .querySelectorAll<HTMLElement>(
      ".composition-segment[data-position], .composition-legend-item[data-position]",
    )
    .forEach((el) => {
      el.onclick = () => {
        const ticker = el.dataset.position;
        if (!ticker) return;
        pendingPositionFocus = ticker;
        // 已经在持仓页时 hash 不变、不会触发 hashchange，必须显式重绘；
        // 跨页则交给 hashchange -> render -> renderContent 打标。
        if (location.hash === "#positions") render();
        else location.hash = "#positions";
      };
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-section]")
    .forEach((button) => {
      button.onclick = () => {
        const heading = document.getElementById(button.dataset.section!);
        heading?.scrollIntoView({ block: "start" });
        heading?.focus({ preventScroll: true });
      };
    });
  const historyDate =
    document.querySelector<HTMLSelectElement>("#history-date");
  if (historyDate) {
  if (
    selectedHistory &&
    snapshot?.data.history?.some((r) => r.source === selectedHistory)
  ) {
    historyDate.value = selectedHistory;
    const row = snapshot!.data.history!.find(
      (r) => r.source === selectedHistory,
    )!;
    document.querySelector("#history-detail")!.innerHTML = historyDetail(row);
  }
  historyDate.onchange = () => {
    selectedHistory = historyDate.value;
    const row = snapshot?.data.history?.find(
      (r) => r.source === historyDate.value,
    );
    if (row)
      document.querySelector("#history-detail")!.innerHTML = historyDetail(row);
  };
  }
  const search = document.querySelector<HTMLInputElement>("#search");
  const kind = document.querySelector<HTMLSelectElement>("#kind");
  if (!search || !kind) return;
  const update = () => {
    reportQuery = search.value;
    reportKind = kind.value;
    document.querySelector("#report-results")!.innerHTML = reportList();
  };
  search.oninput = update;
  kind.onchange = update;
}

async function load() {
  if (loading) return;
  loading = true;
  const version = ++loadVersion;
  const previous = snapshot?.batch_id;
  notice = "";
  clearTimeout(noticeTimer);
  render();
  try {
    if (ssoMode === undefined)
      ssoMode = (await api("/api/health")).sso_enabled === true;
    await api("/api/me");
    if (version !== loadVersion) return;
    auth = "authenticated";
    const next = (await api("/api/dashboard")) as unknown as Snapshot;
    if (version !== loadVersion) return;
    if (!next.data?.account?.length)
      throw new Error("数据批次不完整，请重新同步");
    if (!snapshot || snapshot.batch_id !== next.batch_id || JSON.stringify(snapshot.data) !== JSON.stringify(next.data)) dataRevision++;
    snapshot = next;
    dataState = "ready";
    notice = previous
      ? next.batch_id === previous
        ? "已检查，当前已是最新同步批次。未重新采集行情。"
        : "已载入新同步批次。"
      : "";
    void loadCalendar(version);
  } catch (error) {
    if (version !== loadVersion) return;
    dataState =
      (error as { status?: number }).status === 404 ? "empty" : "failed";
    notice = snapshot
      ? "刷新失败，仍展示上一批数据。请检查连接后重试；原生成时间保持不变。"
      : (error as Error).message;
  } finally {
    if (version === loadVersion) {
      loading = false;
      render();
      if (notice.startsWith("已")) noticeTimer = setTimeout(() => {
        notice = "";
        if (auth === "authenticated") render();
      }, 6000);
    }
  }
}

function syncCalendarPanel() {
  const slot = document.querySelector<HTMLElement>("#calendar-slot");
  if (!slot) return;
  const html = calendarPanel(calendar, calendarFailed, time);
  if (slot.innerHTML !== html) slot.innerHTML = html;
}

async function loadCalendar(version: number) {
  try {
    const next = await api("/api/calendar");
    if (version !== loadVersion) return;
    if (typeof next.state !== "string") throw new Error("日历状态无效");
    calendar = next as unknown as CalendarView;
    calendarFailed = false;
  } catch {
    if (version !== loadVersion) return;
    calendarFailed = true;
  }
  if (version === loadVersion) syncCalendarPanel();
}

async function checkSession() {
  if (checkingSession || loading || auth !== "authenticated") return;
  checkingSession = true;
  try {
    await api("/api/me");
  } catch (error) {
    if (
      (error as { status?: number }).status !== 401 &&
      auth === "authenticated"
    ) {
      showError("会话检查暂时失败，仍展示上次读取的数据，请稍后刷新。");
    }
  } finally {
    checkingSession = false;
  }
}

window.addEventListener("focus", () => {
  void checkSession();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkSession();
});
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
  focusContent();
});
void load();
