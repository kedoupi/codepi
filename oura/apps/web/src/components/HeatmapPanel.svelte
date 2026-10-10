<script lang="ts">
  import type { HeatCell } from "../lib/types";

  let {
    title,
    takeaway,
    hint,
    strip,
    wdays,
    cells,
  }: {
    title: string;
    takeaway: string;
    hint: string;
    strip: boolean;
    wdays: string[];
    cells: HeatCell[];
  } = $props();
</script>

<div class="panel tech">
  <h2>{title}</h2>
  <p class="takeaway">{takeaway}</p>
  <p class="hint">{hint}</p>
  <div class="chart-well">
    <div class="chart-box pair hm-box">
      <div class="hm-wdays">
        {#each wdays as w, i (`wd-${i}`)}
          <span>{w}</span>
        {/each}
      </div>
      <div class="heatmap" class:hm-strip={strip} class:hm-cal={!strip}>
        {#each cells as cell, i (`hm-${cell.key}-${i}`)}
          {#if cell.pad}
            <div class="hm-cell" style="opacity:0" aria-hidden="true"></div>
          {:else if cell.score != null}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div
              class="hm-cell"
              style="background:{cell.color}"
              data-v={String(cell.score)}
              tabindex="0"
              title={cell.title}
            >
              <span class="tip">{cell.tip}</span>
            </div>
          {:else}
            <div class="hm-cell" style="opacity:0.25" title={cell.title}></div>
          {/if}
        {/each}
      </div>
      <div class="hm-legend">
        低
        <i style="background:#fff7ed"></i>
        <i style="background:#ffedd5"></i>
        <i style="background:#fed7aa"></i>
        <i style="background:#fdba74"></i>
        <i style="background:#f97316"></i>
        高
      </div>
    </div>
  </div>
</div>
