<script lang="ts">
  import BrandMark from "./BrandMark.svelte";

  let {
    class: className = "brand",
    name = "健康看板",
  }: {
    class?: string;
    name?: string;
  } = $props();
</script>

<a class={className} href="/">
  <BrandMark class="{className}-mark" />
  <span class="{className}-name">{name}</span>
</a>
