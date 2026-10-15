import "./style.css";
import { PRODUCT_BRAND } from "../../../shared/brand";
import { marketChange } from "./format";
import { allocationGap, riskRail, weightHistory, historyDetail } from "./charts";
import { applyChartStyles } from "./dom";
import { accountAlerts, overviewRules, proximityRequirement } from "./risk-summary";
import { escapeHtml as e, markdown } from "./markdown";
import type { Dashboard, Row } from "../../worker/dashboard-types";

type Snapshot = { batch_id: string; received_at: string; data: Dashboard };
const app = document.querySelector<HTMLDivElement>("#app")!;
let snapshot: Snapshot | null = null;
let loadVersion = 0;
let ssoMode: boolean | undefined;
let checkingSession = false;
let hidden = sessionStorage.getItem("gu-hide") === "1";
let reportQuery = "";
let reportKind = "";
let cooldown: ReturnType<typeof setInterval> | undefined;
const pct = (v: unknown) => typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—";
const number = (v: unknown, digits = 2) => typeof v === "number" ? v.toLocaleString("zh-CN", { maximumFractionDigits: digits }) : "—";
const money = (v: unknown) => hidden ? "••••" : typeof v === "number" ? `${(v / 10000).toFixed(2)} 万` : "—";
const price = (v: unknown) => hidden ? "••••" : number(v);
const time = (v: unknown) => {
  const date = new Date(String(v));
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short", hour12: false }).format(date) : "未记录";
};
const signed = (v: unknown) => typeof v === "number" ? `${v > 0 ? "+" : ""}${pct(v)}` : "—";
const tone = (v: unknown) => typeof v === "number" && v < 0 ? "negative" : "positive";
const brand = `<a class="brand" href="#overview" aria-label="${PRODUCT_BRAND} · GU"><span class="brand-mark">股</span><span>kedoupi<small>codepi · 个人投资工作台</small></span></a>`;

function clearSession() {
  snapshot = null;
  reportQuery = "";
  reportKind = "";
  loadVersion++;
  login();
}

async function api(path: string, body?: unknown, method?: string) {
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) {
    clearSession();
    throw Object.assign(new Error("登录已过期，请重新登录"), { status: 401 });
  }
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw Object.assign(new Error(String(result.error || "请求失败")), { status: response.status });
  }
  if (path === "/api/me" && result.authenticated === false) {
    clearSession();
    throw Object.assign(new Error("登录已过期，请重新登录"), { status: 401 });
  }
  return result;
}

