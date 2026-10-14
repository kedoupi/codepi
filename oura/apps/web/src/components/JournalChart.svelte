<script lang="ts">
  import type { Locale } from "../lib/i18n";
  import { finite } from "../lib/health";
  import { mean, type JournalSeries } from "../lib/journal";

  let {
    series, label, locale, kind = "line", unit = "", compact = false,
    average = false, band = null, height = 180,
  }: {
    series: JournalSeries[];
    label: string;
    locale: Locale;
    kind?: "line" | "bar";
    unit?: string;
    compact?: boolean;
    average?: boolean;
    band?: { low: number; high: number } | null;
    height?: number;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let unavailable = $state(false);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const hasValues = $derived(series.some(s => s.points.some(p => finite(p.value))));
  const dates = $derived(series[0]?.points.map(p => p.date) ?? []);
  const number = (value: number | null | undefined) => finite(value)
    ? new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en", { maximumFractionDigits: 1 }).format(value) : "—";

  $effect(() => {
    const el = canvas;
    const data = series;
    const chartBand = band;
    const chartKind = kind;
    const spark = compact;
    const showAverage = average;
    // These are display dependencies; changing language or units rebuilds the chart.
    void locale;
    void unit;
    if (!el || !hasValues) return;
    if (typeof Chart === "undefined") { unavailable = true; return; }
    unavailable = false;
    const points = data[0]?.points ?? [];
    const datasets: Record<string, unknown>[] = [];
    if (chartBand) {
      datasets.push(
        { type: "line", label: "band-low", data: points.map(() => chartBand.low), borderWidth: 0, pointRadius: 0, fill: false },
        { type: "line", label: "band-high", data: points.map(() => chartBand.high), borderWidth: 0, pointRadius: 0, backgroundColor: "#60765c18", fill: "-1" },
      );
    }
    for (const item of data) {
      const last = item.points.map(p => finite(p.value)).lastIndexOf(true);
      datasets.push({
        type: chartKind, label: item.label, data: item.points.map(p => p.value),
        borderColor: item.color, borderWidth: chartKind === "bar" ? 0 : 1.8,
        backgroundColor: chartKind === "bar"
          ? item.points.map((_, index) => index === last ? "#ad491e" : item.color) : item.color,
        borderRadius: chartKind === "bar" ? 2 : 0,
        pointRadius: spark ? 0 : points.length <= 14 ? 3 : 1.5,
        pointHoverRadius: 5, pointHitRadius: 16, spanGaps: false,
        tension: 0.15, maxBarThickness: 40, categoryPercentage: 0.8, barPercentage: 0.85,
      });
    }
    const avg = showAverage ? mean(points) : null;
    if (finite(avg)) datasets.push({
      type: "line", label: text("区间均值", "Period mean"),
      data: points.map(() => avg), borderColor: data[0].color,
      borderWidth: 1, borderDash: [5, 4], pointRadius: 0, fill: false,
    });
    const chart = new Chart(el, {
      type: chartKind,
      data: { labels: points.map(p => p.date.slice(5).replace("-", "/")), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !spark, backgroundColor: "#fffdf9", titleColor: "#202927", bodyColor: "#202927",
            borderColor: "#d9d6cd", borderWidth: 1, padding: 12, displayColors: true,
            filter: (item: { dataset: { label: string } }) => !item.dataset.label.startsWith("band-"),
            callbacks: {
              title: (items: { dataIndex: number }[]) => points[items[0]?.dataIndex]?.date ?? "",
              label: (item: { dataset: { label: string }; parsed: { y: number | null } }) =>
                `${item.dataset.label}: ${number(item.parsed.y)} ${unit}`,
            },
          },
        },
        scales: {
          x: {
            display: !spark, grid: { display: false }, border: { color: "#ddd8cf" },
            ticks: { color: "#626a68", maxRotation: 0, autoSkip: true, maxTicksLimit: points.length <= 7 ? 7 : 7, font: { size: 11 } },
          },
          y: {
            display: !spark, beginAtZero: true,
            suggestedMax: unit === text("分", "score") ? 100 : undefined,
            border: { display: false },
            grid: { color: "#e8e3db", drawTicks: false },
            ticks: { color: "#626a68", maxTicksLimit: 5, padding: 8, font: { size: 11 } },
            title: { display: !spark && !!unit, text: unit, color: "#626a68", align: "end", font: { size: 10 } },
          },
        },
      },
    });
    return () => chart.destroy();
  });
</script>

<div class="journal-chart" class:compact style:--plot-height={`${height}px`}>
  {#if hasValues}
    <div class="plot" role="img" aria-label={label}><canvas bind:this={canvas} aria-hidden="true"></canvas></div>
    {#if unavailable && !compact}<p role="status">{text("图表暂未加载，可展开数据表查看。", "Chart unavailable. Open the data table below.")}</p>{/if}
  {:else}
    <div class="plot chart-empty">{compact ? "—" : text("此区间暂无可绘制的记录", "No recorded values in this range")}</div>
  {/if}
  {#if !compact}
    <div class="plot-key">
      {#each series as item}<span><i style:background={item.color}></i>{item.label}</span>{/each}
      {#if average && hasValues}<span>{text("虚线：区间均值", "Dashed: period mean")}</span>{/if}
      {#if band}<span>{text("浅色带：此前记录的中间 50%", "Band: middle 50% of earlier records")}</span>{/if}
    </div>
    <details class="chart-data">
      <summary>{text("查看数据表", "View data table")}</summary>
      <!-- Keyboard users need to scroll the bounded data region. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="table-scroll" tabindex="0" role="region" aria-label={label}>
        <table>
          <caption>{label}{unit ? ` (${unit})` : ""}</caption>
          <thead><tr><th scope="col">{text("日期", "Date")}</th>{#each series as item}<th scope="col">{item.label}</th>{/each}</tr></thead>
          <tbody>{#each dates as date, index}<tr><th scope="row">{date}</th>{#each series as item}<td>{number(item.points[index]?.value)}</td>{/each}</tr>{/each}</tbody>
        </table>
      </div>
    </details>
  {/if}
</div>

<style>
  .journal-chart { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; }
  .plot { height: var(--plot-height); position: relative; min-width: 0; grid-column: 1 / -1; }
  .plot canvas { max-width: 100%; }
  .chart-empty { display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 13px; border-bottom: 1px solid var(--line); }
  .compact .chart-empty { border: 0; }
  .plot-key { display: flex; gap: 8px 16px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-top: 10px; }
  .plot-key span { display: inline-flex; align-items: center; gap: 6px; }
  .plot-key i { width: 7px; height: 7px; border-radius: 50%; }
  .chart-data { margin-top: 8px; font-size: 12px; color: var(--muted); }
  .chart-data[open] { grid-column: 1 / -1; }
  /* Author display rules on table parts override the UA's closed-details hiding. */
  .chart-data:not([open]) > *:not(summary) { display: none; }
  summary { cursor: pointer; width: fit-content; padding: 5px 0; }
  summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
  .table-scroll { overflow: auto; max-height: 300px; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  caption { text-align: left; padding-bottom: 8px; }
  th, td { padding: 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
  th:first-child { text-align: left; }
  tbody th { font-weight: 400; }
  p { font-size: 12px; color: var(--muted); }
  @media (max-width: 480px) { .journal-chart { column-gap: 8px; } .plot-key { font-size: 11px; } }
</style>
