<script lang="ts">
  import { onMount } from "svelte";
  import { api, dateLabel, memoryKinds, queryString, statuses } from "../lib/api";
  import type { MemoryView, Page, MemoryKind } from "../../../worker/models";
  import MemoryEditor from "./MemoryEditor.svelte";
  let { onchanged }: { onchanged: () => Promise<void> } = $props();
  let pending = $state<Page<MemoryView>>({ items: [], next_offset: null });
  let records = $state<Page<MemoryView>>({ items: [], next_offset: null });
  let query = $state(""), kind = $state(""), tag = $state(""), source = $state(""), status = $state("active");
  let editing = $state<MemoryView | null>(null), adding = $state(false), busy = $state(false), loading = $state(true);
  let message = $state(""), error = $state("");
  let filters: Record<string, string> = { status: "active" }, version = 0;
  async function read(which: "pending" | "records", append = false) {
    const current = which === "pending" ? pending : records;
    const requestVersion = ++version;
    const result = await api<Page<MemoryView>>(`/api/memories?${queryString({
      ...(which === "pending" ? { status: "pending" } : filters), limit: 10,
      offset: append ? current.next_offset : 0,
    })}`);
    if (requestVersion !== version) return;
    const next = { ...result, items: append ? [...current.items, ...result.items] : result.items };
    if (which === "pending") pending = next; else records = next;
  }
  async function load() {
    loading = true; error = "";
    try { await read("pending"); await read("records"); }
    catch (e) { error = (e as Error).message; }
    finally { loading = false; }
  }
  async function act(job: () => Promise<unknown>, done: string) {
    if (busy) return;
    busy = true; error = ""; message = "";
    try { await job(); editing = null; adding = false; message = done; await load(); await onchanged(); }
    catch (e) { error = (e as Error).message; }
    finally { busy = false; }
  }
  async function save(input: { text: string; kind: MemoryKind; tags: string[] }) {
    const item = editing;
    await act(() => item ? item.status === "pending"
      ? api(`/api/memories/${item.id}/review`, { action: "edit_approve", ...input })
      : api(`/api/memories/${item.id}`, input, "PUT") : api("/api/memories", input), "已保存并生效。");
  }
  async function search(event: SubmitEvent) {
    event.preventDefault();
    filters = { query, kind, tag, source, status };
    loading = true; error = "";
    try { await read("records"); } catch (e) { error = (e as Error).message; }
    finally { loading = false; }
  }
  async function more(which: "pending" | "records") {
    loading = true;
    try { await read(which, true); } catch (e) { error = (e as Error).message; }
    finally { loading = false; }
  }
  onMount(() => { void load(); });
</script>

<div class="page-heading"><div><p class="eyebrow">01 / MEMORY</p><h1>由你确认的记忆</h1><p>AI 提交的每一条内容，都先停在待确认区。</p></div><button class="primary" onclick={() => { editing = null; adding = true; }}>亲自记一条</button></div>
{#if error}<p class="notice error" role="alert">{error} <button onclick={load}>重试读取</button></p>{/if}
{#if message}<p class="notice" role="status">{message}</p>{/if}
{#if adding}<section class="panel"><h2>亲自记录</h2><p class="muted">保存后立即生效，可供已授权 AI 读取。</p><MemoryEditor {busy} onsave={save} oncancel={() => adding = false} /></section>{/if}
<section class="panel review-panel" aria-label="待确认区" aria-busy={loading}>
  <div class="section-heading"><div><span class="badge">需要你确认</span><h2>待确认区</h2></div><a href="/imports">按导入批次处理 ↗</a></div>
  {#if !pending.items.length}<p class="empty-small">{loading ? "正在读取…" : "没有待确认的记忆。背景和经历提议可在各自页面查看。"}</p>{/if}
  {#each pending.items as item (item.id)}
    <article class="record">
      <div class="record-meta"><span>{memoryKinds[item.kind]}</span><span>{item.source_name || item.source_client}</span><time>{dateLabel(item.created_at)}</time>{#if item.import_id}<a href="/imports">来自导入</a>{/if}</div>
      {#if editing?.id === item.id}<MemoryEditor {item} {busy} onsave={save} oncancel={() => editing = null} />
      {:else}
        <p class="body-text">{item.text}</p><div class="tags">{#each item.tags as tag}<span>{tag}</span>{/each}</div>
        <div class="actions">
          <button class="primary" disabled={busy} onclick={() => act(() => api(`/api/memories/${item.id}/review`, { action: "approve" }), "已确认，可供 AI 读取。")}>确认</button>
          <button disabled={busy} onclick={() => editing = item}>修改后确认</button>
          <button class="danger" disabled={busy} onclick={() => act(() => api(`/api/memories/${item.id}/review`, { action: "reject" }), "已拒绝。")}>拒绝</button>
        </div>
      {/if}
    </article>
  {/each}
  {#if pending.next_offset !== null}<button disabled={loading} onclick={() => more("pending")}>更多待确认记忆</button>{/if}
</section>
<section class="panel" aria-label="记忆列表">
  <h2>记忆库</h2>
  <form class="filters" onsubmit={search}>
    <label class="wide">搜索<input type="search" bind:value={query} maxlength="200" placeholder="试试两个字，例如「写作」" /></label>
    <label>类型<select bind:value={kind}><option value="">全部类型</option>{#each Object.entries(memoryKinds) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
    <label>标签<input bind:value={tag} maxlength="80" placeholder="精确标签" /></label>
    <label>来源客户端<input bind:value={source} maxlength="200" placeholder="客户端 ID 或 board" /></label>
    <label>状态<select bind:value={status}><option value="active">已确认</option><option value="rejected">已拒绝</option><option value="archived">已归档</option></select></label>
    <button type="submit" disabled={loading}>搜索记忆</button>
  </form>
  {#if !records.items.length}<p class="empty-small">{loading ? "正在读取…" : "没有匹配的记忆。试试其他关键词，或亲自记下第一条。"}</p>{/if}
  {#each records.items as item (item.id)}
    <article class="record">
      <div class="record-meta"><span>{memoryKinds[item.kind]} · {statuses[item.status]}</span><span title={item.source_client}>{item.source_name || item.source_client}</span><time>{dateLabel(item.updated_at)}</time></div>
      {#if editing?.id === item.id}<MemoryEditor {item} {busy} onsave={save} oncancel={() => editing = null} />
      {:else}
        <p class="body-text">{item.text}</p><div class="tags">{#each item.tags as tag}<span>{tag}</span>{/each}</div>
        {#if item.status === "active"}
          <div class="actions">
            <button disabled={busy} onclick={() => editing = item}>编辑</button>
            <button class="danger" disabled={busy}
              onclick={() => act(() => api(`/api/memories/${item.id}/archive`, {}), "已归档，AI 将不再读取。")}>归档</button>
          </div>
        {/if}
      {/if}
    </article>
  {/each}
  {#if records.next_offset !== null}<button disabled={loading} onclick={() => more("records")}>更多记忆</button>{/if}
</section>