function login() {
  if (cooldown) clearInterval(cooldown);
  app.innerHTML = `<main class="login">
    <section class="login-story"><div>${brand}</div>
      <div class="login-heading"><p class="muted">为长期持有，留一份清醒的记录。</p><h1>看清持仓。<br>回到自己的规则。</h1>
      <p>持仓、风控与研究，收在同一个地方。<br>每一个判断，都有数据和时间可循。</p></div>
      <div class="login-foot">私人工作台 <span>北京时间</span></div>
    </section>
    <section class="login-panel"><div class="login-form"><span class="seal">仅本人访问</span><h2>登录投资工作台</h2>
      ${ssoMode !== false ? `<p class="muted">使用 ${PRODUCT_BRAND} 账户统一登录。</p>
      ${new URLSearchParams(location.search).has("auth_error") ? '<p role="alert">登录未完成。请重新登录；服务暂时不可用时，可稍后重试。</p>' : ""}
      <a class="primary" href="/api/auth/login?return=%2F">统一登录</a>
      <p class="fine">投资工作台登录状态最多保留 7 天。退出将同步退出其他工具。</p>` : `
      <p class="muted">验证码将发送至<br><strong>k•••••••••1@gmail.com</strong></p>
      <button id="send" class="primary">发送验证码</button>
      <form id="verify"><label for="code">六位验证码</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required aria-describedby="login-message">
      <button id="enter" class="primary" type="submit">验证并登录</button></form>
      <p id="login-message" role="status" aria-live="polite"></p><p class="fine">验证码 8 分钟内有效，登录状态保留 7 天。</p>`}
    </div></section></main>`;
  if (ssoMode !== false) return;
  const send = document.querySelector<HTMLButtonElement>("#send")!;
  const message = document.querySelector<HTMLParagraphElement>("#login-message")!;
  send.onclick = async () => {
    send.disabled = true; send.textContent = "正在发送…"; message.textContent = "";
    try {
      const result = await api("/api/auth/request-otp", {});
      message.textContent = result.dev_otp ? `本地开发验证码：${result.dev_otp}` : "验证码已发送，请查看邮箱。";
      document.querySelector<HTMLInputElement>("#code")!.focus();
      let seconds = 60;
      send.textContent = `${seconds} 秒后重新发送`;
      cooldown = setInterval(() => {
        seconds--;
        send.textContent = `${seconds} 秒后重新发送`;
        if (!seconds) { clearInterval(cooldown); send.disabled = false; send.textContent = "重新发送验证码"; }
      }, 1000);
    } catch (error) { message.textContent = (error as Error).message; send.disabled = false; send.textContent = "重新发送验证码"; }
  };
  document.querySelector<HTMLFormElement>("#verify")!.onsubmit = async event => {
    event.preventDefault();
    const enter = document.querySelector<HTMLButtonElement>("#enter")!;
    enter.disabled = true;
    try {
      await api("/api/auth/verify-otp", { code: document.querySelector<HTMLInputElement>("#code")!.value });
      if (cooldown) clearInterval(cooldown);
      history.replaceState(null, "", "/#overview");
      await load();
    } catch (error) { message.textContent = (error as Error).message; enter.disabled = false; }
  };
}

function shell(content: string, active = "overview", subtitle = "") {
  app.innerHTML = `<div class="workspace"><aside class="sidebar">${brand}
    <nav aria-label="主导航">${[["overview", "总览"], ["positions", "持仓与风控"], ["reports", "研究与报告"], ["status", "数据状态"]].map(([id, title]) =>
      `<a href="#${id}" ${id === active ? 'aria-current="page"' : ""}><span class="nav-dot"></span>${title}</a>`).join("")}</nav>
    <div class="sidebar-bottom"><span class="private-dot"></span>私人投资记录<p>依据数据，不追逐噪音。</p></div></aside>
    <div class="main"><header class="topbar"><div><span class="site-name">投资工作台</span><span class="muted">${e(subtitle)}</span></div>
    <div class="actions"><button id="hide">${hidden ? "显示金额" : "隐藏金额"}</button><button id="refresh">刷新</button><button id="logout">退出</button></div></header>
    <main id="content">${content}</main><footer>行情与账户确认时间分别记录。账户及成交以券商凭证为准。</footer></div></div>`;
  document.querySelector<HTMLButtonElement>("#hide")!.onclick = () => { hidden = !hidden; sessionStorage.setItem("gu-hide", hidden ? "1" : "0"); render(); };
  document.querySelector<HTMLButtonElement>("#refresh")!.onclick = () => { void load(); };
  document.querySelector<HTMLButtonElement>("#logout")!.onclick = async () => {
    try { await api("/api/auth/logout", {}); clearSession(); history.replaceState(null, "", "/login"); }
    catch (error) { showError((error as Error).message); }
  };
}

function showError(message: string) {
  const old = document.querySelector("#notice");
  old?.remove();
  const node = document.createElement("p");
  node.id = "notice"; node.className = "notice"; node.setAttribute("role", "alert"); node.textContent = message;
  document.querySelector("#content")?.prepend(node);
}

function riskCards(rows: Row[]) {
  return rows.map(r => {
    const state = r.triggered === null ? "不适用" : r.triggered ? "已触发" : e(r.level);
    const action = r.action || (r.triggered === null ? "无对应阈值" : "未触发动作");
    return `<article class="risk-row ${r.triggered ? "triggered" : r.proximity === "critical" ? "near" : ""}">
    <div><strong>${e(r.item)}</strong><span>${e(r.kind)} · 当前 ${e(r.current)} · 阈值 ${e(r.threshold)}</span></div>
    <div><b>${state}</b><span>相对距离 ${pct(r.distance)}</span></div>
    <p>${e(action)}${proximityRequirement(r.proximity) ? `；${e(proximityRequirement(r.proximity))}` : ""}</p></article>`;
  }).join("");
}

