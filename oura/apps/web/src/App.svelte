<script lang="ts">
  import { onMount } from "svelte";
  import "./workspace.css";
  import { api, errorText, RequestError } from "./lib/api";
  import ComparePage from "./components/ComparePage.svelte";
  import Dashboard from "./components/Dashboard.svelte";
  import LandingView from "./components/LandingView.svelte";
  import SettingsPage from "./components/SettingsPage.svelte";
  import SleepPage from "./components/SleepPage.svelte";
  import WeeklyPage from "./components/WeeklyPage.svelte";
  import {
    readStoredLocalePref,
    resolveLocale,
    t,
    writeStoredLocalePref,
    type LocalePref,
  } from "./lib/i18n";
  import { goto, initRouter, router } from "./lib/router.svelte";
  import { isDevLoginAllowed, type MeResponse } from "./lib/types";
  import { loggedOutMe } from "./lib/session";

  let me = $state<MeResponse | null>(null);
  let loginError = $state("");
  let booted = $state(false);
  let sessionError = $state("");
  let checkingSession = false;
  let sessionRevision = 0;
  let prefSaving = $state(false);
  let prefError = $state("");
  let localePref = $state<LocalePref>("system");
  const locale = $derived(resolveLocale(localePref));

  function withExplicitDevLogin(data: MeResponse): MeResponse {
    return { ...data, allowDevLogin: isDevLoginAllowed(data.allowDevLogin) };
  }

  function publicLoginError(raw: string): string {
    const text = raw.trim();
    if (!text) return "";
    if (/pnpm|dev:api|请先运行/i.test(text)) return t(locale, "apiUnreachable");
    return text;
  }

  function urlLoginError(): string {
    const params = new URLSearchParams(location.search);
    if (params.get("auth_error") === "retry") {
      return locale === "zh" ? "登录未完成或链接已过期，请重新登录。" : "Sign-in was incomplete or expired. Sign in again.";
    }
    if (params.get("auth_error") === "unavailable") {
      return locale === "zh" ? "登录服务暂时不可用，请稍后重新登录。" : "Sign-in is temporarily unavailable. Try signing in again shortly.";
    }
    const error = params.get("error");
    if (!error) return "";
    if (error === "storage_write_quota_exceeded") return errorText(new RequestError(error, 503, "", params.get("retry_at") || ""), locale);
    if (error === "oura_account_mismatch") {
      return locale === "zh" ? "此 Oura 账号与已有连接不一致，请使用原来的 Oura 账号重试。" : "This Oura account does not match the existing connection. Retry with your original Oura account.";
    }
    if (["access_denied", "invalid_state", "missing_code_or_state", "token_exchange_failed"].includes(error)) {
      return locale === "zh" ? "Oura 连接未完成或链接已过期，请重新连接。" : "The Oura connection was incomplete or expired. Reconnect Oura.";
    }
    if (error === "oauth_not_configured") return errorText(new RequestError("oura_not_configured", 503), locale);
    const hint = params.get("hint") ?? params.get("detail") ?? "";
    return publicLoginError(hint ? `${error} — ${hint}` : error);
  }

  function asMeResponse(value: unknown): MeResponse | null {
    if (!value || typeof value !== "object") return null;
    const rec = value as Record<string, unknown>;
    if (typeof rec.authenticated !== "boolean") return null;
    const source = rec.source === "oauth" || rec.source === "dev" || rec.source === "sso" ? rec.source : null;
    const localeFromApi =
      rec.localePref === "system" || rec.localePref === "zh" || rec.localePref === "en"
        ? rec.localePref
        : null;
    return withExplicitDevLogin({
      authenticated: rec.authenticated,
      source,
      userId: typeof rec.userId === "string" ? rec.userId : null,
      allowDevLogin: rec.allowDevLogin === true,
      oauthConfigured: rec.oauthConfigured === true,
      ssoEnabled: rec.ssoEnabled === true,
      websiteAccount: rec.websiteAccount as MeResponse["websiteAccount"],
      ouraConnection: rec.ouraConnection as MeResponse["ouraConnection"],
      localePref: localeFromApi,
      capabilities: rec.capabilities as MeResponse["capabilities"],
      release: typeof rec.release === "string" ? rec.release : undefined,
      build: typeof rec.build === "string" ? rec.build : undefined,
      apiContract: typeof rec.apiContract === "number" ? rec.apiContract : undefined,
    });
  }

  function showLogin(next?: MeResponse, extraError = "") {
    sessionRevision++;
    sessionError = "";
    me = next ? withExplicitDevLogin(next) : loggedOutMe(me);
    loginError = extraError ? publicLoginError(extraError) : urlLoginError();
    if (router.path !== "/") goto("/", true);
  }

  async function applyLocalePref(pref: LocalePref, persistRemote: boolean) {
    if (prefSaving) return;
    prefError = "";
    if (persistRemote && me?.authenticated) {
      prefSaving = true;
      try { await api("/api/me/prefs", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: pref }),
      }); } catch (error) {
        prefError = errorText(error, locale);
        return;
      } finally { prefSaving = false; }
    }
    localePref = pref;
    writeStoredLocalePref(pref);
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      showLogin();
    } catch (error) { sessionError = errorText(error, locale); }
  }

  async function boot() {
    if (checkingSession) return;
    checkingSession = true;
    const revision = sessionRevision;
    try {
      const data = asMeResponse(await api<MeResponse>("/api/me"));
      if (revision !== sessionRevision) return;
      if (!data) throw new RequestError("invalid_response", 502);
      sessionError = "";
      if (!data.authenticated) {
        showLogin(data);
        return;
      }
      me = data;
      if (data.localePref) {
        localePref = data.localePref;
        writeStoredLocalePref(data.localePref);
      } else {
        const stored = readStoredLocalePref();
        if (stored) {
          localePref = stored;
        }
      }
      loginError = urlLoginError();
    } catch (error) {
      if (revision !== sessionRevision) return;
      if (error instanceof RequestError && error.status === 401 && error.code === "unauthorized") showLogin();
      else sessionError = errorText(error, locale);
    } finally {
      booted = true;
      checkingSession = false;
    }
  }

  onMount(() => {
    const stop = initRouter();
    localePref = readStoredLocalePref() ?? "system";
    void boot();
    const check = () => { void boot(); };
    const expired = () => showLogin();
    const timer = setInterval(check, 30_000);
    window.addEventListener("focus", check);
    window.addEventListener("oura:session-expired", expired);
    return () => {
      stop(); clearInterval(timer); window.removeEventListener("focus", check);
      window.removeEventListener("oura:session-expired", expired);
    };
  });

  $effect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = me?.authenticated
      ? router.path === "/sleep"
        ? locale === "zh" ? "睡眠与恢复" : "Sleep & recovery"
        : router.path === "/insights"
        ? t(locale, "weeklyTitle")
        : router.path === "/compare"
          ? t(locale, "compareTitle")
          : router.path === "/settings"
            ? t(locale, "settingsTitle")
            : t(locale, "dashTitle")
      : t(locale, "landingTitle");
  });
