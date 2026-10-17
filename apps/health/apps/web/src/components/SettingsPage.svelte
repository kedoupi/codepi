<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorText } from "../lib/api";
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
    onLogout,
  }: {
    me: MeResponse;
    locale: Locale;
    localePref: LocalePref;
    prefSaving?: boolean;
    onLocalePref: (pref: LocalePref) => void;
    onLogout: () => void;
  } = $props();

  const prefs: LocalePref[] = ["system", "zh", "en"];

  function prefLabel(pref: LocalePref): string {
    if (pref === "zh") return t(locale, "langZh");
    if (pref === "en") return t(locale, "langEn");
    return t(locale, "followSystem");
  }

  const personal = $derived(me.capabilities?.personal === true);

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

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connect_oura") === "1") {
      const target = new URL("/api/auth/oura/start", window.location.origin);
      const healthReturn = params.get("health_return");
      if (healthReturn) target.searchParams.set("health_return", healthReturn);
      window.location.replace(target.href);
      return;
    }
    if (personal) void loadConnections();
  });
</script>

<div id="dash-view">
  <ChromeHeader
    isDev={me.allowDevLogin === true && me.source === "dev"}
    {locale}
    active="/settings"
    {onLogout}
  />
  <main class="wrap page insight-page">
    <div class="kicker">{locale === "zh" ? "健康空间" : "Health"}</div>
    <div class="hero-row">
      <div>
        <h1>{t(locale, "settingsTitle")}</h1>
        <p class="sub">{locale === "zh" ? "管理你的数据、应用连接与使用偏好。" : "Manage your data, app connections and preferences."}</p>
      </div>
      <button class="ai-btn" type="button" onclick={() => goto("/")}>{t(locale, "backDash")}</button>
    </div>

    <nav class="workspace-sections" aria-label={locale === "zh" ? "设置分组" : "Settings sections"}>
      <a href="#preferences">{locale === "zh" ? "偏好" : "Preferences"}</a>
      {#if personal}<a href="#data">{locale === "zh" ? "数据同步" : "Data sync"}</a><a href="#account">{locale === "zh" ? "账号" : "Account"}</a><a href="#connections">{locale === "zh" ? "应用连接" : "Connections"}</a>{/if}
    </nav>
    <section class="panel" id="preferences">
      <h2>{t(locale, "settingsLang")}</h2>
      <p class="hint">{t(locale, "settingsLangHint")}</p>
      <div class="lang-pills" role="group" aria-label={t(locale, "settingsLang")}>
        {#each prefs as pref (pref)}
          <button
            type="button"
            class="ai-btn"
            class:on={localePref === pref}
            aria-pressed={localePref === pref}
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
      {#if me.ouraConnection?.status !== "disconnected"}<HealthDataPanel {locale} />{/if}
      <section class="panel" id="account">
        <h2>{locale === "en" ? "Personal workspace" : "个人工作区"}</h2>
        <p class="hint">
          {locale === "en"
            ? "This account is the designated personal owner: full reports and data sync are enabled."
            : "当前账号被指定为个人专属：可使用完整解读与数据同步。"}
        </p>
        <p class="hint">
          {locale === "en" ? "Website account" : "网站账号"}：{me.userId ?? "—"} · {me.source === "sso" ? "KDP SSO" : me.source}
        </p>
        <p class="hint">
          Oura：{me.ouraConnection?.status === "disconnected" ? (locale === "zh" ? "尚未连接" : "Not connected")
            : me.ouraConnection?.status === "reconnect_required" ? (locale === "zh" ? "需要重新连接" : "Reconnect required")
            : (locale === "zh" ? "已连接" : "Connected")}
          {me.ouraConnection?.ouraUserId ? ` · ${me.ouraConnection.ouraUserId}` : ""}
        </p>
        <a class="ai-btn" href="/api/auth/oura/start">{me.ouraConnection?.status === "disconnected"
          ? (locale === "zh" ? "连接 Oura" : "Connect Oura") : (locale === "zh" ? "重新连接 Oura" : "Reconnect Oura")}</a>
        {#if me.release}
          <p class="hint">{locale === "en" ? "API" : "接口版本"}：{me.release}{me.build ? ` · ${me.build.slice(0, 7)}` : ""}</p>
        {/if}
      </section>

      <section class="panel" id="connections">
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
      <section class="panel" id="account">
        <h2>{locale === "zh" ? "账号权限" : "Account access"}</h2>
        <p class="hint">{locale === "zh" ? "当前账号可查看日汇总与周报摘要。完整解读、数据同步及应用连接仅向个人工作区所有者开放。" : "This account can view daily scores and weekly summaries. Full reports, data sync and app connections require personal owner access."}</p>
        <p class="hint">{locale === "zh" ? "账号" : "Account"}：{me.userId ?? "—"}</p>
      </section>
    {/if}

    <p class="disclaimer-banner" role="note">
      <strong>{t(locale, "notMedical")}</strong>
      <span> / {t(locale, "notMedicalEn")}</span>
    </p>
  </main>
</div>