function overview() {
  const d = snapshot!.data, a = d.account[0], report = d.reports[0];
  const relevant = overviewRules(d.risk);
  const targets = Object.fromEntries(d.positions.map(p => [String(p.ticker), typeof p.target === "number" ? p.target : null]));
  return `<div class="page-heading"><div><p class="muted">守住节奏，持续记录</p><h1>投资总览</h1></div><span class="stamp">行情截至 ${e(a.quote_date)}</span></div>
    ${accountAlerts(a.warnings)}
    <div class="data-note"><span>${a.data_mode === "demo" ? "本地演示 · 虚构数据" : Number(a.cash_age_days) > 14 ? "账户待核对" : "账户数据日期"}</span>持仓确认于 ${e(a.holdings_as_of)}；现金记录于 ${e(a.cash_as_of)}。行情更新不会改变账户确认日期。</div>
    <section class="brief"><div class="brief-label">最近一期报告<span>${report ? e(report.kind) : "尚无报告"}</span></div>
      <div><h2>${report ? e(report.action || "历史报告未记录行动") : "等待第一份报告"}</h2><p>${report ? e(report.headline || "这份历史报告未填写摘要，可打开阅读全文。") : "同步后会在这里展示最新报告与行动。"}</p>
      ${report ? `<a class="text-link" href="#reports/${encodeURIComponent(String(report.id))}">阅读报告 <span>${e(report.date)} · 交易日 ${e(report.trading_date || "未记录")}</span></a>` : ""}</div></section>
    <section class="account-strip"><div><span>估算总资产 · 美元</span><strong>${money(a.total_usd)}</strong></div><div><span>股票市值 · 美元</span><strong>${money(Number(a.stocks_usd) + Number(a.hk_usd))}</strong></div><div><span>现金与基金 · 美元</span><strong>${money(a.cash_usd)}</strong><small>占比 ${pct(a.cash_weight)}</small></div></section>
    <section class="surface"><div class="section-title"><h2>配置缺口</h2><a href="#positions">查看持仓</a></div>${allocationGap(d.positions)}</section>
    <section class="surface"><div class="section-title"><h2>持仓变化</h2><span class="muted">按持仓档案逐次确认</span></div>${weightHistory(d.history ?? [], targets)}</section>
    <section class="surface"><div class="section-title"><h2>需要关注</h2><a href="#positions">全部规则</a></div>${relevant.length ? riskCards(relevant) : '<p class="muted">已计算的规则暂无触发或临近状态。</p>'}<p class="fine">组合单日与月度跌幅等历史条件未评估。</p></section>
    <section class="surface market"><div class="section-title"><h2>市场一览</h2><span class="muted">按各标的最近行情展示</span></div>
    <div class="market-grid">${d.market.map(m => `<div><span>${e(m.name)}</span><strong>${number(m.close)}</strong><b class="${tone(m.change_pct)}">${marketChange(m.change_pct)}</b><small>${m.error ? e(m.error) : e(m.date)}</small></div>`).join("")}</div></section>`;
}

