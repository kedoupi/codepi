<script lang="ts">
  import { t, type Locale, type MessageKey } from "../lib/i18n";
  import { goto, type AppPath } from "../lib/router.svelte";
  import ProductBrand from "./ProductBrand.svelte";

  let {
    isDev = false,
    locale,
    active,
    showAi = false,
    aiBusy = false,
    onAi,
    onLogout,
    journal = true,
  }: {
    isDev?: boolean;
    locale: Locale;
    active: AppPath;
    showAi?: boolean;
    aiBusy?: boolean;
    onAi?: () => void;
    onLogout: () => void;
    journal?: boolean;
  } = $props();

  const links: { href: AppPath; key: MessageKey }[] = [
    { href: "/", key: "navHealth" },
    { href: "/sleep", key: "navSleep" },
    { href: "/insights", key: "navInsights" },
    { href: "/compare", key: "navCompare" },
    { href: "/settings", key: "navSettings" },
  ];

  function onNav(event: MouseEvent, href: AppPath) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goto(href);
  }
</script>

<header class="chrome" class:journal-header={journal}>
  <div class="chrome-inner">
    <ProductBrand class="brand" name={t(locale, "dashTitle")} />
    <nav class="nav" aria-label={locale === "zh" ? "主导航" : "Primary"}>
      {#each links as link (link.href)}
        <a
          href={link.href}
          class:active={active === link.href}
          aria-current={active === link.href ? "page" : undefined}
          onclick={(e) => onNav(e, link.href)}
        >{t(locale, link.key)}</a>
      {/each}
      {#if showAi && onAi}
        <button type="button" class="ai-btn" disabled={aiBusy} onclick={onAi}>{t(locale, "aiAnalyze")}</button>
      {/if}
      {#if isDev}
        <span class="ver-chip">DEV</span>
      {/if}
      {#if journal}
        <details class="journal-account">
          <summary>{locale === "zh" ? "账号" : "Account"}</summary>
          <div><a href="https://codepi.app/">{locale === "zh" ? "返回个人空间" : "Personal home"}</a><a href="/settings#account">{locale === "zh" ? "账号与连接" : "Account & connections"}</a><button type="button" onclick={onLogout}>{t(locale, "logout")}</button></div>
        </details>
      {:else}
        <button type="button" class="ai-btn" onclick={onLogout}>{t(locale, "logout")}</button>
      {/if}
    </nav>
  </div>
</header>

<style>
  .chrome :global(.brand-name){white-space:nowrap}
  .chrome :global(.brand){flex-shrink:0}
  .journal-header { background: var(--canvas); }
  .journal-header .chrome-inner { height: 76px; gap: 24px; }
  .journal-header :global(.brand-name) { font-weight: 650; font-size: 19px; letter-spacing: -.03em; }
  .journal-header :global(.brand-mark) { width: 32px; height: auto; }
  .journal-header .nav { gap: 24px; flex-wrap: nowrap; }
  .journal-header .nav a { font-size: 14px; font-weight: 500; min-height: 56px; border-bottom: 2px solid transparent; }
  .journal-header .nav a.active { color: var(--primary); border-bottom-color: var(--primary); }
  .journal-account { position: relative; font-size: 13px; }
  .journal-account summary { padding: 12px 4px; cursor: pointer; }
  .journal-account summary:focus-visible { outline: 2px solid var(--primary); }
  .journal-account div { position: absolute; right: 0; top: 100%; width: 190px; padding: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--kdp-radius); box-shadow: var(--kdp-shadow); }
  .journal-account div a { display: flex; min-height: 44px; border: 0; }
  .journal-account button { width: 100%; min-height: 44px; background: transparent; border: 0; color: var(--primary); cursor: pointer; }
  @media (max-width: 760px) {
    .journal-header .chrome-inner { height: auto; display: block; padding: 8px 0 0; }
    .journal-header :global(.brand-name) { font-size: 18px; }
    .journal-header .nav { justify-content: space-between; gap: 4px; flex-wrap: wrap; }
    .journal-header .nav a { font-size: 12px; min-height: 44px; padding: 6px 2px; }
    .journal-account { font-size: 12px; }
  }
</style>
