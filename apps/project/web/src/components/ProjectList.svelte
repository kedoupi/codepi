<script lang="ts">
  import type { ProjectListItem } from "../lib/types";
  import { projectStatusLabels, time } from "../lib/format";

  let {
    projects,
    asOf,
    onOpen,
  }: {
    projects: ProjectListItem[];
    asOf: string | null;
    onOpen: (id: string) => void;
  } = $props();
</script>

<section class="page-intro">
  <span class="eyebrow">PROJECT INDEX</span>
  <div class="page-intro-row">
    <h1>在手项目</h1>
    <span class="data-stamp">数据截至 {time(asOf)}</span>
  </div>
  <p>每个任务各自保留最新交接；项目卡汇总目标、约束与仓库动态。</p>
</section>

{#if projects.length}
  <ol class="project-list">
    {#each projects as project, index (project.id)}
      <li>
        <button class="project-row" onclick={() => onOpen(project.id)}>
          <span class="project-index">{String(index + 1).padStart(2, "0")}</span>
          <span class="project-main">
            <span class="project-name-line">
              <strong>{project.name}</strong>
              <span class="status-chip status-{project.status}">{projectStatusLabels[project.status]}</span>
            </span>
            <span class="repo-line">{project.repo}</span>
            {#if project.latest_handoff}
              <span class="next-line">
                <b>{project.latest_handoff.task_id}</b>
                {project.latest_handoff.next}
              </span>
            {:else}
              <span class="next-line muted">还没有交接记录</span>
            {/if}
          </span>
          <span class="project-meta">
            <span>{time(project.last_activity_at)}</span>
            <span class="enter-mark" aria-hidden="true">→</span>
          </span>
        </button>
      </li>
    {/each}
  </ol>
{:else}
  <div class="empty-state">
    <span class="empty-mark">∅</span>
    <h2>尚未同步项目</h2>
    <p>检查 PROJECT_REPOS 配置，或等待定时 GitHub 同步。</p>
  </div>
{/if}
