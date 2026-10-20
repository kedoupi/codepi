# Health design fidelity QA

Date: 2026-10-20. Scope: sleep, weekly reading and comparison, desktop and mobile.

## Visual truth and capture normalization

Approved sources live in
`/Users/codepi/.codex/generated_images/01a156d7-b1ac-7f23-a26a-88ee0ce9ea05/`:

| Screen | Source | Source pixels |
| --- | --- | --- |
| Sleep desktop | `call_lClBc1krcdZLODmZSUAO2IKO.png` | 1386 x 1135 |
| Sleep mobile | `call_H3Bei4I3y0sVriC5jonfvZoD.png` | 724 x 2172 |
| Weekly desktop | `call_9oWr0rEgFzVn2MCRvV8K2BE7.png` | 1353 x 1163 |
| Weekly mobile | `call_dPFVz2xNwRip31j5D8CVLMvj.png` | 724 x 2172 |
| Compare desktop | `call_nxEvpzoXOws5zImKPXVnCdbU.png` | 1423 x 1105 |
| Compare mobile | `call_OSsfR5PGB11RlWIEzvA7iHHr.png` | 724 x 2172 |

Implementation: local synthetic fixture, `http://127.0.0.1:4188`.
Captures use the Codex in-app browser. Desktop viewport: 1386 x 1135 CSS px;
mobile: 390 x 844 CSS px. PNGs exclude a 15 px browser scrollbar, at 1x density.
Source mobile images are design boards at approximately 2x density; comparison
boards normalize both images to the same content width, without changing aspect
ratio. No device frame is present. Fixture values are synthetic, not personal data.
The shared 1120 px content limit, existing brand and Health palette are product
constraints; these are explicitly retained. Data values, gaps and date labels vary
with the saved dataset. Do not treat those as design drift.

## Iteration 1: before correction

Full-view evidence: `/tmp/health-design-qa/compare-before-{sleep,weekly,compare}-{desktop,mobile}.png`.
Each board contains the approved design and browser capture together.
Original captures: `/tmp/health-design-qa/before-{sleep,weekly,compare}-{desktop,mobile}.png`.

- [P1] Layout: large rounded panels replace the approved flat, ruled report layout.
  This adds padding and substantially changes screen density on all three pages.
  Fix: scope report styles separately from generic workspace panels.
- [P1] Sleep chart: a run of identical stages is parsed as a single five-minute
  point, losing its duration. The hypnogram clusters at the left edge.
  Fix: retain every five-minute sample before merging adjacent stages.
- [P1] Sleep summary: the baseline includes naps and counts them as nights.
  Fix: select one explicit main sleep per prior day.
- [P1] Mobile compare: opening a metric leaves its chart below every other metric;
  distribution dots do not encode values. Fix: inline mobile detail and scale
  distribution positions to measured values, using one common axis.
- [P2] Typography: metric units are as prominent as numerals; current/reference
  values are vertically stacked in weekly findings. Fix: number/unit hierarchy
  and aligned value pairs.
- [P2] Charts: axes and baseline labels become unreadable as SVGs shrink; pressure
  and recovery appear in two separate charts. Fix: viewport-aware chart dimensions,
  readable axes and paired bars on one daily axis.
- [P2] Copy/content: redundant weekly summaries, disclaimers and status cards
  precede the primary evidence. Fix: lead with the three findings and consolidate
  source/status notes; retain summary access for non-personal accounts.
- [P2] Mobile layout: composition repeats as an oversized separate card, life-log
  entries become a two-column grid, and comparison values lack per-column labels.
  Fix: compact stage legend after hypnogram, single-column log and labeled pairs.

## Iteration 2: rendered report layout

Evidence: `/tmp/health-design-qa/compare-after-{sleep,weekly,compare}-{desktop,mobile}.png`
and `/tmp/health-design-qa/compare-v2-{sleep,weekly,compare}-{desktop,mobile}.png`.
The first group restored the ruled layout and inline mobile comparison.
The second added the connected sleep-stage plot and shortened the chart stacks.

- Resolved the iteration 1 P1 findings: stages now preserve their full five-minute
  duration; naps are excluded from main-sleep baselines and nightly comparisons.
  Missing calendar days remain visible without zero-filled metrics.
- [P2] Mobile density: inherited line boxes, full-height charts and generous
  finding spacing still extended the pages beyond the reference rhythm.
  Fix: explicit number/unit line heights, responsive plot heights and compact
  finding/log spacing. Operational source disclosures remain below the report.
- [P2] Sleep date and history: the native date text clipped, and a generic
  `.range` selector applied pill-control dimensions to the history band.
  Fix: explicit visible date label plus native calendar input; scoped
  `.history-middle` instead of the generic class.
- [P2] Compare distribution: duration axis labels crowded each other.
  Fix: short hour ticks; retain exact values in point titles.
- [P2] Custom date controls: moving the current end before the selected start
  produced a zero-day interval. Fix: translate both ends by the same offset;
  reject an empty/invalid custom start.
