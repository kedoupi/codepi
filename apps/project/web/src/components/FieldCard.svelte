<script lang="ts">
  import type { ProjectCard } from "../lib/types";

  let {
    name,
    label,
    field,
    onSave,
    onReset,
  }: {
    name: "goal" | "scope" | "conventions" | "pitfalls";
    label: string;
    field: ProjectCard["goal"];
    onSave: (field: "goal" | "scope" | "conventions" | "pitfalls", value: string) => Promise<void>;
    onReset: (field: "goal" | "scope" | "conventions" | "pitfalls") => Promise<void>;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let saving = $state(false);
  let error = $state("");

  $effect(() => {
    if (!editing) draft = field.value ?? "";
  });

  async function save() {
    if (!draft.trim()) {
      error = "内容不能为空；如需回到自动提取，请使用“恢复自动提取”。";
      return;
    }
    saving = true;
    error = "";
    try {
      await onSave(name, draft);
      editing = false;
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      saving = false;
    }
  }

  async function reset() {
    saving = true;
    error = "";
    try {
      await onReset(name);
      editing = false;
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<article class="field-card" class:field-editing={editing}>
  <header class="field-head">
    <div>
      <span class="eyebrow">{label}</span>
      <span class="source-chip">
        {field.source === "edited"
          ? "已编辑"
          : field.source === "agents_md"
            ? "来自 AGENTS.md"
            : "暂无内容"}
      </span>
    </div>
    <div class="field-actions">
      {#if editing}
        <button class="quiet-button" disabled={saving} onclick={() => { editing = false; error = ""; }}>取消</button>
        <button class="small-primary" disabled={saving} onclick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
      {:else}
        <button class="quiet-button" onclick={() => { editing = true; draft = field.value ?? ""; }}>编辑</button>
        {#if field.source === "edited"}
          <button class="quiet-button" disabled={saving} onclick={() => void reset()}>恢复自动提取</button>
        {/if}
      {/if}
    </div>
  </header>

  {#if field.agents_md_changed}
    <div class="change-banner">
      <strong>AGENTS.md 有更新</strong>
      <span>当前编辑基于较早版本。保存不会覆盖自动提取的新副本。</span>
      {#if field.auto_value}
        <details>
          <summary>对照新的自动提取</summary>
          <pre>{field.auto_value}</pre>
        </details>
      {/if}
    </div>
  {/if}

  {#if editing}
    <textarea
      class="field-editor"
      maxlength="4000"
      rows="9"
      aria-label="编辑{label}"
      bind:value={draft}
    ></textarea>
    <div class="field-editor-foot">
      <span>{Array.from(draft).length} / 4000</span>
      <span>按纯文本保存，不渲染 Markdown。</span>
    </div>
  {:else if field.value}
    <pre class="field-preview">{field.value}</pre>
  {:else}
    <p class="empty-field">AGENTS.md 中没有识别到这一节，也还没有手动编辑。</p>
  {/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</article>
