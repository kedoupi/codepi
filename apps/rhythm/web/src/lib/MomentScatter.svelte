<script lang="ts">
  import { clockText, dayTypeText, shortDate, weekdayText, type TrendDay } from "./trends";

  type Field = "wakeMinute" | "returnBedroomMinute" | "leaveHomeMinute" | "startWorkMinute" | "leaveComputerMinute" | "arriveHomeMinute";

  let { days, series, label }: {
    days: TrendDay[];
    series: Array<{ field: Field; label: string; shape: "circle" | "square" }>;
    label: string;
  } = $props();

  const left = 44;
  const top = 10;
  const height = 200;
  const bottom = 26;
  const slot = 26;
  const width = $derived(left + Math.max(days.length, 1) * slot);
  const plot = height - top - bottom;
  const points = $derived(days.flatMap((day, index) => day.metrics
    ? series.flatMap(item => {
      const minute = day.metrics?.[item.field] ?? null;
      return minute === null ? [] : [{ day, index, minute, ...item }];
    })
    : []));
  const range = $derived.by(() => {
    if (!points.length) return { min: 0, max: 1440 };
    const values = points.map(point => point.minute);
    const min = Math.max(0, Math.floor((Math.min(...values) - 60) / 60) * 60);
    const max = Math.min(1440, Math.ceil((Math.max(...values) + 60) / 60) * 60);
    return { min, max: Math.max(max, min + 120) };
  });
  const ticks = $derived.by(() => {
    const step = range.max - range.min > 480 ? 180 : 60;
    const result: number[] = [];
    for (let minute = Math.ceil(range.min / step) * step; minute <= range.max; minute += step) result.push(minute);
    return result;
  });
  const labelEvery = $derived(days.length > 14 ? Math.ceil(days.length / 10) : 1);
  let selected = $state<string | null>(null);

  function y(minute: number) { return top + ((minute - range.min) / (range.max - range.min)) * plot; }
  function x(index: number) { return left + index * slot + slot / 2; }
  function describe(point: { day: TrendDay; label: string; minute: number }) {
    return `${shortDate(point.day.date)} ${weekdayText(point.day.date)} · ${dayTypeText(point.day.dayType)} · ${point.label} ${clockText(point.minute)}`;
  }
  const selectedPoint = $derived(points.find(point => `${point.day.date}-${point.field}` === selected) ?? null);
</script>

<figure class="chart">
  {#if points.length}
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label}>
      {#each ticks as tick}
        <line class="grid" x1={left} x2={width} y1={y(tick)} y2={y(tick)}></line>
        <text class="tick" x={left - 6} y={y(tick) + 4} text-anchor="end">{clockText(tick)}</text>
      {/each}
      {#each days as day, index (day.date)}
        {#if index % labelEvery === 0}<text class="tick" x={x(index)} y={height - 8} text-anchor="middle">{shortDate(day.date)}</text>{/if}
      {/each}
      {#each points as point (`${point.day.date}-${point.field}`)}
        {@const key = `${point.day.date}-${point.field}`}
        <g
          class="point"
          class:selected={selected === key}
          data-daytype={point.day.dayType}
          role="button"
          tabindex="0"
          aria-label={describe(point)}
          onclick={() => (selected = selected === key ? null : key)}
          onkeydown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selected = selected === key ? null : key; } }}
        >
          <title>{describe(point)}</title>
          {#if point.shape === "circle"}
            <circle cx={x(point.index)} cy={y(point.minute)} r="5"></circle>
          {:else}
            <rect x={x(point.index) - 4.5} y={y(point.minute) - 4.5} width="9" height="9"></rect>
          {/if}
        </g>
      {/each}
    </svg>
    {#if selectedPoint}<figcaption class="chart-detail">{describe(selectedPoint)}</figcaption>{/if}
  {:else}
    <p class="empty-small">这段时间没有可判断的时刻，全部为未知。</p>
  {/if}
</figure>
