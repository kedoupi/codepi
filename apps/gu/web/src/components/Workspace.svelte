<script lang="ts">
  import { onMount, tick } from "svelte";
  import { api, uploadFile } from "../lib/api";
  import { session } from "../lib/state.svelte";
  import { time } from "../lib/format";
  import { markdown } from "../markdown";
  import { emptyWorkspace, type WorkspaceData, type WorkspaceView, type Valuation, type Material } from "../../../worker/workspace-types";
  import type { Page } from "../lib/router.svelte";
  import "./workspace.css";

  let { page, initial }: { page: Page; initial?: WorkspaceView } = $props();
  let draft = $state<WorkspaceData>(emptyWorkspace());
  let baseline = $state("");
  let revision = $state(0);
  let ready = $state(false);
  let busy = $state(false);
  let message = $state("");
  let failed = $state(false);
  let materialsEnabled = $state(false);
  let materials = $state<Material[]>([]);
  let materialsNextOffset = $state<number | null>(null);
  let materialsLoading = $state(false);
  let materialsError = $state("");
  let versions = $state<{ revision: number; created_at: string }[]>([]);
  let savedValuation = $state<Valuation | null>(null);
  let savedConfirmedOn = $state<string | null>(null);
  let preview = $state<{ data: WorkspaceData; valuation: Valuation; requestId: string } | null>(null);
  let sourceBatch = $state<string | undefined>();
  let selectedReport = $state("");
  let historical = $state<{ revision: number; data: WorkspaceData } | null>(null);
  const dirty = $derived(ready && JSON.stringify(draft) !== baseline);
  const section = $derived(["transactions", "rules", "materials", "reports", "status"].includes(page) ? page : "workspace");
  const report = $derived(draft.reports.find(r => r.id === selectedReport));
  const tradeKinds = { buy: "买入", sell: "卖出", deposit: "入金", withdrawal: "出金", dividend: "分红", fee: "费用" };
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const uid = () => crypto.randomUUID();
  const clone = <T,>(data: T): T => JSON.parse(JSON.stringify(data));

  $effect(() => { session.workspaceDirty = dirty; });

  function install(view: WorkspaceView) {
    draft = clone(view.data);
    baseline = JSON.stringify(draft);
    revision = view.revision;
    savedValuation = view.valuation;
    savedConfirmedOn = view.data.account.confirmed_on;
    materialsEnabled = view.materials_enabled;
    ready = true;
    preview = null;
    sourceBatch = undefined;
    if (view.active) {
      session.online = view;
      session.snapshot = null;
      session.notice = "";
    }
  }

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    busy = true; failed = false; message = "";
    try { await fn(); }
    catch (error) { failed = true; message = (error as Error).message; }
    finally {
      busy = false;
      if (failed || preview) {
        await tick();
        const feedback = document.querySelector<HTMLElement>(failed ? ".online-feedback" : ".online-preview");
        feedback?.scrollIntoView?.({ block: "start", behavior: "instant" });
        feedback?.focus({ preventScroll: true });
      }
    }
  }

  async function read(initialView?: WorkspaceView) {
    const view = initialView ?? await api("/api/workspace") as unknown as WorkspaceView;
    install(view);
    const [files, history] = await Promise.all([api("/api/materials"), api("/api/workspace/history")]);
    materials = files.materials as Material[];
    materialsNextOffset = (files.next_offset as number | null | undefined) ?? null;
    materialsError = "";
    versions = history.versions as typeof versions;
  }
  async function loadMoreMaterials() {
    if (materialsLoading || materialsNextOffset === null) return;
    materialsLoading = true;
    materialsError = "";
    try {
      const result = await api(`/api/materials?offset=${materialsNextOffset}`);
      materials = [...materials, ...(result.materials as Material[])];
      materialsNextOffset = (result.next_offset as number | null | undefined) ?? null;
    } catch (error) {
      materialsError = (error as Error).message;
    } finally {
      materialsLoading = false;
    }
  }


  function reload() {
    if (dirty && !confirm("放弃未保存的草稿并重新读取线上版本？可以先导出草稿。")) return;
    void run(read);
  }

  function normalized() {
    const value = clone($state.snapshot(draft));
    value.account.confirmed_on ||= null;
    for (const h of value.account.holdings) {
      h.currency ||= null; h.quantity ||= null; h.cost_total ||= null; h.value_usd ||= null; h.valued_on ||= null;
    }
    for (const c of value.account.cash) {
      c.currency ||= null; c.amount ||= null; c.value_usd ||= null; c.confirmed_on ||= null;
    }
    for (const t of value.account.trades) t.quantity ||= null;
    for (const r of value.reports) r.trading_date ||= null;
    return value;
  }

  async function prepare() {
    await run(async () => {
      const result = await api("/api/workspace/preview", { data: normalized() });
      preview = { data: result.data as WorkspaceData, valuation: result.valuation as Valuation, requestId: uid() };
      message = "请核对预览。确认后才会写入线上账户。";
    });
  }

  async function save() {
    const proposed = preview;
    if (!proposed) return;
    await run(async () => {
      const result = await api("/api/workspace", { data: proposed.data, base_revision: revision,
        request_id: proposed.requestId, confirmed: true, ...(sourceBatch ? { source_batch_id: sourceBatch } : {}) }, "PUT");
      install(result as unknown as WorkspaceView);
      versions = (await api("/api/workspace/history")).versions as typeof versions;
      message = `已保存线上版本 ${result.saved_revision}。交易流水不会自动改变持仓和现金，请分别核对。`;
    });
  }

  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportDraft() {
    download({ schema_version: 1, data: normalized(), draft: true, base_revision: revision }, "gu-draft.json");
  }
  async function importJson(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    const overwrite = !dirty || confirm("用导入内容替换当前草稿？线上数据会在预览确认后才改变。");
    if (!overwrite) { input.value = ""; return; }
    await run(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error("导入文件不能超过 8 MB");
      const parsed = JSON.parse(await file.text());
      if (parsed.schema_version !== 1 || !parsed.data) throw new Error("请选择 GU 导出的工作台 JSON");
      const result = await api("/api/workspace/preview", { data: parsed.data, imported: true });
      draft = result.data as WorkspaceData; preview = null; sourceBatch = undefined;
      message = "已载入导入草稿，请核对后保存。原报告的版本编号已保留在来源说明，不与本环境版本混用。附件索引不会代替原件上传。";
    });
    input.value = "";
  }
  async function importLegacy() {
    if (dirty && !confirm("旧快照将替换当前草稿，是否继续？")) return;
    await run(async () => {
      const result = await api("/api/workspace/import-legacy", {});
      draft = result.data as WorkspaceData; sourceBatch = result.source_batch_id as string; preview = null;
      message = (result.warnings as string[]).join(" ");
    });
  }
  async function importRule(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    if (draft.rules.body && !confirm("用文件内容替换当前规则草稿？")) { input.value = ""; return; }
    await run(async () => {
      if (file.size > 100000) throw new Error("规则文件不能超过 100 KB");
      draft.rules.body = await file.text();
      message = "规则已载入草稿，请预览并确认保存。";
    });
    input.value = "";
  }
  async function addMaterial(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    await run(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error("文件不能超过 8 MB");
      const result = await uploadFile(file);
      const latest = await api("/api/materials");
      materials = latest.materials as Material[];
      materialsNextOffset = (latest.next_offset as number | null | undefined) ?? null;
      message = result.duplicate ? "相同文件已在资料库中，未重复保存。" : "资料已上传。上传不会自动识别内容或修改账户。";
    });
    input.value = "";
  }
  async function importReports(event: Event) {
    const input = event.currentTarget as HTMLInputElement, files = [...(input.files || [])];
    if (!files.length) return;
    await run(async () => {
      if (files.length > 30 || files.some(f => f.size > 500000) || files.reduce((n, f) => n + f.size, 0) > 1_400_000)
        throw new Error("每次最多导入 30 份报告；单份最多 500 KB，合计最多 1.4 MB");
      const incoming = [];
      for (const file of files) {
        const body = await file.text();
        if (!body.trim()) throw new Error("报告内容不能为空");
        if (draft.reports.some(r => r.source === file.name && r.body === body)) continue;
        const recordedDate = file.name.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        incoming.push({ id: uid(), title: (body.match(/^#\s+(.+)$/m)?.[1] || file.name).slice(0, 200),
          date: recordedDate || today(), trading_date: null, date_source: recordedDate ? "filename" : "import_time",
          kind: "导入报告", summary: "", body, source: file.name, based_on_revision: null });
      }
      const candidate = normalized(); candidate.reports.unshift(...incoming);
      const result = await api("/api/workspace/preview", { data: candidate });
      draft = result.data as WorkspaceData;
      selectedReport = incoming[0]?.id || selectedReport;
      message = `已载入 ${incoming.length} 份报告草稿。请核对日期和来源，再预览保存。`;
    });
    input.value = "";
  }
  function addHolding() {
    draft.account.holdings.push({ id: uid(), symbol: "", name: "", account: "", currency: null,
      quantity: null, cost_total: null, value_usd: null, valued_on: null, source: "" });
  }
  function addCash() {
    draft.account.cash.push({ id: uid(), name: "", account: "", currency: null, amount: null,
      value_usd: null, confirmed_on: null, source: "" });
  }
  function addTrade() {
    draft.account.trades.unshift({ id: uid(), date: today(), account: "", kind: "buy", symbol: "",
      currency: "USD", quantity: null, amount: "0", note: "" });
  }
  function addReport() {
    const id = uid();
    draft.reports.unshift({ id, title: "", date: today(), trading_date: null, date_source: "manual",
      kind: "研究笔记", summary: "", body: "", source: "", based_on_revision: null });
    selectedReport = id;
  }

  onMount(() => {
    void run(() => read(initial));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      session.workspaceDirty = false;
    };
  });
</script>

<div class="online-workspace">
  <div class="page-heading">
    <div><p class="muted">资料、规则和判断，都留在这里</p><h1>线上投资工作台</h1></div>
    <span class="stamp">{revision ? `线上版本 ${revision}` : "尚未启用"}</span>
  </div>
  <div class="online-toolbar">
    <span class="seal">{dirty ? "有未保存的草稿" : "与线上版本一致"}</span>
    <button type="button" disabled={busy} onclick={reload}>重新读取</button>
    <button type="button" disabled={!ready || busy} onclick={exportDraft}>导出草稿</button>
  </div>
  {#if message}<p class="online-feedback notice notice-{failed ? 'warning' : 'info'}" role="status" tabindex="-1">{message}</p>{/if}
  {#if !ready}
    <div class="empty"><h2>{failed ? "读取未完成" : "正在读取线上工作台…"}</h2><p>读取失败时可重试，不会创建空账户覆盖现有内容。</p></div>
  {:else}
    {#if !revision}
      <section class="surface">
        <h2>从这里建立线上账户</h2>
        <p>可以直接填写，或载入旧看板快照。第一次确认保存后，GU 将以这里的数据为准，旧批次上传停止生效。</p>
        <button type="button" disabled={busy} onclick={() => void importLegacy()}>载入旧看板供核对</button>
        <p class="fine">旧快照可能缺少原币成本、完整流水和规则正文，缺失内容不会自动补全。</p>
      </section>
      <nav class="online-tabs" aria-label="线上工作台分区">
        <a href="#workspace">账户</a><a href="#transactions">交易</a><a href="#rules">规则</a>
        <a href="#materials">资料</a><a href="#reports">报告</a><a href="#status">导入与导出</a>
      </nav>
    {/if}
    {#if preview}
      <section class="surface online-preview" aria-label="保存预览" tabindex="-1">
        <h2>核对后保存为版本 {revision + 1}</h2>
        <p>持仓 {preview.data.account.holdings.length} 项 · 余额 {preview.data.account.cash.length} 项 · 交易 {preview.data.account.trades.length} 条 · 报告 {preview.data.reports.length} 份</p>
        <p>参考总估值：<strong>{preview.valuation.total_usd === null ? "信息不全，无法汇总" : `${preview.valuation.total_usd} USD`}</strong></p>
        <ul>{#each preview.valuation.warnings as warning}<li>{warning}</li>{/each}</ul>
        <div class="online-preview-values">
          {#each preview.data.account.holdings as h (h.id)}
            <p><strong>{h.symbol} · {h.name}</strong>　数量 {h.quantity ?? "待核实"}　估值 {h.value_usd ?? "待核实"} USD　{h.valued_on ?? "日期未确认"}</p>
          {/each}
          {#each preview.data.account.cash as c (c.id)}
            <p><strong>{c.name}</strong>　原币余额 {c.amount ?? "待核实"} {c.currency ?? ""}　估值 {c.value_usd ?? "待核实"} USD</p>
          {/each}
        </div>
        <details><summary>查看将保存的完整内容</summary><pre>{JSON.stringify(preview.data, null, 2)}</pre></details>
        <div class="online-toolbar">
          <button class="primary" type="button" disabled={busy} onclick={() => void save()}>确认保存到线上</button>
          <button type="button" disabled={busy} onclick={() => preview = null}>返回修改</button>
        </div>
      </section>
    {/if}
    <form onsubmit={(event) => { event.preventDefault(); void prepare(); }}>
      <fieldset disabled={busy || !!preview}>
        {#if section === "workspace"}
          {#if savedValuation && revision}
            <section class="surface online-summary">
              <div><p class="muted">已保存账户的参考估值 · USD</p><h2>{savedValuation.total_usd ?? "待补齐"}</h2></div>
              <p>{savedValuation.missing ? `已知小计 ${savedValuation.known_usd}，另有 ${savedValuation.missing} 项未估值。` : "来自已录入估值，不代表实时行情。"}</p>
              <p class="fine">账户确认 {savedConfirmedOn ?? "未确认"} · 最早估值 {savedValuation.oldest_date ?? "未记录"}</p>
            </section>
          {/if}
          <section class="surface">
            <h2>账户快照</h2>
            <div class="online-fields">
              <label>账户名称<input bind:value={draft.account.name} maxlength="100" required /></label>
              <label>持仓确认日期<input type="date" bind:value={draft.account.confirmed_on} /></label>
              <label class="wide">核对说明<textarea bind:value={draft.account.notes} rows="3" maxlength="10000"></textarea></label>
            </div>
            <p class="fine">空白表示未核实。参考估值直接以 USD 录入；本阶段不自动换汇、不获取行情。</p>
          </section>
          <section class="surface">
            <div class="section-title"><h2>当前持仓</h2><button type="button" onclick={addHolding}>添加持仓</button></div>
            {#if !draft.account.holdings.length}<p class="muted">尚无持仓记录。</p>{/if}
            {#each draft.account.holdings as h (h.id)}
              <article class="online-record">
                <div class="online-fields">
                  <label>标的代码<input bind:value={h.symbol} maxlength="40" required /></label>
                  <label>名称<input bind:value={h.name} maxlength="150" required /></label>
                  <label>所属账户<input bind:value={h.account} maxlength="100" /></label>
                  <label>原币种<input bind:value={h.currency} placeholder="USD / HKD / CNY" maxlength="3" /></label>
                  <label>数量<input inputmode="decimal" bind:value={h.quantity} placeholder="未核实可留空" /></label>
                  <label>总成本（原币）<input inputmode="decimal" bind:value={h.cost_total} placeholder="未核实可留空" /></label>
                  <label>参考估值（USD）<input inputmode="decimal" bind:value={h.value_usd} /></label>
                  <label>估值日期<input type="date" bind:value={h.valued_on} /></label>
                  <label class="wide">估值来源<input bind:value={h.source} maxlength="1000" placeholder="例如结单日期、行情来源或资料文件名" /></label>
                </div>
                <button type="button" class="online-remove" onclick={() => draft.account.holdings = draft.account.holdings.filter(x => x.id !== h.id)}>从草稿移除</button>
              </article>
            {/each}
          </section>
          <section class="surface">
            <div class="section-title"><h2>现金与其他余额</h2><button type="button" onclick={addCash}>添加余额</button></div>
            {#if !draft.account.cash.length}<p class="muted">尚无余额记录。</p>{/if}
            {#each draft.account.cash as c (c.id)}
              <article class="online-record">
                <div class="online-fields">
                  <label>余额名称<input bind:value={c.name} maxlength="150" required /></label>
                  <label>所属账户<input bind:value={c.account} maxlength="100" /></label>
                  <label>原币种<input bind:value={c.currency} maxlength="3" placeholder="USD / HKD / CNY" /></label>
                  <label>原币余额<input inputmode="decimal" bind:value={c.amount} /></label>
                  <label>参考估值（USD）<input inputmode="decimal" bind:value={c.value_usd} /></label>
                  <label>确认日期<input type="date" bind:value={c.confirmed_on} /></label>
                  <label class="wide">来源<input bind:value={c.source} maxlength="1000" /></label>
                </div>
                <button type="button" class="online-remove" onclick={() => draft.account.cash = draft.account.cash.filter(x => x.id !== c.id)}>从草稿移除</button>
              </article>
            {/each}
          </section>
        {:else if section === "transactions"}
          <section class="surface">
            <div class="section-title"><h2>成交流水</h2><button type="button" onclick={addTrade}>记录交易</button></div>
            <p class="data-note">此处记录实际交易，金额填写非负值，方向由交易类型表示。流水不会自动改动账户快照；记录后请在账户页核对持仓和余额。</p>
            {#if !draft.account.trades.length}<p class="muted">没有交易记录。历史资料缺失时不会推算补齐。</p>{/if}
            {#each draft.account.trades as t (t.id)}
              <article class="online-record">
                <div class="online-fields">
                  <label>交易日期<input type="date" bind:value={t.date} required /></label>
                  <label>类型<select bind:value={t.kind}>{#each Object.entries(tradeKinds) as [key, label]}<option value={key}>{label}</option>{/each}</select></label>
                  <label>所属账户<input bind:value={t.account} maxlength="100" /></label>
                  <label>标的<input bind:value={t.symbol} maxlength="40" /></label>
                  <label>数量<input inputmode="decimal" bind:value={t.quantity} /></label>
                  <label>币种<input bind:value={t.currency} maxlength="3" required /></label>
                  <label>实际金额（原币）<input inputmode="decimal" bind:value={t.amount} required /></label>
                  <label class="wide">备注与凭证来源<textarea bind:value={t.note} rows="2" maxlength="2000"></textarea></label>
                </div>
                <button type="button" class="online-remove" onclick={() => draft.account.trades = draft.account.trades.filter(x => x.id !== t.id)}>从草稿移除</button>
              </article>
            {/each}
          </section>
        {:else if section === "rules"}
          <section class="surface">
            <h2>投资规则</h2>
            <p>规则随工作台版本一起保存。当前仅维护规则正文，尚未自动执行风控或调用 AI。</p>
            <div class="online-fields">
              <label class="wide">规则名称<input bind:value={draft.rules.title} required maxlength="150" /></label>
              <label class="wide">从 Markdown / TXT 载入<input type="file" accept=".md,.txt" onchange={(e) => void importRule(e)} /></label>
              <label class="wide">规则正文（Markdown）<textarea class="online-long" bind:value={draft.rules.body} rows="20" maxlength="100000"></textarea></label>
            </div>
            {#if draft.rules.body}<details><summary>阅读预览</summary><div class="markdown">{@html markdown(draft.rules.body)}</div></details>{/if}
          </section>
        {:else if section === "materials"}
          <section class="surface">
            <h2>私人资料库</h2>
            <p>上传结单、截图和研究原件。上传即保存资料，不会自动识别或变更账户。</p>
            {#if !materialsEnabled}<p class="notice notice-warning">资料存储尚未配置。账户、规则和报告仍可使用。</p>
            {:else}<label>上传资料 · 每份最多 8 MB<input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.csv,.json" onchange={(e) => void addMaterial(e)} /></label>{/if}
            {#if !materials.length}<p class="muted">尚无资料。</p>{/if}
            {#if materialsError}<p class="notice notice-warning" role="alert">{materialsError}</p>{/if}
            <ul class="online-files">{#each materials as file (file.id)}
              <li><div><strong>{file.name}</strong><p class="fine">{(file.size / 1024).toFixed(1)} KB · {time(file.created_at)}</p></div>
                <a href="/api/materials/{file.id}" download>下载原件</a></li>
            {/each}</ul>
            {#if materialsNextOffset !== null}
              <button type="button" disabled={materialsLoading} onclick={() => void loadMoreMaterials()}>
                {materialsLoading ? "正在加载…" : "加载更多资料"}
              </button>
            {/if}
            <p class="fine">只通过登录后的 GU 下载。工作台 JSON 导出包含资料索引，原件需要单独下载保存。</p>
          </section>
        {:else if section === "reports"}
          <section class="surface">
            <div class="section-title"><h2>研究报告</h2><button type="button" onclick={addReport}>新建报告</button></div>
            <label>从 Markdown / TXT 导入报告<input type="file" accept=".md,.txt" multiple onchange={(e) => void importReports(e)} /></label>
            <label>选择报告<select bind:value={selectedReport}><option value="">请选择</option>
              {#each draft.reports as r (r.id)}<option value={r.id}>{r.date} · {r.title || "未命名草稿"}</option>{/each}
            </select></label>
            {#if report}
              <div class="online-fields">
                <label class="wide">报告标题<input bind:value={report.title} maxlength="200" required /></label>
                <label>归档日期<input type="date" bind:value={report.date} required /></label>
                <label>对应交易日<input type="date" bind:value={report.trading_date} /></label>
                <label>日期来源<input bind:value={report.date_source} maxlength="100" placeholder="未记录可留空" /></label>
                <label>类型<input bind:value={report.kind} maxlength="100" required /></label>
                <label>依据工作台版本<select bind:value={report.based_on_revision}>
                  <option value={null}>未记录</option>
                  {#if report.based_on_revision && !versions.some(v => v.revision === report.based_on_revision)}
                    <option value={report.based_on_revision}>版本 {report.based_on_revision}</option>
                  {/if}
                  {#each versions as v (v.revision)}<option value={v.revision}>版本 {v.revision}</option>{/each}
                </select></label>
                <label class="wide">摘要<textarea bind:value={report.summary} rows="3" maxlength="10000"></textarea></label>
                <label class="wide">资料或原报告来源<textarea bind:value={report.source} rows="2" maxlength="2000"></textarea></label>
                <label class="wide">正文（Markdown）<textarea class="online-long" bind:value={report.body} rows="20" maxlength="500000" required></textarea></label>
              </div>
              <p class="fine">只选择实际用于分析的已保存版本。若依据尚未保存的账户或规则草稿，请先保存这些内容，核对报告后再填写依据。历史报告不会随账户变化自动更新。</p>
              {#if report.body}<details><summary>阅读报告</summary><div class="markdown">{@html markdown(report.body)}</div></details>{/if}
              <button type="button" class="online-remove" onclick={() => { draft.reports = draft.reports.filter(x => x.id !== selectedReport); selectedReport = ""; }}>从草稿移除</button>
            {:else}<p class="muted">选择一份报告阅读或修改，也可以新建。</p>{/if}
          </section>
        {:else if section === "status"}
          <section class="surface">
            <h2>导入与导出</h2>
            <label>导入 GU 工作台 JSON<input type="file" accept=".json" onchange={(e) => void importJson(e)} /></label>
            <p>导入只生成草稿，经预览确认才会替换线上内容。导出不含登录凭证。</p>
            <a class="text-link" href="/api/workspace/export" download>导出已保存的账户、规则、报告和资料索引</a>
            <p class="fine">导出不包含资料原件；请在资料库分别下载。未保存修改使用上方“导出草稿”。</p>
          </section>
          <section class="surface">
            <h2>版本记录</h2><p>每次保存保留历史内容。展示最近 100 个版本，历史查看不会替换当前账户。</p>
            <ul class="online-files">{#each versions as v (v.revision)}
              <li><span>版本 {v.revision} · {time(v.created_at)}</span><button type="button" onclick={() => void run(async () => {
                historical = await api(`/api/workspace/versions/${v.revision}`) as unknown as typeof historical;
              })}>查看</button></li>
            {/each}</ul>
            {#if historical}<details open><summary>历史版本 {historical.revision} · 只读</summary><pre>{JSON.stringify(historical.data, null, 2)}</pre></details>{/if}
          </section>
        {/if}
        {#if section !== "materials"}
          <div class="online-save"><span>{dirty ? "草稿尚未写入线上" : revision ? `当前版本 ${revision}` : "首次保存将启用线上账户"}</span>
            <button class="primary" type="submit">预览并保存</button></div>
        {/if}
      </fieldset>
    </form>
  {/if}
</div>
