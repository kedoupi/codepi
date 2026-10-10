<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";

  let {
    delay = 0,
    children,
  }: {
    delay?: number;
    children: Snippet;
  } = $props();

  let root = $state<HTMLElement | undefined>();
  let on = $state(false);

  onMount(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      on = true;
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          on = true;
          io.disconnect();
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" },
    );
    if (root) io.observe(root);
    return () => io.disconnect();
  });
</script>

<div bind:this={root} class="landing-reveal" class:on style="--reveal-delay:{delay}ms">
  {@render children()}
</div>
