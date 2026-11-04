<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./api";
  import BarChart, { type BarItem } from "./BarChart.svelte";
  import MomentScatter from "./MomentScatter.svelte";
  import RhythmOverlay from "./RhythmOverlay.svelte";
  import {
    APP_CATEGORIES, GAP_REASONS, STATUS_GROUPS, TIER_LABELS,
    anomalyReasonText, average, categorySegments, clockText, completeDays, dayTypeText, deltaText, durationText,
    hourlyCategoryAverage, hoursText, shortDuration, isNumber, momentStats, percentText, shortDate, statusGroups, sumMaps, topApps,
    weekComparisonRows, weekdayText,
    type AnomaliesPayload, type QualityPayload, type Segment, type TrendDay, type TrendsPayload,
  } from "./trends";

  const initialRange = new URLSearchParams(location.search).get("range") === "30" ? 30 : 7;
  let range = $state<7 | 30>(initialRange);
  let tab = $state<"rhythm" | "work">("rhythm");
  let trends = $state<TrendsPayload | null>(null);
  let anomalies = $state<AnomaliesPayload | null>(null);
  let quality = $state<QualityPayload | null>(null);
  let message = $state("");
  let loading = $state(true);

  const sections = [
    { id: "status-hours", label: "各状态时长", group: "rhythm" },
    { id: "overlay", label: "作息叠图", group: "rhythm" },
    { id: "commute", label: "通勤与时刻", group: "rhythm" },
    { id: "apps", label: "在公司用电脑", group: "work" },
    { id: "pace", label: "工作节奏", group: "work" },
    { id: "home", label: "在家", group: "rhythm" },
    { id: "anomalies", label: "和平时不一样", group: "rhythm" },
    { id: "quality", label: "数据可信度", group: "rhythm" },
  ] as const;

  async function load() {
    loading = true;
    message = "";
    try {
      [trends, anomalies, quality] = await Promise.all([
        api<TrendsPayload>(`/api/trends?range=${range}`),
        api<AnomaliesPayload>(`/api/anomalies?range=${range}`),
        api<QualityPayload>(`/api/quality?range=${range}`),
      ]);
    } catch (error) {
      trends = null; anomalies = null; quality = null;
      message = (error as Error).message;
    } finally {
      loading = false;
    }
  }

  function switchRange(next: 7 | 30) {
    if (next === range) return;
    range = next;
    history.replaceState(null, "", next === 30 ? "/trend?range=30" : "/trend");
    void load();
  }

  onMount(() => { void load(); });

  const days = $derived(trends?.days ?? []);
  const complete = $derived(completeDays(days));
  const dayTitle = (day: TrendDay) => `${shortDate(day.date)} ${weekdayText(day.date)} · ${dayTypeText(day.dayType)}`;

  function dayItems(pick: (day: TrendDay) => Segment[] | null): BarItem[] {
    return days.map(day => ({
      key: day.date,
      label: shortDate(day.date),
      title: dayTitle(day),
      segments: day.metrics ? pick(day) : null,
      partial: day.partial,
    }));
  }

  function single(key: string, label: string, value: number | null | undefined): Segment[] | null {
    return isNumber(value) ? [{ key, label, value }] : null;
  }

  const statusItems = $derived.by(() => {
    const items = dayItems(day => statusGroups(day.metrics?.statusMinutes));
    const workday = statusGroups(trends?.averages.workday.statusMinutes);
    if (workday) items.push({ key: "workday-average", label: "工作日均", title: `工作日平均（${trends?.averages.workday.days ?? 0} 天）`, segments: workday, emphasis: true });
    return items;
  });
  const statusConclusion = $derived.by(() => {
    const workday = trends?.averages.workday;
    if (!workday || !workday.days) return "还没有已汇总的工作日，暂时算不出平均。";
    const groups = statusGroups(workday.statusMinutes) ?? [];
    const get = (key: string) => groups.find(group => group.key === key)?.value ?? null;
    return `工作日平均：在家 ${hoursText(get("home"))}，在电脑前 ${hoursText(get("office_active"))}，通勤 ${hoursText(get("commute"))}，未知 ${hoursText(get("unknown"))}。`;
  });

  const overlaySummary = $derived.by(() => {
    const leave = average(complete.map(day => day.metrics.leaveHomeMinute));
    const back = average(complete.map(day => day.metrics.arriveHomeMinute));
    const outDays = complete.filter(day => day.metrics.leaveHomeMinute !== null).length;
    return `${complete.length} 天里有 ${outDays} 天出门；平均 ${clockText(leave)} 离家、${clockText(back)} 到家。`;
  });

  const commuteItems = $derived(dayItems(day => single("commute", "上班通勤（上限）", day.metrics?.commuteToWorkMinutes)));
  const commuteHomeItems = $derived(dayItems(day => single("commute", "下班通勤（上限）", day.metrics?.commuteHomeMinutes)));
  const officeItems = $derived(dayItems(day => single("office_active", "在电脑前", day.metrics?.officeActiveMinutes)));
  const moments = $derived(momentStats(days));
  const commuteConclusion = $derived.by(() => {
    const to = average(complete.map(day => day.metrics.commuteToWorkMinutes));
    const home = average(complete.map(day => day.metrics.commuteHomeMinutes));
    return `上班通勤平均 ${durationText(to)}、下班通勤平均 ${durationText(home)}；都是上限，含到公司后还没开电脑、离开电脑后还没走的时间。`;
  });

  const appItems = $derived(dayItems(day => categorySegments(day.metrics?.appCategoryMinutes)));
  const hourly = $derived(hourlyCategoryAverage(days));
  const hourlyItems = $derived<BarItem[]>(hourly.map(hour => ({
    key: hour.hour, label: hour.hour, title: `${hour.hour}:00–${hour.hour}:59（${hour.days} 天平均）`,
    segments: hour.days ? hour.segments : null,
  })));
  const apps = $derived(topApps(days));
  const appConclusion = $derived.by(() => {
    const totals = APP_CATEGORIES.map(category => ({ category, minutes: complete.reduce((sum, day) => sum + (day.metrics.appCategoryMinutes[category] ?? 0), 0) }));
    const all = totals.reduce((sum, item) => sum + item.minutes, 0);
    if (!all) return "这段时间没有公司网络且有键鼠的采样。";
    const top = [...totals].sort((left, right) => right.minutes - left.minutes)[0];
    return `在公司用电脑的时间里，「${top.category}」最多，占 ${Math.round((top.minutes / all) * 100)}%。`;
  });

  const spanItems = $derived(dayItems(day => {
    const span = day.metrics?.officeSpanMinutes;
    const active = day.metrics?.officeActiveMinutes;
    if (!isNumber(span) && !isNumber(active)) return null;
    return [
      { key: "office_active", label: "在电脑前", value: active ?? 0 },
      { key: "office_away", label: "在公司但不在电脑前", value: Math.max(0, (span ?? 0) - (active ?? 0)) },
    ];
  }));
  const focusItems = $derived(dayItems(day => single("开发", "专注总时长", day.metrics?.focus.totalMinutes)));
  const focusAverage = $derived({
    segments: average(complete.map(day => day.metrics.focus.segmentCount)),
    total: average(complete.map(day => day.metrics.focus.totalMinutes)),
    longest: average(complete.map(day => day.metrics.focus.longestMinutes)),
    interruptions: average(complete.map(day => day.metrics.focus.communicationInterruptions)),
  });
  const overflowItems = $derived(dayItems(day => {
    const m = day.metrics;
    if (!m) return null;
    const value = m.dayType === "workday" ? m.afterWorkWorkMachineMinutes : m.weekendWorkMachineMinutes;
    return single(m.dayType === "workday" ? "commute" : "other_network", m.dayType === "workday" ? "在家用工作机" : "休息日用工作机", value);
  }));
  const overflowTotals = $derived({
    workday: complete.reduce((sum, day) => sum + (day.metrics.afterWorkWorkMachineMinutes ?? 0), 0),
    restday: complete.reduce((sum, day) => sum + (day.metrics.weekendWorkMachineMinutes ?? 0), 0),
    workdays: complete.filter(day => isNumber(day.metrics.afterWorkWorkMachineMinutes)).length,
    restdays: complete.filter(day => isNumber(day.metrics.weekendWorkMachineMinutes)).length,
  });

  const homeItems = $derived(dayItems(day => single("home", "在家", day.metrics?.homeMinutes)));
  const networks = $derived(sumMaps(complete.map(day => day.metrics.otherNetworkMinutes)));
  const sleepKnown = $derived(complete.some(day => day.metrics.wakeMinute !== null || day.metrics.returnBedroomMinute !== null));

  const qualityItems = $derived<BarItem[]>((quality?.days ?? []).map(day => ({
    key: day.date, label: shortDate(day.date), title: `${shortDate(day.date)} ${weekdayText(day.date)} · ${TIER_LABELS[day.tier]}`,
    segments: isNumber(day.coverage) ? [
      { key: `tier-${day.tier}`, label: "有数据", value: day.coverage * 100 },
      { key: "unknown", label: "缺口", value: 100 - day.coverage * 100 },
    ] : null,
  })));
  const gapTotals = $derived(sumMaps((quality?.days ?? []).map(day => day.gapReasonMinutes)));
  const tierCounts = $derived((["high", "medium", "low", "unknown"] as const).map(tier => ({ tier, count: (quality?.days ?? []).filter(day => day.tier === tier).length })));
