<script lang="ts">
  import type { ChartHandle } from "../lib/types";

  let {
    build,
  }: {
    build: ((canvas: HTMLCanvasElement) => ChartHandle) | null;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    const el = canvas;
    const fn = build;
    if (!el || !fn) return;
    const chart = fn(el);
    return () => chart.destroy();
  });
</script>

<canvas bind:this={canvas}></canvas>
