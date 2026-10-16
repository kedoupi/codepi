<script lang="ts">
  import { api, errorText, RequestError } from "../lib/api";
  import type { HealthCollection } from "../lib/health";
  import type { Locale } from "../lib/i18n";
  let { locale, onUnauthorized, refreshKey = null }: { locale: Locale; onUnauthorized: () => void; refreshKey?: string | null } = $props();
  let collections = $state<HealthCollection[] | null>(null);
  let error = $state("");
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const saved = $derived(collections?.filter(c => c.records > 0).length ?? 0);
  const paused = $derived(collections?.filter(c => c.access?.status === "unavailable").length ?? 0);
  const failed = $derived(collections?.filter(c => c.access?.status !== "unavailable"
    && (c.failed_windows > 0 || c.last_attempt?.last_error)).length ?? 0);
  const checked = $derived(collections?.filter(c => c.last_attempt?.synced_at && !c.last_attempt.last_error).length ?? 0);
  async function load() {
    error = "";
    try { collections = (await api<{ collections: HealthCollection[] }>("/api/me/health-records/status")).collections; }
    catch (err) {
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      error = errorText(err, locale);
    }
  }
  $effect(() => { void refreshKey; void load(); });
</script>

<aside class="archive-status" aria-label={text("详细数据状态", "Detailed data status")}>
  <div>
    <strong>{text("详细数据", "Detailed data")}</strong>
    {#if error}
      <p role="alert">{error} <button class="text-button" onclick={load}>{text("重试", "Retry")}</button></p>
    {:else if !collections}<p>{text("正在读取采集状态…", "Checking saved data…")}</p>
    {:else}
      <p>{saved}/{collections.length} {text("类已有记录", "collections contain records")}
        {#if paused} · {paused} {text("类访问暂停", "collections paused due to access restrictions")}{/if}
        {#if failed} · {failed} {text("类存在未完成批次", "collections have failed batches")}
        {:else if checked === 0} · {saved ? text("等待重新同步", "Awaiting a fresh sync") : text("尚未开始补齐", "Backfill has not started")}
        {:else} · {text("覆盖日期与更新状态见数据管理", "See data settings for coverage and freshness")}{/if}
      </p>
    {/if}
  </div>
  <a href="/settings" class="text-link">{text("管理数据与同步", "Manage data and sync")} ↗</a>
</aside>

<style>
  .archive-status{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-top:1px solid var(--line);margin:20px 0;color:var(--muted);font-size:13px}
  strong{color:var(--ink)}p{margin-top:4px}.text-link{flex-shrink:0;color:var(--kdp-accent-strong);text-decoration:underline;text-underline-offset:4px}
  .text-button{border:0;background:none;color:var(--kdp-accent-strong);text-decoration:underline;cursor:pointer;padding:6px}
  @media(max-width:600px){.archive-status{align-items:flex-start;flex-direction:column}}
</style>
