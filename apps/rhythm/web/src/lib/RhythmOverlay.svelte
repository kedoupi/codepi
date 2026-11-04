<script lang="ts" module>
  let overlayCounter = 0;
</script>

<script lang="ts">
  import { clockText, dayTypeText, shortDate, weekdayText, type TrendDay } from "./trends";

  let { days }: { days: TrendDay[] } = $props();

  const patternId = `rhythm-overlay-hatch-${++overlayCounter}`;
  const left = 64;
  const width = 760;
  const rowHeight = 16;
  const rowGap = 6;
  const plotWidth = width - left - 8;
  const height = $derived(days.length * (rowHeight + rowGap) + 28);
  let selected = $state<string | null>(null);
  const selectedDay = $derived(days.find(day => day.date === selected) ?? null);

  function x(minute: number) { return left + (Math.max(0, Math.min(1440, minute)) / 1440) * plotWidth; }

  function describe(day: TrendDay): string {
    const head = `${shortDate(day.date)} ${weekdayText(day.date)} · ${dayTypeText(day.dayType)}`;
    if (!day.metrics) return `${head}：没有汇总（未知）`;
    const m = day.metrics;
    return `${head}：离家 ${clockText(m.leaveHomeMinute)}，开始办公 ${clockText(m.startWorkMinute)}，离开电脑 ${clockText(m.leaveComputerMinute)}，到家 ${clockText(m.arriveHomeMinute)}${day.partial ? "（今天还没过完）" : ""}`;
  }

  function toggle(date: string) { selected = selected === date ? null : date; }
</script>

<figure class="chart overlay-chart">
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="每天一条作息时间线">
    <defs>
      <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" class="hatch-bg"></rect>
        <rect width="3" height="6" class="hatch-fg"></rect>
      </pattern>
    </defs>
    {#each [0, 6, 12, 18, 24] as hour}
      <line class="grid" x1={x(hour * 60)} x2={x(hour * 60)} y1="0" y2={height - 20}></line>
      <text class="tick" x={x(hour * 60)} y={height - 6} text-anchor="middle">{String(hour).padStart(2, "0")}:00</text>
    {/each}
    {#each days as day, index (day.date)}
      {@const top = index * (rowHeight + rowGap)}
      {@const m = day.metrics}
      <g
        class="bar"
        class:selected={selected === day.date}
        role="button"
        tabindex="0"
        aria-label={describe(day)}
        aria-pressed={selected === day.date}
        onclick={() => toggle(day.date)}
        onkeydown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(day.date); } }}
      >
        <title>{describe(day)}</title>
        <text class="tick row-label" x="0" y={top + rowHeight - 4}>{shortDate(day.date)} {weekdayText(day.date)}</text>
        <rect class="hit" x={left} y={top} width={plotWidth} height={rowHeight}></rect>
        {#if !m}
          <rect x={left} y={top} width={plotWidth} height={rowHeight} fill={`url(#${patternId})`}></rect>
        {:else}
          <rect class="track" x={left} y={top} width={plotWidth} height={rowHeight}></rect>
          {#if m.leaveHomeMinute !== null && m.arriveHomeMinute !== null && m.arriveHomeMinute > m.leaveHomeMinute}
            <rect data-series="commute" x={x(m.leaveHomeMinute)} y={top} width={x(m.arriveHomeMinute) - x(m.leaveHomeMinute)} height={rowHeight}></rect>
          {/if}
          {#if m.startWorkMinute !== null && m.leaveComputerMinute !== null && m.leaveComputerMinute > m.startWorkMinute}
            <rect data-series="office_active" x={x(m.startWorkMinute)} y={top} width={x(m.leaveComputerMinute) - x(m.startWorkMinute)} height={rowHeight}></rect>
          {/if}
          {#if m.leaveHomeMinute === null && m.startWorkMinute === null && (m.homeMinutes ?? 0) > 0}
            <rect data-series="home" x={left} y={top} width={plotWidth} height={rowHeight} opacity="0.55"></rect>
          {/if}
        {/if}
      </g>
    {/each}
  </svg>
  {#if selectedDay}<figcaption class="chart-detail">{describe(selectedDay)}</figcaption>{/if}
</figure>
