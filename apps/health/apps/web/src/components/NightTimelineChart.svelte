<script lang="ts">
  import {
    PLOT, clockLabel, clockTicks, nightWindow, seriesSegments, stageRects, timelineBands, xFor,
  } from "../lib/sleep-viz";
  import { STAGE_COLORS, mergeStages, type NightTimeline } from "../lib/sleep-model";

  let {
    timeline,
    locale,
    stageHeight = 120,
    bandHeight = 96,
  }: {
    timeline: NightTimeline;
    locale: string;
    stageHeight?: number;
    bandHeight?: number;
  } = $props();

  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const window = $derived(nightWindow(timeline));
  const ticks = $derived(clockTicks(window));
  const stageRows = $derived(stageRects(timeline, stageHeight));
  const bands = $derived(timelineBands(timeline, bandHeight));
  const stageAxis = $derived([
    { key: "awake", label: text("清醒", "Awake") },
    { key: "rem", label: "REM" },
    { key: "light", label: text("浅睡", "Light") },
    { key: "deep", label: text("深睡", "Deep") },
  ]);
  const stageLabel = $derived({
    deep: text("深睡", "Deep"),
    rem: "REM",
    light: text("浅睡", "Light"),
    awake: text("清醒", "Awake"),
  } as Record<string, string>);
  const blocks = $derived(mergeStages(timeline.stages));
  const boundaries = $derived(blocks.filter(block => block.t0 > window.min + 15 && block.t0 < window.max - 10).map(block => block.t0));
  const hrMean = $derived(bands.hr.average);
  const hrMin = $derived(timeline.heartRate.length ? Math.min(...timeline.heartRate.map(point => point.value)) : null);
</script>

<figure class="night-chart" aria-label={text("这一晚的睡眠阶段、夜间心率和夜间 HRV", "Sleep stages, overnight heart rate and HRV")}>
  <div class="chart-row">
    <div class="chart-ylabels" style:height={`${stageHeight}px`}>
      {#each stageAxis as row, index}
        <span style:top={`${PLOT.top + (stageHeight - PLOT.top - PLOT.bottom) / 4 * index + (stageHeight - PLOT.top - PLOT.bottom) / 8}px`}>{row.label}</span>
      {/each}
    </div>
    <svg viewBox={`0 0 ${PLOT.width} ${stageHeight}`} class="chart-svg" role="img" aria-label={text("睡眠阶段", "Sleep stages")}>
      {#each boundaries as boundary}
        <line x1={xFor(boundary, window)} x2={xFor(boundary, window)} y1={PLOT.top - 4} y2={stageHeight - PLOT.bottom + 4} class="grid-line" />
      {/each}
      {#each stageRows as rect}
        <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={rect.color} rx="1.5">
          <title>{rect.stage}</title>
        </rect>
      {/each}
      {#each ticks as tick}
        <line x1={xFor(tick, window)} x2={xFor(tick, window)} y1={stageHeight - PLOT.bottom} y2={stageHeight - PLOT.bottom + 4} class="tick-line" />
        <text x={xFor(tick, window)} y={stageHeight - 6} class="tick-label">{clockLabel(tick)}</text>
      {/each}
    </svg>
  </div>

  <div class="chart-row band-row">
    <div class="chart-band-label">
      <strong>{text("夜间心率", "Overnight HR")}</strong>
      <span>{hrMean === null ? "—" : text(`平均 ${Math.round(hrMean)} · 最低 ${hrMin ?? "—"} bpm`, `avg ${Math.round(hrMean)} · low ${hrMin ?? "—"} bpm`)}</span>
    </div>
    <svg viewBox={`0 0 ${PLOT.width} ${bandHeight}`} class="chart-svg" role="img" aria-label={text("夜间心率", "Overnight heart rate")}>
      {#each ticks as tick}
        <line x1={xFor(tick, window)} x2={xFor(tick, window)} y1={PLOT.top} y2={bandHeight - PLOT.bottom} class="grid-line" />
      {/each}
      {#each seriesSegments(timeline.heartRate, bandHeight, window, timeline.hrIntervalMinutes) as path}
        <path d={path} fill="none" stroke={bands.hr.color} stroke-width="1.5" />
      {/each}
      {#each ticks as tick}
        <text x={xFor(tick, window)} y={bandHeight - 6} class="tick-label">{clockLabel(tick)}</text>
      {/each}
    </svg>
  </div>

  <div class="chart-row band-row">
    <div class="chart-band-label">
      <strong>{text("夜间 HRV", "Overnight HRV")}</strong>
      <span>{bands.hrv.average === null ? "—" : text(`平均 ${Math.round(bands.hrv.average)} ms`, `avg ${Math.round(bands.hrv.average)} ms`)}</span>
    </div>
    <svg viewBox={`0 0 ${PLOT.width} ${bandHeight}`} class="chart-svg" role="img" aria-label={text("夜间 HRV", "Overnight HRV")}>
      {#each ticks as tick}
        <line x1={xFor(tick, window)} x2={xFor(tick, window)} y1={PLOT.top} y2={bandHeight - PLOT.bottom} class="grid-line" />
      {/each}
      {#each seriesSegments(timeline.hrv, bandHeight, window, timeline.hrvIntervalMinutes) as path}
        <path d={path} fill="none" stroke={bands.hrv.color} stroke-width="1.5" />
      {/each}
      {#each ticks as tick}
        <text x={xFor(tick, window)} y={bandHeight - 6} class="tick-label">{clockLabel(tick)}</text>
      {/each}
    </svg>
  </div>
  <figcaption class="chart-note">
    {#each Object.entries(STAGE_COLORS) as [stage, color]}
      <span class="legend-item"><i style:background={color}></i>{stageLabel[stage] ?? stage}</span>
    {/each}
    <span class="legend-gap">{text("断开的线段表示记录缺口，未做补齐。", "Broken segments mark recording gaps; nothing is filled in.")}</span>
  </figcaption>
</figure>

<style>
  .night-chart { margin: 0; display: grid; gap: 10px; }
  .chart-row { display: grid; grid-template-columns: 44px 1fr; gap: 8px; align-items: start; }
  .chart-ylabels { position: relative; }
  .chart-ylabels span { position: absolute; right: 0; transform: translateY(-50%); font-size: 11px; color: var(--muted); }
  .chart-svg { width: 100%; height: auto; display: block; }
  .grid-line { stroke: var(--health-chart-grid, rgba(120, 104, 86, .18)); stroke-width: 1; stroke-dasharray: 3 4; }
  .tick-line { stroke: var(--line); stroke-width: 1; }
  .tick-label { font-size: 10px; fill: var(--muted); text-anchor: middle; }
  .band-row { border-top: 1px solid var(--line); padding-top: 12px; }
  .chart-band-label { display: grid; gap: 2px; align-content: start; padding-top: 4px; }
  .chart-band-label strong { font-size: 12px; }
  .chart-band-label span { font-size: 11px; color: var(--muted); line-height: 1.5; }
  .chart-note { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11px; color: var(--muted); align-items: center; }
  .legend-item { display: inline-flex; gap: 6px; align-items: center; }
  .legend-item i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .legend-gap { margin-left: auto; }
  @media (max-width: 640px) {
    .chart-row { grid-template-columns: 34px 1fr; gap: 4px; }
    .legend-gap { margin-left: 0; flex-basis: 100%; }
  }
</style>
