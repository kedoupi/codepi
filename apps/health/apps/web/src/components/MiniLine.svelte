<script lang="ts">
  import { weekday } from "../lib/insights-model";
  import { chartWidth } from "../lib/chart-size";
  type Point = { date: string; value: number | null };
  let { series, compare = null, baseline = null, color = "#ad491e", compareColor = "#999b98", unit = "",
    format = (value: number) => String(Math.round(value)), axisFormat = (value: number) => String(Math.round(value)),
    locale = "zh", domain = null, aligned = false, label = "" }: {
    series: Point[]; compare?: Point[] | null; baseline?: number | null; color?: string; compareColor?: string; unit?: string;
    format?: (value: number) => string; axisFormat?: (value: number) => string; locale?: string;
    domain?: [number, number] | null; aligned?: boolean; label?: string;
  } = $props();
  let width = $state(600);
  const all = $derived([...series, ...(compare ?? []), ...(baseline === null ? [] : [{ date: "", value: baseline }])].map(point => point.value).filter((v): v is number => v !== null));
  const extent = $derived.by(() => {
    if (domain) return { low: domain[0], high: domain[1] };
    if (!all.length) return { low: 0, high: 1 };
    const min = Math.min(...all), max = Math.max(...all);
    const padding = Math.max(1, (max - min) * .25);
    return { low: Math.max(0, Math.floor(min - padding)), high: Math.ceil(max + padding) };
  });
  const H = $derived(width < 480 ? 116 : 166); const TOP = 22; const BOTTOM = 34; const LEFT = 30;
  const right = $derived(baseline !== null && !compare ? 62 : 12);
  const x = (index: number) => LEFT + 12 + index * Math.max(1, width - LEFT - right - 24) / Math.max(1, series.length - 1);
  const y = (value: number) => TOP + (1 - (value - extent.low) / Math.max(1e-6, extent.high - extent.low)) * (H - TOP - BOTTOM);
  const ticks = $derived(Array.from({ length: 3 }, (_, index) => extent.low + (extent.high - extent.low) * index / 2));
  const labelEvery = $derived(Math.max(1, Math.ceil(series.length / 7)));
  function path(points: Point[]) {
    let pen = false;
    return points.map((point, index) => point.value === null ? (pen = false, "") : `${pen ? "L" : "M"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}${(pen = true, "")}`).join(" ");
  }
</script>

<div class="mini-line" use:chartWidth={next => { width = next; }}>
  <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label || (locale === "zh" ? "逐日记录折线图" : "Daily records")}>
    <text x="0" y="12" class="unit">{unit.trim()}</text>
    {#each ticks as tick}<line x1={LEFT} x2={width - right} y1={y(tick)} y2={y(tick)} class="grid" /><text x={LEFT - 7} y={y(tick) + 4} class="tick">{axisFormat(tick)}</text>{/each}
    {#if baseline !== null && !compare}<line x1={LEFT} x2={width - right} y1={y(baseline)} y2={y(baseline)} class="baseline" /><text x={width - right + 5} y={y(baseline) - 3} class="baseline-label">{locale === "zh" ? "此前均值" : "Prior mean"}</text><text x={width - right + 5} y={y(baseline) + 12} class="baseline-label">{format(baseline)}{unit}</text>{/if}
    {#each compare ? [{ points: compare, color: compareColor, dashed: true }, { points: series, color, dashed: false }] : [{ points: series, color, dashed: false }] as line}
      <path d={path(line.points)} fill="none" stroke={line.color} stroke-width={line.dashed ? 1.5 : 2} stroke-dasharray={line.dashed ? "4 3" : undefined} />
      {#each line.points as point, index}
        {#if point.value !== null}<circle cx={x(index)} cy={y(point.value)} r="3.5" fill={line.color}><title>{point.date}: {format(point.value)}{unit}</title></circle>{#if series.length <= 10}<text x={x(index)} y={y(point.value) + (line.dashed ? 16 : -10)} class="value-label" class:comparison-value={!!compare} fill={line.color}>{format(point.value)}</text>{/if}{/if}
      {/each}
    {/each}
    {#each series as point, index}{#if index % labelEvery === 0 || (index === series.length - 1 && index % labelEvery >= labelEvery / 2)}<text x={x(index)} y={H - 24} class="date">{aligned ? (locale === "zh" ? `第${index + 1}天` : `Day ${index + 1}`) : point.date.slice(5).replace("-", "/")}</text>{#if !aligned}<text x={x(index)} y={H - 8} class="date">{weekday(point.date, locale).replace("周", "")}</text>{/if}{/if}{/each}
    <line x1={LEFT} x2={LEFT} y1={TOP} y2={H - BOTTOM} class="axis" /><line x1={LEFT} x2={width - right} y1={H - BOTTOM} y2={H - BOTTOM} class="axis" />
  </svg>
</div>

<style>
  .mini-line { min-width: 0; width: 100%; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .grid { stroke: var(--report-chart-grid, var(--line)); stroke-width: .7; }
  .axis { stroke: var(--line); stroke-width: 1; }
  .baseline { stroke: #8f999e; stroke-dasharray: 4 3; }
  .baseline-label, .tick, .date, .unit { font-size: 10px; fill: var(--muted); }
  .tick { text-anchor: end; }.date { text-anchor: middle; }
  .value-label { font-size: 10px; text-anchor: middle; font-variant-numeric: tabular-nums; }
  @media(max-width:760px) { .comparison-value { display: none; } .date, .tick, .baseline-label { font-size: 9px; } }
</style>
