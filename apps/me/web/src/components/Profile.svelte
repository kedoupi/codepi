<script lang="ts">
  import { onMount } from "svelte";
  import { api, dateLabel } from "../lib/api";
  import type { ProfileView, ProfileProposalView, Page } from "../../../worker/models";
  let { onchanged }: { onchanged: () => Promise<void> } = $props();
  let profile = $state<Page<ProfileView>>({ items: [], next_offset: null });
  let proposals = $state<Page<ProfileProposalView>>({ items: [], next_offset: null });
  let editing = $state(false), editingProposal = $state<string | null>(null);
  let key = $state(""), value = $state(""), editValue = $state("");
  let busy = $state(false), loading = $state(true), message = $state(""), error = $state("");
  async function load() {
    loading = true; error = "";
    try { [profile, proposals] = await Promise.all([
      api<Page<ProfileView>>("/api/profile"), api<Page<ProfileProposalView>>("/api/profile/proposals"),
    ]); }
    catch (e) { error = (e as Error).message; }
    finally { loading = false; }
  }
  async function act(job: () => Promise<unknown>) {
    if (busy) return;
    busy = true; message = ""; error = "";
    try { await job(); editing = false; editingProposal = null; message = "已保存。"; await load(); await onchanged(); }
    catch (e) { error = (e as Error).message; }
    finally { busy = false; }
  }
  async function more(which: "profile" | "proposals") {
    loading = true;
    try {
      const current = which === "profile" ? profile : proposals;
      const next = await api<Page<ProfileView & ProfileProposalView>>(`/api/profile${which === "proposals" ? "/proposals" : ""}?offset=${current.next_offset}`);
      if (which === "profile") profile = { ...next, items: [...profile.items, ...next.items] };
      else proposals = { ...next, items: [...proposals.items, ...next.items] };
    } catch (e) { error = (e as Error).message; }
    finally { loading = false; }
  }
  onMount(() => { void load(); });
</script>
<div class="page-heading"><div><p class="eyebrow">02 / PROFILE</p><h1>关于自己</h1><p>背景由你维护，AI 的建议先等待你的确认。</p></div><button class="primary" onclick={() => { key = ""; value = ""; editing = true; }}>添加背景字段</button></div>
{#if error}<p class="notice error" role="alert">{error} <button onclick={load}>重试读取</button></p>{/if}
{#if message}<p class="notice" role="status">{message}</p>{/if}
{#if editing}
  <section class="panel"><h2>编辑个人背景</h2>
    <form onsubmit={e => { e.preventDefault(); void act(() => api(`/api/profile/${encodeURIComponent(key)}`, { value }, "PUT")); }}>
      <fieldset disabled={busy}><label>字段名<input required maxlength="80" bind:value={key} placeholder="例如 name、role、bio、working_style" /></label>
        <label>内容<textarea required maxlength="2000" rows="5" bind:value></textarea></label>
        <div class="actions"><button type="submit" class="primary">保存并生效</button><button type="button" onclick={() => editing = false}>取消</button></div>
      </fieldset>
    </form>
  </section>
{/if}
<section class="panel review-panel"><h2>待确认的背景提议</h2>
  {#if !proposals.items.length}<p class="empty-small">{loading ? "正在读取…" : "暂无背景提议。"}</p>{/if}
  {#each proposals.items as item (item.id)}
    <article class="record">
      <div class="record-meta"><span>{item.source_name || item.source_client}</span><time>{dateLabel(item.created_at)}</time></div>
      <h3>{item.key}</h3>
      {#if editingProposal === item.id}
        <form onsubmit={e => { e.preventDefault(); void act(() => api(`/api/profile/proposals/${item.id}/review`, { action: "edit_approve", value: editValue })); }}>
          <label>确认后的内容<textarea maxlength="2000" required rows="4" bind:value={editValue}></textarea></label>
          <div class="actions"><button class="primary" disabled={busy} type="submit">保存并确认</button><button type="button" onclick={() => editingProposal = null}>取消</button></div>
        </form>
      {:else}
        <p class="body-text">{item.value}</p><p class="muted fine">确认会更新个人背景中的 {item.key} 字段。</p>
        <div class="actions">
          <button class="primary" disabled={busy} onclick={() => act(() => api(`/api/profile/proposals/${item.id}/review`, { action: "approve" }))}>确认更新背景</button>
          <button disabled={busy} onclick={() => { editingProposal = item.id; editValue = item.value; }}>修改后确认</button>
          <button class="danger" disabled={busy} onclick={() => act(() => api(`/api/profile/proposals/${item.id}/review`, { action: "reject" }))}>拒绝</button>
        </div>
      {/if}
    </article>
  {/each}
  {#if proposals.next_offset !== null}<button disabled={loading} onclick={() => more("proposals")}>更多背景提议</button>{/if}
</section>
<section class="panel"><h2>已确认的背景</h2>
  {#if !profile.items.length}<p class="empty-small">{loading ? "正在读取…" : "还没有背景信息。可以从姓名、角色和一句简介开始。"}</p>{/if}
  {#each profile.items as item (item.key)}
    <article class="record"><div class="section-heading"><h3>{item.key}</h3><button onclick={() => { key = item.key; value = item.value; editing = true; window.scrollTo({ top: 0, behavior: "smooth" }); }}>编辑背景</button></div>
      <p class="body-text">{item.value}</p><p class="record-meta">更新于 {dateLabel(item.updated_at)}</p></article>
  {/each}
  {#if profile.next_offset !== null}<button disabled={loading} onclick={() => more("profile")}>更多背景字段</button>{/if}
</section>
