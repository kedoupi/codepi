<script lang="ts">
  import { onMount } from "svelte";
  import { api, RequestError, errorText } from "../lib/api";
  import { fetchAi, stripMarkdown, type AiResponse } from "../lib/ai";
  import { createSRAChart } from "../lib/charts";
  import { sortDays } from "../lib/format";
  import { t, type Locale } from "../lib/i18n";
  import { isDevLoginAllowed, type DailyResponse, type Day, type MeResponse } from "../lib/types";
  import { computeViewModel } from "../lib/view-model";
  import AiDrawer from "./AiDrawer.svelte";
  import ChartCanvas from "./ChartCanvas.svelte";
  import ChromeHeader from "./ChromeHeader.svelte";
  import SyncStatus from "./SyncStatus.svelte";
  import ArchiveStatus from "./ArchiveStatus.svelte";
  import SleepPreview from "./SleepPreview.svelte";
  import { calendarDays, dateWindow, finite, latestDay, scoreDelta } from "../lib/health";

  let {
    me,
    locale,
    onUnauthorized,
  }: {
    me: MeResponse;
    locale: Locale;
    onUnauthorized: () => void;
  } = $props();

  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const metrics = $derived([
    { key: "sleep" as const, label: text("睡眠", "Sleep") },
    { key: "readiness" as const, label: text("准备度", "Readiness") },
    { key: "activity" as const, label: text("活动", "Activity") },
  ]);
  let loading = $state(true);
  const API = "/api/me/daily?days=90";

  let allDays = $state<Day[]>([]);
  const latest = $derived(latestDay(allDays));
  let rangeDays = $state(7);
  let status = $state("");
  let statusErr = $state(false);
  let resizeTick = $state(0);
  let narrow = $state(false);
  let aiOpen = $state(false);
  let aiBusy = $state(false);
  let aiThinking = $state(false);
  let aiStatus = $state("");
  let aiStatusErr = $state(false);
  let aiReport = $state<AiResponse | null>(null);
  let aiFallback = $state("");
  let syncState = $state<import("../lib/types").SyncInfo | undefined>(undefined);
  let syncBusy = $state(false);

  const vm = $derived(allDays.length ? computeViewModel(calendarDays(allDays, 90), rangeDays) : null);

  const sraBuild = $derived(
    vm
      ? (el: HTMLCanvasElement) => {
          void resizeTick;
          return createSRAChart(
            el,
            vm.days,
            vm.labels,
            vm.sleepSeries,
            vm.readySeries,
            vm.actSeries,
            vm.rAvg,
            rangeDays,
            narrow,
          );
        }
      : null,
  );
  $effect(() => {
    const mq = window.matchMedia("(max-width:520px)");
    const syncNarrow = () => {
      narrow = mq.matches;
    };
    syncNarrow();
    mq.addEventListener("change", syncNarrow);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        resizeTick += 1;
      }, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      mq.removeEventListener("change", syncNarrow);
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  });

  $effect(() => {
    if (vm && !statusErr) {
      const window = dateWindow(rangeDays);
      status = `${text("已读取近 90 天评分", "Loaded the last 90 days of scores")} · ${window.from} — ${window.to}`;
    }
  });

  async function load() {
    try {
      status = t(locale, "loadingOura");
      statusErr = false;
      const data = await api<DailyResponse>(API);
      if (!data || !data.ok || !Array.isArray(data.days)) throw new Error("响应格式异常");
      allDays = sortDays(data.days);
      syncState = data.sync;
    } catch (err) {
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      statusErr = true;
      status = errorText(err, locale);
    } finally { loading = false; }
  }

  async function syncNow() {
    if (syncBusy) return;
    syncBusy = true;
    try {
      const data = await api<DailyResponse>("/api/me/sync?days=90", { method: "POST" });
      if (data.ok && Array.isArray(data.days)) {
        allDays = sortDays(data.days);
        syncState = data.sync;
        statusErr = false;
      }
    } catch (err) {
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      statusErr = true;
      status = errorText(err, locale);
    } finally { syncBusy = false; }
  }

  onMount(() => {
    void load();
  });

  function setRange(n: number) {
    rangeDays = n;
  }

  async function openAi() {
    if (aiBusy) {
      aiStatus = "正在分析中，请稍候…";
      aiOpen = true;
      return;
    }
    aiOpen = true;
    aiBusy = true;
    aiStatus = "";
    aiStatusErr = false;
    aiReport = null;
    aiFallback = "";
    aiThinking = true;
    try {
      const data = await fetchAi(rangeDays);
      aiStatus =
        "近 " +
        (data.days || rangeDays) +
        " 天 · " +
        (data.from || "") +
        " → " +
        (data.to || "") +
        " · " +
        (data.model || "规则解读");
      if (data.report && typeof data.report === "object") {
        aiReport = data;
        aiFallback = "";
      } else {
        aiFallback = stripMarkdown(String(data.text || ""));
      }
    } catch (err) {
      console.error(err);
      aiStatusErr = true;
      aiStatus = errorText(err, locale);
      aiReport = null;
      aiFallback = "";
    } finally {
      aiThinking = false;
      aiBusy = false;
    }
  }

  function logout() {
    window.location.href = "/api/auth/logout";
  }
