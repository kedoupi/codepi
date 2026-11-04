<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { longDay, projectSlot } from "../lib/format";
  import type { LogItem, ProjectSummary } from "../lib/types";
  import Icon from "./Icon.svelte";

  let { projects }: { projects: ProjectSummary[] } = $props();
  let items = $state<LogItem[]>([]);
  let loaded = $state(false);
  let error = $state("");
  let project = $state("");

  onMount(async () => {
    try {
      items = (await api("/api/log?days=30")).items as LogItem[];
      loaded = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "读取失败";
    }
  });

  const shown = $derived(items.filter(item => !project || item.project === project));
  const days = $derived([...new Set(shown.map(item => item.date))]);
  const perDay = $derived(days.map(day => ({ day, n: shown.filter(item => item.date === day).length })));
  const maxDay = $derived(Math.max(1, ...perDay.map(entry => entry.n)));
  const name = (id: string) => projects.find(item => item.id === id)?.name ?? id;
</script>

{#if error}
  <p class="inline-alert" role="alert">{error}</p>
{:else if !loaded}
  <p class="loading">正在读取动态…</p>
{:else}
  <header class="page-head">
    <h1>动态 <span class="muted">最近 30 天</span></h1>
    {#if projects.length > 1}
      <select aria-label="项目" bind:value={project}>
        <option value="">全部项目</option>
        {#each projects as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
      </select>
    {/if}
  </header>
  {#if perDay.length}
    <section class="panel">
      <h2>每天的变更与完成 <small>柱高是条数</small></h2>
      <svg class="activity" viewBox={`0 0 ${perDay.length * 10} 40`} preserveAspectRatio="none" role="img"
        aria-label={perDay.map(entry => `${entry.day} ${entry.n} 条`).join("，")}>
        {#each [...perDay].reverse() as entry, index (entry.day)}
          <rect x={index * 10 + 2} y={40 - (entry.n / maxDay) * 38} width="6" height={(entry.n / maxDay) * 38} rx="1" class="activity-bar" />
        {/each}
      </svg>
    </section>
  {/if}
  {#each days as day (day)}
    <section class="log-day">
      <h2>{longDay(day)}</h2>
      <ul class="log-list">
        {#each shown.filter(item => item.date === day) as item, index (index)}
          <li class:done={item.kind === "done"}>
            <span class={`dot slot-${projectSlot(projects, item.project)}`} title={name(item.project)}></span>
            {#if item.kind === "done"}<span class="chip ok"><Icon name="check" size={12} />完成</span>{/if}
            <span>{item.title}</span>
            {#if projects.length > 1}<span class="muted">{name(item.project)}</span>{/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="empty">最近 30 天没有动态。</p>
  {/each}
{/if}
