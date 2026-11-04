<script lang="ts" module>
  import type { Segment } from "./trends";

  let chartCounter = 0;

  export type BarItem = {
    key: string;
    label: string;
    /** 鼠标悬停与明细里用的完整名称，例如「11/3 周一 · 工作日」。 */
    title: string;
    /** null 表示这一天没有数据：画斜纹，不画成 0。 */
    segments: Segment[] | null;
    partial?: boolean;
    emphasis?: boolean;
  };
</script>

<script lang="ts">

  let {
    items,
    max = null,
    format,
    label,
    reference = null,
    fullUnknown = false,
    height = 180,
  }: {
    items: BarItem[];
    max?: number | null;
    format: (value: number) => string;
    label: string;
    reference?: { value: number; label: string } | null;
    /** 堆叠到固定总量（例如 24 小时）的图：缺失日画满高斜纹。 */
    fullUnknown?: boolean;
    height?: number;
  } = $props();

  const patternId = `rhythm-hatch-${++chartCounter}`;
  const slot = 28;
  const barWidth = 18;
  const top = 8;
  const bottom = 26;
  let selected = $state<string | null>(null);

  const totals = $derived(items.map(item => item.segments?.reduce((sum, segment) => sum + segment.value, 0) ?? null));
  const scaleMax = $derived(Math.max(1, max ?? 0, ...totals.filter((value): value is number => value !== null), reference?.value ?? 0));
  const width = $derived(Math.max(items.length * slot, slot));
  const plot = $derived(height - top - bottom);
  const labelEvery = $derived(items.length > 14 ? Math.ceil(items.length / 10) : 1);
  const selectedItem = $derived(items.find(item => item.key === selected) ?? null);

  function y(value: number) { return top + plot - (value / scaleMax) * plot; }
  function h(value: number) { return (value / scaleMax) * plot; }

  function stacks(segments: Segment[]) {
    let offset = 0;
    return segments.filter(segment => segment.value > 0).map(segment => {
      const start = offset;
      offset += segment.value;
      return { ...segment, start };
    });
  }

  function describe(item: BarItem): string {
    if (!item.segments) return `${item.title}：没有数据（未知）`;
    const parts = item.segments.filter(segment => segment.value > 0).map(segment => `${segment.label} ${format(segment.value)}`);
    return `${item.title}${item.partial ? "（今天还没过完）" : ""}：${parts.length ? parts.join("、") : "0"}`;
  }

  function toggle(key: string) { selected = selected === key ? null : key; }
</script>

<figure class="chart">
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label} preserveAspectRatio="xMinYMid meet">
    <defs>
      <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" class="hatch-bg"></rect>
        <rect width="3" height="6" class="hatch-fg"></rect>
      </pattern>
    </defs>
    <line class="axis" x1="0" x2={width} y1={top + plot} y2={top + plot}></line>
    {#if reference}
      <line class="reference" x1="0" x2={width} y1={y(reference.value)} y2={y(reference.value)}><title>{reference.label}</title></line>
    {/if}
    {#each items as item, index (item.key)}
      {@const x = index * slot + (slot - barWidth) / 2}
      <g
        class="bar"
        class:selected={selected === item.key}
        class:emphasis={item.emphasis}
        role="button"
        tabindex="0"
        aria-label={describe(item)}
        aria-pressed={selected === item.key}
        onclick={() => toggle(item.key)}
        onkeydown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(item.key); } }}
      >
        <title>{describe(item)}</title>
        <rect class="hit" x={index * slot} y={top} width={slot} height={plot}></rect>
        {#if item.segments}
          {#each stacks(item.segments) as segment (segment.key)}
            {#if segment.key === "unknown"}
              <rect x={x} y={y(segment.start + segment.value)} width={barWidth} height={h(segment.value)} fill={`url(#${patternId})`}></rect>
            {:else}
              <rect x={x} y={y(segment.start + segment.value)} width={barWidth} height={h(segment.value)} data-series={segment.key}></rect>
            {/if}
          {/each}
          {#if item.partial}<rect class="partial" x={x} y={top} width={barWidth} height={plot}></rect>{/if}
        {:else}
          <rect x={x} y={fullUnknown ? top : top + plot - 10} width={barWidth} height={fullUnknown ? plot : 10} fill={`url(#${patternId})`}></rect>
        {/if}
        {#if index % labelEvery === 0 || item.emphasis}
          <text class="tick" x={index * slot + slot / 2} y={height - 8} text-anchor="middle">{item.label}</text>
        {/if}
      </g>
    {/each}
  </svg>
  {#if selectedItem}
    <figcaption class="chart-detail">{describe(selectedItem)}</figcaption>
  {/if}
</figure>
