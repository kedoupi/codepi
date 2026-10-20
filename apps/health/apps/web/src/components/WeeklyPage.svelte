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
  const end = $state(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
  const ranges = $derived(rollingRanges(end));

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
    const parts: string[] = [];
    if (sleepCompare && Math.abs(sleepCompare.delta) >= 5) {
      parts.push(sleepCompare.delta > 0
        ? text(`平均每晚多睡了 ${Math.round(sleepCompare.delta)} 分钟`, `${Math.round(sleepCompare.delta)} more minutes per night`)
        : text(`平均每晚少睡了 ${Math.round(Math.abs(sleepCompare.delta))} 分钟`, `${Math.round(Math.abs(sleepCompare.delta))} fewer minutes per night`));
    }
    if (hrvCompare && Math.abs(hrvCompare.delta) >= 1) {
      parts.push(hrvCompare.delta > 0
        ? text(`夜间 HRV 上移 ${Math.round(hrvCompare.delta)} ms`, `overnight HRV up ${Math.round(hrvCompare.delta)} ms`)
        : text(`夜间 HRV 下移 ${Math.round(Math.abs(hrvCompare.delta))} ms`, `overnight HRV down ${Math.round(Math.abs(hrvCompare.delta))} ms`));
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
      api<DailyResponse>("/api/me/daily?days=30").then(result => result.days ?? []).catch(() => []),
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
    const stop = watchCalendarDay(() => { payload = null; sleeps = []; void load(); });
    return () => { stop(); disposed = true; revision++; };
  });
</script>

