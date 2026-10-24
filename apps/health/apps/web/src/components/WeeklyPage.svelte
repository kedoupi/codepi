<script lang="ts">
  import { onMount } from "svelte";
  import { api, RequestError, errorText } from "../lib/api";
  import SyncStatus from "./SyncStatus.svelte";
  import type { WeeklyPayload } from "../lib/reports";
  import { t, type Locale } from "../lib/i18n";
  import { goto } from "../lib/router.svelte";
  import type { DailyResponse, MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";
  import MiniBars from "./MiniBars.svelte";
  import MiniLine from "./MiniLine.svelte";
  import DurationValue from "./DurationValue.svelte";
  import { watchCalendarDay } from "../lib/calendar";
  import {
    duration, readSleep, readSpo2, readStress, readTags, sleepForDay,
    type SleepRecord, type Spo2Day, type StressDay, type TagRecord,
  } from "../lib/health";
  import {
    compareSeries, daysOf, mainSleepSeries, nightlySeries, peakDates, rollingRanges, seriesOf, stressSeries, tagsForDay, tagLabel,
  } from "../lib/insights-model";

  let { me, locale, onUnauthorized, onLogout }: {
    me: MeResponse; locale: Locale; onUnauthorized: () => void; onLogout: () => void;
  } = $props();

  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  let end = $state(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
  const ranges = $derived(rollingRanges(end));
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const shortDate = (day: string) => day.slice(5).replace("-", "/");
  function shiftEnd(offset: number) {
    const next = new Date(Date.parse(`${end}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
    if (next > today()) return;
    end = next; sleeps = []; stress = []; tags = []; void load();
  }

  let payload = $state<WeeklyPayload | null>(null);
  let days = $state<DailyResponse["days"]>([]);
  let sleeps = $state<SleepRecord[]>([]);
  let stress = $state<StressDay[]>([]);
  let spo2 = $state<Spo2Day[]>([]);
  let tags = $state<TagRecord[]>([]);
  let loading = $state(true);
  let status = $state("");
  let statusErr = $state(false);
  let needsReconnect = $state(false);
  let disposed = false;
  let revision = 0;

  const sleepSeries = $derived(nightlySeries(sleeps, ranges.current, record => record.total_sleep_duration));
  const prevSleepSeries = $derived(nightlySeries(sleeps, ranges.previous, record => record.total_sleep_duration));
  const sleepCompare = $derived(compareSeries(
    sleepSeries.map(point => ({ date: point.date, value: point.value === null ? null : point.value / 60 })),
    prevSleepSeries.map(point => ({ date: point.date, value: point.value === null ? null : point.value / 60 })),
  ));
  const hrvSeries = $derived(mainSleepSeries(sleeps, ranges.current, record => record.average_hrv));
  const prevHrvSeries = $derived(mainSleepSeries(sleeps, ranges.previous, record => record.average_hrv));
  const hrvCompare = $derived(compareSeries(hrvSeries, prevHrvSeries));
  const recoverySeries = $derived(stressSeries(stress, ranges.current, "recovery_high"));
  const prevRecoverySeries = $derived(stressSeries(stress, ranges.previous, "recovery_high"));
  const stressDaySeries = $derived(stressSeries(stress, ranges.current, "stress_high"));
  const prevStressDaySeries = $derived(stressSeries(stress, ranges.previous, "stress_high"));
  const recoveryCompare = $derived(compareSeries(recoverySeries, prevRecoverySeries));
  const stressCoverage = $derived({ cur: seriesOf(recoverySeries).count, prev: seriesOf(prevRecoverySeries).count });
  const longNights = $derived(peakDates(sleepSeries.map(point => ({ date: point.date, value: point.value })), 2));

  const headline = $derived.by(() => {
    if (!sleepCompare && !hrvCompare) return text("记录还在积累，先看已有的变化", "Records are building; start with what is available");
    const parts: string[] = [];
    if (sleepCompare && Math.abs(sleepCompare.delta) >= 5) {
      parts.push(sleepCompare.delta > 0
        ? text("睡得更久", "More sleep")
        : text("睡得更少", "Less sleep"));
    }
    if (hrvCompare && Math.abs(hrvCompare.delta) >= 1) {
      parts.push(hrvCompare.delta > 0
        ? text("夜间 HRV 有所上移", "overnight HRV moved higher")
        : text("夜间 HRV 有所下移", "overnight HRV moved lower"));
    }
    return parts.length ? parts.join(text("，", ", ")) : text("这一周与此前 7 天接近", "This week is close to the preceding 7 days");
  });

  const coverageLine = $derived([
    text(`睡眠 ${seriesOf(sleepSeries).count}/7 晚`, `sleep ${seriesOf(sleepSeries).count}/7 nights`),
    text(`HRV ${seriesOf(hrvSeries).count}/7 晚`, `HRV ${seriesOf(hrvSeries).count}/7 nights`),
    text(`压力与恢复 ${stressCoverage.cur}/7 天`, `stress & recovery ${stressCoverage.cur}/7 days`),
  ].join(" · "));

  function fmtMinutes(minutes: number | null): string {
    return minutes === null ? "—" : duration(minutes * 60, locale);
  }

  async function load() {
    const current = ++revision;
    loading = true;
    statusErr = false;
    needsReconnect = false;
    status = t(locale, "loading");
    try {
      const data = await api<WeeklyPayload>("/api/me/insights/weekly");
      if (disposed || current !== revision) return;
      payload = data;
      status = "";
      // Detailed panels are best-effort; the summary stays if a collection is unavailable.
      void loadDetails(current);
    } catch (err) {
      if (disposed || current !== revision) return;
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      needsReconnect = err instanceof RequestError && err.code === "reconnect_required";
      statusErr = true;
      status = errorText(err, locale);
    } finally {
      if (!disposed && current === revision) loading = false;
    }
  }

  async function loadDetails(current: number) {
    if (!me.capabilities?.personal) return;
    const from = ranges.previous.from;
    const to = ranges.current.to;
    const detail = async <T,>(read: () => Promise<T[]>): Promise<T[]> => {
      try { return await read(); } catch { return []; }
    };
    const [sleepRows, daily, stressRows, spo2Rows, tagRows] = await Promise.all([
      detail(() => readSleep(from, to).then(result => result.records)),
      api<DailyResponse>("/api/me/daily?days=90").then(result => result.days ?? []).catch(() => []),
      detail(() => readStress(from, to)),
      detail(() => readSpo2(from, to)),
      detail(() => readTags(from, to)),
    ]);
    if (disposed || current !== revision) return;
    sleeps = sleepRows;
    days = daily;
    stress = stressRows;
    spo2 = spo2Rows;
    tags = tagRows;
  }

  onMount(() => {
    void load();
    const stop = watchCalendarDay(day => { end = day; payload = null; sleeps = []; void load(); });
    return () => { stop(); disposed = true; revision++; };
  });
</script>

<div id="dash-view">
  <ChromeHeader isDev={me.allowDevLogin === true && me.source === "dev"} {locale} active="/insights" {onLogout} />
  <main class="wrap page health-report weekly-page">
    <header class="report-heading">
      <h1>{text("7 天解读", "7-day reading")}</h1>
      <div class="report-date">
        <div class="date-control"><button aria-label={text("前 7 天", "Previous 7 days")} onclick={() => shiftEnd(-7)}>‹</button><label class="range-label"><span>{shortDate(ranges.current.from)} — {shortDate(ranges.current.to)}</span><input type="date" aria-label={text("解读截止日期", "Reading end date")} max={today()} bind:value={end} onchange={() => { sleeps = []; stress = []; tags = []; void load(); }} /></label><button aria-label={text("后 7 天", "Next 7 days")} disabled={end >= today()} onclick={() => shiftEnd(7)}>›</button></div>
        <small>{text("对照", "vs")} {shortDate(ranges.previous.from)} — {shortDate(ranges.previous.to)} · {text("北京时间", "Asia/Shanghai")}</small>
      </div>
    </header>
    {#if status}<div class="status" class:err={statusErr} role={statusErr ? "alert" : "status"} aria-live={statusErr ? "assertive" : "polite"}>{status}</div>{/if}
    {#if statusErr}<button class="ai-btn" onclick={load}>{text("重试", "Retry")}</button>{#if needsReconnect}<a class="ai-btn" href="/api/auth/oura/start">{text("重新连接 Oura", "Reconnect Oura")}</a>{/if}{/if}

    {#if payload?.summaries?.length}
      {#if me.capabilities?.personal}
        <div class="weekly-intro"><h2 class="weekly-headline">{headline}</h2><p class="intro-note">{text("变化集中在哪几天，可以从记录里继续往下看。", "Look at the daily records to see where things changed.")}</p><div class="coverage-row"><p class="coverage">{coverageLine}</p><a class="report-link" href="/compare" onclick={event => { event.preventDefault(); goto("/compare"); }}>{text("打开完整对比", "Open full comparison")} →</a></div></div>

        <section class="panel finding">
          <div class="finding-lead"><span class="eyebrow">{text("睡眠", "Sleep")}</span><h3>{sleepCompare && Math.abs(sleepCompare.delta) >= 5 ? (sleepCompare.delta > 0 ? text(`平均每晚多睡了 ${Math.round(sleepCompare.delta)} 分钟`, `${Math.round(sleepCompare.delta)} more minutes per night`) : text(`平均每晚少睡了 ${Math.round(Math.abs(sleepCompare.delta))} 分钟`, `${Math.round(Math.abs(sleepCompare.delta))} fewer minutes per night`)) : sleepCompare ? text("睡眠时长与此前 7 天接近", "Sleep duration is close to the previous week") : text("睡眠记录尚不足以比较", "More sleep records are needed to compare")}</h3>
            <div class="report-value-pair"><strong><DurationValue seconds={seriesOf(sleepSeries).mean} {locale} /></strong><div><small>{text("此前", "Before")}</small><span><DurationValue seconds={seriesOf(prevSleepSeries).mean} {locale} /></span></div></div>
            <p class="evidence">{text(`有效记录 ${seriesOf(sleepSeries).count}/7 晚 · 对照 ${seriesOf(prevSleepSeries).count}/7 晚`, `valid ${seriesOf(sleepSeries).count}/7 nights · reference ${seriesOf(prevSleepSeries).count}/7`)}</p>
          </div>
          <div class="finding-chart"><h4>{text("每晚实际睡眠", "Time asleep per night")}</h4><MiniBars {locale} series={sleepSeries.map(point => ({ date: point.date, value: point.value === null ? null : point.value / 60 }))} baseline={sleepCompare?.previous ?? null} maxValue={Math.max(540, ...sleepSeries.map(point => (point.value ?? 0) / 60))} format={value => duration(value * 60, locale).replaceAll(" ", "")} axisFormat={value => String(Math.round(value / 60))} unit={text("小时", "hours")} label={text("每晚实际睡眠", "Time asleep per night")} /></div>
          <div class="finding-footer">{#if longNights.length}<p class="note">{text(`${longNights.map(shortDate).join("、")} 两晚较长。`, `Longer nights: ${longNights.map(shortDate).join(", ")}.`)}</p>{/if}<a class="report-link" href="/sleep" onclick={event => { event.preventDefault(); goto("/sleep"); }}>{text("查看这几晚的睡眠", "Open these nights")} →</a></div>
        </section>

        <section class="panel finding">
          <div class="finding-lead"><span class="eyebrow">{text("夜间恢复记录", "Overnight recovery")}</span><h3>{hrvCompare && Math.abs(hrvCompare.delta) >= 1 ? (hrvCompare.delta > 0 ? text(`主睡眠 HRV 均值上移 ${Math.round(hrvCompare.delta)} ms`, `Main-sleep HRV up ${Math.round(hrvCompare.delta)} ms`) : text(`主睡眠 HRV 均值下移 ${Math.round(Math.abs(hrvCompare.delta))} ms`, `Main-sleep HRV down ${Math.round(Math.abs(hrvCompare.delta))} ms`)) : hrvCompare ? text("主睡眠 HRV 与此前接近", "Main-sleep HRV is close to the previous week") : text("主睡眠 HRV 尚不足以比较", "More main-sleep HRV records are needed")}</h3>
            <div class="report-value-pair"><strong>{seriesOf(hrvSeries).mean === null ? "—" : Math.round(seriesOf(hrvSeries).mean!)}<small> ms</small></strong><div><small>{text("此前", "Before")}</small><span>{seriesOf(prevHrvSeries).mean === null ? "—" : Math.round(seriesOf(prevHrvSeries).mean!)}<small> ms</small></span></div></div>
            <p class="evidence">{text(`有效记录 ${seriesOf(hrvSeries).count}/7 晚 · 对照 ${seriesOf(prevHrvSeries).count}/7 晚`, `valid ${seriesOf(hrvSeries).count}/7 nights · reference ${seriesOf(prevHrvSeries).count}/7`)}</p>
          </div>
          <div class="finding-chart"><h4>{text("每晚主睡眠 HRV", "Main-sleep HRV per night")}</h4><MiniLine {locale} series={hrvSeries} baseline={hrvCompare?.previous ?? null} domain={[Math.min(20, ...hrvSeries.filter(point => point.value !== null).map(point => point.value!)), Math.max(60, ...hrvSeries.map(point => point.value ?? 0), hrvCompare?.previous ?? 0)]} unit="ms" label={text("每晚主睡眠 HRV", "Main-sleep HRV per night")} /></div>
          <div class="finding-footer"><p class="note">{text("把夜间变化与自己的睡眠记录放在一起观察。", "Read overnight changes alongside your sleep records.")}</p><a class="report-link" href="/sleep" onclick={event => { event.preventDefault(); goto("/sleep"); }}>{text("查看逐晚记录", "Open nightly records")} →</a></div>
        </section>

        <section class="panel finding finding-pressure">
          <div class="finding-lead"><span class="eyebrow">{text("压力与恢复", "Stress & recovery")}</span><h3>{recoveryCompare && Math.abs(recoveryCompare.delta) >= 5 ? (recoveryCompare.delta > 0 ? text(`有记录日，恢复时长增加 ${Math.round(recoveryCompare.delta)} 分钟`, `Recovery time up ${Math.round(recoveryCompare.delta)} min on recorded days`) : text(`有记录日，恢复时长减少 ${Math.round(Math.abs(recoveryCompare.delta))} 分钟`, `Recovery time down ${Math.round(Math.abs(recoveryCompare.delta))} min on recorded days`)) : recoveryCompare ? text("恢复时长与此前接近", "Recovery time is close to the previous week") : text("恢复记录尚不足以比较", "More recovery records are needed to compare")}</h3>
            <div class="report-value-pair"><strong>{seriesOf(recoverySeries).mean === null ? "—" : Math.round(seriesOf(recoverySeries).mean!)}<small> {text("分钟 / 日", "min/day")}</small></strong><div><small>{text("此前", "Before")}</small><span>{seriesOf(prevRecoverySeries).mean === null ? "—" : Math.round(seriesOf(prevRecoverySeries).mean!)}<small> {text("分钟 / 日", "min/day")}</small></span></div></div>
            <p class="evidence">{text(`有效记录 ${stressCoverage.cur}/7 天 · 对照 ${stressCoverage.prev}/7 天`, `valid ${stressCoverage.cur}/7 days · reference ${stressCoverage.prev}/7`)}</p>
          </div>
          <div class="finding-chart"><div class="chart-heading"><h4>{text("每日压力与恢复时长", "Daily stress & recovery time")}</h4><div class="report-legend"><span><i class="stress"></i>{text("压力", "Stress")}</span><span><i class="recovery"></i>{text("恢复", "Recovery")}</span></div></div><MiniBars {locale} series={stressDaySeries} compare={recoverySeries} color="#c6aa87" compareColor="#738772" maxValue={Math.max(180, ...stressDaySeries.map(point => point.value ?? 0), ...recoverySeries.map(point => point.value ?? 0))} unit={text("分钟", "min")} label={text("每日压力与恢复时长", "Daily stress & recovery time")} /></div>
          <div class="finding-footer"><p class="note">{stressCoverage.cur < 7 ? text("记录尚未覆盖全部日期，先看已有的变化。", "Not every day has a record; read the recorded change only.") : text("压力与恢复按有记录的日期统计。", "Stress and recovery use recorded days.")}</p><a class="report-link" href="/compare" onclick={event => { event.preventDefault(); goto("/compare"); }}>{text("查看完整对比", "Open full comparison")} →</a></div>
        </section>

        <section class="panel life-log"><div class="section-head"><h3>{text("这七天里的生活记录", "Life log across these seven days")}</h3><span class="muted">{text("生活记录提供时间线索，不表示因果关系。", "Entries provide time context, not causation.")}</span></div>
          <ul class="life-grid">{#each daysOf(ranges.current) as day}{@const dayTags = tagsForDay(tags, day)}<li class:today={day === end} class:has-entry={dayTags.length > 0}><span class="life-date">{shortDate(day)}</span><span class="life-weekday">{new Date(`${day}T00:00:00Z`).toLocaleDateString(locale === "zh" ? "zh-CN" : "en", { weekday: "short", timeZone: "UTC" })}</span><span class="life-entry">{#if dayTags.length}{#each dayTags.slice(0, 2) as tag}<span class="life-tag">{tagLabel(tag)}{tag.comment ? ` · ${tag.comment}` : ""}</span>{/each}{:else}<span class="life-empty">—</span>{/if}</span></li>{/each}</ul>
          {#if !tags.length}<p class="hint empty-log">{text("这七天还没有保存生活标签。", "No life tags saved for these seven days.")}</p>{/if}
        </section>
        <div class="next-watch"><strong>{text("继续观察", "Keep watching")}</strong><p>{longNights.length ? text(`回看 ${longNights.map(shortDate).join(" 与 ")} 的睡眠，了解较长睡眠发生在哪些时段。`, `Revisit ${longNights.map(shortDate).join(" and ")} to see where longer sleep happened.`) : text("继续记录，观察每天的起伏。", "Keep recording and observe day-to-day variation.")}</p><a class="report-link" href="/compare" onclick={event => { event.preventDefault(); goto("/compare"); }}>{text("进入区间对比", "Compare periods")} →</a></div>
        <details class="report-disclosure weekly-summary"><summary>{text("官方评分摘要与同步状态", "Official score summary and sync status")}</summary><div>{#if payload.sync}<SyncStatus sync={payload.sync} {locale} />{/if}<ul class="insight-lines">{#each payload.summaries as line}<li>{line}</li>{/each}</ul></div></details>
      {:else}
        <section class="panel weekly-summary"><h2>{text("这一周的记录摘要", "This week's record summary")}</h2><ul class="insight-lines">{#each payload.summaries as line}<li>{line}</li>{/each}</ul></section><p class="hint">{text("当前账号可查看摘要；完整建议需要个人账号权限。", "Summaries are available. Full advice requires personal access.")}</p>
      {/if}
      <footer class="report-source"><span>{text("基于 Oura 已保存记录 · 缺失不计为 0 · 供个人观察，不用于诊断", "Saved Oura records · gaps are not zero · for personal observation, not diagnosis")}</span></footer>
    {:else if !loading && !statusErr}<p class="status" role="status">{t(locale, "weeklyEmpty")}</p>{/if}
  </main>
</div>

<style>
  .range-label { display: flex; align-items: center; gap: 6px; padding-left: 12px; border-inline: 1px solid var(--line); font-size: 13px; }
  .range-label input { width: 34px; padding: 6px 4px; border: 0; color: transparent; }
  .range-label input::-webkit-datetime-edit { display: none; }
  .range-label input::-webkit-calendar-picker-indicator { margin: 0; opacity: .7; }
  .weekly-intro { margin: 12px 0 0; }
  .weekly-headline { font-size: 25px; }.intro-note { color: var(--muted); font-size: 15px; margin-top: 3px; }
  .coverage-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 6px 0 8px; }
  .coverage { font-size: 12px; color: var(--muted); }
  :global(.workspace .page.health-report) .finding { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2.2fr); grid-template-areas: "lead chart" "footer chart"; gap: 8px 22px; padding-block: 16px; }
  .finding-lead { grid-area: lead; min-width: 0; }.finding-footer { grid-area: footer; }.finding-chart { grid-area: chart; border-left: 1px solid var(--line); padding-left: 22px; min-width: 0; }
  .eyebrow { font-size: 13px; font-weight: 600; color: var(--report-blue); }
  .finding h3 { font-size: 19px; line-height: 1.4; margin: 4px 0; letter-spacing: -.02em; }
  .finding .report-value-pair { gap: 18px; }.finding .report-value-pair > div { padding-left: 16px; }
  .finding .report-value-pair > strong { font-size: 39px; }.finding .report-value-pair > strong > small { font-size: 17px; }
  .finding .report-value-pair > div > span { font-size: 18px; }
  .finding-chart h4 { font-size: 13px; margin: 0 0 6px; font-weight: 600; }
  .evidence { color: var(--muted); font-size: 11px; margin-top: 10px; }
  .note { color: var(--muted); font-size: 12px; line-height: 1.6; }
  .finding-footer .report-link { font-size: 12px; padding-block: 4px; }
  .chart-heading { display: flex; justify-content: space-between; gap: 16px; }
  .section-head { display: flex; align-items: baseline; gap: 20px; }.section-head h3 { font-size: 18px; }
  .life-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); list-style: none; margin: 12px 0 0; padding: 0; }
  .life-grid li { border-left: 1px solid var(--line); display: grid; align-content: start; text-align: center; gap: 3px; padding: 0 8px; color: var(--muted); font-size: 12px; }
  .life-grid li:last-child { border-right: 1px solid var(--line); }.life-grid li.today .life-date { color: var(--primary); }
  .life-entry { display: grid; gap: 4px; margin-top: 4px; }.life-tag { font-size: 11px; overflow-wrap: anywhere; }.empty-log { display: none; }
  .next-watch { display: flex; align-items: baseline; gap: 16px; border-top: 1px solid var(--line); padding-top: 8px; font-size: 12px; }.next-watch p { color: var(--muted); flex: 1; }.next-watch strong { white-space: nowrap; }
  .weekly-summary li { font-size: 12px; margin-left: 18px; }
  @media(max-width:760px) {
    .report-heading { gap: 4px; }.report-date > small { font-size: 10px; }
    .weekly-intro { margin-top: 8px; }.weekly-intro .weekly-headline { font-size: 18px; line-height: 1.25; }.intro-note { display: none; }
    .coverage-row { padding: 6px 0 8px; }.coverage-row .report-link { display: none; }.coverage { font-size: 10px; }
    :global(.workspace .page.health-report) .finding { grid-template-columns: minmax(0, 1fr); grid-template-areas: "lead" "chart" "footer"; gap: 4px; padding-block: 8px; }
    .finding-chart { border-left: 0; padding-left: 0; }.finding h3 { font-size: 15px; line-height: 1.2; margin-block: 2px; }.eyebrow { font-size: 12px; display: block; line-height: 1.2; }
    .finding .report-value-pair { margin-top: 2px; }.finding .report-value-pair > strong { font-size: 28px; line-height: 1.1; }.finding .report-value-pair > div > span { font-size: 16px; }
    .finding .report-value-pair > div { line-height: 1.1; }
    .evidence { margin-top: 4px; line-height: 1.2; }.note { font-size: 11px; line-height: 1.4; }
    .finding-footer .report-link { font-size: 12px; min-height: 24px; padding-block: 2px; }.finding-chart h4 { font-size: 12px; }
    .finding-pressure .finding-footer { display: none; }
    :global(.workspace .page.health-report) .life-log { padding-block: 8px; }
    .section-head { display: block; }.section-head .muted { display: none; }
    .life-log .section-head h3 { font-size: 17px; line-height: 1.35; }
    .life-grid { display: block; margin-top: 8px; }.life-grid li { grid-template-columns: 42px 36px minmax(0, 1fr); text-align: left; border: 0; gap: 10px; margin-top: 4px; padding: 0; font-size: 11px; line-height: 1.3; }.life-grid li:last-child { border: 0; }
    .life-grid li:not(.has-entry) { display: none; }.life-entry { margin: 0; border-left: 1px solid var(--line); padding-left: 12px; }.empty-log { display: block; }
    .next-watch { display: none; }
  }
</style>
