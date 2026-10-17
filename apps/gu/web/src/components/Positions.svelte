<script lang="ts">
  import { tick } from "svelte";
  import { percent as pct, weight } from "../format";
  import { positionAnchorId, riskRail } from "../charts";
  import { money, number, quoteInfo, signed as signedOf, tone } from "../lib/format";
  import { consumePendingPositionFocus } from "../lib/focus";
  import { chartStyles } from "../action";
  import type { Dashboard } from "../../../worker/dashboard-types";

  let { d }: { d: Dashboard } = $props();

  const signed = signedOf(pct);
  const railHtml = $derived(riskRail(d.risk));

  /**
   * 图表 → 持仓联动的消费点。持仓页每次渲染完成后尝试消费 pending ticker；
   * 此处 DOM 已落齐，早于这一刻打标会落在旧节点上。
   */
  $effect(() => {
    d;
    void tick().then(() => consumePendingPositionFocus());
  });
</script>

<div class="page-heading">
  <div><p class="muted">看清配置与边界</p><h1>持仓与风控</h1></div>
  <span class="stamp">计算依据 {d.account[0].framework}</span>
</div>
<section class="surface">
  <div class="section-title">
    <h2>当前持仓</h2><span class="muted">金额单位：美元</span>
  </div>
  <div class="table-scroll desktop-positions">
    <table>
      <thead>
        <tr>
          <th>标的</th><th>股数</th><th>成本 / 现价</th><th>市值</th><th>浮盈亏</th><th>当前 / 配置依据</th><th>行情时间</th>
        </tr>
      </thead>
      <tbody>
        {#each d.positions as p (String(p.ticker))}
          <tr id={positionAnchorId(String(p.ticker ?? ""))} class="position-row" data-position={String(p.ticker ?? "")}>
            <td><strong>{p.ticker}</strong><small>{p.name}</small></td>
            <td>{number(p.shares, 4)}</td>
            <td>{number(p.avg_cost)} / {number(p.price)}</td>
            <td>{money(p.value_usd)}</td>
            <td class={tone(p.pnl_pct)}>{signed(p.pnl_pct)}</td>
            <td>
              {pct(weight(p))}<small
                >{p.ticker === "现金" ? "最低保留线" : "目标权重"} {pct(p.target)}</small
              >
            </td>
            <td><small>{quoteInfo(p)}</small></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="mobile-positions">
    {#each d.positions as p (String(p.ticker))}
      <article id={positionAnchorId(String(p.ticker ?? ""))} class="position-card" data-position={String(p.ticker ?? "")}>
        <div class="position-heading"><strong>{p.ticker}</strong><span>{p.name}</span></div>
        <dl class="position-metrics">
          <div><dt>市值 · 美元</dt><dd>{money(p.value_usd)}</dd></div>
          <div><dt>浮盈亏</dt><dd class={tone(p.pnl_pct)}>{signed(p.pnl_pct)}</dd></div>
          <div><dt>当前权重</dt><dd>{pct(weight(p))}</dd></div>
          <div>
            <dt>{p.ticker === "现金" ? "最低保留线" : "目标权重"}</dt>
            <dd>{pct(p.target)}</dd>
          </div>
        </dl>
        <details>
          <summary>持仓与行情详情</summary>
          <p>股数 {number(p.shares, 4)} · 成本 {number(p.avg_cost)} · 现价 {number(p.price)}</p>
          <p>{quoteInfo(p)}</p>
        </details>
      </article>
    {/each}
  </div>
</section>
<section class="surface">
  <div class="section-title">
    <h2>风控距离</h2><span class="muted">触发状态与距离分别计算</span>
  </div>
  <!-- 风控距离图表由 charts.ts 生成，几何经 CSSOM 应用 -->
  <div use:chartStyles>{@html railHtml}</div>
</section>
<div class="data-note">
  <span>未评估</span>完整账户历史尚未补齐，组合单日跌幅与持仓月度跌幅等条件不能据此判定安全。
</div>
