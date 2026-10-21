<script lang="ts">
  import { CODEPI_SYMBOL_PNG, PRODUCT_BRAND } from "@kedoupi/shared/brand";
  import { loginHref } from "../lib/api";

  let {
    destination = "/",
    authError = false,
  }: { destination?: string; authError?: boolean } = $props();
</script>

<main class="login-shell">
  <section class="login-copy">
    <div class="brand-lockup">
      <img class="brand-mark" src={CODEPI_SYMBOL_PNG} alt="" aria-hidden="true" width="348" height="316" decoding="async" />
      <span>kedoupi<small>codepi · 项目工作台</small></span>
    </div>
    <div class="login-statement">
      <span class="eyebrow">PROJECT / CONTINUITY</span>
      <h1>让下一个会话，<br />从明确的任务边界开始。</h1>
      <p>项目卡、任务交接、GitHub 动静汇聚在同一张工作台上。</p>
    </div>
    <div class="login-diagram" aria-hidden="true">
      <span class="diagram-node node-a">AGENTS.md</span>
      <span class="diagram-line line-a"></span>
      <span class="diagram-node node-b">task: mcp</span>
      <span class="diagram-line line-b"></span>
      <span class="diagram-node node-c">next step</span>
    </div>
    <p class="login-foot">{PRODUCT_BRAND} · 私人项目空间</p>
  </section>
  <section class="login-panel">
    <div class="login-card">
      <span class="eyebrow">仅本人访问</span>
      <h2>进入项目工作台</h2>
      <p class="muted">通过 {PRODUCT_BRAND} 统一登录。项目看板与 AI 交接使用同一身份。</p>
      {#if authError}
        <p class="inline-alert" role="alert">登录未完成，请重新尝试。</p>
      {/if}
      <a class="primary-button login-button" href={loginHref(destination)}>统一登录</a>
      <p class="fine">登录状态最多保留 7 天。退出会同时撤销统一浏览器会话。</p>
    </div>
  </section>
</main>
