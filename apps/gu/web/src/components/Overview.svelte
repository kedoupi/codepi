<script lang="ts">
  import { percent as pct, elapsed, reportAction, reportCategory, marketChange } from "../format";
  import {
    allocationGap,
    cashBuffer,
    compositionBar,
    eventTimeline,
    historyDetail,
    weightHistory,
  } from "../charts";
  import {
    accountAlerts,
    overviewRules,
    proximityRequirement,
  } from "../risk-summary";
  import { ruleAction, ruleCurrent } from "../format";
  import { humanizeQuoteError } from "../diagnostics";
  import { money, number, time, tone } from "../lib/format";
  import { chartStyles } from "../action";
  import { navigate } from "../lib/router.svelte";
  import { consumePendingPositionFocus } from "../lib/focus";
  import { filters, session } from "../lib/state.svelte";
  import type { Dashboard, Row } from "../../../worker/dashboard-types";

  let { d }: { d: Dashboard } = $props();

  const a = $derived(d.account[0]);
  const report = $derived(d.reports[0]);
  const relevant = $derived(overviewRules(d.risk));
  const targets = $derived(
    Object.fromEntries(
      d.positions.map((p) => [
        String(p.ticker),
        typeof p.target === "number" ? p.target : null,
      ]),
    ),
  );
  const cashAfter = $derived(
    (typeof a.cash_after_dca_raw === "number" ? a.cash_after_dca_raw : null) ??
      (typeof a.cash_after_dca === "number" ? a.cash_after_dca : null),
  );
  const cashMinimum = $derived(
    d.positions.find((p) => p.ticker === "现金")?.target,
  );
  const cashBufferDiff = $derived(
    typeof cashAfter === "number" && typeof cashMinimum === "number"
      ? cashAfter - cashMinimum
      : null,
  );

  const alertsHtml = $derived(accountAlerts(a.warnings, d.risk));
  const gapHtml = $derived(allocationGap(d.positions));
  const compositionHtml = $derived(compositionBar(d.positions));
  const bufferHtml = $derived(
    cashBuffer(
      cashAfter,
      typeof cashMinimum === "number" ? cashMinimum : null,
      typeof a.dca_amount_usd === "number" ? a.dca_amount_usd : null,
      typeof a.total_usd === "number" ? a.total_usd : null,
      a.cash_as_of,
    ),
  );
  const historyHtml = $derived(weightHistory(d.history ?? [], targets));
  const historyRows = $derived(
    (d.history ?? [])
      .filter(
        (row) =>
          row &&
          typeof row === "object" &&
          Number.isFinite(Date.parse(String(row.date))) &&
          row.weights &&
          typeof row.weights === "object",
      )
      .sort((a, b) => String(a.date).localeCompare(String(b.date))),
  );
  let historySelect = $state("");
  // 选过的历史记录在跨页切换后恢复；无效时回落到最后一条（与图表默认一致）。
  const selectedHistory = $derived(
    historyRows.some((r) => r.source === historySelect || r.source === filters.selectedHistory)
      ? (historyRows.some((r) => r.source === historySelect)
          ? historySelect
          : filters.selectedHistory)
      : (historyRows[historyRows.length - 1]?.source ?? ""),
  );
  const historyDetailHtml = $derived.by(() => {
    const row = historyRows.find((r) => r.source === selectedHistory);
    return row ? historyDetail(row) : "";
  });
  const timelineHtml = $derived(
    session.calendar?.snapshot?.events?.length
      ? eventTimeline(
          session.calendar.snapshot.events,
          session.calendar.last_success?.fetched_at,
        )
      : "",
  );

  function ruleState(r: Row) {
    return r.triggered === null ? "不适用" : r.triggered ? "已触发" : String(r.level);
  }

  /** 图表 → 持仓联动：打标 ticker，跨页交给路由变化后由 Positions 消费。 */
  function onChartClick(event: MouseEvent) {
    const el = (event.target as HTMLElement).closest<HTMLElement>(
      ".composition-segment[data-position], .composition-legend-item[data-position]",
    );
    const ticker = el?.dataset.position;
    if (!ticker) return;
    session.pendingPositionFocus = ticker;
    if (location.hash === "#positions") {
      // 已在持仓页时 hash 不变、无 hashchange，直接消费。
      consumePendingPositionFocus();
    } else {
      navigate("#positions");
    }
  }
</script>

<div class="page-heading">
  <div><p class="muted">守住节奏，持续记录</p><h1>投资总览</h1></div>
  <span class="stamp">行情截至 {a.quote_date}</span>
