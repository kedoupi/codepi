<script lang="ts">
  import type { ProjectCard } from "../lib/types";
  import { blobHref, safeExternal, statusLabels, time } from "../lib/format";

  let {
    card,
  }: { card: ProjectCard } = $props();
</script>

<section class="panel activity-panel">
  <header class="panel-head">
    <div>
      <span class="eyebrow">REPOSITORY SIGNALS</span>
      <h2>仓库动态</h2>
    </div>
  </header>

  <section class="activity-group">
    <h3>打开的 PR <span>{card.open_prs.length}</span></h3>
    {#if card.open_prs.length}
      <ul class="activity-list">
        {#each card.open_prs as pr (pr.ref)}
          <li>
            {#if safeExternal(pr.url)}
              <a href={safeExternal(pr.url)} target="_blank" rel="noreferrer">
                <b>#{pr.ref}</b><span>{pr.title}</span>
              </a>
            {:else}
              <div><b>#{pr.ref}</b><span>{pr.title}</span></div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="group-empty">没有打开的 PR。</p>
    {/if}
  </section>

  <section class="activity-group">
    <h3>近 14 天合并 <span>{card.recently_merged.length}</span></h3>
    {#if card.recently_merged.length}
      <ul class="activity-list">
        {#each card.recently_merged as pr (pr.ref)}
          <li>
            {#if safeExternal(pr.url)}
              <a href={safeExternal(pr.url)} target="_blank" rel="noreferrer">
                <b>#{pr.ref}</b><span>{pr.title}</span>
              </a>
            {:else}
              <div><b>#{pr.ref}</b><span>{pr.title}</span></div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="group-empty">近 14 天没有合并记录。</p>
    {/if}
  </section>

  <section class="activity-group">
    <h3>最近提交 <span>{card.recent_commits.length}</span></h3>
    {#if card.recent_commits.length}
      <ol class="commit-list">
        {#each card.recent_commits as commit (commit.sha)}
          <li>
            {#if safeExternal(commit.url)}
              <a href={safeExternal(commit.url)} target="_blank" rel="noreferrer">
                <code>{commit.sha.slice(0, 8)}</code>
                <span>{commit.title}</span>
              </a>
            {:else}
              <div><code>{commit.sha.slice(0, 8)}</code><span>{commit.title}</span></div>
            {/if}
            <small>{commit.author || "作者未知"} · {time(commit.at)}</small>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="group-empty">还没有从 GitHub 同步提交。</p>
    {/if}
  </section>

  <section class="activity-group">
    <h3>打开的 issue <span>{card.open_issues.length}</span></h3>
    {#if card.open_issues.length}
      <ul class="activity-list">
        {#each card.open_issues as issue (issue.ref)}
          <li>
            {#if safeExternal(issue.url)}
              <a href={safeExternal(issue.url)} target="_blank" rel="noreferrer">
                <b>#{issue.ref}</b><span>{issue.title}</span>
              </a>
            {:else}
              <div><b>#{issue.ref}</b><span>{issue.title}</span></div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="group-empty">没有打开的 issue。</p>
    {/if}
  </section>

  <section class="activity-group">
    <h3>进行中的任务记录 <span>{card.active_tasks.length}</span></h3>
    {#if card.active_tasks.length}
      <ul class="task-note-list">
        {#each card.active_tasks as task (task.path)}
          <li>
            <a href={blobHref(card.project.repo, card.project.default_branch, task.path)} target="_blank" rel="noreferrer">
              <span>{task.title}</span>
              <code>{task.path.split("/").at(-1)}</code>
            </a>
            <span class="status-chip status-{task.status}">{statusLabels[task.status]}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="group-empty">没有识别到进行中的任务文档。</p>
    {/if}
  </section>
</section>
