<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorText, RequestError } from "../lib/api";
  import { planBackfill, runBackfill, type SyncWindow, type SyncFailure } from "../lib/backfill";
  import type { HealthCollection, AutomaticSyncStatus } from "../lib/health";
  import AutomaticSync from "./AutomaticSync.svelte";
  import type { Locale } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";

  let { locale }: { locale: Locale } = $props();
  type Collection = HealthCollection & { failed_ranges?: SyncFailure[] };
  let collections = $state<Collection[]>([]);
  let automatic = $state<AutomaticSyncStatus | null>(null);
  let busy = $state(false);
  let stop = $state(false);
  let disposed = false;
  let message = $state("");
  let error = $state("");
  let failures = $state<SyncFailure[]>([]);
  let pending = $state<SyncWindow[]>([]);
  let current = $state<SyncWindow | null>(null);
  let percent = $state(0);
  let splits = $state(0);
  let hasRun = $state(false);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const label = (row: Collection) => row.label.split(" / ")[locale === "zh" ? 0 : 1] || row.name;
  const collectionLabel = (name: string) => { const row = collections.find(row => row.name === name); return row ? label(row) : name; };
  const storedFailures = $derived(collections.flatMap(row => row.failed_ranges ?? []));
  const shownFailures = $derived(busy ? failures : [...new Map([...storedFailures, ...failures].map(f => [`${f.collection}:${f.from}:${f.to}`, f])).values()]);
  const failureGroups = $derived([...new Set(shownFailures.map(f => f.collection))].map(name => ({
    name, failures: shownFailures.filter(f => f.collection === name),
  })));
  const retryWindows = $derived([...new Map([...shownFailures, ...pending].map(w => [`${w.collection}:${w.from}:${w.to}`, w])).values()]);
  const needsReconnect = $derived(shownFailures.some(f => ["reconnect_required", "unauthorized"].includes(f.code)));
  const savedTypes = $derived(collections.filter(row => row.records > 0).length);
  function failureText(failure: SyncFailure) {
    if (failure.code === "sync_window_too_large") return failure.from === failure.to
      ? text("这一天的数据仍超过处理上限，其他日期会继续同步。", "This day still exceeds the limit. Other days will continue.")
      : text("这个批次数据较多，继续同步时会自动拆分日期，无需手动调整。", "This batch is large. Retrying will split its dates automatically.");
    return errorText(new RequestError(failure.code, 0), locale);
  }
  async function load() {
    const result = await api<{ collections: Collection[]; automatic: AutomaticSyncStatus }>("/api/me/health-records/status");
    if (!disposed) { collections = result.collections; automatic = result.automatic; }
  }
  async function pollAutomatic() {
    // Poll one small state row, not counts across the entire health archive.
    const result = await api<AutomaticSyncStatus>("/api/me/health-records/automatic");
    if (disposed) return;
    const finished = result.finished_at && result.finished_at !== automatic?.finished_at;
    automatic = result;
    if (finished) await load();
  }
  onMount(() => {
    const backfill = new URLSearchParams(window.location.search).get("sync") === "90";
    if (backfill) goto("/settings", true);
    void load().then(() => { if (backfill && !stop) return sync(planBackfill(collections, 90)); })
      .catch(err => { if (!disposed) error = errorText(err, locale); });
    const timer = setInterval(() => {
      if (!busy && !document.hidden) void pollAutomatic().catch(err => { if (!disposed) error = errorText(err, locale); });
    }, 30_000);
    return () => { disposed = true; stop = true; clearInterval(timer); };
  });

  async function sync(windows: SyncWindow[]) {
    if (busy || !windows.length) return;
    busy = true;
    stop = false;
    error = "";
    message = "";
    failures = [];
    pending = [];
    percent = 0;
    splits = 0;
    hasRun = true;
    let requests = 0;
    try {
      const result = await runBackfill(windows, {
        shouldStop: () => stop,
        request: async window => {
          const params = new URLSearchParams({ collection: window.collection, from: window.from, to: window.to });
          await api(`/api/me/health-records?${params}`, { method: "POST" });
          if (++requests % 5 === 0 && !disposed) await load().catch(err => { error = errorText(err, locale); });
        },
        progress: state => {
          if (disposed) return;
          current = state.current;
          percent = Math.floor(state.completed / state.total * 100);
          splits = state.splits;
          failures = [...state.failed];
        },
      });
      if (disposed) return;
      failures = result.failed;
      pending = result.remaining;
      percent = Math.floor(result.completed / result.total * 100);
      splits = result.splits;
      await load();
      message = stop ? text("已停止；已保存的数据会保留，可以继续未完成部分。", "Stopped. Saved data is retained; you can resume unfinished work.")
        : result.failed.length || result.remaining.length || storedFailures.length ? text("部分数据尚未完成，已保存的数据不受影响。", "Some data is unfinished. Saved records are unaffected.")
        : text("本次同步完成。各类覆盖情况见下方。", "Sync complete. See saved coverage below.");
    } catch (err) { if (!disposed) error = errorText(err, locale); }
    finally { if (!disposed) { busy = false; current = null; } }
  }
</script>

