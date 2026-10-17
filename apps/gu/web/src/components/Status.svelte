<script lang="ts">
  import { elapsed } from "../format";
  import { calendarPanel } from "../calendar";
  import { humanizeQuoteError, noticeTone } from "../diagnostics";
  import { time } from "../lib/format";
  import { chartStyles } from "../action";
  import { session } from "../lib/state.svelte";
  import type { Snapshot } from "../lib/format";

  let { snapshot }: { snapshot: Snapshot } = $props();

  const a = $derived(snapshot.data.account[0]);
  const facts = $derived(
    [
      ["持仓确认日", a.holdings_as_of],
      ["现金记录时间", a.cash_as_of],
      ["行情截至", a.quote_date],
      ["本批数据生成时间", time(a.generated_at)],
      ["网站同步时间", time(snapshot.received_at)],
      ["批次经过时间", elapsed(a.generated_at)],
      [
        "价格时刻完整性",
        a.quote_time_complete === true
          ? "全部持仓有明确价格时刻"
          : "未完整记录，行情阶段未确认",
      ],
      [
        "来源市场时间范围",
        a.market_time_min
          ? `${time(a.market_time_min)} — ${time(a.market_time_max)}；不是价格时刻或收盘证明`
          : "旧批次未记录",
      ],
      [
        "各持仓行情日期",
        Array.isArray(a.quote_dates)
          ? `${a.quote_dates.join("、")}${a.quote_date_mixed ? "（日期不一致）" : ""}`
          : "旧批次未记录",
      ],
      ["计算所用规范", a.framework],
      ["数据模式", a.data_mode === "live" ? "联网生成" : "未确认"],
      ["同步批次", snapshot.batch_id],
    ] as [string, unknown][],
  );
  const warnings = $derived(
    String(a.warnings || "")
      .split(" / ")
      .filter(Boolean),
  );
  const calendarHtml = $derived(
    calendarPanel(session.calendar, session.calendarFailed, time),
  );
</script>

<div class="page-heading">
  <div><p class="muted">知道数据从哪里来</p><h1>数据状态</h1></div>
</div>
<section class="surface">
  <div class="section-title">
    <h2>当前批次</h2><span class="muted">时间均以北京时间展示</span>
  </div>
  <dl class="facts">
    {#each facts as [k, v] (k)}
      <div><dt>{k}</dt><dd>{v}</dd></div>
    {/each}
  </dl>
</section>
<section class="surface">
  <h2>数据提醒</h2>
  <ul class="warnings">
    {#if warnings.length}
      {#each warnings as w (w)}
        <li>
          <span class="notice-mark notice-mark-{noticeTone(w)}" aria-hidden="true"></span>{humanizeQuoteError(w)}
        </li>
      {/each}
    {:else}
      <li>本批数据未提供额外提醒。</li>
    {/if}
  </ul>
</section>
<div class="overview-grid">
  <section class="surface">
    <h2>等待核实</h2>
    <p>
      港股股数、GOOGL 早期批次、现金更新和成本尾差，需券商凭证或成交确认。页面不会推算补齐。
    </p>
  </section>
  <div id="calendar-slot" use:chartStyles>{@html calendarHtml}</div>
</div>
