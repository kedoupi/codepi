<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./api";

  type Category = "AI 编程" | "AI 对话" | "工作沟通" | "会议" | "文档" | "浏览" | "私人" | "其他";
  type CategoryValue = { minutes: number; share: number; delta_minutes: number | null; delta_share: number | null };
  type AppValue = { name: string; category: Category; minutes: number; share: number };
  type FocusSegment = { startMinute: number; endMinute: number; minutes: number; primaryCategory: Category; interruptedAt: number[] };
  type HeatmapHour = { hour: string; minutes: number | null };
  type HeatmapRow = { day: string; hours: HeatmapHour[] };
  type WorkPayload = {
    date: string; range: "day" | "week"; from: string; to: string; missing: boolean;
    office_minutes: number | null;
    meeting_minutes: number | null;
    work_minutes: number | null;
    work_delta_minutes: number | null;
    meeting_delta_minutes: number | null;
    meeting_sessions: number | null;
    meeting_share: number | null;
    meeting_categories: Record<Category, number> | null;
    days: Array<{ date: string; office_minutes: number | null; meeting_minutes: number | null; work_minutes: number | null; work_delta_minutes: number | null; meeting_delta_minutes: number | null; meeting_sessions: number | null }>;
    focus_availability: { longest_minutes: number; morning: { longest_minutes: number; has_90_minutes: boolean }; afternoon: { longest_minutes: number; has_90_minutes: boolean } } | null;
    categories: Record<Category, CategoryValue> | null;
    away: { minutes: number | null; share: number | null; delta_minutes: number | null; delta_share: number | null };
    top_apps: AppValue[] | null;
    focus: { total_minutes: number | null; longest_minutes: number | null; segment_count: number | null; segments: FocusSegment[] | null; communication_interruptions: number | null };
    heatmap: { from: string; to: string; days_available: number; hours: HeatmapHour[]; days?: HeatmapRow[] };
    hourly: Array<{ hour: string; active_minutes: number | null; switch_count: number | null; above_average: boolean }> | null;
    communication_interruptions: number | null;
  };

  const categories: Category[] = ["AI 编程", "AI 对话", "工作沟通", "会议", "文档", "浏览", "私人", "其他"];
  const categoryColors: Record<Category, string> = {
    "AI 编程": "development", "AI 对话": "ai-chat", "工作沟通": "communication", 会议: "meeting",
    文档: "document", 浏览: "browser", 私人: "private", 其他: "app-other",
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  let date = $state(new URLSearchParams(location.search).get("date") ?? today);
  let range = $state<"day" | "week">(new URLSearchParams(location.search).get("range") === "week" ? "week" : "day");
  let work = $state<WorkPayload | null>(null);
  let message = $state("");
  let loading = $state(true);
  let requestId = 0;

  function duration(minutes: number | null | undefined, compact = false): string {
    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "暂无数据";
    const rounded = Math.round(minutes);
    const hours = Math.floor(rounded / 60);
    const rest = rounded % 60;
    if (compact) return hours ? `${hours}h${rest ? `${rest}m` : ""}` : `${rest}m`;
    return hours ? `${hours} 小时 ${rest} 分钟` : `${rest} 分钟`;
  }

  function clock(minute: number): string {
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }

  function delta(minutes: number | null): string {
    if (minutes === null) return "暂无数据";
    if (minutes === 0) return "与上周相同";
    return `比上周 ${minutes > 0 ? "+" : "−"}${duration(Math.abs(minutes))}`;
  }
  function compactDelta(minutes: number | null): string {
    if (minutes === null) return "暂无数据";
    return minutes === 0 ? "持平" : `${minutes > 0 ? "+" : "−"}${duration(Math.abs(minutes), true)}`;
  }

  function availabilityText(period: { longest_minutes: number; has_90_minutes: boolean }): string {
    return period.has_90_minutes ? "有 ≥90 分钟整块" : `没有 ≥90 分钟整块 · 最长 ${duration(period.longest_minutes)}`;
  }

  function dateLabel(value: WorkPayload): string {
    return value.range === "week" ? `${value.from} 至 ${value.to}` : value.date;
  }

  async function load() {
    const current = ++requestId;
    loading = true;
    message = "";
    try {
      const result = await api<WorkPayload>(`/api/work?date=${encodeURIComponent(date)}&range=${range}`);
      if (current === requestId) work = result;
    } catch (error) {
      if (current !== requestId) return;
      work = null;
      message = (error as Error).message;
    } finally {
      if (current === requestId) loading = false;
    }
  }

  function switchRange(next: "day" | "week") {
    if (next === range) return;
    range = next;
    history.replaceState(null, "", `/work?range=${next}${date === today ? "" : `&date=${encodeURIComponent(date)}`}`);
    void load();
  }


  const categoryItems = $derived(work?.categories ? categories.map(category => ({ category, ...work!.categories![category] })) : []);
  const topAppsMax = $derived(Math.max(1, ...(work?.top_apps ?? []).map(app => app.minutes)));
  const heatRows = $derived(work?.heatmap?.days?.length ? work.heatmap.days : work?.heatmap ? [{ day: "工作日平均", hours: work.heatmap.hours }] : []);
  const heatmapHasValue = $derived(heatRows.some(row => row.hours.some(cell => cell.minutes !== null)));
  const maxSwitches = $derived(Math.max(1, ...(work?.hourly ?? []).map(item => item.switch_count ?? 0)));

  onMount(() => { void load(); });
</script>

<section class="work-page">
  <header class="work-heading">
    <div>
      <p class="eyebrow">工作 / WORK</p>
      <h1>工作</h1>
      <p class="muted">{work ? `${dateLabel(work)} · 工作时长 = 在工位 + 开会` : "按天查看工作时间、专注和被打断情况。"}</p>
    </div>
    <div class="segmented" role="group" aria-label="范围">
      <button aria-pressed={range === "day"} onclick={() => switchRange("day")}>今天</button>
      <button aria-pressed={range === "week"} onclick={() => switchRange("week")}>本周</button>
    </div>
  </header>

  {#if message}
    <div class="notice error" role="alert"><strong>数据暂不可用</strong><span>{message}</span><button onclick={load}>重试</button></div>
  {:else if loading && !work}
    <div class="empty" role="status">正在读取工作数据…</div>
  {/if}

  {#if work}
    <section class="panel work-time-panel">
      <div class="section-heading"><div><h2>工作时间花在哪</h2><p class="muted">在工位与开会合计；离座单独列出</p></div><strong class="work-total">工作时长 {duration(work.work_minutes)}</strong></div>
      <div class="metric-grid compact"><article class="metric-card"><span>在工位</span><strong>{duration(work.office_minutes)}</strong></article><article class="metric-card"><span>开会</span><strong>{duration(work.meeting_minutes)}</strong><small>{delta(work.meeting_delta_minutes)} · {work.meeting_sessions === null ? "暂无场次数据" : `${work.meeting_sessions} 场`} · {work.meeting_share === null ? "暂无比例" : `${Math.round(work.meeting_share * 100)}%`}</small></article></div>
      <p class="fine muted">工作时长较上周：{delta(work.work_delta_minutes)}</p>
      {#if work.range === "week"}<div class="work-week-days" aria-label="本周每天工作时长">{#each work.days as item}<div><span>{item.date.slice(5)}</span><strong>{duration(item.work_minutes, true)}</strong><small>工作较上周 {compactDelta(item.work_delta_minutes)}</small><small>开会 {duration(item.meeting_minutes, true)} · 较上周 {compactDelta(item.meeting_delta_minutes)}</small></div>{/each}</div>{/if}
      {#if work.categories}
        <div class="work-category-bar" role="img" aria-label="时间去向">{#each categoryItems as item}<span data-category={item.category} style={`flex:${Math.max(item.minutes, 0)} 1 0`}></span>{/each}<span data-category="开会" style={`flex:${Math.max(work.meeting_minutes ?? 0, 0)} 1 0`}></span><span data-category="离座" style={`flex:${Math.max(work.away.minutes ?? 0, 0)} 1 0`}></span></div>
        <div class="work-category-grid">
          {#each categoryItems as item}
            <div class="work-category-row"><span class="work-color" data-color={categoryColors[item.category]}></span><div><strong>{item.category}</strong><span>{duration(item.minutes)} · {Math.round(item.share * 100)}%</span><small>{delta(item.delta_minutes)}</small></div></div>
          {/each}
          <div class="work-category-row"><span class="work-color" data-color="meeting-status"></span><div><strong>开会</strong><span>{duration(work.meeting_minutes)} · {work.meeting_share === null ? "暂无数据" : `${Math.round(work.meeting_share * 100)}%`}</span><small>{delta(work.meeting_delta_minutes)}</small></div></div>
          <div class="work-category-row"><span class="work-color" data-color="away"></span><div><strong>离座</strong><span>{duration(work.away.minutes)} · {work.away.share === null ? "暂无数据" : `${Math.round(work.away.share * 100)}%`}</span><small>{delta(work.away.delta_minutes)}</small></div></div>
        </div>
      {:else}
        <p class="empty-small">暂无数据</p>
      {/if}
      <div class="top-apps"><h3>用得最多的 App</h3>{#if work.top_apps?.length}{#each work.top_apps as app}<div class="top-app-row"><strong title={app.name}>{app.name}</strong><span class="top-app-track"><i data-category={app.category} style={`width:${app.minutes / topAppsMax * 100}%`}></i></span><span>{duration(app.minutes, true)}</span></div>{/each}{:else}<p class="empty-small">暂无数据</p>{/if}</div>
    </section>

    <div class="work-two-column">
      <section class="panel focus-panel">
        <div class="section-heading"><div><h2>专注</h2><p class="muted">连续至少 25 分钟在电脑前，且没有切到沟通或私人 App。</p></div></div>
        <div class="metric-grid compact"><article class="metric-card"><span>专注总时长</span><strong>{duration(work.focus.total_minutes, true)}</strong></article><article class="metric-card"><span>最长一段</span><strong>{duration(work.focus.longest_minutes, true)}</strong></article><article class="metric-card"><span>{range === "week" ? "每天平均段数" : "段数"}</span><strong>{work.focus.segment_count === null ? "暂无数据" : range === "week" ? work.focus.segment_count.toFixed(1) : work.focus.segment_count}</strong></article></div>
        {#if work.focus_availability}<div class="metric-grid compact"><article class="metric-card"><span>最长连续在工位</span><strong>{duration(work.focus_availability.longest_minutes)}</strong></article><article class="metric-card"><span>上午可用度</span><strong>{work.focus_availability.morning.has_90_minutes ? "可用" : "不足 90 分钟"}</strong><small>{availabilityText(work.focus_availability.morning)}</small></article><article class="metric-card"><span>下午可用度</span><strong>{work.focus_availability.afternoon.has_90_minutes ? "可用" : "不足 90 分钟"}</strong><small>{availabilityText(work.focus_availability.afternoon)}</small></article></div>{:else}<p class="empty-small">专注可用度暂无数据</p>{/if}
        {#if work.focus.segments?.length}
          <div class="focus-desktop-timeline" role="img" aria-label="08:00 到 20:00 专注时间线"><div class="focus-track">{#each work.focus.segments as segment}<span class:focus-interrupted={segment.interruptedAt.length > 0} style={`left:${Math.max(0, (segment.startMinute - 480) / 720 * 100)}%;width:${Math.max(0, (segment.endMinute - segment.startMinute) / 720 * 100)}%`} title={`${clock(segment.startMinute)}–${clock(segment.endMinute)} ${duration(segment.minutes)}`}></span>{/each}</div><div class="focus-axis"><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span><span>16:00</span><span>18:00</span><span>20:00</span></div></div>
          <div class="focus-mobile-list">{#each work.focus.segments as segment}<div class="focus-segment"><i class:focus-interrupted={segment.interruptedAt.length > 0}></i><div><strong>{clock(segment.startMinute)}–{clock(segment.endMinute)}</strong><small>{segment.primaryCategory}{segment.interruptedAt.length ? " · 有沟通打断" : ""}</small></div><span>{duration(segment.minutes)}</span></div>{/each}</div>
        {:else}<p class="empty-small">暂无数据</p>{/if}
      </section>

      <section class="panel heatmap-panel">
        <div class="section-heading"><div><h2>哪些钟头最出活</h2><p class="muted">近 4 周工作日平均 · 08:00–19:00 在电脑前分钟</p></div></div>
        {#if heatRows.length && heatmapHasValue}
          <div class="work-heatmap" role="img" aria-label="周一至周五按小时在电脑前分钟"><div class="heatmap-grid heatmap-head"><span></span>{#each heatRows[0].hours as cell}<span>{cell.hour}</span>{/each}</div>{#each heatRows as row}<div class="heatmap-grid"><strong>{row.day}</strong>{#each row.hours as cell}<span class:heat-unknown={cell.minutes === null} class:heat-high={cell.minutes !== null && cell.minutes >= 45} class:heat-medium={cell.minutes !== null && cell.minutes >= 30} style={cell.minutes === null ? undefined : `--heat:${Math.min(1, cell.minutes / 60)}`} title={cell.minutes === null ? "暂无数据" : `${row.day} ${cell.hour}:00：${Math.round(cell.minutes)} 分钟`}>{cell.minutes === null ? "" : Math.round(cell.minutes)}</span>{/each}</div>{/each}</div>
          <div class="heatmap-mobile-list">{#each work.heatmap.hours as cell}<div class="hour-bar-row"><span>{cell.hour}:00</span><i><b class:heat-unknown={cell.minutes === null} style={cell.minutes === null ? undefined : `width:${Math.min(100, (cell.minutes ?? 0) / 60 * 100)}%`}></b></i><strong>{cell.minutes === null ? "暂无数据" : `${Math.round(cell.minutes)} 分`}</strong></div>{/each}</div>
        {:else}<p class="empty-small">暂无数据</p>{/if}
      </section>
    </div>

    <section class="panel interruptions-panel"><div class="section-heading"><div><h2>被打断</h2><p class="muted">橙色表示高于当天平均 1.5 倍。</p></div><strong>{work.communication_interruptions === null ? "暂无数据" : `${work.communication_interruptions.toFixed(range === "week" ? 1 : 0)} 次`}</strong></div>{#if work.hourly?.length}<div class="switch-chart" role="img" aria-label="每小时切换 App 次数">{#each work.hourly as item}<div class:above-average={item.above_average} class="switch-bar"><strong>{item.switch_count === null ? "暂无数据" : Math.round(item.switch_count)}</strong><i style={`height:${item.switch_count === null ? 0 : item.switch_count / maxSwitches * 96}px`}></i><span>{item.hour}</span></div>{/each}</div><p class="chart-conclusion">沟通打断专注 {work.communication_interruptions === null ? "暂无数据" : `${work.communication_interruptions.toFixed(range === "week" ? 1 : 0)} 次`}；偏多时段高于当天平均 1.5 倍。</p>{:else}<p class="empty-small">暂无数据</p>{/if}</section>
    <section class="panel work-method"><h2>口径</h2><p class="muted">工位与 App 只算公司网络、未锁屏且有键鼠操作的分钟；开会单独计入工作时长；离座 = 接电或电源未知、无键鼠且夹在公司工作状态之间。分钟采样，是近似值。</p></section>
  {/if}
</section>
