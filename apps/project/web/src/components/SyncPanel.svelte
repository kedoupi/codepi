<script lang="ts">
  import type { ProjectCard } from "../lib/types";
  import { sourceLabels, syncError, time } from "../lib/format";

  let { card }: { card: ProjectCard } = $props();
  const sources = ["commits", "pulls", "issues", "agents_md", "tasks"] as const;
</script>

<section class="panel sync-panel">
  <header class="panel-head">
    <div>
      <span class="eyebrow">SYNC HEALTH</span>
      <h2>同步状态</h2>
    </div>
    <span class="data-stamp">截至 {time(card.as_of)}</span>
  </header>
  <dl class="sync-grid">
    {#each sources as source (source)}
      {@const state = card.sync[source]}
      <div class:sync-failed={!!state.error}>
        <dt>{sourceLabels[source]}</dt>
        <dd>
          <span>{state.last_ok_at ? `成功于 ${time(state.last_ok_at)}` : "尚未成功同步"}</span>
          {#if state.error}<b>{syncError(state.error)}</b>{/if}
        </dd>
      </div>
    {/each}
  </dl>
</section>
