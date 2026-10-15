<script lang="ts">
  import { t, type Locale, type LocalePref } from "../lib/i18n";
  import { errorText, RequestError } from "../lib/api";
  import { PRODUCT_BRAND } from "../../../../../shared/brand";
  import ProductBrand from "./ProductBrand.svelte";

  let { allowDevLogin = false, ssoEnabled = false, error, locale, localePref, onLocalePref }: {
    allowDevLogin?: boolean; ssoEnabled?: boolean; error: string;
    locale: Locale; localePref: LocalePref; onLocalePref: (pref: LocalePref) => void;
  } = $props();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const areas = $derived([
    { title: text("睡眠", "Sleep"), detail: text("从每一晚的时长与节律，认识自己的休息。", "Understand your rest through sleep duration and rhythm.") },
    { title: text("恢复", "Recovery"), detail: text("结合准备度与心率变异性，回顾身体的变化。", "Reflect on readiness and heart rate variability over time.") },
    { title: text("活动", "Activity"), detail: text("把步数与活动放回日常，观察长期的节奏。", "See steps and activity in the context of everyday life.") },
  ]);
  let actionError = $state("");
  const shownError = $derived(actionError || error);

  async function loginOura() {
    actionError = "";
    try {
      const res = await fetch("/api/auth/login", {
        credentials: "include",
        redirect: "manual",
      });
      if (res.status === 302 || res.status === 303 || res.type === "opaqueredirect") {
        window.location.href = res.headers.get("Location") || "/api/auth/login";
        return;
      }
      const body = await res.json().catch(() => null);
      actionError = typeof body?.error === "string" ? errorText(new RequestError(body.error, res.status,
        res.headers.get("X-Request-ID") || "", typeof body.retryAt === "string" ? body.retryAt : ""), locale)
        : t(locale, "apiUnreachable");
    } catch {
      actionError = t(locale, "apiUnreachable");
    }
  }

  function loginDev() {
    window.location.href = "/api/auth/dev/session";
  }
</script>

