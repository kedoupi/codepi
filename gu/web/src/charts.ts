import { escapeHtml as e } from "./markdown";
import { proximityRequirement } from "./risk-summary";
import type { Row } from "../../worker/dashboard-types";
import { percent, ruleCurrent, ruleAction, weight } from "./format";

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const pct = percent;
// Percentage points, not percent: an allocation gap reads as 55.8 个百分点.
const points = (v: number, digits = 1) =>
  `${v === 0 ? "" : v > 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(digits)}`;

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
    .map((row) => {
      const current = num(weight(row));
      const target = num(row.target);
      return {
        ticker: String(row.ticker),
        weight: current,
        target,
        gap: current !== null && target !== null ? current - target : null,
      };
    })
    .filter((item): item is Gap => item.weight !== null);
  if (!items.length) return "";
  // One shared axis so bar lengths stay comparable across rows.
  const axis =
    Math.max(0.1, ...items.map((i) => Math.max(i.weight, i.target ?? 0))) *
    1.08;
  const sorted = [...items].sort(
    (a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0),
  );
  return `<div class="chart chart-gap">
    <div class="chart-legend">
      <span class="key key-bar">当前权重</span>
      <span class="key key-target">目标 / 最低保留线</span>
      <span class="chart-unit">偏离：百分点</span>
    </div>
    <div class="gap-axis-row"><div></div>
      <div class="gap-axis">${[0, 0.25, 0.5, 0.75, 1]
        .map((f) => `<span data-l="${f * 100}">${pct(axis * f, 0)}</span>`)
        .join("")}</div>
      <div></div><div></div></div>
    <div class="gap-rows">${sorted
      .map((item, i) => {
        const minimum = item.ticker === "现金";
        const state =
          item.gap === null
            ? "even"
            : item.gap > 0.0005
              ? minimum
                ? "buffer"
                : "over"
              : item.gap < -0.0005
                ? "under"
                : "even";
        return `<div class="gap-row" data-i="${i}">
        <div class="gap-name"><strong>${e(item.ticker)}</strong></div>
        <div class="gap-track">
          <div class="gap-fill ${state}" data-w="${(item.weight / axis) * 100}"></div>
          ${
            item.target === null
              ? ""
              : `<div class="gap-mark" data-l="${(item.target / axis) * 100}"></div>`
          }
        </div>
        <div class="gap-number"><b>${pct(item.weight)}</b><small>${minimum ? "最低" : "目标"} ${pct(item.target)}</small></div>
        <div class="gap-delta ${state}">${item.gap === null ? "—" : points(item.gap)}</div>
      </div>`;
      })
      .join("")}</div>
    <p class="fine">缺口 = 当前权重 − 目标权重；权重分母为估算总资产。现金显示高于最低保留线的缓冲，不代表需减至 14%。</p></div>`;
}

/**
 * 风控图横轴表示「余量」，不是「距离」。
 *
 * 规范把 distance 定义为 |当前值 − 阈值| ÷ 阈值（恒非负），是否触发由规则符号
 * 单独判定。图上还需要表达方向，所以位置量用带符号的余量：
 *
 *     margin = triggered ? -distance : +distance
 *
 * 符号只依赖 triggered：已触发本身就意味着越线，不需要解析 threshold 字符串里的
 * > / ≥ / <，因此不会和规范里的运算符判定产生分歧。
 *
 * 量程必须同时容纳 NVDA 停买线的 −7% 和现金 / 基金的 +399%。单一线性轴会把七条
 * 未触发规则挤进不到 13% 的宽度：实测 473px 轨道上五个标记相距 5–10px，而旧标记
 * 直径 11px，必然重叠。因此分两段线性：
 *
 *     [−20%, +60%]  → 轨道 [0%, 82%]    近端展开，两条决策线落在这一段
 *     [+60%, +400%] → 轨道 [82%, 100%]  远端压缩，只服务余量极大的规则
 *
 * 断点按当前规则集选取：七条未触发规则的余量在 +34.8% … +70.2%，只有现金 / 基金
 * （+399%）落在第二段。规则集变化后需要重新核对这四个常量。
 */
