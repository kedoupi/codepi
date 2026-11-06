<script lang="ts">
  type Name = "attend" | "decide" | "authorize" | "confirm" | "none" | "clock" | "alert" | "branch" | "check"
    | "today" | "folder" | "log" | "plus" | "close" | "list";
  let { name, size = 16 }: { name: Name; size?: number } = $props();
</script>

<svg class="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  {#if name === "attend"}
    <circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" />
  {:else if name === "decide"}
    <circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" />
  {:else if name === "authorize"}
    <circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2M14 9l2 2" />
  {:else if name === "confirm" || name === "check"}
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  {:else if name === "none"}
    <circle cx="12" cy="12" r="3" />
  {:else if name === "clock"}
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  {:else if name === "alert"}
    <path d="M12 3l9.5 17H2.5Z" /><path d="M12 10v4M12 17h.01" />
  {:else if name === "branch"}
    <circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 8v8M18 10c0 4-6 3-10 6" />
  {:else if name === "today"}
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
  {:else if name === "board"}
    <rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="17" y="4" width="4" height="13" rx="1.5" />
  {:else if name === "folder"}
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  {:else if name === "log" || name === "list"}
    <path d="M4 6h16M4 12h10M4 18h13" />
  {:else if name === "plus"}
    <path d="M12 5v14M5 12h14" />
  {:else if name === "close"}
    <path d="M6 6l12 12M18 6 6 18" />
  {/if}
</svg>
