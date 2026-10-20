<script lang="ts">
  import { untrack } from "svelte";
  import type { MemoryView, MemoryKind } from "../../../worker/models";
  import { memoryKinds } from "../lib/api";
  let { item, busy, onsave, oncancel }: {
    item?: MemoryView; busy: boolean;
    onsave: (input: { text: string; kind: MemoryKind; tags: string[] }) => Promise<void>;
    oncancel: () => void;
  } = $props();
  let text = $state(untrack(() => item?.text ?? ""));
  let kind = $state<MemoryKind>(untrack(() => item?.kind ?? "note"));
  let tags = $state(untrack(() => item?.tags.join(", ") ?? ""));
</script>
<form class="editor" onsubmit={event => { event.preventDefault(); void onsave({ text, kind, tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }); }}>
  <fieldset disabled={busy}>
    <label>记忆内容<textarea bind:value={text} required maxlength="2000" rows="5"></textarea></label>
    <div class="fields">
      <label>类型<select bind:value={kind}>{#each Object.entries(memoryKinds) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
      <label>标签（逗号分隔，最多 10 个）<input bind:value={tags} maxlength="809" /></label>
    </div>
    <div class="actions"><button class="primary" type="submit">{busy ? "保存中…" : item?.status === "pending" ? "保存并确认" : "保存并生效"}</button><button type="button" onclick={oncancel}>取消</button></div>
  </fieldset>
</form>
