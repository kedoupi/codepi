<script lang="ts">
  import { onMount } from "svelte";
  import { api, RequestError, errorText } from "../lib/api";
  import SyncStatus from "./SyncStatus.svelte";
  import { startCheckout, type ComparePayload } from "../lib/billing";
  import { t, type Locale } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";
  import type { MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";
  import PaywallCard from "./PaywallCard.svelte";

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

  let mode = $state<"week" | "range">("week");
  let payload = $state<ComparePayload | null>(null);
  let status = $state("");
  let statusErr = $state(false);
  let busy = $state(false);

  async function load(next = mode) {
    statusErr = false;
    status = t(locale, "loading");
    try {
      const data = await api<ComparePayload>(`/api/me/insights/compare?mode=${next}`);
      if (next !== mode) return;
      payload = data;
      status = "";
    } catch (err) {
      if (next !== mode) return;
      if (err instanceof RequestError && err.status === 401) { onUnauthorized(); return; }
      statusErr = true;
      status = errorText(err, locale);
    }
  }

  function setMode(next: "week" | "range") {
    mode = next;
    void load(next);
  }

  async function subscribe() {
    busy = true;
    try {
      window.location.href = await startCheckout(locale);
    } catch (err) {
      statusErr = true;
      status = me.stripeConfigured ? t(locale, "apiUnreachable") : t(locale, "stripeMissing");
      console.error(err);
      busy = false;
    }
  }

  function fmt(n: number | null | undefined, steps = false): string {
    if (n == null) return "—";
    return steps ? String(Math.round(n)) : (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  }

  onMount(() => {
    void load();
  });
</script>

<div id="dash-view">
  <ChromeHeader
    isDev={me.allowDevLogin === true && me.source === "dev"}
    {locale}
    active="/compare"
    {onLogout}
  />
  <main class="wrap page insight-page">
    <div class="kicker">{t(locale, "compareKicker")}</div>
    <div class="hero-row">
      <div>
        <h1>{t(locale, "compareTitle")}</h1>
        <p class="sub">{t(locale, "membershipNote")}</p>
      </div>
      <button class="ai-btn" type="button" onclick={() => goto("/")}>{t(locale, "backDash")}</button>
    </div>
    <p class="disclaimer-banner" role="note">
      <strong>{t(locale, "notMedical")}</strong>
      <span> / {t(locale, "notMedicalEn")}</span>
    </p>
    <div class="lang-pills" role="group" aria-label={t(locale, "compareTitle")}>
      <button type="button" class="ai-btn" class:on={mode === "week"} onclick={() => setMode("week")}>{t(locale, "compareWeek")}</button>
      <button type="button" class="ai-btn" class:on={mode === "range"} onclick={() => setMode("range")}>{t(locale, "compareRange")}</button>
    </div>
    <div class="status" class:err={statusErr}>{status}</div>
    {#if statusErr}<button class="ai-btn" onclick={() => load()}>{locale === "zh" ? "重试" : "Retry"}</button>{/if}
    {#if payload?.sync}<SyncStatus sync={payload.sync} {locale} />{/if}

    {#if payload?.locked}
      {#if me.capabilities?.billing}<PaywallCard {locale} priceLabel={me.priceLabel ?? t(locale, "settingsPrice")} {busy} onSubscribe={subscribe} />{/if}
      <p class="hint">{locale === "zh" ? "此账号尚未开放完整对比。" : "Full comparison is not enabled for this account."}</p>
    {:else if payload?.left && payload?.right}
      <section class="compare-grid" aria-label={t(locale, "compareTitle")}>
        {#each [payload.left, payload.right] as col, i (`col-${i}`)}
          <article class="panel">
            <h2>{col.label}</h2>
            <p class="hint">{col.from} → {col.to} · {col.days} {t(locale, "daysUnit")}</p>
            <table class="avg-table">
              <thead><tr><th>{t(locale, "metricLabel")}</th><th>{col.label}</th></tr></thead>
              <tbody>
                <tr><td>{t(locale, "metricSleep")}</td><td>{fmt(col.sleep)}</td></tr>
                <tr><td>{t(locale, "metricReady")}</td><td>{fmt(col.readiness)}</td></tr>
                <tr><td>{t(locale, "metricAct")}</td><td>{fmt(col.activity)}</td></tr>
                <tr><td>{t(locale, "metricSteps")}</td><td>{fmt(col.steps, true)}</td></tr>
              </tbody>
            </table>
          </article>
        {/each}
      </section>
    {/if}
  </main>
</div>
