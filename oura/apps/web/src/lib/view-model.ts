import {
  BUILD,
  READY_LABELS,
  SLEEP_LABELS,
  WDAY,
  avg,
  axisLabel,
  fmtDelta,
  isWeekend,
  metricTrendPhrase,
  rangeAvgWord,
  rangeLabelText,
  readinessColor,
  round0,
  round1,
  shortDate,
  sliceDays,
  sparkPaths,
  trendDelta,
  wdayLabel,
} from "./format";
import { buildInsights } from "./insights";
import type { BarRow, Day, HeatCell, SummaryCard } from "./types";

export type ViewModel = {
  days: Day[];
  latest: Day | undefined;
  statusText: string;
  rangeLabel: string;
  cards: SummaryCard[];
  takeSRA: string;
  takeGauge: string;
  gaugeHint: string;
  gaugeScore: string;
  gaugeSub: string;
  readyScore: number | null;
  rAvg: number | null;
  takeDonut: string;
  donutHigh: number;
  donutMid: number;
  donutLow: number;
  takeSteps: string;
  stepsAvg: number | null;
  takeRadar: string;
  radarHint: string;
  radarVals: number[];
  heatTitle: string;
  heatHint: string;
  takeHeat: string;
  heatStrip: boolean;
  heatWdays: string[];
  heatCells: HeatCell[];
  takeAvg: string;
  avgHint: string;
  avgRows: [string, string][];
  takeCmp: string;
  cmpRows: [string, string, string][];
  insights: string[];
  sleepContribDate: string;
  readyContribDate: string;
  takeSleepContrib: string;
  takeReadyContrib: string;
  sleepBars: BarRow[];
  readyBars: BarRow[];
  labels: string[];
  sleepSeries: (number | null)[];
  readySeries: (number | null)[];
  actSeries: (number | null)[];
  stepsSeries: (number | null)[];
};

function contribBars(
  labels: Record<string, string>,
  contrib: Record<string, number | null | undefined> | null | undefined,
): { rows: BarRow[]; take: string } {
  if (!contrib) {
    return { rows: [], take: "暂无贡献项数据" };
  }
  const entries = Object.keys(labels)
    .map((k) => ({
      key: k,
      label: labels[k],
      val: contrib[k],
    }))
    .filter((e): e is { key: string; label: string; val: number } => typeof e.val === "number");
  entries.sort((a, b) => a.val - b.val);
  const weakKeys = new Set(entries.slice(0, 2).map((e) => e.key));
  const rows = entries.map((e) => ({
    key: e.key,
    label: e.label,
    val: e.val,
    weak: weakKeys.has(e.key),
  }));
  let take = "暂无贡献项数据";
  if (entries.length) {
    const w = entries.slice(0, 2);
    take = "瓶颈「" + w.map((x) => x.label + " " + Math.round(x.val)).join("」「") + "」· 已按低→高排序";
  }
  return { rows, take };
}

function makeHeatCell(key: string, v: number | null): HeatCell {
  if (v != null) {
    return {
      key,
      score: v,
      pad: false,
      color: readinessColor(v),
      tip: key.slice(5) + " · " + v,
      title: key + " · 准备度 " + v,
    };
  }
  return {
    key,
    score: null,
    pad: false,
    title: key + " · 无数据",
  };
}

function padHeatCell(key: string): HeatCell {
  return { key, score: null, pad: true, title: "" };
}

function buildHeatmap(days: Day[], rangeDays: number): {
  title: string;
  hint: string;
  strip: boolean;
  wdays: string[];
  cells: HeatCell[];
} {
  if (!days.length) {
    return { title: "准备度热力", hint: "所选区间每日 readiness", strip: true, wdays: [], cells: [] };
  }
  const strip = days.length <= 7 || rangeDays === 7;
  if (strip) {
    const wdays = days.map((d) => wdayLabel(d.date));
    while (wdays.length < 7) wdays.push("");
    const cells = days.map((d) => {
      const v =
        d.readiness && typeof d.readiness.score === "number" ? d.readiness.score : null;
      return makeHeatCell(d.date, v);
    });
    while (cells.length < 7) cells.push(padHeatCell("pad-" + cells.length));
    return {
      title: "准备度热力 · 近一周",
      hint: "按日顺序一排展示，不再按日历错位",
      strip: true,
      wdays,
      cells,
    };
  }

  const byDate: Record<string, number | null> = {};
  days.forEach((d) => {
    byDate[d.date] =
      d.readiness && typeof d.readiness.score === "number" ? d.readiness.score : null;
  });
  const start = new Date(days[0].date + "T00:00:00");
  const end = new Date(days[days.length - 1].date + "T00:00:00");
  const cells: HeatCell[] = [];
  const dow = (start.getDay() + 6) % 7;
  for (let i = 0; i < dow; i++) cells.push(padHeatCell("lead-" + i));
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const dd = String(cur.getDate()).padStart(2, "0");
    const key = y + "-" + m + "-" + dd;
    cells.push(makeHeatCell(key, byDate[key] != null ? byDate[key] : null));
    cur.setDate(cur.getDate() + 1);
  }
  return {
    title: "准备度热力日历",
    hint: "按周一对齐的日历格 · 空格为区间外",
    strip: false,
    wdays: WDAY.slice(),
    cells,
  };
}

