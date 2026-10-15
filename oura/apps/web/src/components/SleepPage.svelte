<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorText, RequestError } from "../lib/api";
  import { dateWindow, duration, finite, readSleep, sleepForDay, type SleepRecord } from "../lib/health";
  import type { Locale } from "../lib/i18n";
  import { isDevLoginAllowed, type MeResponse } from "../lib/types";
  import ChromeHeader from "./ChromeHeader.svelte";
  import ArchiveStatus from "./ArchiveStatus.svelte";

  let { me, locale, onUnauthorized, onLogout }: { me: MeResponse; locale: Locale; onUnauthorized: () => void; onLogout: () => void } = $props();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  let range = $state(7);
  let records = $state<SleepRecord[]>([]);
  let selectedDay = $state("");
  let selectedId = $state("");
  let loading = $state(true);
  let syncing = $state(false);
  let error = $state("");
  let syncError = $state("");
  let verified = $state(false);
  let syncedAt = $state<string | null>(null);
  let revision = 0;
  const days = $derived([...new Set(records.map(r => r.day))].sort());
  const periods = $derived(sleepForDay(records, selectedDay));
  const selected = $derived(periods.find(r => r.id === selectedId) ?? periods[0]);
  const stages = $derived([
    { label: text("深睡", "Deep"), value: selected?.deep_sleep_duration, color: "#36465f" },
    { label: "REM", value: selected?.rem_sleep_duration, color: "#9d739b" },
    { label: text("浅睡", "Light"), value: selected?.light_sleep_duration, color: "#f4aa69" },
    { label: text("清醒", "Awake"), value: selected?.awake_time, color: "#eadfd4" },
  ]);
  const stageTotal = $derived(stages.reduce((sum, s) => sum + (finite(s.value) && s.value >= 0 ? s.value : 0), 0));
  const calendar = $derived.by(() => {
    const { from } = dateWindow(range);
    return Array.from({ length: range }, (_, index) => {
      const day = new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10);
      const record = sleepForDay(records, day)[0];
      return { day, seconds: record?.total_sleep_duration };
    });
  });
  const maximum = $derived(Math.max(3600, ...calendar.map(d => finite(d.seconds) ? d.seconds : 0)));
  function kind(row: SleepRecord) {
    if (row.type === "long_sleep") return text("主睡眠", "Main sleep");
    if (row.type === "sleep") return text("短睡眠 / 小睡", "Short sleep / nap");
    if (row.type === "rest") return text("休息", "Rest");
    if (row.type === "late_nap") return text("晚间小睡", "Late nap");
    return text("睡眠记录", "Sleep record");
  }
  function clock(value?: string) {
    // Preserve the recorded timezone; rendering in the browser zone can shift travel nights.
    return value?.match(/T(\d{2}:\d{2})/)?.[1] ?? "—";
  }
  function value(number: unknown, unit: string) {
    return finite(number) ? `${Number(number.toFixed(1))} ${unit}` : "—";
  }
  function choose(day: string) { selectedDay = day; selectedId = ""; }
  async function load() {
    const current = ++revision;
    loading = true;
    error = "";
    records = [];
    verified = false;
    syncedAt = null;
    const { from, to } = dateWindow(range);
    try {
      const result = await readSleep(from, to);
      if (current !== revision) return;
      records = result.records;
      verified = result.sync.window_verified;
      syncedAt = result.sync.synced_at;
      syncError = result.sync.error ? errorText(new RequestError(result.sync.error, 0), locale) : "";
      selectedDay = records.some(r => r.day === selectedDay) ? selectedDay : [...records.map(r => r.day)].sort().at(-1) ?? "";
    } catch (err) {
      if (current !== revision) return;
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      error = errorText(err, locale);
    } finally { if (current === revision) loading = false; }
  }
  async function sync() {
    if (syncing || loading) return;
    syncing = true;
    syncError = "";
    const { from, to } = dateWindow(range);
    try {
      await api(`/api/me/health-records?${new URLSearchParams({ collection: "sleep", from, to })}`, { method: "POST" });
      await load();
    } catch (err) {
      if (err instanceof RequestError && err.status === 401 && err.code === "unauthorized") { onUnauthorized(); return; }
      syncError = errorText(err, locale);
    } finally { syncing = false; }
  }
  onMount(() => { if (me.capabilities?.personal) void load(); else loading = false; return () => { revision++; }; });
