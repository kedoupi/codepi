<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorText, RequestError } from "../lib/api";
  import { dateWindow, duration, finite, readSleep, sleepForDay, type SleepRecord } from "../lib/health";
  import {
    buildTimeline, durationVsMedian, hrvHistoryRange, nightInterval, routineNights, stageDurations, totalStageSeconds,
  } from "../lib/sleep-model";
  import NightTimelineChart from "./NightTimelineChart.svelte";
  import DurationValue from "./DurationValue.svelte";
  import { goto } from "../lib/router.svelte";
  import type { Locale } from "../lib/i18n";
  import { isDevLoginAllowed, type MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";
  import ArchiveStatus from "./ArchiveStatus.svelte";
  import { watchCalendarDay } from "../lib/calendar";

  let { me, locale, onUnauthorized, onLogout }: { me: MeResponse; locale: Locale; onUnauthorized: () => void; onLogout: () => void } = $props();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;

  let end = $state(dateWindow(1).to);
  let records = $state<SleepRecord[]>([]);
  let historyRecords = $state<SleepRecord[]>([]);
  let selectedDay = $state("");
  let selectedId = $state("");
  let loading = $state(true);
  let syncing = $state(false);
  let error = $state("");
  let syncError = $state("");
  let verified = $state(false);
  let syncedAt = $state<string | null>(null);
  let revision = 0;
  let routineCount = $state(7);

  const periods = $derived(sleepForDay(records, selectedDay));
  const dayHasMain = $derived(periods.some(record => record.type === "long_sleep"));
  const selected = $derived(periods.find(record => record.id === selectedId) ?? periods[0]);
  const timeline = $derived(selected ? buildTimeline(selected) : null);
  const stages = $derived(selected ? stageDurations(selected, timeline?.stages ?? []) : []);
  const stageTotal = $derived(totalStageSeconds(stages));
  const medianDelta = $derived(selected ? durationVsMedian(records, selected) : null);
  const history = $derived(selected ? hrvHistoryRange(historyRecords, selected) : null);
  const nights = $derived(routineNights(records, routineCount, end));
  const night = $derived(selected ? nightInterval(selected) : null);
  const savedDays = $derived([...new Set(records.map(record => record.day))].sort());
  const routineDays = $derived(Array.from({ length: routineCount }, (_, index) => new Date(Date.parse(`${end}T00:00:00Z`) - (routineCount - 1 - index) * 86400000).toISOString().slice(0, 10)));
  const routineMin = $derived(Math.min(22 * 60, ...nights.map(item => Math.floor(item.start / 120) * 120)));
  const routineMax = $derived(Math.max(32 * 60, ...nights.map(item => Math.ceil(item.end / 120) * 120)));
  const routineTicks = $derived(Array.from({ length: Math.round((routineMax - routineMin) / 120) + 1 }, (_, index) => routineMin + index * 120));
  const historyMin = $derived(history ? Math.floor(Math.min(history.min, selected?.average_hrv ?? history.min) / 10) * 10 - 10 : 0);
  const historyMax = $derived(history ? Math.ceil(Math.max(history.max, selected?.average_hrv ?? history.max) / 10) * 10 + 10 : 100);
  const historyTicks = $derived(Array.from({ length: 6 }, (_, index) => historyMin + (historyMax - historyMin) * index / 5));

  function kind(row: SleepRecord) {
    if (row.type === "long_sleep") return text("主睡眠", "Main sleep");
    if (row.type === "sleep") return text("小睡", "Nap");
    if (row.type === "rest") return text("休息", "Rest");
    if (row.type === "late_nap") return text("晚间小睡", "Late nap");
    return text("睡眠记录", "Sleep record");
  }
  function clock(value?: string) {
    return value?.match(/T(\d{2}:\d{2})/)?.[1] ?? "—";
  }
  function metric(number: unknown, unit: string) {
    return finite(number) ? `${Number(number.toFixed(1))} ${unit}` : "—";
  }
  function formatDay(day: string) {
    const [year, month, date] = day.split("-");
    return locale === "zh" ? `${year}年${Number(month)}月${Number(date)}日` : `${month}/${date}/${year}`;
  }
  function shiftSelected(offset: number) {
    const next = offset < 0 ? savedDays.filter(day => day < selectedDay).at(-1) : savedDays.find(day => day > selectedDay);
    if (next) { selectedDay = next; selectedId = ""; }
  }
  function routineLabel(minutes: number) {
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:00`;
  }

  async function load() {
    const current = ++revision;
    loading = true;
    error = "";
    records = [];
    historyRecords = [];
    verified = false;
    syncedAt = null;
    try {
      // Include the 5-minute stage string and overnight HR/HRV series for the timeline.
      const result = await readSleep(dateWindow(30, end).from, end, undefined, true);
      if (current !== revision) return;
      records = result.records;
      verified = result.sync.window_verified;
      syncedAt = result.sync.synced_at;
      syncError = result.sync.error ? errorText(new RequestError(result.sync.error, 0), locale) : "";
      selectedDay = records.some(record => record.day === selectedDay)
        ? selectedDay
        : [...records.map(record => record.day)].sort().at(-1) ?? "";
      void loadHistory(current);
    } catch (err) {
      if (current !== revision) return;
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      error = errorText(err, locale);
    } finally { if (current === revision) loading = false; }
  }

  /** Older HRV history only feeds the personal reference band; failures degrade quietly. */
  async function loadHistory(current: number) {
    try {
      const result = await readSleep(dateWindow(90, end).from, end);
      if (current !== revision) return;
      historyRecords = result.records;
    } catch { /* reference band is optional */ }
  }

  async function sync() {
    if (syncing || loading) return;
    syncing = true;
    syncError = "";
    const { from, to } = dateWindow(30, end);
    try {
      await api(`/api/me/health-records?${new URLSearchParams({ collection: "sleep", from, to })}`, { method: "POST" });
      await load();
    } catch (err) {
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      syncError = errorText(err, locale);
    } finally { syncing = false; }
  }

  onMount(() => {
    if (me.capabilities?.personal) void load(); else loading = false;
    const stop = watchCalendarDay(day => { end = day; if (me.capabilities?.personal) void load(); });
    return () => { stop(); revision++; };
  });
</script>

<ChromeHeader {locale} active="/sleep" isDev={isDevLoginAllowed(me.allowDevLogin) && me.source === "dev"} {onLogout} />
<main class="wrap page health-report sleep-page">
  <header class="report-heading">
    <h1>{text("睡眠与恢复", "Sleep & recovery")}</h1>
    {#if records.length}
      <div class="report-date">
        <div class="date-control">
          <button aria-label={text("前一晚", "Previous night")} disabled={!savedDays.some(day => day < selectedDay)} onclick={() => shiftSelected(-1)}>‹</button>
          <label class="sleep-date-label"><span>{formatDay(selectedDay)}</span><input type="date" aria-label={text("睡眠日期", "Sleep date")} min={savedDays[0]} max={end} bind:value={selectedDay} oninput={() => { selectedId = ""; }} /></label>
          <button aria-label={text("后一晚", "Next night")} disabled={!savedDays.some(day => day > selectedDay)} onclick={() => shiftSelected(1)}>›</button>
        </div>
      </div>
    {/if}
  </header>
  {#if syncError}<div class="sleep-notice" role="alert">{syncError} <a href="/settings">{text("查看数据设置", "Open data settings")}</a></div>{/if}
  {#if !me.capabilities?.personal}
    <div class="sleep-empty">{text("详细睡眠目前仅向个人工作区开放。", "Detailed sleep is currently available to the personal workspace.")}</div>
  {:else if loading}
    <div class="sleep-empty" role="status">{text("正在读取详细睡眠…", "Loading detailed sleep…")}</div>
  {:else if error}
    <div class="sleep-empty" role="alert"><h2>{text("暂时无法读取睡眠", "Sleep records unavailable")}</h2><p>{error}</p><button class="ai-btn" onclick={load}>{text("重试", "Retry")}</button></div>
  {:else if !records.length}
    <div class="sleep-empty" data-testid="sleep-empty">
      <h2>{verified ? text("近 30 天暂无睡眠记录", "No sleep records in the last 30 days") : text("还没有保存的睡眠细节", "No sleep details saved yet")}</h2>
      <p>{verified ? text("已检查此区间，Oura 没有返回记录。", "This range was checked; Oura returned no records.") : text("点击「同步近 30 天」开始采集，或前往数据设置补齐最近 90 天。", "Sync to get started, or backfill 90 days in data settings.")}</p>
      <a href="/settings" class="ai-btn">{text("前往数据设置", "Open data settings")}</a>
    </div>
  {:else if selected}
    {#if !dayHasMain}
      <div class="sleep-notice" role="status" data-testid="nap-only-notice">{text("这一天 Oura 没有返回主睡眠记录；下方展示的是小睡或休息时段，不代表夜间睡眠。", "Oura returned no main-sleep record for this day; below is a nap or rest period, not overnight sleep.")}</div>
    {/if}
    <section class="night-summary" aria-label={text("选中的这一晚", "Selected night")}>
      <div class="night-context">
        <div>
          <h2 class="night-headline">{medianDelta ? (medianDelta.delta >= 0
            ? text(`比个人近期水平多睡了 ${medianDelta.delta} 分钟`, `${medianDelta.delta} min more than your recent median`)
            : text(`比个人近期水平少睡了 ${Math.abs(medianDelta.delta)} 分钟`, `${Math.abs(medianDelta.delta)} min less than your recent median`))
            : dayHasMain ? text("看见这一晚，也看见恢复的变化。", "This night, and what changes over time.")
              : text("这一天只有小睡或休息时段。", "Only nap or rest periods were recorded this day.")}</h2>
          {#if medianDelta}<p class="hint baseline-note">{text(`较此前 ${medianDelta.count} 晚主睡眠中位数`, `Compared with ${medianDelta.count} earlier main-sleep nights`)}</p>{/if}
        </div>
        {#if night}<p class="night-bounds">{kind(selected)} · {night.startLabel} — {night.endLabel}</p>{/if}
      </div>
      <div class="night-stats">
        <div class="stat stat-primary"><span>{text("实际睡眠", "Time asleep")}</span><strong data-testid="sleep-duration"><DurationValue seconds={selected.total_sleep_duration} {locale} /></strong><small>{text("卧床", "In bed")} {duration(selected.time_in_bed, locale)}</small></div>
        <div class="stat stat-latency"><span>{text("入睡用时", "Latency")}</span><strong>{finite(selected.latency) ? Math.round(selected.latency / 60) : "—"}<small> {text("分钟", "min")}</small></strong></div>
        <div class="stat stat-awake"><span>{text("清醒时长", "Awake")}</span><strong>{finite(selected.awake_time) ? Math.round(selected.awake_time / 60) : "—"}<small> {text("分钟", "min")}</small></strong></div>
        <div class="stat stat-efficiency"><span>{text("睡眠效率", "Efficiency")}</span><strong>{metric(selected.efficiency, "").trim()}<small> %</small></strong></div>
      </div>
    </section>

    <div class="night-grid">
      <section class="night-main" data-testid="sleep-detail" aria-label={text("这一晚的时间线", "Timeline of this night")}>
        <div class="section-title">
          <h2>{selected.type === "long_sleep" ? text("这一晚的睡眠", "This night") : text("这段记录的时间线", "This period's timeline")}</h2>
          <div class="night-tools">
            <select class="period-picker" aria-label={text("选择睡眠记录", "Choose sleep period")} value={selected.id} onchange={event => { selectedId = event.currentTarget.value; }}>
              {#each periods as period}<option value={period.id}>{kind(period)} {clock(period.bedtime_start)}</option>{/each}
            </select>
            <a class="report-link data-link" href="#night-data">{text("查看数据", "View data")} →</a>
          </div>
        </div>
        {#if timeline}
          <NightTimelineChart {timeline} {locale} composition={stages} averageHr={selected.average_heart_rate} lowestHr={selected.lowest_heart_rate} averageHrv={selected.average_hrv} />
          {#if !timeline.stages.length}<p class="hint">{text("这段睡眠没有保存逐段阶段记录，只展示夜间序列。", "No stage-by-stage record was saved; showing overnight series only.")}</p>{/if}
        {:else}<p class="hint">{text("这段记录缺少入睡与起床时间，无法绘制时间线。", "Bedtime bounds are missing, so no timeline can be drawn.")}</p>{/if}
      </section>
      <aside class="night-side">
        <section class="composition-section" aria-label={text("睡眠组成", "Sleep composition")}>
          <h3>{text("睡眠组成", "Sleep composition")}</h3>
          {#if stageTotal > 0}
            <ul class="composition">{#each stages as stage}<li><i class="dot" style:background={stage.color}></i><span>{ { deep: text("深睡", "Deep"), rem: "REM", light: text("浅睡", "Light"), awake: text("清醒", "Awake") }[stage.key] }</span><span>{duration(stage.seconds, locale)}</span><span class="track"><i style:width={`${finite(stage.seconds) ? stage.seconds / stageTotal * 100 : 0}%`} style:background={stage.color}></i></span></li>{/each}</ul>
          {:else}<p class="hint">{text("没有保存阶段时长。", "No stage durations saved.")}</p>{/if}
        </section>
        <section class="history-section" aria-label={text("与自己的历史对照", "Against your history")}>
          <h3>{text("与自己的历史对照", "Against your history")}</h3>
          {#if selected.type === "long_sleep" && finite(selected.average_hrv)}
            <p class="side-metric">{text("主睡眠 HRV", "Main-sleep HRV")}</p>
            <p class="side-value">{Math.round(selected.average_hrv)}<small> ms</small></p>
            {#if history}
              <div class="history-band" role="img" aria-label={text(`历史中间 50%：${Math.round(history.low)} – ${Math.round(history.high)} ms；这一晚 ${Math.round(selected.average_hrv)} ms`, `Middle 50%: ${Math.round(history.low)}–${Math.round(history.high)} ms; this night ${Math.round(selected.average_hrv)} ms`)}>
                <span class="history-middle" style:left={`${(history.low - historyMin) / (historyMax - historyMin) * 100}%`} style:width={`${(history.high - history.low) / (historyMax - historyMin) * 100}%`}></span>
                <span class="marker" style:left={`${(selected.average_hrv - historyMin) / (historyMax - historyMin) * 100}%`}></span>
              </div>
              <div class="history-axis">{#each historyTicks as tick}<span>{Math.round(tick)}</span>{/each}</div>
              <p class="history-caption">{text(`历史中间 50%：${Math.round(history.low)} – ${Math.round(history.high)} ms`, `Middle 50%: ${Math.round(history.low)}–${Math.round(history.high)} ms`)}</p>
              <p class="hint">{text(`此前 ${history.count} 晚 · 个人历史参考，不是医学正常范围。`, `${history.count} earlier nights · personal reference, not a medical range.`)}</p>
            {:else}<p class="hint">{text("历史不足 14 晚，先积累更多记录再形成个人参考范围。", "Fewer than 14 earlier nights; keep recording to build a personal range.")}</p>{/if}
          {:else}<p class="hint">{text("主睡眠 HRV 只取明确的主睡眠记录；小睡不进入此对照。", "Only explicit main-sleep HRV enters this reference; naps do not.")}</p>{/if}
        </section>
      </aside>
    </div>

    <section class="routine" aria-label={text(`最近 ${routineCount} 晚的作息`, `Last ${routineCount} nights`)}>
      <div class="section-title"><h2>{text(`最近 ${routineCount} 晚的作息`, `Last ${routineCount} nights`)}</h2><span class="muted routine-intro">{text("把睡眠时长放回入睡与起床的时间里。", "See sleep duration in the context of bedtime and rise.")}</span><div class="report-tabs" role="group" aria-label={text("作息范围", "Routine range")}>{#each [7, 30] as count}<button aria-pressed={routineCount === count} onclick={() => { routineCount = count; }}>{count} {text("天", "days")}</button>{/each}</div><a class="report-link routine-link" href="/insights" onclick={event => { event.preventDefault(); goto("/insights"); }}>{text("查看 7 天解读", "Open 7-day reading")} →</a></div>
      <div class="routine-chart">
        {#each routineDays as day}
          {@const item = nights.find(night => night.day === day)}
          <button class="routine-row" class:chosen={day === selectedDay} disabled={!item} aria-pressed={day === selectedDay} onclick={() => { selectedDay = day; selectedId = ""; }}>
            <span class="routine-day">{day.slice(5).replace("-", "/")}</span>
            <span class="routine-track" style:--routine-ticks={routineTicks.length - 1}>
              {#if item}<i style:left={`${(item.start - routineMin) / (routineMax - routineMin) * 100}%`} style:width={`${(item.end - item.start) / (routineMax - routineMin) * 100}%`}><span class="routine-start">{item.startLabel}</span><span class="routine-end">{item.endLabel}</span></i>{:else}<span class="routine-missing">{text("无主睡眠记录", "No main-sleep record")}</span>{/if}
            </span>
          </button>
        {/each}
        <div class="routine-axis">{#each routineTicks as tick}<span>{routineLabel(tick)}</span>{/each}</div>
      </div>
      <p class="hint routine-caption">{text("横条表示入床至起床，含清醒时间。", "Bars span bedtime to rise, awake time included.")}</p>
    </section>
    <details id="night-data" class="report-disclosure"><summary>{text("这一晚的数据与来源", "Night data and sources")}</summary><div><p>{text("阶段时长", "Stage durations")}：{stages.map(stage => `${stage.key}: ${duration(stage.seconds, locale)}`).join(" · ")}</p><p>{text("平均心率", "Avg HR")} {metric(selected.average_heart_rate, "bpm")} · {text("最低心率", "Lowest HR")} {metric(selected.lowest_heart_rate, "bpm")} · {text("平均呼吸", "Avg breath")} {metric(selected.average_breath, text("次/分", "/min"))}</p><p>{text("时间按记录中的当地时间显示；断开的线段表示记录缺口，未做补齐。", "Times follow the recorded local time; broken segments mark gaps without interpolation.")}</p></div></details>
  {:else}<div class="sleep-empty">{text("这一天没有保存的睡眠记录，请选择其他日期。", "No saved sleep on this date; choose another date.")}</div>{/if}
  <footer class="report-source"><span>{text("Oura 已保存记录 · 时间按记录中的当地时间显示", "Saved Oura records · recorded local times")}{#if syncedAt} · {new Date(syncedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en")}{/if}</span><div class="sleep-controls"><button disabled={syncing || loading || !me.capabilities?.personal} onclick={sync}>{syncing ? text("同步中…", "Syncing…") : text("同步近 30 天", "Sync last 30 days")}</button><a class="report-link" href="/settings">{text("数据与同步", "Data & sync")} →</a></div></footer>
  {#if me.capabilities?.personal}<details class="archive-disclosure"><summary>{text("详细采集状态", "Archive status")}</summary><ArchiveStatus {locale} {onUnauthorized} refreshKey={syncedAt} /></details>{/if}
</main>

<style>
  .sleep-date-label { display: flex; align-items: center; gap: 6px; padding-left: 10px; border-inline: 1px solid var(--line); font-size: 13px; white-space: nowrap; }
  .sleep-date-label input { width: 30px; padding: 6px 2px; border: 0; color: transparent; }
  .sleep-date-label input::-webkit-datetime-edit { display: none; }
  .sleep-date-label input::-webkit-calendar-picker-indicator { margin: 0; opacity: .7; }
  .night-context { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 14px 0 18px; }
  .night-headline { font-size: 20px; }
  .night-bounds { font-size: 12px; color: var(--muted); white-space: nowrap; }
  .night-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-block: 1px solid var(--line); padding: 20px 0; }
  .stat { padding-left: 38px; border-left: 1px solid var(--line); }
  .stat:first-child { padding-left: 0; border-left: 0; }
  .stat > span { display: block; font-size: 13px; font-weight: 600; line-height: 1.4; }
  .stat > strong { display: block; margin-top: 2px; font-size: 47px; line-height: 1.25; font-weight: 500; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
  .stat > strong > small { font-size: 14px; font-weight: 500; letter-spacing: 0; }
  .stat > small { display: block; font-size: 12px; color: var(--muted); line-height: 1.4; }
  .night-grid { display: grid; grid-template-columns: minmax(0, 2.15fr) minmax(0, 1fr); gap: 26px; padding: 20px 0; }
  .night-main { min-width: 0; }
  .night-side { border-left: 1px solid var(--line); padding-left: 26px; }
  .section-title { display: flex; align-items: center; gap: 20px; margin-bottom: 14px; }
  .night-tools { display: flex; align-items: center; gap: 20px; }
  .period-picker { padding: 4px 8px; font: inherit; font-size: 12px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--primary); min-height: 32px; max-width: 160px; }
  .night-side h3 { font-size: 19px; margin-bottom: 12px; }
  .composition { list-style: none; padding: 0; margin: 0; }
  .composition li { display: grid; grid-template-columns: 10px 34px 78px minmax(0, 1fr); gap: 10px; align-items: center; padding: 11px 0; border-bottom: 1px solid var(--line); font-size: 11px; color: var(--muted); white-space: nowrap; }
  .composition .dot { width: 10px; height: 10px; border-radius: 50%; }
  .composition .track { height: 13px; background: #eeebe6; border-radius: 3px; overflow: hidden; }
  .composition .track i { display: block; height: 100%; border-radius: 3px; }
  .history-section { margin-top: 20px; }
  .side-metric { font-size: 13px; font-weight: 600; }
  .side-value { font-size: 38px; font-weight: 500; color: var(--primary); line-height: 1.3; letter-spacing: -.03em; }
  .side-value small { font-size: 18px; }
  .history-band { height: 18px; background: #eeebe6; position: relative; margin-top: 10px; }
  .history-middle { position: absolute; top: 0; bottom: 0; background: #cdd3c8; }
  .history-band .marker { position: absolute; top: -3px; height: 24px; width: 1px; background: var(--primary); }
  .history-band .marker::after { content: ""; position: absolute; top: 7px; left: -4px; width: 9px; height: 9px; border-radius: 50%; background: var(--primary); }
  .history-axis { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); margin: 6px 0 10px; }
  .history-caption { font-size: 12px; }
  .routine { border-top: 1px solid var(--line); padding-top: 14px; }
  .routine .section-title { gap: 16px; margin-bottom: 8px; }
  .routine .report-tabs { margin-left: auto; flex-shrink: 0; gap: 14px; }
  .routine-row { display: grid; grid-template-columns: 58px minmax(0, 1fr); width: 100%; border: 0; background: transparent; min-height: 24px; text-align: left; align-items: center; padding: 0; }
  .routine-day { font-size: 11px; color: var(--muted); }
  .routine-row.chosen .routine-day { color: var(--primary); font-weight: 600; }
  .routine-track { position: relative; height: 24px; border-bottom: 1px solid var(--report-chart-grid); background-image: repeating-linear-gradient(90deg, var(--report-chart-grid) 0 1px, transparent 1px calc(100% / var(--routine-ticks))); }
  .routine-track > i { position: absolute; top: 8px; height: 7px; background: #7390a2; border-radius: 4px; opacity: .75; }
  .routine-track > i::before, .routine-track > i::after { content: ""; position: absolute; top: -1px; width: 9px; height: 9px; border-radius: 50%; background: #54758c; }
  .routine-track > i::before { left: -4px; }.routine-track > i::after { right: -4px; }
  .routine-row.chosen i, .routine-row.chosen i::before, .routine-row.chosen i::after { background: var(--primary); }
  .routine-start, .routine-end { display: none; position: absolute; font-style: normal; top: -7px; color: var(--primary); font-size: 11px; }
  .routine-start { right: calc(100% + 10px); }.routine-end { left: calc(100% + 10px); }
  .routine-row.chosen .routine-start, .routine-row.chosen .routine-end { display: block; }
  .routine-missing { font-size: 10px; color: var(--muted); padding-left: 10px; }
  .routine-axis { display: flex; justify-content: space-between; margin: 8px 0 0 58px; font-size: 10px; color: var(--muted); }
  .routine-caption { text-align: right; }
  .sleep-controls { display: flex; align-items: center; gap: 8px; }
  :global(.workspace .page.health-report) .sleep-controls button { border: 0; padding: 4px; min-height: 44px; font-size: 11px; }
  .sleep-notice { padding: 12px; background: var(--peach); margin-block: 16px; font-size: 13px; }
  .sleep-empty { margin: 28px 0; padding: 32px 16px; text-align: center; border: 1px dashed var(--line); color: var(--muted); }
  .sleep-empty p { margin: 12px 0; }.sleep-empty .ai-btn { display: inline-flex; }
  .archive-disclosure { color: var(--muted); font-size: 11px; margin-top: 6px; }.archive-disclosure summary { cursor: pointer; }
  @media (max-width: 760px) {
    .night-context { flex-direction: column; align-items: flex-start; gap: 4px; margin: 12px 0; }
    .night-summary .night-headline { font-size: 16px; }.baseline-note { display: none; }
    .night-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-areas: "duration efficiency" "latency awake"; padding: 0; }
    .stat { padding: 10px 0 10px 20px; min-width: 0; }
    .stat > strong { font-size: 36px; line-height: 1.15; }.stat > span { font-size: 12px; }
    .stat-primary { grid-area: duration; padding-left: 0; }.stat-efficiency { grid-area: efficiency; }
    .stat-latency { grid-area: latency; padding-left: 0; border-left: 0; border-top: 1px solid var(--line); }.stat-awake { grid-area: awake; border-top: 1px solid var(--line); }
    .night-grid { display: block; padding: 12px 0; }
    .night-side { border-left: 0; padding: 0; }.composition-section { display: none; }
    .history-section { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
    .night-side h3 { font-size: 19px; line-height: 1.3; margin-bottom: 4px; }
    .side-metric { font-size: 12px; line-height: 1.35; }.side-value { line-height: 1.05; }
    .history-band { height: 12px; margin-top: 6px; }.history-band .marker { height: 18px; }.history-band .marker::after { top: 5px; }
    .section-title { justify-content: space-between; gap: 12px; margin-bottom: 8px; }.night-tools { gap: 0; }.data-link { display: none; }
    .period-picker { min-height: 36px; max-width: 130px; font-size: 11px; }
    .history-axis { font-size: 10px; line-height: 1.2; margin: 4px 0 6px; }.history-caption { font-size: 12px; line-height: 1.3; }.side-value { font-size: 34px; }
    :global(.workspace .health-report) .history-section .hint { font-size: 10px; line-height: 1.4; margin: 2px 0; }
    .routine .section-title { flex-wrap: wrap; gap: 4px 10px; }.routine-intro { display: none; }.routine-link { order: 5; display: none; }
    .routine-chart { padding-right: 32px; }
    .routine-row { grid-template-columns: 54px minmax(0, 1fr); min-height: 14px; line-height: 14px; }.routine-day { font-size: 10px; }.routine-axis { margin-left: 54px; }.routine-axis span:nth-child(even) { visibility: hidden; }
    .routine-row.chosen { min-height: 22px; }
    .routine-start, .routine-end { font-size: 9px; top: -4px; line-height: 1.2; }.routine-start { right: calc(100% + 6px); }.routine-end { left: calc(100% + 6px); }
    .routine-track { height: 14px; }.routine-track > i { top: 4px; height: 5px; }.routine-track > i::before, .routine-track > i::after { width: 7px; height: 7px; }.routine-caption { text-align: left; }
  }
</style>
