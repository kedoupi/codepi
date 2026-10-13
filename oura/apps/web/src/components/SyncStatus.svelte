<script lang="ts">
  import type { SyncInfo } from "../lib/types";
  import type { Locale } from "../lib/i18n";
  let { sync, locale, busy = false, onSync }: {
    sync?: SyncInfo; locale: Locale; busy?: boolean; onSync?: () => void;
  } = $props();
  const time = $derived(sync?.syncedAt ? new Date(sync.syncedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
</script>
<section class="sync-status" aria-live="polite">
  <div>
    <strong>{locale === "zh" ? "数据状态" : "Data status"}</strong>
    {#if sync}
      <span>{locale === "zh" ? "最新数据" : "Latest data"} {sync.latestDataDate ?? "—"}</span>
      <span>{locale === "zh" ? "同步于" : "Synced"} {time}</span>
      <span>{sync.populatedDays}/{sync.windowDays} {locale === "zh" ? "天有记录" : "days with data"}</span>
      {#if sync.stale}<span class="stale-note">{locale === "zh" ? "同步暂未完成，正在显示最近成功的数据" : "Showing the last successful sync; data may be stale"}</span>{/if}
      {#if sync.error === "reconnect_required"}<a href="/api/auth/oura/start">{locale === "zh" ? "重新连接 Oura" : "Reconnect Oura"}</a>{/if}
    {:else}<span>{locale === "zh" ? "等待同步" : "Waiting for sync"}</span>{/if}
  </div>
  {#if onSync}<button class="ai-btn" disabled={busy} onclick={onSync}>{busy ? (locale === "zh" ? "同步中…" : "Syncing…") : (locale === "zh" ? "刷新数据" : "Refresh data")}</button>{/if}
</section>