<div id="dash-view">
  <ChromeHeader isDev={me.allowDevLogin === true && me.source === "dev"} {locale} active="/insights" {onLogout} />
  <main class="wrap page weekly-page">
    <header class="weekly-heading">
      <div>
        <div class="kicker">{text("二次解读 · 不改官方分数", "Secondary reading · official scores unchanged")}</div>
        <h1>{text("7 天解读", "7-day reading")}</h1>
        <p class="range-line">{ranges.current.from} — {ranges.current.to} · {text("对照", "vs")} {ranges.previous.from} — {ranges.previous.to} · {text("北京时间", "Asia/Shanghai")}</p>
      </div>
      <a class="ai-btn" href="/compare" onclick={(event) => { event.preventDefault(); goto("/compare"); }}>{text("打开完整对比", "Open full comparison")}</a>
    </header>

    <h2 class="weekly-headline">{headline}</h2>
    <p class="coverage">{coverageLine}</p>
    <p class="disclaimer-banner" role="note"><strong>{t(locale, "notMedical")}</strong><span> / {t(locale, "notMedicalEn")}</span></p>

    {#if status}<div class="status" class:err={statusErr}>{status}</div>{/if}
    {#if statusErr}
      <button class="ai-btn" onclick={load}>{text("重试", "Retry")}</button>
      {#if needsReconnect}<a class="ai-btn" href="/api/auth/oura/start">{text("重新连接 Oura", "Reconnect Oura")}</a>{/if}
    {/if}
    {#if payload?.sync}<SyncStatus sync={payload.sync} {locale} />{/if}

    {#if payload?.summaries?.length}
      <section class="panel weekly-summary">
        <h2>{text("这一周的记录摘要", "This week's record summary")}</h2>
        <p class="hint">
          {locale === "zh" ? "近 7 天" : "Last 7 days"}：
          {payload.thisPeriod?.from ?? ""} → {payload.thisPeriod?.to ?? ""}
          · {locale === "zh" ? "此前 7 天" : "Preceding 7 days"}：
          {payload.lastPeriod?.from ?? ""} → {payload.lastPeriod?.to ?? ""}
        </p>
        <ul class="insight-lines">
          {#each payload.summaries as line, i (`sum-${i}`)}
            <li>{line}</li>
          {/each}
        </ul>
      </section>

      {#if me.capabilities?.personal}
      <section class="panel finding">
        <div class="finding-lead">
          <span class="eyebrow">{text("睡眠", "Sleep")}</span>
          <h3>{sleepCompare && Math.abs(sleepCompare.delta) >= 5
            ? (sleepCompare.delta > 0
              ? text(`平均每晚多睡了 ${Math.round(sleepCompare.delta)} 分钟`, `${Math.round(sleepCompare.delta)} more minutes per night`)
              : text(`平均每晚少睡了 ${Math.round(Math.abs(sleepCompare.delta))} 分钟`, `${Math.round(Math.abs(sleepCompare.delta))} fewer minutes per night`))
            : text("睡眠时长与此前 7 天接近", "Sleep duration is close to the previous week")}</h3>
          <p class="big">{fmtMinutes(sleepCompare?.current ?? (seriesOf(sleepSeries).mean === null ? null : seriesOf(sleepSeries).mean! / 60))}</p>
          <p class="against">{text("此前", "Before")} {fmtMinutes(sleepCompare?.previous ?? (seriesOf(prevSleepSeries).mean === null ? null : seriesOf(prevSleepSeries).mean! / 60))}</p>
          <p class="evidence">{text(`有效记录 ${seriesOf(sleepSeries).count}/7 晚 · 对照 ${seriesOf(prevSleepSeries).count}/7 晚`, `valid ${seriesOf(sleepSeries).count}/7 nights · reference ${seriesOf(prevSleepSeries).count}/7`)}</p>
          {#if longNights.length}
            <p class="note">{text(`${longNights.map(day => day.slice(5).replace("-", "/")).join("、")} 的睡眠较长。`, `Longer nights: ${longNights.map(day => day.slice(5).replace("-", "/")).join(", ")}.`)}</p>
          {/if}
          <a class="text-link" href="/sleep" onclick={(event) => { event.preventDefault(); goto("/sleep"); }}>{text("查看这几晚的睡眠", "Open these nights")} →</a>
        </div>
        <div class="finding-chart">
          <h4>{text("每晚实际睡眠", "Time asleep per night")}</h4>
          <MiniBars
            locale={locale}
            series={sleepSeries.map(point => ({ date: point.date, value: point.value === null ? null : point.value / 60 }))}
            baseline={sleepCompare?.previous ?? null}
            format={value => duration(value * 60, locale)}
            color="#8fa3b8"
          />
        </div>
      </section>

      <section class="panel finding">
        <div class="finding-lead">
          <span class="eyebrow">{text("夜间恢复记录", "Overnight recovery")}</span>
          <h3>{hrvCompare && Math.abs(hrvCompare.delta) >= 1
            ? (hrvCompare.delta > 0
              ? text(`主睡眠 HRV 均值上移 ${Math.round(hrvCompare.delta)} ms`, `Main-sleep HRV up ${Math.round(hrvCompare.delta)} ms`)
              : text(`主睡眠 HRV 均值下移 ${Math.round(Math.abs(hrvCompare.delta))} ms`, `Main-sleep HRV down ${Math.round(Math.abs(hrvCompare.delta))} ms`))
            : text("主睡眠 HRV 与此前接近", "Main-sleep HRV is close to the previous week")}</h3>
          <p class="big">{seriesOf(hrvSeries).mean === null ? "—" : Math.round(seriesOf(hrvSeries).mean!)}<small> ms</small></p>
          <p class="against">{text("此前", "Before")} {seriesOf(prevHrvSeries).mean === null ? "—" : `${Math.round(seriesOf(prevHrvSeries).mean!)} ms`}</p>
          <p class="evidence">{text(`有效记录 ${seriesOf(hrvSeries).count}/7 晚 · 对照 ${seriesOf(prevHrvSeries).count}/7 晚`, `valid ${seriesOf(hrvSeries).count}/7 nights · reference ${seriesOf(prevHrvSeries).count}/7`)}</p>
          <a class="text-link" href="/sleep" onclick={(event) => { event.preventDefault(); goto("/sleep"); }}>{text("查看逐晚记录", "Open nightly records")} →</a>
        </div>
        <div class="finding-chart">
          <h4>{text("每晚主睡眠 HRV", "Main-sleep HRV per night")}</h4>
          <MiniLine locale={locale} series={hrvSeries} baseline={hrvCompare?.previous ?? null} unit=" ms" />
        </div>
      </section>

      <section class="panel finding">
        <div class="finding-lead">
          <span class="eyebrow">{text("压力与恢复", "Stress & recovery")}</span>
          <h3>{recoveryCompare && Math.abs(recoveryCompare.delta) >= 5
            ? (recoveryCompare.delta > 0
              ? text(`有记录日，恢复时长增加 ${Math.round(recoveryCompare.delta)} 分钟`, `Recovery time up ${Math.round(recoveryCompare.delta)} min on recorded days`)
              : text(`有记录日，恢复时长减少 ${Math.round(Math.abs(recoveryCompare.delta))} 分钟`, `Recovery time down ${Math.round(Math.abs(recoveryCompare.delta))} min on recorded days`))
            : text("恢复时长与此前接近", "Recovery time is close to the previous week")}</h3>
          <p class="big">{seriesOf(recoverySeries).mean === null ? "—" : Math.round(seriesOf(recoverySeries).mean!)}<small> {text("分钟/日", "min/day")}</small></p>
          <p class="against">{text("此前", "Before")} {seriesOf(prevRecoverySeries).mean === null ? "—" : `${Math.round(seriesOf(prevRecoverySeries).mean!)} ${text("分钟/日", "min/day")}`}</p>
          <p class="evidence">{text(`有效记录 ${stressCoverage.cur}/7 天 · 对照 ${stressCoverage.prev}/7 天`, `valid ${stressCoverage.cur}/7 days · reference ${stressCoverage.prev}/7`)}</p>
          {#if stressCoverage.cur < 7}<p class="note">{text("记录尚未覆盖全部日期，先看已有的变化。", "Not every day has a record; read the recorded change only.")}</p>{/if}
        </div>
        <div class="finding-chart">
          <h4>{text("每日压力与恢复时长", "Daily stress & recovery time")}</h4>
          <div class="paired">
            <MiniBars locale={locale} series={stressDaySeries} color="#c9b795" format={value => String(Math.round(value))} />
            <MiniBars locale={locale} series={recoverySeries} color="#7c8a76" format={value => String(Math.round(value))} />
          </div>
          <p class="legend"><i class="swatch stress"></i>{text("压力", "Stress")} <i class="swatch recovery"></i>{text("恢复", "Recovery")} · {text("缺失日期保留为空，不计为 0。", "Missing days stay empty, never zero.")}</p>
        </div>
      </section>

      <section class="panel life-log">
        <div class="section-head">
          <h3>{text("这七天里的生活记录", "Life log across these seven days")}</h3>
          <span class="muted">{text("生活记录提供时间线索，不表示因果关系。", "Entries provide time context, not causation.")}</span>
        </div>
        <ul class="life-grid">
          {#each daysOf(ranges.current) as day}
            {@const dayTags = tagsForDay(tags, day)}
            <li class:today={day === end}>
              <span class="life-date">{day.slice(5).replace("-", "/")}</span>
              {#if dayTags.length}
                {#each dayTags.slice(0, 2) as tag}
                  <span class="life-tag">{tagLabel(tag)}{tag.comment ? ` · ${tag.comment}` : ""}</span>
                {/each}
              {:else}
                <span class="life-empty">—</span>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="footnote">{text("基于 Oura 已保存记录 · 缺失不计为 0。", "Based on saved Oura records · missing never counts as zero.")}</p>
      </section>
      {/if}
      {#if payload.tips?.length && !payload.locked}
        <section class="panel">
          <div class="next-watch">
            <strong>{text("继续观察", "Keep watching")}</strong>
            <ul>{#each payload.tips as tip}<li>{tip}</li>{/each}</ul>
          </div>
        </section>
      {:else if payload.locked}
          <p class="hint">{text("当前账号可查看摘要；完整建议需要个人账号权限。", "Summaries are available. Full advice requires personal access.")}</p>
      {/if}
    {:else if !loading && !statusErr}
      <p class="status">{t(locale, "weeklyEmpty")}</p>
    {/if}
  </main>
</div>

<style>
  .weekly-page{padding-top:36px}
  .weekly-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:24px}
  .kicker{color:var(--primary);font-size:12px;letter-spacing:.08em;margin-bottom:10px}
  h1{font-size:36px;letter-spacing:-.04em}
  .range-line{color:var(--muted);font-size:13px;margin-top:8px}
  .weekly-headline{font-size:26px;letter-spacing:-.02em;margin:22px 0 6px}
  .coverage{color:var(--muted);font-size:13px;margin-bottom:16px}
  .muted{color:var(--muted);font-size:12px}
  .finding{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:28px;margin-top:24px}
  .finding-lead .eyebrow{color:var(--primary);font-size:13px}
  .finding-lead h3{font-size:21px;margin:6px 0 14px;letter-spacing:-.02em}
  .finding-lead .big{font-size:42px;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
  .finding-lead .big small{font-size:15px;font-weight:400;color:var(--muted)}
  .finding-lead .against{color:var(--muted);font-size:14px;margin-top:4px}
  .finding-lead .evidence{color:var(--muted);font-size:12px;margin-top:12px}
  .finding-lead .note{font-size:13px;margin-top:8px}
  .text-link{display:inline-block;margin-top:12px;color:var(--primary);font-size:13px;text-decoration:none}
  .finding-chart h4{font-size:14px;margin-bottom:12px}
  .paired{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .legend{font-size:12px;color:var(--muted);margin-top:10px}
  .swatch{display:inline-block;width:10px;height:10px;border-radius:3px;margin:0 6px 0 14px}
  .swatch.stress{background:#c9b795}.swatch.recovery{background:#7c8a76}
  .life-log .section-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}
  .life-grid{list-style:none;margin:18px 0 0;padding:0;display:grid;grid-template-columns:repeat(7,1fr);gap:12px}
  .life-grid li{border-top:2px solid var(--line);padding-top:10px;display:grid;gap:6px;align-content:start;font-size:12px;color:var(--muted)}
  .life-grid li.today{border-top-color:var(--primary)}
  .life-date{font-weight:600;color:var(--ink)}
  .life-tag{background:var(--peach);border-radius:8px;padding:4px 8px;color:#7c4a1e;font-size:11px}
  .life-empty{color:var(--muted)}
  .next-watch{margin-top:22px;border-top:1px solid var(--line);padding-top:16px}
  .next-watch ul{margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.8}
  .footnote{margin-top:18px;font-size:12px;color:var(--muted)}
  @media(max-width:900px){
    .finding{grid-template-columns:1fr;gap:16px}
    .life-grid{grid-template-columns:repeat(2,1fr)}
    .paired{grid-template-columns:1fr}
  }
  @media(max-width:600px){
    .weekly-page{padding-top:24px}
    h1{font-size:28px}
    .weekly-headline{font-size:21px}
    .finding-lead .big{font-size:34px}
  }
</style>
