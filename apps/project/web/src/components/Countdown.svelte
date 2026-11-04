<script lang="ts">
  import { daysUntil, dueText, NEED_LABEL } from "../lib/format";
  import type { TaskBrief } from "../lib/types";

  let { tasks, today, onOpen, horizon = 45 }: {
    tasks: TaskBrief[];
    today: string;
    onOpen: (project: string, key: string) => void;
    horizon?: number;
  } = $props();

  const W = 200;
  const rows = $derived(tasks.filter(task => task.due).map(task => ({ task, n: daysUntil(task.due!, today) })));
  const least = $derived(Math.min(0, ...rows.map(row => row.n)));
  const x = (n: number) => ((Math.min(n, horizon) - least) / (horizon - least)) * W;
  const ticks = $derived([0, 7, 14, 30].filter(tick => tick <= horizon));
</script>

{#if rows.length}
  <p class="countdown-key">竖线依次是今天、7、14、30 天；右侧数字是剩余天数。</p>
  <ol class="countdown">
    {#each rows as { task, n } (`${task.project}/${task.key}`)}
      <li>
        <button class="countdown-row" onclick={() => onOpen(task.project, task.key)}
          aria-label={`${task.title}，${dueText(task.due!, today)}${task.need_kind !== "none" ? `，需要你${NEED_LABEL[task.need_kind]}` : ""}`}>
          <span class="countdown-label">{task.title}</span>
          <svg viewBox={`0 0 ${W} 12`} preserveAspectRatio="none" class="bar-track" aria-hidden="true">
            {#each ticks as tick (tick)}
              <line x1={x(tick)} x2={x(tick)} y1="0" y2="12" class={tick === 0 ? "tick zero" : "tick"} />
            {/each}
            <rect x={x(Math.min(0, n))} y="2" height="8" rx="3"
              width={Math.max(3, x(Math.max(0, n)) - x(Math.min(0, n)))}
              class={n < 0 ? "bar late" : task.need_kind !== "none" ? "bar you" : "bar quiet"} />
          </svg>
          <span class="countdown-days">{n < 0 ? `-${-n}` : n > horizon ? `${n}+` : n}</span>
        </button>
      </li>
    {/each}
  </ol>
{:else}
  <p class="empty">没有带截止日期的待办。</p>
{/if}
