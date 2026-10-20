<script lang="ts">
  import { chartWidth } from "../lib/chart-size";
  let { current, previous, format, axisFormat = format, locale = "zh" }: {
    current: Array<{ date: string; value: number | null }>;
    previous: Array<{ date: string; value: number | null }>;
    format: (value: number | null) => string; axisFormat?: (value: number) => string; locale?: string;
  } = $props();
  let width = $state(320);
  const a = $derived(current.filter(point => point.value !== null));
  const b = $derived(previous.filter(point => point.value !== null));
  const values = $derived([...a, ...b].map(point => point.value!));
  const low = $derived(values.length ? Math.min(...values) : 0);
  const high = $derived(values.length ? Math.max(...values) : 1);
  const pad = $derived(Math.max((high - low) * .25, Math.abs(high) * .03, 1));
  const x = (value: number) => 78 + (value - low + pad) / Math.max(1, high - low + pad * 2) * Math.max(1, width - 94);
  const ticks = $derived(Array.from({ length: 4 }, (_, index) => low - pad + (high - low + pad * 2) * index / 3));
</script>

<div class="distribution" use:chartWidth={next => { width = next; }}>
  <svg viewBox={`0 0 ${width} 180`} role="img" aria-label={locale === "zh" ? "两期分布，每个点代表一天的实际数值" : "Period distributions, one dot per daily value"}>
    {#each ticks as tick}<line x1={x(tick)} x2={x(tick)} y1="20" y2="148" class="grid" /><text x={x(tick)} y="169" class="axis">{axisFormat(tick)}</text>{/each}
    {#each [{ points: a, y: 40, color: "#3b6280", label: locale === "zh" ? "当前区间" : "Current" }, { points: b, y: 108, color: "#999b98", label: locale === "zh" ? "对照区间" : "Reference" }] as group}
      <text x="0" y={group.y + 4} class="label">{group.label}</text><text x="0" y={group.y + 20} class="count">{group.points.length} / {group.points === a ? current.length : previous.length}</text>
      {#if group.points.length}
        {@const min = Math.min(...group.points.map(point => point.value!))}{@const max = Math.max(...group.points.map(point => point.value!))}
        <line x1={x(min)} x2={x(max)} y1={group.y + 18} y2={group.y + 18} class="range" />
        <text x={x(min)} y={group.y + 34} text-anchor="middle" class="count">{format(min)}</text>{#if x(max) - x(min) > 80}<text x={x(max)} y={group.y + 34} text-anchor="middle" class="count">{format(max)}</text>{/if}
        {#each group.points as point, index}<circle cx={x(point.value!)} cy={group.y - (index % 3) * 3} r="3.4" fill={group.color}><title>{point.date}: {format(point.value)}</title></circle>{/each}
      {:else}<text x="100" y={group.y + 4} class="count">{locale === "zh" ? "暂无记录" : "No records"}</text>{/if}
    {/each}
    <line x1="78" x2={width - 16} y1="148" y2="148" class="range" />
  </svg>
</div>

<style>
  .distribution { min-width: 0; }svg { display: block; width: 100%; height: auto; overflow: visible; }
  .grid { stroke: var(--report-chart-grid); stroke-width: .7; }.range { stroke: var(--line); stroke-width: 1; }
  .label { fill: var(--ink); font-size: 12px; font-weight: 600; }.count { fill: var(--muted); font-size: 9px; }.axis { fill: var(--muted); font-size: 9px; text-anchor: middle; }
</style>
