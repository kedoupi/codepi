<script lang="ts">
  import { api, ApiError } from "../lib/api";
  import Icon from "./Icon.svelte";
  import TokenReveal from "./TokenReveal.svelte";

  let { onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> | void } = $props();
  let id = $state("");
  let name = $state("");
  let repo = $state("");
  let busy = $state(false);
  let error = $state("");
  let created = $state<{ project: string; token: string } | null>(null);

  const MESSAGES: Record<string, string> = {
    project_exists: "这个 ID 已经有项目了。",
    invalid_project_id: "ID 只能用小写字母、数字和连字符，最长 64 个字符。",
    invalid_repo: "仓库写成 owner/repo，或者留空。",
    invalid_name: "名称不能为空，最长 120 个字符。",
  };

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    try {
      created = await api("/api/projects", { body: { id: id.trim(), name: name.trim(), ...(repo.trim() ? { repo: repo.trim() } : {}) } }) as
        unknown as { project: string; token: string };
      await onCreated();
    } catch (cause) {
      error = cause instanceof ApiError ? MESSAGES[cause.message] ?? "没有建成，请稍后再试。" : "没有建成，请稍后再试。";
    } finally {
      busy = false;
    }
  }
</script>

<button class="scrim" tabindex="-1" aria-label="关闭" onclick={onClose}></button>
<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title">
  <button class="icon-button drawer-close" aria-label="关闭" onclick={onClose}><Icon name="close" /></button>
  <h2 id="add-title">添加项目</h2>
  {#if created}
    <TokenReveal token={created.token} project={created.project} />
    <button class="button" onclick={onClose}>完成</button>
  {:else}
    <form class="form" onsubmit={submit}>
      <label for="add-id">ID <small>用在推送地址里，例如 mybrain</small></label>
      <input id="add-id" required maxlength="64" pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" bind:value={id} />
      <label for="add-name">名称</label>
      <input id="add-name" required maxlength="120" bind:value={name} />
      <label for="add-repo">GitHub 仓库 <small>可选，owner/repo，便于命令行识别</small></label>
      <input id="add-repo" maxlength="200" bind:value={repo} />
      {#if error}<p class="inline-alert" role="alert">{error}</p>{/if}
      <button class="button primary" type="submit" disabled={busy}>{busy ? "正在建…" : "建项目并生成令牌"}</button>
    </form>
  {/if}
</div>
