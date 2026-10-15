<script lang="ts">
  let {
    class: className = "brand",
    name = "健康 Health",
  }: {
    class?: string;
    name?: string;
  } = $props();
</script>

<a class={className} href="/">
  <img class="{className}-mark" src="/icon.svg" alt="" width="36" height="36" />
  <span class="{className}-name">{name}</span>
</a>