</script>

{#if prefError}<div class="global-feedback" role="alert">{prefError}</div>{/if}
{#if me?.authenticated && loginError}<div class="global-feedback auth-feedback" role="alert">{loginError}</div>{/if}
{#if sessionError}<div class="global-feedback" role="alert">{sessionError} <button class="ai-btn" onclick={() => void boot()}>{locale === "zh" ? "重试" : "Retry"}</button></div>{/if}
{#if !booted}
  <div class="status" style="padding:24px">{t(locale, "loading")}</div>
{:else if me?.authenticated}
  <div class="journal workspace">
  {#if me.ouraConnection?.status === "disconnected" && !me.ouraConnection.hasCachedHistory && router.path !== "/settings"}
    <main class="wrap page">
      <h1>{locale === "zh" ? "连接你的 Oura" : "Connect your Oura"}</h1>
      <p>{locale === "zh" ? "网站账号已登录。连接 Oura 后即可同步健康记录。" : "You are signed in. Connect Oura to sync your health records."}</p>
      <a class="ai-btn" href="/api/auth/oura/start">{locale === "zh" ? "连接 Oura" : "Connect Oura"}</a>
      <button class="ai-btn" onclick={() => goto("/settings")}>{t(locale, "settingsTitle")}</button>
      <button class="ai-btn" onclick={() => void logout()}>{locale === "zh" ? "退出登录" : "Sign out"}</button>
    </main>
  {:else if router.path === "/sleep"}
    <SleepPage {me} {locale} onLogout={() => void logout()} onUnauthorized={() => showLogin()} />
  {:else if router.path === "/insights"}
    <WeeklyPage {me} {locale} onUnauthorized={() => showLogin()} onLogout={() => void logout()} />
  {:else if router.path === "/compare"}
    <ComparePage {me} {locale} onUnauthorized={() => showLogin()} onLogout={() => void logout()} />
  {:else if router.path === "/settings"}
    <SettingsPage
      {me}
      {locale}
      {localePref}
      {prefSaving}
      onLocalePref={(pref) => applyLocalePref(pref, true)}
      onLogout={() => void logout()}
    />
  {:else}
    <Dashboard {me} {locale} onLogout={() => void logout()} onUnauthorized={() => showLogin()} />
  {/if}
  </div>
{:else if me}
  <LandingView
    ssoEnabled={me?.ssoEnabled === true}
    allowDevLogin={isDevLoginAllowed(me?.allowDevLogin)}
    error={loginError}
    {locale}
    {localePref}
    onLocalePref={(pref) => applyLocalePref(pref, false)}
  />
{/if}