</script>

<section class="page-heading">
  <div>
    <p class="eyebrow">趋势 / TREND</p>
    <h1>趋势</h1>
    <p class="muted">{trends ? `${trends.from} 至 ${trends.to}，实际有汇总 ${trends.days_available} 天` : "按天汇总，到昨天为止；今天还没过完，不进平均。"}</p>
  </div>
  <div class="segmented" role="group" aria-label="时间范围">
    <button aria-pressed={range === 7} onclick={() => switchRange(7)}>近 7 天</button>
    <button aria-pressed={range === 30} onclick={() => switchRange(30)}>近 30 天</button>
  </div>
</section>

{#if message}
  <div class="notice error" role="alert"><strong>数据暂不可用</strong><span>{message}</span><button onclick={load}>重试</button></div>
{:else if loading && !trends}
  <div class="empty" role="status">正在读取趋势…</div>
{/if}

{#if trends && anomalies && quality}
  {#if trends.days_available < range}
    <div class="notice"><strong>不足 {range} 天</strong><span>这段时间只有 {trends.days_available} 天有汇总，下面的平均和比较都按实际天数算；没汇总的日子画成斜纹「未知」。</span></div>
  {/if}

  <nav class="anchor-nav" aria-label="趋势模块">{#each sections as section}<a href={`#${section.id}`}>{section.label}</a>{/each}</nav>
  <div class="tabs" role="tablist" aria-label="趋势分组">
    <button role="tab" aria-selected={tab === "rhythm"} onclick={() => (tab = "rhythm")}>作息</button>
    <button role="tab" aria-selected={tab === "work"} onclick={() => (tab = "work")}>工作</button>
  </div>

  <div class="trend-sections" data-tab={tab}>

    <section class="panel" id="status-hours" data-group="rhythm">
      <div class="section-heading"><div><h2>每天各状态各占几小时</h2><p class="muted">每根柱子合计 24 小时，斜纹是未知；最右是工作日平均。</p></div></div>
      <BarChart items={statusItems} max={1440} fullUnknown format={hoursText} label="每天各状态时长堆叠柱" />
      <div class="timeline-legend">{#each STATUS_GROUPS as group}<span><i class:unknown={group.key === "unknown"} data-status={group.key}></i>{group.label}</span>{/each}</div>
      <p class="chart-conclusion">{statusConclusion}</p>
    </section>

    <section class="panel week-panel" data-group="rhythm">
      <div class="section-heading"><div><h2>本周和上周</h2><p class="muted">本周 {trends.week_comparison.current_from} 起（{trends.week_comparison.current.days} 天） vs 上周同期（{trends.week_comparison.previous.days} 天），按日平均。</p></div></div>
      <div class="table-scroll">
        <table class="compare-table">
          <thead><tr><th scope="col">指标</th><th scope="col">本周</th><th scope="col">上周</th><th scope="col">变化</th></tr></thead>
          <tbody>
            {#each weekComparisonRows(trends.week_comparison) as row}
              <tr><th scope="row">{row.label}</th><td>{row.kind === "count" ? (isNumber(row.current) ? row.current.toFixed(1) : "未知") : shortDuration(row.current)}</td><td>{row.kind === "count" ? (isNumber(row.previous) ? row.previous.toFixed(1) : "未知") : shortDuration(row.previous)}</td><td>{deltaText(row.delta, row.kind)}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel" id="overlay" data-group="rhythm">
      <div class="section-heading"><div><h2>作息叠图</h2><p class="muted desktop-only">每天一条：橙色是离家到到家，绿色是开始办公到离开电脑，浅蓝是全天没出门。</p><p class="muted mobile-only">手机上只显示文字摘要，完整叠图请在电脑上看。</p></div></div>
      <div class="desktop-only"><RhythmOverlay {days} /></div>
      <p class="chart-conclusion">{overlaySummary}</p>
    </section>

    <section class="panel" id="commute" data-group="rhythm">
      <div class="section-heading"><div><h2>通勤、几点、在电脑前</h2><p class="muted">通勤是推断出的上限；时刻按已过完的日子统计。</p></div></div>
      <div class="chart-grid">
        <div><h3>上班通勤（上限）</h3><BarChart items={commuteItems} format={durationText} label="每天上班通勤" /></div>
        <div><h3>下班通勤（上限）</h3><BarChart items={commuteHomeItems} format={durationText} label="每天下班通勤" /></div>
      </div>
      <h3>每天几点</h3>
      <div class="moment-ranges">
        {#each moments as moment}
          <div class="moment-range" aria-label={`${moment.label}：最早 ${clockText(moment.min)}，最晚 ${clockText(moment.max)}，平均 ${clockText(moment.avg)}，${moment.days} 天`}>
            <span>{moment.label}</span>
            <svg width="100%" height="16" aria-hidden="true">
              <rect class="track" x="0" y="6" width="100%" height="4" rx="2"></rect>
              {#if moment.min !== null && moment.max !== null && moment.avg !== null}
                <rect class="range" x={`${(moment.min / 1440) * 100}%`} y="4" width={`${Math.max(0.5, ((moment.max - moment.min) / 1440) * 100)}%`} height="8" rx="4"></rect>
                <circle class="avg" cx={`${(moment.avg / 1440) * 100}%`} cy="8" r="5"></circle>
              {/if}
            </svg>
            <strong>{moment.days ? `${clockText(moment.min)}–${clockText(moment.max)} · 平均 ${clockText(moment.avg)}` : "未知"}</strong>
          </div>
        {/each}
      </div>
      <h3>在电脑前</h3>
      <BarChart items={officeItems} format={durationText} label="每天在电脑前时长" reference={isNumber(trends.averages.workday.officeActiveMinutes) ? { value: trends.averages.workday.officeActiveMinutes, label: `工作日平均 ${durationText(trends.averages.workday.officeActiveMinutes)}` } : null} />
      <p class="chart-conclusion">{commuteConclusion}</p>
    </section>

    <section class="panel" id="apps" data-group="work">
      <div class="section-heading"><div><h2>在公司用电脑</h2><p class="muted">只算公司网络且有键鼠的分钟；未归类的 App 都算「其他」，可以在设置里归类。</p></div></div>
      <h3>每天 App 类别</h3>
      <BarChart items={appItems} format={durationText} label="每天 App 类别分钟" />
      <h3>一天里每小时用什么</h3>
      <BarChart items={hourlyItems} format={durationText} label="每小时 App 类别平均分钟" />
      <div class="timeline-legend">{#each APP_CATEGORIES as category}<span><i data-series={category}></i>{category}</span>{/each}</div>
      <h3>用得最多的 App</h3>
      {#if apps.length}
        <ol class="rank-list">{#each apps as app}<li><strong>{app.name}</strong><span>{app.days} 天第一 · 那几天合计 {durationText(app.minutes)}</span></li>{/each}</ol>
      {:else}<p class="empty-small">没有可统计的 App。</p>{/if}
      <p class="chart-conclusion">{appConclusion}</p>
    </section>

    <section class="panel" id="pace" data-group="work">
      <div class="section-heading"><div><h2>工作节奏</h2><p class="muted">在公司 = 当天公司网络第一次到最后一次操作；专注 = 连续 ≥25 分钟在电脑前且没切到「沟通」类 App。</p></div></div>
      <h3>在公司 vs 在电脑前</h3>
      <BarChart items={spanItems} format={durationText} label="每天在公司与在电脑前" />
      <div class="metric-grid compact">
        <article class="metric-card"><span>专注段数（日均）</span><strong>{isNumber(focusAverage.segments) ? focusAverage.segments.toFixed(1) : "未知"}</strong></article>
        <article class="metric-card"><span>专注总时长（日均）</span><strong>{durationText(focusAverage.total)}</strong></article>
        <article class="metric-card"><span>最长一段（日均）</span><strong>{durationText(focusAverage.longest)}</strong></article>
        <article class="metric-card"><span>被沟通打断（日均）</span><strong>{isNumber(focusAverage.interruptions) ? focusAverage.interruptions.toFixed(1) : "未知"}</strong></article>
      </div>
      <h3>每天专注总时长</h3>
      <BarChart items={focusItems} format={durationText} label="每天专注总时长" />
      <h3>在家与休息日仍用工作机</h3>
      <BarChart items={overflowItems} format={durationText} label="在家或休息日用工作机分钟" />
      <p class="chart-conclusion">工作日在家用工作机合计 {durationText(overflowTotals.workday)}（{overflowTotals.workdays} 天，含上班前在家用的时间），休息日合计 {durationText(overflowTotals.restday)}（{overflowTotals.restdays} 天）。家里暂不区分房间。</p>
    </section>

    <section class="panel" id="home" data-group="rhythm">
      <div class="section-heading"><div><h2>在家</h2><p class="muted">家里只有一台路由器（两个频段），暂不区分卧室和客厅，只显示「在家」。</p></div></div>
      <h3>起床与回卧室</h3>
      {#if sleepKnown}
        <MomentScatter {days} label="每天起床与回卧室时刻" series={[{ field: "wakeMinute", label: "起床", shape: "circle" }, { field: "returnBedroomMinute", label: "回卧室", shape: "square" }]} />
        <p class="fine muted">圆点是起床，方块是回卧室；实心是工作日，空心是休息日。</p>
      {:else}
        <p class="empty-small">起床和回卧室要靠区分房间判断，现在不区分，这两项都是未知。</p>
      {/if}
      <h3>每天在家多久</h3>
      <BarChart items={homeItems} format={durationText} label="每天在家时长" />
      <h3>去过的其他网络</h3>
      {#if networks.length}
        <ol class="rank-list">{#each networks as network}<li><strong>{network.name}</strong><span>{durationText(network.minutes)}</span></li>{/each}</ol>
      {:else}<p class="empty-small">这段时间工作机没有连过家和公司以外的网络。</p>{/if}
      <p class="chart-conclusion">在家日均 {durationText(average(complete.map(day => day.metrics.homeMinutes)))}；网络名可以在设置里改成好认的名字。</p>
    </section>

    <section class="panel" id="anomalies" data-group="rhythm">
      <div class="section-heading"><div><h2>和平时不一样的日子</h2><p class="muted">{anomalies.baseline}</p></div></div>
      {#if anomalies.anomalies.length}
        <ul class="anomaly-list">
          {#each anomalies.anomalies as item}
            <li><div><strong>{shortDate(item.date)} {weekdayText(item.date)}</strong><span class="badge">{dayTypeText(item.dayType)} · 对比 {item.sampleDays} 天</span></div>{#each item.reasons as reason}<p>{anomalyReasonText(reason)}</p>{/each}</li>
          {/each}
        </ul>
      {:else}<p class="empty-small">这段时间没有明显和平时不一样的日子。</p>{/if}
      {#if anomalies.insufficient_sample.length}
        <p class="fine muted">另有 {anomalies.insufficient_sample.length} 天同类日样本不足 5 天，没有判断：{anomalies.insufficient_sample.map(item => shortDate(item.date)).join("、")}。</p>
      {/if}
      <p class="chart-conclusion">共 {anomalies.anomalies.length} 天和平时不一样；阈值可以在设置里调。</p>
    </section>

    <section class="panel" id="quality" data-group="rhythm">
      <div class="section-heading"><div><h2>数据可信度</h2><p class="muted">每天有数据的分钟占比；缺口按原因拆开。</p></div></div>
      <BarChart items={qualityItems} max={100} fullUnknown format={value => `${value.toFixed(1)}%`} label="每天数据覆盖率" />
      <div class="timeline-legend">{#each tierCounts as item}<span><i class:unknown={item.tier === "unknown"} data-series={`tier-${item.tier}`}></i>{TIER_LABELS[item.tier]} {item.count} 天</span>{/each}</div>
      {#if gapTotals.length}
        <ul class="rank-list">{#each gapTotals as gap}<li><strong>{GAP_REASONS[gap.name] ?? gap.name}</strong><span>{durationText(gap.minutes)}</span></li>{/each}</ul>
      {/if}
      <p class="chart-conclusion">平均覆盖率 {percentText(average((quality.days ?? []).map(day => day.coverage)))}；没有汇总的日子不算进平均。</p>
    </section>
  </div>
{/if}
