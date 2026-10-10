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
  }: {
    isDev?: boolean;
    locale: Locale;
    active: AppPath;
    showAi?: boolean;
    aiBusy?: boolean;
    onAi?: () => void;
    onLogout: () => void;
  } = $props();

  const links: { href: AppPath; key: MessageKey }[] = [
    { href: "/", key: "navHealth" },
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

<header class="chrome">
  <div class="chrome-inner">
    <ProductBrand class="brand" name={t(locale, "dashTitle")} />
    <nav class="nav" aria-label="Primary">
      {#each links as link (link.href)}
        <a
          href={link.href}
          class:active={active === link.href}
          onclick={(e) => onNav(e, link.href)}
        >{t(locale, link.key)}</a>
      {/each}
      {#if showAi && onAi}
        <button type="button" class="ai-btn" disabled={aiBusy} onclick={onAi}>{t(locale, "aiAnalyze")}</button>
      {/if}
      {#if isDev}
        <span class="ver-chip">DEV</span>
      {/if}
      <button type="button" class="ai-btn" onclick={onLogout}>{t(locale, "logout")}</button>
    </nav>
  </div>
</header>
