<script lang="ts">
  import { AI_THINK_LINES, type AiResponse } from "../lib/ai";
  import type { Locale } from "../lib/i18n";

  let {
    open,
    rangeDays,
    thinking,
    status,
    statusErr,
    report,
    fallbackText,
    onClose,
    locale = "zh",
  }: {
    open: boolean;
    rangeDays: number;
    thinking: boolean;
    status: string;
    statusErr: boolean;
    report: AiResponse | null;
    fallbackText: string;
    onClose: () => void;
    locale?: Locale;
  } = $props();

  let outEl: HTMLDivElement | undefined = $state();
  let maskHidden = $state(true);
  let drawerOpen = $state(false);
  let thinkLine = $state("");
  let drawer = $state<HTMLElement>();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;

  $effect(() => {
    if (open) {
      maskHidden = false;
      const id = requestAnimationFrame(() => {
        drawerOpen = true;
      });
      return () => cancelAnimationFrame(id);
    }
    drawerOpen = false;
    const t = setTimeout(() => {
      maskHidden = true;
    }, 220);
    return () => clearTimeout(t);
  });

  $effect(() => {
    if (!open || !drawer) return;
    const root = drawer;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => root.querySelector<HTMLButtonElement>("button")?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const targets = [...root.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex='0']")];
        const first = targets[0];
        const last = targets.at(-1);
        if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  });

  $effect(() => {
    if (!thinking) return;
    let i = 0;
    thinkLine = text("整理近 " + rangeDays + " 天的 Oura 信号…", `Reviewing ${rangeDays} days of Oura records…`);
    const timer = setInterval(() => {
      i = (i + 1) % AI_THINK_LINES.length;
      thinkLine = locale === "zh" ? AI_THINK_LINES[i] : "Checking recorded scores and available comparisons…";
    }, 1600);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (!outEl || !report?.report) return;
    const blocks = outEl.querySelectorAll(".rpt-block");
    if (!blocks.length) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (i >= blocks.length) return;
      blocks[i].classList.add("in");
      i += 1;
      timer = setTimeout(tick, 100);
    };
    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  const findings = $derived(report?.report?.findings ?? []);
  const actions = $derived(report?.report?.actions ?? []);
  const rangeLabel = $derived.by(() => {
    if (!report) return "";
    return (
      text("近 ", "Last ") +
      (report.days || rangeDays) +
      text(" 天 · ", " days · ") +
      (report.from || "") +
      " → " +
      (report.to || "")
    );
  });
  const FALLBACK_LABELS: Record<string, string> = $derived({
    not_configured: text("未配置模型服务", "Model service is not configured"),
    insufficient_data: text("近期数据不足", "Not enough recent records"),
    daily_limit: text("已达今日解读上限", "Daily analysis limit reached"),
    provider_unavailable: text("模型服务暂不可用", "Model service unavailable"),
  });
  const fallbackLabel = $derived(
    report?.fallbackReason ? (FALLBACK_LABELS[report.fallbackReason] ?? null) : null,
  );
</script>

<div
  class="ai-drawer-mask"
  class:open={drawerOpen}
  hidden={maskHidden}
  onclick={onClose}
  onkeydown={(e) => e.key === "Enter" && onClose()}
  role="presentation"
></div>
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<aside
  bind:this={drawer}
  class="ai-drawer"
  class:open={drawerOpen}
  hidden={maskHidden}
  inert={!open}
  aria-hidden={drawerOpen ? "false" : "true"}
  role="dialog"
  aria-modal="true"
  aria-labelledby="aiTitle"
>
  <div class="ai-drawer-head">
    <div class="ai-drawer-title" id="aiTitle">{text("数据解读", "Data review")}</div>
    <button type="button" class="ai-close" aria-label={text("关闭", "Close")} onclick={onClose}>×</button>
  </div>
  <div class="ai-status" class:err={statusErr} role="status">{status}</div>
  {#if locale === "en"}<p class="ai-status">Report content is currently provided in Chinese.</p>{/if}
  <div class="ai-out" class:plain-fallback={!!fallbackText && !report?.report} bind:this={outEl}>
    {#if thinking}
      <div class="ai-loading">
        <div class="ai-loading-ring" aria-hidden="true"></div>
        <div class="ai-loading-title">{text("正在整理数据解读", "Preparing your data review")}</div>
        <div class="ai-loading-sub">{thinkLine}</div>
        <div class="ai-loading-dots" aria-hidden="true"><i></i><i></i><i></i></div>
      </div>
    {:else if report?.report}
      <div class="rpt-meta rpt-block">
        <div class="rpt-range">{rangeLabel}</div>
      </div>
      <div class="rpt-verdict rpt-block">
        <div class="rpt-source">{report.source === "ai-ranked" ? `${text("已验证模型辅助排序", "Verified model-assisted ranking")} · ${report.model}` : text("规则解读 · 未调用外部模型", "Rule-based review · No external model used")}</div>
        {#if fallbackLabel}<div class="rpt-source">{fallbackLabel}</div>{/if}
        <div class="rpt-verdict-label">{text("结论", "Summary")}</div>
        <div class="rpt-verdict-text">{report.report.verdict || ""}</div>
      </div>
      <div class="rpt-sec">
        <div class="rpt-sec-title rpt-block">{text("主要发现", "Findings")}</div>
        <div class="rpt-findings">
          {#each findings as f, i (`f-${i}`)}
            <div class="rpt-finding rpt-block">
              <div class="rpt-finding-top">
                <div class="rpt-finding-title">{f.title || ""}</div>
                <span class="rpt-chip lv-{f.level || '注意'}">{f.level || "注意"}</span>
              </div>
              <div class="rpt-finding-detail">{f.detail || ""}</div>
            </div>
          {/each}
        </div>
      </div>
      {#if actions.length}
        <div class="rpt-sec">
          <div class="rpt-sec-title rpt-block">{text("可以关注", "Things to observe")}</div>
          <ol class="rpt-actions">
            {#each actions as a, idx (`a-${idx}`)}
              <li class="rpt-block"><span class="num">{idx + 1}</span><span>{a}</span></li>
            {/each}
          </ol>
        </div>
      {/if}
      <div class="rpt-sec">
        <div class="rpt-sec-title rpt-block">{text("数据说明", "About the data")}</div>
        <div class="rpt-verdict-reason rpt-block">{text("以上分数与变化均由 Oura 官方日汇总计算，非医疗建议；数据不足的项目不做推断。", "Scores and differences use Oura daily summaries. Not medical advice; insufficient records are not interpreted.")}</div>
      </div>
    {:else if fallbackText}
      {fallbackText}
    {/if}
  </div>
</aside>

<style>
  .ai-drawer[hidden] { display: none; }
  .ai-close { width: 44px; height: 44px; flex-shrink: 0; }
</style>
