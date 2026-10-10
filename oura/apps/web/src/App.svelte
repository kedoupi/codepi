<script lang="ts">
  import { onMount } from "svelte";
  import ComparePage from "./components/ComparePage.svelte";
  import Dashboard from "./components/Dashboard.svelte";
  import LandingView from "./components/LandingView.svelte";
  import SettingsPage from "./components/SettingsPage.svelte";
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

  let me = $state<MeResponse | null>(null);
  let loginError = $state("");
  let booted = $state(false);
  let localePref = $state<LocalePref>("system");
  const locale = $derived(resolveLocale(localePref));

  function loggedOutMe(): MeResponse {
    return {
      authenticated: false,
      source: null,
      userId: null,
      allowDevLogin: false,
      oauthConfigured: false,
    };
  }

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
    const error = params.get("error");
    if (!error) return "";
    const hint = params.get("hint") ?? params.get("detail") ?? "";
    return publicLoginError(hint ? `${error} — ${hint}` : error);
  }

  function asMeResponse(value: unknown): MeResponse | null {
    if (!value || typeof value !== "object") return null;
    const rec = value as Record<string, unknown>;
    if (typeof rec.authenticated !== "boolean") return null;
    const source = rec.source === "oauth" || rec.source === "dev" ? rec.source : null;
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
      subscribed: rec.subscribed === true,
      subscriptionStatus: typeof rec.subscriptionStatus === "string" ? rec.subscriptionStatus : null,
      localePref: localeFromApi,
      stripeConfigured: rec.stripeConfigured === true,
      priceLabel: typeof rec.priceLabel === "string" ? rec.priceLabel : undefined,
    });
  }

  async function readMeResponse(res: Response): Promise<MeResponse | null> {
    try {
      const text = await res.text();
      if (!text || text.trimStart().startsWith("<")) return null;
      return asMeResponse(JSON.parse(text) as unknown);
    } catch {
      return null;
    }
  }

  function showLogin(next?: MeResponse, extraError = "") {
    me = next ? withExplicitDevLogin(next) : loggedOutMe();
    loginError = extraError ? publicLoginError(extraError) : urlLoginError();
    if (router.path !== "/") goto("/", true);
  }

  function applyLocalePref(pref: LocalePref, persistRemote: boolean) {
    localePref = pref;
    writeStoredLocalePref(pref);
    if (persistRemote && me?.authenticated) {
      void fetch("/api/me/prefs", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: pref }),
      });
    }
  }

  async function boot() {
    localePref = readStoredLocalePref() ?? "system";
    try {
      const res = await fetch("/api/me", { credentials: "include" });
      const data = await readMeResponse(res);
      if (!data || !data.authenticated) {
        // Missing Worker / non-JSON / 404: public landing, no first-paint banner.
        showLogin(data ?? loggedOutMe());
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
          void fetch("/api/me/prefs", {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locale: stored }),
          });
        }
      }
      loginError = "";
    } catch {
      showLogin(loggedOutMe());
    } finally {
      booted = true;
    }
  }

  onMount(() => {
    const stop = initRouter();
    void boot();
    return stop;
  });

  $effect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = me?.authenticated
      ? router.path === "/insights"
        ? t(locale, "weeklyTitle")
        : router.path === "/compare"
          ? t(locale, "compareTitle")
          : router.path === "/settings"
            ? t(locale, "settingsTitle")
            : t(locale, "dashTitle")
      : t(locale, "landingTitle");
  });
</script>

{#if !booted}
  <div class="status" style="padding:24px">{t(locale, "loading")}</div>
{:else if me?.authenticated}
  {#if router.path === "/insights"}
    <WeeklyPage {me} {locale} onUnauthorized={() => showLogin()} onLogout={() => (window.location.href = "/api/auth/logout")} />
  {:else if router.path === "/compare"}
    <ComparePage {me} {locale} onUnauthorized={() => showLogin()} onLogout={() => (window.location.href = "/api/auth/logout")} />
  {:else if router.path === "/settings"}
    <SettingsPage
      {me}
      {locale}
      {localePref}
      onLocalePref={(pref) => applyLocalePref(pref, true)}
      onMeChange={(next) => (me = next)}
      onLogout={() => (window.location.href = "/api/auth/logout")}
    />
  {:else}
    <Dashboard {me} {locale} onUnauthorized={() => showLogin()} />
  {/if}
{:else}
  <LandingView
    allowDevLogin={isDevLoginAllowed(me?.allowDevLogin)}
    error={loginError}
    {locale}
    {localePref}
    onLocalePref={(pref) => applyLocalePref(pref, false)}
  />
{/if}