const RAIL_FLOOR = -0.2;
const RAIL_NEAR_END = 0.6;
const RAIL_CEILING = 4;
const RAIL_NEAR_RATIO = 0.82;

/** 规范的两条临近线：≤5% 需 3 个交易日内书面决策，≤15% 需当天临近分析。 */
const RAIL_CRITICAL = 0.05;
const RAIL_NEAR = 0.15;

/** 余量 → 轨道百分比（0–100）。导出以便回归测试直接验证刻度分离度。 */
export function marginPosition(margin: number) {
  const low = Math.max(RAIL_FLOOR, margin);
  if (low <= RAIL_NEAR_END) {
    return (
      ((low - RAIL_FLOOR) / (RAIL_NEAR_END - RAIL_FLOOR)) *
      RAIL_NEAR_RATIO *
      100
    );
  }
  const beyond = Math.min(low, RAIL_CEILING) - RAIL_NEAR_END;
  return (
    (RAIL_NEAR_RATIO +
      (beyond / (RAIL_CEILING - RAIL_NEAR_END)) * (1 - RAIL_NEAR_RATIO)) *
    100
  );
}

// 0 是阈值本身，两侧分别是已触发与余量。桌面显示全部刻度，窄屏靠 CSS 隐去 0 与
// 相隔过近的 −15%，避免刻度文字互相压叠（实测 309px 轨道上会只剩 2px 间隙）。
const RAIL_TICKS = [
  { margin: -RAIL_NEAR, label: `−${pct(RAIL_NEAR, 0)}` },
  { margin: -RAIL_CRITICAL, label: `−${pct(RAIL_CRITICAL, 0)}` },
  { margin: 0, label: "0", desktopOnly: true },
  { margin: RAIL_CRITICAL, label: `+${pct(RAIL_CRITICAL, 0)}` },
  { margin: RAIL_NEAR, label: `+${pct(RAIL_NEAR, 0)}` },
  { margin: RAIL_NEAR_END, label: `+${pct(RAIL_NEAR_END, 0)}` },
];

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
  margin: number | null;
}

/**
 * 风控余量：所有规则共用一条以阈值为原点的轴。
 *
 * 触发状态单独判断并单独显示，横轴位置只表示在阈值的哪一侧、离多远；右侧的数字
 * 仍然是规范定义的绝对距离。
 */
