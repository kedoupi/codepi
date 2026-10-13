<script lang="ts">
  import { AI_THINK_LINES, type AiResponse } from "../lib/ai";

  let {
    open,
    rangeDays,
    thinking,
    status,
    statusErr,
    report,
    fallbackText,
    onClose,
  }: {
    open: boolean;
    rangeDays: number;
    thinking: boolean;
    status: string;
    statusErr: boolean;
    report: AiResponse | null;
    fallbackText: string;
    onClose: () => void;
  } = $props();

  let outEl: HTMLDivElement | undefined = $state();
  let maskHidden = $state(true);
  let drawerOpen = $state(false);
  let thinkLine = $state("");

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
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  $effect(() => {
    if (!thinking) return;
    let i = 0;
    thinkLine = "整理近 " + rangeDays + " 天的 Oura 信号…";
    const timer = setInterval(() => {
      i = (i + 1) % AI_THINK_LINES.length;
      thinkLine = AI_THINK_LINES[i];
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
      "近 " +
      (report.days || rangeDays) +
      " 天 · " +
      (report.from || "") +
      " → " +
      (report.to || "")
    );
  });
  const FALLBACK_LABELS: Record<string, string> = {
    not_configured: "未配置模型服务",
    insufficient_data: "近期数据不足",
    daily_limit: "已达今日解读上限",
    provider_unavailable: "模型服务暂不可用",
  };
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
  class="ai-drawer"
  class:open={drawerOpen}
  aria-hidden={drawerOpen ? "false" : "true"}
  role="dialog"
  aria-labelledby="aiTitle"
>
  <div class="ai-drawer-head">
    <div class="ai-drawer-title" id="aiTitle">数据解读</div>
    <button type="button" class="ai-close" aria-label="关闭" onclick={onClose}>×</button>
  </div>
  <div class="ai-status" class:err={statusErr}>{status}</div>
  <div class="ai-out" class:plain-fallback={!!fallbackText && !report?.report} bind:this={outEl}>
    {#if thinking}
      <div class="ai-loading">
        <div class="ai-loading-ring" aria-hidden="true"></div>
        <div class="ai-loading-title">正在整理数据解读</div>
        <div class="ai-loading-sub">{thinkLine}</div>
        <div class="ai-loading-dots" aria-hidden="true"><i></i><i></i><i></i></div>
      </div>
    {:else if report?.report}
      <div class="rpt-meta rpt-block">
        <div class="rpt-range">{rangeLabel}</div>
      </div>
      <div class="rpt-verdict rpt-block">
        <div class="rpt-source">{report.source === "ai-ranked" ? `已验证模型辅助排序 · ${report.model}` : "规则解读 · 未调用外部模型"}</div>
        {#if fallbackLabel}<div class="rpt-source">{fallbackLabel}</div>{/if}
        <div class="rpt-verdict-label">结论</div>
        <div class="rpt-verdict-text">{report.report.verdict || ""}</div>
      </div>
      <div class="rpt-sec">
        <div class="rpt-sec-title rpt-block">主要发现</div>
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
          <div class="rpt-sec-title rpt-block">可以关注</div>
          <ol class="rpt-actions">
            {#each actions as a, idx (`a-${idx}`)}
              <li class="rpt-block"><span class="num">{idx + 1}</span><span>{a}</span></li>
            {/each}
          </ol>
        </div>
      {/if}
      <div class="rpt-sec">
        <div class="rpt-sec-title rpt-block">数据说明</div>
        <div class="rpt-verdict-reason rpt-block">以上分数与变化均由 Oura 官方日汇总计算，非医疗建议；数据不足的项目不做推断。</div>
      </div>
    {:else if fallbackText}
      {fallbackText}
    {/if}
  </div>
</aside>