export function computeViewModel(allDays: Day[], rangeDays: number): ViewModel {
  const days = sliceDays(allDays, rangeDays);
  const days30 = sliceDays(allDays, 30);
  const days90 = sliceDays(allDays, 90);
  const latest = days[days.length - 1];

  const sAvg = avg(days.map((d) => d.sleep && d.sleep.score));
  const rAvg = avg(days.map((d) => d.readiness && d.readiness.score));
  const aAvg = avg(days.map((d) => d.activity && d.activity.score));
  const stepsAvg = avg(days.map((d) => d.activity && d.activity.steps));
  const calAvg = avg(days.map((d) => d.activity && d.activity.active_calories));

  const s30 = avg(days30.map((d) => d.sleep && d.sleep.score));
  const r30 = avg(days30.map((d) => d.readiness && d.readiness.score));
  const a30 = avg(days30.map((d) => d.activity && d.activity.score));
  const st30 = avg(days30.map((d) => d.activity && d.activity.steps));
  const s90 = avg(days90.map((d) => d.sleep && d.sleep.score));
  const r90 = avg(days90.map((d) => d.readiness && d.readiness.score));
  const a90 = avg(days90.map((d) => d.activity && d.activity.score));
  const st90 = avg(days90.map((d) => d.activity && d.activity.steps));

  const sleepTrend = trendDelta(days.map((d) => d.sleep && d.sleep.score));
  const readyTrend = trendDelta(days.map((d) => d.readiness && d.readiness.score));
  const actTrend = trendDelta(days.map((d) => d.activity && d.activity.score));

  const avgWord = rangeAvgWord(rangeDays);
  const cardSpecs = [
    {
      label: "睡眠",
      score: latest && latest.sleep ? latest.sleep.score : null,
      meta: "最新 " + (latest ? latest.date : "—") + " · " + avgWord + " " + round1(sAvg),
      delta: sleepTrend,
      series: days.map((d) => d.sleep && d.sleep.score),
    },
    {
      label: "准备度",
      score: latest && latest.readiness ? latest.readiness.score : null,
      meta: "最新 " + (latest ? latest.date : "—") + " · " + avgWord + " " + round1(rAvg),
      delta: readyTrend,
      series: days.map((d) => d.readiness && d.readiness.score),
    },
    {
      label: "活动",
      score: latest && latest.activity ? latest.activity.score : null,
      meta:
        "最新步数 " +
        (latest && latest.activity ? round0(latest.activity.steps) : "—") +
        " · " +
        avgWord +
        " " +
        round1(aAvg),
      delta: actTrend,
      series: days.map((d) => d.activity && d.activity.score),
    },
  ];
  const cards: SummaryCard[] = cardSpecs.map((c) => {
    const spark = sparkPaths(c.series);
    return {
      label: c.label,
      score: c.score,
      meta: c.meta,
      delta: c.delta,
      sparkLine: spark?.line ?? "",
      sparkArea: spark?.area ?? "",
    };
  });

  const trends = [
    { n: "睡眠", d: sleepTrend },
    { n: "准备度", d: readyTrend },
    { n: "活动", d: actTrend },
  ].filter((t) => t.d != null);
  let sraMsg =
    "区间内均值：睡 " + round1(sAvg) + " · 备 " + round1(rAvg) + " · 活 " + round1(aAvg);
  if (trends.length) {
    const ranked = trends.slice().sort((a, b) => Math.abs(b.d as number) - Math.abs(a.d as number));
    const top = ranked[0];
    if (Math.abs(top.d as number) >= 2) {
      sraMsg =
        '<span class="hi">' +
        metricTrendPhrase(top.n, top.d) +
        "</span> · " +
        trends
          .filter((t) => t !== top)
          .map((t) => metricTrendPhrase(t.n, t.d))
          .join(" · ");
    } else {
      sraMsg =
        "三项半程均较平稳 · 睡/备/活均值 " +
        round1(sAvg) +
        "/" +
        round1(rAvg) +
        "/" +
        round1(aAvg);
    }
  }
  const wdDays = days.filter((d) => !isWeekend(d.date));
  const weDays = days.filter((d) => isWeekend(d.date));
  const rWd = avg(wdDays.map((d) => d.readiness && d.readiness.score));
  const rWe = avg(weDays.map((d) => d.readiness && d.readiness.score));
  const sWd = avg(wdDays.map((d) => d.sleep && d.sleep.score));
  const sWe = avg(weDays.map((d) => d.sleep && d.sleep.score));
  if (rWd != null && rWe != null && weDays.length) {
    const dlt = rWe - rWd;
    sraMsg +=
      ' · <span class="hi">周末备均 ' +
      round1(rWe) +
      "</span> / 工作日 " +
      round1(rWd) +
      "（" +
      fmtDelta(dlt) +
      "）";
    if (sWd != null && sWe != null) {
      sraMsg += " · 睡 " + round1(sWe) + "/" + round1(sWd);
    }
  } else if (!weDays.length) {
    sraMsg += " · 本区间无周末样本";
  }

  const readyScore =
    latest && latest.readiness && typeof latest.readiness.score === "number"
      ? latest.readiness.score
      : null;
  const rRef = rAvg;
  let gaugeMsg = "暂无准备度";
  if (readyScore != null && rRef != null) {
    const diff = readyScore - rRef;
    const verdict = readyScore >= 85 ? "适合练" : readyScore >= 70 ? "可轻度活动" : "宜恢复";
    const span = rangeDays === 7 ? "近一周" : "近" + rangeDays + "天";
    gaugeMsg =
      (diff >= 0 ? "高于" : "低于") +
      span +
      "均值（" +
      fmtDelta(diff) +
      '）· <span class="hi">' +
      verdict +
      "</span>";
  } else if (readyScore != null) {
    gaugeMsg = "今日有分 · 区间均值不足";
  }

  let high = 0;
  let mid = 0;
  let low = 0;
  days.forEach((d) => {
    const s = d.activity && d.activity.steps;
    if (typeof s !== "number") return;
    if (s >= 8000) high++;
    else if (s >= 4000) mid++;
    else low++;
  });
  const donutTotal = high + mid + low;
  const buckets = [
    { label: "活跃≥8k", n: high },
    { label: "适中4–8k", n: mid },
    { label: "偏低<4k", n: low },
  ].sort((a, b) => b.n - a.n);
  let takeDonut = "暂无步数档位数据";
  if (donutTotal) {
    const top = buckets[0];
    const pct = Math.round((top.n / donutTotal) * 100);
    takeDonut =
      '主导档「<span class="hi">' +
      top.label +
      "</span>」占 " +
      pct +
      "%（" +
      top.n +
      "/" +
      donutTotal +
      " 天）";
  }

  let peakDay: string | null = null;
  let peakSteps = -1;
  days.forEach((d) => {
    const s = d.activity && d.activity.steps;
    if (typeof s === "number" && s > peakSteps) {
      peakSteps = s;
      peakDay = d.date;
    }
  });
  let takeSteps = "暂无步数数据";
  if (peakDay != null && stepsAvg != null) {
    takeSteps =
      '峰值 <span class="hi">' +
      shortDate(peakDay) +
      " · " +
      round0(peakSteps) +
      "</span> 步 · 日均 " +
      round0(stepsAvg) +
      " · 橙=高于均值";
  }

  const readyKeys = Object.keys(READY_LABELS);
  const radarPairs = readyKeys
    .map((k) => {
      const c = latest && latest.readiness && latest.readiness.contributors;
      return { k, label: READY_LABELS[k], v: c && typeof c[k] === "number" ? c[k] : null };
    })
    .filter((x): x is { k: string; label: string; v: number } => x.v != null);
  radarPairs.sort((a, b) => a.v - b.v);
  let takeRadar = "暂无贡献项";
  if (radarPairs.length) {
    const weak = radarPairs[0];
    takeRadar =
      '瓶颈「<span class="hi">' +
      weak.label +
      "</span>」" +
      Math.round(weak.v) +
      " · 最强「" +
      radarPairs[radarPairs.length - 1].label +
      "」" +
      Math.round(radarPairs[radarPairs.length - 1].v);
  }

  const rScores = days
    .map((d) => d.readiness && d.readiness.score)
    .filter((n): n is number => typeof n === "number");
  const lowDays = rScores.filter((n) => n < 70).length;
  const highDays = rScores.filter((n) => n >= 85).length;
  let wdSum = 0;
  let wdN = 0;
  let weSum = 0;
  let weN = 0;
  days.forEach((d) => {
    const s = d.readiness && d.readiness.score;
    if (typeof s !== "number") return;
    const dow = new Date(d.date + "T00:00:00").getDay();
    if (dow === 0 || dow === 6) {
      weSum += s;
      weN++;
    } else {
      wdSum += s;
      wdN++;
    }
  });
  let heatMsg = "低日(<70) " + lowDays + " · 高日(≥85) " + highDays;
  if (wdN && weN) {
    heatMsg += " · 工作日均 " + round1(wdSum / wdN) + " / 周末均 " + round1(weSum / weN);
  }

  const cmpParts: string[] = [];
  if (s30 != null && s90 != null)
    cmpParts.push("睡眠30天" + (s30 >= s90 ? "↑" : "↓") + round1(Math.abs(s30 - s90)));
  if (r30 != null && r90 != null)
    cmpParts.push("准备度" + (r30 >= r90 ? "↑" : "↓") + round1(Math.abs(r30 - r90)));
  if (st30 != null && st90 != null)
    cmpParts.push("步数" + (st30 >= st90 ? "↑" : "↓") + round0(Math.abs(st30 - st90)));

  const sleepC = contribBars(SLEEP_LABELS, latest?.sleep?.contributors);
  const readyC = contribBars(READY_LABELS, latest?.readiness?.contributors);
  const heat = buildHeatmap(days, rangeDays);

  const readyContribDate = latest
    ? latest.date +
      " · 准备度 " +
      (latest.readiness ? latest.readiness.score : "—") +
      (latest.readiness && typeof latest.readiness.temperature_deviation === "number"
        ? " · 体温偏差 " +
          (latest.readiness.temperature_deviation > 0 ? "+" : "") +
          latest.readiness.temperature_deviation.toFixed(2) +
          "°C"
        : "")
    : "—";

  return {
    days,
    latest,
    statusText:
      "已加载 " +
      allDays.length +
      " 天 · 展示近 " +
      days.length +
      " 天 · " +
      (days[0] ? days[0].date : "") +
      " → " +
      (latest ? latest.date : "") +
      " · " +
      BUILD,
    rangeLabel: rangeLabelText(rangeDays),
    cards,
    takeSRA: sraMsg,
    takeGauge: gaugeMsg,
    gaugeHint: latest ? latest.date : "",
    gaugeScore: readyScore != null ? String(readyScore) : "—",
    gaugeSub: rRef != null ? "均 " + round1(rRef) : "",
    readyScore,
    rAvg,
    takeDonut,
    donutHigh: high,
    donutMid: mid,
    donutLow: low,
    takeSteps,
    stepsAvg,
    takeRadar,
    radarHint: latest ? latest.date + " · readiness contributors" : "最新一日贡献项",
    radarVals: readyKeys.map((k) => {
      const c = latest && latest.readiness && latest.readiness.contributors;
      return c && typeof c[k] === "number" ? (c[k] as number) : 0;
    }),
    heatTitle: heat.title,
    heatHint: heat.hint,
    takeHeat: heatMsg,
    heatStrip: heat.strip,
    heatWdays: heat.wdays,
    heatCells: heat.cells,
    takeAvg:
      "近" +
      rangeDays +
      "天综合：睡 " +
      round1(sAvg) +
      " · 备 " +
      round1(rAvg) +
      " · 活 " +
      round1(aAvg) +
      " · 步 " +
      round0(stepsAvg),
    avgHint:
      "近 " +
      rangeDays +
      " 天（" +
      (days[0] ? days[0].date : "") +
      " → " +
      (latest ? latest.date : "") +
      "）",
    avgRows: [
      ["睡眠得分", round1(sAvg)],
      ["准备度得分", round1(rAvg)],
      ["活动得分", round1(aAvg)],
      ["日均步数", round0(stepsAvg)],
      ["日均活动卡路里", round0(calAvg)],
    ],
    takeCmp: cmpParts.length ? "相对90天：" + cmpParts.join(" · ") : "对比数据不足",
    cmpRows: [
      ["睡眠", round1(s30), round1(s90)],
      ["准备度", round1(r30), round1(r90)],
      ["活动", round1(a30), round1(a90)],
      ["步数", round0(st30), round0(st90)],
    ],
    insights: buildInsights(days30, days90),
    sleepContribDate: latest
      ? latest.date + " · 睡眠得分 " + (latest.sleep ? latest.sleep.score : "—")
      : "—",
    readyContribDate,
    takeSleepContrib: sleepC.take,
    takeReadyContrib: readyC.take,
    sleepBars: sleepC.rows,
    readyBars: readyC.rows,
    labels: days.map((d) => axisLabel(d.date)),
    sleepSeries: days.map((d) => (d.sleep && typeof d.sleep.score === "number" ? d.sleep.score : null)),
    readySeries: days.map((d) =>
      d.readiness && typeof d.readiness.score === "number" ? d.readiness.score : null,
    ),
    actSeries: days.map((d) =>
      d.activity && typeof d.activity.score === "number" ? d.activity.score : null,
    ),
    stepsSeries: days.map((d) =>
      d.activity && typeof d.activity.steps === "number" ? d.activity.steps : null,
    ),
  };
}
