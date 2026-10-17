<script lang="ts">
  import { reportAction, reportCategory } from "../format";
  import { headings, markdown } from "../markdown";
  import { filters } from "../lib/state.svelte";
  import type { Row } from "../../../worker/dashboard-types";

  type Report = Row;

  let { reports, id }: { reports: Report[]; id?: string } = $props();

  let query = $state(filters.reportQuery);
  let kind = $state(filters.reportKind);

  // 过滤器写回全局，切换页面再回来时保留。
  $effect(() => {
    filters.reportQuery = query;
    filters.reportKind = kind;
  });

  const kinds = $derived([...new Set(reports.map((r) => String(r.kind)))]);
  const filtered = $derived(
    reports.filter(
      (r) =>
        (!kind || r.kind === kind) &&
        `${r.kind} ${r.date} ${r.headline} ${r.body}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
  );
  const current = $derived(id ? reports.find((r) => r.id === id) : undefined);
  const currentBody = $derived(current ? String(current.body) : "");
  const contents = $derived(headings(currentBody));
  const bodyHtml = $derived(current ? markdown(currentBody) : "");
  const dateSourceLabel = $derived(
    current
      ? (
          {
            front_matter: "报告元数据",
            generated_time: "生成时间",
            filename: "文件名",
          } as Record<string, string>
        )[String(current.date_source)] || "未记录"
      : "",
  );

  function headline(r: Report) {
    return (
      r.headline ||
      String(r.body)
        .split("\n")
        .find((l) => l.startsWith("# "))
        ?.replace(/^#+\s*/, "") ||
      r.kind
    );
  }

  function scrollToSection(sectionId: string) {
    const heading = document.getElementById(sectionId);
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }

  function backToTop() {
    window.scrollTo(0, 0);
    document
      .querySelector<HTMLElement>("#content")
      ?.focus({ preventScroll: true });
  }
</script>

{#if id}
  {#if !current}
    <div class="empty">
      <h1>未找到这份报告</h1>
      <a href="#reports">返回报告列表</a>
    </div>
  {:else}
    <div class="report-heading" id="report-top">
      <a href="#reports">返回报告列表</a>
      <span>{reportCategory(current.kind)} · {current.date}</span>
    </div>
    <h1 class="report-title">{reportCategory(current.kind)}</h1>
    <div class="data-note">
      归档日 {current.date} · 对应交易日 {current.trading_date || "未记录"} · 日期来源 {dateSourceLabel}
    </div>
    {#if contents.length >= 3}
      <details class="report-contents">
        <summary>章节目录 · {contents.length} 节</summary>
        <nav aria-label="报告章节">
          {#each contents as s (s.id)}
            <button data-section={s.id} onclick={() => scrollToSection(s.id)}
              >{s.title}</button
            >
          {/each}
        </nav>
      </details>
    {/if}
    <!-- 报告正文经 markdown.ts 白名单渲染，链接/标签均已转义 -->
    <article class="report-body">{@html bodyHtml}</article>
    <p class="fine source">
      原始记录：{current.path}。历史报告保留当时的依据与判断。
    </p>
    <button class="back-top" id="back-top" onclick={backToTop}>返回顶部</button>
  {/if}
{:else}
  <div class="page-heading">
    <div><p class="muted">把判断留在时间里</p><h1>研究与报告</h1></div>
    <span class="stamp">{reports.length} 份已同步报告</span>
  </div>
  <div class="filters">
    <label for="search"
      >搜索报告<input
        id="search"
        type="search"
        placeholder="搜索标的、结论或正文"
        bind:value={query}
      /></label
    >
    <label for="kind"
      >报告类型<select id="kind" bind:value={kind}>
        <option value="">全部类型</option>
        {#each kinds as k (k)}
          <option value={k}>{k}</option>
        {/each}
      </select></label
    >
  </div>
  <div id="report-results">
    <div class="report-list">
      {#if filtered.length}
        {#each filtered as r (String(r.id))}
          <a class="report-card" href="#reports/{encodeURIComponent(String(r.id))}">
            <div>
              <span class="report-kind">{reportCategory(r.kind)}</span><time>{r.date}</time>
            </div>
            <h2>{headline(r)}</h2>
            <p>
              交易日 {r.trading_date || "未记录"}
              <span>当时：{reportAction(r.action)}</span>
            </p>
          </a>
        {/each}
      {:else}
        <p class="empty">没有符合条件的报告。</p>
      {/if}
    </div>
  </div>
{/if}
