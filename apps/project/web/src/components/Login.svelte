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
      <span>Code<b>Pi</b> 工作台</span>
    </div>
    <div class="login-statement">
      <span class="eyebrow">个人工作台</span>
      <h1>所有项目要做的事，<br />一处看。</h1>
      <p>待办、要你拍板的事、进行中的分支和最近做完的事，由各个仓库推上来。</p>
    </div>
    <p class="login-foot">{PRODUCT_BRAND} · 私人项目空间</p>
  </section>
  <section class="login-panel">
    <div class="login-card">
      <span class="eyebrow">仅本人访问</span>
      <h2>进入项目工作台</h2>
      <p class="muted">通过 {PRODUCT_BRAND} 统一登录。</p>
      {#if authError}
        <p class="inline-alert" role="alert">登录未完成，请重新尝试。</p>
      {/if}
      <a class="primary-button login-button" href={loginHref(destination)}>统一登录</a>
      <p class="fine">登录状态最多保留 7 天。退出会同时撤销统一浏览器会话。</p>
    </div>
  </section>
</main>
