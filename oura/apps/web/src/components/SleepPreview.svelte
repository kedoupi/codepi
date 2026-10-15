<script lang="ts">
  import { onMount } from "svelte";
  import { errorText, RequestError } from "../lib/api";
  import { dateWindow, duration, readSleep, sleepForDay, type SleepRecord } from "../lib/health";
  import type { Locale } from "../lib/i18n";
  let { locale, onUnauthorized }: { locale: Locale; onUnauthorized: () => void } = $props();
  let latest = $state<SleepRecord | null>(null);
  let loading = $state(true);
  let error = $state("");
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  onMount(() => {
    const { from, to } = dateWindow(30);
    void readSleep(from, to).then(result => {
      const day = result.records.map(r => r.day).sort().at(-1);
      latest = day ? sleepForDay(result.records, day)[0] : null;
    }).catch(err => {
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") onUnauthorized();
      else error = errorText(err, locale);
    }).finally(() => { loading = false; });
  });
</script>

<section class="sleep-preview">
  <div>
    <p class="eyebrow">{text("睡眠与恢复", "Sleep & recovery")}</p>
    {#if loading}<h2>{text("正在读取睡眠记录…", "Loading sleep records…")}</h2>
    {:else if error}<p role="alert">{error}</p>
    {:else if latest}
      <h2>{duration(latest.total_sleep_duration, locale)}</h2>
      <p>{latest.day} · {latest.type === "long_sleep" ? text("主睡眠", "Main sleep") : text("最近睡眠记录", "Latest sleep record")}</p>
    {:else}
      <h2>{text("让睡眠细节回到看板", "Bring your sleep into focus")}</h2>
      <p>{text("近 30 天还没有保存的详细睡眠记录。同步后可查看实际时长、睡眠阶段与恢复指标。", "No detailed sleep records saved in the last 30 days. Sync to view duration, stages and recovery metrics.")}</p>
    {/if}
  </div>
  <a class="ai-btn" href="/sleep">{text("查看睡眠与恢复", "Explore sleep & recovery")} ↗</a>
</section>

<style>
  .sleep-preview{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:28px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(110deg,#fff0df,var(--canvas) 75%);margin:24px 0}
  .eyebrow{font-size:13px;color:#9a3412}h2{font-size:28px;line-height:1.3;margin:8px 0}p{font-size:14px;color:var(--muted);max-width:580px}.ai-btn{flex-shrink:0;background:white}
  @media(max-width:600px){.sleep-preview{padding:22px;align-items:flex-start;flex-direction:column}h2{font-size:24px}}
</style>
