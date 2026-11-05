<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./api";
  import BarChart, { type BarItem } from "./BarChart.svelte";
  import RhythmOverlay from "./RhythmOverlay.svelte";
  import {
    GAP_REASONS, STATUS_GROUPS, TIER_LABELS,
    anomalyReasonText, average, clockText, completeDays, dayTypeText, deltaText, durationText,
    hoursText, isNumber, momentStats, percentText, shortDate, statusGroups, sumMaps,
    weekComparisonRows, weekdayText,
    type AnomaliesPayload, type QualityPayload, type Segment, type TrendDay, type TrendsPayload,
  } from "./trends";

  const initialRange = new URLSearchParams(location.search).get("range") === "30" ? 30 : 7;
  let range = $state<7 | 30>(initialRange);
  let mobileTab = $state<"status" | "commute" | "times" | "anomalies" | "quality">("status");
  let trends = $state<TrendsPayload | null>(null);
  let anomalies = $state<AnomaliesPayload | null>(null);
  let quality = $state<QualityPayload | null>(null);
  let message = $state("");
  let loading = $state(true);
  let requestId = 0;

  const sections = [
    { id: "status-hours", label: "各状态时长" }, { id: "overlay", label: "作息叠图" },
    { id: "commute", label: "通勤" }, { id: "times", label: "每天几点" },
    { id: "home", label: "在家" }, { id: "anomalies", label: "不一样的日子" }, { id: "quality", label: "可信度" },
  ] as const;
  const mobileTabs = [
    ["status", "各状态时长"], ["commute", "通勤"], ["times", "每天几点"],
    ["anomalies", "不一样的日子"], ["quality", "可信度"],
  ] as const;

  async function load() {
    const current = ++requestId;
    const wanted = range;
    loading = true;
    message = "";
    try {
      const result = await Promise.all([
        api<TrendsPayload>(`/api/trends?range=${wanted}`),
        api<AnomaliesPayload>(`/api/anomalies?range=${wanted}`),
        api<QualityPayload>(`/api/quality?range=${wanted}`),
      ]);
      if (current !== requestId) return;
      [trends, anomalies, quality] = result;
    } catch (error) {
      if (current !== requestId) return;
      trends = null; anomalies = null; quality = null; message = (error as Error).message;
    } finally {
      if (current === requestId) loading = false;
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
    return days.map(day => ({ key: day.date, label: shortDate(day.date), title: dayTitle(day), segments: day.metrics ? pick(day) : null, partial: day.partial }));
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
  const moments = $derived(momentStats(days));
  const commuteConclusion = $derived.by(() => {
    const to = average(complete.map(day => day.metrics.commuteToWorkMinutes));
    const home = average(complete.map(day => day.metrics.commuteHomeMinutes));
    return `上班通勤平均 ${durationText(to)}、下班通勤平均 ${durationText(home)}；都是上限，含到公司后还没开电脑、离开电脑后还没走的时间。`;
  });
  const homeItems = $derived(dayItems(day => single("home", "在家", day.metrics?.homeMinutes)));
  const networks = $derived(sumMaps(complete.map(day => day.metrics.otherNetworkMinutes)));
  const qualityItems = $derived<BarItem[]>((quality?.days ?? []).map(day => ({
    key: day.date, label: shortDate(day.date), title: `${shortDate(day.date)} ${weekdayText(day.date)} · ${TIER_LABELS[day.tier]}`,
    segments: isNumber(day.coverage) ? [{ key: `tier-${day.tier}`, label: "有数据", value: day.coverage * 100 }, { key: "unknown", label: "缺口", value: 100 - day.coverage * 100 }] : null,
  })));
  const gapTotals = $derived(sumMaps((quality?.days ?? []).map(day => day.gapReasonMinutes)));
  const tierCounts = $derived((['high', 'medium', 'low', 'unknown'] as const).map(tier => ({ tier, count: (quality?.days ?? []).filter(day => day.tier === tier).length })));
</script>

<section class="page-heading">
  <div><p class="eyebrow">趋势 / TREND</p><h1>趋势</h1><p class="muted">{trends ? `${trends.from} 至 ${trends.to}，实际有汇总 ${trends.days_available} 天` : "按天汇总，到昨天为止；今天还没过完，不进平均。"}</p></div>
  <div class="segmented" role="group" aria-label="时间范围"><button aria-pressed={range === 7} onclick={() => switchRange(7)}>近 7 天</button><button aria-pressed={range === 30} onclick={() => switchRange(30)}>近 30 天</button></div>
</section>
{#if message}<div class="notice error" role="alert"><strong>数据暂不可用</strong><span>{message}</span><button onclick={load}>重试</button></div>{:else if loading && !trends}<div class="empty" role="status">正在读取趋势…</div>{/if}
{#if trends && anomalies && quality}
  {#if trends.days_available < range}<div class="notice"><strong>不足 {range} 天</strong><span>这段时间只有 {trends.days_available} 天有汇总，下面的平均和比较都按实际天数算；没汇总的日子画成斜纹「未知」。</span></div>{/if}
  <nav class="anchor-nav" aria-label="趋势模块">{#each sections as section}<a href={`#${section.id}`}>{section.label}</a>{/each}</nav>
  <div class="mobile-trend-tabs" role="tablist" aria-label="趋势图表">{#each mobileTabs as [id, label]}<button role="tab" aria-selected={mobileTab === id} onclick={() => (mobileTab = id)}>{label}</button>{/each}</div>
  <div class="trend-sections" data-mobile-tab={mobileTab}>
    <section class="panel" id="status-hours" data-mobile-tab="status"><div class="section-heading"><div><h2>每天各状态各占几小时</h2><p class="muted">每根柱子合计 24 小时，斜纹是未知；最右是工作日平均。</p></div></div><BarChart items={statusItems} max={1440} fullUnknown format={hoursText} label="每天各状态时长堆叠柱" /><div class="timeline-legend">{#each STATUS_GROUPS as group}<span><i class:unknown={group.key === "unknown"} data-status={group.key}></i>{group.label}</span>{/each}</div><p class="chart-conclusion">{statusConclusion}</p></section>
    <section class="panel week-panel"><div class="section-heading"><div><h2>本周和上周（工作日平均）</h2><p class="muted">本周 {trends.week_comparison.current_from} 起（{trends.week_comparison.current.days} 天） vs 上周同期（{trends.week_comparison.previous.days} 天），按日平均。</p></div></div><div class="table-scroll"><table class="compare-table"><thead><tr><th scope="col">指标</th><th scope="col">本周</th><th scope="col">上周</th><th scope="col">变化</th></tr></thead><tbody>{#each weekComparisonRows(trends.week_comparison) as row}<tr><th scope="row">{row.label}</th><td>{row.kind === "count" ? (isNumber(row.current) ? row.current.toFixed(1) : "暂无数据") : durationText(row.current)}</td><td>{row.kind === "count" ? (isNumber(row.previous) ? row.previous.toFixed(1) : "暂无数据") : durationText(row.previous)}</td><td>{deltaText(row.delta, row.kind)}</td></tr>{/each}</tbody></table></div></section>
    <section class="panel desktop-trend-panel" id="overlay"><div class="section-heading"><div><h2>作息叠图</h2><p class="muted">每天一条：橙色是离家到到家，绿色是开始办公到离开电脑，浅蓝是全天没出门。</p></div></div><RhythmOverlay {days} /><p class="chart-conclusion">{overlaySummary}</p></section>
    <section class="panel" id="commute" data-mobile-tab="commute"><div class="section-heading"><div><h2>通勤（上限）</h2><p class="muted">通勤是推断出的上限；时刻按已过完的日子统计。</p></div></div><div class="chart-grid"><div><h3>上班通勤</h3><BarChart items={commuteItems} format={durationText} label="每天上班通勤" /></div><div><h3>下班通勤</h3><BarChart items={commuteHomeItems} format={durationText} label="每天下班通勤" /></div></div><p class="chart-conclusion">{commuteConclusion}</p></section>
    <section class="panel" id="times" data-mobile-tab="times"><div class="section-heading"><div><h2>每天几点</h2><p class="muted">按已过完的日子统计，点表示平均，横线表示范围。</p></div></div><div class="moment-ranges">{#each moments as moment}<div class="moment-range" aria-label={`${moment.label}：最早 ${clockText(moment.min)}，最晚 ${clockText(moment.max)}，平均 ${clockText(moment.avg)}，${moment.days} 天`}><span>{moment.label}</span><svg width="100%" height="16" aria-hidden="true"><rect class="track" x="0" y="6" width="100%" height="4" rx="2"></rect>{#if moment.min !== null && moment.max !== null && moment.avg !== null}<rect class="range" x={`${(moment.min / 1440) * 100}%`} y="4" width={`${Math.max(0.5, ((moment.max - moment.min) / 1440) * 100)}%`} height="8" rx="4"></rect><circle class="avg" cx={`${(moment.avg / 1440) * 100}%`} cy="8" r="5"></circle>{/if}</svg><strong>{moment.days ? `${clockText(moment.min)}–${clockText(moment.max)} · 平均 ${clockText(moment.avg)}` : "暂无数据"}</strong></div>{/each}</div></section>
    <section class="panel desktop-trend-panel" id="home"><div class="section-heading"><div><h2>在家</h2><p class="muted">家里暂不区分卧室和客厅，只显示「在家」。</p></div></div><h3>每天在家多久</h3><BarChart items={homeItems} format={durationText} label="每天在家时长" /><h3>去过的其他网络</h3>{#if networks.length}<ol class="rank-list">{#each networks as network}<li><strong>{network.name}</strong><span>{durationText(network.minutes)}</span></li>{/each}</ol>{:else}<p class="empty-small">这段时间工作机没有连过家和公司以外的网络。</p>{/if}<p class="chart-conclusion">在家日均 {durationText(average(complete.map(day => day.metrics.homeMinutes)))}；家里暂不区分房间。</p></section>
    <section class="panel" id="anomalies" data-mobile-tab="anomalies"><div class="section-heading"><div><h2>和平时不一样的日子</h2><p class="muted">比近 30 天同类日子早到 / 晚走超过 40 分钟，或通勤长 50% 以上。</p></div></div>{#if anomalies.anomalies.length}<ul class="anomaly-list">{#each anomalies.anomalies as item}<li><div><strong>{shortDate(item.date)} {weekdayText(item.date)}</strong><span class="badge">{dayTypeText(item.dayType)} · 对比 {item.sampleDays} 天</span></div>{#each item.reasons as reason}<p>{anomalyReasonText(reason)}</p>{/each}</li>{/each}</ul>{:else}<p class="empty-small">这段时间没有明显和平时不一样的日子。</p>{/if}{#if anomalies.insufficient_sample.length}<p class="fine muted">另有 {anomalies.insufficient_sample.length} 天同类日样本不足 5 天，没有判断：{anomalies.insufficient_sample.map(item => shortDate(item.date)).join("、")}。</p>{/if}<p class="chart-conclusion">共 {anomalies.anomalies.length} 天和平时不一样；判断门槛固定为 40 分钟 / 50%。</p></section>
    <section class="panel" id="quality" data-mobile-tab="quality"><div class="section-heading"><div><h2>数据可信度</h2><p class="muted">每天有数据的分钟占比；缺口按原因拆开。</p></div></div><BarChart items={qualityItems} max={100} fullUnknown format={value => `${value.toFixed(1)}%`} label="每天数据覆盖率" /><div class="timeline-legend">{#each tierCounts as item}<span><i class:unknown={item.tier === "unknown"} data-series={`tier-${item.tier}`}></i>{TIER_LABELS[item.tier]} {item.count} 天</span>{/each}</div>{#if gapTotals.length}<ul class="rank-list">{#each gapTotals as gap}<li><strong>{GAP_REASONS[gap.name] ?? gap.name}</strong><span>{durationText(gap.minutes)}</span></li>{/each}</ul>{/if}<p class="chart-conclusion">平均覆盖率 {percentText(average((quality.days ?? []).map(day => day.coverage)))}；没有汇总的日子不算进平均。</p></section>
  </div>
{/if}
