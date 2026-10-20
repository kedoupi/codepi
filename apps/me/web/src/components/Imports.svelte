<script lang="ts">
  import { onMount } from "svelte";
  import { api, dateLabel, statuses } from "../lib/api";
  import type { ImportView, Page } from "../../../worker/models";
  let { onchanged }: { onchanged: () => Promise<void> } = $props();
  let records = $state<Page<ImportView>>({ items: [], next_offset: null });
  let text = $state(""), split = $state("line"), busy = $state(false), loading = $state(true);
  let message = $state(""), error = $state(""), requestId = $state(crypto.randomUUID());
  let confirmBatch = $state<{ id: string; action: "approve" | "reject"; count: number } | null>(null);
  const preview = $derived(text.split(split === "line" ? /\r?\n/ : /\r?\n\s*\r?\n/).map(item => item.trim()).filter(Boolean));
  const bytes = $derived(new TextEncoder().encode(text).length);
  async function load(append = false) {
    loading = true;
    try {
      const result = await api<Page<ImportView>>(`/api/imports?offset=${append ? records.next_offset : 0}`);
      records = { ...result, items: append ? [...records.items, ...result.items] : result.items };
    } catch (e) { error = (e as Error).message; }
    finally { loading = false; }
  }
  async function act(job: () => Promise<unknown>, done: string) {
    if (busy) return;
    busy = true; message = ""; error = "";
    try { await job(); confirmBatch = null; message = done; await load(); await onchanged(); }
    catch (e) { error = (e as Error).message; }
    finally { busy = false; }
  }
  async function paste(e: SubmitEvent) {
    e.preventDefault();
    await act(async () => {
      await api("/api/imports/paste", { text, split, request_id: requestId });
      text = ""; requestId = crypto.randomUUID();
    }, "导入完成，内容已进入待确认区。");
  }
  onMount(() => { void load(); });
</script>
<div class="page-heading"><div><p class="eyebrow">04 / IMPORTS</p><h1>把记忆带回来</h1><p>每个 AI 可完成一次首次导入。完成后仍需你确认，才会被读取。</p></div><a class="button" href="/">查看待确认区</a></div>
{#if error}<p class="notice error" role="alert">{error} <button onclick={() => { error = ""; void load(); }}>重试读取</button></p>{/if}
{#if message}<p class="notice" role="status">{message}</p>{/if}
<section class="panel"><h2>粘贴导入</h2><p class="muted">每条只写一件事。最多 500 条、512 KiB。不要粘贴密码或密钥。</p>
  <form onsubmit={paste}><fieldset disabled={busy}>
    <label>分条方式<select bind:value={split} onchange={() => requestId = crypto.randomUUID()}><option value="line">按行分条</option><option value="paragraph">按空行分条</option></select></label>
    <label>原文<textarea bind:value={text} oninput={() => requestId = crypto.randomUUID()} rows="8" required placeholder="在这里粘贴你希望保留的记忆"></textarea></label>
    <p class="muted" aria-live="polite">{preview.length} 条 · {(bytes / 1024).toFixed(1)} KiB</p>
    {#if preview.length}<details><summary>预览前 5 条</summary><ol>{#each preview.slice(0, 5) as line}<li class="body-text">{line}</li>{/each}</ol></details>{/if}
    <button class="primary" type="submit" disabled={!preview.length || preview.length > 500 || bytes > 512 * 1024}>{busy ? "导入中…" : "导入到待确认区"}</button>
  </fieldset></form>
</section>
<section class="panel"><div class="section-heading"><h2>导入记录</h2><button disabled={loading || busy} onclick={() => load()}>刷新状态</button></div>
  <p class="muted fine">原文私有保存。此处显示进度与确认状态；未完成的导入不会进入记忆库。</p>
  {#if !records.items.length}<p class="empty-small">{loading ? "正在读取…" : "还没有导入记录。"}</p>{/if}
  {#each records.items as item (item.id)}
    <article class="record">
      <div class="section-heading"><div><h3>{item.source_name || item.source_client}</h3><p class="record-meta">{item.source_client} · {dateLabel(item.created_at)}</p></div><span class="badge">{statuses[item.status]}</span></div>
      <p class="import-counts">{item.item_count} 条 · 已确认 {item.approved_count} · 待确认 {item.pending_count} · 已拒绝 {item.memory_rejected_count}</p>
      {#if item.status !== "finished"}<p class="muted">已收到 {item.chunk_count} 个分块，下一分块序号 {item.next_index}。</p>{/if}
      {#if item.error_code}<p class="notice error">导入未完成，请重试完成操作。</p>{/if}
      {#if confirmBatch?.id === item.id}
        <div class="confirm-box"><p>将{confirmBatch.action === "approve" ? "确认" : "拒绝"}这一批的 {confirmBatch.count} 条待确认记忆。确认后已授权 AI 可以读取这些记忆。</p>
          <div class="actions"><button class="primary" disabled={busy} onclick={() => { const batch = confirmBatch!; void act(() => api(`/api/imports/${batch.id}/review`, { action: batch.action }), "本批待确认记忆已处理。"); }}>确认处理本批</button>
            <button onclick={() => confirmBatch = null}>取消</button></div></div>
      {:else}
        <div class="actions">
          {#if item.status === "finished" && item.pending_count}
            <button class="primary" disabled={busy} onclick={() => confirmBatch = { id: item.id, action: "approve", count: item.pending_count }}>确认本批待确认内容</button>
            <button class="danger" disabled={busy} onclick={() => confirmBatch = { id: item.id, action: "reject", count: item.pending_count }}>拒绝本批待确认内容</button>
          {:else if ["open", "finishing"].includes(item.status) && item.item_count}
            <button disabled={busy} onclick={() => act(() => api(`/api/imports/${item.id}/finish`, {}), "导入已完成，等待确认。")}>完成已收到的导入</button>
          {/if}
        </div>
      {/if}
    </article>
  {/each}
  {#if records.next_offset !== null}<button disabled={loading} onclick={() => load(true)}>更多导入记录</button>{/if}
</section>
