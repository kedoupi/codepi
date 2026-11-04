<script lang="ts">
  import { onMount } from "svelte";
  import { CODEPI_SYMBOL_PNG, PRODUCT_BRAND } from "@kedoupi/shared/brand";
  import { api, dateText, displayShanghaiTime } from "./lib/api";
  import Settings from "./lib/Settings.svelte";
  import Trends from "./lib/Trends.svelte";
  import type { DayStatus, Evidence, RhythmStatus } from "../../worker/models";

  type Segment = {
    status: DayStatus; label: string; evidence: Evidence; detail: string;
    startMinute: number; endMinute: number; startLabel: string; endLabel: string; minutes: number;
  };
  type DayPayload = {
    date: string; generatedAt: string; phoneConfigured: boolean; current: {
      status: DayStatus; label: string; evidence: Evidence; minute: number; time: string; live: boolean;
    } | null;
    segments: Segment[];
    moments: Array<{ kind: string; label: string; detail: string; evidence: Evidence; minute: number; time: string }>;
    metrics: {
      commuteToWorkMinutes: number | null; commuteHomeMinutes: number | null; officeActiveMinutes: number | null; homeMinutes: number | null;
      bedroomMinutes: number | null; livingRoomMinutes: number | null; homeUnknownMinutes: number | null;
    };
    appBreakdown: Array<{ category: string; minutes: number; share: number; apps: Array<{ name: string; minutes: number }> }>;
    keyboardMouseMinutes: { keyboard: number | null; pointer: number | null; both: number | null };
    freshness: { home: Freshness; work: Freshness };
  };
  type Freshness = { latestAt: string | null; ageMinutes: number | null; status: "fresh" | "stale" | "missing" | "time_anomaly" };
  type SourcesPayload = {
    generatedAt: string;
    sources: { home: SourceInfo; work: SourceInfo };
    states: Array<{ status: RhythmStatus; label: string; method: string; evidence: Evidence }>;
    caveats: string[]; collection: string[];
    settings: { subjectDeviceCount: number; appCategoryCount: number };
  };
  type SourceInfo = Freshness & { name: string; method: string };

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  let auth = $state<"loading" | "ready" | "anonymous" | "error">("loading");
  let message = $state("");
  let day = $state<DayPayload | null>(null);
  let sources = $state<SourcesPayload | null>(null);
  let date = $state(new URLSearchParams(location.search).get("date") ?? today);
  let selectedSegment = $state<Segment | null>(null);
  const page = location.pathname === "/login" ? "/login" : location.pathname;
  const nav = [["/", "今天"], ["/trend", "趋势"], ["/sources", "来源"], ["/settings", "设置"]];
  const timelineLegend: Array<{ status: DayStatus; label: string }> = [
    { status: "bedroom", label: "卧室" },
    { status: "living_room", label: "客厅" },
    { status: "home", label: "在家" },
    { status: "office_active", label: "公司 · 在电脑前" },
    { status: "office_away", label: "公司 · 离座" },
    { status: "commute", label: "通勤" },
    { status: "other_network", label: "其他网络" },
    { status: "unknown", label: "未知" },
    { status: "not_arrived", label: "未到" },
  ];

  function safeDate(value: string): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today ? value : today;
  }

  function shiftDate(delta: number) {
    const parsed = new Date(`${date}T00:00:00+08:00`);
    parsed.setUTCDate(parsed.getUTCDate() + delta);
    const next = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(parsed);
    if (next > today) return;
    date = next;
    history.replaceState(null, "", `/?date=${encodeURIComponent(date)}`);
    void loadDay();
  }

  async function loadDay() {
    message = "";
    try { selectedSegment = null; day = await api<DayPayload>(`/api/day?date=${encodeURIComponent(safeDate(date))}`); }
    catch (error) { day = null; message = (error as Error).message; }
  }

  async function loadSources() {
    message = "";
    try { sources = await api<SourcesPayload>("/api/sources"); }
    catch (error) { sources = null; message = (error as Error).message; }
  }

  async function load() {
    message = "";
    try {
      await api("/api/me");
      auth = "ready";
      if (page === "/sources") await loadSources();
      else if (page !== "/trend" && page !== "/settings") await loadDay();
    } catch (error) {
      if (auth !== "anonymous") auth = "error";
      message = (error as Error).message;
    }
  }

  function evidenceLabel(value: Evidence) {
    return value === "seen" ? "看到" : value === "inferred" ? "推断" : value === "not_arrived" ? "未到" : "无数据";
  }

  function freshnessLabel(value: Freshness) {
    if (value.status === "fresh") return `新鲜 · ${value.ageMinutes ?? 0} 分钟前`;
    if (value.status === "stale") {
      const age = value.ageMinutes === null ? "未知" : value.ageMinutes > 24 * 60 ? `${Math.floor(value.ageMinutes / (24 * 60))} 天` : `${value.ageMinutes} 分钟`;
      return `过期 · ${age}前`;
    }
    if (value.status === "time_anomaly") return "时间异常";
    return "没有新鲜数据";
  }

  function metricText(minutes: number | null, unknownLabel = "未知") {
    if (minutes === null) return unknownLabel;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours} 小时 ${rest} 分钟` : `${rest} 分钟`;
  }

  function countText(value: number | null) {
    return value === null ? "未知" : String(value);
  }

  onMount(() => {
    const expired = () => { auth = "anonymous"; day = null; sources = null; };
    window.addEventListener("rhythm:unauthorized", expired);
    if (page === "/login") auth = "anonymous";
    else void load();
    return () => window.removeEventListener("rhythm:unauthorized", expired);
  });
</script>

{#if auth === "anonymous"}
  <main class="login">
    <section class="login-story">
      <a class="brand" href="https://codepi.app"><img class="brand-mark" src={CODEPI_SYMBOL_PNG} alt="" aria-hidden="true" width="348" height="316" decoding="async" /><span>{PRODUCT_BRAND}</span></a>
      <div><p class="eyebrow">RHYTHM / 作息</p><h1>看清自己一天的<br />作息与工作节奏。</h1><p>把家中设备与工作机的只读信号，整理成一条可以回看的时间线。</p></div>
      <p class="muted">仅本人访问 · 私人作息分析</p>
    </section>
    <section class="login-panel">
      <div><span class="badge">统一登录</span><h2>进入 Rhythm</h2><p>使用 {PRODUCT_BRAND} 账户登录。</p>
        {#if new URLSearchParams(location.search).has("auth_error")}<p class="error-text" role="alert">登录未完成，请重新登录；服务不可用时可稍后重试。</p>{/if}
        <a class="button primary" href="/api/auth/login?return=%2F">统一登录</a>
        <p class="muted fine">登录状态最多保留 7 天。退出将同步退出其他应用。</p>
      </div>
    </section>
  </main>
{:else}
  <a class="skip-link" href="#content">跳到内容</a>
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/"><img class="brand-mark" src={CODEPI_SYMBOL_PNG} alt="" aria-hidden="true" width="348" height="316" decoding="async" /><span>kedoupi<small>codepi · Rhythm</small></span></a>
      <nav aria-label="主导航">{#each nav as [href, label]}<a {href} aria-current={page === href ? "page" : undefined}>{label}</a>{/each}</nav>
      <div class="sidebar-foot"><p>设备在线不等于人在。</p><a href="/sources">查看来源与口径</a></div>
    </aside>
    <div class="main">
      <header class="topbar"><span>Rhythm <span class="muted">/ 作息</span></span><form method="post" action="/api/auth/logout"><button>退出</button></form></header>
      <main id="content" tabindex="-1">
        {#if message}<div class="notice error" role="alert"><strong>数据暂不可用</strong><span>{message}</span><button onclick={load}>重试</button></div>{/if}
        {#if auth === "loading"}<div class="empty" role="status">正在读取 Rhythm…</div>
        {:else if auth === "error"}<div class="empty"><h1>暂时无法读取</h1><p>数据会在连接恢复后重新加载。</p><button onclick={load}>重试</button></div>
        {:else if page === "/trend"}
          <Trends />
        {:else if page === "/settings"}
          <Settings />
        {:else if page === "/sources"}
          <section class="page-heading"><div><p class="eyebrow">来源 / SOURCES</p><h1>来源与口径</h1><p class="muted">两路只读信号，按北京时间解释。</p></div></section>
          {#if sources}
            <section class="source-grid">
              {#each Object.values(sources.sources) as source}<article class="panel source-card"><div><span class="source-dot"></span><h2>{source.name}</h2></div><strong>{freshnessLabel(source)}</strong><p>{source.method}</p>{#if source.latestAt}<small>最近：{displayShanghaiTime(source.latestAt)}</small>{/if}</article>{/each}
            </section>
            <section class="panel"><h2>每个状态怎么判断</h2><div class="method-list">{#each sources.states as item}<article><div><strong>{item.label}</strong><span class:inferred={item.evidence === "inferred"}>{evidenceLabel(item.evidence)}</span></div><p>{item.method}</p></article>{/each}</div></section>
            <section class="two-column"><article class="panel"><h2>口径</h2>{#each sources.caveats as item}<p class="source-line">{item}</p>{/each}</article><article class="panel"><h2>不采集</h2>{#each sources.collection as item}<p class="source-line">{item}</p>{/each}</article></section>
            <p class="fine muted">已指定手机：{sources.settings.subjectDeviceCount ? `${sources.settings.subjectDeviceCount} 台` : "未指定手机"} · App 分类：{sources.settings.appCategoryCount} 个</p>
          {:else if !message}<div class="empty" role="status">正在读取来源…</div>{/if}
        {:else}
          <section class="page-heading">
            <div><p class="eyebrow">今天 / {date}</p><h1>{dateText(date)}</h1><p class="muted">所有时间按 Asia/Shanghai 显示。</p></div>
            <div class="date-controls"><button aria-label="前一天" onclick={() => shiftDate(-1)}>← 前一天</button><button aria-label="后一天" onclick={() => shiftDate(1)} disabled={date >= today}>后一天 →</button></div>
          </section>
          {#if day}
            {#if !day.phoneConfigured}<div class="notice"><strong>未指定手机</strong><span>家里部分记为未知；到 <a href="/settings">设置</a> 里选择本人手机。</span></div>{/if}
            {#if day.current}<section class="current-card" data-status={day.current.status}><div><span class="eyebrow">当前状态 · {day.current.time}</span><h2>{day.current.label}</h2><span class:inferred={day.current.evidence === "inferred"} class="evidence">{evidenceLabel(day.current.evidence)}</span></div><p>{day.current.live ? "正在按最近一分钟的信号显示。" : "所选日期的最后一个可判断状态。"}</p></section>{/if}
            <section class="panel timeline-panel"><div class="section-heading"><div><h2>0–24 点时间线</h2><p class="muted">斜纹表示未知，颜色表示状态类别；段太窄时用点按或悬停查看明细。</p></div><span class="fine muted">{day.segments.length} 段</span></div><div class="timeline" aria-label="当天状态时间线">{#each day.segments as segment}<button class="timeline-segment" class:unknown={segment.status === "unknown"} data-status={segment.status} style={`--segment-minutes:${segment.minutes}`} onclick={() => (selectedSegment = segment)} aria-pressed={selectedSegment === segment} title={`${segment.startLabel}–${segment.endLabel} ${segment.label} · ${evidenceLabel(segment.evidence)}${segment.detail ? ` · ${segment.detail}` : ""}`} aria-label={`${segment.startLabel} 到 ${segment.endLabel}，${segment.label}，${evidenceLabel(segment.evidence)}`}><span>{segment.label}</span></button>{/each}</div><div class="timeline-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><div class="timeline-legend" aria-label="时间线图例">{#each timelineLegend as item}<span><i class:unknown={item.status === "unknown"} data-status={item.status}></i>{item.label}</span>{/each}</div>{#if selectedSegment}<p class="timeline-detail"><strong>{selectedSegment.startLabel}–{selectedSegment.endLabel} {selectedSegment.label}</strong><span class:inferred={selectedSegment.evidence === "inferred"}>{evidenceLabel(selectedSegment.evidence)}</span><span>{selectedSegment.minutes} 分钟</span>{#if selectedSegment.detail}<span>{selectedSegment.detail}</span>{/if}</p>{/if}<p class="chart-conclusion">今天的时间线把可观察信号与推断区间分开，缺少数据时保持未知。</p></section>
            <section class="metric-grid"><article class="metric-card"><span>上班通勤（上限）</span><strong>{metricText(day.metrics.commuteToWorkMinutes)}</strong><small>推断 · 含到公司后未开电脑的时间</small></article><article class="metric-card"><span>下班通勤（上限）</span><strong>{metricText(day.metrics.commuteHomeMinutes)}</strong><small>推断 · 含离开电脑后的时间</small></article><article class="metric-card"><span>在电脑前</span><strong>{metricText(day.metrics.officeActiveMinutes)}</strong><small>公司网络且有键鼠活动</small></article><article class="metric-card"><span>在家</span><strong>{metricText(day.metrics.homeMinutes)}</strong><small>卧室 {metricText(day.metrics.bedroomMinutes, !day.phoneConfigured ? "未知（未指定手机）" : "未知")} · 客厅 {metricText(day.metrics.livingRoomMinutes, !day.phoneConfigured ? "未知（未指定手机）" : "未知")} · 未分房间 {metricText(day.metrics.homeUnknownMinutes)}</small></article></section>
            <section class="two-column"><article class="panel"><div class="section-heading"><div><h2>关键时刻</h2><p class="muted">每条都标注看到或推断。</p></div></div>{#if day.moments.length}<ol class="moments">{#each day.moments as moment}<li><time>{moment.time}</time><div><strong>{moment.label}</strong><span class:inferred={moment.evidence === "inferred"}>{evidenceLabel(moment.evidence)}</span><p>{moment.detail}</p></div></li>{/each}</ol>{:else}<p class="empty-small">这一天没有足够新鲜数据形成关键时刻。</p>{/if}</article><article class="panel"><h2>数据新鲜度</h2><div class="freshness-row"><span>家中设备扫描</span><strong>{freshnessLabel(day.freshness.home)}</strong></div><div class="freshness-row"><span>工作机采样</span><strong>{freshnessLabel(day.freshness.work)}</strong></div><p class="chart-conclusion">新鲜度只说明最近收到过数据，不代表设备在线就一定是人在。</p></article></section>
            <section class="panel"><div class="section-heading"><div><h2>在电脑前做什么</h2><p class="muted">只算公司网络且有键鼠的分钟采样。</p></div><span class="fine">键盘 {countText(day.keyboardMouseMinutes.keyboard)} · 指针 {countText(day.keyboardMouseMinutes.pointer)} · 同时 {countText(day.keyboardMouseMinutes.both)}</span></div>{#if day.appBreakdown.length}<div class="bars">{#each day.appBreakdown as item}<div class="bar-row" title={`${item.category}：${item.minutes} 分钟，占 ${Math.round(item.share * 100)}%；${item.apps.map(app => `${app.name} ${app.minutes} 分钟`).join("、")}`} aria-label={`${item.category} ${item.minutes} 分钟，占 ${Math.round(item.share * 100)}%`}><div class="bar-label"><span>{item.category}</span><strong>{item.minutes} 分钟 · {Math.round(item.share * 100)}%</strong></div><div class="bar-track"><span data-category={item.category} style={`width:${item.share * 100}%`}></span></div><small>{item.apps.map(app => `${app.name} ${app.minutes} 分钟`).join(" · ")}</small></div>{/each}</div><p class="chart-conclusion">App 分类来自本地 settings；未归类的应用一律放在「其他」。</p>{:else}<p class="empty-small">没有公司网络且有键鼠的数据。</p>{/if}</section>
          {:else if !message}<div class="empty" role="status">正在读取当天数据…</div>{/if}
        {/if}
      </main>
      <footer>kedoupi（codepi） · 私人作息分析 · <a href="/sources">来源与口径</a></footer>
    </div>
  </div>
{/if}
