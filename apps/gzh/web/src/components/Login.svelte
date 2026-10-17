<script lang="ts">
  import { me, requestOtp, ssoEnabled, verifyOtp } from "../api";
  import { errText } from "../lib/toast";
  import Masthead from "./Masthead.svelte";
  import { onMount } from "svelte";

  const retrying = new URLSearchParams(location.search).has("auth_error");
  const nextParam = new URLSearchParams(location.search).get("next") || "/";

  let sso = $state<boolean | null>(null);
  let loadError = $state("");
  let email = $state("");
  let code = $state("");
  let msg = $state("");
  let msgKind = $state<"" | "is-ok" | "is-err">("");
  let sendDisabled = $state(false);
  let sendLabel = $state("发送验证码");
  let verifying = $state(false);
  let codeInput: HTMLInputElement | undefined = $state();

  function setMsg(text: string, kind: "" | "is-ok" | "is-err" = "") {
    msg = text;
    msgKind = kind;
  }

  function startResendCooldown(seconds = 60) {
    sendDisabled = true;
    let left = seconds;
    sendLabel = `重发 (${left})`;
    const timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(timer);
        sendDisabled = false;
        sendLabel = "重新发送";
        return;
      }
      sendLabel = `重发 (${left})`;
    }, 1000);
  }

  async function sendCode() {
    setMsg("发送中…");
    sendDisabled = true;
    try {
      const res = await requestOtp(email);
      setMsg(res.dev_otp ? `本地开发码：${res.dev_otp}` : res.message, "is-ok");
      startResendCooldown();
      codeInput?.focus();
    } catch (error) {
      sendDisabled = false;
      setMsg(errText(error, "发送失败"), "is-err");
    }
  }

  async function verify() {
    const digits = code.replace(/\D/g, "");
    if (verifying || digits.length !== 6) return;
    verifying = true;
    setMsg("校验中…");
    try {
      await verifyOtp(email, code);
      setMsg("登录成功，进入看板…", "is-ok");
      location.replace(nextParam.startsWith("/") ? nextParam : "/");
    } catch (error) {
      verifying = false;
      setMsg(errText(error, "登录失败"), "is-err");
      codeInput?.select();
    }
  }

  function onCodeInput() {
    const digits = code.replace(/\D/g, "").slice(0, 6);
    if (code !== digits) code = digits;
    if (digits.length === 6) void verify();
  }

  onMount(async () => {
    try {
      if (!retrying) {
        const account = await me();
        if (account) {
          location.replace("/");
          return;
        }
      }
      sso = await ssoEnabled();
    } catch (error) {
      loadError = errText(error, "服务暂时不可用");
    }
  });
</script>

<Masthead />
<section class="login-hero">
  <h2 class="login-title">登录后开始今日发稿</h2>
  {#if sso === null}
    <p class="hint">正在读取登录方式…</p>
  {:else if sso}
    <p class="hint">内部工具 · 仅本人访问</p>
  {:else}
    <p class="hint">内部工具 · 邮箱验证码 · 仅白名单</p>
  {/if}
</section>
<section class="sheet login-pad login-card">
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
    <button type="button" class="btn-primary-block" onclick={() => location.reload()}>重新连接</button>
  {:else if sso === null}
    <p class="hint msg-line" role="status">加载中…</p>
  {:else if sso}
    {#if retrying}
      <p class="error" role="alert">登录未完成。请重新登录；服务暂时不可用时，可稍后重试。</p>
    {/if}
    <a class="btn-primary-block" href="/api/auth/login?return={encodeURIComponent(nextParam)}">统一登录</a>
    <p class="hint">公众号工作台登录状态最多保留 7 天。退出将同步退出其他工具。</p>
  {:else}
    <form
      class="login-form"
      onsubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      <label for="email">工作邮箱</label>
      <input id="email" name="email" type="email" autocomplete="username" required bind:value={email} placeholder="name@example.com" />
      <button type="button" id="send" class="btn-primary-block" disabled={sendDisabled} onclick={() => void sendCode()}>{sendLabel}</button>
      <label for="code">6 位验证码</label>
      <div class="code-row">
        <input
          id="code"
          name="code"
          inputmode="numeric"
          pattern="\d{6}"
          maxlength="6"
          autocomplete="one-time-code"
          placeholder="••••••"
          bind:value={code}
          bind:this={codeInput}
          oninput={onCodeInput}
        />
        <button class="btn-primary-block" type="submit">登录</button>
      </div>
    </form>
  {/if}
  <p class="hint msg-line {msgKind}" role="status">{msg}</p>
</section>
