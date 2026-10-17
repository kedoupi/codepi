<script lang="ts">
  import type { Account } from "../api";
  import { logout } from "../api";
  import { SessionExpiredError } from "../session";
  import { showToast, errText } from "../lib/toast";

  let { account = null, extra = "" }: { account?: Account | null; extra?: string } = $props();

  const brand = $derived(account?.brand || "珂抖屁");
  const who = $derived(
    account ? (account.email.split("@")[0] || account.email) : "",
  );

  async function handleLogout() {
    try {
      await logout();
      location.replace("/login");
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showToast(errText(error, "退出失败，请重试"), "err");
      }
    }
  }
</script>

<header class="masthead wb-head">
  <div class="brand-block">
    <p class="brand-kicker">{brand}</p>
    <h1 class="brand">珂抖屁公众号</h1>
    <p class="sub">稿件、预览与审核 · 过稿后人工进箱{extra}</p>
  </div>
  {#if account}
    <div class="mast-actions">
      <span class="who" title={account.email}>{who}</span>
      <button class="ghost-link" type="button" onclick={handleLogout}>退出</button>
    </div>
  {/if}
</header>
