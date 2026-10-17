<script lang="ts">
  import type { BoardPost, SlotRow } from "../api";
  import { upsertPost } from "../api";
  import { flashToast, showToast, errText } from "../lib/toast";

  let {
    date,
    row,
    post = null,
  }: {
    date: string;
    row: SlotRow;
    post?: BoardPost | null;
  } = $props();

  const slotPinyin = $derived(row.slot === "早" ? "zao" : row.slot === "中" ? "zhong" : "wan");
  const defaultSlug = $derived(`${date.replaceAll("-", "")}-${slotPinyin}`);
  const slugLocked = $derived(Boolean(post && !post.is_demo));

  let slug = $state("");
  let title = $state("");
  let previewPath = $state("");
  let note = $state("");
  let submitting = $state(false);

  // 初始化表单值（等价旧 composeForm 的 value 属性）。只初始化一次。
  let initialized = false;
  $effect(() => {
    if (initialized) return;
    initialized = true;
    slug = post?.slug || defaultSlug;
    title = post?.title || "";
    previewPath = post?.preview_path || `/previews/${slotPinyin}/`;
    note = post?.note || "";
  });

  async function submit() {
    if (submitting) return;
    submitting = true;
    try {
      const fromSlug = post ? post.slug : "";
      await upsertPost({
        slug,
        from_slug: fromSlug || undefined,
        new_slug: fromSlug && fromSlug !== slug ? slug : undefined,
        title,
        slot: row.slot,
        publish_date: date,
        preview_path: previewPath,
        note,
        submit: true,
      });
      flashToast("已交待审", "ok");
      location.reload();
    } catch (error) {
      submitting = false;
      showToast(errText(error, "保存失败"), "err");
    }
  }
</script>

<form
  data-form="upsert"
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <input type="hidden" name="slot" value={row.slot} />
  {#if post}
    <input type="hidden" name="from_slug" value={post.slug} />
  {/if}
  <label for="compose-slug-{row.slot}-{post?.slug ?? 'new'}">slug</label>
  <input id="compose-slug-{row.slot}-{post?.slug ?? 'new'}" name="slug" required bind:value={slug} readonly={slugLocked} />
  <label for="compose-title-{row.slot}-{post?.slug ?? 'new'}">标题</label>
  <input id="compose-title-{row.slot}-{post?.slug ?? 'new'}" name="title" required bind:value={title} />
  <label for="compose-preview-{row.slot}-{post?.slug ?? 'new'}">预览地址</label>
  <input id="compose-preview-{row.slot}-{post?.slug ?? 'new'}" name="preview_path" placeholder="/previews/zao/ 或同域预览路径" bind:value={previewPath} />
  <label for="compose-note-{row.slot}-{post?.slug ?? 'new'}">备注</label>
  <textarea id="compose-note-{row.slot}-{post?.slug ?? 'new'}" name="note" placeholder="给老板的一句话" bind:value={note}></textarea>
  <button type="submit" disabled={submitting}>{post?.status === "需改" ? "改完再交待审" : "标为待审"}</button>
</form>
