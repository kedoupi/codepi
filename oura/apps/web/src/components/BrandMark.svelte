<script lang="ts">
  let { class: className = "" }: { class?: string } = $props();
</script>

<!-- Original geometric gauge: open arc + start cap. Not the Oura ring / wordmark. -->
<svg
  class={className}
  viewBox="0 0 32 32"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
  focusable="false"
>
  <circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="2.2" opacity="0.22" />
  <path
    d="M16 5 A11 11 0 1 1 6.8 21.4"
    stroke="currentColor"
    stroke-width="2.7"
    stroke-linecap="round"
  />
  <circle cx="16" cy="5" r="2.15" fill="currentColor" />
</svg>
