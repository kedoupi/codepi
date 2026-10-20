<script lang="ts">
  import { untrack } from "svelte";
  import { timelineKinds } from "../lib/api";
  import type { TimelineDetail, TimelineKind } from "../../../worker/models";
  let { item, busy, onsave, oncancel }: {
    item?: TimelineDetail | null; busy: boolean; onsave: (input: Record<string, string>) => Promise<void>; oncancel: () => void;
  } = $props();
  let kind = $state<TimelineKind>(untrack(() => item?.kind ?? "work"));
  let title = $state(untrack(() => item?.title ?? "")), org = $state(untrack(() => item?.org ?? ""));
  let started_on = $state(untrack(() => item?.started_on ?? "")), ended_on = $state(untrack(() => item?.ended_on ?? ""));
  let body = $state(untrack(() => item?.body ?? ""));
</script>
<form class="editor" onsubmit={e => { e.preventDefault(); void onsave({ kind, title, org, started_on, ended_on, body }); }}>
  <fieldset disabled={busy}>
    <div class="fields"><label>类型<select bind:value={kind}>{#each Object.entries(timelineKinds) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
      <label>标题<input required maxlength="200" bind:value={title} /></label>
      <label class="wide">组织（选填）<input maxlength="200" bind:value={org} /></label>
      <label>开始日期<input maxlength="10" bind:value={started_on} placeholder="YYYY / YYYY-MM / YYYY-MM-DD" /></label>
      <label>结束日期（选填）<input maxlength="10" bind:value={ended_on} placeholder="留空表示持续至今" /></label></div>
    <label>经历正文<textarea maxlength="8000" rows="8" bind:value={body}></textarea></label>
    <div class="actions"><button class="primary" type="submit">{item?.status === "pending" ? "保存并确认" : "保存并生效"}</button><button type="button" onclick={oncancel}>取消</button></div>
  </fieldset>
</form>
