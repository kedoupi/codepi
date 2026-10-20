<script lang="ts">
  import type { Handoff, HandoffDraft, ProjectCard, ProjectStatus } from "../lib/types";
  import { repoHref, time } from "../lib/format";
  import ActivityPanel from "./ActivityPanel.svelte";
  import FieldCard from "./FieldCard.svelte";
  import HandoffForm from "./HandoffForm.svelte";
  import HandoffTimeline from "./HandoffTimeline.svelte";
  import ProgressPanel from "./ProgressPanel.svelte";
  import SyncPanel from "./SyncPanel.svelte";

  let {
    card,
    handoffs,
    hasMore,
    loadingHandoffs,
    onBack,
    onUpdateProject,
    onSaveField,
    onResetField,
    onAddHandoff,
    onLoadHandoffs,
    onSync,
  }: {
    card: ProjectCard;
    handoffs: Handoff[];
    hasMore: boolean;
    loadingHandoffs: boolean;
    onBack: () => void;
    onUpdateProject: (update: { status?: ProjectStatus; name?: string }) => Promise<void>;
    onSaveField: (field: "goal" | "scope" | "conventions" | "pitfalls", value: string) => Promise<void>;
    onResetField: (field: "goal" | "scope" | "conventions" | "pitfalls") => Promise<void>;
    onAddHandoff: (draft: HandoffDraft) => Promise<void>;
    onLoadHandoffs: () => Promise<void>;
    onSync: () => Promise<{ errors: number }>;
  } = $props();

  let syncing = $state(false);
  let syncMessage = $state("");
  let syncError = $state("");
  let editingName = $state(false);
  let nameDraft = $state("");
  let savingName = $state(false);
  let statusSaving = $state(false);
  let timelineError = $state("");

  $effect(() => {
    if (!editingName) nameDraft = card.project.name;
  });

  async function sync() {
    syncing = true;
    syncError = "";
    syncMessage = "";
    try {
      const result = await onSync();
      syncMessage = result.errors
        ? `同步完成，${result.errors} 个来源失败；检查下方状态。`
        : "同步完成。";
    } catch (failure) {
      const apiFailure = failure as Error & { status?: number; retryAfter?: number };
      syncError = apiFailure.status === 429
        ? `同步过于频繁，请在 ${Math.max(1, apiFailure.retryAfter || 1)} 秒后重试。`
        : apiFailure.message === "project_not_syncable"
          ? "此项目已移出 PROJECT_REPOS，不再允许同步。"
        : apiFailure.message;
    } finally {
      syncing = false;
    }
  }

  async function saveName() {
    if (!nameDraft.trim()) {
      syncError = "项目名称不能为空。";
      return;
    }
    savingName = true;
    syncError = "";
    try {
      await onUpdateProject({ name: nameDraft });
      editingName = false;
    } catch (failure) {
      syncError = (failure as Error).message;
    } finally {
      savingName = false;
    }
  }

  async function changeStatus(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const value = select.value as ProjectStatus;
    statusSaving = true;
    syncError = "";
    try {
      await onUpdateProject({ status: value });
    } catch (failure) {
      syncError = (failure as Error).message;
      select.value = card.project.status;
    } finally {
      statusSaving = false;
    }
  }

  async function loadMoreHandoffs() {
    timelineError = "";
    try {
      await onLoadHandoffs();
    } catch (failure) {
      timelineError = (failure as Error).message;
    }
  }
</script>

<div class="detail-shell">
  <div class="detail-breadcrumb">
    <button class="quiet-button" onclick={onBack}>← 所有项目</button>
    <span class="eyebrow">{card.project.repo}</span>
  </div>

  <header class="project-header">
    <div class="project-title-block">
      {#if editingName}
        <div class="name-editor">
          <input maxlength="120" bind:value={nameDraft} aria-label="项目名称" />
          <button class="small-primary" disabled={savingName} onclick={() => void saveName()}>{savingName ? "保存中…" : "保存名称"}</button>
          <button class="quiet-button" onclick={() => { editingName = false; nameDraft = card.project.name; }}>取消</button>
        </div>
      {:else}
        <div class="title-line">
          <h1>{card.project.name}</h1>
          <button class="quiet-button rename-button" onclick={() => { editingName = true; nameDraft = card.project.name; }}>改名</button>
        </div>
      {/if}
      <div class="header-links">
        <a href={repoHref(card.project.repo)} target="_blank" rel="noreferrer">{card.project.repo} ↗</a>
        <span>数据截至 {time(card.as_of)}</span>
      </div>
    </div>
    <div class="header-controls">
      <label class="status-control">
        <span>项目状态</span>
        <select value={card.project.status} disabled={statusSaving} onchange={changeStatus}>
          <option value="active">进行中</option>
          <option value="paused">暂停</option>
          <option value="archived">归档</option>
        </select>
      </label>
      <button class="sync-button" disabled={syncing} onclick={() => void sync()}>
        <span class="sync-glyph" aria-hidden="true">↻</span>
        {syncing ? "同步中…" : "立即同步"}
      </button>
    </div>
  </header>

  {#if syncError}<p class="inline-alert" role="alert">{syncError}</p>{/if}
  {#if syncMessage}<p class="inline-success" role="status">{syncMessage}</p>{/if}

  <div class="detail-columns">
    <div class="detail-left">
      <ProgressPanel repo={card.project.repo} taskProgress={card.task_progress} />
      <HandoffForm onSubmit={onAddHandoff} />
      <HandoffTimeline
        handoffs={handoffs}
        hasMore={hasMore}
        loading={loadingHandoffs}
        error={timelineError}
        onLoadMore={loadMoreHandoffs}
      />
    </div>
    <aside class="detail-right">
      <section class="field-stack" aria-label="项目卡字段">
        <div class="stack-heading">
          <span class="eyebrow">CARD FIELDS</span>
          <h2>项目约束</h2>
        </div>
        <FieldCard name="goal" label="目标" field={card.goal} onSave={onSaveField} onReset={onResetField} />
        <FieldCard name="scope" label="范围" field={card.scope} onSave={onSaveField} onReset={onResetField} />
        <FieldCard name="conventions" label="约定" field={card.conventions} onSave={onSaveField} onReset={onResetField} />
        <FieldCard name="pitfalls" label="注意事项" field={card.pitfalls} onSave={onSaveField} onReset={onResetField} />
      </section>
      <ActivityPanel {card} />
      <SyncPanel {card} />
    </aside>
  </div>
</div>
