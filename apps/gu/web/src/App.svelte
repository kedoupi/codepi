<script lang="ts">
  import { onMount, tick } from "svelte";
  import "./style.css";
  import { CODEPI_SYMBOL_PNG, PRODUCT_BRAND } from "@kedoupi/shared/brand";
  import { api } from "./lib/api";
  import { router, syncFromLocation } from "./lib/router.svelte";
  import { resetFilters, session } from "./lib/state.svelte";
  import type { Snapshot } from "./lib/format";
  import type { CalendarView } from "./calendar";
  import { noticeTone } from "./diagnostics";
  import Login from "./components/Login.svelte";
  import Overview from "./components/Overview.svelte";
  import Positions from "./components/Positions.svelte";
  import Reports from "./components/Reports.svelte";
  import Status from "./components/Status.svelte";
  import Workspace from "./components/Workspace.svelte";
  import type { WorkspaceView } from "../../worker/workspace-types";
  import { parseHash } from "./lib/router.svelte";

  const NAV_ITEMS = $derived(session.online || session.workspaceOpen ? [
    ["workspace", "账户与持仓"], ["transactions", "成交流水"], ["rules", "投资规则"],
    ["materials", "资料库"], ["reports", "研究报告"], ["status", "版本与导出"],
  ] : [
    ["overview", "总览"],
    ["positions", "持仓与风控"],
    ["reports", "研究与报告"],
    ["status", "数据状态"],
    ["workspace", "线上工作台"],
  ]);

  const parsed = $derived.by(() => {
    return parseHash(router.hash);
  });

  const subtitle = $derived(
    session.online ? `线上账户 · 版本 ${session.online.revision}` : session.snapshot
      ? `持仓确认 ${String(session.snapshot.data.account[0].holdings_as_of)}`
      : "",
  );

  $effect(() => {
    if (["workspace", "transactions", "rules", "materials"].includes(parsed.page))
      session.workspaceOpen = true;
  });

  /** 提示条自动收起：仅对「已…」类的完成提示，和旧实现的 6 秒一致。 */
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const text = session.notice;
    clearTimeout(noticeTimer);
    if (text.startsWith("已")) {
      noticeTimer = setTimeout(() => {
        if (session.notice === text) session.notice = "";
      }, 6000);
    }
  });

  let checkingSession = false;

  async function load() {
    if (session.loading) return;
    session.loading = true;
    const version = ++session.loadVersion;
    const previous = session.snapshot?.batch_id;
    session.notice = "";
    try {
      if (session.ssoMode === undefined)
        session.ssoMode = (await api("/api/health")).sso_enabled === true;
      await api("/api/me");
      if (version !== session.loadVersion) return;
      session.auth = "authenticated";
      const response = await api("/api/dashboard");
      if (version !== session.loadVersion) return;
      if (response.mode === "online") {
        session.online = response.workspace as WorkspaceView;
        session.snapshot = null;
        session.dataState = "ready";
        return;
      }
      const next = response as unknown as Snapshot;
      if (!next.data?.account?.length)
        throw new Error("数据批次不完整，请重新同步");
      session.snapshot = next;
      session.dataState = "ready";
      session.notice = previous
        ? next.batch_id === previous
          ? "已检查，当前已是最新同步批次。未重新采集行情。"
          : "已载入新同步批次。"
        : "";
      void loadCalendar(version);
    } catch (error) {
      if (version !== session.loadVersion) return;
      session.dataState =
        (error as { status?: number }).status === 404 ? "empty" : "failed";
      session.notice = session.snapshot
        ? "刷新失败，仍展示上一批数据。请检查连接后重试；原生成时间保持不变。"
        : (error as Error).message;
    } finally {
      if (version === session.loadVersion) session.loading = false;
    }
  }

  async function loadCalendar(version: number) {
    try {
      const next = await api("/api/calendar");
      if (version !== session.loadVersion) return;
      if (typeof next.state !== "string") throw new Error("日历状态无效");
      session.calendar = next as unknown as CalendarView;
      session.calendarFailed = false;
    } catch {
      if (version !== session.loadVersion) return;
      session.calendarFailed = true;
    }
  }

  async function checkSession() {
    if (checkingSession || session.loading || session.auth !== "authenticated")
      return;
    checkingSession = true;
    try {
      await api("/api/me");
    } catch (error) {
      if (
        (error as { status?: number }).status !== 401 &&
        session.auth === "authenticated"
      ) {
        session.notice = "会话检查暂时失败，仍展示上次读取的数据，请稍后刷新。";
      }
    } finally {
      checkingSession = false;
    }
  }

  async function logout() {
    if (session.workspaceDirty && !confirm("放弃未保存的草稿并退出？可以先导出草稿。")) return;
    session.loadVersion++;
    try {
      await api("/api/auth/logout", {});
      session.snapshot = null;
      session.online = null;
      session.workspaceOpen = false;
      session.workspaceDirty = false;
      session.calendar = null;
      session.auth = "anonymous";
      session.loading = false;
      session.notice = "";
      session.loadVersion++;
      session.returnHash = "#overview";
      history.replaceState(null, "", "/login");
      syncFromLocation();
    } catch {
      session.loading = false;
      session.notice = "退出未完成，请检查连接后重试。";
    }
  }

  /** 登录成功（OTP 表单内联调用）：恢复 hash 并进入数据加载。 */
  async function onLoggedIn() {
    session.auth = "authenticated";
    resetFilters();
    history.replaceState(null, "", `/${session.returnHash || "#overview"}`);
    session.returnHash = "";
    syncFromLocation();
    await load();
  }

  /** 401 / 退出后进入登录页：清空过滤器，保持登录页 hash。 */
  $effect(() => {
    if (session.auth === "anonymous") resetFilters();
  });

  function focusContent() {
    document
      .querySelector<HTMLElement>("#content")
      ?.focus({ preventScroll: true });
  }

  function onHashChange() {
    const next = parseHash(location.hash);
    if (!session.online && session.workspaceOpen && ["overview", "positions"].includes(next.page)) {
      if (session.workspaceDirty && !confirm("放弃未保存的草稿并返回旧看板？可以先导出草稿。")) {
        history.replaceState(null, "", `/${router.hash}`);
        return;
      }
      session.workspaceOpen = false;
    }
    syncFromLocation();
    window.scrollTo(0, 0);
    // 等路由状态落到 DOM 再移动焦点，和旧实现 render() 之后的顺序一致。
    void tick().then(focusContent);
  }

  onMount(() => {
    syncFromLocation();
    const onFocus = () => void checkSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("visibilitychange", onVisibility);
    void load();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(noticeTimer);
    };
  });

  const brand = PRODUCT_BRAND;
