<script lang="ts">
  import { onMount } from "svelte";
  import { PRODUCT_BRAND } from "@kedoupi/shared/brand";
  import { api, clearRequests } from "./lib/api";
  import type { Overview } from "../../worker/models";
  import Memories from "./components/Memories.svelte";
  import Profile from "./components/Profile.svelte";
  import Timeline from "./components/Timeline.svelte";
  import Imports from "./components/Imports.svelte";

  let auth = $state<"loading" | "ready" | "anonymous" | "error">("loading");
  let message = $state("");
  let counts = $state<Overview | null>(null);
  let leaving = $state(false);
  const page = location.pathname;
  const nav = [["/", "记忆"], ["/profile", "个人背景"], ["/timeline", "经历"], ["/imports", "导入"]];
  const returnTo = page === "/login" ? new URLSearchParams(location.search).get("return") ?? "/" : page;
  const safeReturn = ["/", "/profile", "/timeline", "/imports"].includes(returnTo) ? returnTo : "/";

  async function refreshCounts() {
    try { counts = await api<Overview>("/api/overview"); }
    catch (error) { message = (error as Error).message; }
  }
  async function load() {
    message = "";
    try {
      await api("/api/me");
      auth = "ready";
      await refreshCounts();
    } catch (error) {
      if (auth !== "anonymous") auth = "error";
      message = (error as Error).message;
    }
  }
  async function signOut() {
    leaving = true;
    try {
      await api("/api/auth/logout", {});
      clearRequests();
      counts = null; auth = "anonymous"; message = "";
    } catch (error) { message = (error as Error).message; }
    finally { leaving = false; }
  }
  onMount(() => {
    const expired = () => { auth = "anonymous"; counts = null; message = ""; };
    const check = () => { if (auth === "ready" && document.visibilityState === "visible") void api("/api/me").catch(error => { message = error.message; }); };
    window.addEventListener("me:unauthorized", expired);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    if (page === "/login") auth = "anonymous"; else void load();
    return () => {
      window.removeEventListener("me:unauthorized", expired);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  });
</script>

{#if auth === "anonymous"}
  <main class="login">
    <section class="login-story">
      <a class="brand" href="https://codepi.app">{PRODUCT_BRAND}</a>
      <div><p class="eyebrow">ME / 个人记录</p><h1>把关于自己的事，<br>留在自己手里。</h1>
        <p>记忆、背景与经历，收在同一个地方。<br>由你确认，再让 AI 读到。</p></div>
      <p class="muted">仅本人访问 · 私人空间</p>
    </section>
    <section class="login-panel">
      <div><span class="badge">统一登录</span><h2>回到你的 Me</h2>
        <p>使用 {PRODUCT_BRAND} 账户登录。</p>
        {#if new URLSearchParams(location.search).has("auth_error")}<p role="alert">登录未完成，请重新登录；服务不可用时可稍后重试。</p>{/if}
        <a class="button primary" href="/api/auth/login?return={encodeURIComponent(safeReturn)}">统一登录</a>
        <p class="muted fine">登录状态最多保留 7 天。退出将同步退出其他应用。</p></div>
    </section>
  </main>
{:else}
  <a class="skip-link" href="#content">跳到内容</a>
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/"><span class="brand-mark">me</span><span>kedoupi<small>codepi · 个人记录</small></span></a>
      <nav aria-label="主导航">{#each nav as [href, label]}<a {href} aria-current={page === href ? "page" : undefined}>{label}</a>{/each}</nav>
      <div class="sidebar-foot"><p>由你确认，才成为记忆。</p><a href="https://codepi.app">返回个人空间 ↗</a></div>
    </aside>
    <div class="main">
      <header class="topbar"><span>Me <span class="muted">/ 私人记录</span></span><button onclick={signOut} disabled={leaving || auth !== "ready"}>{leaving ? "退出中…" : "退出"}</button></header>
      <main id="content" tabindex="-1">
        {#if message}<p class="notice error" role="alert">{message}</p>{/if}
        {#if auth === "loading"}<div class="empty" role="status">正在读取私人记录…</div>
        {:else if auth === "error"}<div class="empty"><h1>暂时无法读取</h1><p>记录会在连接恢复后重新加载。</p><button onclick={load}>重试</button></div>
        {:else}
          {#if counts}
            <div class="overview" aria-label="记录概览">
              <a href="/"><strong>{counts.active_memories}</strong><span>已确认记忆</span></a>
              <a href="/"><strong>{counts.pending_memories}</strong><span>待确认记忆</span></a>
              <a href="/profile"><strong>{counts.pending_profile}</strong><span>背景提议</span></a>
              <a href="/timeline"><strong>{counts.pending_timeline}</strong><span>经历提议</span></a>
            </div>
          {/if}
          {#if page === "/profile"}<Profile onchanged={refreshCounts} />
          {:else if page === "/timeline"}<Timeline onchanged={refreshCounts} />
          {:else if page === "/imports"}<Imports onchanged={refreshCounts} />
          {:else}<Memories onchanged={refreshCounts} />{/if}
        {/if}
      </main>
      <footer>kedoupi（codepi） · 内容由本人确认 · 时间按北京时间显示</footer>
    </div>
  </div>
{/if}
