<script lang="ts">
  import {
    PLOT, clockLabel, clockTicks, nightWindow, seriesAxis, seriesSegments, stageRects, timelineBands, xFor,
  } from "../lib/sleep-viz";
  import { finite, duration } from "../lib/health";
  import { type NightTimeline } from "../lib/sleep-model";
  import { chartWidth } from "../lib/chart-size";

  let { timeline, locale, composition = [], averageHr = null, lowestHr = null, averageHrv = null }: {
    timeline: NightTimeline; locale: string;
    composition?: ReadonlyArray<{ key: string; seconds: number | null; color: string }>;
    averageHr?: number | null; lowestHr?: number | null; averageHrv?: number | null;
  } = $props();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  let plotWidth = $state(600);
  const stageHeight = $derived(plotWidth < 480 ? 96 : 142);
  const bandHeight = $derived(plotWidth < 480 ? 72 : 94);
  const window = $derived(nightWindow(timeline));
  const ticks = $derived(clockTicks(window));
  const stageRows = $derived(stageRects(timeline, stageHeight));
  const bands = $derived(timelineBands(timeline, bandHeight));
  const axis = $derived([
    { key: "awake", label: text("清醒", "Awake") }, { key: "rem", label: "REM" },
    { key: "light", label: text("浅睡", "Light") }, { key: "deep", label: text("深睡", "Deep") },
  ]);
  const names = $derived({ deep: text("深睡", "Deep"), rem: "REM", light: text("浅睡", "Light"), awake: text("清醒", "Awake") } as Record<string, string>);
  const scale = $derived(Math.max(1, plotWidth - PLOT.left - PLOT.right) / (PLOT.width - PLOT.left - PLOT.right));
  const sx = (x: number) => PLOT.left + (x - PLOT.left) * scale;
  const tx = (t: number) => sx(xFor(t, window));
  const hrMean = $derived(finite(averageHr) ? averageHr : bands.hr.average);
  const hrMin = $derived(finite(lowestHr) ? lowestHr : timeline.heartRate.length ? Math.min(...timeline.heartRate.map(point => point.value)) : null);
  const hrvMean = $derived(finite(averageHrv) ? averageHrv : bands.hrv.average);
</script>

