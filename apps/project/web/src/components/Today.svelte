<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import type { TaskBrief } from "../lib/types";
  import Icon from "./Icon.svelte";

  type TodayItem = TaskBrief & { carried: boolean; who: "you" | "agent" };
  type Tab = "today" | "pool" | "done";
  type TodayData = {
    today: TodayItem[];
    pool: TaskBrief[];
    done: TaskBrief[];
    counts: { today: number; pool: number; done: number };
    date: string;
  };

  let data = $state<TodayData | null>(null);
  let error = $state("");
  let busy = $state("");
  let tab = $state<Tab>("today");

  async function load() {
    try {
      data = await api("/api/today") as unknown as TodayData;
      error = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "读取失败";
    }
  }

  async function mutate(path: string, task: TaskBrief) {
    const key = `${path}:${task.project}/${task.key}`;
    if (busy) return;
    busy = key;
    error = "";
    try {
      await api(path, { body: { project: task.project, key: task.key } });
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "操作失败";
    } finally {
      busy = "";
    }
  }

  onMount(() => {
    void load();
  });

  const groups = $derived.by(() => {
    const grouped = new Map<string, TaskBrief[]>();
    for (const task of data?.pool ?? []) {
      const items = grouped.get(task.category) ?? [];
      items.push(task);
      grouped.set(task.category, items);
    }
    return [...grouped.entries()].map(([category, items]) => ({ category, items }));
  });

  const total = $derived((data?.today.length ?? 0) + (data?.done.length ?? 0));
  const progress = $derived(total ? Math.round(((data?.done.length ?? 0) / total) * 100) : 0);

  function dateValue(date: string) {
    return new Date(`${date}T00:00:00+08:00`);
  }

  function weekday(date: string) {
    return new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" }).format(dateValue(date));
  }

  function longDate(date: string) {
    return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", timeZone: "Asia/Shanghai" }).format(dateValue(date));
  }

  function dueLine(task: TodayItem) {
    if (task.carried) return "昨天没做完";
    return task.due ? `截止 ${task.due.slice(5)} ${weekday(task.due)}` : "无截止日";
  }

  function poolDue(task: TaskBrief) {
    return task.due ? `${task.due.slice(5)} ${weekday(task.due)}` : "无截止日";
  }
</script>

{#if error && !data}
  <p class="inline-alert" role="alert">{error}</p>
{:else if !data}
  <p class="loading">正在读取今天的看板…</p>
{:else}
  <header class="today-head">
    <div>
      <h1>今天</h1>
      <p class="today-date"><time datetime={data.date}>{longDate(data.date)} · {weekday(data.date)}</time></p>
    </div>
    <div class="today-progress">
      <span>已完成 {data.done.length} / {total}</span>
      <progress value={progress} max="100" aria-label={`已完成 ${data.done.length} / ${total}`}></progress>
    </div>
  </header>

  {#if error}<p class="inline-alert" role="alert">{error}</p>{/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <nav class="today-tabs" aria-label="今天看板" role="tablist">
    <button id="today-tab-today" class:active={tab === "today"} aria-selected={tab === "today"} aria-controls="today-panel-today" role="tab" onclick={() => (tab = "today")}>今天</button>
    <button id="today-tab-pool" class:active={tab === "pool"} aria-selected={tab === "pool"} aria-controls="today-panel-pool" role="tab" onclick={() => (tab = "pool")}>池子</button>
    <button id="today-tab-done" class:active={tab === "done"} aria-selected={tab === "done"} aria-controls="today-panel-done" role="tab" onclick={() => (tab = "done")}>做完</button>
  </nav>

  <div class="today-board">
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section id="today-panel-pool" class="today-column pool-column" class:mobile-hidden={tab !== "pool"} aria-label="池子" aria-labelledby="today-tab-pool" role="tabpanel">
      <div class="today-column-head"><h2>池子</h2><span>{data.pool.length}</span></div>
      {#if groups.length}
        <div class="pool-groups">
          {#each groups as group (group.category)}
            <details open>
              <summary>{group.category}</summary>
              <ul class="pool-list">
                {#each group.items as task (`${task.project}/${task.key}`)}
                  <li>
                    <div class="pool-task"><span>{task.title}</span><small>{poolDue(task)}</small></div>
                    <button class="pick-button" disabled={busy !== ""} aria-label={`放进今天：${task.title}`}
                      onclick={() => void mutate("/api/today/pick", task)}>放进今天 →</button>
                  </li>
                {/each}
              </ul>
            </details>
          {/each}
        </div>
      {:else}
        <p class="today-empty">池子空了。</p>
      {/if}
    </section>

    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section id="today-panel-today" class="today-column main-today-column" class:mobile-hidden={tab !== "today"} aria-label="今天" aria-labelledby="today-tab-today" role="tabpanel">
      <div class="today-column-head"><h2>今天</h2><span>{data.today.length}</span></div>
      <div class="today-groups">
        {#each [{ key: "you", label: "你的" }, { key: "agent", label: "建国的" }] as group (group.key)}
          {@const items = data.today.filter(task => task.who === group.key)}
          <section class="today-group" aria-labelledby={`today-group-${group.key}`}>
            <h3 id={`today-group-${group.key}`}>{group.label}</h3>
            {#if items.length}
              <div class="today-cards">
                {#each items as task (`${task.project}/${task.key}`)}
                  <article class="today-card">
                    <div class="today-card-copy"><strong>{task.title}</strong><span>{dueLine(task)}</span></div>
                    <div class="today-card-actions">
                      <button class="button" disabled={busy !== ""} onclick={() => void mutate("/api/today/unpick", task)}>退回池子</button>
                      {#if group.key === "you"}
                        <button class="button primary" disabled={busy !== ""} onclick={() => void mutate("/api/today/done", task)}>完成</button>
                      {/if}
                    </div>
                  </article>
                {/each}
              </div>
            {:else}
              <p class="today-empty dashed">从左边池子拿一件过来</p>
            {/if}
          </section>
        {/each}
      </div>
    </section>

    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section id="today-panel-done" class="today-column done-column" class:mobile-hidden={tab !== "done"} aria-label="做完" aria-labelledby="today-tab-done" role="tabpanel">
      <div class="today-column-head"><h2>做完</h2><span>{data.done.length}</span></div>
      {#if data.done.length}
        <ul class="done-today-list">
          {#each data.done as task (`${task.project}/${task.key}`)}
            <li><Icon name="check" size={16} /><span>{task.title}</span></li>
          {/each}
        </ul>
      {:else}
        <p class="today-empty">今天还没有完成的事。</p>
      {/if}
    </section>
  </div>
{/if}
