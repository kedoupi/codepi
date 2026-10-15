<script lang="ts">
  import type { Locale } from "../lib/i18n";
  import { errorText, RequestError } from "../lib/api";
  import type { AutomaticSyncStatus, HealthCollection } from "../lib/health";
  let { value, locale, collections = [], compact = false }: { value: AutomaticSyncStatus; locale: Locale; collections?: Pick<HealthCollection, "name" | "label">[]; compact?: boolean } = $props();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const collectionLabel = (name: string) => name === "__scores" ? text("官方评分", "Official scores")
    : collections.find(row => row.name === name)?.label.split(" / ")[locale === "zh" ? 0 : 1] || name;
  const reconnect = $derived((value.error ?? value.scores.error) === "reconnect_required");
  const time = (iso: string | null) => iso ? new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en", {
    timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }) : "—";
  const title = $derived(!value.enabled ? text("自动同步未开启", "Automatic sync is off")
    : value.status === "blocked" ? reconnect ? text("自动同步已暂停 · 需要重新连接", "Automatic sync paused · reconnect required")
      : value.error === "oura_not_configured" ? text("自动同步已暂停 · 请检查服务配置", "Automatic sync paused · check service configuration")
      : text("自动同步已暂停", "Automatic sync paused")
    : value.error === "daily_sync_budget_reached" ? text("自动同步等待额度恢复", "Automatic sync awaiting budget reset")
    : value.status === "running" ? text("后台正在更新数据", "Updating data in the background")
    : value.status === "partial" ? text("本次自动同步部分完成", "Automatic sync partially complete")
    : value.status === "completed" ? text("本次自动同步已完成", "Automatic sync complete")
    : text("每日自动同步已开启", "Daily automatic sync is on"));
</script>

<div class="automatic-sync" class:compact class:attention={value.status === "blocked" || value.status === "partial"}>
  <div class="automatic-heading"><strong>{title}</strong>{#if !compact}<span>{text("每天 09:00 · 北京时间", "Daily 09:00 · Shanghai time")}</span>{/if}</div>
  {#if !compact}<p>{text("刷新最近 90 天官方评分；详情刷新最近 7 天并补齐最近 90 天缺失。任务保存在服务端，关闭页面也会继续。", "Refreshes 90 days of official scores, refreshes the last 7 days of details and fills missing details over 90 days. The task is saved on the server and continues with this page closed.")}</p>{/if}
  <div class="automatic-stages" aria-live="polite">
    <p><strong>{text("官方评分", "Official scores")}</strong> · {value.scores.status === "completed" ? text("已完成", "Complete")
      : value.scores.status === "failed" ? text("更新失败", "Update failed")
      : value.status === "running" ? text("等待后台刷新", "Awaiting background refresh") : text("等待更新", "Awaiting update")}</p>
    <p><strong>{text("详细记录", "Detailed records")}</strong> · {value.details.completed} / {value.details.total} {text("批次已完成", "batches complete")}
      {#if value.details.remaining} · {value.details.remaining} {text("批次待执行", "batches pending")}{/if}
      {#if value.details.failed} · {value.details.failed} {text("批次失败", "batches failed")}{/if}</p>
  </div>
  {#if value.details.total}
    <div class="automatic-progress">
      <progress max={value.details.total} value={value.details.completed} aria-label={text("详细记录后台更新进度", "Detailed records background progress")}></progress>
    </div>
  {/if}
  {#if compact}
    <a class="automatic-details" href="/settings">{text("查看同步详情", "View sync details")} →</a>
  {:else}
  {#if value.current && value.status === "running"}<p>{text("下一待执行批次", "Next pending batch")}：{collectionLabel(value.current.collection)} · {value.current.from} — {value.current.to}</p>{/if}
  <div class="automatic-meta">
    <span>{text("最近完整同步", "Last complete run")}：{time(value.last_success_at)}</span>
    {#if value.status === "running"}<span>{text("小批次执行中，每两分钟继续；失败会延后重试。", "Continues every two minutes; failures retry after a delay.")}</span>
      {#if value.next_batch_at}<span>{text("下次可执行时间", "Next eligible batch")}：{time(value.next_batch_at)}</span>{/if}
    {:else if value.status !== "blocked"}<span>{text("下次计划", "Next scheduled run")}：{time(value.next_run_at)}</span>{/if}
  </div>
  {#if value.error}<p class="automatic-error">{errorText(new RequestError(value.error, 0), locale)}</p>{/if}
  {#if value.scores.error && value.scores.error !== value.error}<p class="automatic-error">{text("官方评分", "Official scores")}：{errorText(new RequestError(value.scores.error, 0), locale)}</p>{/if}
  {#if value.status === "blocked" && reconnect}<a class="ai-btn" href="/api/auth/oura/start">{text("重新连接 Oura，恢复自动同步", "Reconnect Oura to resume")}</a>{/if}
  <p class="automatic-note">{text("历史健康记录会保留；使用“更新数据”可立即提交任务。已有任务会继续执行，等待重试的批次保持原定时间。", "Health history is retained. Use “Update data” to submit a task. Existing tasks continue and batches awaiting retry keep their scheduled time.")}</p>
  {/if}
</div>

<style>
  .automatic-sync{margin:20px 0;padding:20px;border:1px solid var(--line);border-radius:14px;background:#fff7ed}.automatic-heading{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.automatic-heading strong{font-size:15px}.automatic-heading span{font-size:12px;color:#9a3412}.automatic-sync p{font-size:13px;line-height:1.7;color:var(--muted);margin-top:8px}.automatic-meta{display:flex;gap:8px 24px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:10px}.automatic-progress{display:grid;gap:8px;font-size:12px;margin-top:16px}progress{width:100%;height:7px;accent-color:#ea580c}.automatic-sync .automatic-note{font-size:12px;margin-top:14px}.automatic-sync .automatic-error{color:#9a3412}.attention{border-color:#e8b998}.automatic-sync a{display:inline-flex;margin-top:10px;text-decoration:none}
  .automatic-sync.compact{margin:16px 0;padding:14px 16px}.compact .automatic-stages{display:flex;flex-wrap:wrap;gap:4px 20px;margin-top:8px}.compact .automatic-stages p{margin:0;line-height:1.5}.compact .automatic-progress{margin-top:10px}.automatic-sync .automatic-details{font-size:12px;color:#9a3412}
  @media(max-width:600px){.automatic-sync{padding:16px}.automatic-heading{flex-direction:column;gap:6px}}
</style>