</div>
{#if alertsHtml}
  <!-- 风控提醒来自可信批次数据，渲染前已由 risk-summary 转义 -->
  <div use:chartStyles>{@html alertsHtml}</div>
{/if}
<p class="freshness">
  批次生成于 {time(a.generated_at)} · {elapsed(a.generated_at)}。刷新只读取已同步数据。行情阶段：{a.quote_status || "未确认"}。
</p>
<div class="data-note">
  <span
    >{a.data_mode === "demo"
      ? "本地演示 · 虚构数据"
      : Number(a.cash_age_days) > 14
        ? "账户待核对"
        : "账户数据日期"}</span
  >持仓确认于 {a.holdings_as_of}；现金记录于 {a.cash_as_of}。行情更新不会改变账户确认日期。
</div>
<section class="surface attention">
  <div class="section-title"><h2>当前需要关注</h2><a href="#positions">全部规则</a></div>
  {#if relevant.length}
    {#each relevant as r (r.rule_id)}
      <article
        class="risk-row {r.triggered
          ? 'triggered'
          : r.proximity === 'critical'
            ? 'near'
            : ''}"
      >
        <div>
          <strong>{r.item}</strong><span
            >{r.kind} · 当前 {ruleCurrent(r)} · 阈值 {r.threshold}</span
          >
        </div>
        <div><b>{ruleState(r)}</b><span>相对距离 {pct(r.distance)}</span></div>
        <p>
          {ruleAction(r)}{proximityRequirement(r.proximity)
            ? `；${proximityRequirement(r.proximity)}`
            : ""}
        </p>
      </article>
    {/each}
  {:else}
    <p class="muted">已计算的规则暂无触发或临近状态。</p>
  {/if}
  <p class="fine">组合单日与月度跌幅等历史条件未评估。以下报告保留当时判断。</p>
</section>
{#if typeof cashAfter === "number"}
  <div class="data-note">
    <span>月投后现金缓冲估算</span
    >{typeof a.dca_amount_usd === "number"
      ? `按本批月投 ${money(a.dca_amount_usd)} 美元估算，`
      : "按本批月投假设估算，"}执行后现金占比约 {pct(cashAfter)}，最低保留线 {pct(
      cashMinimum,
    )}{cashBufferDiff === null
      ? ""
      : `，相差 ${cashBufferDiff >= 0 ? "+" : ""}${(cashBufferDiff * 100).toFixed(1)} 个百分点`}。基于现金记录 {a.cash_as_of}；估算不表示可以下单，仍须核实买入通道及账户。
  </div>
{/if}
<!-- 图表几何通过 data-* 传入，CSP 下由 applyChartStyles 经 CSSOM 应用 -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<section class="overview-graphics" onclick={onChartClick}>
  <div use:chartStyles>{@html compositionHtml}</div>
</section>
<div use:chartStyles>{@html bufferHtml}</div>
<section class="account-strip">
  <div><span>估算总资产 · 美元</span><strong>{money(a.total_usd)}</strong></div>
  <div>
    <span>股票市值 · 美元</span><strong>{money(Number(a.stocks_usd) + Number(a.hk_usd))}</strong>
  </div>
  <div>
    <span>现金与基金 · 美元</span><strong>{money(a.cash_usd)}</strong><small
      >占比 {pct(a.cash_weight_raw ?? a.cash_weight)}</small
    >
  </div>
</section>
<section class="surface">
  <div class="section-title"><h2>配置缺口</h2><a href="#positions">查看持仓</a></div>
  <div use:chartStyles>{@html gapHtml}</div>
</section>
<section class="brief">
  <div class="brief-label">
    最近一期报告 · 当时结论<span>{report ? reportCategory(report.kind) : "尚无报告"}</span>
  </div>
  <div>
    <h2>{report ? reportAction(report.action) : "等待第一份报告"}</h2>
    <p>
      {report
        ? report.headline || "这份历史报告未填写摘要，可打开阅读全文。"
        : "同步后会在这里展示最新报告与行动。"}
    </p>
    {#if report}
      <a class="text-link" href="#reports/{encodeURIComponent(String(report.id))}"
        >阅读历史报告 <span>{report.date} · 交易日 {report.trading_date || "未记录"}</span></a
      >
    {/if}
  </div>
</section>
{#if timelineHtml}
  <section class="surface timeline-card">
    <div class="section-title">
      <h2>投资事件</h2>
      <span class="muted"
        >{session.calendarFailed
          ? "日历暂时无法读取"
          : String(session.calendar?.state || "未连接")}</span
      >
    </div>
    <div use:chartStyles>{@html timelineHtml}</div>
  </section>
{/if}
<section class="surface">
  <div class="section-title"><h2>持仓变化</h2><span class="muted">按持仓档案逐次确认</span></div>
  <div use:chartStyles>{@html historyHtml}</div>
  {#if historyRows.length}
    <div class="history-controls">
      <label class="history-picker" for="history-date"
        >查看记录<select
          id="history-date"
          value={selectedHistory}
          onchange={(event) => {
            historySelect = event.currentTarget.value;
            filters.selectedHistory = historySelect;
          }}
        >
          {#each historyRows as row (String(row.source))}
            <option value={String(row.source)} selected={String(row.source) === selectedHistory}
              >{row.date} · {row.approx ? "档案" : "本批行情"}</option
            >
          {/each}
        </select></label
      >
      <div id="history-detail" use:chartStyles>{@html historyDetailHtml}</div>
    </div>
  {/if}
</section>
<section class="surface market">
  <div class="section-title">
    <h2>市场一览</h2><span class="muted">按各标的最近行情展示</span>
  </div>
  <div class="market-grid">
    {#each d.market as m (m.symbol)}
      <div>
        <span>{m.name}</span>
        <strong>{number(m.close)}</strong>
        <b class={tone(m.change_pct)}>{marketChange(m.change_pct)}</b>
        <small
          >{m.error
            ? humanizeQuoteError(m.error)
            : `${m.date} · ${m.quote_status || "阶段未确认"}`}</small
        >
      </div>
    {/each}
  </div>
</section>
