<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./api";
  import { APP_CATEGORIES, type AppCategory } from "./trends";

  type SettingsPayload = {
    pending_recompute_days: { days: number; from: string | null; to: string | null };
    app_categories: Record<string, AppCategory>;
    other_network_names: Record<string, string>;
  };
  type Row = { id: number; key: string; value: AppCategory };

  let loaded = $state<SettingsPayload | null>(null);
  let message = $state("");
  let status = $state<{ kind: "ok" | "error"; text: string } | null>(null);
  let saving = $state(false);
  let recomputing = $state(false);
  let appRows = $state<Row[]>([]);
  let networkRows = $state<Array<{ id: number; key: string; value: string }>>([]);
  let nextId = 0;

  function rows(map: Record<string, string>): Row[] {
    return Object.entries(map).map(([key, value]) => ({ id: ++nextId, key, value: value as AppCategory }));
  }

  function apply(payload: SettingsPayload) {
    loaded = payload;
    appRows = rows(payload.app_categories);
    networkRows = Object.entries(payload.other_network_names).map(([key, value]) => ({ id: ++nextId, key, value }));
  }

  async function load() {
    message = "";
    try { apply(await api<SettingsPayload>("/api/settings")); }
    catch (error) { loaded = null; message = (error as Error).message; }
  }

  function collect<T extends { key: string; value: string }>(list: T[], label: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const row of list) {
      const key = row.key.trim();
      const value = row.value.trim();
      if (!key && !value) continue;
      if (!key || !value) throw new Error(`${label}有一行没填完整。`);
      if (key in result) throw new Error(`${label}里「${key}」重复了。`);
      result[key] = value;
    }
    return result;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    status = null;
    let body: { app_categories: Record<string, string>; other_network_names: Record<string, string> };
    try {
      body = {
        app_categories: collect(appRows, "App 归类"),
        other_network_names: collect(networkRows, "网络改名"),
      };
    } catch (error) {
      status = { kind: "error", text: (error as Error).message };
      return;
    }
    saving = true;
    try {
      apply(await api<SettingsPayload>("/api/settings", { method: "PUT", body }));
      status = { kind: "ok", text: "已保存。" };
    } catch (error) {
      status = { kind: "error", text: (error as Error).message };
    } finally {
      saving = false;
    }
  }

  const pending = $derived(loaded?.pending_recompute_days ?? { days: 0, from: null, to: null });
  const groupedApps = $derived(APP_CATEGORIES.map(category => ({
    category,
    apps: appRows.filter(row => row.value === category),
  })));
  const RECOMPUTE_CHUNK_DAYS = 7;

  function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
  }

  async function recompute() {
    if (!pending.from || !pending.to) return;
    recomputing = true;
    status = null;
    let total = 0;
    try {
      for (let from = pending.from; from <= pending.to; from = addDays(from, RECOMPUTE_CHUNK_DAYS)) {
        const end = addDays(from, RECOMPUTE_CHUNK_DAYS - 1);
        const to = end < pending.to ? end : pending.to;
        const result = await api<{ days_recomputed: number }>(`/api/admin/recompute?from=${from}&to=${to}`, { method: "POST" });
        total += result.days_recomputed;
      }
      await load();
      status = { kind: "ok", text: `已重算 ${total} 天。` };
    } catch (error) {
      await load();
      status = { kind: "error", text: `重算中断（已完成 ${total} 天）：${(error as Error).message}` };
    } finally {
      recomputing = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="page-heading">
  <div><p class="eyebrow">设置 / SETTINGS</p><h1>设置</h1><p class="muted">只影响本看板怎么解释数据，不会改动任何设备。</p></div>
</section>

{#if message}
  <div class="notice error" role="alert"><strong>设置暂不可用</strong><span>{message}</span><button onclick={load}>重试</button></div>
{:else if !loaded}
  <div class="empty" role="status">正在读取设置…</div>
{:else}
  {#if pending.days > 0}
    <div class="notice" role="status">
      <strong>有 {pending.days} 天需要重算</strong>
      <span>{pending.from} 至 {pending.to} 的汇总是按旧设置算的。每天凌晨只自动重算最近 3 天，更早的日子需要手动重算（按 7 天一段依次进行）。</span>
      <button onclick={recompute} disabled={recomputing}>{recomputing ? "正在重算…" : "重算这些日子"}</button>
    </div>
  {/if}

  <form class="settings-form" onsubmit={save}>
    <section class="panel app-category-panel">
      <div class="section-heading"><div><h2>App 归类</h2><p class="muted">按 App 名或 bundle id 归类；工作沟通、私人会打断专注。改完后保存会标记已有汇总待重算。</p></div><span class="fine">全部 {appRows.length} 个 App</span></div>
      <div class="category-overview" aria-label="八类归类概览">
        {#each groupedApps as group}
          <article class="category-card" data-category={group.category}><strong>{group.category}</strong><span>{group.apps.length ? group.apps.map(app => app.key).join("、") : "还没有归类的 App"}</span></article>
        {/each}
      </div>
      <h3>全部 App</h3>
      <div class="edit-rows app-list">
        {#each appRows as row (row.id)}
          <div class="edit-row app-edit-row">
            <input aria-label="App 名" placeholder="App 名或 bundle id" bind:value={row.key} maxlength="200" />
            <select aria-label="类别" bind:value={row.value}>{#each APP_CATEGORIES as category}<option value={category}>{category}</option>{/each}</select>
            <button type="button" aria-label={`删除 ${row.key || "这一行"}`} onclick={() => (appRows = appRows.filter(item => item.id !== row.id))}>删除</button>
          </div>
        {/each}
      </div>
      <button type="button" onclick={() => (appRows = [...appRows, { id: ++nextId, key: "", value: "其他" }])}>添加 App</button>
    </section>

    <section class="panel">
      <h2>其他网络改名</h2>
      <p class="muted">把工作机连过的网络标识或网络名改成好认的名字，只在本看板显示。</p>
      <div class="edit-rows">
        {#each networkRows as row (row.id)}
          <div class="edit-row">
            <input aria-label="网络标识" placeholder="网络标识或名称" bind:value={row.key} maxlength="200" />
            <input aria-label="显示名称" placeholder="显示名称" bind:value={row.value} maxlength="200" />
            <button type="button" aria-label={`删除 ${row.key || "这一行"}`} onclick={() => (networkRows = networkRows.filter(item => item.id !== row.id))}>删除</button>
          </div>
        {/each}
      </div>
      <button type="button" onclick={() => (networkRows = [...networkRows, { id: ++nextId, key: "", value: "" }])}>添加网络</button>
    </section>

    <div class="form-actions">
      <button class="primary" type="submit" disabled={saving}>{saving ? "保存中…" : "保存设置"}</button>
      {#if status}<p class:error-text={status.kind === "error"} class:save-ok={status.kind === "ok"} role={status.kind === "error" ? "alert" : "status"}>{status.text}</p>{/if}
    </div>
    <p class="fine muted">保存后，已汇总的日子会标记为需要重算；不会自动大批量重算。</p>
  </form>
{/if}
