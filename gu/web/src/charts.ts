import { escapeHtml as e } from "./markdown";
import type { Row } from "../../worker/dashboard-types";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: unknown, digits = 1) => {
  const n = num(v);
  return n === null ? "—" : `${(n * 100).toFixed(digits)}%`;
};
// Percentage points, not percent: an allocation gap reads as 55.8 个百分点.
const points = (v: number, digits = 1) => `${v === 0 ? "" : v > 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(digits)}`;

const SERIES = ["GOOGL", "NVDA", "VOO", "XLV", "港股"];
const SERIES_COLOR: Record<string, string> = {
  GOOGL: "#6d8f79",
  NVDA: "#a3421c",
  VOO: "#4a6b86",
  XLV: "#8a8577",
  港股: "#b9a58c",
};

interface Gap {
  ticker: string;
  weight: number;
  target: number | null;
  gap: number | null;
}

/**
 * 配置缺口：每行一条轨道，实心是当前权重，竖线是目标权重。
 *
 * 几何数值走 data-w / data-l / data-i，由 dom.ts 在渲染后用 CSSOM 赋值：
 * 站点 CSP 是 style-src 'self'，浏览器会丢弃写在 HTML 里的 style 属性。
 */
export function allocationGap(rows: Row[]) {
  const items = rows
    .map(row => {
      const weight = num(row.weight);
      const target = num(row.target);
      return { ticker: String(row.ticker), weight, target,
               gap: weight !== null && target !== null ? weight - target : null };
    })
    .filter((item): item is Gap => item.weight !== null);
  if (!items.length) return "";
  // One shared axis so bar lengths stay comparable across rows.
  const axis = Math.max(0.1, ...items.map(i => Math.max(i.weight, i.target ?? 0))) * 1.08;
  const sorted = [...items].sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));
  return `<div class="chart chart-gap">
    <div class="chart-legend">
      <span class="key key-bar">当前权重</span>
      <span class="key key-target">目标 / 最低保留线</span>
      <span class="chart-unit">偏离：百分点</span>
    </div>
    <div class="gap-axis-row"><div></div>
      <div class="gap-axis">${[0, .25, .5, .75, 1].map(f =>
        `<span data-l="${f * 100}">${pct(axis * f, 0)}</span>`).join("")}</div>
      <div></div><div></div></div>
    <div class="gap-rows">${sorted.map((item, i) => {
      const minimum = item.ticker === "现金";
      const state = item.gap === null ? "even" : item.gap > 0.0005 ? minimum ? "buffer" : "over" : item.gap < -0.0005 ? "under" : "even";
      return `<div class="gap-row" data-i="${i}">
        <div class="gap-name"><strong>${e(item.ticker)}</strong></div>
        <div class="gap-track">
          <div class="gap-fill ${state}" data-w="${(item.weight / axis) * 100}"></div>
          ${item.target === null ? "" :
            `<div class="gap-mark" data-l="${(item.target / axis) * 100}"></div>`}
        </div>
        <div class="gap-number"><b>${pct(item.weight)}</b><small>${minimum ? "最低" : "目标"} ${pct(item.target)}</small></div>
        <div class="gap-delta ${state}">${item.gap === null ? "—" : points(item.gap)}</div>
      </div>`;
    }).join("")}</div>
    <p class="fine">缺口 = 当前权重 − 目标权重；权重分母为估算总资产。现金显示高于最低保留线的缓冲，不代表需减至 14%。</p></div>`;
}

// 现金规则距离 398%，线性刻度会把其余规则挤在起点，因此用平方根刻度压缩远端。
const RAIL_MAX = 4;
const RAIL_TICKS = [0, .05, .15, .5, 1, 2, 4];
const railPos = (distance: number) => Math.sqrt(Math.min(distance, RAIL_MAX) / RAIL_MAX);

interface Rule {
  item: string;
  kind: string;
  current: string;
  threshold: string;
  action: string;
  level: string;
  proximity: string;
  distance: number | null;
  triggered: boolean;
}

