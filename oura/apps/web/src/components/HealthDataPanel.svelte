<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorText, RequestError } from "../lib/api";
  import { createAutomaticSync } from "../lib/automatic-sync";
  import type { HealthCollection, AutomaticSyncStatus, SyncFailure } from "../lib/health";
  import AutomaticSync from "./AutomaticSync.svelte";
  import type { Locale } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";

  let { locale }: { locale: Locale } = $props();
  type Collection = HealthCollection & { failed_ranges?: SyncFailure[] };
  let collections = $state<Collection[]>([]);
  let automatic = $state<AutomaticSyncStatus | null>(null);
  let busy = $state(false);
  let disposed = false;
  let coverageRevision = 0;
  let lastCoverageRefresh = 0;
  let coverageRefreshPending = false;
  const coverageRequest = new AbortController();
  let error = $state("");
  let errorCode = $state("");
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const label = (row: Collection) => row.label.split(" / ")[locale === "zh" ? 0 : 1] || row.name;
  const collectionLabel = (name: string) => { const row = collections.find(row => row.name === name); return row ? label(row) : name; };
  const pausedNames = $derived([...new Set([
    ...(automatic?.unavailable ?? []).map(row => row.collection),
    ...collections.filter(row => row.access?.status === "unavailable").map(row => row.name),
  ])]);
  const storedFailures = $derived(collections.filter(row => !pausedNames.includes(row.name)).flatMap(row => row.failed_ranges ?? []));
  const failureGroups = $derived([...new Set(storedFailures.map(f => f.collection))].map(name => ({
    name, failures: storedFailures.filter(f => f.collection === name),
  })));
  const needsReconnect = $derived(errorCode === "reconnect_required" || storedFailures.some(f => ["reconnect_required", "unauthorized"].includes(f.code)));
  const savedTypes = $derived(collections.filter(row => row.records > 0).length);
  const current = $derived(automatic?.status === "running" && !pausedNames.includes(automatic.current?.collection ?? "") ? automatic.current : null);
  const updating = $derived(busy || automatic?.status === "running");
  const sync = createAutomaticSync({
    onStatus: (value, previous) => {
      automatic = value;
      error = "";
      errorCode = "";
      const accessChanged = JSON.stringify(value.unavailable ?? []) !== JSON.stringify(previous?.unavailable ?? []);
      coverageRefreshPending ||= value.details.completed !== previous?.details.completed || value.details.failed !== previous?.details.failed
        || value.finished_at !== previous?.finished_at || value.started_at !== previous?.started_at || accessChanged;
      if (coverageRefreshPending && (accessChanged || Date.now() - lastCoverageRefresh >= 30_000 || value.status !== "running")) {
        coverageRefreshPending = false;
        lastCoverageRefresh = Date.now();
        void load().catch(handleError);
      }
    },
    onError: handleError,
  });
  function handleError(err: unknown) {
    if (disposed) return;
    error = errorText(err, locale);
    errorCode = err instanceof RequestError ? err.code : "";
  }
  function failureText(failure: SyncFailure) {
    if (failure.code === "sync_window_too_large") return failure.from === failure.to
      ? text("这一天的数据仍超过处理上限，其他日期会继续同步。", "This day still exceeds the limit. Other days will continue.")
      : text("这个批次数据较多，继续同步时会自动拆分日期，无需手动调整。", "This batch is large. Retrying will split its dates automatically.");
    return errorText(new RequestError(failure.code, 0, "", failure.retryAt), locale);
  }
  async function load() {
    const revision = ++coverageRevision;
    const result = await api<{ collections: Collection[] }>("/api/me/health-records/status", { signal: coverageRequest.signal });
    // Coverage reads must never overwrite a more recent automatic queue snapshot.
    if (!disposed && revision === coverageRevision) collections = result.collections;
  }
  onMount(() => {
    const backfill = new URLSearchParams(window.location.search).get("sync") === "90";
    if (backfill) goto("/settings", true);
    lastCoverageRefresh = Date.now();
    void load().catch(handleError);
    if (backfill) void updateData();
    else void sync.refresh();
    return () => { disposed = true; coverageRevision++; coverageRequest.abort(); sync.dispose(); };
  });

  async function updateData() {
    if (busy) return;
    busy = true;
    error = "";
    errorCode = "";
    try { await sync.start(); }
    finally { if (!disposed) busy = false; }
  }
</script>

