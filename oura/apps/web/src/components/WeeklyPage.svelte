<script lang="ts">
  import { onMount } from "svelte";
  import { api, RequestError, errorText } from "../lib/api";
  import SyncStatus from "./SyncStatus.svelte";
  import type { WeeklyPayload } from "../lib/reports";
  import { t, type Locale } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";
  import type { MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";
  import { watchCalendarDay } from "../lib/calendar";

  let {
    me,
    locale,
    onUnauthorized,
    onLogout,
  }: {
    me: MeResponse;
    locale: Locale;
    onUnauthorized: () => void;
    onLogout: () => void;
  } = $props();

  let payload = $state<WeeklyPayload | null>(null);
  let loading = $state(true);
  let status = $state("");
  let statusErr = $state(false);
  let needsReconnect = $state(false);
  let disposed = false;
  let revision = 0;

  async function load() {
    const current = ++revision;
    loading = true;
    statusErr = false;
    needsReconnect = false;
    status = t(locale, "loading");
    try {
      const data = await api<WeeklyPayload>("/api/me/insights/weekly");
      if (disposed || current !== revision) return;
      payload = data;
      status = payload.thisPeriod
        ? `${payload.thisPeriod.from} → ${payload.thisPeriod.to}`
        : "";
    } catch (err) {
      if (disposed || current !== revision) return;
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      needsReconnect = err instanceof RequestError && err.code === "reconnect_required";
      statusErr = true;
      status = errorText(err, locale);
    } finally {
      if (!disposed && current === revision) loading = false;
    }
  }

  onMount(() => {
    void load();
    const stop = watchCalendarDay(() => { payload = null; void load(); });
    return () => { stop(); disposed = true; revision++; };
  });
</script>

<div id="dash-view">
  <ChromeHeader
    isDev={me.allowDevLogin === true && me.source === "dev"}
    {locale}
    active="/insights"
    {onLogout}
  />
  <main class="wrap page insight-page">
    <div class="kicker">{t(locale, "weeklyKicker")}</div>
    <div class="hero-row">
      <div>
        <h1>{t(locale, "weeklyTitle")}</h1>
        <p class="sub">{locale === "zh" ? "近 7 天与此前 7 天对照，理解自己的节奏。" : "Compare the last 7 days with the preceding 7 days."}</p>
      </div>
      <button class="ai-btn" type="button" onclick={() => goto("/")}>{t(locale, "backDash")}</button>
    </div>
    <p class="disclaimer-banner" role="note">
      <strong>{t(locale, "notMedical")}</strong>
      <span> / {t(locale, "notMedicalEn")}</span>
    </p>
    <p class="hint">{locale === "zh"
      ? "滚动窗口截至北京时间今天，包含今天；不是周一至周日的自然周。保留 Oura 原始归属日，缺失不计为零；各指标两期均至少 3 天有效样本才比较。"
      : "Rolling windows include today in Asia/Shanghai, not calendar weeks. Oura dates are preserved; missing values are not zero. Each metric needs at least 3 valid days in both periods."}</p>
    {#if locale === "en"}
      <p class="hint">{t(locale, "bodyZhOnly")}</p>
    {/if}
    <div class="status" class:err={statusErr}>{status}</div>
    {#if statusErr}
      <button class="ai-btn" onclick={load}>{locale === "zh" ? "重试" : "Retry"}</button>
      {#if needsReconnect}<a class="ai-btn" href="/api/auth/oura/start">{locale === "zh" ? "重新连接 Oura" : "Reconnect Oura"}</a>{/if}
    {/if}
    {#if payload?.sync}<SyncStatus sync={payload.sync} {locale} />{/if}

    {#if payload?.summaries?.length}
      <section class="panel">
        <h2>{t(locale, "weeklyTitle")}</h2>
        <p class="hint">
          {locale === "zh" ? "近 7 天" : "Last 7 days"}：
          {payload.thisPeriod?.from ?? ""} → {payload.thisPeriod?.to ?? ""}
          · {locale === "zh" ? "此前 7 天" : "Preceding 7 days"}：
          {payload.lastPeriod?.from ?? ""} → {payload.lastPeriod?.to ?? ""}
        </p>
        <ul class="insight-lines">
          {#each payload.summaries as line, i (`sum-${i}`)}
            <li>{line}</li>
          {/each}
        </ul>
      </section>

      {#if payload.locked}
        <p class="hint">{locale === "zh" ? "当前账号可查看摘要；完整建议需要个人账号权限。" : "Summaries are available. Full advice requires personal access."}</p>
      {:else if payload.tips?.length}
        <section class="panel">
          <h2>{t(locale, "weeklyTipsTitle")}</h2>
          <ul class="insight-lines">
            {#each payload.tips as tip, i (`tip-${i}`)}
              <li>{tip}</li>
            {/each}
          </ul>
        </section>
      {/if}
    {:else if !loading && !statusErr}
      <p class="status">{t(locale, "weeklyEmpty")}</p>
    {/if}
  </main>
</div>