/** 风控距离：所有规则共用一条距离轴，阴影是 5% / 15% 临近带。 */
export function riskRail(rows: Row[]) {
  const items: Rule[] = rows.map(row => ({
    item: String(row.item), kind: String(row.kind), current: String(row.current),
    threshold: String(row.threshold), action: String(row.action || ""),
    level: String(row.level || ""), proximity: String(row.proximity || "none"),
    distance: num(row.distance), triggered: row.triggered === true,
  }));
  if (!items.length) return "";
  // Closest to its threshold first; rules without a threshold last.
  const sorted = [...items].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  const critical = railPos(.05) * 100;
  const near = railPos(.15) * 100;
  return `<div class="chart chart-rail">
    <div class="chart-legend">
      <span class="key key-critical">≤${pct(.05, 0)} 需三日内书面决策</span>
      <span class="key key-near">≤${pct(.15, 0)} 需当天临近分析</span>
      <span class="chart-unit">距离：占阈值的百分比</span>
    </div>
    <div class="rail-head">
      <div></div>
      <div class="rail-ticks">${RAIL_TICKS.map(t =>
        `<span data-l="${railPos(t) * 100}">${pct(t, 0)}${t === RAIL_MAX ? "+" : ""}</span>`).join("")}</div>
      <div class="rail-head-end">距离</div>
    </div>
    ${sorted.map((rule, i) => {
      const state = rule.triggered ? "triggered"
        : rule.distance === null ? "na"
        : rule.proximity === "critical" ? "critical"
        : rule.proximity === "near" ? "near" : "clear";
      const label = rule.triggered ? "已触发"
        : rule.distance === null ? "不适用"
        : rule.proximity === "critical" ? "需三日内决策"
        : rule.proximity === "near" ? "需当天分析" : "未临近";
      const caption = rule.triggered || rule.proximity === "near" || rule.proximity === "critical"
        ? `<p>${e(rule.action || rule.level)}</p>` : "";
      return `<div class="rail-row ${state}" data-i="${i}">
        <div class="rail-name"><strong>${e(rule.item)}</strong>
          <small>${e(rule.kind)} · 当前 ${e(rule.current)} · 阈值 ${e(rule.threshold)}</small></div>
        <div class="rail-track">
          <span class="rail-zone zone-critical" data-w="${critical}"></span>
          <span class="rail-zone zone-near" data-l="${critical}" data-w="${near - critical}"></span>
          ${rule.distance === null ? "" :
            `<span class="rail-dot" data-l="${railPos(rule.distance) * 100}"></span>`}
        </div>
        <div class="rail-state"><b>${rule.distance === null ? "—" : pct(rule.distance, 2)}</b>
          <small>${label}</small></div>
        ${caption}
      </div>`;
    }).join("")}
    <p class="fine">距离 = 当前值与阈值之差的绝对值 ÷ 阈值，只表示远近；是否触发由规则符号单独判定。
      刻度经平方根压缩，用于展开近端、压缩远端。</p></div>`;
}

export function historyDetail(row: Row) {
  const weights = row.weights as Record<string, unknown>;
  return `<div class="history-values" aria-live="polite">
    ${SERIES.filter(t => num(weights[t]) !== null).map(t =>
      `<div><span>${e(t)}</span><strong>${pct(weights[t])}</strong></div>`).join("")}
    </div><p class="fine history-source">${e(row.date)} · ${row.approx ? "历史档案约值" : "本批行情估算"} · 来源：${e(row.source)}</p>`;
}

