<script lang="ts">
  import { weekday } from "../lib/insights-model";

  let {
    series,
    compare = null,
    baseline = null,
    color = "#ad491e",
    compareColor = "#8a8577",
    unit = "",
    format = (value: number) => String(Math.round(value)),
    locale = "zh",
  }: {
    series: Array<{ date: string; value: number | null }>;
    compare?: Array<{ date: string; value: number | null }> | null;
    baseline?: number | null;
    color?: string;
    compareColor?: string;
    unit?: string;
    format?: (value: number) => string;
    locale?: string;
  } = $props();

  const all = $derived([...series, ...(compare ?? [])].map(point => point.value).filter((v): v is number => v !== null));
  const low = $derived(all.length ? Math.min(...all) : 0);
  const high = $derived(all.length ? Math.max(...all) : 1);
  const W = 700; const H = 190; const PADX = 26; const PADT = 24; const PADB = 34;
  const x = (index: number) => PADX + index * (W - PADX * 2) / Math.max(1, series.length - 1);
  const y = (value: number) => {
    const span = Math.max(1e-6, high - low);
    const padded = span * 0.18;
    const lo = low - padded; const hi = high + padded;
    return PADT + (1 - (value - lo) / (hi - lo)) * (H - PADT - PADB);
  };
  function path(points: Array<{ value: number | null }>) {
    let pen = false;
    return points.map((point, index) => point.value === null ? (pen = false, "") : `${pen ? "L" : "M"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}${(pen = true, "")}`).join(" ");
  }
</script>

<div class="mini-line">
  <svg viewBox={`0 0 ${W} ${H}`} role="img">
    {#if baseline !== null}
      <line x1={PADX} x2={W - PADX} y1={y(baseline)} y2={y(baseline)} class="baseline" />
      <text x={W - PADX + 4} y={y(baseline) + 4} class="baseline-label">{format(baseline)}{unit}</text>
    {/if}
    {#if compare}
      <path d={path(compare)} fill="none" stroke={compareColor} stroke-width="1.5" stroke-dasharray="4 4" />
      {#each compare as point, index}
        {#if point.value !== null}<circle cx={x(index)} cy={y(point.value)} r="3" fill={compareColor} />{/if}
      {/each}
    {/if}
    <path d={path(series)} fill="none" stroke={color} stroke-width="2" />
    {#each series as point, index}
      {#if point.value !== null}
        <circle cx={x(index)} cy={y(point.value)} r="3.5" fill={color} />
        <text x={x(index)} y={y(point.value) - 9} class="value-label">{format(point.value)}</text>
      {/if}
    {/each}
  </svg>
  <div class="axis">
    {#each series as point}
      <span><b>{point.date.slice(5).replace("-", "/")}</b><i>{weekday(point.date, locale)}</i></span>
    {/each}
  </div>
</div>

<style>
  .mini-line svg { width: 100%; height: auto; display: block; }
  .baseline { stroke: var(--kdp-line-strong, #b7aca0); stroke-dasharray: 4 4; }
  .baseline-label { font-size: 10px; fill: var(--muted); }
  .value-label { font-size: 11px; fill: var(--ink); text-anchor: middle; font-variant-numeric: tabular-nums; }
  .axis { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; }
  .axis span { display: grid; }
  .axis b { font-size: 11px; font-weight: 500; color: var(--muted); }
  .axis i { font-size: 11px; font-style: normal; color: var(--muted); }
</style>
