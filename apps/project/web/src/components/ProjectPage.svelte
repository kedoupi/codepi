<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { ago, HANDOFF_LABEL, shortTime, STATUS_LABEL, STATUS_ORDER } from "../lib/format";
  import type { ProjectCard, ProjectStatus, ProjectSummary, TaskBrief } from "../lib/types";
  import Icon from "./Icon.svelte";
  import TaskCard from "./TaskCard.svelte";
  import TokenReveal from "./TokenReveal.svelte";

  let { id, projects, onOpen, onChanged }: {
    id: string;
    projects: ProjectSummary[];
    onOpen: (project: string, key: string) => void;
    onChanged: () => Promise<void> | void;
  } = $props();

  let card = $state<ProjectCard | null>(null);
  let tasks = $state<TaskBrief[]>([]);
  let today = $state("");
  let error = $state("");
  let token = $state<string | null>(null);
  let confirmRotate = $state(false);

  async function load(opts: { keepPage?: boolean } = {}) {
    error = "";
    try {
      const [detail, list, overview] = await Promise.all([
        api(`/api/projects/${encodeURIComponent(id)}`),
        api(`/api/tasks?project=${encodeURIComponent(id)}`),
        api("/api/overview"),
      ]);
      card = detail as unknown as ProjectCard;
      tasks = list.tasks as TaskBrief[];
      today = String(overview.today);
    } catch (cause) {
      if (opts.keepPage && card) {
        actionError = "页面没有刷新成功，上面的数字可能是旧的。";
        return;
      }
      error = cause instanceof Error && cause.message === "project_not_found" ? "没有这个项目。" : "读取失败。";
    }
  }
  onMount(() => void load());

  let actionError = $state("");

  async function rotate() {
    actionError = "";
    try {
      const result = await api(`/api/projects/${encodeURIComponent(id)}/token`, { method: "POST" });
      token = String(result.token);
      confirmRotate = false;
    } catch {
      actionError = "没有生成新令牌，旧令牌仍然有效。请稍后再试。";
      return;
    }
    // The new token is shown only once: a failed refresh must not hide it.
    await load({ keepPage: true });
  }

  async function setStatus(status: ProjectStatus) {
    actionError = "";
    try {
      await api(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
      await load({ keepPage: true });
      await onChanged();
    } catch {
      actionError = "状态没有改成，请稍后再试。";
    }
  }

  const total = $derived(card ? STATUS_ORDER.reduce((sum, state) => sum + (card!.counts.by_status[state] || 0), 0) : 0);
  const PROJECT_STATUS: Record<ProjectStatus, string> = { active: "进行中", paused: "暂停", archived: "归档" };
</script>

{#if error}
  <p class="inline-alert" role="alert">{error}</p>
{:else if !card}
  <p class="loading">正在读取项目…</p>
{:else}
  <header class="page-head">
    <h1>{card.project.name} <span class="muted">{card.project.repo ?? "本地仓库"}</span></h1>
    <span class="stamp">推送 {ago(card.project.last_push_at)}{card.project.source_sha ? ` · ${card.project.source_sha.slice(0, 7)}` : ""}</span>
  </header>

  <section class="panel">
    <h2>待办构成 <small>{total} 条未完成 · {card.counts.need_you} 条需要你 · 7 天完成 {card.counts.done_7d}</small></h2>
    {#if total}
      <svg class="status-bar" viewBox={`0 0 ${total} 1`} preserveAspectRatio="none" role="img"
        aria-label={STATUS_ORDER.map(state => `${STATUS_LABEL[state]} ${card!.counts.by_status[state] || 0}`).join("，")}>
        {#each STATUS_ORDER as state, index (state)}
          <rect x={STATUS_ORDER.slice(0, index).reduce((sum, s) => sum + (card!.counts.by_status[s] || 0), 0)} y="0"
            width={card.counts.by_status[state] || 0} height="1" class={`st-${state}`} />
        {/each}
      </svg>
      <span class="legend">
        {#each STATUS_ORDER as state (state)}<span><i class={`swatch st-${state}`}></i>{STATUS_LABEL[state]} <b>{card.counts.by_status[state] || 0}</b></span>{/each}
      </span>
    {:else}
      <p class="empty">还没有推送过待办。</p>
    {/if}
  </section>

  <div class="grid-2">
    <section class="panel">
      <h2>项目卡 <small>取自仓库规则的「Agent 协作适配」段</small></h2>
      <dl class="facts">
        <dt>规则入口</dt><dd>{#if card.project.rules_path}<code>{card.project.rules_path}</code>{:else}—{/if}</dd>
        <dt>隔离</dt><dd>{card.project.adapter?.isolation ?? "—"}</dd>
        <dt>提交</dt><dd>{card.project.adapter?.commit ?? "—"}</dd>
        <dt>验收</dt><dd class="code-list">{#each card.project.adapter?.acceptance ?? [] as command (command)}<code>{command}</code>{:else}—{/each}</dd>
        <dt>合并</dt><dd>{#if card.project.adapter?.merge}<code>{card.project.adapter.merge}</code>{:else}—{/if}</dd>
      </dl>
    </section>
    <section class="panel">
      <h2>进行中分支 <small>{card.branches.length}</small></h2>
      {#if card.branches.length}
        <ul class="branch-list">
          {#each card.branches as branch (branch.name)}
            <li><Icon name="branch" size={14} /><code>{branch.name}</code>
              <span class="muted">领先 {branch.ahead} · {ago(branch.last_commit_at)}{branch.has_fragment ? " · 有记录" : ""}</span></li>
          {/each}
        </ul>
      {:else}
        <p class="empty">没有进行中的分支。</p>
      {/if}
    </section>
  </div>

  <section class="panel">
    <h2>这个项目的待办</h2>
    <div class="card-grid">
      {#each tasks as task (task.key)}
        <TaskCard {task} {today} {projects} {onOpen} showProject={false} />
      {:else}
        <p class="empty">没有未完成的待办。</p>
      {/each}
    </div>
  </section>

  <div class="grid-2">
    <section class="panel">
      <h2>最近变更</h2>
      {#if card.changelog.length}
        <ul class="log-list">
          {#each card.changelog as entry, index (index)}<li><span class="date">{entry.date.slice(5)}</span>{entry.title}</li>{/each}
        </ul>
      {:else}
        <p class="empty">还没有变更记录。</p>
      {/if}
    </section>
    <section class="panel">
      <h2>交接 <small>每个任务最新一条</small></h2>
      {#if card.handoffs.length}
        <ol class="timeline">
          {#each card.handoffs as handoff (handoff.id)}
            <li><span class="chip">{HANDOFF_LABEL[handoff.status]}</span> <code>{handoff.task}</code>
              <span class="muted">{handoff.client} · {shortTime(handoff.at)}</span><p>{handoff.next}</p></li>
          {/each}
        </ol>
      {:else}
        <p class="empty">还没有交接记录。</p>
      {/if}
    </section>
  </div>

  <section class="panel">
    <h2>推送与设置</h2>
    <dl class="facts">
      <dt>推送令牌</dt>
      <dd>{card.token ? `生成于 ${shortTime(card.token.created_at)}，最近使用 ${ago(card.token.last_used_at)}` : "没有令牌"}</dd>
      <dt>状态</dt>
      <dd class="segmented" role="group" aria-label="项目状态">
        {#each ["active", "paused", "archived"] as const as status (status)}
          <button aria-pressed={card.project.status === status} onclick={() => setStatus(status)}>{PROJECT_STATUS[status]}</button>
        {/each}
      </dd>
    </dl>
    {#if actionError}<p class="inline-alert" role="alert">{actionError}</p>{/if}
    {#if token}
      <TokenReveal {token} project={card.project.id} />
    {:else if confirmRotate}
      <p class="inline-alert">重新生成后旧令牌立即失效，仓库里配置的令牌要一起换掉。</p>
      <div class="actions"><button class="button primary" onclick={rotate}>确认重新生成</button>
        <button class="button" onclick={() => (confirmRotate = false)}>取消</button></div>
    {:else}
      <button class="button" onclick={() => (confirmRotate = true)}>重新生成推送令牌</button>
    {/if}
  </section>
{/if}