export function riskRail(rows: Row[]) {
  const items: Rule[] = rows.map((row) => {
    const distance = num(row.distance);
    const triggered = row.triggered === true;
    return {
      item: String(row.item),
      kind: String(row.kind),
      current: ruleCurrent(row),
      threshold: String(row.threshold),
      action: ruleAction(row),
      level: String(row.level || ""),
      proximity: String(row.proximity || "none"),
      distance,
      triggered,
      margin: distance === null ? null : triggered ? -distance : distance,
    };
  });
  if (!items.length) return "";
  // 余量最小（越线最多或最接近阈值）的规则排在最前；没有阈值的规则最后。
  const sorted = [...items].sort(
    (a, b) => (a.margin ?? Infinity) - (b.margin ?? Infinity),
  );
  const zero = marginPosition(0);
  const criticalEdge = marginPosition(RAIL_CRITICAL);
  const nearEdge = marginPosition(RAIL_NEAR);
  const farEdge = marginPosition(RAIL_NEAR_END);
  return `<div class="chart chart-rail">
    <div class="chart-legend">
      <span class="key key-critical">0–${pct(RAIL_CRITICAL, 0)} 需 3 个交易日内书面决策</span>
      <span class="key key-near">${pct(RAIL_CRITICAL, 0)}–${pct(RAIL_NEAR, 0)} 需当天临近分析</span>
      <span class="chart-direction">已触发在阈值左侧，余量在右侧</span>
    </div>
    <div class="rail-head">
      <div class="rail-head-start">已触发 ← 阈值 → 余量</div>
      <div class="rail-ticks">${RAIL_TICKS.map(
        (t) =>
          `<span class="${t.desktopOnly ? "rail-tick-inline" : ""}" data-l="${marginPosition(t.margin)}">${e(t.label)}</span>`,
      ).join("")}</div>
      <div class="rail-head-end">距离</div>
    </div>
    ${sorted
      .map((rule, i) => {
        const state =
          rule.distance === null
            ? "na"
            : rule.triggered
              ? "triggered"
              : rule.proximity === "critical"
                ? "critical"
                : rule.proximity === "near"
                  ? "near"
                  : "clear";
        const nearLabel =
          rule.proximity === "critical"
            ? "需 3 个交易日内决策"
            : rule.proximity === "near"
              ? "需当天分析"
              : "";
        const label =
          rule.distance === null
            ? "不适用"
            : rule.triggered
              ? nearLabel
                ? `已触发 · ${nearLabel}`
                : "已触发"
              : nearLabel || "未临近";
        const requirement = proximityRequirement(rule.proximity);
        const caption =
          rule.triggered ||
          rule.proximity === "near" ||
          rule.proximity === "critical"
            ? `<p>${e([rule.action || rule.level, requirement].filter(Boolean).join("；"))}</p>`
            : "";
        return `<div class="rail-row ${state}" data-i="${i}">
        <div class="rail-name"><strong>${e(rule.item)}</strong>
          <small>${e(rule.kind)} · 当前 ${e(rule.current)} · 阈值 ${e(rule.threshold)}</small></div>
        <div class="rail-track">
          <span class="rail-zone zone-crossed" data-l="0" data-w="${zero}"></span>
          <span class="rail-zone zone-critical" data-l="${zero}" data-w="${criticalEdge - zero}"></span>
          <span class="rail-zone zone-near" data-l="${criticalEdge}" data-w="${nearEdge - criticalEdge}"></span>
          <span class="rail-zone zone-far" data-l="${farEdge}" data-w="${100 - farEdge}"></span>
          <span class="rail-line line-critical" data-l="${criticalEdge}"></span>
          <span class="rail-line line-near" data-l="${nearEdge}"></span>
          <span class="rail-zero" data-l="${zero}"></span>
          ${rule.margin === null ? "" : `<span class="rail-dot" data-l="${marginPosition(rule.margin)}"></span>`}
        </div>
        <div class="rail-state"><b>${rule.distance === null ? "—" : pct(rule.distance, 2)}</b>
          <small>${label}</small></div>
        ${caption}
      </div>`;
      })
      .join("")}
    <p class="fine">横轴以阈值为原点：左侧是已触发，右侧是到阈值的余量，单位是占阈值的百分比。
      右侧数字仍是规范定义的绝对距离（＝当前值与阈值之差的绝对值 ÷ 阈值），是否触发由规则符号单独判定，
      与图中位置无关。最右一段为压缩显示，只用于容纳现金 / 基金这类余量极大的规则。</p></div>`;
}

export function historyDetail(row: Row) {
  const weights = (row.weights_raw ?? row.weights) as Record<string, unknown>;
  return `<div class="history-values" aria-live="polite">
    ${SERIES.filter((t) => num(weights[t]) !== null)
      .map(
        (t) =>
          `<div><span>${e(t)}</span><strong>${pct(weights[t])}</strong></div>`,
      )
      .join("")}
    </div><p class="fine history-source">${e(row.date)} · ${row.approx ? "历史档案约值" : "本批行情估算"} · 来源：${e(row.source)}</p>`;
}

