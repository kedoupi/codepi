<script lang="ts">
  import { finite } from "../lib/health";
  let { seconds, locale = "zh" }: { seconds: unknown; locale?: string } = $props();
  const minutes = $derived(finite(seconds) && seconds >= 0 ? Math.round(seconds / 60) : null);
</script>

<span class="time-value">{#if minutes === null}—{:else}<b>{Math.floor(minutes / 60)}</b> <small>{locale === "zh" ? "小时" : "h"}</small> <b>{minutes % 60}</b> <small>{locale === "zh" ? "分" : "m"}</small>{/if}</span>

<style>
  .time-value { white-space: nowrap; font-variant-numeric: tabular-nums; }
  b { font: inherit; }
  small { font-size: .48em; font-weight: 500; letter-spacing: 0; }
</style>
