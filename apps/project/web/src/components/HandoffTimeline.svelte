<script lang="ts">
  import type { Handoff } from "../lib/types";
  import { statusLabels, time } from "../lib/format";

  let {
    handoffs,
    hasMore,
    loading,
    error = "",
    onLoadMore,
  }: {
    handoffs: Handoff[];
    hasMore: boolean;
    loading: boolean;
    error?: string;
    onLoadMore: () => Promise<void>;
  } = $props();
</script>

<section class="panel timeline-panel">
  <header class="panel-head">
    <div>
      <span class="eyebrow">APPEND-ONLY LOG</span>
      <h2>交接时间线</h2>
    </div>
    <span class="count-mark">{handoffs.length}</span>
  </header>
  {#if handoffs.length}
    <ol class="timeline">
      {#each handoffs as handoff (handoff.id)}
        <li>
          <span class="timeline-dot" aria-hidden="true"></span>
          <article>
            <header>
              <div>
                <code class="task-id">{handoff.task_id}</code>
                <span class="status-chip status-{handoff.status}">{statusLabels[handoff.status]}</span>
              </div>
              <time datetime={handoff.at}>{time(handoff.at)}</time>
            </header>
            <p class="timeline-client">{handoff.client} · {handoff.branch}</p>
            <p>{handoff.summary}</p>
            <div class="next-step">
              <span>下一步</span>
              <p>{handoff.next}</p>
            </div>
            {#if handoff.blockers || handoff.files.length}
              <details class="timeline-extra">
                <summary>展开卡点与文件</summary>
                {#if handoff.blockers}<p><b>卡点：</b>{handoff.blockers}</p>{/if}
                {#if handoff.files.length}
                  <ul>
                    {#each handoff.files as file, index (`${index}:${file}`)}
                      <li><code>{file}</code></li>
                    {/each}
                  </ul>
                {/if}
              </details>
            {/if}
          </article>
        </li>
      {/each}
    </ol>
    {#if hasMore}
      <button class="load-more" disabled={loading} onclick={() => void onLoadMore()}>
        {loading ? "加载中…" : "加载更多"}
      </button>
    {/if}
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {:else}
    <div class="small-empty">
      <strong>还没有交接记录</strong>
      <p>所有 AI 工具写回的进度会按时间倒序出现在这里。</p>
    </div>
  {/if}
</section>
