// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";

const project = (id: string, name = id.toUpperCase()) => ({
  id, repo: `synthetic/${id}`, name, status: "active" as const,
  last_activity_at: "2026-10-24T00:00:00Z", url: `https://example.test/${id}`,
  latest_handoff: null,
});

const card = (id: string, name = id.toUpperCase()) => ({
  as_of: "2026-10-24T00:00:00Z",
  project: { id, repo: `synthetic/${id}`, name, status: "active" as const,
    default_branch: "main", url: `https://example.test/${id}` },
  goal: { value: null, auto_value: null, source: "none" as const, agents_md_changed: false },
  scope: { value: null, auto_value: null, source: "none" as const, agents_md_changed: false },
  conventions: { value: null, auto_value: null, source: "none" as const, agents_md_changed: false },
  pitfalls: { value: null, auto_value: null, source: "none" as const, agents_md_changed: false },
  progress: null, task_progress: [], recent_handoffs: [], recent_commits: [], open_prs: [],
  recently_merged: [], open_issues: [], active_tasks: [],
  sync: { commits: { last_ok_at: null, error: null }, pulls: { last_ok_at: null, error: null },
    issues: { last_ok_at: null, error: null }, agents_md: { last_ok_at: null, error: null },
    tasks: { last_ok_at: null, error: null } }, notice: "",
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function json(value: unknown): Response {
  return Response.json(value);
}

function backend(ids: string[]) {
  const detail = new Map<string, Deferred<Response>>();
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const path = String(input);
    if (path === "/api/me") return Promise.resolve(json({ authenticated: true }));
    if (path === "/api/projects") return Promise.resolve(json({
      as_of: "2026-10-24T00:00:00Z", projects: ids.map(id => project(id)),
    }));
    const match = path.match(/^\/api\/projects\/([^/?]+)\?handoffs=20$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      let pending = detail.get(id);
      if (!pending) { pending = deferred<Response>(); detail.set(id, pending); }
      return pending.promise;
    }
    if (path.includes("/handoffs?")) return Promise.resolve(json({
      handoffs: [], next_before: null, next_before_id: null,
    }));
    return Promise.reject(new Error(`Unhandled request ${path}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { detail, fetchMock };
}

function mountList() {
  window.history.replaceState(null, "", "/?list=1");
  render(App);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("project route request revisions", () => {
  it("keeps the list when a slow detail response finishes after returning home", async () => {
    const api = backend(["a"]);
    mountList();
    await screen.findByRole("button", { name: /A/ });
    await fireEvent.click(screen.getByRole("button", { name: /A/ }));
    await fireEvent.click(screen.getByRole("button", { name: "项目" }));
    await screen.findByRole("heading", { name: "在手项目" });
    api.detail.get("a")!.resolve(json(card("a")));
    await waitFor(() => expect(screen.getByRole("heading", { name: "在手项目" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "A" })).toBeNull();
  });

  it("keeps the newest detail when switching projects quickly", async () => {
    const api = backend(["a", "b"]);
    mountList();
    await screen.findByRole("button", { name: /A/ });
    await fireEvent.click(screen.getByRole("button", { name: /A/ }));
    window.history.pushState(null, "", "/p/b");
    window.dispatchEvent(new PopStateEvent("popstate"));
    api.detail.get("b")!.resolve(json(card("b")));
    expect(await screen.findByRole("heading", { name: "B" })).toBeTruthy();
    api.detail.get("a")!.resolve(json(card("a")));
    await waitFor(() => expect(screen.getByRole("heading", { name: "B" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "A" })).toBeNull();
  });
});