/** 持仓权重变化：横轴按实际日期间隔，本批行情是最后一个点。 */
export function weightHistory(
  history: Row[],
  targets: Record<string, number | null> = {},
) {
  const rows = (history || [])
    .filter(
      (row) =>
        row &&
        typeof row === "object" &&
        Number.isFinite(Date.parse(String(row.date))) &&
        row.weights &&
        typeof row.weights === "object",
    )
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const value = (row: Row, ticker: string) =>
    num(((row.weights_raw ?? row.weights) as Record<string, unknown>)[ticker]);
  const series = SERIES.filter((ticker) =>
    rows.some((row) => value(row, ticker) !== null),
  );
  if (rows.length < 2 || !series.length) return "";

  const W = 1000,
    H = 340,
    L = 54,
    R = 112,
    T = 18,
    B = 38;
  const peak = Math.max(
    ...rows.flatMap((row) => series.map((t) => value(row, t) ?? 0)),
  );
  const yMax = Math.max(0.06, Math.ceil(peak / 0.05) * 0.05);
  const start = Date.parse(String(rows[0].date));
  const span = Date.parse(String(rows[rows.length - 1].date)) - start;
  const x = (i: number) =>
    L +
    (W - L - R) *
      (span ? (Date.parse(String(rows[i].date)) - start) / span : 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - v / yMax);

  const grid: string[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += 0.05) {
    grid.push(
      `<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" class="grid"/>`,
    );
    grid.push(
      `<text x="${L - 10}" y="${(y(v) + 4).toFixed(1)}" class="tick" text-anchor="end">${pct(v, 0)}</text>`,
    );
  }

  const refs = [
    { value: targets["NVDA"], label: "NVDA 停买线", cls: "ref-cap" },
    { value: targets["GOOGL"], label: "GOOGL 目标", cls: "ref-target" },
  ].filter((ref) => num(ref.value) !== null && (ref.value as number) <= yMax);
  const refLines = refs
    .map(
      (ref) => `<line x1="${L}" y1="${y(ref.value as number).toFixed(1)}"
    x2="${W - R}" y2="${y(ref.value as number).toFixed(1)}" class="ref ${ref.cls}"/>`,
    )
    .join("");
  const refLabels = refs
    .map(
      (ref) =>
        `<span class="key key-target">${e(ref.label)} ${pct(ref.value)}</span>`,
    )
    .join("");

  const lines = series
    .map((ticker) => {
      const data = rows
        .map((row, i) => ({ i, v: value(row, ticker) }))
        .filter((p) => p.v !== null) as { i: number; v: number }[];
      // Missing values break the line instead of implying an observed continuous series.
      const path = data
        .map(
          (p, i) =>
            `${i && p.i === data[i - 1].i + 1 ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`,
        )
        .join(" ");
      const last = data[data.length - 1];
      const color = SERIES_COLOR[ticker];
      return `<g class="series">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
      ${data
        .slice(0, -1)
        .map(
          (p) =>
            `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" stroke="${color}" stroke-width="2"><title>${e(rows[p.i].date)} · ${e(ticker)} ${pct(p.v)}</title></circle>`,
        )
        .join("")}
      <circle class="last" cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="5" fill="${color}"><title>${e(rows[last.i].date)} · ${e(ticker)} ${pct(last.v)}</title></circle>
      <text class="series-label" fill="${color}" x="${W - R + 12}" y="${(y(last.v) + 4).toFixed(1)}">${e(ticker)} ${pct(last.v)}</text>
    </g>`;
    })
    .join("");

  let previousLabel = -Infinity;
  const dates = rows
    .map((row, i) => {
      const position = x(i);
      const last = i === rows.length - 1;
      if (
        !last &&
        (position - previousLabel < 60 || x(rows.length - 1) - position < 60)
      )
        return "";
      previousLabel = position;
      return `<text class="tick" x="${position.toFixed(1)}" y="${H - 12}" text-anchor="middle">${e(String(row.date).slice(5))}</text>`;
    })
    .join("");

  return `<div class="chart chart-history">
    <div class="chart-legend">${refLabels}</div>
    <div class="chart-scroll" tabindex="0" role="region" aria-label="持仓权重图，可横向滚动"><svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="各持仓在历次持仓档案中的权重变化">
      ${grid.join("")}${refLines}${lines}${dates}
    </svg></div>
    <p class="fine mobile-chart-hint">横向滑动查看完整日期和各标的曲线；下方可选择记录查看数值。</p>
    <label class="history-picker" for="history-date">查看记录<select id="history-date">${rows
      .map(
        (row, i) =>
          `<option value="${e(row.source)}" ${i === rows.length - 1 ? "selected" : ""}>${e(row.date)} · ${row.approx ? "档案" : "本批行情"}</option>`,
      )
      .join("")}</select></label>
    <div id="history-detail">${historyDetail(rows[rows.length - 1])}</div>
    <p class="fine">横轴按实际日期间隔，连线只连接记录点，不代表每日走势或收益率。历史权重是档案约值，账户分母口径曾变化；最后一点为本批行情估算。
      现金不进本图：早期档案的现金口径不一致（06-25 把 14% 目标值写成了当前值）。</p></div>`;
}
