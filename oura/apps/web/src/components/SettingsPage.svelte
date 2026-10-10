<script lang="ts">
  import { setDevSubscription, startCheckout, startPortal } from "../lib/billing";
  import { t, type Locale, type LocalePref } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";
  import type { MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";

  let {
    me,
    locale,
    localePref,
    onLocalePref,
    onMeChange,
    onLogout,
  }: {
    me: MeResponse;
    locale: Locale;
    localePref: LocalePref;
    onLocalePref: (pref: LocalePref) => void;
    onMeChange: (next: MeResponse) => void;
    onLogout: () => void;
  } = $props();

  let busy = $state(false);
  let error = $state("");

  const prefs: LocalePref[] = ["system", "zh", "en"];

  function prefLabel(pref: LocalePref): string {
    if (pref === "zh") return t(locale, "langZh");
    if (pref === "en") return t(locale, "langEn");
    return t(locale, "followSystem");
  }

  async function subscribe() {
    busy = true;
    error = "";
    try {
      window.location.href = await startCheckout(locale);
    } catch (err) {
      error = me.stripeConfigured ? t(locale, "apiUnreachable") : t(locale, "stripeMissing");
      console.error(err);
      busy = false;
    }
  }

  async function portal() {
    busy = true;
    error = "";
    try {
      window.location.href = await startPortal();
    } catch (err) {
      error = t(locale, "apiUnreachable");
      console.error(err);
      busy = false;
    }
  }

  async function grant(entitled: boolean) {
    busy = true;
    error = "";
    try {
      await setDevSubscription(entitled);
      onMeChange({
        ...me,
        subscribed: entitled,
        subscriptionStatus: entitled ? "dev_grant" : "none",
      });
    } catch (err) {
      error = t(locale, "apiUnreachable");
      console.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<div id="dash-view">
  <ChromeHeader
    isDev={me.allowDevLogin === true && me.source === "dev"}
    {locale}
    active="/settings"
    {onLogout}
  />
  <main class="wrap page insight-page">
    <div class="kicker">OURA · SETTINGS</div>
    <div class="hero-row">
      <div>
        <h1>{t(locale, "settingsTitle")}</h1>
        <p class="sub">{t(locale, "membershipNote")}</p>
      </div>
      <button class="ai-btn" type="button" onclick={() => goto("/")}>{t(locale, "backDash")}</button>
    </div>

    <section class="panel">
      <h2>{t(locale, "settingsLang")}</h2>
      <p class="hint">{t(locale, "settingsLangHint")}</p>
      <div class="lang-pills" role="radiogroup" aria-label={t(locale, "settingsLang")}>
        {#each prefs as pref (pref)}
          <button
            type="button"
            class="ai-btn"
            class:on={localePref === pref}
            role="radio"
            aria-checked={localePref === pref}
            onclick={() => onLocalePref(pref)}
          >{prefLabel(pref)}</button>
        {/each}
      </div>
    </section>

    <section class="panel">
      <h2>{t(locale, "settingsBilling")}</h2>
      <p class="takeaway">{me.priceLabel ?? t(locale, "settingsPrice")}</p>
      <p class="hint">{t(locale, "settingsPriceHint")}</p>
      <p class="hint">
        {t(locale, "settingsStatus")}：
        {me.subscribed ? t(locale, "settingsPaid") : t(locale, "settingsUnpaid")}
        {#if me.subscriptionStatus}
          · {me.subscriptionStatus}
        {/if}
      </p>
      <div class="settings-actions">
        <button class="landing-btn primary" type="button" disabled={busy} onclick={subscribe}>
          {t(locale, "settingsSubscribe")}
        </button>
        <button class="ai-btn" type="button" disabled={busy} onclick={portal}>
          {t(locale, "settingsManage")}
        </button>
      </div>
      {#if me.allowDevLogin === true}
        <div class="settings-actions">
          <button class="ai-btn" type="button" disabled={busy} onclick={() => grant(true)}>
            {t(locale, "devGrantOn")}
          </button>
          <button class="ai-btn" type="button" disabled={busy} onclick={() => grant(false)}>
            {t(locale, "devGrantOff")}
          </button>
        </div>
      {/if}
      {#if error}
        <p class="status err" role="alert">{error}</p>
      {/if}
    </section>

    <p class="disclaimer-banner" role="note">
      <strong>{t(locale, "notMedical")}</strong>
      <span> / {t(locale, "notMedicalEn")}</span>
    </p>
  </main>
</div>
