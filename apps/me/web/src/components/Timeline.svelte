<script lang="ts">
  import { onMount } from "svelte";
  import { api, dateLabel, queryString, timelineKinds, statuses } from "../lib/api";
  import type { TimelineDetail, TimelineView, Page } from "../../../worker/models";
  import TimelineEditor from "./TimelineEditor.svelte";
  let { onchanged }: { onchanged: () => Promise<void> } = $props();
  let pending = $state<Page<TimelineView>>({ items: [], next_offset: null }), records = $state<Page<TimelineView>>({ items: [], next_offset: null });
  let editing = $state<TimelineDetail | null>(null), adding = $state(false);
  let expanded = $state<TimelineDetail | null>(null);
  let busy = $state(false), loading = $state(true), error = $state(""), message = $state("");
  let query = $state(""), kind = $state(""), from = $state(""), to = $state(""), status = $state("active");
  let filters: Record<string, string> = { status: "active" };
  async function read(which: "pending" | "records", append = false) {
    const old = which === "pending" ? pending : records;
    const result = await api<Page<TimelineView>>(`/api/timeline?${queryString({
      ...(which === "pending" ? { status: "pending" } : filters), offset: append ? old.next_offset : 0, limit: 10,
    })}`);
    const next = { ...result, items: append ? [...old.items, ...result.items] : result.items };
    if (which === "pending") pending = next; else records = next;
  }
  async function load() {
    loading = true; error = "";
    try { await Promise.all([read("pending"), read("records")]); }
    catch (e) { error = (e as Error).message; }
    finally { loading = false; }
  }
  async function act(job: () => Promise<unknown>, done = "已保存。") {
    if (busy) return;
    busy = true; error = ""; message = "";
    try { await job(); editing = null; adding = false; expanded = null; message = done; await load(); await onchanged(); }
    catch (e) { error = (e as Error).message; }
    finally { busy = false; }
  }
  async function open(item: TimelineView, edit: boolean) {
    try {
      const data = await api<TimelineDetail>(`/api/timeline/${item.id}`);
      if (edit) { editing = data; adding = false; } else expanded = data;
    } catch (e) { error = (e as Error).message; }
  }
  async function save(input: Record<string, string>) {
    const item = editing;
    await act(() => item ? item.status === "pending"
      ? api(`/api/timeline/${item.id}/review`, { action: "edit_approve", ...input })
      : api(`/api/timeline/${item.id}`, input, "PUT")
      : api("/api/timeline", input));
  }
  async function search(e: SubmitEvent) {
    e.preventDefault(); filters = { query, kind, from, to, status }; loading = true; error = "";
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
<div class="page-heading"><div><p class="eyebrow">03 / TIMELINE</p><h1>走过的路</h1><p>把工作、创业与生活中的重要片段，按时间收好。</p></div><button class="primary" onclick={() => { adding = true; editing = null; }}>亲自添加经历</button></div>
{#if error}<p class="notice error" role="alert">{error} <button onclick={load}>重试读取</button></p>{/if}
{#if message}<p class="notice" role="status">{message}</p>{/if}
{#if adding}<section class="panel"><h2>新的经历</h2><TimelineEditor {busy} onsave={save} oncancel={() => adding = false} /></section>{/if}
{#each [{ title: "待确认的经历", data: pending, review: true }, { title: "经历时间线", data: records, review: false }] as section}
  <section class:review-panel={section.review} class="panel">
    <h2>{section.title}</h2>
    {#if !section.review}
      <form class="filters" onsubmit={search}>
        <label class="wide">搜索经历<input type="search" maxlength="200" bind:value={query} /></label>
        <label>类型<select bind:value={kind}><option value="">全部</option>{#each Object.entries(timelineKinds) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
        <label>开始于<input maxlength="10" bind:value={from} placeholder="YYYY-MM-DD" /></label>
        <label>截止于<input maxlength="10" bind:value={to} placeholder="YYYY-MM-DD" /></label>
        <label>状态<select bind:value={status}><option value="active">已确认</option><option value="archived">已归档</option><option value="rejected">已拒绝</option></select></label>
        <button type="submit" disabled={loading}>搜索经历</button>
      </form>
    {/if}
    {#if !section.data.items.length}<p class="empty-small">{loading ? "正在读取…" : section.review ? "暂无经历提议。" : "没有匹配的经历。可以亲自添加，或在 AI 提交后确认。"}</p>{/if}
    {#each section.data.items as item (item.id)}
      <article class="record timeline-record">
        <div class="record-meta"><span>{timelineKinds[item.kind]} · {statuses[item.status]}</span><span>{item.source_name || item.source_client}</span><time>{dateLabel(item.updated_at)}</time></div>
        {#if editing?.id === item.id}
          {#key editing.id}<TimelineEditor item={editing} {busy} onsave={save} oncancel={() => editing = null} />{/key}
        {:else}
          <p class="timeline-date">{item.started_on || "日期待补"} — {item.ended_on || "至今"}</p>
          <h3>{item.title}</h3>{#if item.org}<p class="muted">{item.org}</p>{/if}
          <p class="body-text">{expanded?.id === item.id ? expanded.body : item.body_excerpt}</p>
          <div class="actions">
            {#if expanded?.id !== item.id}<button disabled={busy} onclick={() => open(item, false)}>查看全文</button>{/if}
            {#if section.review}<button class="primary" disabled={busy} onclick={() => act(() => api(`/api/timeline/${item.id}/review`, { action: "approve" }))}>确认经历</button>{/if}
            {#if section.review || item.status === "active"}<button disabled={busy} onclick={() => open(item, true)}>{section.review ? "修改后确认" : "编辑经历"}</button>{/if}
            {#if item.status === "active"}<button class="danger" disabled={busy} onclick={() => act(() => api(`/api/timeline/${item.id}/archive`, {}), "已归档，AI 将不再读取。")}>归档</button>{/if}
            {#if section.review}<button class="danger" disabled={busy} onclick={() => act(() => api(`/api/timeline/${item.id}/review`, { action: "reject" }))}>拒绝</button>{/if}
          </div>
        {/if}
      </article>
    {/each}
    {#if section.data.next_offset !== null}<button disabled={loading} onclick={() => more(section.review ? "pending" : "records")}>更多经历</button>{/if}
  </section>
{/each}
