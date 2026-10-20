<script lang="ts">
  import type { ProjectCard } from "../lib/types";
  import { commitHref, pullHref, shortSha, statusLabels, time } from "../lib/format";

  let {
    repo,
    taskProgress,
  }: {
    repo: string;
    taskProgress: ProjectCard["task_progress"];
  } = $props();
</script>

<section class="panel progress-panel">
  <header class="panel-head">
    <div>
      <span class="eyebrow">CURRENT TASKS</span>
      <h2>当前进度</h2>
    </div>
    <span class="count-mark">{taskProgress.length}</span>
  </header>
  {#if taskProgress.length}
    <div class="progress-stack">
      {#each taskProgress as item (item.task_id)}
        <article class="task-progress">
          <header>
            <code class="task-id">{item.task_id}</code>
            <span class="status-chip status-{item.status}">{statusLabels[item.status]}</span>
          </header>
          <p class="task-summary">{item.latest.summary}</p>
          <div class="next-step">
            <span>下一步</span>
            <p>{item.latest.next}</p>
          </div>
          {#if item.latest.blockers}
            <div class="blocker-line"><b>卡点</b>{item.latest.blockers}</div>
          {/if}
          <dl class="handoff-facts compact">
            <div><dt>来源</dt><dd>{item.latest.client}</dd></div>
            <div><dt>时间</dt><dd>{time(item.latest.at)}</dd></div>
            <div><dt>分支</dt><dd>{item.latest.branch}</dd></div>
            <div><dt>基线</dt><dd><code>{shortSha(item.latest.base_sha)}</code></dd></div>
            {#if item.latest.commit}
              <div>
                <dt>提交</dt>
                <dd><a href={commitHref(repo, item.latest.commit)} target="_blank" rel="noreferrer"><code>{shortSha(item.latest.commit)}</code></a></dd>
              </div>
            {/if}
            {#if item.latest.pr}
              <div>
                <dt>PR</dt>
                <dd>
                  {#if pullHref(repo, item.latest.pr)}
                    <a href={pullHref(repo, item.latest.pr)} target="_blank" rel="noreferrer">{item.latest.pr}</a>
                  {:else}
                    {item.latest.pr}
                  {/if}
                </dd>
              </div>
            {/if}
          </dl>
        </article>
      {/each}
    </div>
  {:else}
    <div class="small-empty">
      <strong>还没有任务交接</strong>
      <p>第一条交接写入后，这里会按 task_id 展示每个任务的最新进度。</p>
    </div>
  {/if}
</section>
