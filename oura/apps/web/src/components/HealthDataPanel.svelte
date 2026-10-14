<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorText, RequestError } from "../lib/api";
  import type { Locale } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";

  let { locale }: { locale: Locale } = $props();
  type Collection = {
    name: string; label: string; mode: string; records: number;
    earliest_day: string | null; latest_day: string | null; failed_windows: number;
    last_attempt: { synced_at: string | null; last_error: string | null } | null;
  };
  let collections = $state<Collection[]>([]);
  let busy = $state(false);
  let stop = $state(false);
  let message = $state("");
  let error = $state("");
  let failures = $state<string[]>([]);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const label = (row: Collection) => row.label.split(" / ")[locale === "zh" ? 0 : 1] || row.name;

  async function load() {
    const result = await api<{ collections: Collection[] }>("/api/me/health-records/status");
    collections = result.collections;
  }
  onMount(() => {
    const backfill = new URLSearchParams(window.location.search).get("sync") === "90";
    if (backfill) goto("/settings", true);
    void load().then(() => { if (backfill && !stop) return sync(90); })
      .catch(err => { error = errorText(err, locale); });
    return () => { stop = true; };
  });

  async function sync(days: number) {
    if (busy) return;
    busy = true;
    stop = false;
    error = "";
    failures = [];
    const today = Date.parse(new Date().toISOString().slice(0, 10));
    const date = (time: number) => new Date(time).toISOString().slice(0, 10);
    try {
      for (const row of collections) {
        const snapshot = ["snapshot", "profile"].includes(row.mode);
        const step = row.mode === "time" ? 7 : 30;
        for (let back = 0; back < (snapshot ? 1 : days) && !stop; back += step) {
          const to = date(today - back * 86400000);
          const from = snapshot ? to : date(today - Math.min(back + step - 1, days - 1) * 86400000);
          message = `${label(row)} · ${from} – ${to}`;
          const params = new URLSearchParams({ collection: row.name, from, to });
          try {
            await api(`/api/me/health-records?${params}`, { method: "POST" });
          } catch (err) {
            failures = [...failures, `${label(row)} (${from} – ${to}): ${errorText(err, locale)}`];
            // Stop a category after a failure; stop all calls when the provider/session needs recovery.
            if (err instanceof RequestError && ["rate_limited", "reconnect_required", "unauthorized", "sync_in_progress", "network_error"].includes(err.code)) stop = true;
            break;
          }
        }
        await load();
        if (stop) break;
      }
      message = stop ? text("已停止；已保存的数据会保留。", "Stopped; saved records are retained.")
        : failures.length ? text("部分类型未完成，请查看下方详情。", "Some collections failed; see details below.")
        : text("同步完成。0 条表示本次接口没有返回记录。", "Sync complete. Zero means the provider returned no records.");
    } catch (err) {
      error = errorText(err, locale);
    } finally { busy = false; }
  }
</script>

<section class="panel health-data">
  <h2>{text("数据采集与历史记录", "Health data and history")}</h2>
  <p class="hint">{text(
    "先重新授权新增权限，再补齐最近 90 天。按类型分批同步，已保存的历史不会随时间滚动删除。关闭页面会停止后续批次。",
    "Reauthorize the additional permissions, then backfill 90 days. Collections sync in batches and saved history is retained. Closing this page stops subsequent batches."
  )}</p>
  <div class="actions">
    <a class="ai-btn" href="/api/auth/oura/start?sync_health=1">{text("重新授权并补齐数据", "Reauthorize and backfill")}</a>
    <button class="ai-btn" disabled={busy || !collections.length} onclick={() => sync(7)}>{text("同步最近 7 天", "Sync last 7 days")}</button>
    <button class="ai-btn" disabled={busy || !collections.length} onclick={() => sync(90)}>{text("补齐最近 90 天", "Backfill 90 days")}</button>
    {#if busy}<button class="ai-btn" onclick={() => { stop = true; }}>{text("本批完成后停止", "Stop after this batch")}</button>{/if}
  </div>
  <p class="hint" aria-live="polite">{busy ? text("同步中：", "Syncing: ") : ""}{message}</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if failures.length}
    <ul class="error">{#each failures as failure}<li>{failure}</li>{/each}</ul>
  {/if}
  <div class="collections">
    {#each collections as row (row.name)}
      <div class="collection">
        <strong>{label(row)}</strong>
        <span>{row.records} {text("条记录", "records")}</span>
        <span class="hint">{row.earliest_day ? `${row.earliest_day} – ${row.latest_day}` : text("—", "—")}</span>
        <span class="hint">
          {row.last_attempt?.last_error ? errorText(new RequestError(row.last_attempt.last_error, 0), locale)
            : row.failed_windows ? text("有历史批次未完成，请重试", "Some historical windows failed; retry")
            : !row.last_attempt?.synced_at ? text("尚未同步 / 待重新同步", "Not synced / refresh needed")
            : row.records ? text("已有数据", "Data saved") : text("已同步，暂无记录", "Synced, no records")}
        </span>
      </div>
    {/each}
  </div>
  <p class="hint">{text(
    "新增数据也可由连接器按需读取并更新；此处没有后台定时任务。缺权限、没有记录、同步失败会分别显示，分数不会当作实际时长或心率。",
    "The connector can also fetch and refresh these records on demand; there is no scheduled background sync. Missing permission, empty results and failed syncs remain distinct."
  )}</p>
</section>

<style>
  .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  a.ai-btn { text-decoration: none; }
  .collections { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 12px; }
  .collection { display: grid; gap: 5px; padding: 14px; border: 1px solid #f0dfcf; border-radius: 14px; background: #fffaf5; }
  .collection .hint { margin: 0; font-size: 13px; }
  .error { color: #9a3412; overflow-wrap: anywhere; }
</style>
