<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { daysUntil, NEED_LABEL, STATUS_LABEL, STATUS_ORDER } from "../lib/format";
  import type { ProjectSummary, TaskBrief, WorkStatus } from "../lib/types";
  import TaskCard from "./TaskCard.svelte";

  let { projects, onOpen }: { projects: ProjectSummary[]; onOpen: (project: string, key: string) => void } = $props();

  let tasks = $state<TaskBrief[]>([]);
  let today = $state("");
  let loaded = $state(false);
  let error = $state("");
  const initial = new URLSearchParams(location.search);
  let project = $state(initial.get("project") ?? "");
  let category = $state(initial.get("category") ?? "");
  let status = $state<WorkStatus | "">((initial.get("status") as WorkStatus) ?? "");
  let need = $state(initial.get("need") === "any");
  let due = $state(initial.get("due") ?? "");
  let query = $state("");

  onMount(async () => {
    try {
      const [list, overview] = await Promise.all([api("/api/tasks?include_done=1"), api("/api/overview")]);
      tasks = list.tasks as TaskBrief[];
      today = String(overview.today);
      loaded = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "读取失败";
    }
  });

  const weekAgo = Date.now() - 7 * 86400_000;
  const visible = $derived(tasks.filter(task => {
    if (task.done_at && Date.parse(task.done_at) < weekAgo) return false;
    if (project && task.project !== project) return false;
    if (category && task.category !== category) return false;
    if (need && (task.need_kind === "none" || task.done_at)) return false;
    if (due === "late" && !(task.due && !task.done_at && daysUntil(task.due, today) < 0)) return false;
    if (due === "7" && !(task.due && !task.done_at && daysUntil(task.due, today) <= 7)) return false;
    if (query && !`${task.title} ${task.category}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }));
  const categories = $derived([...new Set(tasks.filter(task => !project || task.project === project).map(task => task.category))]);
  const open = $derived(tasks.filter(task => !task.done_at && (!project || task.project === project)));
  const heat = $derived(categories.map(name => ({
    name,
    cells: STATUS_ORDER.map(state => open.filter(task => task.category === name && task.status === state).length),
  })));
  const heatMax = $derived(Math.max(1, ...heat.flatMap(row => row.cells)));
  const level = (n: number) => (n === 0 ? 0 : Math.max(1, Math.ceil((n / heatMax) * 4)));
  const columns = $derived([
    ...STATUS_ORDER.filter(state => !status || state === status).map(state => ({
      id: state, label: STATUS_LABEL[state], items: visible.filter(task => !task.done_at && task.status === state),
    })),
    ...(status ? [] : [{ id: "done", label: "最近完成", items: visible.filter(task => task.done_at) }]),
  ]);
  const filtered = $derived(Boolean(project || category || status || need || due || query));

  function clear() {
    project = category = due = query = "";
    status = "";
    need = false;
  }
</script>

{#if error}
  <p class="inline-alert" role="alert">{error}</p>
{:else if !loaded}
  <p class="loading">正在读取看板…</p>
{:else}
  <header class="page-head">
    <h1>看板 <span class="muted">{open.length} 条未完成</span></h1>
  </header>

  <section class="panel heat-panel">
    <h2>领域 × 状态 <small>点格子筛选</small></h2>
    <div class="heat-scroll">
      <table class="heat">
        <thead><tr><th scope="col"><span class="sr-only">领域</span></th>
          {#each STATUS_ORDER as state (state)}<th scope="col">{STATUS_LABEL[state]}</th>{/each}</tr></thead>
        <tbody>
          {#each heat as row (row.name)}
            <tr>
              <th scope="row">{row.name}</th>
              {#each row.cells as n, index (index)}
                <td>
                  <button class={`heat-cell heat-${level(n)}`} disabled={n === 0}
                    aria-pressed={category === row.name && status === STATUS_ORDER[index]}
                    aria-label={`${row.name} ${STATUS_LABEL[STATUS_ORDER[index]]} ${n} 条`}
                    onclick={() => {
                      const same = category === row.name && status === STATUS_ORDER[index];
                      category = same ? "" : row.name;
                      status = same ? "" : STATUS_ORDER[index];
                    }}>{n || ""}</button>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <div class="filters">
    {#if projects.length > 1}
      <select aria-label="项目" bind:value={project}>
        <option value="">全部项目</option>
        {#each projects as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
      </select>
    {/if}
    <button class="pill" aria-pressed={need} onclick={() => (need = !need)}>只看需要你</button>
    {#if category}<button class="pill on" onclick={() => (category = "")}>{category} ×</button>{/if}
    {#if status}<button class="pill on" onclick={() => (status = "")}>{STATUS_LABEL[status]} ×</button>{/if}
    {#if due}<button class="pill on" onclick={() => (due = "")}>{due === "late" ? "逾期" : "7 天内到期"} ×</button>{/if}
    {#if filtered}<button class="link-button" onclick={clear}>清除筛选</button>{/if}
    <input type="search" aria-label="搜索待办" placeholder="搜索" bind:value={query} />
  </div>

  <div class="board">
    {#each columns as column (column.id)}
      <section class="column" aria-label={column.label}>
        <h2>{column.label}<span class="count">{column.items.length}</span></h2>
        {#each column.items as task (`${task.project}/${task.key}`)}
          <TaskCard {task} {today} {projects} {onOpen} />
        {:else}
          <p class="empty">—</p>
        {/each}
      </section>
    {/each}
  </div>
  <p class="footnote">需要你：{Object.entries(NEED_LABEL).filter(([kind]) => kind !== "none").map(([, label]) => label).join(" / ")}。完成的事从仓库待办里删掉后，下一次推送会自动移到「最近完成」。</p>
{/if}
