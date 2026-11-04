<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { ago, dueText, dueTone, longDay, NEED_LABEL, NEED_ORDER, projectSlot } from "../lib/format";
  import type { Overview, ProjectSummary } from "../lib/types";
  import Countdown from "./Countdown.svelte";
  import Icon from "./Icon.svelte";

  let { projects, onOpen, onNavigate }: {
    projects: ProjectSummary[];
    onOpen: (project: string, key: string) => void;
    onNavigate: (path: string) => void;
  } = $props();

  let data = $state<Overview | null>(null);
  let error = $state("");

  onMount(async () => {
    try {
      data = await api("/api/overview") as unknown as Overview;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "读取失败";
    }
  });

  const name = (id: string) => projects.find(project => project.id === id)?.name ?? id;
  const needMix = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const task of data?.need_you ?? []) counts.set(task.need_kind, (counts.get(task.need_kind) ?? 0) + 1);
    return NEED_ORDER.filter(kind => counts.get(kind)).map(kind => ({ kind, n: counts.get(kind)! }));
  });
</script>

{#if error}
  <p class="inline-alert" role="alert">{error}</p>
{:else if !data}
  <p class="loading">正在读取今天的待办…</p>
{:else}
  <header class="page-head">
    <h1>今天 <span class="muted">{longDay(data.today)}</span></h1>
    <span class="stamp">最近推送 {ago(data.projects.map(p => p.last_push_at).filter(Boolean).sort().at(-1) ?? null)}</span>
  </header>

  <section class="kpis" aria-label="概览">
    <a class="kpi you" href="/board?need=any" onclick={event => { event.preventDefault(); onNavigate("/board?need=any"); }}>
      <Icon name="attend" size={22} /><span><b>{data.counts.need_you}</b>需要你</span></a>
    <a class="kpi late" href="/board?due=late" onclick={event => { event.preventDefault(); onNavigate("/board?due=late"); }}>
      <Icon name="alert" size={22} /><span><b>{data.counts.overdue}</b>逾期</span></a>
    <a class="kpi soon" href="/board?due=7" onclick={event => { event.preventDefault(); onNavigate("/board?due=7"); }}>
      <Icon name="clock" size={22} /><span><b>{data.counts.due_7d}</b>7 天内到期</span></a>
    <a class="kpi" href="/board" onclick={event => { event.preventDefault(); onNavigate("/board"); }}>
      <Icon name="branch" size={22} /><span><b>{data.counts.branches}</b>进行中分支</span></a>
  </section>

  <div class="grid-2">
    <section class="panel">
      <h2>需要你 <small>按截止</small></h2>
      {#if needMix.length}
        <div class="mix" role="img" aria-label={needMix.map(item => `${NEED_LABEL[item.kind]} ${item.n} 条`).join("，")}>
          <svg viewBox={`0 0 ${data.need_you.length} 1`} preserveAspectRatio="none" aria-hidden="true">
            {#each needMix as item, index (item.kind)}
              <rect x={needMix.slice(0, index).reduce((sum, part) => sum + part.n, 0)} y="0" width={item.n} height="1"
                class={`mix-${item.kind}`} />
            {/each}
          </svg>
          <span class="legend">
            {#each needMix as item (item.kind)}<span><i class={`swatch mix-${item.kind}`}></i>{NEED_LABEL[item.kind]} <b>{item.n}</b></span>{/each}
          </span>
        </div>
        <ul class="inbox">
          {#each data.need_you as task (`${task.project}/${task.key}`)}
            <li>
              <button onclick={() => onOpen(task.project, task.key)}>
                <span class="need-icon" title={NEED_LABEL[task.need_kind]}><Icon name={task.need_kind} size={14} /></span>
                <span class="inbox-title">{task.title}</span>
                {#if task.due}
                  <span class={`chip due ${dueTone(task.due, data.today)}`}>{dueText(task.due, data.today)}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">没有要你出手的事。</p>
      {/if}
    </section>

    <section class="panel">
      <h2>截止倒计时 <small>橙色需要你，红色已逾期</small></h2>
      <Countdown tasks={data.dated ?? data.due_soon} today={data.today} {onOpen} />
    </section>
  </div>

  <div class="grid-2">
    <section class="panel">
      <h2>项目</h2>
      {#each data.projects as project (project.id)}
        <a class="project-row" href={`/p/${encodeURIComponent(project.id)}`}
          onclick={event => { event.preventDefault(); onNavigate(`/p/${encodeURIComponent(project.id)}`); }}>
          <span class="project-name"><span class={`dot slot-${projectSlot(projects, project.id)}`}></span>{project.name}</span>
          <svg class="split" viewBox={`0 0 ${Math.max(project.open, 1)} 1`} preserveAspectRatio="none"
            role="img" aria-label={`${project.open} 条未完成，其中 ${project.need_you} 条需要你`}>
            <rect x="0" y="0" width={project.need_you} height="1" class="split-you" />
            <rect x={project.need_you} y="0" width={Math.max(0, project.open - project.need_you)} height="1" class="split-rest" />
          </svg>
          <span class="project-meta">{project.open} 条 · {project.branches} 分支 · {ago(project.last_push_at)}</span>
        </a>
      {:else}
        <p class="empty">还没有项目。在左侧点「+」添加，并把推送令牌配置到仓库。</p>
      {/each}
    </section>

    <section class="panel">
      <h2>最近 7 天完成 <small>{data.counts.done_7d} 条</small></h2>
      {#if data.recently_done.length}
        <ul class="done-list">
          {#each data.recently_done as task (`${task.project}/${task.key}`)}
            <li><Icon name="check" size={14} /><button class="link-button" onclick={() => onOpen(task.project, task.key)}>{task.title}</button>
              <span class="muted">{name(task.project)}</span></li>
          {/each}
        </ul>
      {:else}
        <p class="empty">这周还没有完成记录。完成的事从待办里删掉后，下次推送会出现在这里。</p>
      {/if}
      {#if data.branches.length}
        <h3>进行中分支</h3>
        <ul class="branch-list">
          {#each data.branches as branch (`${branch.project}/${branch.name}`)}
            <li><Icon name="branch" size={14} /><code>{branch.name}</code>
              <span class="muted">{name(branch.project)} · 领先 {branch.ahead}{branch.has_fragment ? " · 有记录" : ""}</span></li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
{/if}
