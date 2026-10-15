<script lang="ts">
  import { onMount } from "svelte";
  import { api, RequestError, errorText } from "../lib/api";
  import { fetchAi, stripMarkdown, type AiResponse } from "../lib/ai";
  import { t, type Locale } from "../lib/i18n";
  import { isDevLoginAllowed, type DailyResponse, type Day, type MeResponse, type SyncInfo } from "../lib/types";
  import { dateWindow, duration, finite, readSleep, scoreDelta, type SleepRecord } from "../lib/health";
  import { historicalHrvRange, journalColors, journalData, latestPoint, readinessColor, scoreKeys, scorePoints, type ScoreKey } from "../lib/journal";
  import AiDrawer from "./AiDrawer.svelte";
  import ChromeHeader from "./ChromeHeader.svelte";
  import JournalChart from "./JournalChart.svelte";
  import "../journal.css";

  let { me, locale, onUnauthorized, onLogout }: { me: MeResponse; locale: Locale; onUnauthorized: () => void; onLogout: () => void } = $props();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const label = (key: ScoreKey) => key === "sleep" ? text("睡眠", "Sleep") : key === "readiness" ? text("准备度", "Readiness") : text("活动", "Activity");
  const end = dateWindow(1).to;
  let allDays = $state<Day[]>([]);
  let sleeps = $state<SleepRecord[]>([]);
  let loading = $state(true);
  let sleepLoading = $state(true);
  let error = $state("");
  let errorCode = $state("");
  let sleepError = $state("");
  let sleepWarning = $state("");
  let sleepVerified = $state(false);
  let sleepSyncedAt = $state<string | null>(null);
  let syncState = $state<SyncInfo>();
  let syncBusy = $state(false);
  let detailDays = $state(14);
  let rangeDays = $state(7);
  let selectedDate = $state("");
  let mounted = true;
  let sleepRevision = 0;
  const model = $derived(journalData(allDays, sleeps, end));
  const latest = $derived(model.latest);
  const lastSleep = $derived(latestPoint(model.sleep));
  const lastHrv = $derived(latestPoint(model.hrv));
  const lastSteps = $derived(latestPoint(model.steps));
  const baseline = $derived(lastHrv ? historicalHrvRange(model.hrv, lastHrv.date) : null);
  const selected = $derived(model.recent.find(day => day.date === selectedDate));
  const observation = $derived.by(() => {
    if (loading) return text("正在整理你的近期记录", "Gathering your recent records");
    if (!latest) return text("从第一份记录，开始认识自己的节奏", "Your rhythm starts with the first record");
    const item = model.comparison;
    if (!item?.delta) return text("记录正在积累，先看看最近的变化", "Your history is growing. Start with recent changes.");
    if (Math.abs(item.delta.value) < 3) return text("近期评分变化不大，看看每天的起伏", "Scores are close to recent averages. Explore the daily rhythm.");
    return `${label(item.key)}${item.delta.value > 0 ? text("评分高于近期均值", " score is above its recent average") : text("评分低于近期均值", " score is below its recent average")}`;
  });
  const observationDetail = $derived.by(() => {
    const item = model.comparison;
    if (!latest || !item?.delta) return text("积累至少 3 天有效评分后，展示与此前一周的比较。", "A comparison needs at least 3 valid days in the preceding week.");
    const delta = `${item.delta.value > 0 ? "+" : ""}${item.delta.value}`;
    return locale === "zh" ? `${latest.date} · ${label(item.key)}较此前 7 天均值 ${delta} 分，基于 ${item.delta.count} 天有效记录。`
      : `${latest.date} · ${label(item.key)} ${delta} vs. the prior 7-day mean, based on ${item.delta.count} recorded days.`;
  });
  const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale === "zh" ? "zh-CN" : "en", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const time = (value?: string | null) => value ? new Date(value).toLocaleString(locale === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const formatNumber = (value?: number | null) => finite(value) ? value.toLocaleString(locale === "zh" ? "zh-CN" : "en", { maximumFractionDigits: 1 }) : "—";

  function handleError(err: unknown) {
    if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
    error = errorText(err, locale);
    errorCode = err instanceof RequestError ? err.code : "";
  }
  async function load() {
    loading = true;
    error = "";
    errorCode = "";
    try {
      const data = await api<DailyResponse>("/api/me/daily?days=90");
      if (!data.ok || !Array.isArray(data.days)) throw new RequestError("invalid_response", 502);
      if (!mounted) return;
      allDays = data.days;
      syncState = data.sync;
    } catch (err) { if (mounted) handleError(err); }
    finally { if (mounted) loading = false; }
  }
  async function loadSleep() {
    if (!me.capabilities?.personal) { sleepLoading = false; return; }
    const revision = ++sleepRevision;
    sleepLoading = true;
    sleepError = "";
    const { from, to } = dateWindow(30, end);
    try {
      const result = await readSleep(from, to);
      if (!mounted || revision !== sleepRevision) return;
      sleeps = result.records;
      sleepVerified = result.sync.window_verified;
      sleepSyncedAt = result.sync.synced_at;
      sleepWarning = result.sync.error ? errorText(new RequestError(result.sync.error, 0), locale) : "";
    } catch (err) {
      if (!mounted || revision !== sleepRevision) return;
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") onUnauthorized();
      else sleepError = errorText(err, locale);
    } finally { if (mounted && revision === sleepRevision) sleepLoading = false; }
  }
  async function syncNow() {
    if (syncBusy) return;
    syncBusy = true;
    error = "";
    errorCode = "";
    try {
      const data = await api<DailyResponse>("/api/me/sync?days=90", { method: "POST" });
      if (!data.ok || !Array.isArray(data.days)) throw new RequestError("invalid_response", 502);
      if (!mounted) return;
      allDays = data.days;
      syncState = data.sync;
      await loadSleep();
    } catch (err) { if (mounted) handleError(err); }
    finally { if (mounted) syncBusy = false; }
  }
  onMount(() => {
    void load();
    void loadSleep();
    return () => { mounted = false; sleepRevision++; };
  });

  let aiOpen = $state(false);
  let aiBusy = $state(false);
  let aiStatus = $state("");
  let aiStatusErr = $state(false);
  let aiReport = $state<AiResponse | null>(null);
  let aiFallback = $state("");
  async function openAi() {
    aiOpen = true;
    if (aiBusy) return;
    aiBusy = true;
    aiStatus = "";
    aiStatusErr = false;
    aiReport = null;
    aiFallback = "";
    try {
      const data = await fetchAi(rangeDays);
      if (!mounted) return;
      aiStatus = `${data.from ?? ""} — ${data.to ?? ""} · ${data.model || text("规则解读", "Rule-based review")}`;
      if (data.report && typeof data.report === "object") aiReport = data;
      else aiFallback = stripMarkdown(String(data.text || ""));
    } catch (err) { if (mounted) { aiStatusErr = true; aiStatus = errorText(err, locale); } }
    finally { if (mounted) aiBusy = false; }
  }
</script>

<div id="dash-view" class="journal">
  <ChromeHeader journal {locale} active="/" isDev={isDevLoginAllowed(me.allowDevLogin) && me.source === "dev"}
    {onLogout} />
  <a class="journal-skip" href="#journal-main">{text("跳到每日简报", "Skip to daily journal")}</a>
  <main id="journal-main" class="journal-main" tabindex="-1">
    <div class="journal-meta"><span>{longDate(end)}</span><span class="journal-edition">{text("我的每日简报", "Your daily journal")}</span></div>
    {#if error}<div class="journal-notice" role="alert"><span>{error}</span><button disabled={loading} onclick={load}>{text("重试", "Retry")}</button>{#if errorCode === "reconnect_required"}<a href="/api/auth/oura/start">{text("重新连接 Oura", "Reconnect Oura")}</a>{/if}</div>{/if}
    {#if syncState?.stale || (latest && latest.date !== end)}<div class="journal-notice" role="status">{text("正在显示最近可用评分", "Showing the latest available scores")} · {latest?.date ?? "—"}{#if syncState?.stale} · {text("同步暂未完成", "Sync is incomplete")}{/if}{#if syncState?.error === "reconnect_required"}<a href="/api/auth/oura/start">{text("重新连接 Oura", "Reconnect Oura")}</a>{/if}</div>{/if}

    <div class="journal-lead">
      <section class="journal-story" aria-labelledby="journal-title">
        <h1 id="journal-title">{text("今天，从自己的节奏开始。", "A day in your own rhythm.")}</h1>
        <div class="journal-observation" aria-live="polite" aria-busy={loading}>
          <p class="journal-eyebrow">{text("记录中的变化", "FROM YOUR RECORDS")}</p>
          <h2>{observation}</h2>
          <p class="journal-description">{observationDetail}</p>
          <a class="journal-link" href="#score-history" onclick={() => { const details = document.querySelector<HTMLDetailsElement>("#score-history"); if (details) details.open = true; }}>{text("查看评分依据", "Explore the score history")}</a>
        </div>
        <section class="today-scores journal-scores" aria-label={text("最新一日官方评分", "Latest daily official scores")}>
          {#each scoreKeys as key}
            {@const delta = latest ? scoreDelta(model.calendar, latest, key) : null}
            <article>
              <div class="journal-score-label"><h3>{label(key)}</h3><span>{text("Oura 评分", "Oura score")}</span></div>
              <div class="journal-score-body"><strong>{formatNumber(latest?.[key]?.score)}</strong><div class="journal-spark"><JournalChart compact height={48} {locale} label={`${label(key)} ${text("近 7 天评分趋势", "7-day score trend")}`} series={[{ label: label(key), color: journalColors[key], points: scorePoints(model.calendar, key).filter(p => p.date <= (latest?.date ?? end)).slice(-7) }]} /></div></div>
              <p>{delta ? `${delta.value > 0 ? "+" : ""}${delta.value} ${text("较前 7 天均值", "vs. prior 7 days")}` : text("记录不足，暂不比较", "Not enough data to compare")}</p>
            </article>
          {/each}
        </section>
        <p class="journal-caption">{text("评分日期", "Score date")} {latest?.date ?? "—"} · {text("评分与差值用于记录变化，不作健康判断。", "Scores describe changes, not a health assessment.")}</p>
      </section>

      <section class="journal-hrv" aria-labelledby="hrv-title" aria-busy={sleepLoading}>
        <div class="journal-section-top"><h2 id="hrv-title">{text("主睡眠 HRV", "Main-sleep HRV")}</h2><a class="journal-link" href="/sleep">{text("查看睡眠", "Explore sleep")}</a></div>
        <p class="journal-description">{text("记录每晚的变化，与自己的历史对照。", "See how each night compares with your own history.")}</p>
        <div class="journal-hrv-value"><strong>{formatNumber(lastHrv?.value)}<small> ms</small></strong><span>{lastHrv?.date ?? text("等待主睡眠记录", "Awaiting main-sleep records")}</span></div>
        {#if !me.capabilities?.personal}<p class="journal-empty">{text("详细睡眠目前仅向个人工作区开放。", "Detailed sleep is available to the personal workspace.")}</p>
        {:else if sleepError}<div class="journal-empty" role="alert"><p>{sleepError}</p><button onclick={loadSleep}>{text("重新读取睡眠", "Retry sleep records")}</button></div>
        {:else if sleepLoading && !sleeps.length}<p class="journal-empty" role="status">{text("正在读取主睡眠记录…", "Loading main-sleep records…")}</p>
        {:else}<JournalChart {locale} label={text("近 7 天主睡眠 HRV", "Main-sleep HRV over the last 7 days")} unit="ms" height={160} band={baseline} series={[{ label: text("主睡眠 HRV", "Main-sleep HRV"), color: journalColors.hrv, points: model.hrv.slice(-7) }]} />{/if}
        <p class="journal-caption">{baseline ? text(`参考带基于此前 ${baseline.count} 天记录的中间 50%，不代表医学正常范围。`, `Reference band: middle 50% of ${baseline.count} earlier days, not a medical normal range.`) : text("此前至少 14 天有效主睡眠 HRV，才显示个人参考带。", "A personal reference band needs 14 earlier days of main-sleep HRV.")}</p>
      </section>
    </div>

    <div class="journal-section-tools"><span>{text("把变化放回日常", "THE EVERYDAY PATTERN")}</span><div class="journal-period" role="group" aria-label={text("睡眠与活动日期范围", "Sleep and activity date range")}>{#each [7, 14, 30] as n}<button aria-pressed={detailDays === n} onclick={() => { detailDays = n; }}>{n} {text("天", "days")}</button>{/each}</div></div>
    <div class="journal-history-grid">
      <section class="journal-sleep sleep-preview" aria-labelledby="sleep-history-title" aria-busy={sleepLoading}>
        <div class="journal-section-top"><h2 id="sleep-history-title">{text("睡眠，是否回到你的节奏？", "Finding your sleep rhythm")}</h2><div class="journal-metric"><strong>{lastSleep ? duration(lastSleep.value! * 3600, locale) : "—"}</strong><span>{lastSleep?.date ?? text("暂无睡眠记录", "No sleep records")}</span></div></div>
        <p class="journal-description">{text(`近 ${detailDays} 天每日主要睡眠时长`, `Main sleep duration over ${detailDays} days`)}</p>
        {#if sleepError}<div class="journal-empty" role="alert"><p>{sleepError}</p><button onclick={loadSleep}>{text("重试", "Retry")}</button></div>
        {:else if !sleeps.length}<div class="journal-empty"><p>{sleepLoading ? text("正在读取睡眠记录…", "Loading sleep records…") : !me.capabilities?.personal ? text("详细睡眠仅向个人工作区开放。", "Detailed sleep requires personal access.") : sleepVerified ? text("已检查近 30 天，暂无睡眠记录。", "The last 30 days were checked; no sleep records.") : text("近 30 天还没有保存的详细睡眠记录。", "No detailed sleep records saved in the last 30 days.")}</p><a class="journal-link" href="/sleep">{text("查看睡眠与同步", "Open sleep and sync")}</a></div>
        {:else}<JournalChart {locale} label={text(`近 ${detailDays} 天主要睡眠时长`, `Main sleep duration over ${detailDays} days`)} kind="bar" unit={text("小时", "hours")} average series={[{ label: text("主要睡眠时长", "Main sleep duration"), color: journalColors.sleep, points: model.sleep.slice(-detailDays) }]} />{/if}
        <p class="journal-caption">{text("优先取主睡眠；未标记时取最长一段，不含其他小睡。空缺不是 0。", "Main sleep, or the longest period if unmarked; other naps excluded. Gaps are not zero.")} <a href="/sleep">{text("睡眠详情", "Sleep details")}</a></p>
        {#if sleepWarning}<p class="journal-notice" role="status">{sleepWarning}</p>{/if}
      </section>
      <section class="journal-activity" aria-labelledby="steps-title">
        <div class="journal-section-top"><h2 id="steps-title">{text("活动的起伏", "The rhythm of movement")}</h2><div class="journal-metric"><strong>{formatNumber(lastSteps?.value)} <small>{text("步", "steps")}</small></strong><span>{lastSteps?.date ?? "—"}</span></div></div>
        <p class="journal-description">{text(`近 ${detailDays} 天每日步数，记录日常活动节奏。`, `Daily steps over ${detailDays} days.`)}</p>
        <JournalChart {locale} label={text(`近 ${detailDays} 天步数`, `Steps over ${detailDays} days`)} kind="bar" unit={text("步", "steps")} series={[{ label: text("步数", "Steps"), color: "#7e9276", points: model.steps.slice(-detailDays) }]} />
        <p class="journal-caption">{text("当天步数可能继续更新；橙色标出最近一条有效记录。", "Today's steps may still change. Orange marks the latest recorded day.")}</p>
      </section>
    </div>

    <section class="journal-calendar" aria-labelledby="calendar-title">
      <div><h2 id="calendar-title">{text("过去 30 天的准备度", "Your last 30 days of readiness")}</h2><p class="journal-description">{text("每天一个色块，选中查看数值。", "One square per day. Select a day to inspect it.")}</p></div>
      <div class="journal-calendar-chart">
        <div class="journal-calendar-cells" role="group" aria-label={text("每日准备度", "Daily readiness")}>{#each model.recent as day}<button style:background={readinessColor(day.readiness?.score ?? null)} class:missing={!finite(day.readiness?.score)} class:chosen={selectedDate === day.date} aria-pressed={selectedDate === day.date} aria-label={`${day.date}: ${formatNumber(day.readiness?.score)}`} title={`${day.date}: ${formatNumber(day.readiness?.score)}`} onclick={() => { selectedDate = day.date; }}>{!finite(day.readiness?.score) ? "—" : ""}</button>{/each}</div>
        <div class="journal-calendar-scale"><span>{model.recent[0]?.date}</span><span>{text("浅 → 深：评分低 → 高 · 空框：缺失", "Light to dark: lower to higher · Empty: missing")}</span><span>{end}</span></div>
        <p class="journal-calendar-selection" aria-live="polite">{selected ? `${selected.date} · ${text("准备度", "Readiness")} ${formatNumber(selected.readiness?.score)} / 100` : text("选择一天，查看它在这段时间里的位置。", "Select a day to inspect its recorded score.")}</p>
      </div>
      <a class="journal-link" href="/compare">{text("比较两个区间", "Compare periods")}</a>
    </section>

    <details id="score-history" class="journal-score-history">
      <summary>{text("展开评分趋势与数据依据", "Explore score trends and evidence")}</summary>
      <div class="journal-trend-top"><div><h2>{text("睡眠 · 准备度 · 活动", "Sleep · Readiness · Activity")}</h2><p class="sub">{rangeDays} {text("天评分趋势", "days of scores")}</p></div><div class="range" role="group" aria-label={t(locale, "rangeAria")} data-on={String(rangeDays)}><span class="range-thumb" aria-hidden="true"></span>{#each [7, 30, 90] as n}<button aria-pressed={rangeDays === n} class:on={rangeDays === n} onclick={() => { rangeDays = n; }}>{n}</button>{/each}</div></div>
      <JournalChart {locale} label={text("官方评分趋势", "Official score history")} unit={text("分", "score")} height={240} series={scoreKeys.map(key => ({ label: label(key), color: journalColors[key], points: scorePoints(model.calendar.slice(-rangeDays), key) }))} />
      <div class="journal-analysis-links"><a class="journal-link" href="/insights">{text("阅读本周解读", "Read this week's review")}</a>{#if me.capabilities?.analysis}<button onclick={openAi}>{text("AI 分析", "AI analysis")} · {rangeDays} {text("天", "days")}</button>{/if}</div>
    </details>

    <footer class="journal-footer"><div class="journal-sync-line" aria-live="polite"><span>{loading ? text("正在读取评分…", "Loading scores…") : text("评分同步于", "Scores synced")} {loading ? "" : time(syncState?.syncedAt)}</span><button disabled={syncBusy || loading} onclick={syncNow}>{syncBusy ? text("同步中…", "Syncing…") : text("刷新评分", "Refresh scores")}</button><a href="/settings">{text("数据与连接", "Data & connections")}</a></div><details><summary>{text("数据来源与覆盖情况", "Sources and coverage")}</summary><p>{text("Oura 官方评分", "Oura official scores")} · {syncState?.populatedDays ?? 0}/{syncState?.windowDays ?? 90} {text("天有记录", "recorded days")} · {text("详细睡眠读取已保存记录，同步于", "Sleep reads saved records, synced")} {time(sleepSyncedAt)}</p></details><p>{text("供个人观察与记录，不用于诊断。", "For personal observation and journaling, not diagnosis.")} · {t(locale, "company")}</p></footer>
  </main>
  <AiDrawer {locale} open={aiOpen} {rangeDays} thinking={aiBusy} status={aiStatus} statusErr={aiStatusErr} report={aiReport} fallbackText={aiFallback} onClose={() => { aiOpen = false; }} />
</div>