</script>

<div id="dash-view">
  <ChromeHeader
    isDev={isDevLoginAllowed(me.allowDevLogin) && me.source === "dev"}
    {locale}
    active="/"
    showAi={me.capabilities?.analysis === true}
    {aiBusy}
    onAi={openAi}
    onLogout={logout}
  />

  <main class="wrap page" style="max-width:var(--page-max);margin-left:auto;margin-right:auto">
    <header class="overview-heading">
      <div><h1>{text("今日概览", "Your daily overview")}</h1><p>{text("从今天的状态，看见自己的节奏。", "A closer look at your daily rhythm.")}</p></div>
      <div class="latest-date"><span>{text("最新评分日期", "Latest score date")}</span><strong>{latest?.date ?? "—"}</strong></div>
    </header>
    <div class="status" class:err={statusErr}>{status}</div>
    {#if statusErr}
      <div class="settings-actions" style="margin-bottom:12px">
        {#if status.includes("重新连接")}<a class="landing-btn primary" href="/api/auth/oura/start">{locale === "zh" ? "重新连接 Oura" : "Reconnect Oura"}</a>{/if}
        <button class="ai-btn" onclick={load}>{locale === "zh" ? "重试" : "Retry"}</button>
      </div>
    {/if}
    <SyncStatus sync={syncState} {locale} busy={syncBusy} onSync={syncNow} />

    {#if latest}
      <section class="today-scores" aria-label={text("最新一日官方评分", "Latest daily official scores")}>
        {#each metrics as metric}
          {@const score = latest[metric.key]?.score}
          {@const delta = scoreDelta(allDays, latest, metric.key)}
          <article>
            <div class="score-heading"><h2>{metric.label}</h2><span>{text("Oura 官方评分", "Oura score")}</span></div>
            <div class="today-score">{finite(score) ? score : "—"}<small>/ 100</small></div>
            {#if delta}<p class="score-comparison"><strong>{delta.value > 0 ? "+" : ""}{delta.value}</strong> {text("较此前 7 天均值", "vs. prior 7-day mean")}</p><p class="score-source">{text("比较基于", "Based on")} {delta.count} {text("天有效记录", "recorded days")}</p>
            {:else}<p class="score-comparison">{text("暂无足够记录用于比较", "Not enough records to compare")}</p>{/if}
          </article>
        {/each}
      </section>
      <p class="hint">{text("三项评分均对应标注日期。差值仅表示变化，不等同于健康判断。", "All three scores use the date shown. Differences describe change, not a health assessment.")}</p>
    {:else if !loading && !statusErr}
      <div class="overview-empty"><h2>{text("还没有评分记录", "No scores yet")}</h2><p>{text("刷新评分，或在数据设置中检查授权和同步状态。", "Refresh scores or check authorization and sync in settings.")}</p><a href="/settings">{text("打开数据设置", "Open data settings")}</a></div>
    {/if}
    {#if me.capabilities?.personal}<SleepPreview {locale} {onUnauthorized} />{/if}
    <section class="overview-trend panel">
      <div class="trend-heading">
        <div><h2>{text("最近的节奏", "Your recent rhythm")}</h2><p class="sub">{rangeDays} {text("天评分趋势", "days of scores")}</p></div>
        <div class="range" role="group" aria-label={t(locale, "rangeAria")} data-on={String(rangeDays)}>
          <span class="range-thumb" aria-hidden="true"></span>
          {#each [7, 30, 90] as n}<button type="button" class:on={rangeDays === n} aria-pressed={rangeDays === n} onclick={() => setRange(n)}>{n}</button>{/each}
        </div>
      </div>
      {#if latest}<div class="chart-well"><div class="chart-box"><ChartCanvas build={sraBuild} /></div></div>
      {:else}<p class="overview-empty">{loading ? text("正在读取评分…", "Loading scores…") : text("有记录后，这里会呈现评分变化。", "Your score history will appear here once available.")}</p>{/if}
      <p class="hint">{text("Oura 官方评分 · 虚线为所选区间准备度均值 · 缺失日期保留空缺", "Oura scores · Dashed line: mean readiness for this range · Missing dates remain gaps")}</p>
    </section>
    <section class="overview-links">
      <a href="/insights"><h2>{text("本周解读", "This week")}</h2><p>{text("回看一周的变化与已有记录。", "Review the week's changes and recorded patterns.")}</p></a>
      <a href="/compare"><h2>{text("区间对比", "Compare periods")}</h2><p>{text("把近期状态放到更长的时间里看。", "Put your recent scores in a longer perspective.")}</p></a>
    </section>
    {#if me.capabilities?.personal}<ArchiveStatus {locale} {onUnauthorized} />{/if}
    <footer class="foot"><span>{t(locale, "footData")}</span></footer>
  </main>

  <AiDrawer
    open={aiOpen}
    {rangeDays}
    thinking={aiThinking}
    status={aiStatus}
    statusErr={aiStatusErr}
    report={aiReport}
    fallbackText={aiFallback}
    onClose={() => (aiOpen = false)}
  />
</div>

<style>
  .page{padding-top:36px}.overview-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}.overview-heading h1{font-size:36px;letter-spacing:-.04em}.overview-heading p{font-size:15px;color:var(--muted);margin-top:8px}.latest-date{text-align:right;display:grid;gap:4px;font-variant-numeric:tabular-nums}.latest-date span{font-size:12px;color:var(--muted)}.latest-date strong{font-size:20px}.today-scores{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:20px;background:var(--surface);overflow:hidden;margin-top:24px}.today-scores article{padding:26px 28px}.today-scores article+article{border-left:1px solid var(--line)}.score-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.score-heading h2{font-size:17px}.score-heading span,.score-source{font-size:11px;color:var(--muted)}.today-score{font-size:64px;line-height:1.15;font-weight:650;letter-spacing:-.06em;margin:20px 0;font-variant-numeric:tabular-nums}.today-score small{font-size:16px;letter-spacing:0;font-weight:400;color:var(--muted);margin-left:8px}.score-comparison{font-size:12px;color:var(--muted)}.score-comparison strong{color:var(--ink)}.score-source{margin-top:4px}.hint{margin-top:10px}.trend-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:20px}.trend-heading h2{font-size:20px}.trend-heading .sub{font-size:13px}.overview-trend{padding:26px;border-radius:20px}.overview-links{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:28px 0}.overview-links a{padding:22px 0;border-top:1px solid var(--line)}.overview-links h2{font-size:19px}.overview-links p{color:var(--muted);font-size:13px;margin-top:8px}.overview-links a:hover h2{color:#9a3412}.overview-empty{padding:30px 0;color:var(--muted)}.overview-empty a{text-decoration:underline}
  @media(max-width:600px){.page{padding-top:24px}.overview-heading{align-items:flex-start}.overview-heading h1{font-size:28px}.latest-date strong{font-size:14px}.overview-heading p{font-size:13px;max-width:190px}.today-scores article{padding:18px 12px}.score-heading span{display:none}.score-heading h2{font-size:14px}.today-score{font-size:40px;margin:16px 0}.today-score small{display:block;font-size:11px;margin:4px 0}.score-comparison{font-size:11px;line-height:1.6}.score-source{font-size:10px}.overview-trend{padding:20px 12px}.overview-links{gap:16px}.latest-date{padding-top:4px}}
</style>
