<script lang="ts">
  import { onMount } from "svelte";
  import { api, RequestError, errorText } from "../lib/api";
  import SyncStatus from "./SyncStatus.svelte";
  import type { ComparePayload } from "../lib/reports";
  import { t, type Locale } from "../lib/i18n";
  import type { DailyResponse, MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";
  import MiniLine from "./MiniLine.svelte";
  import { watchCalendarDay } from "../lib/calendar";
  import {
    duration, finite, readSleep, readSpo2, sleepForDay,
    type SleepRecord, type Spo2Day,
  } from "../lib/health";
  import {
    compareSeries, daysOf, mainSleepSeries, nightlySeries, rollingRanges, seriesOf, spo2Series, stepSeries, weekday,
  } from "../lib/insights-model";

  let { me, locale, onUnauthorized, onLogout }: {
    me: MeResponse; locale: Locale; onUnauthorized: () => void; onLogout: () => void;
  } = $props();

  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const end = $state(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
  const ranges = $derived(rollingRanges(end));

  let mode = $state<"week" | "range">("week");
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
  let openMetric = $state("");

  type MetricRow = {
    key: string; label: string; unit: string;
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
    ): MetricRow => {
      const compared = compareSeries(current, previous);
      const a = seriesOf(current);
      const b = seriesOf(previous);
      return {
        key, label, unit,
        current: a.mean, previous: b.mean,
        delta: compared ? deltaFormat(compared.delta) : null,
        samples: `${a.count}/7${text("晚", "n")} · ${b.count}/7${text("晚", "n")}`,
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
        delta => `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${text("步", "steps")}`),
      row("spo2", text("夜间血氧", "Overnight SpO2"), "%",
        spo2Current, spo2Previous, fmtNumber("%"),
        delta => `${delta >= 0 ? "+" : "−"}${(Math.abs(delta)).toFixed(1)} %`),
    ];
  });

  const active = $derived(metrics.find(metric => metric.key === openMetric) ?? metrics[0]);

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
    const [sleepRows, daily, spo2Rows] = await Promise.all([
      detail(() => readSleep(ranges.previous.from, ranges.current.to).then(result => result.records)),
      api<DailyResponse>("/api/me/daily?days=30").then(result => result.days ?? []).catch(() => []),
      detail(() => readSpo2(ranges.previous.from, ranges.current.to)),
    ]);
    if (disposed || current !== revision) return;
    sleeps = sleepRows;
    days = daily;
    spo2 = spo2Rows;
  }

  function setMode(next: "week" | "range") {
    mode = next;
    void load(next);
  }

  onMount(() => {
    void load();
    const stop = watchCalendarDay(() => { payload = null; sleeps = []; void load(); });
    return () => { stop(); disposed = true; revision++; };
  });
</script>

