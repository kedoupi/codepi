<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorText } from "../lib/api";
  import { setDevSubscription, startCheckout, startPortal } from "../lib/billing";
  import { t, type Locale, type LocalePref } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";
  import type { MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";
  import HealthDataPanel from "./HealthDataPanel.svelte";

  let {
    me,
    locale,
    localePref,
    prefSaving = false,
    onLocalePref,
    onMeChange,
    onLogout,
  }: {
    me: MeResponse;
    locale: Locale;
    localePref: LocalePref;
    prefSaving?: boolean;
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

  const personal = $derived(me.capabilities?.personal === true);
  const canBill = $derived(me.capabilities?.billing === true);

  type Connection = { client_id: string; client_name: string | null; created_at: string };
  let connections = $state<Connection[]>([]);
  let connectionsError = $state("");
  let revoking = $state("");

  const mcpUrl = typeof window === "undefined" ? "" : `${window.location.origin}/mcp`;

  async function loadConnections() {
    try {
      const data = await api<{ connections: Connection[] }>("/api/me/connections");
      connections = data.connections ?? [];
      connectionsError = "";
    } catch (err) {
      connectionsError = errorText(err, locale);
    }
  }

  async function revoke(clientId: string) {
    if (revoking) return;
    revoking = clientId;
    try {
      await api("/api/me/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      connections = connections.filter(row => row.client_id !== clientId);
    } catch (err) {
      connectionsError = errorText(err, locale);
    } finally {
      revoking = "";
    }
  }

  onMount(() => { if (personal) void loadConnections(); });
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
            disabled={prefSaving}
            onclick={() => onLocalePref(pref)}
          >{prefLabel(pref)}</button>
        {/each}
      </div>
      {#if prefSaving}
        <p class="hint">{locale === "en" ? "Saving…" : "保存中…"}</p>
      {/if}
    </section>

    {#if personal}
      <HealthDataPanel {locale} />
      <section class="panel">
        <h2>{locale === "en" ? "Personal workspace" : "个人工作区"}</h2>
        <p class="hint">
          {locale === "en"
            ? "This account is the designated personal owner: full reports unlocked, billing disabled."
            : "当前账号被指定为个人专属：完整解读已解锁，不涉及付费订阅。"}
        </p>
        <p class="hint">
          {locale === "en" ? "Connection" : "连接状态"}：Oura OAuth
          · {locale === "en" ? "Account" : "账号"}：{me.userId ?? "—"}
        </p>
        {#if me.release}
          <p class="hint">{locale === "en" ? "API" : "接口版本"}：{me.release}{me.build ? ` · ${me.build.slice(0, 7)}` : ""}</p>
        {/if}
      </section>

      <section class="panel">
        <h2>{locale === "en" ? "AI apps" : "AI 应用连接"}</h2>
        <p class="hint">
          {locale === "en"
            ? "Add this MCP server in Claude or ChatGPT, then approve the connection. Access is read-only and revocable here."
            : "在 Claude 或 ChatGPT 里添加下面的 MCP 地址并授权。权限为只读，可在此处撤销。"}
        </p>
        <p class="hint"><code>{mcpUrl}</code></p>
        {#if connections.length === 0}
          <p class="hint">{locale === "en" ? "No apps connected yet." : "暂无已连接应用。"}</p>
        {:else}
          {#each connections as connection (connection.client_id)}
            <div class="settings-actions" style="justify-content:space-between;gap:12px">
              <span>{connection.client_name || connection.client_id}</span>
              <button
                class="ai-btn"
                type="button"
                disabled={revoking === connection.client_id}
                onclick={() => revoke(connection.client_id)}
              >{locale === "en" ? "Revoke" : "撤销授权"}</button>
            </div>
          {/each}
        {/if}
        {#if connectionsError}
          <p class="status err" role="alert">{connectionsError}</p>
        {/if}
      </section>
    {:else}
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
          <button class="landing-btn primary" type="button" disabled={busy || !canBill} onclick={subscribe}>
            {t(locale, "settingsSubscribe")}
          </button>
          <button class="ai-btn" type="button" disabled={busy || !canBill} onclick={portal}>
            {t(locale, "settingsManage")}
          </button>
        </div>
        {#if !canBill}
          <p class="hint">{locale === "en" ? "Billing is not configured on this deployment." : "当前部署未开启付费功能。"}</p>
        {/if}
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
    {/if}

    <p class="disclaimer-banner" role="note">
      <strong>{t(locale, "notMedical")}</strong>
      <span> / {t(locale, "notMedicalEn")}</span>
    </p>
  </main>
</div>