<section class="panel health-data" id="data">
  <div class="data-heading"><div><h2>{text("数据采集与历史记录", "Health data and history")}</h2><p class="hint">{text("已保存的数据会保留。心率、电量逐日同步；遇到数据量上限会自动拆分日期。", "Saved history is retained. Heart rate and battery sync daily; oversized ranges split automatically.")}</p></div><span class="data-count">{savedTypes}/{collections.length || 18} {text("类已有数据", "collections saved")}</span></div>
  {#if automatic}<AutomaticSync value={automatic} {locale} {collections} />{/if}
  {#if !automatic && pausedNames.length}
    <div class="access-notice" role="status">
      <strong>{pausedNames.length} {text("类数据因 Oura 上游访问受限已暂停", "collections paused due to Oura access restrictions")}</strong>
      <p>{pausedNames.map(collectionLabel).join(locale === "zh" ? "、" : ", ")}</p>
      <p>{text("已有记录保留，其他数据继续更新。“更新数据”不会重试这些类别；重新授权后会重新检测访问情况。", "Saved records are retained and other data continues to update. “Update data” does not retry these collections; access is checked again after reauthorization.")}</p>
    </div>
  {/if}
  <div class="actions">
    <button class="ai-btn primary-action" disabled={updating || automatic?.enabled === false || automatic?.status === "blocked" || errorCode === "reconnect_required"} onclick={updateData}>{updating ? text("更新中…", "Updating…") : text("更新数据", "Update data")}</button>
  </div>
  <p class="hint">{text("任务提交后可关闭页面；后台会继续更新，重新打开即可查看进度。", "You can close this page after submitting. Updates continue in the background; reopen it to see progress.")}</p>
  {#if error}<p class="error" role="alert">{error}{#if errorCode === "reconnect_required"} <a href="/api/auth/oura/start">{text("重新连接 Oura", "Reconnect Oura")}</a>{/if}</p>{/if}
  {#if failureGroups.length}
    <div class="sync-issues" role="status">
      <strong>{failureGroups.length} {text("类数据需要处理", "collections need attention")}</strong>
      {#each failureGroups as group}
        <div class="sync-issue"><div><strong>{collectionLabel(group.name)}</strong><p>{failureText(group.failures[0])}</p></div>
          <details><summary>{text("查看批次详情", "Batch details")} ({group.failures.length})</summary>
            <ul>{#each group.failures as failure}<li>{failure.from} — {failure.to}{#if failure.requestId} · {text("请求编号", "Request ID")} {failure.requestId.slice(0, 8)}{/if}</li>{/each}</ul>
          </details>
        </div>
      {/each}
      {#if needsReconnect}<a class="ai-btn" href="/api/auth/oura/start?sync_health=1">{text("重新连接并继续补齐", "Reconnect and continue")}</a>{/if}
    </div>
  {/if}
  <div class="collections">
    {#each collections as row (row.name)}
      <div class="collection" class:syncing={current?.collection === row.name}>
        <div class="collection-heading"><strong>{label(row)}</strong>{#if pausedNames.includes(row.name)}<span class="collection-badge access-paused-badge">{text("访问暂停", "Access paused")}</span>{:else if current?.collection === row.name}<span class="collection-badge">{text("下一批次", "Next batch")}</span>{/if}</div>
        <span class="record-count">{row.records.toLocaleString(locale === "zh" ? "zh-CN" : "en")} <small>{text("条记录", "records")}</small></span>
        <span class="hint">{row.earliest_day ? `${row.earliest_day} — ${row.latest_day}` : row.records ? text("当前快照", "Current snapshot") : "—"}</span>
        <span class="hint">{pausedNames.includes(row.name) ? text("上游访问受限，自动更新已暂停", "Upstream access restricted; automatic updates paused")
          : row.failed_windows ? text("有未完成批次", "Some batches are unfinished")
          : !row.last_attempt?.synced_at ? text("等待同步", "Awaiting sync")
          : row.records ? text("已有数据", "Data saved") : text("已同步，暂无记录", "Synced, no records")}</span>
      </div>
    {/each}
  </div>
  <p class="hint data-help">{pausedNames.length ? text("访问受限不代表授权已失效，无需反复点击更新。记录数可能包含同一天的多段记录，不等于天数。", "Access restrictions do not mean authorization has expired; repeated updates are not needed. Multiple records can belong to one day; record counts are not day counts.")
    : text("仅在提示授权失效或新增权限时重新连接。记录数可能包含同一天的多段记录，不等于天数。", "Reconnect only for expired authorization or new permissions. Multiple records can belong to one day; record counts are not day counts.")} {#if !busy}<a href="/api/auth/oura/start?sync_health=1">{pausedNames.length ? text("重新授权 Oura（可选）", "Reauthorize Oura (optional)") : text("重新连接 Oura", "Reconnect Oura")}</a>{/if}</p>
</section>

<style>
  .data-heading,.collection-heading{display:flex;justify-content:space-between;align-items:center;gap:14px}.data-heading{align-items:flex-start}.data-heading h2{margin-bottom:6px}.data-count{white-space:nowrap;font-size:12px;color:var(--muted);padding-top:5px}.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:20px 0}a.ai-btn{text-decoration:none;display:inline-flex}.primary-action{background:#ea580c;color:white;border-color:#ea580c}.sync-issues{border:1px solid #e9d4bb;background:#fffaf3;border-radius:14px;padding:18px 20px;margin:18px 0;font-size:14px}.sync-issue{padding:12px 0;border-top:1px solid var(--line);margin-top:12px}.sync-issue p{color:#9a3412;margin-top:4px;max-width:70ch}.sync-issue details{font-size:12px;color:var(--muted);margin-top:8px}.sync-issue summary{cursor:pointer;padding:4px 0}.sync-issue ul{padding:8px 0 0 20px;overflow-wrap:anywhere}.collections{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.collection{display:grid;gap:8px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#fffaf5}.collection.syncing{border-color:#ea580c;background:#fff7ed}.collection .hint{margin:0;font-size:12px}.collection-badge{font-size:11px;color:#9a3412;white-space:nowrap}.record-count{font-size:24px;font-variant-numeric:tabular-nums}.record-count small{font-size:12px;color:var(--muted)}.error{color:#9a3412;overflow-wrap:anywhere}.data-help{margin-top:20px!important;font-size:12px;line-height:1.7}.data-help a{color:#9a3412;text-decoration:underline}.actions button:disabled{opacity:.6;cursor:default}
  .access-notice{margin:18px 0;padding:16px;border:1px solid var(--line);border-radius:var(--kdp-radius-sm);background:var(--canvas);font-size:13px}.access-notice p{margin-top:8px;color:var(--muted);line-height:1.7}.access-paused-badge{color:var(--muted)}
  @media(max-width:600px){.data-heading{flex-direction:column;gap:4px}.sync-issues{padding:16px}.collection{padding:16px}}
</style>
