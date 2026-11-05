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
    counts: { today: number; pool: number; done: number; deleted: number };
    date: string;
  };
  let data = $state<TodayData | null>(null);
  let error = $state("");
  let busy = $state("");
  let tab = $state<Tab>("today");
  let mobile = $state(false);

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
    const media = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 767px)")
      : null;
    const updateMobile = () => (mobile = media?.matches ?? false);
    updateMobile();
    media?.addEventListener("change", updateMobile);
    void load();
    return () => media?.removeEventListener("change", updateMobile);
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
    return task.due ? `截止 ${task.due.slice(5)} ${weekday(task.due)}` : "";
  }

  function poolDue(task: TaskBrief) {
    return task.due ? `截止 ${task.due.slice(5)} ${weekday(task.due)}` : "";
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
  <nav class="today-tabs" aria-label="今天看板" role={mobile ? "tablist" : undefined}>
    <button id="today-tab-today" class:active={tab === "today"} aria-selected={mobile ? tab === "today" : undefined} aria-controls={mobile ? "today-panel-today" : undefined} role={mobile ? "tab" : undefined} onclick={() => (tab = "today")}>今天</button>
    <button id="today-tab-pool" class:active={tab === "pool"} aria-selected={mobile ? tab === "pool" : undefined} aria-controls={mobile ? "today-panel-pool" : undefined} role={mobile ? "tab" : undefined} onclick={() => (tab = "pool")}>池子</button>
    <button id="today-tab-done" class:active={tab === "done"} aria-selected={mobile ? tab === "done" : undefined} aria-controls={mobile ? "today-panel-done" : undefined} role={mobile ? "tab" : undefined} onclick={() => (tab = "done")}>做完</button>
  </nav>

  <div class="today-board">
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section id="today-panel-pool" class="today-column pool-column" class:mobile-hidden={tab !== "pool"} aria-label="池子" aria-labelledby={mobile ? "today-tab-pool" : undefined} role={mobile ? "tabpanel" : undefined}>
      <div class="today-column-head"><h2>池子</h2><span>{data.pool.length}</span></div>
      {#if groups.length}
        <div class="pool-groups">
          {#each groups as group (group.category)}
            <details open>
              <summary>{group.category}</summary>
              <ul class="pool-list">
                {#each group.items as task (`${task.project}/${task.key}`)}
                  <li>
                    <div class="pool-task"><span>{task.title}</span>{#if task.due}<small>{poolDue(task)}</small>{/if}</div>
                    <div class="pool-actions">
                      <button class="pick-button" disabled={busy !== ""} aria-label={`放进今天：${task.title}`}
                        onclick={() => void mutate("/api/today/pick", task)}>放进今天 →</button>
                      <button class="pick-button" disabled={busy !== ""} aria-label={`删除池子任务：${task.title}`}
                        onclick={() => void mutate("/api/today/delete", task)}>删除</button>
                    </div>
                  </li>
                {/each}
              </ul>
            </details>
          {/each}
        </div>
      {/if}
    </section>

    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section id="today-panel-today" class="today-column main-today-column" class:mobile-hidden={tab !== "today"} aria-label="今天" aria-labelledby={mobile ? "today-tab-today" : undefined} role={mobile ? "tabpanel" : undefined}>
      <div class="today-column-head"><h2>今天</h2><span>{data.today.length}</span></div>
      <div class="today-groups">
        {#each [{ key: "you", label: "你的" }, { key: "agent", label: "建国的" }] as group (group.key)}
          {@const items = data.today.filter(task => task.who === group.key)}
          <section class="today-group" aria-labelledby={`today-group-${group.key}`}>
            <h3 id={`today-group-${group.key}`}>{group.label}</h3>
            <p class="today-group-hint">{group.key === "you" ? "做完点「完成」" : "合并后自动移到做完"}</p>
            {#if items.length}
              <div class="today-cards">
                {#each items as task (`${task.project}/${task.key}`)}
                  <article class="today-card">
                    <div class="today-card-copy"><strong>{task.title}</strong>{#if task.carried || task.due}<span>{dueLine(task)}</span>{/if}</div>
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
    <section id="today-panel-done" class="today-column done-column" class:mobile-hidden={tab !== "done"} aria-label="做完" aria-labelledby={mobile ? "today-tab-done" : undefined} role={mobile ? "tabpanel" : undefined}>
      <div class="today-column-head"><h2>做完</h2><span>{data.done.length}</span></div>
      {#if data.done.length}
        <ul class="done-today-list">
          {#each data.done as task (`${task.project}/${task.key}`)}
            <li><Icon name="check" size={16} /><span>{task.title}</span></li>
          {/each}
        </ul>
      {:else}
        <p class="today-empty done-empty"><span class="desktop-only">还没有</span><span class="mobile-only">今天还没有做完的。</span></p>
      {/if}
    </section>
  </div>
{/if}
