<script lang="ts">
  import { weekday } from "../lib/insights-model";

  let {
    series,
    baseline = null,
    color = "#a87950",
    maxValue = null,
    format = (value: number) => String(Math.round(value)),
    locale = "zh",
    unit = "",
  }: {
    series: Array<{ date: string; value: number | null }>;
    baseline?: number | null;
    color?: string;
    maxValue?: number | null;
    format?: (value: number) => string;
    locale?: string;
    unit?: string;
  } = $props();

  const peak = $derived(Math.max(1, maxValue ?? 0, ...series.map(point => point.value ?? 0)));
</script>

<div class="mini-bars" role="img" aria-label="bar chart">
  {#if baseline !== null}
    <span class="baseline" style:bottom={`${baseline / peak * 82 + 14}%`}>
      <em>{format(baseline)}{unit}</em>
    </span>
  {/if}
  {#each series as point}
    <div class="bar-col">
      {#if point.value !== null}
        <span class="value">{format(point.value)}{unit}</span>
        <span class="bar" style:height={`${Math.max(4, point.value / peak * 82)}%`} style:background={color}></span>
      {:else}
        <span class="missing">—</span>
      {/if}
      <span class="date">{point.date.slice(5).replace("-", "/")}</span>
      <span class="weekday">{weekday(point.date, locale)}</span>
    </div>
  {/each}
</div>

<style>
  .mini-bars { position: relative; display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; height: 190px; padding-top: 8px; }
  .bar-col { display: grid; grid-template-rows: auto 1fr auto auto; justify-items: center; gap: 4px; min-width: 0; }
  .value { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .bar { align-self: end; width: 70%; max-width: 34px; border-radius: 4px 4px 0 0; }
  .missing { align-self: end; margin-bottom: 4px; color: var(--muted); }
  .date, .weekday { font-size: 11px; color: var(--muted); }
  .baseline { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--kdp-line-strong, #b7aca0); pointer-events: none; }
  .baseline em { position: absolute; right: 0; top: -18px; font-size: 11px; font-style: normal; color: var(--muted); }
</style>
