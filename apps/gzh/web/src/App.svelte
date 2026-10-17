<script lang="ts">
  import { onMount } from "svelte";
  import { me } from "./api";
  import { onSessionExpired } from "./session";
  import { previewSlug } from "./lib/router.svelte";
  import { appState, syncRoute } from "./lib/state.svelte";
  import { drainFlash, showToast } from "./lib/toast";
  import Desk from "./components/Desk.svelte";
  import Login from "./components/Login.svelte";
  import Preview from "./components/Preview.svelte";

  let checkingSession = false;

  // 会话过期（401 / authenticated:false）：清空私有视图并回登录页，等价旧 clearPrivateView。
  onSessionExpired(() => {
    document.querySelector(".toast-host")?.remove();
    appState.account = null;
    appState.booted = false;
    if (appState.route !== "login") {
      const next = location.pathname + location.search;
      location.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  });

  async function checkSession() {
    if (!appState.account || checkingSession) return;
    checkingSession = true;
    try {
      await me();
    } catch {
      if (appState.account) showToast("会话检查暂时失败，请稍后重试", "err");
    } finally {
      checkingSession = false;
    }
  }

  async function bootstrap() {
    if (appState.route === "login") return;
    const account = await me();
    if (!account) {
      const next =
        appState.route === "preview"
          ? `/login?next=${encodeURIComponent(location.pathname)}`
          : "/login";
      location.replace(next);
      return;
    }
    appState.account = account;
    appState.booted = true;
  }

  onMount(() => {
    syncRoute();
    void bootstrap();
    const onFocus = () => { void checkSession(); };
    const onPageShow = () => { void checkSession(); };
    const interval = window.setInterval(() => { void checkSession(); }, 30_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    drainFlash();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  });
</script>

{#if appState.route === "login"}
  <Login />
{:else if appState.booted && appState.account}
  {#if appState.route === "preview"}
    <Preview account={appState.account} slug={previewSlug(location.pathname)} />
  {:else}
    <Desk account={appState.account} />
  {/if}
{:else}
  <div class="skel-block" aria-hidden="true">
    <div class="skel skel-title"></div>
    <div class="skel skel-row"></div>
  </div>
{/if}
