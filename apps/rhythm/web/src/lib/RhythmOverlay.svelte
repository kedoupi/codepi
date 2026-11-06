<script lang="ts" module>
  let overlayCounter = 0;
</script>

<script lang="ts">
  import { clockText, dayTypeText, shortDate, weekdayText, type TrendDay } from "./trends";

  let { days }: { days: TrendDay[] } = $props();

  const patternId = `rhythm-overlay-hatch-${++overlayCounter}`;
  // 横向百分比：左侧 10% 放日期，右侧 89% 是 0–24 点。
  const left = 10;
  const plotWidth = 89;
  const rowHeight = 16;
  const rowGap = 6;
  const height = $derived(days.length * (rowHeight + rowGap) + 28);
  let selected = $state<string | null>(null);
  const selectedDay = $derived(days.find(day => day.date === selected) ?? null);

  function x(minute: number) { return left + (Math.max(0, Math.min(1440, minute)) / 1440) * plotWidth; }
  const pct = (value: number) => `${value}%`;

  function describe(day: TrendDay): string {
    const head = `${shortDate(day.date)} ${weekdayText(day.date)} · ${dayTypeText(day.dayType)}`;
    if (!day.metrics) return `${head}：没有汇总（未知）`;
    if (!known(day.metrics)) return `${head}：数据不足，画不出作息（未知）`;
    const m = day.metrics;
    return `${head}：离家 ${clockText(m.leaveHomeMinute)}，开始办公 ${clockText(m.startWorkMinute)}，离开电脑 ${clockText(m.leaveComputerMinute)}，到家 ${clockText(m.arriveHomeMinute)}${day.partial ? "（今天还没过完）" : ""}`;
  }

  /** 这一天能不能画：有出门 / 办公区间，或确定全天在家；否则整行画成未知斜纹。 */
  function known(m: NonNullable<TrendDay["metrics"]>): boolean {
    const out = m.leaveHomeMinute !== null && m.arriveHomeMinute !== null && m.arriveHomeMinute > m.leaveHomeMinute;
    const office = m.startWorkMinute !== null && m.leaveComputerMinute !== null && m.leaveComputerMinute > m.startWorkMinute;
    const home = m.leaveHomeMinute === null && m.startWorkMinute === null && (m.homeMinutes ?? 0) > 0;
    return out || office || home;
  }

  function toggle(date: string) { selected = selected === date ? null : date; }
</script>

<figure class="chart overlay-chart">
  <svg width="100%" {height} role="group" aria-label="每天一条作息时间线">
    <defs>
      <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" class="hatch-bg"></rect>
        <rect width="3" height="6" class="hatch-fg"></rect>
      </pattern>
    </defs>
    {#each [0, 6, 12, 18, 24] as hour}
      <line class="grid" x1={pct(x(hour * 60))} x2={pct(x(hour * 60))} y1="0" y2={height - 20}></line>
      <text class="tick" x={pct(x(hour * 60))} y={height - 6} text-anchor="middle">{String(hour).padStart(2, "0")}:00</text>
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
        <rect class="hit" x={pct(left)} y={top} width={pct(plotWidth)} height={rowHeight}></rect>
        {#if !m || !known(m)}
          <rect x={pct(left)} y={top} width={pct(plotWidth)} height={rowHeight} fill={`url(#${patternId})`}></rect>
        {:else}
          <rect class="track" x={pct(left)} y={top} width={pct(plotWidth)} height={rowHeight}></rect>
          {#if m.leaveHomeMinute !== null && m.arriveHomeMinute !== null && m.arriveHomeMinute > m.leaveHomeMinute}
            <rect data-series="commute" x={pct(x(m.leaveHomeMinute))} y={top} width={pct(x(m.arriveHomeMinute) - x(m.leaveHomeMinute))} height={rowHeight}></rect>
          {/if}
          {#if m.startWorkMinute !== null && m.leaveComputerMinute !== null && m.leaveComputerMinute > m.startWorkMinute}
            <rect data-series="office_active" x={pct(x(m.startWorkMinute))} y={top} width={pct(x(m.leaveComputerMinute) - x(m.startWorkMinute))} height={rowHeight}></rect>
          {#if m.officeMeetingMinutes && m.startWorkMinute !== null}
            <rect data-series="office_meeting" x={pct(x(m.startWorkMinute))} y={top} width={pct((m.officeMeetingMinutes / 1440) * plotWidth)} height={rowHeight}></rect>
          {/if}
          {/if}
          {#if m.leaveHomeMinute === null && m.startWorkMinute === null && (m.homeMinutes ?? 0) > 0}
            <rect data-series="home" x={pct(left)} y={top} width={pct(plotWidth)} height={rowHeight} opacity="0.55"></rect>
          {/if}
        {/if}
      </g>
    {/each}
  </svg>
  {#if selectedDay}<figcaption class="chart-detail">{describe(selectedDay)}</figcaption>{/if}
</figure>