<div id="landing-view">
  <a class="landing-skip" href="#landing-main">{t(locale, "skipToContent")}</a>
  <header class="landing-top">
    <ProductBrand name={t(locale, "dashTitle")} />
    <div class="landing-nav">
      <a class="home-link" href="https://codepi.app/">{text("个人空间", "Personal home")}</a>
      <div class="lang-pills landing-lang" role="group" aria-label={t(locale, "settingsLang")}>
        {#each ["system", "zh", "en"] as pref}
          <button type="button" class="ai-btn" class:on={localePref === pref} aria-pressed={localePref === pref}
            onclick={() => onLocalePref(pref as LocalePref)}>{pref === "system" ? t(locale, "followSystem") : pref === "zh" ? t(locale, "langZh") : t(locale, "langEn")}</button>
        {/each}
      </div>
    </div>
  </header>
  <main id="landing-main">
    <section class="landing-hero" aria-labelledby="landing-title">
      <div class="landing-copy">
        <h1 id="landing-title">{text("照顾好自己，", "A little more attention,")}<br />{text("从理解每天开始。", "to your everyday health.")}</h1>
        <p class="landing-lead">{text("这里是我的个人健康空间。把睡眠、恢复与活动的记录放在一起，慢慢认识自己的长期变化。", "My personal health space brings sleep, recovery and activity together, to understand the changes that unfold over time.")}</p>
        <div class="landing-actions">
          <button class="landing-btn primary" type="button" onclick={loginOura}>{ssoEnabled ? text("登录健康空间", "Sign in to Health") : t(locale, "loginOura")}</button>
          <a class="landing-btn secondary" href="https://codepi.app/apps/#health">{text("关于这个应用", "About this app")}</a>
        </div>
        <p class="landing-hint">{text(`使用 ${PRODUCT_BRAND} 统一账号，健康记录仅本人可见。`, `Uses the ${PRODUCT_BRAND} account. Health records are private.`)}</p>
        {#if shownError}<p class="status err landing-error" role="alert">{shownError}</p>{/if}
      </div>
      <aside class="health-perspective" aria-label={text("健康记录的三个方向", "Three perspectives on health")}>
        <div class="perspective-title"><span class="health-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="M3 12h4l2-4 4 8 2-4h6"/></svg></span><div><strong>{text("健康，是长期的事。", "Health takes time.")}</strong><p>{text("记录来自 Oura，关注的是自己。", "Oura is the source. You are the focus.")}</p></div></div>
        {#each areas as area}
          <div class="perspective-row"><span class="perspective-dot" aria-hidden="true"></span><div><h2>{area.title}</h2><p>{area.detail}</p></div></div>
        {/each}
        <p class="source-note">{text("数据登录后可见，这里不展示个人记录。", "Your records appear after sign-in.")}</p>
      </aside>
    </section>
    <aside class="health-continuity"><h2>{text("记录可以积累，生活慢慢连接。", "A history that grows with you.")}</h2><p>{text("日常看板、睡眠回顾、阶段对比与 AI 解读，沿用同一份记录。需要时，也可以授权 AI 应用只读访问，并随时撤销连接。", "Daily overview, sleep history, comparisons and insights use the same records. You can grant AI apps read-only access and revoke it whenever needed.")}</p></aside>
  </main>
  <footer class="landing-foot"><a href="https://codepi.app/">{PRODUCT_BRAND}</a><p>{text("数据来源：Oura · 个人记录与回顾", "Data from Oura · Personal records and reflection")}</p>{#if allowDevLogin === true}<button class="landing-dev" type="button" onclick={loginDev}>{t(locale, "devLogin")}</button>{/if}</footer>
</div>

<style>
  #landing-view { max-width: var(--kdp-content-width); margin: 0 auto; }
  .landing-skip { position: absolute; top: -100px; padding: 12px; background: var(--surface); z-index: 50; }
  .landing-skip:focus { top: 8px; }
  .landing-top { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 84px; border-bottom: 1px solid var(--line); }
  .landing-nav { display: flex; gap: 24px; align-items: center; }
  .home-link { color: var(--muted); font-size: 14px; padding-block: 12px; }
  .landing-lang { margin: 0; }
  .landing-lang button { font-size: 12px; padding-inline: 10px; }
  .landing-hero { display: grid; grid-template-columns: 1.2fr 1fr; align-items: center; gap: 64px; padding-block: 72px 64px; }
  h1 { color: var(--ink); font-size: clamp(32px,3.3vw,46px); font-weight: 650; line-height: 1.6; letter-spacing: -.045em; }
  .landing-lead { max-width: 32em; color: var(--kdp-text); font-size: 16px; line-height: 1.95; margin-top: 24px; }
  .landing-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
  .landing-btn { display: inline-flex; justify-content: center; align-items: center; min-height: 48px; padding: 12px 24px; border: 1px solid transparent; border-radius: var(--kdp-radius-sm); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; transition: background var(--kdp-motion); }
  .landing-btn.primary { background: var(--primary); color: white; }
  .landing-btn.primary:hover { background: var(--kdp-accent-strong); }
  .landing-btn.secondary { background: var(--surface); border-color: var(--line); color: var(--kdp-text); }
  .landing-btn.secondary:hover { background: var(--peach); }
  .landing-hint { color: var(--muted); font-size: 12px; line-height: 1.8; margin-top: 20px; }
  .landing-error { margin-top: 16px; }
  .health-perspective { min-width: 0; padding: 32px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--kdp-radius-lg); box-shadow: var(--kdp-shadow); }
  .perspective-title { display: flex; gap: 16px; align-items: center; margin-bottom: 28px; }
  .health-glyph { display: grid; place-items: center; flex-shrink: 0; width: 48px; height: 48px; background: var(--peach); color: var(--primary); border-radius: var(--kdp-radius); }
  .health-glyph svg { width: 26px; height: 26px; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .perspective-title strong { font-size: 18px; font-weight: 650; }
  .perspective-title p { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .perspective-row { display: flex; gap: 18px; padding-block: 20px; border-top: 1px solid var(--line); }
  .perspective-dot { height: 8px; width: 8px; border-radius: 50%; background: var(--primary); flex-shrink: 0; margin-top: 8px; }
  .perspective-row h2 { font-size: 16px; font-weight: 600; }
  .perspective-row p { color: var(--muted); font-size: 13px; line-height: 1.8; margin-top: 6px; }
  .source-note { font-size: 11px; color: var(--muted); padding-top: 16px; border-top: 1px solid var(--line); }
  .health-continuity { padding: 28px 32px; background: var(--peach); border-radius: var(--kdp-radius-lg); margin-bottom: 48px; }
  .health-continuity h2 { font-size: 22px; font-weight: 650; letter-spacing: -.025em; }
  .health-continuity p { max-width: 65em; font-size: 14px; line-height: 1.9; color: var(--kdp-text); margin-top: 12px; }
  .landing-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; padding-block: 24px 32px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
  .landing-dev { color: var(--primary); background: none; border: 0; min-height: 44px; cursor: pointer; }
  @media (max-width: 850px) { .landing-hero { gap: 28px; } .health-perspective { padding: 24px; } }
  @media (max-width: 680px) { .landing-top { flex-wrap: wrap; padding-block: 16px; gap: 12px; } .landing-nav { width: 100%; justify-content: space-between; gap: 12px; } .landing-lang { gap: 4px; } .landing-lang button { padding-inline: 8px; } .landing-hero { grid-template-columns: 1fr; gap: 32px; padding-block: 36px; } h1 { font-size: clamp(28px,6.9vw,38px); } .landing-lead { font-size: 15px; margin-top: 18px; } .health-continuity { padding: 24px; margin-bottom: 32px; } .health-continuity h2 { font-size: 20px; } }
</style>
