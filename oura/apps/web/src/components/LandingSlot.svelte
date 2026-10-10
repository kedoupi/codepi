<script lang="ts">
  let {
    src,
    fallback = "",
    alt,
    width,
    height,
    caption = "",
    slotName,
  }: {
    src: string;
    fallback?: string;
    alt: string;
    width: number;
    height: number;
    caption?: string;
    slotName: string;
  } = $props();

  let override = $state<string | null>(null);
  let empty = $state(false);
  const current = $derived(override ?? src);

  function onError() {
    if (fallback && current !== fallback) {
      override = fallback;
      return;
    }
    empty = true;
  }

  const usingFallback = $derived(Boolean(fallback) && current === fallback);
</script>

<figure class="landing-slot" data-slot={slotName}>
  <div class="landing-slot-frame" style:aspect-ratio="{width} / {height}">
    {#if empty}
      <div class="landing-slot-ph" role="img" aria-label={alt}>
        <span>{slotName}</span>
        <small>放入 apps/web/public/marketing/{slotName}</small>
      </div>
    {:else}
      <img
        class="landing-slot-img"
        src={current}
        {alt}
        {width}
        {height}
        onerror={onError}
      />
    {/if}
  </div>
  {#if caption}
    <figcaption>{usingFallback ? `${caption} · 待换运营 PNG` : caption}</figcaption>
  {/if}
</figure>
