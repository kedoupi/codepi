<script lang="ts">
  import { onMount } from "svelte";
  import { CODEPI_SYMBOL_PNG } from "@kedoupi/shared/brand";
  import { api, ApiError } from "./lib/api";
  import type { ProjectSummary } from "./lib/types";
  import { projectSlot } from "./lib/format";
  import Icon from "./components/Icon.svelte";
  import Login from "./components/Login.svelte";
  import Today from "./components/Today.svelte";
  import Board from "./components/Board.svelte";
  import ProjectPage from "./components/ProjectPage.svelte";
  import Log from "./components/Log.svelte";
  import TaskDrawer from "./components/TaskDrawer.svelte";
  import AddProject from "./components/AddProject.svelte";
  import "./style.css";

  type Route = { view: "today" } | { view: "board" } | { view: "log" } | { view: "project"; id: string } | { view: "login" };

  let phase = $state<"loading" | "ready" | "login" | "error">("loading");
  let route = $state<Route>({ view: "today" });
  let task = $state<{ project: string; key: string } | null>(null);
  let projects = $state<ProjectSummary[]>([]);
  let errorMessage = $state("");
  let adding = $state(false);
  let returnTo = $state("/");
  let authError = $state(false);

  function parse(): Route {
    const path = location.pathname;
    if (path === "/login") return { view: "login" };
    if (path === "/board") return { view: "board" };
    if (path === "/log") return { view: "log" };
    const match = path.match(/^\/p\/([^/]+)\/?$/);
    if (match) {
      try {
        return { view: "project", id: decodeURIComponent(match[1]) };
      } catch {
        return { view: "today" };
      }
    }
    return { view: "today" };
  }

  function readTask() {
    const raw = new URLSearchParams(location.search).get("task");
    const slash = raw ? raw.indexOf("/") : -1;
    task = raw && slash > 0 ? { project: raw.slice(0, slash), key: raw.slice(slash + 1) } : null;
  }

  function safeReturn(value: string | null): string {
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/") ||
      /[\\\u0000-\u001f]/.test(value)) return "/";
    return value;
  }

  export function navigate(path: string) {
    history.pushState(null, "", path);
    route = parse();
    readTask();
    scrollTo({ top: 0 });
  }

  function openTask(project: string, key: string) {
    const url = new URL(location.href);
    url.searchParams.set("task", `${project}/${key}`);
    history.pushState(null, "", `${url.pathname}${url.search}`);
    readTask();
  }

  function closeTask() {
    const url = new URL(location.href);
    url.searchParams.delete("task");
    history.pushState(null, "", `${url.pathname}${url.search}`);
    task = null;
  }

  async function loadProjects() {
    const response = await api("/api/projects");
    projects = response.projects as ProjectSummary[];
  }

  async function boot() {
    route = parse();
    readTask();
    if (route.view === "login") {
      const params = new URLSearchParams(location.search);
      returnTo = safeReturn(params.get("return"));
      authError = params.has("auth_error");
      phase = "login";
      return;
    }
    try {
      await api("/api/me");
      await loadProjects();
      phase = "ready";
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      errorMessage = error instanceof Error ? error.message : "读取失败";
      phase = "error";
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      location.assign("/login");
    }
  }

  function link(event: MouseEvent, path: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(path);
  }

  onMount(() => {
    void boot();
    const onPop = () => {
      route = parse();
      readTask();
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  });

  const nav = [
    { view: "today", path: "/", label: "今天", icon: "today" },
    { view: "board", path: "/board", label: "看板", icon: "board" },
    { view: "log", path: "/log", label: "动态", icon: "log" },
  ] as const;
</script>

{#if phase === "login"}
  <Login destination={returnTo} {authError} />
{:else if phase === "loading"}
  <p class="boot">正在读取项目工作台…</p>
{:else if phase === "error"}
  <main class="boot-error"><h1>工作台暂时打不开</h1><p>{errorMessage}</p><button class="button" onclick={() => location.reload()}>重新加载</button></main>
{:else}
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/" onclick={event => link(event, "/")}>
        <img src={CODEPI_SYMBOL_PNG} alt="" aria-hidden="true" width="36" height="33" />
        <span>Code<b>Pi</b> 工作台</span>
      </a>
      <nav class="nav" aria-label="页面">
        {#each nav as item (item.view)}
          <a href={item.path} class:active={route.view === item.view} aria-current={route.view === item.view ? "page" : undefined}
            onclick={event => link(event, item.path)}><Icon name={item.icon} /> {item.label}</a>
        {/each}
      </nav>
      <div class="side-projects">
        <div class="side-head"><span>项目</span>
          <button class="icon-button" aria-label="添加项目" title="添加项目" onclick={() => (adding = true)}><Icon name="plus" size={14} /></button>
        </div>
        {#each projects.filter(project => project.status !== "archived") as project (project.id)}
          <a href={`/p/${encodeURIComponent(project.id)}`}
            class:active={route.view === "project" && route.id === project.id}
            onclick={event => link(event, `/p/${encodeURIComponent(project.id)}`)}>
            <span class={`dot slot-${projectSlot(projects, project.id)}`}></span>
            <span class="side-name">{project.name}</span>
            {#if project.need_you}<span class="side-count" title="需要你">{project.need_you}</span>{/if}
          </a>
        {/each}
      </div>
      <button class="link-button logout" onclick={logout}>退出登录</button>
    </aside>
    <main class="main">
      {#if route.view === "today"}
        <Today />
      {:else if route.view === "board"}
        <Board {projects} onOpen={openTask} />
      {:else if route.view === "log"}
        <Log {projects} />
      {:else if route.view === "project"}
        {#key route.id}
          <ProjectPage id={route.id} {projects} onOpen={openTask} onChanged={loadProjects} />
        {/key}
      {/if}
    </main>
    <nav class="tabbar" aria-label="页面">
      {#each nav as item (item.view)}
        <a href={item.path} class:active={route.view === item.view} onclick={event => link(event, item.path)}>
          <Icon name={item.icon} size={20} /><span>{item.label}</span>
        </a>
      {/each}
      <a href={projects[0] ? `/p/${encodeURIComponent(projects[0].id)}` : "/"} class:active={route.view === "project"}
        onclick={event => link(event, projects[0] ? `/p/${encodeURIComponent(projects[0].id)}` : "/")}>
        <Icon name="folder" size={20} /><span>项目</span>
      </a>
    </nav>
  </div>
  {#if task}
    {#key `${task.project}/${task.key}`}
      <TaskDrawer project={task.project} taskKey={task.key} {projects} onClose={closeTask} />
    {/key}
  {/if}
  {#if adding}
    <AddProject onClose={() => (adding = false)} onCreated={loadProjects} />
  {/if}
{/if}