- [P2] Mobile chart switching: synchronous dimension bindings triggered
  `ResizeObserver loop completed with undelivered notifications`.
  Fix: a shared chart-width action updates layout in the next animation frame
  and retains the last valid width while a chart is hidden. The strict browser
  error checks remain enabled.

## Required fidelity surfaces

- Fonts/typography: shared Avenir Next/PingFang font retained; scale, units, weight,
  line-height and wrapping were corrected.
- Spacing/layout rhythm: flat sections, aligned value pairs and mobile ordering
  are restored. Source/status controls add content below the primary report.
- Colors/tokens: Health warm canvas and orange accent retained; sleep blue,
  recovery green and reference gray used consistently.
- Image quality/assets: these screens contain data charts, not raster artwork.
  Existing shared brand asset is retained. Charts must render actual data.
- Copy/content: evidence and coverage stay visible without duplicate summaries;
  missing values and sparse samples remain explicit. The headline describes the
  direction; individual findings supply exact changes.

## Implementation checklist

1. Correct stage duration and main-sleep reference calculations with regression tests.
2. Restore flat report surfaces and metric hierarchy.
3. Restore chart axes, grouped bars and true distributions.
4. Correct mobile content order and comparison expansion.
5. Recapture all six views, inspect focused regions and exercise interactions.

## Iteration 3: final verification

Evidence: `/tmp/health-design-qa/final-{sleep,weekly,compare}-{desktop,mobile}.png`
and side-by-side boards
`/tmp/health-design-qa/compare-final-{sleep,weekly,compare}-{desktop,mobile}.png`
plus focused mobile regions `/tmp/health-design-qa/focus-{sleep,weekly,compare}-mobile.png`.
A copy of these boards and the final captures also lives in
`/Users/codepi/.codex/visualizations/2026/10/20/01a156d7-b1ac-7f23-a26a-88ee0ce9ea05/health-fidelity-qa/`.

- All iteration 2 findings are resolved: mobile density, date controls,
  distribution ticks, custom range length and the ResizeObserver warning.
- Focused review of both viewports found no remaining P0/P1/P2 divergence.
  Remaining differences are the retained product constraints listed above
  (shared brand header, Health palette, 1120 px content limit) plus
  dataset-dependent values, which are not design drift.

final result: passed


## Previous overview QA (historical evidence, retained verbatim)

# Oura 每日简报 · 设计 QA 报告（2026-10-14）

## 结果：通过

已登录概览页按用户选定的「A / 每日简报」方向重做，并以真实 API 数据驱动。

## 参考与截图

- 参考图（用户选定）：`~/.codex/generated_images/01a133c0-489a-7c73-a9e0-e12fba37c4b7/call_Yk3CpATIp5jPdNtdoCllCiK1.png`（1536×1024）
- 桌面最终版：`/tmp/oura-journal-qa/desktop-final.png`（1536×1024）
- 桌面整页：`/tmp/oura-journal-qa/desktop-final-full.png`
- 移动端：`/tmp/oura-journal-qa/mobile-v2.png`、`mobile-v2-calendar.png`（390×844）
- 英文版：`/tmp/oura-journal-qa/en-v2.png`

## 与参考图的有意差异

- 保留现有导航（概览/睡眠/本周解读/对比/设置/账号），未采用参考图虚构的「节奏/图谱/探索」路由。
- 保留原有 BrandMark 环形标识，未使用参考图的头像。
- HRV 参考带为真实的历史 Q25–Q75 经验区间（静态浅色带），并注明「不代表医学正常范围」，不虚构逐日变化的参考带。
- 观察语为确定性的数据陈述（基于有效记录天数），不写诊断性结论。
- 增加了可展开的数据表、覆盖说明与数据/设置入口（可访问性与自助排查需要）。

## 迭代记录

- v1：日历（y≈1134）与图表区低于 1024 视口折叠线 → 压缩标题、评分条与图表高度，日历升至 y≈989。
- v1：移动端（390px）闭合的图表数据表仍占位导致横向溢出 → 为 `details:not([open])` 增加显式隐藏规则，修复后回归断言通过。
- v2 桌面/移动/英文/空数据四态截图复核，无控制台错误。

## 验证

- `pnpm build`（前端 + API dry-run）通过。
- `pnpm typecheck`：0 错误、0 警告。
- 单元测试：`apps/web/test/*.test.mjs` 18 通过（journal 数据模型：缺日、无效分、主睡眠优先、HRV 仅取主睡眠、参考带最少 14 天且不含当天等）。
- 全量测试：`pnpm test` 100 项通过（含 worker 单测 30、集成 52）。
- 浏览器回归（Ego TaskSpace 23）：30 项全部通过，覆盖免费/账号权限、语言持久化、睡眠分页与缺失、配额提示、移动端 390px 无横向溢出。
- 交互抽查：7/14/30 天切换、准备度日历选中、图表数据表展开、AI 抽屉焦点陷阱 + Escape 关闭 + 焦点恢复。

## 遗留说明

- 预览数据为本地 fixture 示例数据（loopback），非真实健康数据。
- 观察语句在有效记录稀少时会退化为「变化不大」的保守表述，这是有意设计。