function positions() {
  const d = snapshot!.data;
  return `<div class="page-heading"><div><p class="muted">看清配置与边界</p><h1>持仓与风控</h1></div><span class="stamp">计算依据 ${e(d.account[0].framework)}</span></div>
    <section class="surface"><div class="section-title"><h2>当前持仓</h2><span class="muted">金额单位：美元</span></div><div class="table-scroll"><table><thead><tr><th>标的</th><th>股数</th><th>成本 / 现价</th><th>市值</th><th>浮盈亏</th><th>当前 / 目标</th><th>行情日期</th></tr></thead><tbody>
    ${d.positions.map(p => `<tr><td><strong>${e(p.ticker)}</strong><small>${e(p.name)}</small></td><td>${hidden ? "••••" : number(p.shares, 4)}</td><td>${price(p.avg_cost)} / ${price(p.price)}</td><td>${money(p.value_usd)}</td><td class="${tone(p.pnl_pct)}">${signed(p.pnl_pct)}</td><td>${pct(p.weight)} / ${pct(p.target)}</td><td>${e(p.quote_date || "估值，待核实")}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="surface"><div class="section-title"><h2>风控距离</h2><span class="muted">触发状态与距离分别计算</span></div>${riskRail(d.risk)}</section>
    <div class="data-note"><span>未评估</span>完整账户历史尚未补齐，组合单日跌幅与持仓月度跌幅等条件不能据此判定安全。</div>`;
}

function reportList() {
  const all = snapshot!.data.reports;
  const reports = all.filter(r => (!reportKind || r.kind === reportKind) &&
    `${r.kind} ${r.date} ${r.headline} ${r.body}`.toLowerCase().includes(reportQuery.toLowerCase()));
  return `<div class="report-list">${reports.length ? reports.map(r => `<a class="report-card" href="#reports/${encodeURIComponent(String(r.id))}">
    <div><span class="report-kind">${e(r.kind)}</span><time>${e(r.date)}</time></div><h2>${e(r.headline || String(r.body).split("\n").find(l => l.startsWith("# "))?.replace(/^#+\s*/, "") || r.kind)}</h2>
    <p>交易日 ${e(r.trading_date || "未记录")} <span>${e(r.action || "未填写行动")}</span></p></a>`).join("") : '<p class="empty">没有符合条件的报告。</p>'}</div>`;
}

function reportsPage(id?: string) {
  const reports = snapshot!.data.reports;
  if (id) {
    const r = reports.find(r => r.id === id);
    if (!r) return '<div class="empty"><h1>未找到这份报告</h1><a href="#reports">返回报告列表</a></div>';
    return `<div class="report-heading"><a href="#reports">返回报告列表</a><span>${e(r.kind)} · ${e(r.date)}</span></div>
      <div class="data-note">归档日 ${e(r.date)} · 对应交易日 ${e(r.trading_date || "未记录")} · 日期来源 ${e(({ front_matter: "报告元数据", generated_time: "生成时间", filename: "文件名" } as Record<string, string>)[String(r.date_source)] || "未记录")}</div>
      <article class="report-body">${hidden ? '<p class="empty">金额隐藏期间暂停显示报告全文。点击顶部“显示金额”即可阅读。</p>' : markdown(String(r.body))}</article><p class="fine source">原始记录：${e(r.path)}。历史报告保留当时的依据与判断。</p>`;
  }
  return `<div class="page-heading"><div><p class="muted">把判断留在时间里</p><h1>研究与报告</h1></div><span class="stamp">${reports.length} 份已同步报告</span></div>
    <div class="filters"><label for="search">搜索报告<input id="search" type="search" placeholder="搜索标的、结论或正文" value="${e(reportQuery)}"></label>
    <label for="kind">报告类型<select id="kind"><option value="">全部类型</option>${[...new Set(reports.map(r => String(r.kind)))].map(k => `<option ${k === reportKind ? "selected" : ""}>${e(k)}</option>`).join("")}</select></label></div><div id="report-results">${reportList()}</div>`;
}

function statusPage() {
  const a = snapshot!.data.account[0];
  const facts = [
    ["持仓确认日", a.holdings_as_of], ["现金记录时间", a.cash_as_of], ["行情截至", a.quote_date],
    ["本批数据生成时间", time(a.generated_at)], ["网站同步时间", time(snapshot!.received_at)],
    ["计算所用规范", a.framework], ["数据模式", a.data_mode === "live" ? "联网生成" : "未确认"],
    ["同步批次", snapshot!.batch_id],
  ];
  return `<div class="page-heading"><div><p class="muted">知道数据从哪里来</p><h1>数据状态</h1></div></div>
    <section class="surface"><div class="section-title"><h2>当前批次</h2><span class="muted">时间均以北京时间展示</span></div><dl class="facts">${facts.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl></section>
    <section class="surface"><h2>数据提醒</h2><ul class="warnings">${String(a.warnings || "").split(" / ").filter(Boolean).map(w => `<li>${e(w)}</li>`).join("") || "<li>本批数据未提供额外提醒。</li>"}</ul></section>
    <div class="overview-grid"><section class="surface"><h2>等待核实</h2><p>港股股数、GOOGL 早期批次、现金更新和成本尾差，需券商凭证或成交确认。页面不会推算补齐。</p></section>
    <section class="surface"><h2>投资日历</h2><span class="seal">尚未连接</span><p>完成授权后再展示实时日程。目前不使用历史日期列表代替当前安排。</p></section></div>`;
}

function render() {
  if (!snapshot) { login(); return; }
  const [page, rawId] = location.hash.slice(1).split("/");
  let id = "";
  try { id = rawId ? decodeURIComponent(rawId) : ""; } catch { /* Unknown links return the list. */ }
  const active = ["positions", "reports", "status"].includes(page) ? page : "overview";
  const content = active === "positions" ? positions() : active === "reports" ? reportsPage(id) : active === "status" ? statusPage() : overview();
  shell((snapshot.data.account[0].data_mode === "demo" ? '<div class="notice">本地演示：全部金额、行情和报告均为虚构数据，不代表真实账户。</div>' : "") + content, active, `持仓确认 ${String(snapshot.data.account[0].holdings_as_of)}`);
  applyChartStyles(app);
  const historyDate = document.querySelector<HTMLSelectElement>("#history-date");
  if (historyDate) {
    historyDate.onchange = () => {
      const row = snapshot!.data.history?.find(r => r.source === historyDate.value);
      if (row) document.querySelector("#history-detail")!.innerHTML = historyDetail(row);
    };
  }
  const search = document.querySelector<HTMLInputElement>("#search");
  const kind = document.querySelector<HTMLSelectElement>("#kind");
  if (search && kind) {
    const update = () => { reportQuery = search.value; reportKind = kind.value; document.querySelector("#report-results")!.innerHTML = reportList(); };
    search.oninput = update; kind.onchange = update;
  }
}

async function load() {
  const version = ++loadVersion;
  try {
    if (ssoMode === undefined) ssoMode = (await api("/api/health")).sso_enabled === true;
    if (ssoMode && new URLSearchParams(location.search).has("auth_error") && !snapshot) { login(); return; }
    await api("/api/me");
    if (version !== loadVersion) return;
  } catch (error) {
    if (version !== loadVersion) return;
    if (snapshot) { showError(`会话检查暂时失败，请稍后重试：${(error as Error).message}`); return; }
    app.innerHTML = `<main class="empty"><h1>工作台暂时无法连接</h1><p>${e((error as Error).message)}</p><button id="retry">重新连接</button></main>`;
    document.querySelector<HTMLButtonElement>("#retry")!.onclick = () => { void load(); }; return;
  }
  try {
    const next = await api("/api/dashboard") as unknown as Snapshot;
    if (version !== loadVersion) return;
    snapshot = next;
    render();
  } catch (error) {
    if (version !== loadVersion) return;
    if (snapshot) { render(); showError(`刷新失败，仍展示上一批数据：${(error as Error).message}`); return; }
    shell(`<div class="empty"><span class="seal">登录成功</span><h1>${(error as { status?: number }).status === 404 ? "等待第一批投资数据" : "数据暂时无法读取"}</h1><p>${e((error as Error).message)}</p><p>完成本地数据校验与同步后，持仓、风控和报告将显示在这里。</p></div>`);
  }
}

async function checkSession() {
  if (checkingSession || !snapshot) return;
  checkingSession = true;
  try { await api("/api/me"); }
  catch (error) {
    if (snapshot) showError(`会话检查暂时失败，请稍后重试：${(error as Error).message}`);
  } finally { checkingSession = false; }
}

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
window.addEventListener("focus", () => { void checkSession(); });
window.addEventListener("pageshow", () => { void checkSession(); });
setInterval(() => { void checkSession(); }, 30_000);
void load();
