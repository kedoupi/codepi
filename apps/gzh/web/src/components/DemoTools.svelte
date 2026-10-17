<script lang="ts">
  import type { BoardPost } from "../api";
  import { patchPost, releaseDemo } from "../api";
  import { flashToast } from "../lib/toast";
  import ComposeForm from "./ComposeForm.svelte";
  import TwoTapButton from "./TwoTapButton.svelte";

  let { date, post }: { date: string; post: BoardPost } = $props();

  const editHere = $derived(post.status !== "需改" && post.status !== "draft" && post.status !== "已进箱");

  async function markOfficial() {
    await patchPost(post.slug, { mark_official: true });
    flashToast("已标为正式稿", "ok");
    location.reload();
  }

  async function release() {
    await releaseDemo(post.slug);
    flashToast("演示稿已撤档", "ok");
    location.href = "/";
  }
</script>

{#if post.is_demo && post.slot}
  {#if editHere}
    <details class="compose demo-swap">
      <summary>改这篇（标题 / 预览）</summary>
      <ComposeForm {date} row={{ slot: post.slot, post }} {post} />
    </details>
  {/if}
  <details class="compose demo-swap">
    <summary>换真稿（新 slug 替掉这条演示）</summary>
    <ComposeForm {date} row={{ slot: post.slot, post: null }} />
  </details>
  <TwoTapButton label="标为正式稿" confirmLabel="确认转正式？再点一次" onConfirm={markOfficial} />
  <TwoTapButton label="撤掉演示" confirmLabel="确认撤档？再点一次" onConfirm={release} />
{/if}
