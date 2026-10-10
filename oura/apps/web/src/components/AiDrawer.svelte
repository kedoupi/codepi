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
  const rx = $derived(report?.report?.prescription ?? {});
  const train = $derived(report?.report?.train === "宜歇" ? "宜歇" : "宜练");
  const trainCls = $derived(train === "宜练" ? "go" : "rest");
  const rangeLabel = $derived.by(() => {
    if (!report) return "";
    const nowBit =
      report.now && report.now.timeStr
        ? " · 现在 " +
          report.now.timeStr +
          (report.now.hoursToSleep != null ? " · 距睡觉约 " + report.now.hoursToSleep + "h" : "")
        : "";
    return (
      "近 " +
      (report.days || rangeDays) +
      " 天 · " +
      (report.from || "") +
      " → " +
      (report.to || "") +
      nowBit
    );
  });
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
    <div class="ai-drawer-title" id="aiTitle">健康诊断报告</div>
    <button type="button" class="ai-close" aria-label="关闭" onclick={onClose}>×</button>
  </div>
  <div class="ai-status" class:err={statusErr}>{status}</div>
  <div class="ai-out" class:plain-fallback={!!fallbackText && !report?.report} bind:this={outEl}>
    {#if thinking}
      <div class="ai-loading">
        <div class="ai-loading-ring" aria-hidden="true"></div>
        <div class="ai-loading-title">正在诊断</div>
        <div class="ai-loading-sub">{thinkLine}</div>
        <div class="ai-loading-dots" aria-hidden="true"><i></i><i></i><i></i></div>
      </div>
    {:else if report?.report}
      <div class="rpt-meta rpt-block">
        <div class="rpt-range">{rangeLabel}</div>
        <span class="rpt-train {trainCls}">{train}</span>
      </div>
      <div class="rpt-verdict rpt-block">
        <div class="rpt-verdict-label">结论</div>
        <div class="rpt-verdict-text">{report.report.verdict || ""}</div>
        {#if report.report.trainReason}
          <div class="rpt-verdict-reason">{train} · {report.report.trainReason}</div>
        {/if}
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
      <div class="rpt-sec">
        <div class="rpt-sec-title rpt-block">分项解读</div>
        <div class="rpt-rows">
          <div class="rpt-row rpt-block">
            <div class="rpt-row-k">睡眠</div>
            <div class="rpt-row-v">{report.report.sleep || ""}</div>
          </div>
          <div class="rpt-row rpt-block">
            <div class="rpt-row-k">准备度</div>
            <div class="rpt-row-v">{report.report.readiness || ""}</div>
          </div>
          <div class="rpt-row rpt-block">
            <div class="rpt-row-k">活动</div>
            <div class="rpt-row-v">{report.report.activity || ""}</div>
          </div>
        </div>
      </div>
      <div class="rpt-sec">
        <div class="rpt-sec-title rpt-block">今日处方</div>
        <div class="rpt-rx">
          <div class="rpt-rx-card rpt-block">
            <div class="rpt-rx-k">运动</div>
            <div class="rpt-rx-v">{rx.workout || ""}</div>
          </div>
          <div class="rpt-rx-card rpt-block">
            <div class="rpt-rx-k">睡眠</div>
            <div class="rpt-rx-v">{rx.sleep || ""}</div>
          </div>
          <div class="rpt-rx-card rpt-block">
            <div class="rpt-rx-k">补活动</div>
            <div class="rpt-rx-v">{rx.move || ""}</div>
          </div>
        </div>
      </div>
      <div class="rpt-sec">
        <div class="rpt-sec-title rpt-block">接下来</div>
        <ol class="rpt-actions">
          {#each actions as a, idx (`a-${idx}`)}
            <li class="rpt-block"><span class="num">{idx + 1}</span><span>{a}</span></li>
          {/each}
        </ol>
      </div>
    {:else if fallbackText}
      {fallbackText}
    {/if}
  </div>
</aside>
