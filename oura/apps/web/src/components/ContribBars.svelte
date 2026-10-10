<script lang="ts">
  import type { BarRow } from "../lib/types";

  let { rows }: { rows: BarRow[] } = $props();
</script>

<div class="bars">
  {#if !rows.length}
    <div class="n" style="font-size:12px;color:var(--muted)">暂无贡献项</div>
  {:else}
    {#each rows as row (row.key)}
      <div class="bar-row" class:weak={row.weak}>
        <div class="n" title={row.key}>{row.label}{row.weak ? " ·瓶颈" : ""}</div>
        <div class="track">
          <div class="fill" style="width:{Math.max(0, Math.min(100, row.val))}%"></div>
        </div>
        <div class="t">{Math.round(row.val)}</div>
      </div>
    {/each}
  {/if}
</div>
