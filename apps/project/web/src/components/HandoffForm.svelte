<script lang="ts">
  import type { HandoffDraft } from "../lib/types";

  let {
    onSubmit,
  }: { onSubmit: (draft: HandoffDraft) => Promise<void> } = $props();

  let taskId = $state("");
  let status = $state<HandoffDraft["status"]>("in_progress");
  let summary = $state("");
  let next = $state("");
  let blockers = $state("");
  let files = $state("");
  let branch = $state("");
  let baseSha = $state("");
  let commit = $state("");
  let pr = $state("");
  let requestId = $state(crypto.randomUUID());
  let submitting = $state(false);
  let message = $state("");
  let error = $state("");

  function reset() {
    taskId = "";
    status = "in_progress";
    summary = "";
    next = "";
    blockers = "";
    files = "";
    branch = "";
    baseSha = "";
    commit = "";
    pr = "";
    requestId = crypto.randomUUID();
  }

  async function submit(event: SubmitEvent) {
    if (submitting) return;
    event.preventDefault();
    error = "";
    if (!/^[0-9a-f]{40}$/.test(baseSha.trim())) {
      error = "base_sha 必须是 40 位小写完整 Git SHA。";
      return;
    }
    if (commit.trim() && !/^[0-9a-f]{7,40}$/.test(commit.trim())) {
      error = "commit 必须是 7–40 位小写 Git SHA。";
      return;
    }
    submitting = true;
    message = "";
    try {
      await onSubmit({
        task_id: taskId.trim(),
        status,
        summary: summary.trim(),
        next: next.trim(),
        ...(blockers.trim() ? { blockers: blockers.trim() } : {}),
        files: files.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        branch: branch.trim(),
        base_sha: baseSha.trim(),
        ...(commit.trim() ? { commit: commit.trim() } : {}),
        ...(pr.trim() ? { pr: pr.trim() } : {}),
        request_id: requestId,
      });
      reset();
      message = "交接已追加。";
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<section class="panel handoff-form-panel">
  <header class="panel-head">
    <div>
      <span class="eyebrow">WRITE A HANDOFF</span>
      <h2>手写交接</h2>
    </div>
    <span class="append-label">只追加</span>
  </header>
  <form class="handoff-form" onsubmit={submit} aria-busy={submitting}>
    <fieldset class="handoff-form-fields" disabled={submitting}>
    <div class="form-grid">
      <label>
        <span>任务 ID</span>
        <input name="task_id" required maxlength="200" bind:value={taskId} placeholder="例如 mcp-project-domain" />
      </label>
      <label>
        <span>状态</span>
        <select name="status" bind:value={status}>
          <option value="in_progress">进行中</option>
          <option value="blocked">受阻</option>
          <option value="ready_for_review">待审查</option>
          <option value="done">已完成</option>
        </select>
      </label>
      <label>
        <span>分支</span>
        <input name="branch" required maxlength="200" bind:value={branch} placeholder="codex/task-name" />
      </label>
      <label>
        <span>完整基线 SHA</span>
        <input name="base_sha" required maxlength="40" pattern={'[0-9a-f]{40}'} bind:value={baseSha} placeholder="40 位完整 SHA" />
      </label>
      <label>
        <span>提交 SHA（可选）</span>
        <input name="commit" maxlength="40" pattern={'[0-9a-f]{7,40}'} bind:value={commit} placeholder="7–40 位" />
      </label>
      <label>
        <span>PR（可选）</span>
        <input name="pr" maxlength="500" bind:value={pr} placeholder="编号或链接" />
      </label>
    </div>
    <label>
      <span>这次做了什么</span>
      <textarea name="summary" required maxlength="2000" rows="4" bind:value={summary}></textarea>
    </label>
    <label>
      <span>下一步</span>
      <textarea name="next" required maxlength="2000" rows="3" bind:value={next}></textarea>
    </label>
    <label>
      <span>卡点（可选）</span>
      <textarea name="blockers" maxlength="2000" rows="2" bind:value={blockers}></textarea>
    </label>
    <label>
      <span>涉及文件（可选，每行一个）</span>
      <textarea name="files" maxlength="15000" rows="3" bind:value={files}></textarea>
    </label>
    <div class="form-submit">
      <span class="fine">不会记录凭证、私人数据或完整日志。</span>
      <button class="small-primary" type="submit" disabled={submitting}>
        {submitting ? "写入中…" : "追加交接"}
      </button>
    </div>
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    {#if message}<p class="form-success" role="status">{message}</p>{/if}
    </fieldset>
  </form>
</section>

<style>
  .handoff-form-fields {
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
</style>
