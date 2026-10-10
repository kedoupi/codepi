<script lang="ts">
  import { onMount } from "svelte";
  import { fetchAi, stripMarkdown, type AiResponse } from "../lib/ai";
  import {
    createDonutChart,
    createGaugeChart,
    createRadarChart,
    createSRAChart,
    createStepsChart,
  } from "../lib/charts";
  import { sortDays } from "../lib/format";
  import { t, type Locale } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";
  import { isDevLoginAllowed, type DailyResponse, type Day, type MeResponse } from "../lib/types";
  import { computeViewModel } from "../lib/view-model";
  import AiDrawer from "./AiDrawer.svelte";
  import ChartCanvas from "./ChartCanvas.svelte";
  import ChromeHeader from "./ChromeHeader.svelte";
  import ContribBars from "./ContribBars.svelte";
  import HeatmapPanel from "./HeatmapPanel.svelte";
  import SummaryCards from "./SummaryCards.svelte";

  let {
    me,
    locale,
    onUnauthorized,
  }: {
    me: MeResponse;
    locale: Locale;
    onUnauthorized: () => void;
  } = $props();

  const API = "/api/me/daily?days=90";

  let allDays = $state<Day[]>([]);
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

  const vm = $derived(allDays.length ? computeViewModel(allDays, rangeDays) : null);

  const gaugeBuild = $derived(
    vm
      ? (el: HTMLCanvasElement) => {
          void resizeTick;
          return createGaugeChart(el, vm.readyScore);
        }
      : null,
  );
  const donutBuild = $derived(
    vm
      ? (el: HTMLCanvasElement) => {
          void resizeTick;
          return createDonutChart(el, vm.donutHigh, vm.donutMid, vm.donutLow, narrow);
        }
      : null,
  );
  const radarBuild = $derived(
    vm
      ? (el: HTMLCanvasElement) => {
          void resizeTick;
          return createRadarChart(el, vm.radarVals, narrow);
        }
      : null,
  );
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
  const stepsBuild = $derived(
    vm
      ? (el: HTMLCanvasElement) => {
          void resizeTick;
          return createStepsChart(
            el,
            vm.days,
            vm.labels,
            vm.stepsSeries,
            vm.stepsAvg,
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
    if (vm && !statusErr) status = vm.statusText;
  });

  async function load() {
    try {
      status = t(locale, "loadingOura");
      statusErr = false;
      const res = await fetch(API, { cache: "no-store", credentials: "include" });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = (await res.json()) as DailyResponse;
      if (!data || !data.ok || !Array.isArray(data.days)) throw new Error("响应格式异常");
      allDays = sortDays(data.days);
    } catch (err) {
      console.error(err);
      statusErr = true;
      status = "加载失败：" + (err instanceof Error ? err.message : String(err));
    }
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
      const nowLabel = data.now && data.now.label ? data.now.label : "";
      aiStatus =
        "近 " +
        (data.days || rangeDays) +
        " 天 · " +
        (data.from || "") +
        " → " +
        (data.to || "") +
        (nowLabel ? " · 现在 " + nowLabel : "") +
        " · " +
        (data.model || "MiniMax-M3");
      if (data.report && typeof data.report === "object") {
        aiReport = data;
        aiFallback = "";
      } else {
        aiFallback = stripMarkdown(String(data.text || ""));
      }
    } catch (err) {
      console.error(err);
      aiStatusErr = true;
      aiStatus = "分析失败：" + (err instanceof Error ? err.message : String(err));
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
  <svg width="0" height="0" aria-hidden="true" style="position:absolute">
    <defs>
      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f97316" stop-opacity="0.28" />
        <stop offset="100%" stop-color="#f97316" stop-opacity="0" />
      </linearGradient>
    </defs>
  </svg>

  <ChromeHeader
    isDev={isDevLoginAllowed(me.allowDevLogin) && me.source === "dev"}
    {locale}
    active="/"
    showAi
    {aiBusy}
    onAi={openAi}
    onLogout={logout}
  />

  <main class="wrap page" style="max-width:var(--page-max);margin-left:auto;margin-right:auto">
    <div class="kicker">OURA · HEALTH <span class="ver-chip">版 1735</span></div>
    <div class="hero-row">
      <div>
        <h1>{t(locale, "dashTitle")}</h1>
        <p class="sub">{vm?.rangeLabel ?? t(locale, "dashSubFallback")}</p>
      </div>
      <div class="range" role="group" aria-label={t(locale, "rangeAria")} data-on={String(rangeDays)}>
        <span class="range-thumb" aria-hidden="true"></span>
        <button type="button" class:on={rangeDays === 7} onclick={() => setRange(7)}>{t(locale, "rangeWeek")}</button>
        <button type="button" class:on={rangeDays === 30} onclick={() => setRange(30)}>30</button>
        <button type="button" class:on={rangeDays === 90} onclick={() => setRange(90)}>90</button>
      </div>
    </div>
    <div class="status" class:err={statusErr}>{status}</div>

    <section class="cards insight-entry-row">
      <a
        class="card insight-entry"
        href="/insights"
        onclick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          goto("/insights");
        }}
      >
        <div class="label">{t(locale, "insightEntryTitle")}</div>
        <div class="score insight-entry-lead">{t(locale, "insightEntryLead")}</div>
        <div class="meta">{t(locale, "insightEntryMeta")}</div>
        <span class="delta">{t(locale, "notMedical")} / {t(locale, "notMedicalEn")}</span>
      </a>
    </section>

    <SummaryCards cards={vm?.cards ?? []} />

    <section class="stack">
      <div class="panel tech">
        <h2>睡眠 / 准备度 / 活动趋势</h2>
        <p class="takeaway">{@html vm?.takeSRA ?? "加载中…"}</p>
        <p class="hint">浅橙带=周六日 · 刻度带「六/日」· 虚线为准备度均值</p>
        <div class="chart-well"><div class="chart-box"><ChartCanvas build={sraBuild} /></div></div>
      </div>
    </section>

    <section class="viz-row">
      <div class="panel tech panel-gauge">
        <h2>准备度仪表</h2>
        <p class="takeaway">{@html vm?.takeGauge ?? "加载中…"}</p>
        <p class="hint">{vm?.gaugeHint ?? ""}</p>
        <div class="chart-well gauge-well">
          <div class="chart-box gauge-ring">
            <ChartCanvas build={gaugeBuild} />
            <div class="gauge-center">
              <div class="gauge-score">{vm?.gaugeScore ?? "—"}</div>
              <div class="gauge-sub">{vm?.gaugeSub ?? ""}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="panel tech">
        <h2>步数档位分布</h2>
        <p class="takeaway">{@html vm?.takeDonut ?? "加载中…"}</p>
        <p class="hint">按步数档位统计所选区间天数</p>
        <div class="chart-well"><div class="chart-box pair"><ChartCanvas build={donutBuild} /></div></div>
      </div>
    </section>

    <section class="stack">
      <div class="panel tech">
        <h2>步数</h2>
        <p class="takeaway">{@html vm?.takeSteps ?? "加载中…"}</p>
        <p class="hint">橙柱高于均值 · 浅柱低于均值 · 虚线为日均</p>
        <div class="chart-well"><div class="chart-box"><ChartCanvas build={stepsBuild} /></div></div>
      </div>
    </section>

    <section class="viz-row">
      <div class="panel tech">
        <h2>准备度贡献雷达</h2>
        <p class="takeaway">{@html vm?.takeRadar ?? "加载中…"}</p>
        <p class="hint">{vm?.radarHint ?? "最新一日贡献项"}</p>
        <div class="chart-well"><div class="chart-box pair"><ChartCanvas build={radarBuild} /></div></div>
      </div>
      <HeatmapPanel
        title={vm?.heatTitle ?? "准备度热力"}
        takeaway={vm?.takeHeat ?? "加载中…"}
        hint={vm?.heatHint ?? "所选区间每日 readiness"}
        strip={vm?.heatStrip ?? true}
        wdays={vm?.heatWdays ?? ["一", "二", "三", "四", "五", "六", "日"]}
        cells={vm?.heatCells ?? []}
      />
    </section>

    <section class="avgs">
      <div class="panel">
        <h2>区间均值</h2>
        <p class="takeaway">{vm?.takeAvg ?? "加载中…"}</p>
        <p class="hint">{vm?.avgHint ?? "当前所选范围"}</p>
        <table class="avg-table">
          <thead><tr><th>指标</th><th>均值</th></tr></thead>
          <tbody>
            {#each vm?.avgRows ?? [] as row (row[0])}
              <tr><td>{row[0]}</td><td>{row[1]}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <h2>对比参考</h2>
        <p class="takeaway">{vm?.takeCmp ?? "加载中…"}</p>
        <p class="hint">30 天 vs 90 天</p>
        <table class="avg-table">
          <thead><tr><th>指标</th><th>30 天</th><th>90 天</th></tr></thead>
          <tbody>
            {#each vm?.cmpRows ?? [] as row (row[0])}
              <tr><td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="insights">
      <h2>简要洞察</h2>
      <ul>
        {#if statusErr}
          <li>无法拉取数据，请稍后刷新。CORS/网络异常时也会出现此提示。</li>
        {:else if vm?.insights.length}
          {#each vm.insights as item, i (`ins-${i}`)}
            <li>{item}</li>
          {/each}
        {:else}
          <li>{allDays.length ? "数据不足，暂无洞察。" : "加载中…"}</li>
        {/if}
      </ul>
    </section>

    <section class="contrib-grid">
      <div class="panel">
        <h2>最新睡眠贡献项</h2>
        <p class="takeaway">{vm?.takeSleepContrib ?? "加载中…"}</p>
        <p class="hint">{vm?.sleepContribDate ?? "—"}</p>
        <ContribBars rows={vm?.sleepBars ?? []} />
      </div>
      <div class="panel">
        <h2>最新准备度贡献项</h2>
        <p class="takeaway">{vm?.takeReadyContrib ?? "加载中…"}</p>
        <p class="hint">{vm?.readyContribDate ?? "—"}</p>
        <ContribBars rows={vm?.readyBars ?? []} />
      </div>
    </section>

    <footer class="foot">
      <span>{t(locale, "footData")}</span>
      <span class="ver-chip">build 20260914-1728-weekend</span>
    </footer>
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