</script>

{#if session.auth === "anonymous"}
  <Login onLoggedIn={onLoggedIn} />
{:else}
  <div class="workspace">
    <aside class="sidebar">
      <a class="brand" href="#overview" aria-label="{brand} · GU"
        ><img class="brand-mark" src={CODEPI_SYMBOL_PNG} alt="" aria-hidden="true" width="348" height="316" decoding="async" /><span
          ><span class="brand-code">Code</span><span class="brand-pi">Pi</span><small>个人投资工作台</small></span
        ></a
      >
      <nav aria-label="主导航">
        {#each NAV_ITEMS as [id, title] (id)}
          <a
            href="#{id}"
            data-nav={id}
            aria-current={parsed.page === id || (session.online && parsed.page === "overview" && id === "workspace") ? "page" : undefined}
            ><span class="nav-dot"></span>{title}</a
          >
        {/each}
      </nav>
      <div class="sidebar-bottom">
        <span class="private-dot"></span>私人投资记录
        <p>依据数据，不追逐噪音。</p>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div>
          <span class="site-name">投资工作台</span><span
            class="muted"
            id="topbar-subtitle">{subtitle}</span
          >
        </div>
        <div class="actions">
          {#if !session.online && !session.workspaceOpen}
          <button
            id="refresh"
            title="重新读取网站已同步批次，不采集新行情"
            disabled={session.loading}
            onclick={() => void load()}
            >{session.loading ? "刷新中…" : "刷新数据"}</button
          >
          {/if}
          <button id="logout" onclick={() => void logout()}>退出</button>
        </div>
      </header>
      <p
        id="notice"
        class={session.notice
          ? `notice notice-${noticeTone(session.notice)}`
          : "notice"}
        role="status"
        aria-live="polite"
        hidden={!session.notice}
      >
        {session.notice}
      </p>
      <main id="content" tabindex="-1" aria-busy={session.loading}>
        {#if session.auth === "authenticated" && (session.online || session.workspaceOpen || ["workspace", "transactions", "rules", "materials"].includes(parsed.page))}
          <Workspace page={parsed.page} />
        {:else if !session.snapshot}
          <div class="empty">
            <span class="seal"
              >{session.auth === "authenticated"
                ? "登录成功"
                : "正在连接"}</span
            >
            <h1>
              {session.dataState === "empty"
                ? "等待第一批投资数据"
                : session.dataState === "failed"
                  ? "数据暂时无法读取"
                  : "正在读取投资数据…"}
            </h1>
            <p>
              可用“刷新数据”重试。账户、持仓和报告会在完整批次同步后显示。
            </p>
            {#if session.auth === "authenticated"}
              <a class="text-link" href="#workspace">创建线上账户，无需本地脚本</a>
            {/if}
          </div>
        {:else}
          {#if session.snapshot.data.account[0].data_mode === "demo"}
            <div class="notice notice-warning" role="status" aria-live="polite">
              本地演示：全部金额、行情和报告均为虚构数据，不代表真实账户。
            </div>
          {/if}
          {#if parsed.page === "positions"}
            <Positions d={session.snapshot.data} />
          {:else if parsed.page === "reports"}
            <Reports reports={session.snapshot.data.reports} id={parsed.id} />
          {:else if parsed.page === "status"}
            <Status snapshot={session.snapshot} />
          {:else}
            <Overview d={session.snapshot.data} />
          {/if}
        {/if}
      </main>
      <footer>
        {session.online ? "账户在线维护。参考估值、账户确认与报告日期分别记录，成交以券商凭证为准。"
          : "刷新数据只读取网站已同步批次。行情与账户确认时间分别记录，成交以券商凭证为准。"}
      </footer>
    </div>
  </div>
{/if}
