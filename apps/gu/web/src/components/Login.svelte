<script lang="ts">
  import { CODEPI_SYMBOL_PNG, PRODUCT_BRAND } from "@kedoupi/shared/brand";
  import { api } from "../lib/api";
  import { session } from "../lib/state.svelte";

  let { onLoggedIn }: { onLoggedIn: () => Promise<void> } = $props();

  // 仅登录页形态使用；ssoMode 由 App 首次 /api/health 填充。
  const sso = $derived(session.ssoMode !== false);
  const authError = new URLSearchParams(location.search).has("auth_error");
  // 登录成功后恢复登录前的 hash；与旧实现一致，登录链接在渲染时定值。
  const destination = `/${session.returnHash || "#overview"}`;

  let message = $state("");
  let cooldownSeconds = $state(0);
  let sending = $state(false);
  let verifying = $state(false);
  let code = $state("");
  let cooldown: ReturnType<typeof setInterval> | undefined;

  function waitToResend(seconds: number) {
    clearInterval(cooldown);
    const until = Date.now() + Math.max(1, seconds) * 1000;
    const tick = () => {
      cooldownSeconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      if (!cooldownSeconds) clearInterval(cooldown);
    };
    tick();
    cooldown = setInterval(tick, 1000);
  }

  async function send() {
    sending = true;
    message = "";
    try {
      const result = await api("/api/auth/request-otp", {});
      message = result.dev_otp
        ? `本地开发验证码：${result.dev_otp}`
        : "验证码已发送，请查看邮箱。";
      document.querySelector<HTMLInputElement>("#code")?.focus();
      waitToResend(Number(result.retry_after) || 60);
    } catch (error) {
      message = (error as Error).message;
      const retry = (error as { retryAfter?: number }).retryAfter;
      if (retry) waitToResend(retry);
    } finally {
      sending = false;
    }
  }

  async function verify(event: SubmitEvent) {
    event.preventDefault();
    verifying = true;
    try {
      await api("/api/auth/verify-otp", { code });
      clearInterval(cooldown);
      await onLoggedIn();
    } catch (error) {
      message = (error as Error).message;
      verifying = false;
    }
  }
</script>

<main class="login">
  <section class="login-story">
    <div>
      <a class="brand" href="#overview" aria-label="{PRODUCT_BRAND} · GU"
        ><img class="brand-mark" src={CODEPI_SYMBOL_PNG} alt="" aria-hidden="true" width="348" height="316" decoding="async" /><span
          ><span class="brand-code">Code</span><span class="brand-pi">Pi</span><small>个人投资工作台</small></span
        ></a
      >
    </div>
    <div class="login-heading">
      <p class="muted">为长期持有，留一份清醒的记录。</p>
      <h1>看清持仓。<br />回到自己的规则。</h1>
      <p>
        持仓、风控与研究，收在同一个地方。<br />每一个判断，都有数据和时间可循。
      </p>
    </div>
    <div class="login-foot">私人工作台 <span>北京时间</span></div>
  </section>
  <section class="login-panel">
    <div class="login-form">
      <span class="seal">仅本人访问</span>
      <h2>登录投资工作台</h2>
      {#if sso}
        <p class="muted">使用 {PRODUCT_BRAND} 账户统一登录。</p>
        {#if authError}
          <p role="alert">
            登录未完成。请重新登录；服务暂时不可用时，可稍后重试。
          </p>
        {/if}
        <a
          class="primary"
          href="/api/auth/login?return={encodeURIComponent(destination)}"
          >统一登录</a
        >
        <p class="fine">
          投资工作台登录状态最多保留 7 天。退出将同步退出其他工具。
        </p>
      {:else}
        <p class="muted">
          验证码将发送至<br /><strong>k•••••••••1@gmail.com</strong>
        </p>
        <button
          id="send"
          class="primary"
          disabled={sending || cooldownSeconds > 0}
          onclick={() => void send()}
          >{sending
            ? "正在发送…"
            : cooldownSeconds > 0
              ? `${cooldownSeconds} 秒后重新发送`
              : message
                ? "重新发送验证码"
                : "发送验证码"}</button
        >
        <form id="verify" onsubmit={verify}>
          <label for="code">六位验证码</label>
          <input
            id="code"
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern={"[0-9]{6}"}
            maxlength="6"
            placeholder="000000"
            required
            aria-describedby="login-message"
            bind:value={code}
          />
          <button id="enter" class="primary" type="submit" disabled={verifying}
            >验证并登录</button
          >
        </form>
        <p id="login-message" role="status" aria-live="polite">{message}</p>
        <p class="fine">验证码 8 分钟内有效，登录状态保留 7 天。</p>
      {/if}
    </div>
  </section>
</main>
