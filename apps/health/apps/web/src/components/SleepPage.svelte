<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorText, RequestError } from "../lib/api";
  import { dateWindow, duration, finite, readSleep, sleepForDay, type SleepRecord } from "../lib/health";
  import {
    buildTimeline, durationVsMedian, hrvHistoryRange, nightInterval, routineNights, stageDurations, totalStageSeconds,
  } from "../lib/sleep-model";
  import NightTimelineChart from "./NightTimelineChart.svelte";
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

  const periods = $derived(sleepForDay(records, selectedDay));
  const selected = $derived(periods.find(record => record.id === selectedId) ?? periods[0]);
  const timeline = $derived(selected ? buildTimeline(selected) : null);
  const stages = $derived(selected ? stageDurations(selected, timeline?.stages ?? []) : []);
  const stageTotal = $derived(totalStageSeconds(stages));
  const medianDelta = $derived(selected ? durationVsMedian(records, selected) : null);
  const history = $derived(selected ? hrvHistoryRange(historyRecords, selected) : null);
  const nights = $derived(routineNights(records, 7, end));
  const night = $derived(selected ? nightInterval(selected) : null);

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
    const [, month, date] = day.split("-");
    return locale === "zh" ? `${Number(month)}月${Number(date)}日` : `${month}/${date}`;
  }
  function shiftSelected(offset: number) {
    const index = [...new Set(records.map(record => record.day))].sort().indexOf(selectedDay);
    const days = [...new Set(records.map(record => record.day))].sort();
    const next = days[index + offset];
    if (next) { selectedDay = next; selectedId = ""; }
  }

  async function load() {
    const current = ++revision;
    loading = true;
    error = "";
    records = [];
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
<main class="wrap page sleep-page">
  <header class="sleep-heading">
    <div>
      <h1>{text("睡眠与恢复", "Sleep & recovery")}</h1>
      <p class="sub">{text("看见这一晚，也看见恢复的变化。", "This night in detail, with room to see what changes.")}</p>
    </div>
    <div class="sleep-controls">
      <button class="ai-btn" disabled={syncing || loading || !me.capabilities?.personal} onclick={sync}>{syncing ? text("同步中…", "Syncing…") : text("同步近 30 天", "Sync last 30 days")}</button>
    </div>
  </header>

  {#if syncedAt}<p class="hint">{text("记录同步于", "Records synced")} {new Date(syncedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en")}</p>{/if}
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
      <p>{verified ? text("已检查此区间，Oura 没有返回记录。", "This range was checked; Oura returned no records.")
        : text("点击「同步近 30 天」开始采集，或前往数据设置补齐最近 90 天。", "Sync to get started, or backfill 90 days in data settings.")}</p>
      <a href="/settings" class="ai-btn">{text("前往数据设置", "Open data settings")}</a>
    </div>
  {:else}
    <section class="night-summary" aria-label={text("选中的这一晚", "Selected night")}>
      <div class="night-nav">
        <button class="nav-arrow" aria-label={text("前一晚", "Previous night")} onclick={() => shiftSelected(-1)}>‹</button>
        <div class="night-date">
          <strong>{formatDay(selectedDay)}</strong>
          {#if night}<span>{kind(selected!)} · {night.startLabel} — {night.endLabel}</span>{/if}
        </div>
        <button class="nav-arrow" aria-label={text("后一晚", "Next night")} onclick={() => shiftSelected(1)}>›</button>
      </div>
      {#if medianDelta}
        <p class="night-headline">{medianDelta.delta >= 0
          ? text(`比个人近期水平多睡了 ${medianDelta.delta} 分钟`, `${medianDelta.delta} min more than your recent median`)
          : text(`比个人近期水平少睡了 ${Math.abs(medianDelta.delta)} 分钟`, `${Math.abs(medianDelta.delta)} min less than your recent median`)}
          <small>{text(`基于此前 ${medianDelta.count} 晚已保存主睡眠的中位数。`, `Median of ${medianDelta.count} earlier saved nights.`)}</small>
        </p>
      {/if}
      <div class="night-stats">
        <div class="stat stat-primary">
          <span>{text("实际睡眠", "Time asleep")}</span>
          <strong data-testid="sleep-duration">{duration(selected?.total_sleep_duration, locale)}</strong>
          <small>{text("卧床", "In bed")} {duration(selected?.time_in_bed, locale)}</small>
        </div>
        <div class="stat">
          <span>{text("入睡用时", "Latency")}</span>
          <strong>{finite(selected?.latency) ? Math.round(selected.latency / 60) : "—"}<small>{text(" 分钟", " min")}</small></strong>
        </div>
        <div class="stat">
          <span>{text("清醒时长", "Awake")}</span>
          <strong>{finite(selected?.awake_time) ? Math.round(selected.awake_time / 60) : "—"}<small>{text(" 分钟", " min")}</small></strong>
        </div>
        <div class="stat">
          <span>{text("睡眠效率", "Efficiency")}</span>
          <strong>{metric(selected?.efficiency, "").replace(" ", "")}<small>%</small></strong>
        </div>
      </div>
    </section>

    {#if periods.length > 1}
      <div class="period-picker" role="group" aria-label={text("选择睡眠记录", "Choose sleep period")}>
        {#each periods as period}
          <button aria-pressed={selected?.id === period.id} class:active={selected?.id === period.id} onclick={() => { selectedId = period.id; }}>{kind(period)} {clock(period.bedtime_start)}</button>
        {/each}
      </div>
    {/if}

    <div class="night-grid">
      <section class="night-main" data-testid="sleep-detail" aria-label={text("这一晚的时间线", "Timeline of this night")}>
        <div class="section-title">
          <h2>{text("这一晚的睡眠", "This night")}</h2>
          <span class="muted">{kind(selected!)} · {clock(selected?.bedtime_start)} — {clock(selected?.bedtime_end)}</span>
        </div>
        {#if timeline && timeline.stages.length}
          <NightTimelineChart {timeline} {locale} />
        {:else if timeline}
          <NightTimelineChart {timeline} {locale} />
          <p class="hint">{text("这段睡眠没有保存逐段阶段记录，只展示夜间序列。", "No stage-by-stage record was saved; showing overnight series only.")}</p>
        {:else}
          <p class="hint">{text("这段记录缺少入睡与起床时间，无法绘制时间线。", "Bedtime bounds are missing, so no timeline can be drawn.")}</p>
        {/if}
        <p class="hint">{text("时间按记录中的当地时间显示；断开的线段表示记录缺口。", "Times follow the recorded local time; broken segments mark gaps.")}</p>
      </section>

      <aside class="night-side">
        <section class="side-card" aria-label={text("睡眠组成", "Sleep composition")}>
          <h3>{text("睡眠组成", "Sleep composition")}</h3>
          {#if stageTotal > 0}
            <ul class="composition">
              {#each stages as stage}
                <li>
                  <span class="dot" style:background={stage.color}></span>
                  <span class="label">{ { deep: text("深睡", "Deep"), rem: "REM", light: text("浅睡", "Light"), awake: text("清醒", "Awake") }[stage.key] }</span>
                  <strong>{duration(stage.seconds, locale)}</strong>
                  <span class="track"><i style:width={`${finite(stage.seconds) ? stage.seconds / stageTotal * 100 : 0}%`} style:background={stage.color}></i></span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="hint">{text("没有保存阶段时长。", "No stage durations saved.")}</p>
          {/if}
        </section>

        <section class="side-card" aria-label={text("与自己的历史对照", "Against your history")}>
          <h3>{text("与自己的历史对照", "Against your history")}</h3>
          {#if selected?.type === "long_sleep" && finite(selected.average_hrv) && history}
            <p class="side-metric">{text("主睡眠 HRV", "Main-sleep HRV")}</p>
            <p class="side-value">{Math.round(selected.average_hrv)}<small> ms</small></p>
            <div class="history-band" role="img" aria-label={text("历史中间 50% 范围", "Historical middle 50% range")}>
              <span class="range" style:left={`${(history.low - history.min) / (history.max - history.min || 1) * 100}%`} style:width={`${(history.high - history.low) / (history.max - history.min || 1) * 100}%`}></span>
              <span class="marker" style:left={`${Math.min(98, Math.max(2, (selected.average_hrv - history.min) / (history.max - history.min || 1) * 100))}%`}></span>
            </div>
            <p class="hint">{text(`历史中间 50%：${Math.round(history.low)} – ${Math.round(history.high)} ms，共 ${history.count} 晚。个人历史参考，不是医学正常范围。`, `Middle 50%: ${Math.round(history.low)}–${Math.round(history.high)} ms across ${history.count} nights. Personal reference, not a medical range.`)}</p>
          {:else if selected?.type === "long_sleep" && finite(selected?.average_hrv)}
            <p class="side-metric">{text("主睡眠 HRV", "Main-sleep HRV")}</p>
            <p class="side-value">{Math.round(selected.average_hrv)}<small> ms</small></p>
            <p class="hint">{text("历史不足 14 晚，先积累更多记录再形成个人参考范围。", "Fewer than 14 earlier nights; keep recording to build a personal range.")}</p>
          {:else}
            <p class="hint">{text("主睡眠 HRV 只取明确的主睡眠记录；小睡不进入此对照。", "Only explicit main-sleep HRV enters this reference; naps do not.")}</p>
          {/if}
          <dl class="side-metrics">
            <div><dt>{text("平均心率", "Avg HR")}</dt><dd>{metric(selected?.average_heart_rate, "bpm")}</dd></div>
            <div><dt>{text("最低心率", "Lowest HR")}</dt><dd>{metric(selected?.lowest_heart_rate, "bpm")}</dd></div>
            <div><dt>{text("平均呼吸", "Avg breath")}</dt><dd>{metric(selected?.average_breath, text("次/分", "/min"))}</dd></div>
          </dl>
        </section>
      </aside>
    </div>

    <section class="routine" aria-label={text("最近 7 晚的作息", "Bedtime routine of the last 7 nights")}>
      <div class="section-title">
        <h2>{text("最近 7 晚的作息", "Last 7 nights")}</h2>
        <span class="muted">{text("横条表示入床至起床，含清醒时间。", "Bars span bedtime to rise, awake time included.")}</span>
      </div>
      {#if nights.length}
        <div class="routine-chart">
          {#each nights as item}
            <button class="routine-row" class:chosen={item.day === selectedDay} onclick={() => { selectedDay = item.day; selectedId = ""; }} aria-pressed={item.day === selectedDay}>
              <span class="routine-day">{item.day.slice(5).replace("-", "/")}</span>
              <span class="routine-track">
                <i style:left={`${(item.start - 20 * 60) / (14 * 60) * 100}%`} style:width={`${(item.end - item.start) / (14 * 60) * 100}%`}></i>
              </span>
              <span class="routine-time">{item.startLabel} — {item.endLabel}</span>
            </button>
          {/each}
          <div class="routine-axis"><span>22:00</span><span>00:00</span><span>02:00</span><span>04:00</span><span>06:00</span><span>08:00</span></div>
        </div>
      {:else}
        <p class="hint">{text("还没有足够的入床与起床时间。", "Not enough bedtime bounds yet.")}</p>
      {/if}
      <p class="hint">{text("Oura 已保存记录 · 时间按记录中的当地时间显示。", "Saved Oura records · times follow the recorded local time.")}</p>
    </section>
  {/if}
  {#if me.capabilities?.personal}<ArchiveStatus {locale} {onUnauthorized} refreshKey={syncedAt} />{/if}
</main>

<style>
  .sleep-page{padding-top:36px}
  .sleep-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
  h1{font-size:36px;letter-spacing:-.04em}.sub{font-size:15px;margin-top:8px;color:var(--muted)}
  .sleep-controls{display:flex;gap:10px}
  button:disabled{cursor:wait;opacity:.6}
  .hint{line-height:1.65;margin:8px 0;font-size:12px;color:var(--muted)}
  .muted{font-size:12px;color:var(--muted)}
  .sleep-notice{padding:16px;background:var(--peach);color:#9a3412;border:1px solid var(--line);border-radius:12px;margin:16px 0}
  .sleep-notice a{text-decoration:underline}
  .sleep-empty{padding:48px 24px;border:1px dashed var(--line);border-radius:20px;margin:24px 0;text-align:center;color:var(--muted)}
  .sleep-empty h2{color:var(--ink);font-size:23px}.sleep-empty p{margin:12px auto 20px;max-width:520px}.sleep-empty .ai-btn{display:inline-flex}

  .night-summary{padding:8px 0 24px;border-bottom:1px solid var(--line);margin-bottom:24px}
  .night-nav{display:flex;align-items:center;gap:16px}
  .nav-arrow{width:44px;height:44px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--primary);font-size:20px;cursor:pointer}
  .night-date{display:grid;gap:2px}
  .night-date strong{font-size:22px;letter-spacing:-.02em}
  .night-date span{font-size:13px;color:var(--muted)}
  .night-headline{margin:18px 0 6px;font-size:17px}
  .night-headline small{display:block;font-size:12px;color:var(--muted);margin-top:4px}
  .night-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:18px}
  .stat span{display:block;font-size:13px;color:var(--muted)}
  .stat strong{display:block;font-size:34px;font-weight:600;letter-spacing:-.03em;margin-top:6px;font-variant-numeric:tabular-nums}
  .stat strong small{font-size:14px;font-weight:400;color:var(--muted)}
  .stat small{color:var(--muted);font-size:12px}
  .stat-primary strong{color:var(--primary)}

  .period-picker{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px}
  .period-picker button{padding:8px 14px;border:1px solid var(--line);background:var(--surface);border-radius:10px;color:var(--muted);cursor:pointer;font:inherit;font-size:13px}
  .period-picker button.active{color:#9a3412;background:var(--peach);border-color:#ea9d66}

  .night-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:24px;align-items:start}
  .night-main,.side-card,.routine{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px}
  .section-title{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}
  .section-title h2{font-size:18px}
  .night-side{display:grid;gap:24px}
  .side-card h3{font-size:15px;margin-bottom:14px}
  .composition{list-style:none;margin:0;padding:0;display:grid;gap:12px}
  .composition li{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;font-size:13px}
  .composition .dot{width:9px;height:9px;border-radius:50%}
  .composition .label{color:var(--muted)}
  .composition strong{font-variant-numeric:tabular-nums}
  .composition .track{grid-column:1/-1;height:8px;border-radius:4px;background:var(--peach);overflow:hidden}
  .composition .track i{display:block;height:100%;border-radius:4px}
  .side-metric{font-size:13px;color:var(--muted)}
  .side-value{font-size:40px;color:var(--primary);font-weight:600;letter-spacing:-.03em;margin:4px 0 12px}
  .side-value small{font-size:16px;font-weight:400}
  .history-band{position:relative;height:22px;border-radius:6px;background:linear-gradient(90deg,var(--peach),#fbf3ea);border:1px solid var(--line);margin:8px 0}
  .history-band .range{position:absolute;top:0;bottom:0;background:#e2d8c9;border-radius:6px}
  .history-band .marker{position:absolute;top:-3px;bottom:-3px;width:4px;border-radius:2px;background:var(--primary);transform:translateX(-2px)}
  .side-metrics{margin-top:16px}
  .side-metrics>div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;font-size:14px}
  .side-metrics dt{color:var(--muted)}
  .side-metrics dd{font-variant-numeric:tabular-nums}

  .routine{margin-top:24px}
  .routine-chart{display:grid;gap:6px}
  .routine-row{display:grid;grid-template-columns:52px 1fr 110px;gap:12px;align-items:center;background:transparent;border:0;padding:4px 0;font:inherit;cursor:pointer;text-align:left}
  .routine-day{font-size:12px;color:var(--muted)}
  .routine-row.chosen .routine-day{color:var(--primary);font-weight:600}
  .routine-track{position:relative;height:14px;border-radius:7px;background:var(--peach)}
  .routine-track i{position:absolute;top:2px;bottom:2px;border-radius:5px;background:#8fa3b8}
  .routine-row.chosen .routine-track i{background:var(--primary)}
  .routine-time{font-size:11px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
  .routine-axis{display:flex;justify-content:space-between;margin:6px 0 0 64px;font-size:11px;color:var(--muted)}

  @media(max-width:900px){.night-grid{grid-template-columns:1fr}.night-stats{grid-template-columns:repeat(2,1fr);gap:20px 12px}.stat strong{font-size:28px}}
  @media(max-width:600px){
    h1{font-size:28px}.sleep-page{padding-top:24px}
    .night-nav{gap:8px}.night-date strong{font-size:19px}
    .night-main,.side-card,.routine{padding:18px 14px}
    .routine-row{grid-template-columns:44px 1fr;gap:8px}
    .routine-time{display:none}
    .routine-axis{margin-left:52px}
  }
</style>
