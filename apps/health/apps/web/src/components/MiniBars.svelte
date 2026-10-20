<script lang="ts">
  import { weekday } from "../lib/insights-model";
  import { chartWidth } from "../lib/chart-size";
  type Point = { date: string; value: number | null };
  let { series, compare = null, baseline = null, color = "#87a0b0", compareColor = "#738772", maxValue = null,
    format = (value: number) => String(Math.round(value)), axisFormat = (value: number) => String(Math.round(value)), locale = "zh", unit = "", label = "" }: {
    series: Point[]; compare?: Point[] | null; baseline?: number | null; color?: string; compareColor?: string;
    maxValue?: number | null; format?: (value: number) => string; axisFormat?: (value: number) => string;
    locale?: string; unit?: string; label?: string;
  } = $props();
  let width = $state(600);
  const H = $derived(width < 480 ? 112 : 172); const TOP = 22; const BOTTOM = 34; const LEFT = 30;
  const right = $derived(baseline === null ? 8 : 66);
  const inner = $derived(Math.max(1, width - LEFT - right));
  const slot = $derived(inner / Math.max(1, series.length));
  const peak = $derived(Math.max(1, maxValue ?? 0, baseline ?? 0, ...[...series, ...(compare ?? [])].map(point => point.value ?? 0)));
  const y = (value: number) => TOP + (1 - value / peak) * (H - TOP - BOTTOM);
  const ticks = $derived(Array.from({ length: 4 }, (_, index) => peak * index / 3));
  const x = (index: number) => LEFT + slot * (index + .5);
  const barWidth = $derived(Math.min(compare ? 24 : 40, slot * (compare ? .3 : .58)));
</script>

<div class="mini-bars" class:duration-chart={unit === "小时" || unit === "hours"} use:chartWidth={next => { width = next; }}>
  <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label || (locale === "zh" ? "每日记录柱状图" : "Daily records")}>
    <text x="0" y="12" class="unit">{unit}</text>
    {#each ticks as tick}<line x1={LEFT} x2={width - right} y1={y(tick)} y2={y(tick)} class="grid" /><text x={LEFT - 8} y={y(tick) + 4} class="tick">{axisFormat(tick)}</text>{/each}
    {#if baseline !== null}<line x1={LEFT} x2={width - right} y1={y(baseline)} y2={y(baseline)} class="baseline" /><text x={width - right + 5} y={y(baseline) - 3} class="baseline-label">{locale === "zh" ? "此前均值" : "Prior mean"}</text><text x={width - right + 5} y={y(baseline) + 12} class="baseline-label">{format(baseline)}</text>{/if}
    {#each series as point, index}
      {#each compare ? [point, compare[index]] : [point] as item, group}
        {@const center = x(index) + (compare ? (group === 0 ? -.55 : .55) * barWidth : 0)}
        {#if item?.value !== null && item?.value !== undefined}
          <rect x={center - barWidth / 2} y={y(item.value)} width={barWidth} height={Math.max(0, H - BOTTOM - y(item.value))} rx="2" fill={group === 1 ? compareColor : color} opacity={index === series.length - 1 ? 1 : .8}><title>{item.date}: {format(item.value)}</title></rect>
          <text x={center} y={y(item.value) - 6} class="value" class:sleep-value={unit === "小时" || unit === "hours"}>{format(item.value)}</text>
        {:else}<text x={center} y={H - BOTTOM - 5} class="value">—</text>{/if}
      {/each}
      <text x={x(index)} y={H - 24} class="date">{point.date.slice(5).replace("-", "/")}</text>
      <text x={x(index)} y={H - 8} class="date">{weekday(point.date, locale).replace("周", "")}</text>
    {/each}
    <line x1={LEFT} x2={LEFT} y1={TOP} y2={H - BOTTOM} class="axis" /><line x1={LEFT} x2={width - right} y1={H - BOTTOM} y2={H - BOTTOM} class="axis" />
  </svg>
</div>

<style>
  .mini-bars { min-width: 0; width: 100%; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .grid { stroke: var(--report-chart-grid, var(--line)); stroke-width: .7; }
  .axis { stroke: var(--line); stroke-width: 1; }
  .baseline { stroke: #78909f; stroke-width: 1; stroke-dasharray: 4 3; }
  .tick, .date, .unit, .baseline-label { font-size: 10px; fill: var(--muted); }
  .tick { text-anchor: end; }.date, .value { text-anchor: middle; }
  .value { font-size: 10px; fill: var(--muted); font-variant-numeric: tabular-nums; }
  @media(max-width:760px) { .sleep-value { display: none; } .value, .date, .tick { font-size: 9px; } .baseline-label { font-size: 9px; } }
</style>
