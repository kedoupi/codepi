<script lang="ts">
  import { onMount } from "svelte";
  import { api, RequestError, errorText } from "../lib/api";
  import SyncStatus from "./SyncStatus.svelte";
  import type { ComparePayload } from "../lib/reports";
  import { t, type Locale } from "../lib/i18n";
  import type { DailyResponse, MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";
  import DurationValue from "./DurationValue.svelte";
  import MetricDetail from "./MetricDetail.svelte";
  import { watchCalendarDay } from "../lib/calendar";
  import {
    duration, finite, readSleep, readSpo2, readStress, sleepForDay,
    type SleepRecord, type Spo2Day, type StressDay,
  } from "../lib/health";
  import {
    compareSeries, daysOf, mainSleepSeries, nightlySeries, rollingRanges, seriesOf, spo2Series, stepSeries, stressSeries, weekday,
  } from "../lib/insights-model";

  let { me, locale, onUnauthorized, onLogout }: {
    me: MeResponse; locale: Locale; onUnauthorized: () => void; onLogout: () => void;
  } = $props();

  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const initialDay = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  let end = $state(initialDay);

  let mode = $state<"week" | "range">("week");
  let periodDays = $state(7);
  let custom = $state(false);
  let customStart = $state(rollingRanges(initialDay).current.from);
  let referenceEnd = $state(moveDay(initialDay, -7));
  let category = $state<"sleep" | "activity" | "stress">("sleep");
  const ranges = $derived.by(() => {
    const current = { from: custom ? customStart : moveDay(end, 1 - periodDays), to: end };
    const count = Math.max(1, daysOf(current).length);
    return { current, previous: mode === "range" ? { from: moveDay(end, -29), to: end }
      : { from: moveDay(referenceEnd, 1 - count), to: referenceEnd } };
  });
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const shortDate = (day: string) => day.slice(5).replace("-", "/");
  function moveDay(day: string, offset: number) {
    return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  }
  function shiftRange(which: "current" | "reference", offset: number) {
    setRangeEnd(which, moveDay(which === "current" ? end : referenceEnd, offset));
  }
  function setRangeEnd(which: "current" | "reference", next: string) {
    if (!next || next > today()) return;
    if (which === "current") {
      if (custom) customStart = moveDay(customStart, Math.round((Date.parse(next) - Date.parse(end)) / 86400000));
      end = next;
    }
    else referenceEnd = next;
    void load();
  }
  function setPeriod(count: number) {
    periodDays = count; custom = false; referenceEnd = moveDay(end, -count); void load();
  }
  const currentDays = $derived(daysOf(ranges.current).length);
  const referenceDays = $derived(daysOf(ranges.previous).length);
  let payload = $state<ComparePayload | null>(null);
  let payloadMode = $state<"week" | "range" | null>(null);
  let status = $state("");
  let statusErr = $state(false);
  let needsReconnect = $state(false);
  let revision = 0;
  let disposed = false;

  let sleeps = $state<SleepRecord[]>([]);
  let days = $state<DailyResponse["days"]>([]);
  let spo2 = $state<Spo2Day[]>([]);
  let openMetric = $state("duration");
  let stress = $state<StressDay[]>([]);

  type MetricRow = {
    key: string; label: string; unit: string; group: "sleep" | "activity" | "stress"; currentCount: number; previousCount: number; sampleUnit: string;
    current: number | null; previous: number | null;
    delta: string | null; samples: string;
    series: Array<{ date: string; value: number | null }>;
    previousSeries: Array<{ date: string; value: number | null }>;
    format: (value: number | null) => string;
  };

  const fmtMinutes = (value: number | null) => value === null ? "—" : duration(value * 60, locale);
  const fmtNumber = (unit: string) => (value: number | null) => value === null ? "—" : `${Math.round(value * 10) / 10} ${unit}`;

  const metrics = $derived.by((): MetricRow[] => {
    const pick = (key: string, selector: (record: SleepRecord) => number | null | undefined, mainOnly = false) => ({
      current: (mainOnly ? mainSleepSeries : nightlySeries)(sleeps, ranges.current, selector),
      previous: (mainOnly ? mainSleepSeries : nightlySeries)(sleeps, ranges.previous, selector),
    });
    const durationSeries = {
      current: nightlySeries(sleeps, ranges.current, record => record.total_sleep_duration).map(point => ({ date: point.date, value: point.value === null ? null : point.value / 60 })),
      previous: nightlySeries(sleeps, ranges.previous, record => record.total_sleep_duration).map(point => ({ date: point.date, value: point.value === null ? null : point.value / 60 })),
    };
    const efficiency = pick("efficiency", record => record.efficiency);
    const latency = pick("latency", record => finite(record.latency) ? record.latency! / 60 : null);
    const hrv = pick("hrv", record => record.average_hrv, true);
    const hr = pick("hr", record => record.average_heart_rate, true);
    const spo2Current = spo2Series(spo2, ranges.current);
    const spo2Previous = spo2Series(spo2, ranges.previous);
    const stepsCurrent = stepSeries(days ?? [], ranges.current);
    const stepsPrevious = stepSeries(days ?? [], ranges.previous);

    const row = (
      key: string, label: string, unit: string,
      current: Array<{ date: string; value: number | null }>,
      previous: Array<{ date: string; value: number | null }>,
      format: (value: number | null) => string,
      deltaFormat: (delta: number) => string,
      group: "sleep" | "activity" | "stress" = "sleep",
    ): MetricRow => {
      const compared = compareSeries(current, previous);
      const a = seriesOf(current);
      const b = seriesOf(previous);
      return {
        key, label, unit, group, currentCount: a.count, previousCount: b.count, sampleUnit: group === "sleep" && key !== "spo2" ? text("晚", "nights") : text("天", "days"),
        current: a.mean, previous: b.mean,
        delta: compared ? deltaFormat(compared.delta) : null,
        samples: `${a.count}/${current.length} · ${b.count}/${previous.length}`,
        series: current, previousSeries: previous, format,
      };
    };

    return [
      row("duration", text("主睡眠时长", "Main sleep duration"), "",
        durationSeries.current, durationSeries.previous, fmtMinutes,
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${text("分钟", "min")}`),
      row("efficiency", text("睡眠效率", "Sleep efficiency"), "%",
        efficiency.current, efficiency.previous, fmtNumber("%"),
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${text("个百分点", "pts")}`),
      row("latency", text("入睡用时", "Latency"), text("分钟", "min"),
        latency.current, latency.previous, fmtNumber(text("分钟", "min")),
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${text("分钟", "min")}`),
      row("hrv", text("主睡眠 HRV", "Main-sleep HRV"), "ms",
        hrv.current, hrv.previous, fmtNumber("ms"),
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ms`),
      row("hr", text("夜间平均心率", "Overnight avg HR"), "bpm",
        hr.current, hr.previous, fmtNumber("bpm"),
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} bpm`),
      row("steps", text("日均步数", "Daily steps"), text("步", "steps"),
        stepsCurrent, stepsPrevious, value => value === null ? "—" : String(Math.round(value)),
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${text("步", "steps")}`, "activity"),
      row("spo2", text("夜间血氧", "Overnight SpO2"), "%",
        spo2Current, spo2Previous, fmtNumber("%"),
        delta => `${delta >= 0 ? "+" : "−"}${(Math.abs(delta)).toFixed(1)} %`),
      row("stress", text("日间压力时长", "Daytime stress"), text("分钟", "min"),
        stressSeries(stress, ranges.current, "stress_high"), stressSeries(stress, ranges.previous, "stress_high"), fmtNumber(text("分钟", "min")),
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${text("分钟", "min")}`, "stress"),
      row("recovery", text("恢复时长", "Recovery time"), text("分钟", "min"),
        stressSeries(stress, ranges.current, "recovery_high"), stressSeries(stress, ranges.previous, "recovery_high"), fmtNumber(text("分钟", "min")),
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${text("分钟", "min")}`, "stress"),
    ];
  });

  const categoryMetrics = $derived(metrics.filter(metric => metric.group === category));

  function fmt(n: number | null | undefined, steps = false): string {
    if (n == null) return "—";
    return steps ? String(Math.round(n)) : (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  }

  async function load(next = mode) {
    const requestRevision = ++revision;
    statusErr = false;
    needsReconnect = false;
    status = t(locale, "loading");
    if (next !== payloadMode) payload = null;
    try {
      const data = await api<ComparePayload>(`/api/me/insights/compare?mode=${next}`);
      if (disposed || requestRevision !== revision) return;
      payload = data;
      payloadMode = next;
      status = "";
      void loadDetails(requestRevision);
    } catch (err) {
      if (disposed || requestRevision !== revision) return;
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      needsReconnect = err instanceof RequestError && err.code === "reconnect_required";
      statusErr = true;
      status = errorText(err, locale);
    }
  }

  async function loadDetails(current: number) {
    if (!me.capabilities?.personal) return;
    const detail = async <T,>(read: () => Promise<T[]>): Promise<T[]> => {
      try { return await read(); } catch { return []; }
    };
    const [sleepRows, daily, spo2Rows, stressRows] = await Promise.all([
      detail(() => readSleep(ranges.previous.from < ranges.current.from ? ranges.previous.from : ranges.current.from, ranges.current.to > ranges.previous.to ? ranges.current.to : ranges.previous.to).then(result => result.records)),
      api<DailyResponse>("/api/me/daily?days=90").then(result => result.days ?? []).catch(() => []),
      detail(() => readSpo2(ranges.previous.from < ranges.current.from ? ranges.previous.from : ranges.current.from, ranges.current.to > ranges.previous.to ? ranges.current.to : ranges.previous.to)),
      detail(() => readStress(ranges.previous.from < ranges.current.from ? ranges.previous.from : ranges.current.from, ranges.current.to > ranges.previous.to ? ranges.current.to : ranges.previous.to)),
    ]);
    if (disposed || current !== revision) return;
    sleeps = sleepRows;
    days = daily;
    spo2 = spo2Rows;
    stress = stressRows;
  }

  function setMode(next: "week" | "range") {
    mode = next;
    void load(next);
  }

  onMount(() => {
    void load();
    const stop = watchCalendarDay(day => { end = day; referenceEnd = moveDay(day, -periodDays); payload = null; sleeps = []; void load(); });
    return () => { stop(); disposed = true; revision++; };
  });
</script>

<div id="dash-view">
  <ChromeHeader isDev={me.allowDevLogin === true && me.source === "dev"} {locale} active="/compare" {onLogout} />
  <main class="wrap page health-report compare-page">
    <header class="report-heading"><div><h1>{text("对比", "Compare")}</h1><p class="sub">{text("把两个时间段放在一起，看清变化。", "Two periods side by side, to see what changed.")}</p></div></header>
    <div class="compare-tabs report-tabs" role="group" aria-label={text("比较方式", "Comparison mode")}><button data-mode="week" aria-pressed={mode === "week"} onclick={() => setMode("week")}>{text("区间比较", "Compare periods")}</button><button data-mode="range" aria-pressed={mode === "range"} onclick={() => setMode("range")}>{text("个人历史参照", "Personal history")}</button></div>
    <div class="range-bar">
      {#each ["current", "reference"] as which}
        {@const current = which === "current"}{@const range = current ? ranges.current : ranges.previous}
        <div class="range-field"><span class="range-title"><i class:current class:reference={!current}></i>{current ? text("当前区间", "Current") : text("对照区间", "Reference")}</span><div class="date-control"><button aria-label={current ? text("当前区间前移", "Earlier current period") : text("对照区间前移", "Earlier reference period")} disabled={!current && mode === "range"} onclick={() => shiftRange(current ? "current" : "reference", -7)}>‹</button><label class="range-label"><span>{shortDate(range.from)} — {shortDate(range.to)}</span><input type="date" aria-label={current ? text("当前截止日期", "Current end date") : text("对照截止日期", "Reference end date")} value={range.to} max={today()} disabled={!current && mode === "range"} onchange={event => setRangeEnd(current ? "current" : "reference", event.currentTarget.value)} /></label><button aria-label={current ? text("当前区间后移", "Later current period") : text("对照区间后移", "Later reference period")} disabled={range.to >= today() || (!current && mode === "range")} onclick={() => shiftRange(current ? "current" : "reference", 7)}>›</button></div></div>
      {/each}
      <div class="range-presets"><div class="preset-buttons" role="group" aria-label={text("区间长度", "Period length")}><button aria-pressed={!custom && periodDays === 7} onclick={() => setPeriod(7)}>7 {text("天", "days")}</button><button aria-pressed={!custom && periodDays === 30} onclick={() => setPeriod(30)}>30 {text("天", "days")}</button><button aria-pressed={custom} onclick={() => { if (custom) setPeriod(periodDays); else { customStart = ranges.current.from; custom = true; } }}>{text("自定义", "Custom")}</button></div><small>{text(`${currentDays} 天对 ${referenceDays} 天`, `${currentDays} vs ${referenceDays} days`)} · {ranges.previous.to >= ranges.current.from ? text("日期有重叠", "dates overlap") : text("日期不重叠", "non-overlapping")} · {text("北京时间", "Asia/Shanghai")}</small></div>
    </div>
    {#if custom}<div class="custom-range"><label>{text("当前开始日期", "Current start")}<input type="date" min={moveDay(end, -89)} max={end} value={customStart} onchange={event => { const value = event.currentTarget.value; if (value && value >= moveDay(end, -89) && value <= end) { customStart = value; referenceEnd = moveDay(value, -1); void load(); } else event.currentTarget.value = customStart; }} /></label><span class="hint">{text("选择 1–90 个日历日；对照区间保持相同天数。", "Choose 1–90 calendar days; reference keeps the same length.")}</span></div>{/if}
    {#if status}<div class="status" class:err={statusErr}>{status}</div>{/if}
    {#if statusErr}<button class="ai-btn" onclick={() => load()}>{text("重试", "Retry")}</button>{#if needsReconnect}<a class="ai-btn" href="/api/auth/oura/start">{text("重新连接 Oura", "Reconnect Oura")}</a>{/if}{/if}
    {#if payload?.locked}<p class="hint">{text("此账号尚未开放完整对比。", "Full comparison is not enabled for this account.")}</p>
    {:else if payloadMode === mode && payload?.left && payload?.right}
      {#if me.capabilities?.personal}
        <div class="category-tabs report-tabs" role="group" aria-label={text("指标分类", "Metric category")}>
          {#each [{ key: "sleep" as const, label: text("睡眠与恢复", "Sleep & recovery"), first: "duration" }, { key: "activity" as const, label: text("活动", "Activity"), first: "steps" }, { key: "stress" as const, label: text("压力", "Stress"), first: "stress" }] as group}<button aria-pressed={category === group.key} onclick={() => { category = group.key; openMetric = group.first; }}>{group.label}</button>{/each}
        </div>
        <section class="metric-table" aria-label={text("区间指标对比", "Metric comparison")}>
          <div class="metric-head"><span>{text("指标", "Metric")}</span><span><i class="dot current"></i>{text("当前区间", "Current")}<small>{shortDate(ranges.current.from)} — {shortDate(ranges.current.to)}</small></span><span><i class="dot reference"></i>{text("对照区间", "Reference")}<small>{shortDate(ranges.previous.from)} — {shortDate(ranges.previous.to)}</small></span><span>{text("变化", "Change")}</span><span>{text("有效记录", "Valid records")}</span><span></span></div>
          {#each categoryMetrics as metric}
            <button class="metric-row" class:open={openMetric === metric.key} onclick={() => { openMetric = openMetric === metric.key ? "" : metric.key; }} aria-expanded={openMetric === metric.key} aria-controls={`metric-detail-${metric.key}`}>
              <span class="metric-name">{metric.label}</span>
              <span class="metric-value"><span class="value-label">{text("当前", "Current")}</span><span class="value-number">{#if metric.key === "duration"}<DurationValue seconds={metric.current === null ? null : metric.current * 60} {locale} />{:else}{metric.current === null ? "—" : metric.key === "steps" ? Math.round(metric.current).toLocaleString(locale === "zh" ? "zh-CN" : "en") : Math.round(metric.current * 10) / 10}<small> {metric.unit}</small>{/if}</span><small class="mobile-samples">{metric.currentCount}/{currentDays}{metric.sampleUnit}</small></span>
              <span class="metric-value reference"><span class="value-label">{text("对照", "Reference")}</span><span class="value-number">{#if metric.key === "duration"}<DurationValue seconds={metric.previous === null ? null : metric.previous * 60} {locale} />{:else}{metric.previous === null ? "—" : metric.key === "steps" ? Math.round(metric.previous).toLocaleString(locale === "zh" ? "zh-CN" : "en") : Math.round(metric.previous * 10) / 10}<small> {metric.unit}</small>{/if}</span><small class="mobile-samples">{metric.previousCount}/{referenceDays}{metric.sampleUnit}</small></span>
              <span class="metric-delta" class:up={metric.delta?.startsWith("+")} class:down={metric.delta?.startsWith("−")}>{metric.delta ?? text("样本不足", "Not enough data")}</span>
              <span class="metric-samples">{metric.currentCount}/{currentDays}{metric.sampleUnit} · {metric.previousCount}/{referenceDays}{metric.sampleUnit}</span><span class="metric-arrow" aria-hidden="true">{openMetric === metric.key ? "⌄" : "›"}</span>
            </button>
            {#if openMetric === metric.key}<div class="metric-detail" id={`metric-detail-${metric.key}`}><MetricDetail {metric} {ranges} {locale} history={mode === "range"} /></div>{/if}
          {/each}
        </section>
      {/if}
      <details class="report-disclosure score-disclosure"><summary>{text("官方分数对照与数据口径", "Official scores and methodology")}</summary><section class="score-table">
        <h3>{text("官方分数对照", "Official score comparison")}</h3><p class="hint">{text("官方评分保留固定的最近窗口；上方详细指标使用所选日期。", "Official scores use fixed recent windows; detailed metrics above use selected dates.")}</p>
        <table class="avg-table"><thead><tr><th>{t(locale, "metricLabel")}</th><th>{payload.left.label}</th><th>{payload.right.label}</th><th>{text("有效天数", "Valid days")}</th></tr></thead><tbody>{#each [[t(locale, "metricSleep"), payload.left.sleep, payload.right.sleep, payload.left.samples?.sleep, payload.right.samples?.sleep], [t(locale, "metricReady"), payload.left.readiness, payload.right.readiness, payload.left.samples?.readiness, payload.right.samples?.readiness], [t(locale, "metricAct"), payload.left.activity, payload.right.activity, payload.left.samples?.activity, payload.right.samples?.activity], [t(locale, "metricSteps"), payload.left.steps, payload.right.steps, payload.left.samples?.steps, payload.right.samples?.steps]] as row}<tr><td>{row[0]}</td><td>{fmt(row[1] as number | null, row[0] === t(locale, "metricSteps"))}</td><td>{fmt(row[2] as number | null, row[0] === t(locale, "metricSteps"))}</td><td>{row[3] ?? "—"} · {row[4] ?? "—"}</td></tr>{/each}</tbody></table>
        {#if payload.sync}<SyncStatus sync={payload.sync} {locale} />{/if}<p class="hint">{text("主睡眠与小睡分开统计 · 样本不足时保留原值，暂停比较。历史窗口有重叠时，两列不是独立样本。", "Main sleep and naps are separate · sparse samples keep values without a delta. Overlapping periods are not independent samples.")}</p>
      </section></details>
      <footer class="report-source"><span>{text("主睡眠与小睡分开统计 · 缺失不补零", "Main sleep and naps are separate · gaps are not zero-filled")}</span><a class="report-link" href="/settings">{text("查看数据口径", "Data & sources")} →</a></footer>
    {/if}
  </main>
</div>

<style>
  .compare-tabs { margin-top: 10px; }
  .range-bar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: center; gap: 16px; margin: 18px 0 20px; }
  .range-field { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .range-title { font-size: 12px; font-weight: 600; white-space: nowrap; display: flex; gap: 7px; align-items: center; }
  .range-title i, .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }.current { background: var(--report-blue); }.reference.dot, .range-title .reference { background: var(--report-reference); }
  .range-field .date-control { flex: 1; max-width: 270px; }.range-label { display: flex; align-items: center; gap: 4px; justify-content: center; padding-left: 10px; border-inline: 1px solid var(--line); font-size: 12px; flex: 1; white-space: nowrap; }
  .range-label input { width: 28px; padding: 6px 2px; border: 0; color: transparent; }.range-label input::-webkit-datetime-edit { display: none; }.range-label input::-webkit-calendar-picker-indicator { margin: 0; opacity: .7; }
  .date-control button { width: 28px; flex-shrink: 0; }.range-presets { display: grid; justify-items: end; gap: 5px; }
  .preset-buttons { display: flex; gap: 5px; }.preset-buttons button { background: transparent; border: 1px solid var(--line); color: var(--muted); border-radius: 5px; padding: 5px 12px; min-height: 36px; font-size: 12px; }.preset-buttons button[aria-pressed="true"] { color: var(--primary); border-color: var(--primary); }
  .range-presets small { font-size: 10px; color: var(--muted); white-space: nowrap; }.category-tabs { margin-top: 6px; }
  .custom-range { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }.custom-range label { font-size: 12px; }.custom-range input { font: inherit; background: transparent; border: 1px solid var(--line); color: var(--ink); padding: 6px; margin-left: 8px; }
  .metric-table { display: flex; flex-direction: column; }
  .metric-head, .metric-row { display: grid; grid-template-columns: 1.12fr 1.06fr 1.06fr .95fr 1fr 16px; gap: 12px; align-items: center; }
  .metric-head { order: 0; font-size: 12px; color: var(--muted); padding: 14px 12px 10px; }.metric-head .dot { margin-right: 8px; }.metric-head small { display: block; margin: 3px 0 0 17px; font-size: 10px; }
  .metric-row { order: 1; width: 100%; border: 0; border-bottom: 1px solid var(--line); background: transparent; padding: 10px 12px; text-align: left; position: relative; }
  .metric-row.open::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--primary); }.metric-row.open { background: var(--peach); }
  .metric-name { font-size: 14px; font-weight: 600; }.metric-value { min-width: 0; }.metric-value.reference { color: #5d6f7e; background: transparent; }
  .value-number { font-size: 23px; font-weight: 500; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }.value-number small { font-size: 13px; font-weight: 400; letter-spacing: 0; }
  .value-label, .mobile-samples { display: none; }.metric-delta { font-size: 16px; color: var(--muted); font-variant-numeric: tabular-nums; }.metric-delta.up { color: var(--primary); }.metric-delta.down { color: #5d6f7e; }.metric-samples { font-size: 11px; color: var(--muted); }
  .metric-arrow { font-size: 22px; color: var(--primary); line-height: 1; }.metric-detail { order: 2; }
  .score-table { padding-top: 12px; }.score-table h3 { font-size: 15px; }.avg-table { border-collapse: collapse; width: 100%; }.avg-table th { font-weight: 500; text-align: left; font-size: 12px; padding: 10px 6px; }:global(.workspace .page.health-report) .avg-table td { font-size: 13px; padding: 10px 6px; border-top: 1px solid var(--line); }:global(.workspace .page.health-report) .avg-table td:last-child { font-family: inherit; font-size: 12px; color: var(--muted); }
  @media(max-width:1050px) and (min-width:761px) { .range-bar { grid-template-columns: 1fr 1fr; }.range-presets { grid-column: 1/-1; display: flex; justify-content: flex-end; align-items: center; }.range-field { gap: 8px; } }
  @media(max-width:760px) {
    .compare-tabs { gap: 24px; margin-top: 6px; }.range-bar { grid-template-columns: minmax(0,1fr); gap: 6px; margin: 8px 0 10px; }
    .range-field { display: grid; grid-template-columns: 78px minmax(0,1fr); gap: 8px; }.range-title { font-size: 12px; gap: 8px; }.range-field .date-control { min-width: 0; }.range-label { font-size: 11px; padding-left: 6px; gap: 0; }.range-label input { width: 25px; }.date-control button { width: 25px; min-height: 36px; }
    .range-presets { justify-items: center; margin-top: 4px; }.range-presets small { font-size: 10px; }.preset-buttons button { min-height: 30px; padding: 4px 16px; }
    .category-tabs { margin-top: 0; gap: 28px; }.category-tabs button { font-size: 13px; }
    .metric-head { display: none; }.metric-row { order: initial; grid-template-columns: minmax(0,1fr) minmax(0,1fr) 16px; grid-template-areas: "name delta arrow" "current reference reference"; padding: 8px 6px; gap: 6px 0; min-height: 96px; }
    .metric-name { grid-area: name; font-size: 14px; }.metric-delta { grid-area: delta; text-align: right; font-size: 14px; white-space: nowrap; }.metric-arrow { grid-area: arrow; padding-left: 5px; font-size: 20px; }
    .metric-value { grid-area: current; padding: 0 6px; }.metric-value.reference { grid-area: reference; border-left: 1px solid var(--line); padding-left: 20px; }.metric-value .value-label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 2px; }.value-number { font-size: 24px; line-height: 1.2; }.value-number small { font-size: 13px; }.mobile-samples { display: block; color: var(--muted); font-size: 10px; margin-top: 2px; }.metric-samples { display: none; }
    .metric-row.open { background: transparent; border-bottom: 1px solid var(--line); }.metric-row.open::before { top: 10px; bottom: auto; height: 28px; }.metric-row.open .metric-name, .metric-row.open .metric-delta { background: var(--peach); padding-block: 4px; }.metric-row.open .metric-name { padding-left: 6px; margin-left: -6px; }.metric-row.open .metric-arrow { background: var(--peach); padding-block: 4px; }
    .metric-detail { order: initial; border-bottom: 1px solid var(--line); }.custom-range { display: block; }.custom-range .hint { display: block; }
  }
</style>
