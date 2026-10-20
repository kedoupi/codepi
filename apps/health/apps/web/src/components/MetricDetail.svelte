<script lang="ts">
  import MiniLine from "./MiniLine.svelte";
  import MetricDistribution from "./MetricDistribution.svelte";
  import { duration } from "../lib/health";
  import { peakDates, type Range } from "../lib/insights-model";
  let { metric, ranges, locale, history = false }: {
    metric: { key: string; label: string; unit: string; current: number | null; previous: number | null; delta: string | null;
      series: Array<{ date: string; value: number | null }>; previousSeries: Array<{ date: string; value: number | null }>;
      format: (value: number | null) => string; };
    ranges: { current: Range; previous: Range }; locale: string; history?: boolean;
  } = $props();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  let tab = $state<"daily" | "distribution">("daily");
  const longNights = $derived(peakDates(metric.series, 2));
  const all = $derived([...metric.series, ...metric.previousSeries].map(point => point.value).filter((value): value is number => value !== null));
  const durationDomain = $derived(metric.key === "duration" && all.length ? [Math.max(0, Math.floor(Math.min(...all) / 60) * 60 - 60), Math.ceil(Math.max(...all) / 60) * 60 + 60] as [number, number] : null);
</script>

<div class="detail-content">
  <h2 class="detail-title">{metric.label}{text("：变化发生在哪几天？", ": where did it change?")}</h2>
  <div class="detail-legend report-legend"><span><i class="current"></i>{ranges.current.from.slice(5).replace("-", "/")} — {ranges.current.to.slice(5).replace("-", "/")}</span><span><i class="reference"></i>{ranges.previous.from.slice(5).replace("-", "/")} — {ranges.previous.to.slice(5).replace("-", "/")}</span></div>
  <div class="mobile-detail-tabs report-tabs" role="group" aria-label={text("指标图表", "Metric chart")}><button aria-pressed={tab === "daily"} onclick={() => { tab = "daily"; }}>{text("逐晚记录", "Daily records")}</button><button aria-pressed={tab === "distribution"} onclick={() => { tab = "distribution"; }}>{text("分布", "Distribution")}</button></div>
  <div class="detail-grid">
    <div class="daily-chart" class:mobile-hidden={tab !== "daily"}>
      <h3>{text("逐日记录", "Day by day")} <small>{history ? text("与历史均值对照", "against the historical mean") : text(`按区间第 1 — ${metric.series.length} 天对齐`, `aligned by day 1–${metric.series.length}`)}</small></h3>
      <MiniLine {locale} series={metric.series} compare={history ? null : metric.previousSeries} baseline={history ? metric.previous : null} color="#3b6280" compareColor="#999b98" aligned={!history} domain={durationDomain}
        unit={metric.key === "duration" ? text("小时", "hours") : metric.unit} axisFormat={value => metric.key === "duration" ? String(Math.round(value / 60)) : String(Math.round(value))}
        format={value => metric.key === "duration" ? duration(value * 60, locale).replace(" 小时 ", "h").replace(" 分", "m") : String(Math.round(value * 10) / 10)} label={metric.label} />
    </div>
    <div class="dist-chart" class:mobile-hidden={tab !== "distribution"}><h3>{text("两期的分布", "Distribution")}</h3><p class="hint">{text("每个点代表一天；缺失不补零。", "One dot per day; gaps are not zero-filled.")}</p><MetricDistribution current={metric.series} previous={metric.previousSeries} format={metric.format} axisFormat={value => metric.key === "duration" ? `${Math.round(value / 60 * 10) / 10}${text(" 小时", " h")}` : metric.format(value)} {locale} /></div>
  </div>
  <div class="detail-note"><p>{metric.delta ? text(`均值${metric.delta}。`, `Mean change ${metric.delta}.`) : text("样本不足时保留原值，暂停比较。", "Values are kept; comparison pauses on sparse samples.")}{#if metric.key === "duration" && longNights.length} {text(`${longNights.map(day => day.slice(5).replace("-", "/")).join("、")} 两晚较长。`, `Longer nights: ${longNights.map(day => day.slice(5)).join(", ")}.`)}{/if}</p>{#if metric.key !== "steps" && metric.key !== "stress" && metric.key !== "recovery"}<a href="/sleep" class="report-link">{text("查看对应睡眠", "Open sleep records")} →</a>{/if}</div>
</div>

<style>
  .detail-content { position: relative; padding: 18px 0 0; }.detail-title { color: var(--report-blue); margin-bottom: 16px; }
  .detail-legend { justify-content: flex-end; font-size: 11px; margin: -6px 0 12px; }
  .detail-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 26px; }
  .detail-grid h3 { font-size: 15px; margin-bottom: 8px; }.detail-grid h3 small { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
  .dist-chart { border-left: 1px solid var(--line); padding-left: 24px; }.daily-chart, .dist-chart { min-width: 0; }
  .detail-note { display: flex; align-items: baseline; gap: 18px; font-size: 13px; margin-top: 10px; }.detail-note p { font-weight: 500; }
  .mobile-detail-tabs { display: none; }
  @media(max-width:760px) {
    .detail-content { padding: 10px 0 14px; }.detail-title { display: none; }
    .mobile-detail-tabs { display: flex; gap: 22px; border-bottom: 0; margin-bottom: 6px; width: fit-content; }
    .mobile-detail-tabs button { padding-inline: 4px; font-size: 12px; }
    .detail-legend { position: absolute; top: 12px; right: 0; display: grid; gap: 4px; font-size: 9px; }
    .detail-grid { display: block; }.dist-chart { border-left: 0; padding-left: 0; }.mobile-hidden { display: none; }
    .daily-chart h3, .dist-chart h3 { display: none; }.detail-note { flex-wrap: wrap; justify-content: space-between; gap: 2px 10px; font-size: 11px; }.detail-note .report-link { font-size: 11px; }
  }
</style>
