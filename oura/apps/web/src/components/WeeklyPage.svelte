<script lang="ts">
  import { onMount } from "svelte";
  import { api, RequestError, errorText } from "../lib/api";
  import SyncStatus from "./SyncStatus.svelte";
  import type { WeeklyPayload } from "../lib/reports";
  import { t, type Locale } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";
  import type { MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";

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
  let disposed = false;

  async function load() {
    loading = true;
    statusErr = false;
    status = t(locale, "loading");
    try {
      const data = await api<WeeklyPayload>("/api/me/insights/weekly");
      if (disposed) return;
      payload = data;
      status = payload.thisPeriod
        ? `${payload.thisPeriod.from} → ${payload.thisPeriod.to}`
        : "";
    } catch (err) {
      if (disposed) return;
      if (err instanceof RequestError && err.status === 401) { onUnauthorized(); return; }
      statusErr = true;
      status = errorText(err, locale);
    } finally {
      if (!disposed) loading = false;
    }
  }

  onMount(() => {
    void load();
    return () => { disposed = true; };
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
        <p class="sub">{locale === "zh" ? "回看一周的记录，理解自己的节奏。" : "Look back over your week and understand your rhythm."}</p>
      </div>
      <button class="ai-btn" type="button" onclick={() => goto("/")}>{t(locale, "backDash")}</button>
    </div>
    <p class="disclaimer-banner" role="note">
      <strong>{t(locale, "notMedical")}</strong>
      <span> / {t(locale, "notMedicalEn")}</span>
    </p>
    {#if locale === "en"}
      <p class="hint">{t(locale, "bodyZhOnly")}</p>
    {/if}
    <div class="status" class:err={statusErr}>{status}</div>
    {#if statusErr}<button class="ai-btn" onclick={load}>{locale === "zh" ? "重试" : "Retry"}</button>{/if}
    {#if payload?.sync}<SyncStatus sync={payload.sync} {locale} />{/if}

    {#if payload?.summaries?.length}
      <section class="panel">
        <h2>{t(locale, "weeklyTitle")}</h2>
        <p class="hint">
          {payload.lastPeriod?.from ?? ""} → {payload.lastPeriod?.to ?? ""}
          · vs
          {payload.thisPeriod?.from ?? ""} → {payload.thisPeriod?.to ?? ""}
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
