<script lang="ts">
  import { t, type Locale } from "../lib/i18n";

  let {
    locale,
    priceLabel,
    busy = false,
    onSubscribe,
  }: {
    locale: Locale;
    priceLabel: string;
    busy?: boolean;
    onSubscribe: () => void;
  } = $props();
</script>

<aside class="panel paywall-card" aria-live="polite">
  <h2>{t(locale, "paywallTitle")}</h2>
  <p class="takeaway">{t(locale, "paywallBody")}</p>
  <p class="hint">{priceLabel} · {t(locale, "notMedical")} / {t(locale, "notMedicalEn")}</p>
  <button class="landing-btn primary" type="button" disabled={busy} onclick={onSubscribe}>
    {t(locale, "settingsSubscribe")}
  </button>
</aside>