<figure class="night-chart" aria-label={text("这一晚的睡眠阶段、夜间心率和夜间 HRV", "Sleep stages, overnight heart rate and HRV")}>
  <div class="chart-row stage-row">
    <div class="chart-band-label"><strong>{text("睡眠阶段", "Sleep stages")}</strong></div>
    <div class="chart-plot" use:chartWidth={next => { plotWidth = next; }}>
      <svg viewBox={`0 0 ${plotWidth} ${stageHeight}`} role="img" aria-label={text("睡眠阶段", "Sleep stages")}>
        {#each ticks as tick}
          <line x1={tx(tick)} x2={tx(tick)} y1={PLOT.top} y2={stageHeight - PLOT.bottom} class="grid-line" />
          <text x={tx(tick)} y={stageHeight - 4} class="tick-label">{clockLabel(tick)}</text>
        {/each}
        {#each axis as row, index}
          <text x={PLOT.left - 9} y={PLOT.top + (stageHeight - PLOT.top - PLOT.bottom) / 4 * (index + .5) + 4} class="y-label">{row.label}</text>
        {/each}
        {#each stageRows as rect, index}
          {@const previous = stageRows[index - 1]}
          {#if previous && Math.abs(rect.x - previous.x - previous.width) < 1}
            <line x1={sx(rect.x)} x2={sx(rect.x)} y1={previous.y + Math.min(14, previous.height) / 2} y2={rect.y + Math.min(14, rect.height) / 2} stroke={rect.color} stroke-width=".8" />
          {/if}
          <rect x={sx(rect.x)} y={rect.y} width={Math.max(.5, rect.width * scale)} height={Math.min(14, rect.height)} fill={rect.color} rx="1">
            <title>{names[rect.stage]}</title>
          </rect>
        {/each}
        <line x1={PLOT.left} x2={plotWidth - PLOT.right} y1={stageHeight - PLOT.bottom} y2={stageHeight - PLOT.bottom} class="axis-line" />
      </svg>
    </div>
  </div>
  {#if composition.length}
    <ul class="mobile-composition">
      {#each composition as stage}<li><i style:background={stage.color}></i><span>{names[stage.key]}</span><span>{duration(stage.seconds, locale)}</span></li>{/each}
    </ul>
  {/if}
  {#each [
    { label: text("夜间心率", "Overnight HR"), points: timeline.heartRate, interval: timeline.hrIntervalMinutes, color: bands.hr.color,
      detail: hrMean === null ? "—" : text(`平均 ${Math.round(hrMean)} · 最低 ${hrMin ?? "—"} bpm`, `avg ${Math.round(hrMean)} · low ${hrMin ?? "—"} bpm`) },
    { label: text("夜间 HRV", "Overnight HRV"), points: timeline.hrv, interval: timeline.hrvIntervalMinutes, color: bands.hrv.color,
      detail: hrvMean === null ? "—" : text(`平均 ${Math.round(hrvMean)} ms`, `avg ${Math.round(hrvMean)} ms`) },
  ] as band}
    <div class="chart-row band-row">
      <div class="chart-band-label"><strong>{band.label}</strong><span>{band.detail}</span></div>
      <div class="chart-plot">
        <svg viewBox={`0 0 ${plotWidth} ${bandHeight}`} role="img" aria-label={band.label}>
          {#each ticks as tick}
            <line x1={tx(tick)} x2={tx(tick)} y1={PLOT.top} y2={bandHeight - PLOT.bottom} class="grid-line" />
            <text x={tx(tick)} y={bandHeight - 4} class="tick-label">{clockLabel(tick)}</text>
          {/each}
          {#if band.points.length}
            {#each seriesAxis(band.points, bandHeight).ticks as tick}
              <line x1={PLOT.left} x2={plotWidth - PLOT.right} y1={tick.y} y2={tick.y} class="horizontal-line" />
              <text x={PLOT.left - 8} y={tick.y + 4} class="y-label">{tick.value}</text>
            {/each}
            {#each seriesSegments(band.points, bandHeight, window, band.interval) as path}
              <path d={path} transform={`translate(${PLOT.left} 0) scale(${scale} 1) translate(${-PLOT.left} 0)`}
                fill="none" stroke={band.color} stroke-width="1.7" vector-effect="non-scaling-stroke" />
            {/each}
          {:else}
            <text x={(PLOT.left + plotWidth) / 2} y={bandHeight / 2} class="tick-label">{text("未保存夜间序列", "No overnight series saved")}</text>
          {/if}
          <line x1={PLOT.left} x2={plotWidth - PLOT.right} y1={bandHeight - PLOT.bottom} y2={bandHeight - PLOT.bottom} class="axis-line" />
        </svg>
      </div>
    </div>
  {/each}
</figure>

<style>
  .night-chart { margin: 0; display: grid; gap: 24px; }
  .chart-row { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 8px; align-items: start; }
  .chart-plot { min-width: 0; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .grid-line { stroke: var(--health-chart-grid); stroke-width: .7; stroke-dasharray: 3 3; }
  .horizontal-line { stroke: var(--report-chart-grid); stroke-width: .7; }
  .axis-line { stroke: var(--line); stroke-width: .8; }
  .tick-label { font-size: 10px; fill: var(--muted); text-anchor: middle; }
  .y-label { font-size: 11px; fill: var(--muted); text-anchor: end; }
  .chart-band-label { display: grid; gap: 4px; align-content: start; padding-top: 6px; }
  .chart-band-label strong { font-size: 13px; white-space: nowrap; }
  .chart-band-label span { font-size: 11px; color: var(--muted); line-height: 1.6; }
  .mobile-composition { display: none; }
  @media (max-width: 760px) {
    .night-chart { gap: 12px; }
    .chart-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    .chart-band-label { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-top: 0; }
    .chart-band-label strong { font-size: 18px; }
    .stage-row .chart-band-label strong { font-size: 12px; }
    .chart-band-label span { font-size: 11px; }
    .mobile-composition { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; margin: -4px 0 0; padding: 0 0 12px; list-style: none; border-bottom: 1px solid var(--line); }
    .mobile-composition li { display: grid; grid-template-columns: 9px auto 1fr; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
    .mobile-composition li span:last-child { text-align: right; white-space: nowrap; }
    .mobile-composition i { width: 9px; height: 9px; border-radius: 50%; }
  }
</style>
