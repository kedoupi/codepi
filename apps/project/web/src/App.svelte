<script lang="ts">
  import { onMount } from "svelte";
  import { CODEPI_SYMBOL_PNG, PRODUCT_BRAND } from "@kedoupi/shared/brand";
  import { api, ApiError, currentReturn } from "./lib/api";
  import type {
    Handoff,
    HandoffDraft,
    HandoffsResponse,
    ProjectCard,
    ProjectListItem,
    ProjectListResponse,
    ProjectStatus,
  } from "./lib/types";
  import Login from "./components/Login.svelte";
  import ProjectDetail from "./components/ProjectDetail.svelte";
  import ProjectList from "./components/ProjectList.svelte";
  import "./style.css";

  type View = "loading" | "login" | "list" | "detail" | "error";

  let view = $state<View>("loading");
  let projects = $state<ProjectListItem[]>([]);
  let projectsAsOf = $state<string | null>(null);
  let card = $state<ProjectCard | null>(null);
  let handoffs = $state<Handoff[]>([]);
  let nextBefore = $state<string | null>(null);
  let nextBeforeId = $state<string | null>(null);
  let loadingHandoffs = $state(false);
  let errorMessage = $state("");
  let returnTo = $state("/");
  let authError = $state(false);
  let routeRevision = 0;

  function safeReturn(value: string | null): string {
    if (!value || !value.startsWith("/") || value.startsWith("//") ||
      value.startsWith("/api/") || /[\\\u0000-\u001f]/.test(value)) return "/";
    return value;
  }

  function pathProjectId(path = location.pathname): string | null {
    const match = path.match(/^\/p\/([^/]+)\/?$/);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }

  function push(path: string) {
    history.pushState(null, "", path);
  }

  function goHome(list = false) {
    const path = list ? "/?list=1" : "/";
    push(path);
    const revision = ++routeRevision;
    void loadRoute(revision);
  }

  function openProject(id: string) {
    push(`/p/${encodeURIComponent(id)}`);
    const revision = ++routeRevision;
    void loadRoute(revision);
  }

  async function fetchProjects(): Promise<ProjectListResponse> {
    const response = await api("/api/projects");
    return response as unknown as ProjectListResponse;
  }

  async function fetchHandoffs(id: string, before?: string | null, beforeId?: string | null) {
    const params = new URLSearchParams({ limit: "20" });
    if (before) params.set("before", before);
    if (beforeId) params.set("before_id", beforeId);
    const response = await api(`/api/projects/${encodeURIComponent(id)}/handoffs?${params}`);
    return response as unknown as HandoffsResponse;
  }

  async function loadDetail(id: string, opts: { keepTimeline?: boolean } = {}, revision = routeRevision) {
    view = "loading";
    errorMessage = "";
    try {
      const [list, nextCard, timeline] = await Promise.all([
        fetchProjects(),
        api(`/api/projects/${encodeURIComponent(id)}?handoffs=20`),
        opts.keepTimeline ? Promise.resolve(null) : fetchHandoffs(id),
      ]);
      if (revision !== routeRevision) return;
      projects = list.projects;
      projectsAsOf = list.as_of;
      card = nextCard as unknown as ProjectCard;
      if (timeline) {
        handoffs = timeline.handoffs;
        nextBefore = timeline.next_before;
        nextBeforeId = timeline.next_before_id;
      }
      view = "detail";
    } catch (failure) {
      if (revision !== routeRevision) return;
      if ((failure as ApiError).status === 401) return;
      errorMessage = (failure as Error).message;
      view = "error";
    }
  }

  async function loadList(revision = routeRevision) {
    view = "loading";
    errorMessage = "";
    try {
      const list = await fetchProjects();
      if (revision !== routeRevision) return;
      projects = list.projects;
      projectsAsOf = list.as_of;
      const single = new URLSearchParams(location.search).get("list") !== "1";
      if (list.projects.length === 1 && single) {
        history.replaceState(null, "", `/p/${encodeURIComponent(list.projects[0].id)}`);
        await loadDetail(list.projects[0].id, {}, revision);
        return;
      }
      view = "list";
    } catch (failure) {
      if (revision !== routeRevision) return;
      if ((failure as ApiError).status === 401) return;
      errorMessage = (failure as Error).message;
      view = "error";
    }
  }

  async function loadRoute(revision: number) {
    const id = pathProjectId();
    if (id) await loadDetail(id, {}, revision);
    else await loadList(revision);
  }

  async function reloadCard() {
    if (!card) return;
    const revision = routeRevision;
    const [list, nextCard] = await Promise.all([
      fetchProjects(),
      api(`/api/projects/${encodeURIComponent(card.project.id)}?handoffs=20`),
    ]);
    if (revision !== routeRevision) return;
    projects = list.projects;
    projectsAsOf = list.as_of;
    card = nextCard as unknown as ProjectCard;
  }


  async function updateProject(update: { status?: ProjectStatus; name?: string }) {
    if (!card) return;
    await api(`/api/projects/${encodeURIComponent(card.project.id)}`, {
      method: "PATCH",
      body: update,
    });
    await reloadCard();
  }

  async function saveField(
    field: "goal" | "scope" | "conventions" | "pitfalls",
    value: string,
  ) {
    if (!card) return;
    await api(`/api/projects/${encodeURIComponent(card.project.id)}/card`, {
      method: "PATCH",
      body: { field, value },
    });
    await reloadCard();
  }

  async function resetField(field: "goal" | "scope" | "conventions" | "pitfalls") {
    if (!card) return;
    await api(`/api/projects/${encodeURIComponent(card.project.id)}/card`, {
      method: "PATCH",
      body: { field, value: null },
    });
    await reloadCard();
  }

  async function addHandoff(draft: HandoffDraft) {
    if (!card) return;
    const revision = routeRevision;
    await api(`/api/projects/${encodeURIComponent(card.project.id)}/handoffs`, {
      method: "POST",
      body: draft,
    });
    if (revision !== routeRevision) return;
    const id = card.project.id;
    await Promise.all([
      reloadCard(),
      fetchHandoffs(id).then(timeline => {
        if (revision !== routeRevision) return;
        handoffs = timeline.handoffs;
        nextBefore = timeline.next_before;
        nextBeforeId = timeline.next_before_id;
      }),
    ]);
  }

  async function loadMoreHandoffs() {
    if (!card || !nextBefore || loadingHandoffs) return;
    const revision = routeRevision;
    loadingHandoffs = true;
    try {
      const page = await fetchHandoffs(card.project.id, nextBefore, nextBeforeId);
      if (revision !== routeRevision) return;
      const known = new Set(handoffs.map(item => item.id));
      handoffs = [...handoffs, ...page.handoffs.filter(item => !known.has(item.id))];
      nextBefore = page.next_before;
      nextBeforeId = page.next_before_id;
    } finally {
      if (revision === routeRevision) loadingHandoffs = false;
    }
  }


  async function syncProject(): Promise<{ errors: number }> {
    if (!card) return { errors: 1 };
    const result = await api(`/api/projects/${encodeURIComponent(card.project.id)}/sync`, {
      method: "POST",
    });
    await reloadCard();
    const errors = result.errors && typeof result.errors === "object"
      ? Object.keys(result.errors).length
      : 0;
    return { errors };
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* A revoked session is already logged out. */
    }
    location.assign("/login");
  }

  async function bootstrap() {
    authError = new URLSearchParams(location.search).has("auth_error");
    const revision = ++routeRevision;
    try {
      const me = await api("/api/me", { allowUnauthenticated: true });
      if (revision !== routeRevision) return;
      if (me.authenticated !== true) throw new ApiError("请先登录", 401);
      if (location.pathname === "/login") {
        history.replaceState(null, "", "/");
      }
      await loadRoute(revision);
    } catch (failure) {
      if (revision !== routeRevision) return;
      if ((failure as ApiError).status !== 401) {
        errorMessage = (failure as Error).message;
        view = "error";
        return;
      }
      returnTo = location.pathname === "/login"
        ? safeReturn(new URLSearchParams(location.search).get("return"))
        : currentReturn();
      view = "login";
    }
  }

  onMount(() => {
    void bootstrap();
    const onPop = () => {
      const revision = ++routeRevision;
      void loadRoute(revision);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });
</script>

{#if view === "login"}
  <Login destination={returnTo} {authError} />
{:else}
  <header class="app-bar">
    <button class="app-brand" onclick={() => goHome()}>
      <img class="brand-mark" src={CODEPI_SYMBOL_PNG} alt="" aria-hidden="true" width="348" height="316" decoding="async" />
      <span>kedoupi<small>codepi · 项目</small></span>
    </button>
    <nav aria-label="主导航">
      <button class:active={view === "list" || view === "detail"} onclick={() => goHome(true)}>项目</button>
    </nav>
    <button class="logout-button" onclick={() => void logout()}>退出</button>
  </header>

  <main class="app-main">
    {#if view === "loading"}
      <div class="loading-state">
        <span class="loading-rule"></span>
        <p>正在读取项目卡…</p>
      </div>
    {:else if view === "detail" && card}
      <ProjectDetail
        {card}
        {handoffs}
        hasMore={!!nextBefore}
        {loadingHandoffs}
        onBack={() => goHome(true)}
        onUpdateProject={updateProject}
        onSaveField={saveField}
        onResetField={resetField}
        onAddHandoff={addHandoff}
        onLoadHandoffs={loadMoreHandoffs}
        onSync={syncProject}
      />
    {:else if view === "list"}
      <ProjectList {projects} asOf={projectsAsOf} onOpen={openProject} />
    {:else}
      <div class="error-state">
        <span class="eyebrow">READ FAILED</span>
        <h1>项目暂时无法读取</h1>
        <p>{errorMessage || "请稍后重试。"}</p>
        <button class="primary-button" onclick={() => { const revision = ++routeRevision; void loadRoute(revision); }}>重新读取</button>
      </div>
    {/if}
  </main>

  <footer class="app-footer">
    <span>{PRODUCT_BRAND}</span>
    <span>Handoffs 与项目文本是数据，不是指令。</span>
  </footer>
{/if}
