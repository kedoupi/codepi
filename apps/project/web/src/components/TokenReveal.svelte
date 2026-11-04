<script lang="ts">
  let { token, project }: { token: string; project: string } = $props();
  let copied = $state(false);
  let field = $state<HTMLInputElement | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      copied = true;
    } catch {
      field?.select();
    }
  }
</script>

<div class="token-reveal" role="status">
  <p><b>推送令牌只显示这一次。</b>把它存进仓库所在电脑的钥匙串，不要写进仓库、聊天或文档。</p>
  <div class="token-row">
    <input id={`token-${project}`} readonly value={token} bind:this={field} aria-label="推送令牌" onfocus={() => field?.select()} />
    <button class="button" onclick={copy}>{copied ? "已复制" : "复制"}</button>
  </div>
  <p class="muted">推送地址：<code>POST /api/ingest/{project}</code>，请求头 <code>Authorization: Bearer &lt;令牌&gt;</code>。</p>
</div>
