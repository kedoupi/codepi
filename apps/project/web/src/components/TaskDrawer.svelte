<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { dueText, HANDOFF_LABEL, NEED_LABEL, shortTime, STATUS_LABEL } from "../lib/format";
  import type { Handoff, ProjectSummary, TaskDetail } from "../lib/types";
  import Icon from "./Icon.svelte";

  let { project, taskKey, projects, onClose }: {
    project: string;
    taskKey: string;
    projects: ProjectSummary[];
    onClose: () => void;
  } = $props();

  let task = $state<TaskDetail | null>(null);
  let handoffs = $state<Handoff[]>([]);
  let today = $state("");
  let error = $state("");
  let closeButton = $state<HTMLButtonElement | null>(null);

  onMount(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButton?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    addEventListener("keydown", onKey);
    void (async () => {
      try {
        const [detail, overview] = await Promise.all([
          api(`/api/tasks/${encodeURIComponent(project)}/${encodeURIComponent(taskKey)}`),
          api("/api/overview"),
        ]);
        task = detail.task as TaskDetail;
        handoffs = detail.handoffs as Handoff[];
        today = String(overview.today);
      } catch (cause) {
        error = cause instanceof Error && cause.message === "task_not_found" ? "这条待办已不存在。" : "读取失败。";
      }
    })();
    return () => {
      removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  });

  const projectName = $derived(projects.find(item => item.id === project)?.name ?? project);
</script>

<button class="scrim" tabindex="-1" aria-label="关闭详情" onclick={onClose}></button>
<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
  <button class="icon-button drawer-close" aria-label="关闭" bind:this={closeButton} onclick={onClose}><Icon name="close" /></button>
  {#if error}
    <h2 id="drawer-title">待办</h2>
    <p class="inline-alert" role="alert">{error}</p>
  {:else if !task}
    <h2 id="drawer-title">正在读取…</h2>
  {:else}
    <h2 id="drawer-title">{task.title}</h2>
    <div class="chips">
      <span class="chip">{task.done_at ? "已完成" : STATUS_LABEL[task.status]}</span>
      {#if task.need_kind !== "none" && !task.done_at}
        <span class="chip you"><Icon name={task.need_kind} size={12} />需要你：{NEED_LABEL[task.need_kind]}</span>
      {/if}
      {#if task.due && !task.done_at}<span class="chip due">{task.due} · {dueText(task.due, today)}</span>{/if}
    </div>
    <dl class="facts">
      <dt>项目</dt><dd>{projectName} · {task.category}</dd>
      {#if task.what}<dt>是什么</dt><dd>{task.what}</dd>{/if}
      {#if task.impact}<dt>不做会怎样</dt><dd>{task.impact}</dd>{/if}
      {#if task.advice}<dt>建议</dt><dd>{task.advice}</dd>{/if}
      {#if task.need}<dt>需要你</dt><dd>{task.need}</dd>{/if}
      {#if task.source}<dt>出处</dt><dd><code>{task.source}</code></dd>{/if}
      {#if task.related.length}<dt>关联</dt><dd class="code-list">{#each task.related as path (path)}<code>{path}</code>{/each}</dd>{/if}
      <dt>记录</dt><dd>{task.recorded ?? "—"}{task.done_at ? ` · 完成于 ${shortTime(task.done_at)}` : ""}</dd>
    </dl>
    {#if handoffs.length}
      <h3>交接</h3>
      <ol class="timeline">
        {#each handoffs as handoff (handoff.id)}
          <li>
            <span class="chip">{HANDOFF_LABEL[handoff.status]}</span>
            <span class="muted">{handoff.client} · {shortTime(handoff.at)}</span>
            <p>{handoff.summary}</p>
            <p class="muted">下一步：{handoff.next}</p>
            {#if handoff.blockers}<p class="muted">卡点：{handoff.blockers}</p>{/if}
          </li>
        {/each}
      </ol>
    {/if}
    <p class="footnote">内容来自仓库里的待办，网页只读；要改请在仓库里改，下次推送后更新。</p>
  {/if}
</div>
