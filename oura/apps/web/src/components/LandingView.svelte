<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import { t, type Locale, type LocalePref } from "../lib/i18n";
  import BrandMark from "./BrandMark.svelte";
  import LandingReveal from "./LandingReveal.svelte";
  import LandingSlot from "./LandingSlot.svelte";
  import ProductBrand from "./ProductBrand.svelte";

  let {
    allowDevLogin = false,
    error,
    locale,
    localePref,
    onLocalePref,
  }: {
    allowDevLogin?: boolean;
    error: string;
    locale: Locale;
    localePref: LocalePref;
    onLocalePref: (pref: LocalePref) => void;
  } = $props();

  const features = $derived([
    {
      title: t(locale, "featSleep"),
      text: t(locale, "featSleepText"),
      slot: "vis-sleep.svg",
      src: "/marketing/vis-sleep.svg",
      alt: locale === "zh"
        ? "睡眠示意：夜色与曲线，不是实时个人数据。"
        : "Sleep illustration. Not live personal data.",
    },
    {
      title: t(locale, "featReady"),
      text: t(locale, "featReadyText"),
      slot: "02-feature-readiness.png",
      src: "/marketing/02-feature-readiness.png",
      alt: locale === "zh"
        ? "准备度示意：晨光与圆环仪表，不是实时个人数据。"
        : "Readiness illustration. Not live personal data.",
    },
    {
      title: t(locale, "featAct"),
      text: t(locale, "featActText"),
      slot: "vis-activity.svg",
      src: "/marketing/vis-activity.svg",
      alt: locale === "zh"
        ? "活动示意：橙色柱形，不是实时个人数据。"
        : "Activity illustration. Not live personal data.",
    },
  ]);

  const chips = $derived([
    { title: t(locale, "chipAuth"), text: t(locale, "chipAuthText") },
    { title: t(locale, "chipToken"), text: t(locale, "chipTokenText") },
    { title: t(locale, "chipYours"), text: t(locale, "chipYoursText") },
  ]);

  function reduceMotion() {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function introFly(node: Element, params: { y?: number; delay?: number }) {
    if (reduceMotion()) return { duration: 0 };
    return fly(node, {
      y: params.y ?? 16,
      duration: 520,
      delay: params.delay ?? 0,
      easing: quintOut,
    });
  }

  function introFade(node: Element, params: { delay?: number }) {
    if (reduceMotion()) return { duration: 0 };
    return fade(node, { duration: 420, delay: params.delay ?? 0 });
  }

  let actionError = $state("");
  const shownError = $derived(actionError || error);

  async function loginOura() {
    actionError = "";
    try {
      const res = await fetch("/api/auth/oura/start", {
        credentials: "include",
        redirect: "manual",
      });
      if (res.status === 302 || res.status === 303 || res.type === "opaqueredirect") {
        window.location.href = res.headers.get("Location") || "/api/auth/oura/start";
        return;
      }
      actionError = t(locale, "apiUnreachable");
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
    <ProductBrand class="landing-brand" name={t(locale, "dashTitle")} />
    <div class="lang-pills landing-lang" role="radiogroup" aria-label={t(locale, "settingsLang")}>
      <button
        type="button"
        class="ai-btn"
        class:on={localePref === "system"}
        onclick={() => onLocalePref("system")}
      >{t(locale, "followSystem")}</button>
      <button
        type="button"
        class="ai-btn"
        class:on={localePref === "zh"}
        onclick={() => onLocalePref("zh")}
      >{t(locale, "langZh")}</button>
      <button
        type="button"
        class="ai-btn"
        class:on={localePref === "en"}
        onclick={() => onLocalePref("en")}
      >{t(locale, "langEn")}</button>
    </div>
  </header>

  <main id="landing-main" class="landing-main">
    <section class="landing-hero" aria-labelledby="landing-title">
      <div class="landing-hero-copy">
        <h1 id="landing-title" class="landing-wordmark" in:introFly={{ y: 14, delay: 40 }}>
          <BrandMark class="landing-wordmark-mark" />
          <span class="landing-wordmark-type">
            <span class="landing-wordmark-oura">Oura</span>
            <span class="landing-wordmark-product">
              {#if locale === "zh"}
                健康<span class="landing-wordmark-pill">看板</span>
              {:else}
                health <span class="landing-wordmark-pill">board</span>
              {/if}
            </span>
          </span>
        </h1>
        <p class="landing-lead" in:introFade={{ delay: 120 }}>
          {t(locale, "landingLead")}
        </p>
        <div class="landing-actions" in:introFly={{ y: 10, delay: 180 }}>
          <button class="landing-btn primary" type="button" onclick={loginOura}>
            {t(locale, "loginOura")}
          </button>
        </div>
        {#if shownError}
          <p class="status err landing-error" role="alert">{shownError}</p>
        {/if}
      </div>

      <div class="landing-hero-art" in:introFly={{ y: 20, delay: 140 }}>
        <LandingSlot
          slotName="01-hero.png"
          src="/marketing/01-hero.png"
          fallback="/board-preview.svg"
          alt={locale === "zh"
            ? "示意看板出现在书桌笔记本上。不是你的实时数据。"
            : "A sketched board on a desk. Not your live data."}
          width={1440}
          height={960}
        />
      </div>
    </section>

    <section class="landing-section" aria-labelledby="landing-get">
      <LandingReveal>
        <p class="landing-kicker">{t(locale, "landingKickerAfter")}</p>
        <h2 id="landing-get">{t(locale, "landingGet")}</h2>
      </LandingReveal>
      <ul class="landing-features">
        {#each features as item, i (item.title)}
          <li>
            <LandingReveal delay={i * 80}>
              <article class="landing-card">
                <LandingSlot
                  slotName={item.slot}
                  src={item.src}
                  alt={item.alt}
                  width={1200}
                  height={800}
                />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            </LandingReveal>
          </li>
        {/each}
      </ul>
    </section>

    <section class="landing-section landing-story" aria-labelledby="landing-how">
      <LandingReveal>
        <p class="landing-kicker">{t(locale, "landingKickerMulti")}</p>
        <h2 id="landing-how">{t(locale, "landingHow")}</h2>
      </LandingReveal>
      <LandingReveal delay={60}>
        <LandingSlot
          slotName="03-share-concept.png"
          src="/marketing/03-share-concept.png"
          alt={locale === "zh" ? "多人各自看自己的看板。示意画面。" : "Each person sees their own board."}
          width={1400}
          height={933}
        />
      </LandingReveal>
      <ul class="landing-chips">
        {#each chips as item, i (item.title)}
          <li>
            <LandingReveal delay={80 + i * 60}>
              <article class="landing-chip">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            </LandingReveal>
          </li>
        {/each}
      </ul>
    </section>

    <p class="landing-disclaimer">
      {t(locale, "landingDisclaimer")}
    </p>
  </main>

  <footer class="landing-foot">
    <p>{t(locale, "company")}</p>
    {#if allowDevLogin === true}
      <button class="landing-dev" type="button" onclick={loginDev}>{t(locale, "devLogin")}</button>
    {/if}
  </footer>
</div>
