<script lang="ts">
  import { onMount } from "svelte";
  import { startCheckout, type WeeklyPayload } from "../lib/billing";
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

  let payload = $state<WeeklyPayload | null>(null);
  let status = $state("");
  let statusErr = $state(false);
  let busy = $state(false);
  let banner = $state("");

  async function load() {
    statusErr = false;
    status = t(locale, "loading");
    try {
      const res = await fetch("/api/me/insights/weekly", { credentials: "include", cache: "no-store" });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      payload = (await res.json()) as WeeklyPayload;
      status = payload.thisPeriod
        ? `${payload.thisPeriod.from} → ${payload.thisPeriod.to}`
        : "";
    } catch (err) {
      statusErr = true;
      status = t(locale, "apiUnreachable");
      console.error(err);
    }
  }

  async function subscribe() {
    busy = true;
    try {
      window.location.href = await startCheckout(locale);
    } catch (err) {
      statusErr = true;
      status = me.stripeConfigured
        ? t(locale, "apiUnreachable")
        : t(locale, "stripeMissing");
      console.error(err);
      busy = false;
    }
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("checkout") === "success") banner = t(locale, "checkoutSuccess");
    if (params.get("checkout") === "cancel") banner = t(locale, "checkoutCancel");
    void load();
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
        <p class="sub">{t(locale, "membershipNote")}</p>
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
    {#if banner}
      <p class="status">{banner}</p>
    {/if}
    <div class="status" class:err={statusErr}>{status}</div>

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
        <PaywallCard {locale} priceLabel={me.priceLabel ?? t(locale, "settingsPrice")} {busy} onSubscribe={subscribe} />
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
    {:else if !statusErr}
      <p class="status">{t(locale, "weeklyEmpty")}</p>
    {/if}
  </main>
</div>
