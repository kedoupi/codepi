<script lang="ts">
  import type { Locale } from "../lib/i18n";
  import { errorText, RequestError } from "../lib/api";
  import type { AutomaticSyncStatus } from "../lib/health";
  let { value, locale }: { value: AutomaticSyncStatus; locale: Locale } = $props();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const time = (iso: string | null) => iso ? new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en", {
    timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }) : "—";
  const title = $derived(!value.enabled ? text("自动同步未开启", "Automatic sync is off")
    : value.error === "daily_sync_budget_reached" ? text("自动同步等待额度恢复", "Automatic sync awaiting budget reset")
    : value.status === "blocked" ? text("自动同步已暂停 · 需要重新连接", "Automatic sync paused · reconnect required")
    : value.status === "running" ? text("后台正在更新数据", "Updating data in the background")
    : value.status === "partial" ? text("本次自动同步部分完成", "Automatic sync partially complete")
    : value.status === "completed" ? text("本次自动同步已完成", "Automatic sync complete")
    : text("每日自动同步已开启", "Daily automatic sync is on"));
</script>

<div class="automatic-sync" class:attention={value.status === "blocked" || value.status === "partial"}>
  <div class="automatic-heading"><strong>{title}</strong><span>{text("每天 09:00 · 北京时间", "Daily 09:00 · Shanghai time")}</span></div>
  <p>{text("自动刷新最近 7 天，补齐最近 90 天的缺失批次；关闭页面也会继续。", "Refreshes the last 7 days and fills missing batches in the last 90 days, even with this page closed.")}</p>
  {#if value.total}
    <div class="automatic-progress">
      <span>{text("已完成", "Completed")} {value.completed} / {value.total} {text("批次", "batches")}{#if value.failed} · {value.failed} {text("批次待处理", "need attention")}{/if}</span>
      <progress max={value.total} value={value.completed} aria-label={text("后台自动同步进度", "Background sync progress")}></progress>
    </div>
  {/if}
  <div class="automatic-meta">
    <span>{text("最近完整同步", "Last complete run")}：{time(value.last_success_at)}</span>
    {#if value.status === "running"}<span>{text("小批次执行中，每两分钟继续；失败会延后重试。", "Continues every two minutes; failures retry after a delay.")}</span>
    {:else if value.status !== "blocked"}<span>{text("下次计划", "Next scheduled run")}：{time(value.next_run_at)}</span>{/if}
  </div>
  {#if value.error}<p class="automatic-error">{errorText(new RequestError(value.error, 0), locale)}</p>{/if}
  {#if value.status === "blocked"}<a class="ai-btn" href="/api/auth/oura/start">{text("重新连接 Oura，恢复自动同步", "Reconnect Oura to resume")}</a>{/if}
  <p class="automatic-note">{text("历史健康记录保留；仅清理过期登录、授权临时记录和超过 30 天的分析缓存。需要马上更新时，可使用下方手动同步。", "Health history is retained. Only expired sign-in and authorization records and analysis cache older than 30 days are cleaned up. Use manual sync below for an immediate update.")}</p>
</div>

<style>
  .automatic-sync{margin:20px 0;padding:20px;border:1px solid var(--line);border-radius:14px;background:var(--kdp-accent-soft)}.automatic-heading{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.automatic-heading strong{font-size:15px}.automatic-heading span{font-size:12px;color:var(--kdp-accent-strong)}.automatic-sync p{font-size:13px;line-height:1.7;color:var(--muted);margin-top:8px}.automatic-meta{display:flex;gap:8px 24px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:10px}.automatic-progress{display:grid;gap:8px;font-size:12px;margin-top:16px}progress{width:100%;height:7px;accent-color:#ea580c}.automatic-sync .automatic-note{font-size:12px;margin-top:14px}.automatic-sync .automatic-error{color:var(--kdp-accent-strong)}.attention{border-color:#e8b998}.automatic-sync a{display:inline-flex;margin-top:10px;text-decoration:none}
  @media(max-width:600px){.automatic-sync{padding:16px}.automatic-heading{flex-direction:column;gap:6px}}
</style>