</script>

<ChromeHeader {locale} active="/sleep" isDev={isDevLoginAllowed(me.allowDevLogin) && me.source === "dev"} {onLogout} />
<main class="wrap page sleep-page">
  <header class="sleep-heading">
    <div><h1>{text("睡眠与恢复", "Sleep & recovery")}</h1><p class="sub">{text("看见每一次睡眠，也看见恢复的变化。", "Every sleep period, with room to see what changes.")}</p></div>
    <div class="sleep-controls">
      <div role="group" aria-label={text("睡眠日期范围", "Sleep date range")}>
        {#each [7, 30] as n}<button class:active={range === n} aria-pressed={range === n} disabled={loading || syncing || !me.capabilities?.personal} onclick={() => { range = n; void load(); }}>{n} {text("天", "days")}</button>{/each}
      </div>
      <button class="ai-btn" disabled={syncing || loading || !me.capabilities?.personal} onclick={sync}>{syncing ? text("同步中…", "Syncing…") : text("同步此区间", "Sync this range")}</button>
    </div>
  </header>
  <p class="sleep-coverage">{dateWindow(range).from} — {dateWindow(range).to} · {text("已保存", "Saved")} {days.length}/{range} {text("天", "days")} · {records.length} {text("段记录", "periods")}</p>
  <p class="hint">{text("日期遵循 Oura 的睡眠归属日。此页读取已保存记录，点击同步更新所选区间。", "Dates follow Oura's assigned sleep day. This page reads saved records; sync to update the selected range.")}</p>
  {#if syncedAt}<p class="hint">{text("此区间同步于", "Range synced")} {new Date(syncedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en")}</p>{/if}
  {#if syncError}<div class="sleep-notice" role="alert">{syncError} <a href="/settings">{text("查看数据设置", "Open data settings")}</a></div>{/if}
  {#if !me.capabilities?.personal}
    <div class="sleep-empty">{text("详细睡眠目前仅向个人工作区开放。", "Detailed sleep is currently available to the personal workspace.")}</div>
  {:else if loading}
    <div class="sleep-empty" role="status">{text("正在读取详细睡眠…", "Loading detailed sleep…")}</div>
  {:else if error}
    <div class="sleep-empty" role="alert"><h2>{text("暂时无法读取睡眠", "Sleep records unavailable")}</h2><p>{error}</p><button class="ai-btn" onclick={load}>{text("重试", "Retry")}</button></div>
  {:else if !records.length}
    <div class="sleep-empty" data-testid="sleep-empty">
      <h2>{verified ? text("此区间暂无睡眠记录", "No sleep records in this range") : text("还没有保存的睡眠细节", "No sleep details saved yet")}</h2>
      <p>{verified ? text("已检查此区间，Oura 没有返回记录。可以切换到 30 天查看。", "This range was checked; Oura returned no records. Try the 30-day view.")
        : text("点击「同步此区间」开始采集，或前往数据设置补齐最近 90 天。", "Sync this range to get started, or backfill 90 days in data settings.")}</p>
      <a href="/settings" class="ai-btn">{text("前往数据设置", "Open data settings")}</a>
    </div>
  {:else}
    <section class="sleep-history" aria-label={text("每日睡眠时长", "Daily sleep duration")}>
      <div class="section-title"><h2>{text("睡眠时长", "Sleep duration")}</h2><span>{text("选择一天查看详情", "Select a day for details")}</span></div>
      <div class="sleep-bars">
        {#each calendar as day}
          <button class:chosen={selectedDay === day.day} class:missing={!finite(day.seconds)} onclick={() => choose(day.day)} aria-pressed={selectedDay === day.day} aria-label={`${day.day}: ${duration(day.seconds, locale)}`}>
            <span class="bar-track"><span class="bar-fill" style:height={finite(day.seconds) ? `${Math.max(0, day.seconds) / maximum * 100}%` : "0%"}></span>{#if !finite(day.seconds)}<span class="missing-mark">·</span>{/if}</span>
            <span class="bar-date">{day.day.slice(8)}</span>
          </button>
        {/each}
      </div>
      <p class="hint">{text("每日优先展示主睡眠；没有主睡眠标记时取最长记录。圆点表示没有时长数据，不代表 0。", "Each day shows main sleep, or the longest record if not identified. A dot means no duration data, never zero.")}</p>
    </section>
    <div class="sleep-day-heading">
      <label class="sleep-date-picker">{text("查看日期", "View date")}
        <select value={selectedDay} onchange={event => choose(event.currentTarget.value)}>
          {#each calendar as day}<option value={day.day}>{day.day}</option>{/each}
        </select>
      </label>
      <div class="period-picker" role="group" aria-label={text("选择睡眠记录", "Choose sleep period")}>
        {#each periods as period}
          <button aria-pressed={selected?.id === period.id} class:active={selected?.id === period.id} onclick={() => { selectedId = period.id; }}>{kind(period)} {clock(period.bedtime_start)}</button>
        {/each}
      </div>
    </div>
    {#if selected}
      <section class="sleep-detail" data-testid="sleep-detail">
        <div class="sleep-duration">
          <p>{kind(selected)} · {text("实际睡眠", "Time asleep")}</p>
          <h2 data-testid="sleep-duration">{duration(selected.total_sleep_duration, locale)}</h2>
          <p>{clock(selected.bedtime_start)} — {clock(selected.bedtime_end)}</p>
          <p class="hint">{text("时间按记录中的当地时间显示", "Times shown as recorded locally")}</p>
          <dl><div><dt>{text("卧床时间", "Time in bed")}</dt><dd>{duration(selected.time_in_bed, locale)}</dd></div><div><dt>{text("睡眠效率", "Sleep efficiency")}</dt><dd>{value(selected.efficiency, "%")}</dd></div></dl>
        </div>
        <div class="sleep-stages">
          <h3>{text("睡眠组成", "Sleep composition")}</h3>
          <p class="hint">{text("各阶段的累计时长，不表示先后顺序。", "Cumulative time by stage, not a chronological timeline.")}</p>
          {#if stageTotal > 0}<div class="stage-strip" aria-hidden="true">{#each stages as stage}{#if finite(stage.value) && stage.value > 0}<span style:width={`${stage.value / stageTotal * 100}%`} style:background={stage.color}></span>{/if}{/each}</div>{/if}
          <dl>{#each stages as stage}<div><dt><span class="stage-dot" style:background={stage.color}></span>{stage.label}</dt><dd>{duration(stage.value, locale)}</dd></div>{/each}</dl>
          {#if stages.some(s => !finite(s.value))}<p class="hint">{text("部分阶段未提供，比例仅基于已有时长。", "Some stages are unavailable; proportions use reported durations only.")}</p>{/if}
        </div>
      </section>
      <section class="recovery-metrics" aria-label={text("本段睡眠恢复指标", "Recovery metrics for this sleep")}>
        {#each [
          [text("平均 HRV", "Average HRV"), value(selected.average_hrv, "ms")],
          [text("平均心率", "Average heart rate"), value(selected.average_heart_rate, "bpm")],
          [text("最低心率", "Lowest heart rate"), value(selected.lowest_heart_rate, "bpm")],
          [text("平均呼吸频率", "Average breathing rate"), value(selected.average_breath, text("次/分", "/min"))],
        ] as metric}<div><h3>{metric[0]}</h3><p>{metric[1]}</p></div>{/each}
      </section>
      <p class="hint">{text("指标来自本段睡眠原始记录；— 表示未提供。这些数据不用于诊断。", "Metrics come from this sleep record; — means unavailable. These data are not a diagnosis.")}</p>
    {:else}<div class="sleep-empty">{text("这一天没有保存的睡眠记录，请选择其他日期。", "No saved sleep records for this day. Select another date.")}</div>{/if}
  {/if}
  {#if me.capabilities?.personal}<ArchiveStatus {locale} {onUnauthorized} refreshKey={syncedAt} />{/if}
</main>

<style>
  .sleep-page{padding-top:36px}.sleep-heading,.sleep-controls,.section-title,.sleep-day-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
  h1{font-size:36px;letter-spacing:-.04em}.sub{font-size:15px;margin-top:8px}.sleep-controls{gap:10px}.sleep-controls button,.period-picker button{padding:10px 14px;border:1px solid var(--line);background:white;border-radius:10px;color:var(--muted);cursor:pointer;font:inherit;font-size:13px}.sleep-controls button.active,.period-picker button.active{color:#9a3412;background:var(--peach);border-color:#ea9d66}
  button:disabled{cursor:wait;opacity:.6}.sleep-controls [role=group]{display:flex;gap:5px}.sleep-coverage{margin-top:24px;font-size:14px;color:var(--muted)}.hint{line-height:1.65;margin:8px 0;font-size:12px}.sleep-notice{padding:16px;background:var(--peach);color:#9a3412;border:1px solid var(--line);border-radius:12px;margin:16px 0}.sleep-notice a{text-decoration:underline}
  .sleep-empty{padding:48px 24px;border:1px dashed var(--line);border-radius:20px;margin:24px 0;text-align:center;color:var(--muted)}.sleep-empty h2{color:var(--ink);font-size:23px}.sleep-empty p{margin:12px auto 20px;max-width:520px}.sleep-empty .ai-btn{display:inline-flex}
  .sleep-history{margin:28px 0;padding:24px;background:white;border:1px solid var(--line);border-radius:20px}.section-title h2{font-size:18px}.section-title span{font-size:12px;color:var(--muted)}.sleep-bars{display:flex;gap:4px;margin:24px 0 12px;height:160px}.sleep-bars button{flex:1;min-width:0;background:transparent;border:0;cursor:pointer;color:var(--muted);border-radius:6px;padding:2px}.bar-track{height:130px;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid var(--line);position:relative}.bar-fill{display:block;width:70%;max-width:50px;background:#fbc798;border-radius:5px 5px 0 0;min-height:0}.chosen .bar-fill{background:#ea580c}.chosen .bar-date{font-weight:700;color:#9a3412}.missing-mark{font-size:22px;position:absolute;bottom:0}.bar-date{font-size:10px;display:block;margin-top:6px}
  .sleep-day-heading{margin:30px 0 16px}.period-picker{display:flex;gap:8px;flex-wrap:wrap}.sleep-detail{display:grid;grid-template-columns:1fr 1fr;background:white;border:1px solid var(--line);border-radius:20px;overflow:hidden}.sleep-duration{padding:32px;background:linear-gradient(130deg,#fff0df,#fffaf5)}.sleep-duration>p:first-child{color:#9a3412;font-size:14px}.sleep-duration h2{font-size:42px;letter-spacing:-.04em;margin:8px 0}.sleep-stages{padding:32px}.sleep-stages h3{font-size:17px}dl{margin-top:20px}dl>div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;font-size:14px}dt{color:var(--muted);display:flex;align-items:center;gap:8px}dd{font-variant-numeric:tabular-nums}.stage-strip{display:flex;height:20px;border-radius:6px;overflow:hidden;margin-top:24px}.stage-dot{width:9px;height:9px;border-radius:50%;display:inline-block}.recovery-metrics{display:grid;grid-template-columns:repeat(4,1fr);padding:24px 0;gap:24px}.recovery-metrics>div{border-left:2px solid var(--line);padding-left:18px}.recovery-metrics h3{font-size:13px;color:var(--muted);font-weight:500}.recovery-metrics p{font-size:26px;margin-top:8px;font-variant-numeric:tabular-nums}
  @media(max-width:600px){h1{font-size:28px}.sleep-heading{align-items:flex-start}.sleep-detail{grid-template-columns:1fr}.sleep-duration,.sleep-stages{padding:24px}.sleep-duration h2{font-size:34px}.recovery-metrics{grid-template-columns:1fr 1fr;gap:22px 12px}.recovery-metrics p{font-size:23px}.sleep-history{padding:18px 10px}.sleep-bars{gap:1px}.sleep-bars button{padding:0}.sleep-bars button:nth-child(even):not(.chosen) .bar-date{visibility:hidden}.sleep-controls{width:100%}.sleep-page{padding-top:24px}}
  .sleep-date-picker{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--muted)}
  .sleep-date-picker select{font:inherit;font-size:16px;min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)}
  .sleep-date-picker select:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
</style>