/** 持仓权重变化：横轴按实际日期间隔，本批行情是最后一个点。 */
export function weightHistory(history: Row[], targets: Record<string, number | null> = {}) {
  const rows = (history || []).filter(row => row && typeof row === "object" &&
    Number.isFinite(Date.parse(String(row.date))) && row.weights && typeof row.weights === "object")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const value = (row: Row, ticker: string) => num((row.weights as Record<string, unknown>)[ticker]);
  const series = SERIES.filter(ticker => rows.some(row => value(row, ticker) !== null));
  if (rows.length < 2 || !series.length) return "";

  const W = 1000, H = 340, L = 54, R = 112, T = 18, B = 38;
  const peak = Math.max(...rows.flatMap(row => series.map(t => value(row, t) ?? 0)));
  const yMax = Math.max(.06, Math.ceil(peak / .05) * .05);
  const start = Date.parse(String(rows[0].date));
  const span = Date.parse(String(rows[rows.length - 1].date)) - start;
  const x = (i: number) => L + (W - L - R) * (span ? (Date.parse(String(rows[i].date)) - start) / span : .5);
  const y = (v: number) => T + (H - T - B) * (1 - v / yMax);

  const grid: string[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += .05) {
    grid.push(`<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" class="grid"/>`);
    grid.push(`<text x="${L - 10}" y="${(y(v) + 4).toFixed(1)}" class="tick" text-anchor="end">${pct(v, 0)}</text>`);
  }

  const refs = [
    { value: targets["NVDA"], label: "NVDA 停买线", cls: "ref-cap" },
    { value: targets["GOOGL"], label: "GOOGL 目标", cls: "ref-target" },
  ].filter(ref => num(ref.value) !== null && (ref.value as number) <= yMax);
  const refLines = refs.map(ref => `<line x1="${L}" y1="${y(ref.value as number).toFixed(1)}"
    x2="${W - R}" y2="${y(ref.value as number).toFixed(1)}" class="ref ${ref.cls}"/>`).join("");
  const refLabels = refs.map(ref =>
    `<span class="key key-target">${e(ref.label)} ${pct(ref.value)}</span>`).join("");

  const lines = series.map(ticker => {
    const data = rows.map((row, i) => ({ i, v: value(row, ticker) }))
      .filter(p => p.v !== null) as { i: number; v: number }[];
    // Missing values break the line instead of implying an observed continuous series.
    const path = data.map((p, i) => `${i && p.i === data[i - 1].i + 1 ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    const last = data[data.length - 1];
    const color = SERIES_COLOR[ticker];
    return `<g class="series">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
      ${data.slice(0, -1).map(p =>
        `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" stroke="${color}" stroke-width="2"><title>${e(rows[p.i].date)} · ${e(ticker)} ${pct(p.v)}</title></circle>`).join("")}
      <circle class="last" cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="5" fill="${color}"><title>${e(rows[last.i].date)} · ${e(ticker)} ${pct(last.v)}</title></circle>
      <text class="series-label" fill="${color}" x="${W - R + 12}" y="${(y(last.v) + 4).toFixed(1)}">${e(ticker)} ${pct(last.v)}</text>
    </g>`;
  }).join("");

  let previousLabel = -Infinity;
  const dates = rows.map((row, i) => {
    const position = x(i);
    const last = i === rows.length - 1;
    if (!last && (position - previousLabel < 60 || x(rows.length - 1) - position < 60)) return "";
    previousLabel = position;
    return `<text class="tick" x="${position.toFixed(1)}" y="${H - 12}" text-anchor="middle">${e(String(row.date).slice(5))}</text>`;
  }).join("");

  return `<div class="chart chart-history">
    <div class="chart-legend">${refLabels}</div>
    <div class="chart-scroll" tabindex="0" role="region" aria-label="持仓权重图，可横向滚动"><svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="各持仓在历次持仓档案中的权重变化">
      ${grid.join("")}${refLines}${lines}${dates}
    </svg></div>
    <p class="fine mobile-chart-hint">横向滑动查看完整日期和各标的曲线；下方可选择记录查看数值。</p>
    <label class="history-picker" for="history-date">查看记录<select id="history-date">${rows.map((row, i) =>
      `<option value="${e(row.source)}" ${i === rows.length - 1 ? "selected" : ""}>${e(row.date)} · ${row.approx ? "档案" : "本批行情"}</option>`).join("")}</select></label>
    <div id="history-detail">${historyDetail(rows[rows.length - 1])}</div>
    <p class="fine">横轴按实际日期间隔，连线只连接记录点，不代表每日走势或收益率。历史权重是档案约值，账户分母口径曾变化；最后一点为本批行情估算。
      现金不进本图：早期档案的现金口径不一致（06-25 把 14% 目标值写成了当前值）。</p></div>`;
}