<section class="panel health-data">
  <div class="data-heading"><div><h2>{text("数据采集与历史记录", "Health data and history")}</h2><p class="hint">{text("已保存的数据会保留。心率、电量逐日同步；遇到数据量上限会自动拆分日期。", "Saved history is retained. Heart rate and battery sync daily; oversized ranges split automatically.")}</p></div><span class="data-count">{savedTypes}/{collections.length || 18} {text("类已有数据", "collections saved")}</span></div>
  {#if automatic}<AutomaticSync value={automatic} {locale} />{/if}
  <div class="actions">
    <button class="ai-btn primary-action" disabled={busy || !collections.length} onclick={() => sync(planBackfill(collections, 90))}>{text("补齐最近 90 天", "Backfill 90 days")}</button>
    <button class="ai-btn" disabled={busy || !collections.length} onclick={() => sync(planBackfill(collections, 7))}>{text("同步最近 7 天", "Sync last 7 days")}</button>
    {#if retryWindows.length && !busy && !needsReconnect}<button class="ai-btn" onclick={() => sync([...retryWindows])}>{text("继续未完成部分", "Retry unfinished work")}</button>{/if}
    {#if busy}<button class="ai-btn" disabled={stop} onclick={() => { stop = true; }}>{stop ? text("本批完成后停止…", "Stopping after this batch…") : text("本批完成后停止", "Stop after this batch")}</button>{/if}
  </div>
  {#if busy || hasRun}
    <div class="sync-progress" aria-live="polite">
      <div class="progress-heading"><strong>{busy ? text("正在补齐数据", "Syncing your data") : message}</strong><span>{percent}%</span></div>
      <progress max="100" value={percent} aria-label={text("本次同步进度", "Sync progress")}></progress>
      {#if current}<p>{collectionLabel(current.collection)} · {current.from === current.to ? current.from : `${current.from} — ${current.to}`}</p>{/if}
      {#if splits}<p class="split-note">{busy ? text("数据较多，已自动拆分为更小批次继续同步。", "Large batches were split automatically; sync is continuing in smaller ranges.") : text("本次已自动拆分过大的批次，无需手动选择日期。", "Oversized batches were split automatically; no manual date adjustment was needed.")}</p>{/if}
      {#if busy}<p class="hint">{text("手动同步期间请保持页面打开。关闭页面不影响每日后台自动同步。", "Keep this page open for manual sync. Closing it does not affect daily background sync.")}</p>{/if}
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
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
        <div class="collection-heading"><strong>{label(row)}</strong>{#if current?.collection === row.name}<span class="collection-badge">{text("同步中", "Syncing")}</span>{/if}</div>
        <span class="record-count">{row.records.toLocaleString(locale === "zh" ? "zh-CN" : "en")} <small>{text("条记录", "records")}</small></span>
        <span class="hint">{row.earliest_day ? `${row.earliest_day} — ${row.latest_day}` : row.records ? text("当前快照", "Current snapshot") : "—"}</span>
        <span class="hint">{row.failed_windows ? text("有未完成批次", "Some batches are unfinished")
          : !row.last_attempt?.synced_at ? text("等待同步", "Awaiting sync")
          : row.records ? text("已有数据", "Data saved") : text("已同步，暂无记录", "Synced, no records")}</span>
      </div>
    {/each}
  </div>
  <p class="hint data-help">{text("仅在提示授权失效或新增权限时重新连接。记录数可能包含同一天的多段记录，不等于天数。", "Reconnect only for expired authorization or new permissions. Multiple records can belong to one day; record counts are not day counts.")} {#if !busy}<a href="/api/auth/oura/start?sync_health=1">{text("重新连接 Oura", "Reconnect Oura")}</a>{/if}</p>
</section>

<style>
  .data-heading,.collection-heading,.progress-heading{display:flex;justify-content:space-between;align-items:center;gap:14px}.data-heading{align-items:flex-start}.data-heading h2{margin-bottom:6px}.data-count{white-space:nowrap;font-size:12px;color:var(--muted);padding-top:5px}.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:20px 0}a.ai-btn{text-decoration:none;display:inline-flex}.primary-action{background:#ea580c;color:white;border-color:#ea580c}.sync-progress{padding:18px 20px;background:#fff7ed;border:1px solid var(--line);border-radius:14px;margin:18px 0}.progress-heading{font-size:14px}.progress-heading span{font-variant-numeric:tabular-nums;color:#9a3412}progress{width:100%;height:8px;appearance:none;border:0;border-radius:8px;overflow:hidden;margin:14px 0 8px;accent-color:#ea580c;background:#f3dfcf}progress::-webkit-progress-bar{background:#f3dfcf}progress::-webkit-progress-value{background:#ea580c;border-radius:8px}progress::-moz-progress-bar{background:#ea580c}.sync-progress p{font-size:13px;color:var(--muted);margin-top:6px}.sync-progress .split-note{color:#9a3412}.sync-issues{border:1px solid #e9d4bb;background:#fffaf3;border-radius:14px;padding:18px 20px;margin:18px 0;font-size:14px}.sync-issue{padding:12px 0;border-top:1px solid var(--line);margin-top:12px}.sync-issue p{color:#9a3412;margin-top:4px;max-width:70ch}.sync-issue details{font-size:12px;color:var(--muted);margin-top:8px}.sync-issue summary{cursor:pointer;padding:4px 0}.sync-issue ul{padding:8px 0 0 20px;overflow-wrap:anywhere}.collections{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.collection{display:grid;gap:8px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#fffaf5}.collection.syncing{border-color:#ea580c;background:#fff7ed}.collection .hint{margin:0;font-size:12px}.collection-badge{font-size:11px;color:#9a3412;white-space:nowrap}.record-count{font-size:24px;font-variant-numeric:tabular-nums}.record-count small{font-size:12px;color:var(--muted)}.error{color:#9a3412;overflow-wrap:anywhere}.data-help{margin-top:20px!important;font-size:12px;line-height:1.7}.data-help a{color:#9a3412;text-decoration:underline}.actions button:disabled{opacity:.6;cursor:default}
  @media(max-width:600px){.data-heading{flex-direction:column;gap:4px}.sync-progress,.sync-issues{padding:16px}.progress-heading{align-items:flex-start}.collection{padding:16px}}
</style>