<div id="dash-view">
  <ChromeHeader isDev={me.allowDevLogin === true && me.source === "dev"} {locale} active="/compare" {onLogout} />
  <main class="wrap page compare-page">
    <header class="compare-heading">
      <div>
        <h1>{text("对比", "Compare")}</h1>
        <p class="sub">{text("把两个时间段放在一起，看清变化。", "Two periods side by side, with room to see what changed.")}</p>
      </div>
    </header>

    <div class="compare-tabs" role="group" aria-label={text("比较方式", "Comparison mode")}>
      <button type="button" class="ai-btn" class:on={mode === "week"} aria-pressed={mode === "week"} onclick={() => setMode("week")}>{text("区间比较 · 近 7 天 vs 此前 7 天", "Ranges · last 7 vs preceding 7")}</button>
      <button type="button" class="ai-btn" class:on={mode === "range"} aria-pressed={mode === "range"} onclick={() => setMode("range")}>{text("个人历史参照 · 近 7 天 vs 近 30 天", "History · last 7 vs last 30")}</button>
    </div>

    <div class="range-bar">
      <div class="range-pill current">
        <i></i>{text("当前区间", "Current")} <strong>{ranges.current.from} — {ranges.current.to}</strong>
      </div>
      <div class="range-pill reference">
        <i></i>{text("对照区间", "Reference")} <strong>{ranges.previous.from} — {ranges.previous.to}</strong>
      </div>
      <span class="range-note">{text("各 7 个日历日 · 日期不重叠 · 北京时间", "7 calendar days each · non-overlapping · Asia/Shanghai")}</span>
    </div>

    {#if status}<div class="status" class:err={statusErr}>{status}</div>{/if}
    {#if statusErr}
      <button class="ai-btn" onclick={() => load()}>{text("重试", "Retry")}</button>
      {#if needsReconnect}<a class="ai-btn" href="/api/auth/oura/start">{text("重新连接 Oura", "Reconnect Oura")}</a>{/if}
    {/if}
    {#if payload?.sync}<SyncStatus sync={payload.sync} {locale} />{/if}

    {#if payload?.locked}
      <p class="hint">{text("此账号尚未开放完整对比。", "Full comparison is not enabled for this account.")}</p>
    {:else if payloadMode === mode && payload?.left && payload?.right}
      {#if me.capabilities?.personal}
      <section class="metric-table" aria-label={text("区间指标对比", "Metric comparison")}>
        <div class="metric-head">
          <span>{text("指标", "Metric")}</span>
          <span><i class="dot current"></i>{text("当前区间", "Current")} <small>{ranges.current.from.slice(5)} — {ranges.current.to.slice(5)}</small></span>
          <span><i class="dot reference"></i>{text("对照区间", "Reference")} <small>{ranges.previous.from.slice(5)} — {ranges.previous.to.slice(5)}</small></span>
          <span>{text("变化", "Change")}</span>
          <span>{text("有效记录", "Valid records")}</span>
        </div>
        {#each metrics as metric}
          <button class="metric-row" class:open={openMetric === metric.key} onclick={() => { openMetric = openMetric === metric.key ? "" : metric.key; }} aria-expanded={openMetric === metric.key}>
            <span class="metric-name">{metric.label}</span>
            <span class="metric-value">{metric.format(metric.current)}</span>
            <span class="metric-value reference">{metric.format(metric.previous)}</span>
            <span class="metric-delta" class:up={metric.delta?.startsWith("+")} class:down={metric.delta?.startsWith("−")}>
              {metric.delta ?? text("样本不足", "Not enough data")}
            </span>
            <span class="metric-samples">{metric.samples}</span>
          </button>
        {/each}
      </section>

      {#if active}
        <section class="metric-detail panel">
          <h2>{active.label}{text("：变化发生在哪几天？", ": where did it change?")}</h2>
          <div class="detail-grid">
            <div>
              <h3>{text("逐日记录", "Day by day")} <small>{text("按区间第 1–7 天对齐", "aligned by day 1–7")}</small></h3>
              <MiniLine locale={locale} series={active.series} compare={active.previousSeries}
                baseline={active.previous} unit={active.unit ? ` ${active.unit}` : ""}
                format={value => active.key === "duration" ? duration(value * 60, locale).replace(" 小时 ", "h").replace(" 分", "m") : String(Math.round(value))} />
              <p class="hint">{active.delta
                ? text(`均值${active.delta}。`, `Mean change ${active.delta}.`)
                : text("样本不足时保留原值，暂停比较。", "Values are kept; comparison pauses on sparse samples.")}</p>
            </div>
            <div class="distribution">
              <h3>{text("两期的分布", "Distribution")} <small>{text("每个点代表一天；缺失不补零。", "one dot per day; gaps are not zero-filled.")}</small></h3>
              <div class="dist-row">
                <span>{text("当前区间", "Current")} <small>{seriesOf(active.series).count}/7</small></span>
                <div class="dist-track">
                  {#each active.series.filter(point => point.value !== null) as point}
                    <i class="dot current" title={point.date}></i>
                  {/each}
                </div>
              </div>
              <div class="dist-row">
                <span>{text("对照区间", "Reference")} <small>{seriesOf(active.previousSeries).count}/7</small></span>
                <div class="dist-track">
                  {#each active.previousSeries.filter(point => point.value !== null) as point}
                    <i class="dot reference" title={point.date}></i>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        </section>
      {/if}

      <section class="panel score-table">
        <h3>{text("官方分数对照", "Official score comparison")}</h3>
        <table class="avg-table">
          <thead>
            <tr><th>{t(locale, "metricLabel")}</th><th>{payload.left.label}</th><th>{payload.right.label}</th><th>{text("有效天数", "Valid days")}</th></tr>
          </thead>
          <tbody>
            {#each [
              [t(locale, "metricSleep"), payload.left.sleep, payload.right.sleep, payload.left.samples?.sleep, payload.right.samples?.sleep],
              [t(locale, "metricReady"), payload.left.readiness, payload.right.readiness, payload.left.samples?.readiness, payload.right.samples?.readiness],
              [t(locale, "metricAct"), payload.left.activity, payload.right.activity, payload.left.samples?.activity, payload.right.samples?.activity],
              [t(locale, "metricSteps"), payload.left.steps, payload.right.steps, payload.left.samples?.steps, payload.right.samples?.steps],
            ] as row}
              <tr>
                <td>{row[0]}</td>
                <td>{fmt(row[1] as number | null, row[0] === t(locale, "metricSteps"))}</td>
                <td>{fmt(row[2] as number | null, row[0] === t(locale, "metricSteps"))}</td>
                <td>{row[3] ?? "—"} · {row[4] ?? "—"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="hint">{text("主睡眠与小睡分开统计 · 样本不足时保留原值，暂停比较。近 7 天属于近 30 天的一部分时，两列不是独立样本。", "Main sleep and naps are counted separately · sparse samples keep values without a delta. When the last 7 days sit inside the last 30, the columns are not independent.")}</p>
      </section>
      {:else}
      <section class="panel score-table">
        <h3>{text("官方分数对照", "Official score comparison")}</h3>
        <table class="avg-table">
          <thead>
            <tr><th>{t(locale, "metricLabel")}</th><th>{payload.left.label}</th><th>{payload.right.label}</th><th>{text("有效天数", "Valid days")}</th></tr>
          </thead>
          <tbody>
            {#each [
              [t(locale, "metricSleep"), payload.left.sleep, payload.right.sleep, payload.left.samples?.sleep, payload.right.samples?.sleep],
              [t(locale, "metricReady"), payload.left.readiness, payload.right.readiness, payload.left.samples?.readiness, payload.right.samples?.readiness],
              [t(locale, "metricAct"), payload.left.activity, payload.right.activity, payload.left.samples?.activity, payload.right.samples?.activity],
              [t(locale, "metricSteps"), payload.left.steps, payload.right.steps, payload.left.samples?.steps, payload.right.samples?.steps],
            ] as row}
              <tr>
                <td>{row[0]}</td>
                <td>{fmt(row[1] as number | null, row[0] === t(locale, "metricSteps"))}</td>
                <td>{fmt(row[2] as number | null, row[0] === t(locale, "metricSteps"))}</td>
                <td>{row[3] ?? "—"} · {row[4] ?? "—"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
      {/if}
    {/if}
  </main>
</div>

<style>
  .compare-page{padding-top:36px}
  .compare-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;border-bottom:1px solid var(--line);padding-bottom:24px}
  h1{font-size:36px;letter-spacing:-.04em}
  .sub{color:var(--muted);font-size:15px;margin-top:8px}
  .compare-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 16px}
  .range-bar{display:flex;align-items:center;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:8px}
  .range-pill{display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:8px 14px}
  .range-pill strong{color:var(--ink);font-weight:500}
  .range-pill i{width:10px;height:10px;border-radius:50%}
  .range-pill.current i{background:#3b5871}
  .range-pill.reference i{background:#a9a294}
  .range-note{font-size:12px}

  .metric-table{background:var(--surface);border:1px solid var(--line);border-radius:16px;margin-top:18px;overflow:hidden}
  .metric-head,.metric-row{display:grid;grid-template-columns:1.2fr 1fr 1fr .9fr .9fr;gap:12px;align-items:center;padding:14px 20px}
  .metric-head{font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)}
  .metric-head .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
  .dot.current{background:#3b5871}
  .dot.reference{background:#a9a294}
  .metric-row{border:0;border-top:1px solid var(--line);background:transparent;font:inherit;text-align:left;cursor:pointer;width:100%}
  .metric-row:hover{background:var(--peach)}
  .metric-row.open{background:var(--peach)}
  .metric-name{font-weight:600}
  .metric-value{font-size:20px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
  .metric-value.reference{color:var(--muted)}
  .metric-delta{font-variant-numeric:tabular-nums;color:var(--muted);font-size:14px}
  .metric-delta.up{color:var(--primary);font-weight:600}
  .metric-delta.down{color:#3b5871}
  .metric-samples{font-size:12px;color:var(--muted)}

  .metric-detail h2{font-size:20px;letter-spacing:-.02em;margin-bottom:16px}
  .detail-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:28px}
  .detail-grid h3{font-size:14px;margin-bottom:12px}
  .detail-grid h3 small{font-weight:400;color:var(--muted);margin-left:8px}
  .distribution .dist-row{display:grid;grid-template-columns:110px 1fr;align-items:center;gap:12px;margin:14px 0;font-size:13px}
  .dist-row small{color:var(--muted)}
  .dist-track{position:relative;height:26px;border-top:1px dashed var(--line);border-bottom:1px dashed var(--line);display:flex;align-items:center;gap:8px}
  .dist-track .dot{display:inline-block;width:10px;height:10px;border-radius:50%}

  .score-table h3{font-size:16px;margin-bottom:12px}
  .avg-table{width:100%;border-collapse:collapse}
  .avg-table th,.avg-table td{padding:12px 8px;text-align:left;font-size:14px;border-top:1px solid var(--line)}
  .avg-table thead th{border-top:0;color:var(--muted);font-weight:500}

  @media(max-width:860px){
    .metric-head{display:none}
    .metric-row{grid-template-columns:1fr auto;grid-template-areas:"name delta" "current reference" "samples samples";row-gap:6px}
    .metric-name{grid-area:name}
    .metric-delta{grid-area:delta;text-align:right}
    .metric-value{grid-area:current}
    .metric-value.reference{grid-area:reference;text-align:right}
    .metric-samples{grid-area:samples}
    .detail-grid{grid-template-columns:1fr}
  }
  @media(max-width:600px){
    .compare-page{padding-top:24px}
    h1{font-size:28px}
    .metric-value{font-size:17px}
  }
</style>
