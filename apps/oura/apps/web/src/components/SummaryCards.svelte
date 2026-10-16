<script lang="ts">
  import type { SummaryCard } from "../lib/types";
  import { fmtDelta } from "../lib/format";

  let { cards }: { cards: SummaryCard[] } = $props();
</script>

<section class="cards">
  {#each cards as card (card.label)}
    <div class="card">
      {#if card.sparkLine}
        <svg class="spark" viewBox="0 0 120 56" preserveAspectRatio="none" aria-hidden="true">
          <path class="area" d={card.sparkArea}></path>
          <path class="line" d={card.sparkLine}></path>
        </svg>
      {/if}
      <div class="label">{card.label}</div>
      <div class="score">{card.score != null ? card.score : "—"}<em>/100</em></div>
      <div class="meta">{card.meta}</div>
      {#if card.delta != null && Math.abs(card.delta) >= 0.5}
        <span class="delta">半程趋势 {fmtDelta(card.delta)}</span>
      {/if}
    </div>
  {:else}
    <div class="card skel"><div class="label">睡眠</div><div class="score">—</div><div class="meta">最新得分</div></div>
    <div class="card skel"><div class="label">准备度</div><div class="score">—</div><div class="meta">最新得分</div></div>
    <div class="card skel"><div class="label">活动</div><div class="score">—</div><div class="meta">最新得分</div></div>
  {/each}
</section>
